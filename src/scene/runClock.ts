/**
 * Fractional playback position of the current run, in steps (step k is active for k ≤ t < k + 1).
 * Kept outside the store so pulses can read it every frame without re-rendering React; the store only
 * holds the integer step.
 */
export const runClock = { t: 0 }

export const TRIGGER_LABEL = {
  schedule: 'CRON',
  file_arrival: 'FILE',
  table_update: 'ON UPDATE',
  job: 'AFTER',
  manual: 'MANUAL',
  continuous: 'STREAMING',
} as const
