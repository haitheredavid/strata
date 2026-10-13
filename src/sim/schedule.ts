import type { Table } from '../model/types'
import type { Medallion, Pipeline, Task, Workflows } from '../model/workflow'
import { jobNodeId } from '../view/deriveView'
import { runSteps } from '../view/runOrder'
import { between } from './rng'

/** Seconds in the simulated day. Times below are seconds since 00:00. */
export const DAY = 86_400

/** One task executing inside one pipeline run. `setup` seconds at the start are queueing / cluster start. */
export interface TaskRun {
  id: string
  taskId: string
  pipelineId: string
  runId: string
  start: number
  end: number
  setup: number
  clusterId: string
  medallion?: Medallion
  /** Streaming task: runs all day in micro-batches. */
  continuous?: boolean
}

export interface PipelineRun {
  id: string
  pipelineId: string
  start: number
  end: number
  cause: string
}

export interface SimEvent {
  t: number
  kind: 'trigger' | 'write' | 'emit'
  name: string
  pipelineId: string
  taskRunId?: string
}

export interface Schedule {
  runs: PipelineRun[]
  taskRuns: TaskRun[]
  events: SimEvent[]
}

export type Window = [number, number]

/** Base run time by the medallion layer a task writes: silver does the heavy cleaning and joining. */
const BASE: Record<Medallion | 'none', number> = { bronze: 240, silver: 720, gold: 300, none: 180 }
const MAX_RUNS = 24
const MICRO_BATCH = 600
const TABLE_UPDATE_WAIT = 60 // Databricks waits for writes to settle before a table-update trigger fires

/** Minutes of the day a cron expression fires at. Unix 5-field or Quartz 6/7-field; date fields ignored. */
export function cronTimes(cron: string): number[] {
  let f = cron.trim().split(/\s+/)
  if (f.length >= 6) f = f.slice(1) // Quartz: leading seconds field
  if (f.length < 2) return []
  const mins = cronField(f[0], 0, 59)
  const hours = cronField(f[1], 0, 23)
  return hours.flatMap((h) => mins.map((m) => (h * 60 + m) * 60)).sort((a, b) => a - b)
}

