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

export interface Workflows {
  pipelines: Pipeline[]
  sources: Source[]
  warnings: string[]
}

export const EMPTY_WORKFLOWS: Workflows = { pipelines: [], sources: [], warnings: [] }

export const sourceId = (name: string) => `source:${name}`
