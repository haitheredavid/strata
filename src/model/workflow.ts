export type Medallion = 'bronze' | 'silver' | 'gold'
export const MEDALLIONS: Medallion[] = ['bronze', 'silver', 'gold']

export type Trigger =
  | { kind: 'schedule'; cron: string }
  | { kind: 'file_arrival'; path: string }
  | { kind: 'table_update'; tables: string[] }
  | { kind: 'job'; pipeline: string } // runs after another pipeline
  | { kind: 'manual' }
  | { kind: 'continuous' }

/** A unit of work that reads and writes tables. `reads` / `writes` hold node ids (table ids or `source:<name>`). */
export interface Task {
  id: string
  name: string
  pipelineId: string
  reads: string[]
  writes: string[]
  dependsOn: string[]
  emits: string[]
  /** Run time in seconds, when the workflow file gives one; otherwise simulated. */
  duration?: number
  /** Bytes each read and write moves per run, when the workflow file gives it; otherwise simulated. */
  bytes?: number
  /** Compute the task runs on (a `Cluster` id). */
  clusterId: string
}

export interface Pipeline {
  id: string
  name: string
  color: string
  trigger?: Trigger
  tasks: Task[]
}

/** Something read or written that isn't a table in the schema: an API, a volume path, another system. */
export interface Source {
  id: string
  name: string
}

/**
 * Compute a task runs on. `job` clusters start fresh for each run, `all_purpose` clusters stay warm and
 * can be shared across pipelines, `serverless` starts in seconds and scales itself.
 */
export type ClusterKind = 'job' | 'all_purpose' | 'serverless'

export interface Cluster {
  id: string
  name: string
  kind: ClusterKind
  nodeType: string
  workers: { min: number; max: number }
  coresPerNode: number
  sparkVersion?: string
}

export interface Workflows {
  pipelines: Pipeline[]
  sources: Source[]
  clusters: Cluster[]
  warnings: string[]
}

export const EMPTY_WORKFLOWS: Workflows = { pipelines: [], sources: [], clusters: [], warnings: [] }

export const SERVERLESS = 'serverless'
export const clusterNodeId = (clusterId: string) => `cluster:${clusterId}`

export const sourceId = (name: string) => `source:${name}`
