import type { Schedule } from '../sim/schedule'

/**
 * A workspace export (see `scripts/export-databricks.ts`): the schema as DBML, the jobs as a DAB-shaped
 * workflow file, and one day of real runs in the shape the simulator produces.
 */
export interface Snapshot {
  kind: 'strata-snapshot'
  version: 1
  host: string
  exportedAt: string
  /** The exported day, `YYYY-MM-DD`; run times are seconds since its 00:00 in `tz`. */
  day: string
  tz: string
  dbml: string
  workflows: string
  runs: Schedule
  warnings: string[]
}

export function isSnapshot(v: unknown): v is Snapshot {
  const o = v as Partial<Snapshot> | null
  return !!o && o.kind === 'strata-snapshot' && typeof o.dbml === 'string' && !!o.runs
}

/** The snapshot in `text`, or null when it isn't one. */
export function readSnapshot(text: string): Snapshot | null {
  try {
    const v = JSON.parse(text)
    return isSnapshot(v) ? v : null
  } catch {
    return null
  }
}
