import type { Schedule } from '../sim/schedule'
import { isDay, isTimeZone } from './databricks/time'

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

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** True when `v` says it's a snapshot, valid or not. */
export const claimsSnapshot = (v: unknown) => record(v) && v.kind === 'strata-snapshot'

/** What's wrong with a value that claims to be a snapshot, or null when it's a usable one. */
export function snapshotProblem(v: unknown): string | null {
  if (!record(v) || v.kind !== 'strata-snapshot') return 'not a strata snapshot'
  if (v.version !== 1) return `version ${String(v.version)} isn't supported (this app reads version 1)`
  const missing = [
    typeof v.host !== 'string' && 'host',
    (typeof v.day !== 'string' || !isDay(v.day)) && 'day (YYYY-MM-DD)',
    (typeof v.tz !== 'string' || !isTimeZone(v.tz)) && 'tz (a time zone)',
    typeof v.dbml !== 'string' && 'dbml',
    typeof v.workflows !== 'string' && 'workflows',
    !(record(v.runs) && Array.isArray(v.runs.taskRuns) && Array.isArray(v.runs.runs)) && 'runs.taskRuns',
    !Array.isArray(v.warnings) && 'warnings',
  ].filter((x): x is string => !!x)
  return missing.length ? `missing or invalid ${missing.join(', ')}` : null
}

export const isSnapshot = (v: unknown): v is Snapshot => snapshotProblem(v) === null
