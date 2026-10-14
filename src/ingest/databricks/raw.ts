/**
 * What the exporter fetches from a workspace, kept close to the API / system-table shapes so the
 * mapping from it (`buildSnapshot`) is pure and testable. Only the fields strata reads are typed.
 */

/** `system.information_schema.columns` row. */
export interface ColumnRow {
  table_catalog: string
  table_schema: string
  table_name: string
  column_name: string
  data_type: string
  ordinal_position: number | string
}

/** `system.information_schema.tables` row. */
export interface TableRow {
  table_catalog: string
  table_schema: string
  table_name: string
  table_type: string
  comment?: string | null
}

/** A PK or FK column, from `table_constraints` joined with `key_column_usage` (and, for FKs, the referenced column). */
export interface KeyRow {
  constraint_name: string
  constraint_type: 'PRIMARY KEY' | 'FOREIGN KEY'
  table_catalog: string
  table_schema: string
  table_name: string
  column_name: string
  ordinal_position: number | string
  ref_catalog?: string | null
  ref_schema?: string | null
  ref_table?: string | null
  ref_column?: string | null
}

/** `system.access.table_lineage`, grouped by entity run and edge. Times are epoch ms. */
export interface LineageRow {
  entity_type: string // JOB | PIPELINE | NOTEBOOK | …
  job_id?: string | null
  job_run_id?: string | null
  dlt_pipeline_id?: string | null
  source_table?: string | null
  source_path?: string | null
  target_table?: string | null
  target_path?: string | null
  first_ms: number | string
  last_ms: number | string
}

export interface NewCluster {
  node_type_id?: string
  instance_pool_id?: string
  num_workers?: number
  autoscale?: { min_workers?: number; max_workers?: number }
  spark_version?: string
}

export interface JobTask {
  task_key: string
  depends_on?: { task_key: string }[]
  job_cluster_key?: string
  existing_cluster_id?: string
  environment_key?: string
  new_cluster?: NewCluster
  notebook_task?: { notebook_path?: string }
  spark_python_task?: { python_file?: string }
  python_wheel_task?: { package_name?: string; entry_point?: string }
  sql_task?: unknown
  dbt_task?: unknown
  pipeline_task?: { pipeline_id: string }
  run_job_task?: { job_id: number | string }
  condition_task?: unknown
  for_each_task?: unknown
}

export interface Job {
  job_id: number | string
  settings: {
    name?: string
    tasks?: JobTask[]
    job_clusters?: { job_cluster_key: string; new_cluster: NewCluster }[]
    schedule?: { quartz_cron_expression: string; timezone_id?: string; pause_status?: string }
    trigger?: Record<string, unknown> & { pause_status?: string }
    continuous?: { pause_status?: string }
  }
}

export interface RunTask {
  task_key: string
  run_id: number | string
  start_time?: number
  end_time?: number
  queue_duration?: number
  setup_duration?: number
  attempt_number?: number
  state?: { life_cycle_state?: string; result_state?: string }
  cluster_instance?: { cluster_id?: string }
}

/** `jobs/runs/list?expand_tasks=true` entry. Times are epoch ms; `end_time` is 0 while running. */
export interface Run {
  run_id: number | string
  job_id: number | string
  start_time: number
  end_time?: number
  trigger?: string
  state?: { life_cycle_state?: string; result_state?: string }
  tasks?: RunTask[]
}

/** `pipelines/get` (Lakeflow Declarative Pipelines). */
export interface DltPipeline {
  pipeline_id: string
  name?: string
  spec?: { continuous?: boolean; serverless?: boolean; clusters?: (NewCluster & { label?: string })[] }
}

/** `clusters/get` for clusters tasks name by `existing_cluster_id`. */
export interface ClusterInfo extends NewCluster {
  cluster_id: string
  cluster_name?: string
}

/** `system.query.history` row for a statement run by a job task. Times epoch ms, durations ms. */
export interface StatementRow {
  task_run_id: string
  statement_id: string
  statement_type?: string | null
  status?: string | null
  text?: string | null
  start_ms: number | string
  end_ms: number | string
  wait_ms?: number | string | null
  compile_ms?: number | string | null
  exec_ms?: number | string | null
  task_ms?: number | string | null
  read_bytes?: number | string | null
  written_bytes?: number | string | null
  shuffle_bytes?: number | string | null
  spill_bytes?: number | string | null
  read_rows?: number | string | null
  written_rows?: number | string | null
}

/** `system.compute.node_timeline` per cluster and minute. CPU is user + system percent. */
export interface NodeRow {
  cluster_id: string
  t_ms: number | string
  workers: number | string
  drivers: number | string
  worker_cpu?: number | string | null
  driver_cpu?: number | string | null
}

export interface RawExport {
  host: string
  exportedAt: string
  day: string
  tz: string
  /** Catalogs whose tables are drawn as tables; anything else in lineage is a source. */
  catalogs: string[]
  tables: TableRow[]
  columns: ColumnRow[]
  keys: KeyRow[]
  lineage: LineageRow[]
  jobs: Job[]
  runs: Run[]
  pipelines: DltPipeline[]
  clusters: ClusterInfo[]
  pools: { instance_pool_id: string; node_type_id: string }[]
  nodeTypes: { node_type_id: string; num_cores: number }[]
  /** Absent in exports made before utilization was fetched. */
  nodeTimeline?: NodeRow[]
  statements?: StatementRow[]
  warnings: string[]
}
