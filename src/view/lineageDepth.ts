import type { Graph } from '../model/types'
import { fkEnds, jobNodeId } from './deriveView'

const cache = new WeakMap<Graph, Map<string, number>>()

/**
 * Where each table, source and job sits along the data's flow, in [0, 1]: 0 for what nothing feeds
 * (sources, raw tables), 1 for the most downstream. Longest path over lineage (read → job → write)
 * and FKs (referenced → referencing), with cycles broken by dropping DFS back-edges in graph order.
 * Built once per graph, so colours don't move as filters change.
 */
export function lineageDepth(graph: Graph): Map<string, number> {
  const hit = cache.get(graph)
  if (hit) return hit

  const parents = new Map<string, string[]>()
  const node = (id: string) => {
    if (!parents.has(id)) parents.set(id, [])
    return parents.get(id)!
  }
  for (const t of graph.tables) node(t.id)
  for (const s of graph.workflows.sources) node(s.id)
  for (const p of graph.workflows.pipelines)
    for (const t of p.tasks) {
      const job = jobNodeId(t.id)
      node(job).push(...t.reads)
      for (const r of t.reads) node(r)
      for (const w of t.writes) node(w).push(job)
    }
  for (const r of graph.refs) {
    const { child, parent } = fkEnds({ from: r.from.table, to: r.to.table, kind: r.kind })
    if (child !== parent) node(child).push(parent)
  }

  const steps = new Map<string, number>()
  const onStack = new Set<string>()
  const visit = (n: string): number => {
    const known = steps.get(n)
    if (known !== undefined) return known
    onStack.add(n)
    let d = 0
    for (const p of parents.get(n) ?? []) if (!onStack.has(p)) d = Math.max(d, visit(p) + 1)
    onStack.delete(n)
    steps.set(n, d)
    return d
  }
  for (const n of parents.keys()) visit(n)

  let max = 0
  for (const d of steps.values()) max = Math.max(max, d)
  const out = new Map([...steps].map(([id, d]) => [id, max ? d / max : 0.5]))
  cache.set(graph, out)
  return out
}
