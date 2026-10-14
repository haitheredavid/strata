/**
 * Exports a slice of a Databricks workspace as a strata snapshot: Unity Catalog tables, the jobs whose
 * lineage touches them, and one day of their runs. Read-only; uses the `databricks` CLI's auth.
 *
 *   pnpm export:databricks --profile prod --catalogs bronze,silver,gold,platinum --schemas 'procore*,!*archive*' --day 2026-10-12
 *
 * Writes `snapshots/<host>-<day>.snapshot.json` (gitignored: it holds real workspace metadata), plus the
 * raw payloads under `snapshots/.raw/` so `--from-raw <file>` can redo the mapping without the network.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { buildSnapshot } from '../src/ingest/databricks/buildSnapshot'
import type { ClusterInfo, ColumnRow, DltPipeline, Job, KeyRow, LineageRow, NodeRow, RawExport, Run, StatementRow, TableRow } from '../src/ingest/databricks/raw'
import { fullName } from '../src/ingest/databricks/ucToDbml'
import { dayStart, yesterday } from '../src/ingest/databricks/time'

const run = promisify(execFile)

const { values: args } = parseArgs({
  options: {
    profile: { type: 'string' },
    catalogs: { type: 'string' },
    schemas: { type: 'string', default: '*' },
    day: { type: 'string' },
    tz: { type: 'string', default: Intl.DateTimeFormat().resolvedOptions().timeZone },
    'lineage-days': { type: 'string', default: '7' },
    warehouse: { type: 'string' },
    out: { type: 'string' },
    'from-raw': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

const USAGE = `Usage: pnpm export:databricks --profile <name> --catalogs a,b [--schemas 'x*,!*archive*'] [--day YYYY-MM-DD] [--tz Zone]
                          [--lineage-days 7] [--warehouse <id>] [--out file] [--from-raw raw.json]`

function fail(msg: string): never {
  console.error(`${msg}\n\n${USAGE}`)
  process.exit(1)
}

const log = (msg: string) => console.error(`· ${msg}`)

// ---- CLI and SQL ---------------------------------------------------------------------------------

const profile = args.profile ?? ''

async function cli<T>(...argv: string[]): Promise<T> {
  try {
    const { stdout } = await run('databricks', [...argv, '--profile', profile, '-o', 'json'], { maxBuffer: 1 << 30 })
    return JSON.parse(stdout) as T
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new Error(`databricks ${argv.join(' ')}: ${(err.stderr || err.message).trim()}`)
  }
}

async function api<T>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> {
  return cli<T>('api', method, path, ...(body ? ['--json', JSON.stringify(body)] : []))
}

interface Statement {
  statement_id: string
  status: { state: string; error?: { message?: string } }
  manifest?: { schema: { columns: { name: string }[] }; total_chunk_count?: number }
  result?: { data_array?: (string | null)[][] }
}

let warehouse = ''

/** Runs SQL on the warehouse and returns rows as objects (values as strings, as the API sends them). */
async function sql<T>(statement: string): Promise<T[]> {
  let s = await api<Statement>('post', '/api/2.0/sql/statements', {
    warehouse_id: warehouse, statement, wait_timeout: '50s', on_wait_timeout: 'CONTINUE', format: 'JSON_ARRAY', disposition: 'INLINE',
  })
  while (s.status.state === 'PENDING' || s.status.state === 'RUNNING') {
    await new Promise((r) => setTimeout(r, 2000))
    s = await api<Statement>('get', `/api/2.0/sql/statements/${s.statement_id}`)
  }
  if (s.status.state !== 'SUCCEEDED') throw new Error(`SQL ${s.status.state}: ${s.status.error?.message ?? ''}\n${statement}`)
  const cols = s.manifest!.schema.columns.map((c) => c.name)
  const rows = [...(s.result?.data_array ?? [])]
  for (let i = 1; i < (s.manifest!.total_chunk_count ?? 1); i++) {
    const chunk = await api<{ data_array?: (string | null)[][] }>('get', `/api/2.0/sql/statements/${s.statement_id}/result/chunks/${i}`)
    rows.push(...(chunk.data_array ?? []))
  }
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as T)
}

/** Runs `fn` over `items`, `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

// ---- Slice filters -------------------------------------------------------------------------------

const IDENT = /^[A-Za-z0-9_-]+$/
const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
/** A glob (`procore*`) as a LIKE pattern, `_` and `%` taken literally. */
const like = (glob: string) => lit(glob.replace(/[\\_%]/g, (c) => `\\${c}`).replace(/\*/g, '%'))

