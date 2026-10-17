/**
 * Exports a slice of a Databricks workspace as a strata snapshot: Unity Catalog tables, the jobs whose
 * lineage touches them, and one day of their runs. Read-only; uses the `databricks` CLI's auth.
 *
 *   pnpm export:databricks --profile prod --catalogs bronze,silver,gold,platinum --schemas 'procore*,!*archive*' --day 2026-10-12
 *
 * Writes `snapshots/<host>-<day>.snapshot.json` (gitignored: it holds real workspace metadata), plus the
 * raw payloads under `snapshots/.raw/` so `--from-raw <file>` can redo the mapping without the network.
 * Each step's payload is saved as it lands (`.partial.json`); after a failure, `--resume` picks up there.
 */
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { buildSnapshot } from '../src/ingest/databricks/buildSnapshot'
import type { ClusterInfo, ColumnRow, DltPipeline, Job, KeyRow, LineageRow, NodeRow, RawExport, Run, StatementRow, TableRow } from '../src/ingest/databricks/raw'
import { inLists, lit, sliceWhere } from '../src/ingest/databricks/sql'
import { addDays, dayStart } from '../src/ingest/databricks/time'
import { fullName } from '../src/ingest/databricks/ucToDbml'
import { ArgError, USAGE, parseExportArgs } from './exportArgs'
import type { ExportOptions, ParsedArgs } from './exportArgs'
import { withRetry } from './retry'

const run = promisify(execFile)
const log = (msg: string) => console.error(`· ${msg}`)
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fail(msg: string): never {
  console.error(`${msg}\n\n${USAGE}`)
  process.exit(1)
}

// ---- CLI and SQL ---------------------------------------------------------------------------------

let profile = ''
let warehouse = ''
let sqlTimeoutMs = 15 * 60_000
/** Statements running now, cancelled on Ctrl-C. */
const running = new Set<string>()

const ATTEMPTS = 5
const retrying = (what: string) => (e: Error, n: number, ms: number) =>
  log(`  ${what}: ${firstLine(e)}; retry ${n}/${ATTEMPTS - 1} in ${Math.round(ms / 1000)}s`)

/** Runs a `databricks` CLI command as JSON, retrying rate limits and server errors. */
async function cli<T>(...argv: string[]): Promise<T> {
  const what = `databricks ${argv.slice(0, 3).join(' ')}`
  return withRetry(
    async () => {
      try {
        const { stdout } = await run('databricks', [...argv, '--profile', profile, '-o', 'json'], { maxBuffer: 1 << 30 })
        return JSON.parse(stdout) as T
      } catch (e) {
        const stderr = e && typeof e === 'object' && 'stderr' in e && typeof e.stderr === 'string' ? e.stderr : ''
        throw new Error(`databricks ${argv.join(' ')}: ${(stderr || firstLine(e)).trim()}`)
      }
    },
    { attempts: ATTEMPTS, onRetry: retrying(what) },
  )
}

const api = <T>(method: 'get' | 'post', path: string, body?: unknown) => cli<T>('api', method, path, ...(body ? ['--json', JSON.stringify(body)] : []))

interface ExternalLink {
  chunk_index: number
  external_link: string
}

interface Statement {
  statement_id: string
  status: { state: string; error?: { message?: string } }
  manifest?: { schema: { columns: { name: string }[] }; total_chunk_count?: number; truncated?: boolean }
  result?: { external_links?: ExternalLink[] }
}

const cancel = (id: string) => api('post', `/api/2.0/sql/statements/${id}/cancel`).catch(() => undefined)

/**
 * Runs SQL on the warehouse and returns rows as objects (values as strings, as the API sends them).
 * Submitted without waiting, so the statement can be cancelled from the start (Ctrl-C, or still running
 * after `--sql-timeout` minutes). Results come as external links, so no size limit applies.
 */
