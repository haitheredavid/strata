import type { Trigger } from '../model/workflow'
import { TRIGGER_LABEL } from './timeClock'

/** A job's state at the timeline playhead (null with the timeline closed). */
export type RunState = 'active' | 'done' | 'pending' | null

/** Event marker color on jobs that emit events. */
export const EVENT = '#fbbf24'

/** Cluster rack rows: up to this many workers, at this height and gap. */
export const RACK_MAX_SHOWN = 8
export const RACK_ROW = 0.22
export const RACK_GAP = 0.08

/** What starts a pipeline, as shown above its first job. */
export function triggerText(t: Trigger) {
  const detail =
    t.kind === 'schedule' ? t.cron
      : t.kind === 'file_arrival' ? t.path
        : t.kind === 'table_update' ? t.tables.join(', ')
          : t.kind === 'job' ? t.pipeline
            : ''
  return `${TRIGGER_LABEL[t.kind]}${detail ? `  ${detail}` : ''}`
}
