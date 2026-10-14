import type { Graph, Layout, Vec2 } from '../model/types'

/**
 * Instant stand-in for `autoLayout`: each layer's cards on a golden-angle spiral (the same seed the
 * force pass starts from), O(n). Shown while the real layout runs in a worker; cards then ease to it.
 */
export function seedLayout(graph: Graph, layerGap = 8): Layout {
  const positions: Record<string, Vec2> = {}
  const count = new Map<string, number>()
  for (const t of graph.tables) {
    const i = count.get(t.layerId) ?? 0
    count.set(t.layerId, i + 1)
    const angle = i * 2.399963
    const rad = 3 * Math.sqrt(i + 0.5)
    positions[t.id] = { x: rad * Math.cos(angle), z: rad * Math.sin(angle) }
  }
  return { layerGap, layerOrder: graph.layers.map((l) => l.id), positions }
}
