import type { ViewGraph } from './deriveView'

export interface Path {
  nodes: string[]
  edges: string[]
}

interface Options {
  /** Also return paths up to this many hops longer than the shortest. */
  maxExtra?: number
  cap?: number
  /** Nodes that may not appear inside a path (endpoints are always allowed). */
  ignore?: string[]
}

/** All simple join paths between `a` and `b`, shortest first (FK direction ignored). */
export function findPaths(view: Pick<ViewGraph, 'edges'>, a: string, b: string, opts: Options = {}): Path[] {
  const { maxExtra = 1, cap = 20 } = opts
  const ignore = new Set(opts.ignore ?? [])
  if (a === b) return []

  const adj = new Map<string, { to: string; edge: string }[]>()
  const link = (x: string, y: string, edge: string) => {
    if (!adj.has(x)) adj.set(x, [])
    adj.get(x)!.push({ to: y, edge })
  }
  for (const e of view.edges) {
    if (e.from === e.to) continue
    link(e.from, e.to, e.id)
    link(e.to, e.from, e.id)
  }
  const passable = (n: string) => n === b || !ignore.has(n)

  // Shortest distance to `b` from every node bounds the DFS.
  const distToB = new Map([[b, 0]])
  let frontier = [b]
  while (frontier.length) {
    const next: string[] = []
    for (const n of frontier)
      for (const { to } of adj.get(n) ?? [])
        if (!distToB.has(to) && (to === a || passable(to))) {
          distToB.set(to, distToB.get(n)! + 1)
          next.push(to)
        }
    frontier = next
  }
  const shortest = distToB.get(a)
  if (shortest === undefined) return []
  const limit = shortest + maxExtra

  const out: Path[] = []
  const nodes = [a]
  const edges: string[] = []
  const seen = new Set([a])
  const dfs = (n: string) => {
    if (out.length >= cap * 4) return
    if (n === b) {
      out.push({ nodes: [...nodes], edges: [...edges] })
      return
    }
    for (const { to, edge } of adj.get(n) ?? []) {
      if (seen.has(to) || !passable(to)) continue
      const rest = distToB.get(to)
      if (rest === undefined || edges.length + 1 + rest > limit) continue
      seen.add(to)
      nodes.push(to)
      edges.push(edge)
      dfs(to)
      seen.delete(to)
      nodes.pop()
      edges.pop()
    }
  }
  dfs(a)

  return out.sort((p, q) => p.edges.length - q.edges.length).slice(0, cap)
}
