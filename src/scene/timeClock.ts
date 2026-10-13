/**
 * Playhead of the simulated day, in seconds since 00:00. Kept outside the store so pulses and the
 * timeline can read it every frame without re-rendering React; the store publishes it only when the set
 * of running jobs changes or on a seek.
 */
export const timeClock = { t: 0 }

export const TRIGGER_LABEL = {
  schedule: 'CRON',
  file_arrival: 'FILE',
  table_update: 'ON UPDATE',
  job: 'AFTER',
  manual: 'MANUAL',
  continuous: 'STREAMING',
} as const