async function sql<T>(statement: string): Promise<T[]> {
  const deadline = Date.now() + sqlTimeoutMs
  let s = await api<Statement>('post', '/api/2.0/sql/statements', {
    warehouse_id: warehouse, statement, wait_timeout: '0s', format: 'JSON_ARRAY', disposition: 'EXTERNAL_LINKS',
  })
  running.add(s.statement_id)
  try {
    // Poll quickly at first (most metadata queries take a second or two), then every 2 s.
    for (let poll = 250; s.status.state === 'PENDING' || s.status.state === 'RUNNING'; poll = Math.min(2000, poll * 2)) {
      if (Date.now() > deadline) {
        await cancel(s.statement_id)
        throw new Error(`SQL still running after ${sqlTimeoutMs / 60_000} min, cancelled (raise --sql-timeout):\n${statement.trim()}`)
      }
      await sleep(poll)
      s = await api<Statement>('get', `/api/2.0/sql/statements/${s.statement_id}`)
    }
  } finally {
    running.delete(s.statement_id)
  }
  if (s.status.state !== 'SUCCEEDED') throw new Error(`SQL ${s.status.state}: ${s.status.error?.message ?? ''}\n${statement.trim()}`)
  const cols = s.manifest!.schema.columns.map((c) => c.name)
  const rows: (string | null)[][] = []
  for (let i = 0; i < (s.manifest!.total_chunk_count ?? 0); i++) {
    const links = i === 0 && s.result?.external_links
      ? s.result.external_links
      : (await api<{ external_links?: ExternalLink[] }>('get', `/api/2.0/sql/statements/${s.statement_id}/result/chunks/${i}`)).external_links ?? []
    for (const link of links) {
      // Pre-signed cloud storage URLs: fetched without the workspace's credentials.
      const part = await withRetry(
        async () => {
          const r = await fetch(link.external_link)
          if (!r.ok) throw new Error(`result chunk ${link.chunk_index}: HTTP ${r.status}`)
          return (await r.json()) as (string | null)[][]
        },
        { attempts: ATTEMPTS, onRetry: retrying(`result chunk ${link.chunk_index}`) },
      )
      rows.push(...part)
    }
  }
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as T)
}

