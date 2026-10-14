import type { Schedule, TaskRun, Window } from './schedule'

/**
 * Sorted run starts and ends for a schedule. The set of runs overlapping a window only changes when a
 * start or an end crosses one of its edges, so two binary searches give a key for "same set as last
 * frame" without scanning every run.
 */
interface RunIndex {
  starts: Float64Array
  ends: Float64Array
  /** Runs active at the last point asked for, and that point's key. */
  activeKey: string
  active: TaskRun[]
}

const indexes = new WeakMap<Schedule, RunIndex>()

function indexOf(s: Schedule): RunIndex {
  let ix = indexes.get(s)
  if (!ix) {
    const starts = Float64Array.from(s.taskRuns, (r) => r.start).sort()
    const ends = Float64Array.from(s.taskRuns, (r) => r.end).sort()
    indexes.set(s, (ix = { starts, ends, activeKey: '', active: [] }))
  }
  return ix
}

/** Number of values `<= x` (or `< x` when `strict`) in a sorted array. */
function count(xs: Float64Array, x: number, strict = false) {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (strict ? xs[mid] < x : xs[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Key that changes exactly when `taskRunsIn(s, w)` would return a different set. A point window
 * holds runs with start <= t < end; a span holds start < b and end > a.
 */
export function windowKey(s: Schedule, [a, b]: Window): string {
  const ix = indexOf(s)
  return a === b ? `${count(ix.starts, a)}:${count(ix.ends, a)}` : `${count(ix.starts, b, true)}:${count(ix.ends, a)}`
}

/** Runs active at `t` (start <= t < end), recomputed only when that set changes. */
export function activeRuns(s: Schedule, t: number): TaskRun[] {
  const ix = indexOf(s)
  const key = windowKey(s, [t, t])
  if (key !== ix.activeKey) {
    ix.activeKey = key
    ix.active = s.taskRuns.filter((r) => r.start <= t && t < r.end)
  }
  return ix.active
}
