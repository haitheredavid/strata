import type { Trigger } from '../model/workflow'
import { TRIGGER_LABEL } from '../scene/timeClock'

/** `CRON 0 2 * * *`, `ON UPDATE bronze.orders_raw`, … */
export const triggerLine = (t?: Trigger) => {
  if (!t) return 'no trigger'
  const d = t.kind === 'schedule' ? t.cron : t.kind === 'file_arrival' ? t.path : t.kind === 'table_update' ? t.tables.join(', ') : t.kind === 'job' ? t.pipeline : ''
  return `${TRIGGER_LABEL[t.kind]} ${d}`.trim()
}
