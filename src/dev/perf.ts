/**
 * Timing spans for profiling. Each span shows up in the browser's Performance panel (`strata:<name>`)
 * and in a small ring buffer the perf HUD and `__strata.spans()` read. Costs one `performance.now()`
 * pair per call, so it stays on in production builds too.
 */
export interface SpanRecord {
  name: string
  ms: number
  at: number
}

const CAP = 256
const ring: SpanRecord[] = []
const last = new Map<string, SpanRecord>()

export function record(name: string, ms: number, start = performance.now() - ms) {
  const rec = { name, ms, at: start }
  if (ring.length >= CAP) ring.shift()
  ring.push(rec)
  last.set(name, rec)
  try {
    performance.measure(`strata:${name}`, { start, duration: ms })
  } catch {
    /* measure with options unsupported: the ring buffer still has it */
  }
}

/** Time `fn` and record it under `name`. Returns what `fn` returns. */
export function span<T>(name: string, fn: () => T): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    record(name, performance.now() - start, start)
  }
}

/** Most recent span per name. */
export const lastSpans = (): SpanRecord[] => [...last.values()]
/** Every span still in the ring buffer, oldest first. */
export const allSpans = (): SpanRecord[] => [...ring]
export function clearSpans() {
  ring.length = 0
  last.clear()
}