function sliceWhere(catalogs: string[], schemas: string[], cat: string, sch: string) {
  const inc = schemas.filter((s) => !s.startsWith('!'))
  const exc = schemas.filter((s) => s.startsWith('!')).map((s) => s.slice(1))
  return [
    `${cat} IN (${catalogs.map(lit).join(', ')})`,
    `${sch} <> 'information_schema'`,
    inc.length ? `(${inc.map((g) => `${sch} LIKE ${like(g)}`).join(' OR ')})` : 'TRUE',
    ...exc.map((g) => `${sch} NOT LIKE ${like(g)}`),
  ].join(' AND ')
}

// ---- Export --------------------------------------------------------------------------------------

async function fetchRaw(): Promise<RawExport> {
  if (!profile) fail('--profile is required (see `databricks auth profiles`); it is never picked for you.')
  const catalogs = (args.catalogs ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!catalogs.length) fail('--catalogs is required, e.g. --catalogs bronze,silver,gold')
  if (!catalogs.every((c) => IDENT.test(c))) fail(`Catalog names must match ${IDENT}`)
  const schemas = (args.schemas ?? '*').split(',').map((s) => s.trim()).filter(Boolean)
  const tz = args.tz!
  const day = args.day ?? yesterday(tz)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('--day must be YYYY-MM-DD')
  const lookback = Number(args['lineage-days']) || 7
  const warnings: string[] = []

  const env = await cli<{ env: Record<string, string> }>('auth', 'env')
  const host = env.env.DATABRICKS_HOST
  const me = await cli<{ userName: string }>('current-user', 'me')
  log(`${host} as ${me.userName}`)
  warehouse = args.warehouse ?? (await run('databricks', ['experimental', 'aitools', 'tools', 'get-default-warehouse', '--profile', profile])).stdout.trim()
  log(`warehouse ${warehouse}`)

  const where = sliceWhere(catalogs, schemas, 'table_catalog', 'table_schema')
  log('tables')
  let tables = await sql<TableRow>(`SELECT table_catalog, table_schema, table_name, table_type FROM system.information_schema.tables WHERE ${where}`)
  log(`  ${tables.length} tables in the slice`)

  log(`lineage, ${lookback} days to ${day}`)
  const edgeIn = (side: 'source' | 'target') => `(${sliceWhere(catalogs, schemas, `${side}_table_catalog`, `${side}_table_schema`)})`
  let lineage: LineageRow[] = []
  try {
    lineage = await sql<LineageRow>(`
      SELECT entity_type,
        entity_metadata.job_info.job_id AS job_id, entity_metadata.job_info.job_run_id AS job_run_id,
        entity_metadata.dlt_pipeline_info.dlt_pipeline_id AS dlt_pipeline_id,
        NULLIF(source_table_full_name, '') AS source_table,
        CASE WHEN NULLIF(source_table_full_name, '') IS NULL THEN NULLIF(source_path, '') END AS source_path,
        NULLIF(target_table_full_name, '') AS target_table,
        CASE WHEN NULLIF(target_table_full_name, '') IS NULL THEN NULLIF(target_path, '') END AS target_path,
        unix_millis(min(event_time)) AS first_ms, unix_millis(max(event_time)) AS last_ms
      FROM system.access.table_lineage
      WHERE event_date BETWEEN date_sub(DATE${lit(day)}, ${lookback}) AND date_add(DATE${lit(day)}, 1)
        AND entity_type IN ('JOB', 'PIPELINE')
        AND (${edgeIn('source')} OR ${edgeIn('target')})
      GROUP BY ALL`)
  } catch (e) {
    warnings.push(`Lineage unavailable (${(e as Error).message.split('\n')[0]}): tasks have no reads or writes`)
  }
  log(`  ${lineage.length} lineage edges`)

  // Tables one lineage hop away, in the exported catalogs, are drawn too; the rest become sources.
  const have = new Set(tables.map((t) => fullName(t.table_catalog, t.table_schema, t.table_name)))
  const near = [...new Set(lineage.flatMap((r) => [r.source_table, r.target_table]).filter((n): n is string => !!n && !have.has(n) && catalogs.includes(n.split('.')[0])))]
  for (let i = 0; i < near.length; i += 200) {
    const names = near.slice(i, i + 200).map(lit).join(', ')
    tables = tables.concat(await sql<TableRow>(`SELECT table_catalog, table_schema, table_name, table_type FROM system.information_schema.tables WHERE concat_ws('.', table_catalog, table_schema, table_name) IN (${names})`))
  }
  if (near.length) log(`  ${near.length} neighbouring tables`)
  const ids = tables.map((t) => fullName(t.table_catalog, t.table_schema, t.table_name))
  const inTables = (c: string, s: string, t: string) => {
    const chunks: string[] = []
    for (let i = 0; i < ids.length; i += 500) chunks.push(`concat_ws('.', ${c}, ${s}, ${t}) IN (${ids.slice(i, i + 500).map(lit).join(', ')})`)
    return chunks.length ? `(${chunks.join(' OR ')})` : 'FALSE'
  }

  log('columns and keys')
  const columns = await sql<ColumnRow>(`SELECT table_catalog, table_schema, table_name, column_name, data_type, ordinal_position FROM system.information_schema.columns WHERE ${where}${near.length ? ` OR ${inTables('table_catalog', 'table_schema', 'table_name')}` : ''}`)
  const keys = await sql<KeyRow>(`
    SELECT tc.constraint_name, tc.constraint_type, k.table_catalog, k.table_schema, k.table_name, k.column_name, k.ordinal_position,
      r.table_catalog AS ref_catalog, r.table_schema AS ref_schema, r.table_name AS ref_table, r.column_name AS ref_column
    FROM system.information_schema.table_constraints tc
    JOIN system.information_schema.key_column_usage k
      ON k.constraint_catalog = tc.constraint_catalog AND k.constraint_schema = tc.constraint_schema AND k.constraint_name = tc.constraint_name
    LEFT JOIN system.information_schema.referential_constraints rc
      ON rc.constraint_catalog = tc.constraint_catalog AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
    LEFT JOIN system.information_schema.key_column_usage r
      ON r.constraint_catalog = rc.unique_constraint_catalog AND r.constraint_schema = rc.unique_constraint_schema
      AND r.constraint_name = rc.unique_constraint_name AND r.ordinal_position = k.position_in_unique_constraint
    WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY') AND ${inTables('tc.table_catalog', 'tc.table_schema', 'tc.table_name')}`)
  log(`  ${columns.length} columns, ${keys.length} key columns`)

  log('jobs')
  const allJobs = await cli<Job[]>('jobs', 'list', '--expand-tasks')
  const dltIds = new Set(lineage.filter((r) => r.entity_type === 'PIPELINE' && r.dlt_pipeline_id).map((r) => r.dlt_pipeline_id!))
  const jobIds = new Set(lineage.filter((r) => r.entity_type === 'JOB' && r.job_id).map((r) => String(r.job_id)))
  const jobs = allJobs.filter((j) => jobIds.has(String(j.job_id)) || (j.settings.tasks ?? []).some((t) => t.pipeline_task && dltIds.has(t.pipeline_task.pipeline_id)))
  log(`  ${jobs.length} of ${allJobs.length} jobs touch the slice`)

  const t0 = dayStart(day, tz)
  log(`runs on ${day} (${tz})`)
  const runs = (await pool(jobs, 8, (j) => cli<Run[]>('jobs', 'list-runs', '--job-id', String(j.job_id), '--expand-tasks',
    // A day earlier too, for runs that started yesterday and were still going.
    '--start-time-from', String(t0 - 86_400_000), '--start-time-to', String(t0 + 86_400_000)).catch((e: Error) => {
    warnings.push(`Runs of job ${j.job_id}: ${e.message.split('\n')[0]}`)
    return [] as Run[]
  }))).flat()
  // Lineage from earlier runs is placed on tasks by those runs' timings.
  const seen = new Set(runs.map((r) => String(r.run_id)))
  const older = [...new Map(lineage.filter((r) => r.job_run_id && !seen.has(String(r.job_run_id))).map((r) => [String(r.job_id), String(r.job_run_id)])).values()]
  const context = (await pool(older, 8, (id) => cli<Run>('jobs', 'get-run', id).catch(() => null))).filter((r): r is Run => !!r)
  log(`  ${runs.length} runs, ${context.length} earlier runs for lineage`)

  const pipelineIds = [...new Set([...dltIds, ...jobs.flatMap((j) => (j.settings.tasks ?? []).flatMap((t) => (t.pipeline_task ? [t.pipeline_task.pipeline_id] : [])))])]
  const pipelines = (await pool(pipelineIds, 8, (id) => cli<DltPipeline>('pipelines', 'get', id).catch(() => null))).filter((p): p is DltPipeline => !!p)
  const clusterIds = [...new Set(jobs.flatMap((j) => (j.settings.tasks ?? []).flatMap((t) => (t.existing_cluster_id ? [t.existing_cluster_id] : []))))]
  const clusters = (await pool(clusterIds, 8, (id) => cli<ClusterInfo>('clusters', 'get', id).catch(() => null))).filter((c): c is ClusterInfo => !!c)
  const poolIds = [...new Set(jobs.flatMap((j) => (j.settings.job_clusters ?? []).map((c) => c.new_cluster.instance_pool_id)).concat(clusters.map((c) => c.instance_pool_id)).filter((p): p is string => !!p))]
  const pools = (await pool(poolIds, 8, (id) => cli<{ instance_pool_id: string; node_type_id: string }>('instance-pools', 'get', id).catch(() => null))).filter((p) => !!p)
  const nodeTypes = (await cli<{ node_types: { node_type_id: string; num_cores: number }[] }>('clusters', 'list-node-types')).node_types
    .map(({ node_type_id, num_cores }) => ({ node_type_id, num_cores }))
  log(`  ${pipelines.length} pipelines, ${clusters.length} shared clusters, ${pools.length} pools`)

  // Measured node use for the clusters the day's runs ran on (job clusters are new each run).
  const realClusters = [...new Set([...runs.flatMap((r) => (r.tasks ?? []).map((t) => t.cluster_instance?.cluster_id)), ...clusterIds])]
    .filter((id): id is string => !!id && /^[\w-]+$/.test(id))
  log(`node timeline for ${realClusters.length} clusters`)
  let nodeTimeline: NodeRow[] = []
  try {
    for (let i = 0; i < realClusters.length; i += 400)
      nodeTimeline = nodeTimeline.concat(await sql<NodeRow>(`
        SELECT cluster_id, unix_millis(date_trunc('MINUTE', start_time)) AS t_ms,
          count_if(NOT driver) AS workers, count_if(driver) AS drivers,
          avg(CASE WHEN NOT driver THEN cpu_user_percent + cpu_system_percent END) AS worker_cpu,
          avg(CASE WHEN driver THEN cpu_user_percent + cpu_system_percent END) AS driver_cpu
        FROM system.compute.node_timeline
        WHERE start_time >= timestamp_millis(${t0}) AND start_time < timestamp_millis(${t0 + 86_400_000})
          AND cluster_id IN (${realClusters.slice(i, i + 400).map(lit).join(', ')})
        GROUP BY ALL`))
  } catch (e) {
    warnings.push(`Node timeline unavailable (${(e as Error).message.split('\n')[0]}): utilization stays simulated`)
  }
  log(`  ${nodeTimeline.length} cluster-minutes`)

  // Statements the jobs' tasks ran on serverless or warehouse compute; classic clusters don't record them.
  log('statements from query history')
  let statements: StatementRow[] = []
  try {
    if (jobs.length)
      statements = await sql<StatementRow>(`
        SELECT query_source.job_info.job_task_run_id AS task_run_id, statement_id, statement_type, execution_status AS status,
          substring(statement_text, 1, 120) AS text,
          unix_millis(start_time) AS start_ms, unix_millis(end_time) AS end_ms,
          waiting_for_compute_duration_ms AS wait_ms, compilation_duration_ms AS compile_ms, execution_duration_ms AS exec_ms,
          total_task_duration_ms AS task_ms, read_bytes, written_bytes, shuffle_read_bytes AS shuffle_bytes,
          spilled_local_bytes AS spill_bytes, read_rows, written_rows
        FROM system.query.history
        WHERE start_time >= timestamp_millis(${t0 - 86_400_000}) AND start_time < timestamp_millis(${t0 + 86_400_000})
          AND query_source.job_info.job_id IN (${jobs.map((j) => lit(String(j.job_id))).join(', ')})
          AND query_source.job_info.job_task_run_id IS NOT NULL`)
  } catch (e) {
    warnings.push(`Query history unavailable (${(e as Error).message.split('\n')[0]}): Spark stays simulated`)
  }
  log(`  ${statements.length} statements`)

  return {
    host, exportedAt: new Date().toISOString(), day, tz, catalogs, tables, columns, keys, lineage, jobs,
    // Earlier runs only help place lineage; they fall outside the day and drop out of the timeline.
    runs: [...runs, ...context], pipelines, clusters, pools, nodeTypes, nodeTimeline, statements, warnings,
  }
}

async function main() {
  if (args.help) {
    console.log(USAGE)
    return
  }
  const raw: RawExport = args['from-raw'] ? JSON.parse(await readFile(args['from-raw'], 'utf8')) : await fetchRaw()
  const name = `${new URL(raw.host).hostname.split('.')[0]}-${raw.day}`
  if (!args['from-raw']) {
    const rawOut = `snapshots/.raw/${name}.raw.json`
    await mkdir(dirname(rawOut), { recursive: true })
    await writeFile(rawOut, JSON.stringify(raw))
    log(`raw payloads → ${rawOut}`)
  }
  const snap = buildSnapshot(raw, Date.parse(raw.exportedAt))
  const out = args.out ?? `snapshots/${name}.snapshot.json`
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(snap))
  const jobs = Object.keys((await import('yaml')).parse(snap.workflows).resources.jobs).length
  log(`${raw.tables.length} tables, ${jobs} pipelines, ${snap.runs.taskRuns.length} task runs → ${out}`)
  for (const w of snap.warnings) console.error(`  ! ${w}`)
}

main().catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})
