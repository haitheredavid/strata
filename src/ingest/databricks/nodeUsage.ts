import { DAY } from '../../sim/schedule'
import type { UsageSample } from '../../sim/schedule'
import type { NodeRow, Run } from './raw'

/**
 * Real cluster ids → strata cluster ids. A job cluster is a new cluster each run, so many real
 * clusters fold into one strata cluster; a shared cluster keeps its id.
 */
export function clusterInstances(runs: Run[], logicalOf: (jobId: string, taskKey: string) => string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of runs)
    for (const t of r.tasks ?? []) {
      const real = t.cluster_instance?.cluster_id
      const logical = real && logicalOf(String(r.job_id), t.task_key)
      if (real && logical) out.set(real, logical)
    }
  return out
}

/**
 * Per-minute node use, as strata clusters in seconds since `t0`. Real clusters that fold into one strata
 * cluster in the same minute (concurrent runs) add their workers; busy is averaged weighted by workers.
 */
export function nodeUsage(rows: NodeRow[], instances: Map<string, string>, t0: number): Record<string, UsageSample[]> {
  const acc = new Map<string, Map<number, { workers: number; weighted: number; weight: number }>>()
  for (const r of rows) {
    const id = instances.get(r.cluster_id)
    if (!id) continue
    const t = (Number(r.t_ms) - t0) / 1000
    if (t < 0 || t >= DAY) continue
    const workers = Number(r.workers) || 0
    // Without workers (single node) the driver does the work.
    const cpu = (workers ? Number(r.worker_cpu) : Number(r.driver_cpu)) || 0
    const weight = Math.max(1, workers)
    const byT = acc.get(id) ?? new Map()
    const a = byT.get(t) ?? { workers: 0, weighted: 0, weight: 0 }
    a.workers += workers
    a.weighted += (cpu / 100) * weight
    a.weight += weight
    byT.set(t, a)
    acc.set(id, byT)
  }
  const out: Record<string, UsageSample[]> = {}
  for (const [id, byT] of acc)
    out[id] = [...byT].sort(([a], [b]) => a - b).map(([t, a]) => ({ t, workers: a.workers, busy: Math.min(1, a.weighted / a.weight) }))
  return out
}
