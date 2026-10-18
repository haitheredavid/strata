import { useMemo } from 'react'
import { scheduleOf, useStore } from '../store'
import { clockOf, daySeconds } from '../sim/schedule'
import { runText } from '../view/runs'
import type { RunLike } from '../view/runs'

/**
 * The day as a thin strip with a tick per run, coloured by how it ended (failed red, running amber);
 * a streaming job fills it, no runs leave a faint baseline. Hover for the text summary.
 */
export function RunStrip({ runs, label }: { runs: RunLike[]; label?: string }) {
  const schedule = useStore(scheduleOf)
  const clock = useMemo(() => clockOf(schedule), [schedule])
  const len = daySeconds(schedule)
  const text = runText(runs, clock)
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / len) * 100))}%`
  return (
    <span className={`run-strip ${runs.length ? '' : 'none'}`} title={label ? `${label}: ${text}` : text} aria-label={text}>
      {runs.some((r) => r.continuous) ? (
        <i className="stream" />
      ) : (
        runs.map((r, i) => <i key={i} className={r.state ?? 'success'} style={{ left: pct(r.start), width: `max(2px, ${pct(r.end - r.start)})` }} />)
      )}
    </span>
  )
}
