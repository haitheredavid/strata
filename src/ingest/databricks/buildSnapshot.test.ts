import { describe, expect, it } from 'vitest'
import { parseDbml } from '../../parse/dbml'
import { measured, sparkRunsOn, usageAt, utilization } from '../../sim/spark'
import { buildSnapshot } from './buildSnapshot'
import { endName, pipelineIds } from './jobsToWorkflows'
import type { RawExport } from './raw'
import { dayStart } from './time'
import { ucToDbml } from './ucToDbml'

// Synthetic workspace shaped like real API / system-table payloads (no real names).
const DAY = '2026-03-10'
const TZ = 'America/New_York'
const T0 = dayStart(DAY, TZ)
const at = (h: number, m = 0) => T0 + (h * 3600 + m * 60) * 1000

const col = (c: string, s: string, t: string, name: string, type: string, i: number) =>
  ({ table_catalog: c, table_schema: s, table_name: t, column_name: name, data_type: type, ordinal_position: i })
const table = (c: string, s: string, t: string, type = 'MANAGED') => ({ table_catalog: c, table_schema: s, table_name: t, table_type: type })

const raw: RawExport = {
  host: 'https://example.cloud.databricks.com',
  exportedAt: new Date(at(23)).toISOString(),
  day: DAY,
  tz: TZ,
  catalogs: ['bronze', 'silver', 'gold'],
  tables: [table('bronze', 'acme', 'orders'), table('silver', 'acme', 'orders'), table('gold', 'acme', 'daily_orders', 'MATERIALIZED_VIEW'), table('silver', 'acme', 'customers')],
  columns: [
    col('bronze', 'acme', 'orders', 'id', 'bigint', 1),
    col('bronze', 'acme', 'orders', 'payload', 'struct<a:string,b:array<struct<c:int,d:string,e:map<string,string>>>>', 2),
    col('silver', 'acme', 'orders', 'id', 'bigint', 1),
    col('silver', 'acme', 'orders', 'customer id', 'bigint', 2),
    col('silver', 'acme', 'customers', 'id', 'bigint', 1),
    col('gold', 'acme', 'daily_orders', 'day', 'date', 1),
  ],
  keys: [
    { constraint_name: 'pk_orders', constraint_type: 'PRIMARY KEY', table_catalog: 'silver', table_schema: 'acme', table_name: 'orders', column_name: 'id', ordinal_position: 1 },
    {
      constraint_name: 'fk_cust', constraint_type: 'FOREIGN KEY', table_catalog: 'silver', table_schema: 'acme', table_name: 'orders', column_name: 'customer id', ordinal_position: 1,
      ref_catalog: 'silver', ref_schema: 'acme', ref_table: 'customers', ref_column: 'id',
    },
  ],
  lineage: [
    // Run 100 of job 1: bronze task loads from S3, silver task cleans, gold task aggregates.
    { entity_type: 'JOB', job_id: '1', job_run_id: '100', source_path: 's3://landing/acme/orders/2026/03/10/part-0.json', target_table: 'bronze.acme.orders', first_ms: at(2, 6), last_ms: at(2, 9) },
    { entity_type: 'JOB', job_id: '1', job_run_id: '100', source_table: 'bronze.acme.orders', target_table: 'silver.acme.orders', first_ms: at(2, 14), last_ms: at(2, 20) },
    { entity_type: 'JOB', job_id: '1', job_run_id: '100', source_table: 'silver.acme.orders', target_table: 'gold.acme.daily_orders', first_ms: at(2, 26), last_ms: at(2, 27) },
    // A run from last week, outside the export: placed by layer name.
    { entity_type: 'JOB', job_id: '1', job_run_id: '42', source_table: 'silver.acme.customers', target_table: 'silver.acme.orders', first_ms: at(-100), last_ms: at(-100) },
    // A Lakeflow pipeline run by job 2.
    { entity_type: 'PIPELINE', dlt_pipeline_id: 'p-1', source_table: 'silver.acme.orders', target_table: 'gold.acme.daily_orders', first_ms: at(5), last_ms: at(5) },
    // A job we can't read.
    { entity_type: 'JOB', job_id: '999', job_run_id: '1', target_table: 'gold.acme.daily_orders', first_ms: at(3), last_ms: at(3) },
  ],
  jobs: [
    {
      job_id: 1,
      settings: {
        name: 'Acme Orders (prod)',
        schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: TZ, pause_status: 'UNPAUSED' },
        job_clusters: [{ job_cluster_key: 'etl', new_cluster: { instance_pool_id: 'pool-1', autoscale: { min_workers: 2, max_workers: 4 }, spark_version: '15.4.x-scala2.12' } }],
        tasks: [
          { task_key: 'orders__bronze', job_cluster_key: 'etl', notebook_task: { notebook_path: 'jobs/medallion/bronze/load' } },
          { task_key: 'orders__silver_refresh', depends_on: [{ task_key: 'orders__bronze' }], job_cluster_key: 'etl', notebook_task: { notebook_path: 'jobs/medallion/silver/silver' } },
          { task_key: 'gold__orders', depends_on: [{ task_key: 'orders__silver_refresh' }], existing_cluster_id: 'shared-1' },
          { task_key: 'kick_downstream', depends_on: [{ task_key: 'gold__orders' }], run_job_task: { job_id: 2 } },
        ],
      },
    },
    { job_id: 2, settings: { name: 'acme refresh', tasks: [{ task_key: 'refresh', pipeline_task: { pipeline_id: 'p-1' } }] } },
  ],
  runs: [
    {
      run_id: 100, job_id: 1, start_time: at(2), end_time: at(2, 30), trigger: 'PERIODIC', state: { result_state: 'SUCCESS' },
      tasks: [
        { task_key: 'orders__bronze', run_id: 101, start_time: at(2), end_time: at(2, 10), queue_duration: 0, setup_duration: 240_000, state: { result_state: 'SUCCESS' } },
        { task_key: 'orders__silver_refresh', run_id: 102, start_time: at(2, 10), end_time: at(2, 22), setup_duration: 5000, state: { result_state: 'SUCCESS' } },
        { task_key: 'gold__orders', run_id: 103, start_time: at(2, 22), end_time: at(2, 28), setup_duration: 1000, state: { result_state: 'SUCCESS' } },
        { task_key: 'kick_downstream', run_id: 104, start_time: at(2, 28), end_time: at(2, 30), state: { result_state: 'SUCCESS' } },
      ],
    },
    {
      // Started yesterday evening, failed after midnight, retried.
      run_id: 200, job_id: 1, start_time: at(-1), end_time: at(0, 40), trigger: 'PERIODIC', state: { result_state: 'FAILED' },
      tasks: [
        { task_key: 'orders__bronze', run_id: 201, start_time: at(-1), end_time: at(0, 20), setup_duration: 300_000, state: { result_state: 'FAILED' } },
        { task_key: 'orders__bronze', run_id: 202, start_time: at(0, 25), end_time: at(0, 40), attempt_number: 1, setup_duration: 60_000, state: { result_state: 'FAILED' } },
        { task_key: 'orders__silver_refresh', run_id: 203, state: { result_state: 'UPSTREAM_FAILED' } },
        { task_key: 'removed_task', run_id: 204, start_time: at(0, 1), end_time: at(0, 2), state: { result_state: 'SUCCESS' } },
      ],
    },
    { run_id: 300, job_id: 2, start_time: at(4, 59), end_time: 0, trigger: 'RUN_JOB_TASK', state: { life_cycle_state: 'RUNNING' }, tasks: [{ task_key: 'refresh', run_id: 301, start_time: at(4, 59), end_time: 0, state: { life_cycle_state: 'RUNNING' } }] },
  ],
  pipelines: [{ pipeline_id: 'p-1', name: 'acme_dlt', spec: { serverless: true } }],
  clusters: [{ cluster_id: 'shared-1', cluster_name: 'Shared analytics', node_type_id: 'r6id.xlarge', autoscale: { min_workers: 1, max_workers: 6 } }],
  pools: [{ instance_pool_id: 'pool-1', node_type_id: 'm6gd.2xlarge' }],
  nodeTypes: [{ node_type_id: 'm6gd.2xlarge', num_cores: 8 }, { node_type_id: 'r6id.xlarge', num_cores: 4 }],
  warnings: [],
}