/** Runs one statement per chunk of `ids` (each `pred` an `… IN (…)`) and concatenates the rows. */
async function sqlEach<T>(preds: string[], statement: (pred: string) => string): Promise<T[]> {
  const out: T[] = []
  for (const p of preds) out.push(...(await sql<T>(statement(p))))
  return out
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

const NOT_FOUND = /does not exist|not found|RESOURCE_DOES_NOT_EXIST/i

/**
 * A step that fetches each id with `get`. A failure is a warning, not the end of the export: ids that
 * no longer exist share one warning (with `consequence`), other failures get one each.
 */
const each = <T>(what: string, ids: string[], get: (id: string) => Promise<T>, consequence: string) => async (warn: (w: string) => void) => {
  const gone: string[] = []
  const got = await pool(ids, 8, (id) =>
    get(id).catch((e) => {
      if (NOT_FOUND.test(firstLine(e))) gone.push(id)
      else warn(`The ${what} ${id} couldn't be fetched: ${firstLine(e)}`)
      return null
    }))
  if (gone.length) warn(`${gone.length} ${what}(s) no longer exist (${gone.slice(0, 3).join(', ')}${gone.length > 3 ? ', …' : ''}): ${consequence}`)
  return got.filter((x): x is Awaited<T> => !!x)
}

interface Warehouse {
  id: string
  name: string
  state?: string
  enable_serverless_compute?: boolean
}

/** `--warehouse`, else a running warehouse, else a serverless one, else the first listed. */
async function pickWarehouse(chosen: string | undefined): Promise<string> {
  if (chosen) return chosen
  const res = await cli<Warehouse[] | { warehouses?: Warehouse[] }>('warehouses', 'list')
  const list = Array.isArray(res) ? res : res.warehouses ?? []
  const pick = list.find((w) => w.state === 'RUNNING') ?? list.find((w) => w.enable_serverless_compute) ?? list[0]
  if (!pick) fail('No SQL warehouse is visible to this profile; pass --warehouse <id>')
  log(`warehouse ${pick.name} (${pick.id}, ${pick.state ?? 'state unknown'}); pass --warehouse to choose another`)
  return pick.id
}

// ---- Steps ---------------------------------------------------------------------------------------

interface PartialExport {
  /** The options the steps were fetched with; --resume only reuses steps fetched for the same slice. */
  slice: string
  steps: Record<string, { value: unknown; warnings: string[] }>
}

/**
 * Fetch steps whose results are written to `file` as each lands, so a failed run can resume.
 * A step's warnings (soft failures) are kept with it.
 */
class Steps {
  readonly warnings: string[] = []
  private readonly file: string
  private readonly data: PartialExport
  constructor(file: string, data: PartialExport) {
    this.file = file
    this.data = data
  }

  async step<T>(name: string, fn: (warn: (w: string) => void) => Promise<T>): Promise<T> {
    const saved = this.data.steps[name]
    if (saved) {
      log(`${name}: from the earlier run`)
      this.warnings.push(...saved.warnings)
      // Written by this script for the same slice (checked on load).
      return saved.value as T
    }
    const warnings: string[] = []
    const value = await fn((w) => warnings.push(w))
    this.data.steps[name] = { value, warnings }
    this.warnings.push(...warnings)
    await writeFile(this.file, JSON.stringify(this.data))
    return value
  }
}

const exists = (f: string) => access(f).then(() => true, () => false)

async function openSteps(file: string, slice: string, resume: boolean): Promise<Steps> {
  await mkdir(dirname(file), { recursive: true })
  if (resume) {
    if (!(await exists(file))) fail(`--resume: no partial export at ${file}`)
    const data = JSON.parse(await readFile(file, 'utf8')) as PartialExport
    if (data.slice !== slice) fail(`--resume: ${file} was fetched with different options; rerun without --resume`)
    log(`resuming ${Object.keys(data.steps).length} saved steps from ${file}`)
    return new Steps(file, data)
  }
  if (await exists(file)) log(`replacing the partial export at ${file} (--resume would have reused it)`)
  return new Steps(file, { slice, steps: {} })
}

// ---- Export --------------------------------------------------------------------------------------

const fileName = (host: string, day: string) => `${new URL(host).hostname.split('.')[0]}-${day}`
const partialFile = (name: string) => `snapshots/.raw/${name}.partial.json`

async function fetchRaw(o: ExportOptions): Promise<RawExport> {
  profile = o.profile
  sqlTimeoutMs = o.sqlTimeoutMin * 60_000
  const { catalogs, schemas, day, tz } = o

  const host = (await cli<{ env: Record<string, string> }>('auth', 'env')).env.DATABRICKS_HOST
  const me = await cli<{ userName: string }>('current-user', 'me')
  log(`${host} as ${me.userName}`)
  const name = fileName(host, day)
  const steps = await openSteps(partialFile(name), JSON.stringify({ host, catalogs, schemas, day, tz, lineageDays: o.lineageDays }), o.resume)
  const step = steps.step.bind(steps)
  warehouse = await pickWarehouse(o.warehouse)

  const where = sliceWhere(catalogs, schemas, 'table_catalog', 'table_schema')
  const sliceTables = await step('tables', () =>
    sql<TableRow>(`SELECT table_catalog, table_schema, table_name, table_type FROM system.information_schema.tables WHERE ${where}`))
  log(`tables: ${sliceTables.length} in the slice`)

  const edgeIn = (side: 'source' | 'target') => `(${sliceWhere(catalogs, schemas, `${side}_table_catalog`, `${side}_table_schema`)})`
  const lineage = await step('lineage', async (warn) => {
    try {
      return await sql<LineageRow>(`
        SELECT entity_type,
          entity_metadata.job_info.job_id AS job_id, entity_metadata.job_info.job_run_id AS job_run_id,
          entity_metadata.dlt_pipeline_info.dlt_pipeline_id AS dlt_pipeline_id,
          NULLIF(source_table_full_name, '') AS source_table,
          CASE WHEN NULLIF(source_table_full_name, '') IS NULL THEN NULLIF(source_path, '') END AS source_path,
          NULLIF(target_table_full_name, '') AS target_table,
          CASE WHEN NULLIF(target_table_full_name, '') IS NULL THEN NULLIF(target_path, '') END AS target_path,
          unix_millis(min(event_time)) AS first_ms, unix_millis(max(event_time)) AS last_ms
        FROM system.access.table_lineage
        WHERE event_date BETWEEN date_sub(DATE${lit(day)}, ${o.lineageDays}) AND date_add(DATE${lit(day)}, 1)
          AND entity_type IN ('JOB', 'PIPELINE')
          AND (${edgeIn('source')} OR ${edgeIn('target')})
        GROUP BY ALL`)
    } catch (e) {
      warn(`Lineage unavailable (${firstLine(e)}): tasks have no reads or writes`)
      return []
    }
  })
  log(`lineage: ${lineage.length} edges over ${o.lineageDays} days to ${day}`)

  // Tables one lineage hop away, in the exported catalogs, are drawn too; the rest become sources.
  const have = new Set(sliceTables.map((t) => fullName(t.table_catalog, t.table_schema, t.table_name)))
  const near = [...new Set(lineage.flatMap((r) => [r.source_table, r.target_table]).filter((n): n is string => !!n && !have.has(n) && catalogs.includes(n.split('.')[0])))]
  const fullNameOf = (c: string, s: string, t: string) => `concat_ws('.', ${c}, ${s}, ${t})`
  const neighbours = await step('neighbours', () =>
    sqlEach<TableRow>(inLists(fullNameOf('table_catalog', 'table_schema', 'table_name'), near, 200), (p) =>
      `SELECT table_catalog, table_schema, table_name, table_type FROM system.information_schema.tables WHERE ${p}`))
  if (near.length) log(`neighbours: ${neighbours.length} tables one lineage hop out`)
  const tables = [...sliceTables, ...neighbours]
  const ids = tables.map((t) => fullName(t.table_catalog, t.table_schema, t.table_name))

  const columns = await step('columns', async () => {
    const cols = `SELECT table_catalog, table_schema, table_name, column_name, data_type, ordinal_position FROM system.information_schema.columns`
    const inSlice = await sql<ColumnRow>(`${cols} WHERE ${where}`)
    const nearCols = await sqlEach<ColumnRow>(inLists(fullNameOf('table_catalog', 'table_schema', 'table_name'), near, 500), (p) => `${cols} WHERE ${p}`)
    return [...inSlice, ...nearCols]
  })
  const keys = await step('keys', () =>
    sqlEach<KeyRow>(inLists(fullNameOf('tc.table_catalog', 'tc.table_schema', 'tc.table_name'), ids, 500), (p) => `
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
      WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY') AND ${p}`))
  log(`columns: ${columns.length}, key columns: ${keys.length}`)

  const allJobs = await step('jobs', () => cli<Job[]>('jobs', 'list', '--expand-tasks'))
  const dltIds = new Set(lineage.filter((r) => r.entity_type === 'PIPELINE' && r.dlt_pipeline_id).map((r) => r.dlt_pipeline_id!))
  const jobIds = new Set(lineage.filter((r) => r.entity_type === 'JOB' && r.job_id).map((r) => String(r.job_id)))
  const jobs = allJobs.filter((j) => jobIds.has(String(j.job_id)) || (j.settings.tasks ?? []).some((t) => t.pipeline_task && dltIds.has(t.pipeline_task.pipeline_id)))
  log(`jobs: ${jobs.length} of ${allJobs.length} touch the slice`)

  // Local midnights, so a day across a DST change is 23 or 25 hours; runs from the day before count too
  // (they may still be going).
  const [before, t0, t1] = [-1, 0, 1].map((n) => dayStart(addDays(day, n), tz))
  const runs = await step('runs', async (warn) =>
    (await pool(jobs, 8, (j) =>
      cli<Run[]>('jobs', 'list-runs', '--job-id', String(j.job_id), '--expand-tasks',
        '--start-time-from', String(before), '--start-time-to', String(t1)).catch((e) => {
        warn(`Runs of job ${j.job_id} (${j.settings.name}) unavailable: ${firstLine(e)}`)
        return [] as Run[]
      }))).flat())
  // Lineage from earlier runs is placed on tasks by those runs' timings: one earlier run per exported
  // job (lineage of jobs that aren't saved jobs is dropped anyway, so their runs aren't fetched).
  const seen = new Set(runs.map((r) => String(r.run_id)))
  const exported = new Set(jobs.map((j) => String(j.job_id)))
  const older = [...new Map(lineage.filter((r) => r.job_run_id && exported.has(String(r.job_id)) && !seen.has(String(r.job_run_id))).map((r) => [String(r.job_id), String(r.job_run_id)])).values()]
  const context = await step('earlierRuns', each('earlier run', older, (id) => cli<Run>('jobs', 'get-run', id), 'their lineage goes to the last task of their job'))
  log(`runs: ${runs.length} on ${day} (${tz}), ${context.length} earlier runs for lineage`)

  const pipelineIds = [...new Set([...dltIds, ...jobs.flatMap((j) => (j.settings.tasks ?? []).flatMap((t) => (t.pipeline_task ? [t.pipeline_task.pipeline_id] : [])))])]
  const pipelines = await step('pipelines', each('pipeline', pipelineIds, (id) => cli<DltPipeline>('pipelines', 'get', id), 'their lineage is left out'))
  const clusterIds = [...new Set(jobs.flatMap((j) => (j.settings.tasks ?? []).flatMap((t) => (t.existing_cluster_id ? [t.existing_cluster_id] : []))))]
  const clusters = await step('clusters', each('cluster', clusterIds, (id) => cli<ClusterInfo>('clusters', 'get', id), 'their size and node type are unknown'))
  const poolIds = [...new Set(jobs.flatMap((j) => (j.settings.job_clusters ?? []).map((c) => c.new_cluster.instance_pool_id)).concat(clusters.map((c) => c.instance_pool_id)).filter((p): p is string => !!p))]
  const pools = await step('pools', each('instance pool', poolIds, (id) => cli<{ instance_pool_id: string; node_type_id: string }>('instance-pools', 'get', id), 'their node type is unknown'))
  const nodeTypes = await step('nodeTypes', async () =>
    (await cli<{ node_types: { node_type_id: string; num_cores: number }[] }>('clusters', 'list-node-types')).node_types.map(({ node_type_id, num_cores }) => ({ node_type_id, num_cores })))
  log(`compute: ${pipelines.length} pipelines, ${clusters.length} shared clusters, ${pools.length} pools`)

  // Measured node use for the clusters the day's runs ran on (job clusters are new each run).
  const realClusters = [...new Set([...runs.flatMap((r) => (r.tasks ?? []).map((t) => t.cluster_instance?.cluster_id)), ...clusterIds])]
    .filter((id): id is string => !!id && /^[\w-]+$/.test(id))
  const nodeTimeline = await step('nodeTimeline', async (warn) => {
    try {
      return await sqlEach<NodeRow>(inLists('cluster_id', realClusters, 400), (p) => `
        SELECT cluster_id, unix_millis(date_trunc('MINUTE', start_time)) AS t_ms,
          count_if(NOT driver) AS workers, count_if(driver) AS drivers,
          avg(CASE WHEN NOT driver THEN cpu_user_percent + cpu_system_percent END) AS worker_cpu,
          avg(CASE WHEN driver THEN cpu_user_percent + cpu_system_percent END) AS driver_cpu
        FROM system.compute.node_timeline
        WHERE start_time >= timestamp_millis(${t0}) AND start_time < timestamp_millis(${t1}) AND ${p}
        GROUP BY ALL`)
    } catch (e) {
      warn(`Node timeline unavailable (${firstLine(e)}): utilization stays simulated`)
      return []
    }
  })
  log(`node timeline: ${nodeTimeline.length} cluster-minutes for ${realClusters.length} clusters`)

  // Statements the jobs' tasks ran on serverless or warehouse compute; classic clusters don't record them.
  const statements = await step('statements', async (warn) => {
    try {
      return await sqlEach<StatementRow>(inLists('query_source.job_info.job_id', jobs.map((j) => String(j.job_id)), 200), (p) => `
        SELECT query_source.job_info.job_task_run_id AS task_run_id, statement_id, statement_type, execution_status AS status,
          substring(statement_text, 1, 120) AS text,
          unix_millis(start_time) AS start_ms, unix_millis(end_time) AS end_ms,
          waiting_for_compute_duration_ms AS wait_ms, compilation_duration_ms AS compile_ms, execution_duration_ms AS exec_ms,
          total_task_duration_ms AS task_ms, read_bytes, written_bytes, shuffle_read_bytes AS shuffle_bytes,
          spilled_local_bytes AS spill_bytes, read_rows, written_rows
        FROM system.query.history
        WHERE start_time >= timestamp_millis(${before}) AND start_time < timestamp_millis(${t1})
          AND ${p} AND query_source.job_info.job_task_run_id IS NOT NULL`)
    } catch (e) {
      warn(`Query history unavailable (${firstLine(e)}): Spark stays simulated`)
      return []
    }
  })
  log(`statements: ${statements.length}`)

  return {
    host, exportedAt: new Date().toISOString(), day, tz, catalogs, tables, columns, keys, lineage, jobs,
    // Earlier runs only help place lineage; they fall outside the day and drop out of the timeline.
    runs: [...runs, ...context], pipelines, clusters, pools, nodeTypes, nodeTimeline, statements, warnings: steps.warnings,
  }
}

function args(): ParsedArgs {
  try {
    return parseExportArgs(process.argv.slice(2))
  } catch (e) {
    if (e instanceof ArgError) fail(e.message)
    throw e
  }
}

async function main() {
  const a = args()
  if (a.kind === 'help') return console.log(USAGE)

  // Ctrl-C: cancel the statements still running on the warehouse before leaving. The CLI calls in
  // flight get the signal too and fail; `stopping` keeps that failure from exiting first.
  process.once('SIGINT', () => {
    log(`interrupted${running.size ? `, cancelling ${running.size} running statement(s)` : ''}`)
    stopping = Promise.allSettled([...running].map(cancel)).then(() => {
      console.error('Steps fetched so far are saved; rerun with --resume to continue from them.')
      process.exit(130)
    })
  })

  let raw: RawExport
  if (a.kind === 'fromRaw') {
    if (a.ignored.length) log(`ignored with --from-raw: ${a.ignored.join(' ')}`)
    raw = JSON.parse(await readFile(a.file, 'utf8')) as RawExport
  } else {
    raw = await fetchRaw(a.options)
    const name = fileName(raw.host, raw.day)
    const rawOut = `snapshots/.raw/${name}.raw.json`
    await writeFile(rawOut, JSON.stringify(raw))
    await rm(partialFile(name), { force: true })
    log(`raw payloads → ${rawOut}`)
  }
  const snap = buildSnapshot(raw, Date.parse(raw.exportedAt))
  const out = (a.kind === 'fromRaw' ? a.out : a.options.out) ?? `snapshots/${fileName(raw.host, raw.day)}.snapshot.json`
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(snap))
  const jobs = Object.keys(parseYaml(snap.workflows).resources?.jobs ?? {}).length
  log(`${raw.tables.length} tables, ${jobs} pipelines, ${snap.runs.taskRuns.length} task runs → ${out}`)
  if (snap.warnings.length) console.error(`${snap.warnings.length} warning(s):`)
  for (const w of snap.warnings) console.error(`  ! ${w}`)
}

let stopping: Promise<void> | null = null

main().catch((e: unknown) => {
  if (stopping) return stopping
  console.error(e instanceof Error ? e.message : String(e))
  if (!process.argv.includes('--from-raw')) console.error('Steps fetched so far are saved; rerun with --resume to continue from them.')
  process.exit(1)
})
