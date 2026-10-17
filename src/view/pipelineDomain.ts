import type { Graph } from '../model/types'

/**
 * Past this many pipelines, distinct colours stop being distinguishable: pipelines take their domain's
 * hue (shaded apart within it), and flow lanes only show for lit pipelines.
 */
export const MANY_PIPELINES = 12

const cache = new WeakMap<Graph, Map<string, string | undefined>>()

/** Each pipeline's domain: the layer most of the tables it writes are in (undefined when it writes none). Cached per graph. */
export function pipelineDomains(graph: Graph): Map<string, string | undefined> {
  let out = cache.get(graph)
  if (out) return out
  const layerOf = new Map(graph.tables.map((t) => [t.id, t.layerId]))
  out = new Map()
  for (const p of graph.workflows.pipelines) {
    const n = new Map<string, number>()
    for (const t of p.tasks)
      for (const w of t.writes) {
        const l = layerOf.get(w)
        if (l) n.set(l, (n.get(l) ?? 0) + 1)
      }
    out.set(p.id, [...n].sort((a, b) => b[1] - a[1])[0]?.[0])
  }
  cache.set(graph, out)
  return out
}