const snap = buildSnapshot(raw, at(5, 30))
const graph = parseDbml(snap.dbml, snap.workflows)
const byTask = new Map(graph.workflows.pipelines.flatMap((p) => p.tasks.map((t) => [t.id, t])))

describe('ucToDbml', () => {
  it('keeps full UC names as ids, groups by schema, and reads the layer from the catalog', () => {
    expect(graph.tables.map((t) => t.id).sort()).toEqual(['bronze.acme.orders', 'gold.acme.daily_orders', 'silver.acme.customers', 'silver.acme.orders'])
    expect(graph.layers.map((l) => l.id)).toEqual(['acme'])
    expect(Object.fromEntries(graph.tables.map((t) => [t.id, t.medallion]))).toMatchObject({ 'bronze.acme.orders': 'bronze', 'gold.acme.daily_orders': 'gold' })
  })

  it('turns constraints into PKs and FK refs, and quotes odd names and long types', () => {
    const orders = graph.tables.find((t) => t.id === 'silver.acme.orders')!
    expect(orders.columns.find((c) => c.name === 'id')!.pk).toBe(true)
    expect(orders.columns.find((c) => c.name === 'customer id')!.fk).toBe(true)
    expect(graph.refs).toHaveLength(1)
    expect(graph.tables.find((t) => t.id === 'bronze.acme.orders')!.columns[1].type.length).toBeLessThanOrEqual(48)
    expect(graph.tables.find((t) => t.id === 'gold.acme.daily_orders')!.note).toMatch(/materialized view/)
  })

  it('warns when there are no foreign keys', () => {
    expect(ucToDbml(raw.tables, raw.columns, []).warnings[0]).toMatch(/No foreign keys/)
  })
})

