import type { Layout, Vec2 } from '../../model/types'
import { SOURCES } from '../../view/deriveView'
import type { ViewGraph, ViewNode } from '../../view/deriveView'
import { autoLayoutView } from '../autoLayout'
import { cardRect } from '../geometry'
import type { Mode, NodePlace, Placement, PlatePlace } from './types'

const PAD = 1.5
const LABEL_ROOM = 1

/** Layer heights: `layerOrder` for domains, fixed bronze → gold for medallions; sources sit below. */
export const layerY = (layout: Layout, layerId: string, view?: ViewGraph) => {
  if (layerId === SOURCES) return -layout.layerGap
  const order = layout.groupBy === 'medallion' && view ? view.layers.map((l) => l.id).filter((id) => id !== SOURCES) : layout.layerOrder
  const i = order.indexOf(layerId)
  return (i < 0 ? 0 : i) * layout.layerGap
}

/**
 * Center of a node on its layer plane. Domain grouping uses the stored positions; medallion grouping
 * (and anything without a stored position, like external sources) uses an auto layout of the view.
 * Collapsed domains sit at the centroid of their tables.
 */
function stackPos(n: ViewNode, layout: Layout, view: ViewGraph): Vec2 {
  const medallion = layout.groupBy === 'medallion'
  const stored = medallion ? layout.medallionPositions ?? {} : layout.positions
  // Nodes with no stored position (sources, medallion grouping) keep drags in `medallionPositions`.
  const at = (id: string) => stored[id] ?? layout.medallionPositions?.[id] ?? autoLayoutView(view)[id]
  if (!n.members) return at(n.id) ?? { x: 0, z: 0 }
  const ps = n.members.map((id) => (medallion ? undefined : layout.positions[id])).filter((p): p is Vec2 => !!p)
  if (!ps.length) return at(n.id) ?? { x: 0, z: 0 }
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length }
}

/** Each domain is a horizontal plate, stacked on Y in `layerOrder`. */
export function placeStack(view: ViewGraph, layout: Layout): Placement {
  const nodes: Record<string, NodePlace> = {}
  const plates: PlatePlace[] = []

  for (const l of view.layers) {
    const members = view.nodes.filter((n) => n.layerId === l.id)
    if (!members.length) continue
    const y = layerY(layout, l.id, view)
    const rects = members.map((n) => {
      const p = stackPos(n, layout, view)
      nodes[n.id] = { p: [p.x, y, p.z], frame: 'flat', plateId: l.id }
      return cardRect(n, p)
    })
    const x0 = Math.min(...rects.map((r) => r.x0)) - PAD
    const x1 = Math.max(...rects.map((r) => r.x1)) + PAD
    const z0 = Math.min(...rects.map((r) => r.z0)) - PAD
    const z1 = Math.max(...rects.map((r) => r.z1)) + PAD + LABEL_ROOM
    plates.push({
      id: l.id,
      center: [(x0 + x1) / 2, y - 0.02, (z0 + z1) / 2],
      size: [x1 - x0, z1 - z0],
      frame: 'flat',
      label: l.name,
      color: l.color,
    })
  }
  return { nodes, plates }
}

export const stackMode: Mode = {
  id: 'stack',
  label: 'Stack',
  draggable: true,
  defaultPreset: 'iso',
  gapLabel: 'Layer gap',
  place: (view, layout) => placeStack(view, layout),
}
