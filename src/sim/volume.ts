import type { Graph } from '../model/types'
import type { Medallion } from '../model/workflow'
import type { FlowEdge } from '../view/deriveView'
import { rand } from './rng'
import { MICRO_BATCH, daySeconds } from './schedule'
import type { Schedule } from './schedule'

/** Data a lineage edge moves: bytes per run, and how many runs a day. */
export interface FlowVolume {
  bytes: number
  runsPerDay: number
  /** Where `bytes` comes from: query history (snapshots), the workflow file's `bytes:`, or a simulated draw. */
  bytesFrom: 'measured' | 'declared' | 'simulated'
}

const GB = 1e9
const MAX_DOTS = 6
/** Simulated bytes per run by the layer of the table end: raw landings are big, gold marts small. */
const RANGE: Record<Medallion | 'source' | 'none', [number, number]> = {
  source: [2 * GB, 20 * GB],
  bronze: [2 * GB, 20 * GB],
  silver: [0.5 * GB, 5 * GB],
  gold: [0.02 * GB, 0.5 * GB],
  platinum: [0.01 * GB, 0.2 * GB],
  none: [0.2 * GB, 5 * GB],
}

const runCounts = new WeakMap<Schedule, Map<string, number>>()

/** Runs a day per task id; a streaming task counts its micro-batches. Cached per schedule. */
function runsByTask(s: Schedule): Map<string, number> {
  let m = runCounts.get(s)
  if (m) return m
  runCounts.set(s, (m = new Map()))
  for (const r of s.taskRuns) m.set(r.taskId, (m.get(r.taskId) ?? 0) + (r.continuous ? daySeconds(s) / MICRO_BATCH : 1))
  return m
}

const measuredIO = new WeakMap<Schedule, Map<string, { read: number; written: number }>>()

/**
 * Bytes read and written per run, by task id, averaged over the task's runs that recorded statements
 * (`system.query.history`, so serverless and warehouse compute). Cached per schedule.
 */
function measuredByTask(s: Schedule): Map<string, { read: number; written: number }> {
  let m = measuredIO.get(s)
  if (m) return m
  const sums = new Map<string, { read: number; written: number; runs: number }>()
  for (const r of s.taskRuns) {
    const sts = s.statements?.[r.id]
    if (!sts?.length) continue
    const a = sums.get(r.taskId) ?? { read: 0, written: 0, runs: 0 }
    for (const st of sts) {
      a.read += st.readMB * 1e6
      a.written += st.writtenMB * 1e6
    }
    a.runs++
    sums.set(r.taskId, a)
  }
  m = new Map([...sums].map(([id, a]) => [id, { read: a.read / a.runs, written: a.written / a.runs }]))
  measuredIO.set(s, m)
  return m
}

/**
 * Bytes per run and runs per day for each lineage edge. Bytes come from the task's statements when the
 * snapshot has them (what it read split evenly over the tables it reads, what it wrote over the ones it
 * writes), else the task's `bytes` in the workflow file, else a deterministic log-uniform draw by the
 * medallion layer of the table the edge touches. Runs come from the day's schedule (at least one).
 */
export function flowVolumes(flows: FlowEdge[], graph: Graph, schedule: Schedule): Map<string, FlowVolume> {
  const medallion = new Map(graph.tables.map((t) => [t.id, t.medallion]))
  const tasks = new Map(graph.workflows.pipelines.flatMap((p) => p.tasks.map((t) => [t.id, t])))
  const measured = measuredByTask(schedule)
  const runs = runsByTask(schedule)
  const out = new Map<string, FlowVolume>()
  for (const f of flows) {
    const table = f.role === 'read' ? f.from : f.to
    const task = tasks.get(f.taskId)
    const io = measured.get(f.taskId)
    const share = f.role === 'read' ? (io?.read ?? 0) / Math.max(1, task?.reads.length ?? 1) : (io?.written ?? 0) / Math.max(1, task?.writes.length ?? 1)
    let bytes: number
    let bytesFrom: FlowVolume['bytesFrom']
    if (io && share > 0) [bytes, bytesFrom] = [share, 'measured']
    else if (task?.bytes !== undefined) [bytes, bytesFrom] = [task.bytes, 'declared']
    else {
      const layer = table.startsWith('source:') ? 'source' : (medallion.get(table) ?? 'none')
      const [lo, hi] = RANGE[layer]
      ;[bytes, bytesFrom] = [lo * (hi / lo) ** rand(`${f.taskId}:${table}:bytes`), 'simulated']
    }
    // At least a byte: the dot size is a log scale.
    out.set(f.id, { bytes: Math.max(1, Math.round(bytes)), runsPerDay: Math.max(1, runs.get(f.taskId) ?? 0), bytesFrom })
  }
  return out
}

export interface PulseShape {
  scale: number
  dots: number
}

/**
 * Dot size from bytes per run and dots per edge from runs per day, by flow id. Pass every flow in the
 * view, not just the lit ones: the log scale spans what's passed, and a lens or the timeline changing
 * the set must not resize an edge's dots.
 */
export function pulseShape(flows: FlowEdge[], volumes: Map<string, FlowVolume>): Map<string, PulseShape> {
  const logs = flows.map((f) => Math.log10(Math.max(1, volumes.get(f.id)?.bytes ?? 1e9)))
  const lo = Math.min(...logs)
  const range = Math.max(...logs) - lo
  return new Map(
    flows.map((f, i) => {
      const runs = volumes.get(f.id)?.runsPerDay ?? 1
      return [
        f.id,
        {
          scale: range > 0.01 ? 0.6 + 0.9 * ((logs[i] - lo) / range) : 1,
          // a daily batch is one dot, hourly about four, streaming a dense train
          dots: Math.min(MAX_DOTS, Math.max(1, Math.round(1 + Math.log2(runs) / 1.5))),
        },
      ]
    }),
  )
}

/** `4.2 GB`, `350 MB`, `12 KB`. */
export function formatBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000
    i++
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}