describe('jobsToWorkflows', () => {
  it('scopes task ids to their job and keeps dependencies', () => {
    expect(pipelineIds(raw.jobs).get('1')).toBe('acme_orders_prod')
    expect(byTask.get('acme_orders_prod/orders__silver_refresh')!.dependsOn).toEqual(['acme_orders_prod/orders__bronze'])
  })

  it('places lineage on the task running when it was written', () => {
    expect(byTask.get('acme_orders_prod/orders__bronze')!.reads).toEqual(['source:s3://landing/acme/orders'])
    expect(byTask.get('acme_orders_prod/orders__bronze')!.writes).toEqual(['bronze.acme.orders'])
    expect(byTask.get('acme_orders_prod/gold__orders')!.writes).toEqual(['gold.acme.daily_orders'])
  })

  it('places lineage from runs outside the export by layer name', () => {
    expect(byTask.get('acme_orders_prod/orders__silver_refresh')!.reads).toContain('silver.acme.customers')
  })

  it('gives a pipeline task its Lakeflow pipeline lineage', () => {
    expect(byTask.get('acme_refresh/refresh')!.writes).toEqual(['gold.acme.daily_orders'])
  })

  it('names real compute: job clusters through their pool, shared clusters, serverless', () => {
    const c = new Map(graph.workflows.clusters.map((x) => [x.id, x]))
    expect(c.get('acme_orders_prod.etl')).toMatchObject({ kind: 'job', nodeType: 'm6gd.2xlarge', coresPerNode: 8, workers: { min: 2, max: 4 } })
    expect(c.get('shared-1')).toMatchObject({ kind: 'all_purpose', name: 'Shared analytics', coresPerNode: 4 })
    expect(byTask.get('acme_refresh/refresh')!.clusterId).toBe('serverless')
    expect(graph.workflows.clusters.some((x) => x.id.endsWith('_cluster'))).toBe(false) // none invented
  })

  it('maps triggers: job schedule, and run_job_task as "after"', () => {
    const p = new Map(graph.workflows.pipelines.map((x) => [x.id, x]))
    expect(p.get('acme_orders_prod')!.trigger).toEqual({ kind: 'schedule', cron: '0 0 2 * * ?' })
    expect(p.get('acme_refresh')!.trigger).toEqual({ kind: 'job', pipeline: 'acme_orders_prod' })
  })

  it('trims file paths to a location', () => {
    expect(endName(null, 's3://b/x/y/z/part-1.parquet')).toBe('s3://b/x/y')
    expect(endName(null, '/Volumes/c/s/v/f.csv')).toBe('/Volumes/c/s')
  })

  it('reports what it could not map', () => {
    expect(snap.warnings.join('\n')).toMatch(/1 job id\(s\) in lineage aren't saved jobs/)
    expect(snap.warnings.join('\n')).toMatch(/1 task run\(s\) are of tasks no longer in their job/)
  })

  it('leaves the parser nothing to complain about but tasks with no lineage', () => {
    expect(graph.workflows.warnings).toEqual(['Task "acme_orders_prod/kick_downstream" reads and writes nothing'])
  })
})

describe('runsToSchedule', () => {
  const runs = snap.runs

  it('converts to seconds since local midnight, with queue + setup at the head', () => {
    const bronze = runs.taskRuns.find((r) => r.id === 'acme_orders_prod#100/orders__bronze')!
    expect(bronze).toMatchObject({ start: 7200, end: 7800, setup: 240, clusterId: 'acme_orders_prod.etl', medallion: 'bronze', state: 'success' })
    expect(runs.origin).toBe('snapshot')
  })

  it('clips runs from the day before, keeps retries apart, and drops tasks that never started', () => {
    const r200 = runs.taskRuns.filter((r) => r.runId === 'acme_orders_prod#200')
    expect(r200.map((r) => r.id)).toEqual(['acme_orders_prod#200/orders__bronze', 'acme_orders_prod#200/orders__bronze~1'])
    expect(r200[0]).toMatchObject({ start: 0, setup: 0, state: 'failed' })
    expect(r200[1]).toMatchObject({ attempt: 1, setup: 60 })
    expect(runs.runs.find((r) => r.id === 'acme_orders_prod#200')).toMatchObject({ start: 0, state: 'failed' })
  })

  it('ends running runs at export time', () => {
    expect(runs.taskRuns.find((r) => r.pipelineId === 'acme_refresh')).toMatchObject({ end: 5.5 * 3600, state: 'running' })
  })

  it('emits write events for successful task runs only, under graph node ids', () => {
    const writes = runs.events.filter((e) => e.kind === 'write')
    expect(writes.map((e) => e.name)).toEqual(['bronze.acme.orders', 'silver.acme.orders', 'gold.acme.daily_orders'])
  })

  it('only names tasks and clusters that exist in the graph', () => {
    const clusters = new Set(graph.workflows.clusters.map((c) => c.id))
    for (const r of runs.taskRuns) {
      expect(byTask.has(r.taskId)).toBe(true)
      expect(clusters.has(r.clusterId)).toBe(true)
    }
  })
})

describe('dayStart', () => {
  it('finds local midnight across DST', () => {
    expect(new Date(dayStart('2026-03-08', 'America/New_York')).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(new Date(dayStart('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(new Date(dayStart('2026-07-01', 'UTC')).toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('statements', () => {
  const withStatements: RawExport = {
    ...raw,
    statements: [
      {
        task_run_id: '102', statement_id: 's2', statement_type: 'merge', status: 'FINISHED', text: 'MERGE INTO silver.acme.orders\n  USING …',
        start_ms: at(2, 12), end_ms: at(2, 20), wait_ms: 30_000, compile_ms: 2_000, exec_ms: 400_000, task_ms: 3_200_000,
        read_bytes: 5e8, written_bytes: 2e8, shuffle_bytes: 1e8, spill_bytes: 0, read_rows: 1_000_000, written_rows: 400_000,
      },
      { task_run_id: '102', statement_id: 's1', statement_type: 'SELECT', start_ms: at(2, 11), end_ms: at(2, 12), exec_ms: 50_000, task_ms: 100_000 },
      { task_run_id: '999999', statement_id: 'other', start_ms: at(3), end_ms: at(3, 1) }, // not a task run in the day
    ],
  }
  const s = buildSnapshot(withStatements, at(5, 30)).runs
  const runId = 'acme_orders_prod#100/orders__silver_refresh'

  it('attaches statements to their task run by the Jobs API task run id, ordered', () => {
    expect(Object.keys(s.statements!)).toEqual([runId])
    const [first, second] = s.statements![runId]
    expect(first.id).toBe('s1')
    expect(second).toMatchObject({
      type: 'MERGE', text: 'MERGE INTO silver.acme.orders USING …', start: 2 * 3600 + 720, waiting: 30, compiling: 2, executing: 400,
      taskTime: 3200, readMB: 500, writtenMB: 200, shuffleMB: 100, spillMB: 0, writtenRows: 400_000,
    })
  })

  it('replaces simulated Spark jobs in the flame chart and drives utilization', () => {
    const cluster = graph.workflows.clusters.find((c) => c.id === 'acme_orders_prod.etl')!
    const tasks = new Map(graph.workflows.pipelines.flatMap((p) => p.tasks.map((t) => [t.id, t])))
    const runs = sparkRunsOn(s, tasks, cluster, [2 * 3600 + 300, 2 * 3600 + 1320])
    const silver = runs.find((r) => r.run.id === runId)!
    expect(silver.jobs).toEqual([])
    expect(silver.statements).toHaveLength(2)
    expect(runs.find((r) => r.run.id !== runId)!.statements).toBeUndefined() // others stay simulated
    // 3200 s of task time over 400 s executing: 8 tasks in parallel, on 2 workers × 8 cores.
    const [u] = utilization(s, tasks, cluster, [2 * 3600 + 900, 2 * 3600 + 901], 1)
    expect(u.busy).toBeCloseTo(8 / 16)
  })
})

describe('node usage', () => {
  // Two runs of job 1 on fresh job clusters, one minute overlapping; plus a minute outside the day.
  const withUsage: RawExport = {
    ...raw,
    runs: raw.runs
      .map((r) => (r.run_id !== 100 ? r : {
        ...r,
        tasks: r.tasks!.map((t) => (t.task_key === 'orders__bronze' ? { ...t, cluster_instance: { cluster_id: 'c-run100' } } : t)),
      }))
      .concat([{
        run_id: 105, job_id: 1, start_time: at(2, 5), end_time: at(2, 20), state: { result_state: 'SUCCESS' },
        tasks: [{ task_key: 'orders__bronze', run_id: 1051, start_time: at(2, 5), end_time: at(2, 20), cluster_instance: { cluster_id: 'c-run105' }, state: { result_state: 'SUCCESS' } }],
      }]),
    nodeTimeline: [
      { cluster_id: 'c-run100', t_ms: at(2, 5), workers: 2, drivers: 1, worker_cpu: 80, driver_cpu: 10 },
      { cluster_id: 'c-run105', t_ms: at(2, 5), workers: 4, drivers: 1, worker_cpu: 20, driver_cpu: 10 },
      { cluster_id: 'c-run100', t_ms: at(2, 6), workers: 0, drivers: 1, worker_cpu: null, driver_cpu: 50 },
      { cluster_id: 'c-run100', t_ms: at(-2), workers: 2, drivers: 1, worker_cpu: 90, driver_cpu: 10 },
      { cluster_id: 'unknown', t_ms: at(2, 5), workers: 9, drivers: 1, worker_cpu: 90, driver_cpu: 10 },
    ],
  }
  const s = buildSnapshot(withUsage, at(5, 30)).runs
  const cluster = graph.workflows.clusters.find((c) => c.id === 'acme_orders_prod.etl')!

  it("folds each run's job cluster into the strata cluster, adding concurrent workers", () => {
    expect(Object.keys(s.usage!)).toEqual(['acme_orders_prod.etl'])
    const xs = s.usage!['acme_orders_prod.etl']
    expect(xs).toHaveLength(2) // yesterday's minute and the unknown cluster are dropped
    expect(xs[0]).toMatchObject({ t: 2 * 3600 + 300, workers: 6 })
    expect(xs[0].busy).toBeCloseTo((0.8 * 2 + 0.2 * 4) / 6) // weighted by workers
    expect(xs[1]).toMatchObject({ workers: 0, busy: 0.5 }) // single node: the driver's CPU
  })

  it('feeds utilization and the racks instead of the simulation', () => {
    expect(measured(s, cluster.id)).toBe(true)
    expect(measured(snap.runs, cluster.id)).toBe(false)
    expect(usageAt(s, cluster.id, 2 * 3600 + 330)!.workers).toBe(6)
    expect(usageAt(s, cluster.id, 3 * 3600)).toBeUndefined()
    const u = utilization(s, new Map(), cluster, [2 * 3600, 3 * 3600], 60)
    expect(u.filter((x) => x.up)).toHaveLength(2)
    expect(u[5]).toMatchObject({ up: true, workers: 6 })
  })
})
