import type { Graph } from '../model/types'
import type { Medallion } from '../model/workflow'
import type { FlowEdge } from '../view/deriveView'
import { rand } from './rng'
import { DAY, MICRO_BATCH } from './schedule'
import type { Schedule } from './schedule'

/** Data a lineage edge moves: bytes per run, and how many runs a day. */
export interface FlowVolume {
  bytes: number
  runsPerDay: number
}

const GB = 1e9
const MAX_DOTS = 6
/** Simulated bytes per run by the layer of the table end: raw landings are big, gold marts small. */
const RANGE: Record<Medallion | 'source' | 'none', [number, number]> = {
  source: [2 * GB, 20 * GB],
  bronze: [2 * GB, 20 * GB],
  silver: [0.5 * GB, 5 * GB],
  gold: [0.02 * GB, 0.5 * GB],
  none: [0.2 * GB, 5 * GB],
}

const runCounts = new WeakMap<Schedule, Map<string, number>>()

/** Runs a day per task id; a streaming task counts its micro-batches. Cached per schedule. */
function runsByTask(s: Schedule): Map<string, number> {
  let m = runCounts.get(s)
  if (m) return m
  runCounts.set(s, (m = new Map()))
  for (const r of s.taskRuns) m.set(r.taskId, (m.get(r.taskId) ?? 0) + (r.continuous ? DAY / MICRO_BATCH : 1))
  return m
}

/**
 * Bytes per run and runs per day for each lineage edge. Bytes come from the task's `bytes` when the
 * workflow file gives it, else a deterministic log-uniform draw by the medallion layer of the table the
 * edge touches. Runs come from the simulated day (at least one).
 */
export function flowVolumes(flows: FlowEdge[], graph: Graph, schedule: Schedule): Map<string, FlowVolume> {
  const medallion = new Map(graph.tables.map((t) => [t.id, t.medallion]))
  const declared = new Map(graph.workflows.pipelines.flatMap((p) => p.tasks.map((t) => [t.id, t.bytes])))
  const runs = runsByTask(schedule)
  const out = new Map<string, FlowVolume>()
  for (const f of flows) {
    const table = f.role === 'read' ? f.from : f.to
    const layer = table.startsWith('source:') ? 'source' : (medallion.get(table) ?? 'none')
    const [lo, hi] = RANGE[layer]
    const bytes = declared.get(f.taskId) ?? lo * (hi / lo) ** rand(`${f.taskId}:${table}:bytes`)
    out.set(f.id, { bytes: Math.round(bytes), runsPerDay: Math.max(1, runs.get(f.taskId) ?? 0) })
  }
  return out
}

/** Dot size from bytes per run (log scale across the shown flows) and dots per edge from runs per day. */
export function pulseShape(flows: FlowEdge[], volumes: Map<string, FlowVolume>) {
  const logs = flows.map((f) => Math.log10(volumes.get(f.id)?.bytes ?? 1e9))
  const lo = Math.min(...logs)
  const range = Math.max(...logs) - lo
  return flows.map((f, i) => {
    const runs = volumes.get(f.id)?.runsPerDay ?? 1
    return {
      scale: range > 0.01 ? 0.55 + 1.35 * ((logs[i] - lo) / range) : 1,
      // a daily batch is one dot, hourly about four, streaming a dense train
      dots: Math.min(MAX_DOTS, Math.max(1, Math.round(1 + Math.log2(runs) / 1.5))),
    }
  })
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
