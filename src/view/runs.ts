import type { PipelineRun, RunState, Schedule, TaskRun } from '../sim/schedule'

/** A run as the lists show it: a task run or a pipeline run. */
export type RunLike = { start: number; end: number; state?: RunState; continuous?: boolean }

const push = <V,>(m: Map<string, V[]>, k: string, v: V) => m.set(k, [...(m.get(k) ?? []), v])

/** The day's runs by task and by pipeline, built once per schedule. */
const runIndexes = new WeakMap<Schedule, { byTask: Map<string, TaskRun[]>; byPipeline: Map<string, PipelineRun[]> }>()
export function runsOf(s: Schedule) {
  let ix = runIndexes.get(s)
  if (ix) return ix
  ix = { byTask: new Map(), byPipeline: new Map() }
  for (const r of s.taskRuns) push(ix.byTask, r.taskId, r)
  for (const r of s.runs) push(ix.byPipeline, r.pipelineId, r)
  runIndexes.set(s, ix)
  return ix
}

const STATE_MARK: Record<RunState, string> = { success: '✓', failed: '✕', canceled: '–', skipped: '–', running: '…' }

/** `3 runs · 1 failed · last 14:32 ✓`, `streaming all day`, or `no runs today`. */
export function runText(runs: RunLike[], clock: (t: number) => string): string {
  if (!runs.length) return 'no runs today'
  if (runs.some((r) => r.continuous)) return 'streaming all day'
  const failed = runs.filter((r) => r.state === 'failed').length
  const last = runs.reduce((a, b) => (b.end > a.end ? b : a))
  const state = last.state ?? 'success'
  return `${runs.length} run${runs.length > 1 ? 's' : ''}${failed ? ` · ${failed} failed` : ''} · last ${clock(last.end)} ${STATE_MARK[state]}`
}

/** The worst state among runs, for a one-glance status: failed beats running beats the rest. */
export function worstState(runs: RunLike[]): RunState | 'none' | 'stream' {
  if (!runs.length) return 'none'
  if (runs.some((r) => r.continuous)) return 'stream'
  if (runs.some((r) => r.state === 'failed')) return 'failed'
  if (runs.some((r) => r.state === 'running')) return 'running'
  return 'success'
}
