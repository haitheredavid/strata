import { fkEnds } from '../view/deriveView'
import type { ViewEdge } from '../view/deriveView'

type Edge = Pick<ViewEdge, 'from' | 'to' | 'kind'> & { count?: number }

/**
 * Longest-path layering over the FK graph: tables that reference nothing (masters, lookups) get 0,
 * every referencing table sits one past its deepest parent. Cycles (self refs, mutual FKs) are broken
 * by dropping DFS back-edges, visiting nodes in the given order so results are deterministic.
 */
export function fkDepth(nodes: string[], edges: Edge[]): Map<string, number> {
  const ids = new Set(nodes)
  const parents = new Map<string, string[]>(nodes.map((n) => [n, []]))
  for (const e of edges) {
    const { child, parent } = fkEnds(e)
    if (child === parent || !ids.has(child) || !ids.has(parent)) continue
    parents.get(child)!.push(parent)
  }

  const depth = new Map<string, number>()
  const onStack = new Set<string>()
  const visit = (n: string): number => {
    const known = depth.get(n)
    if (known !== undefined) return known
    onStack.add(n)
    let d = 0
    for (const p of parents.get(n)!) if (!onStack.has(p)) d = Math.max(d, visit(p) + 1)
    onStack.delete(n)
    depth.set(n, d)
    return d
  }
  for (const n of nodes) visit(n)
  return depth
}

/**
 * Orders domains upstream-first: a domain is placed once every domain it references is placed.
 * When a cycle leaves nothing ready, the domain with the most net incoming references goes next.
 */
export function domainRank(layerIds: string[], layerOf: (node: string) => string | undefined, edges: Edge[]): string[] {
  const parents = new Map<string, Set<string>>(layerIds.map((l) => [l, new Set()]))
  const score = new Map<string, number>(layerIds.map((l) => [l, 0]))
  for (const e of edges) {
    const { child, parent } = fkEnds(e)
    const cl = layerOf(child)
    const pl = layerOf(parent)
    if (!cl || !pl || cl === pl || !parents.has(cl) || !parents.has(pl)) continue
    parents.get(cl)!.add(pl)
    // Merged edges (collapsed domains) carry their ref count so collapsing doesn't reorder domains.
    const w = e.count ?? 1
    score.set(pl, score.get(pl)! + w)
    score.set(cl, score.get(cl)! - w)
  }

  const order: string[] = []
  const placed = new Set<string>()
  while (order.length < layerIds.length) {
    const left = layerIds.filter((l) => !placed.has(l))
    const ready = left.filter((l) => [...parents.get(l)!].every((p) => placed.has(p)))
    const pool = ready.length ? ready : left
    const next = pool.reduce((best, l) => (score.get(l)! > score.get(best)! ? l : best), pool[0])
    order.push(next)
    placed.add(next)
  }
  return order
}