function cronField(spec: string, lo: number, hi: number): number[] {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const [range, stepText] = part.split('/')
    const step = Math.max(1, Number(stepText ?? 1) || 1)
    let a = lo
    let b = hi
    if (range !== '*' && range !== '?') {
      const [x, y] = range.split('-').map(Number)
      if (Number.isNaN(x)) continue
      a = x
      b = y ?? (stepText ? hi : x)
    }
    for (let v = Math.max(lo, a); v <= Math.min(hi, b); v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

interface Request { t: number; pipelineId: string; cause: string }

/**
 * Simulates one day of runs for every pipeline. Deterministic: the same workflows give the same day.
 * Pipelines start from their trigger (cron times, a few file arrivals, 09:00 for manual, all day for
 * continuous) or from another run (`after`, or a write to a watched table). A pipeline that is still
 * running when triggered runs again once it finishes, at most once queued.
 */
export function simulateDay(wf: Workflows, tables: Pick<Table, 'id' | 'medallion'>[], seed = ''): Schedule {
  const medallionOf = new Map(tables.map((t) => [t.id, t.medallion]))
  const taskMedallion = (t: Task) => t.writes.map((w) => medallionOf.get(w)).find((m): m is Medallion => !!m)
  const byId = new Map(wf.pipelines.map((p) => [p.id, p]))
  const clusterKind = new Map(wf.clusters.map((c) => [c.id, c.kind]))

  const runs: PipelineRun[] = []
  const taskRuns: TaskRun[] = []
  const events: SimEvent[] = []
  const requests: Request[] = []
  const busyUntil = new Map<string, number>()
  const queued = new Set<string>()
  const runCount = new Map<string, number>()

  for (const p of wf.pipelines) {
    const t = p.trigger
    if (t?.kind === 'schedule') for (const at of cronTimes(t.cron)) requests.push({ t: at, pipelineId: p.id, cause: `cron ${t.cron}` })
    else if (t?.kind === 'file_arrival')
      for (const [lo, hi] of [[0.5, 3], [7, 10], [13, 17]])
        requests.push({ t: Math.round(between(`${seed}:${p.id}:arrival:${lo}`, lo, hi) * 3600), pipelineId: p.id, cause: `file in ${t.path}` })
    else if (t?.kind === 'manual') requests.push({ t: 9 * 3600, pipelineId: p.id, cause: 'manual' })
    else if (t?.kind === 'continuous') runContinuous(p)
    else if (!t) requests.push({ t: 6 * 3600, pipelineId: p.id, cause: 'no trigger' })
  }

  for (let guard = 0; requests.length && guard < 5000; guard++) {
    requests.sort((a, b) => a.t - b.t)
    const req = requests.shift()!
    if (req.t >= DAY) break
    const p = byId.get(req.pipelineId)!
    const busy = busyUntil.get(p.id) ?? -1
    if (busy > req.t) {
      // Still running: queue one follow-up run, coalescing any further triggers into it.
      if (!queued.has(p.id)) {
        queued.add(p.id)
        requests.push({ ...req, t: busy })
      }
      continue
    }
    queued.delete(p.id)
    const n = runCount.get(p.id) ?? 0
    if (n >= MAX_RUNS) continue
    runCount.set(p.id, n + 1)
    const run = runBatch(p, n, req)
    busyUntil.set(p.id, run.end)

    // Downstream pipelines: `after` this one, or watching a table this run wrote.
    for (const q of wf.pipelines) {
      const t = q.trigger
      if (t?.kind === 'job' && t.pipeline === p.id) requests.push({ t: run.end + 5, pipelineId: q.id, cause: `after ${p.name}` })
      if (t?.kind === 'table_update') {
        const hits = taskRuns.filter((r) => r.runId === run.id && byTask(p, r.taskId).writes.some((w) => t.tables.includes(w)))
        if (hits.length)
          requests.push({ t: Math.max(...hits.map((r) => r.end)) + TABLE_UPDATE_WAIT, pipelineId: q.id, cause: `update from ${p.name}` })
      }
    }
  }

  runs.sort((a, b) => a.start - b.start)
  taskRuns.sort((a, b) => a.start - b.start)
  events.sort((a, b) => a.t - b.t)
  return { runs, taskRuns, events }

  function byTask(p: Pipeline, id: string) {
    return p.tasks.find((t) => t.id === id)!
  }

  function runBatch(p: Pipeline, n: number, req: Request): PipelineRun {
    const runId = `${p.id}#${n + 1}`
    const ends = new Map<string, number>()
    const started = new Set<string>() // job clusters already up in this run
    for (const step of runSteps(p).steps)
      for (const id of step) {
        const task = byTask(p, id)
        const key = `${seed}:${runId}:${id}`
        const ready = Math.max(req.t, ...task.dependsOn.map((d) => ends.get(d) ?? req.t))
        // A job cluster starts cold once per run; warm shared clusters and serverless only queue briefly.
        const kind = clusterKind.get(task.clusterId) ?? 'job'
        const cold = kind === 'job' && !started.has(task.clusterId)
        started.add(task.clusterId)
        const [lo, hi] = cold ? [180, 300] : kind === 'serverless' ? [10, 30] : kind === 'all_purpose' ? [5, 20] : [20, 60]
        const setup = Math.round(between(`${key}:${cold ? 'cold' : 'gap'}`, lo, hi))
        const medallion = taskMedallion(task)
        const work = task.duration ?? Math.round(BASE[medallion ?? 'none'] * (1 + 0.3 * task.reads.length) * between(`${key}:jitter`, 0.7, 1.4))
        const r: TaskRun = { id: `${runId}/${id}`, taskId: id, pipelineId: p.id, runId, start: ready, end: ready + setup + work, setup, clusterId: task.clusterId, medallion }
        ends.set(id, r.end)
        taskRuns.push(r)
        for (const w of task.writes) events.push({ t: r.end, kind: 'write', name: w, pipelineId: p.id, taskRunId: r.id })
        for (const e of task.emits) events.push({ t: r.end, kind: 'emit', name: e, pipelineId: p.id, taskRunId: r.id })
      }
    const run: PipelineRun = { id: runId, pipelineId: p.id, start: req.t, end: Math.max(req.t, ...ends.values()), cause: req.cause }
    runs.push(run)
    events.push({ t: req.t, kind: 'trigger', name: req.cause, pipelineId: p.id })
    return run
  }

  function runContinuous(p: Pipeline) {
    const runId = `${p.id}#1`
    runs.push({ id: runId, pipelineId: p.id, start: 0, end: DAY, cause: 'continuous' })
    events.push({ t: 0, kind: 'trigger', name: 'continuous', pipelineId: p.id })
    for (const task of p.tasks) {
      const r: TaskRun = {
        id: `${runId}/${task.id}`, taskId: task.id, pipelineId: p.id, runId, start: 0, end: DAY, setup: 0, clusterId: task.clusterId,
        medallion: taskMedallion(task), continuous: true,
      }
      taskRuns.push(r)
      // One write per hour stands in for the micro-batches; it doesn't fire table-update triggers.
      for (let h = 1; h < 24; h++) for (const w of task.writes) events.push({ t: h * 3600, kind: 'write', name: w, pipelineId: p.id, taskRunId: r.id })
    }
  }
}

const overlaps = (r: { start: number; end: number }, [a, b]: Window) => (a === b ? r.start <= a && a < r.end : r.start < b && r.end > a)

/** Task runs overlapping a window (a point when both ends are equal). */
export const taskRunsIn = (s: Schedule, w: Window) => s.taskRuns.filter((r) => overlaps(r, w))

export const eventsIn = (s: Schedule, [a, b]: Window) => s.events.filter((e) => e.t >= a && e.t <= b)

/**
 * Jobs running at `t`, by job node id, with progress through their run in [0, 1). Streaming jobs
 * report progress through the current micro-batch.
 */
export function activeAt(s: Schedule, t: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of s.taskRuns) {
    if (r.start > t || t >= r.end) continue
    out.set(jobNodeId(r.taskId), r.continuous ? (t % MICRO_BATCH) / MICRO_BATCH : (t - r.start) / (r.end - r.start))
  }
  return out
}

/** Task run seconds inside a window, by the medallion layer each task writes; optionally one pipeline's. */
export function layerTotals(s: Schedule, [a, b]: Window, pipelineId?: string | null): Record<Medallion, number> {
  const out: Record<Medallion, number> = { bronze: 0, silver: 0, gold: 0 }
  for (const r of s.taskRuns) {
    if (!r.medallion || r.continuous || (pipelineId && r.pipelineId !== pipelineId)) continue
    out[r.medallion] += Math.max(0, Math.min(b, r.end) - Math.max(a, r.start))
  }
  return out
}

/** `02:05` for seconds of the day. */
export const clock = (t: number) => {
  const m = Math.floor(Math.max(0, t) / 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** `1h 5m`, `12m`, `40s`. */
export const span = (sec: number) => {
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

/** Task runs on a cluster at `t`: still starting (in their setup) or doing work. */
export function onCluster(s: Schedule, clusterId: string, t: number) {
  const starting: TaskRun[] = []
  const working: TaskRun[] = []
  for (const r of s.taskRuns) {
    if (r.clusterId !== clusterId || t < r.start || t >= r.end) continue
    ;(t < r.start + r.setup ? starting : working).push(r)
  }
  return { starting, working }
}
