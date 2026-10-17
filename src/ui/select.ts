import type { Graph, ModeId } from '../model/types'
import { clusterNodeId } from '../model/workflow'
import { MODES } from '../layout/modes'
import { modeOf, useStore } from '../store'
import { jobNodeId } from '../view/deriveView'

/** A node and what it's directly wired to: a table's or source's jobs and FK neighbours, a job's reads and writes, a cluster's jobs. */
function neighbourhood(graph: Graph, id: string): string[] {
  const out = new Set([id])
  for (const p of graph.workflows.pipelines)
    for (const t of p.tasks) {
      const job = jobNodeId(t.id)
      if (job === id) for (const x of [...t.reads, ...t.writes]) out.add(x)
      else if (clusterNodeId(t.clusterId) === id || t.reads.includes(id) || t.writes.includes(id)) out.add(job)
    }
  for (const r of graph.refs) {
    if (r.from.table === id) out.add(r.to.table)
    if (r.to.table === id) out.add(r.from.table)
  }
  return [...out]
}

/** Select a table, job, cluster or source and frame it with its direct neighbours. */
export function goTo(id: string) {
  const s = useStore.getState()
  s.focus(id)
  s.camera({ kind: 'frame', ids: neighbourhood(s.graph, id) })
}

/** Select a pipeline (lighting everything it touches) and frame what it touches. */
export function selectPipeline(id: string) {
  const s = useStore.getState()
  const p = s.graph.workflows.pipelines.find((x) => x.id === id)
  s.setLens(id)
  if (p) s.camera({ kind: 'frame', ids: [...new Set(p.tasks.flatMap((t) => [jobNodeId(t.id), ...t.reads, ...t.writes]))] })
}

/** Switch layout mode and look at it from that mode's default angle (2D from above, 3D facing the slabs). */
export function showMode(mode: ModeId) {
  const s = useStore.getState()
  if (modeOf(s.layout) === mode) return
  s.setMode(mode)
  s.camera({ kind: 'preset', preset: MODES[mode].defaultPreset })
}
