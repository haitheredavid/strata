import type { Layout, Vec2 } from '../../model/types'
import { SOURCES } from '../../view/deriveView'
import type { ViewGraph, ViewNode } from '../../view/deriveView'
import { autoLayoutView } from '../autoLayout'
import { cardRect } from '../geometry'
import type { Mode, NodePlace, Placement, PlatePlace } from './types'

const PAD = 1.5
const LABEL_ROOM = 1

/** Above this many tables a filtered view keeps the stored positions (re-laying it out would stall). */
const MAX_DERIVED = 150

/**
 * True when the stack lays out the view itself instead of using the stored positions: medallion
 * grouping, or a pipeline table filter leaving few enough tables that the full layout would scatter them.
 */
export function derivedStack(layout: Layout, view?: ViewGraph) {
  if (layout.groupBy === 'medallion') return true
  return !!layout.pipelineTablesOnly && !!view && view.nodes.filter((n) => n.kind === 'table').length <= MAX_DERIVED
}

/** Layer heights: `layerOrder` for domains, fixed bronze → gold for medallions; sources sit below. Derived layouts close gaps. */
export const layerY = (layout: Layout, layerId: string, view?: ViewGraph) => {
  if (layerId === SOURCES) return -layout.layerGap
  const shown = view && derivedStack(layout, view) ? new Set(view.layers.map((l) => l.id)) : null
  const order = layout.groupBy === 'medallion' && view
    ? view.layers.map((l) => l.id).filter((id) => id !== SOURCES)
    : shown ? layout.layerOrder.filter((id) => shown.has(id)) : layout.layerOrder
  const i = order.indexOf(layerId)
  return (i < 0 ? 0 : i) * layout.layerGap
}

/**
 * Center of a node on its layer plane. Domain grouping uses the stored positions; medallion grouping
 * (and anything without a stored position, like external sources) uses an auto layout of the view.
 * Collapsed domains sit at the centroid of their tables.
 */
function stackPos(n: ViewNode, layout: Layout, medallion: boolean, auto: () => Record<string, Vec2>): Vec2 {
  const stored = medallion ? layout.medallionPositions ?? {} : layout.positions
  // Nodes with no stored position (sources, medallion grouping) keep drags in `medallionPositions`.
  const at = (id: string) => stored[id] ?? layout.medallionPositions?.[id] ?? auto()[id]
  if (!n.members) return at(n.id) ?? { x: 0, z: 0 }
  const ps = n.members.map((id) => (medallion ? undefined : layout.positions[id])).filter((p): p is Vec2 => !!p)
  if (!ps.length) return at(n.id) ?? { x: 0, z: 0 }
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length }
}

/** Each domain is a horizontal plate, stacked on Y in `layerOrder`. */
export function placeStack(view: ViewGraph, layout: Layout): Placement {
  const nodes: Record<string, NodePlace> = {}
  const plates: PlatePlace[] = []
  const membersOf = new Map<string, ViewNode[]>(view.layers.map((l) => [l.id, []]))
  for (const n of view.nodes) membersOf.get(n.layerId)?.push(n)
  const derived = derivedStack(layout, view)

  // Auto layout only what has no stored position: everything in a derived stack, else the
  // layers holding such nodes (external sources). Computed on first use.
  let auto: Record<string, Vec2> | null = null
  const autoPos = () => {
    if (auto) return auto
    const stored = derived ? null : layout.positions
    const missing = stored
      ? view.layers.filter((l) => membersOf.get(l.id)!.some((n) => !n.members && !stored[n.id] && !layout.medallionPositions?.[n.id])).map((l) => l.id)
      : undefined
    return (auto = autoLayoutView(view, missing))
  }

  for (const l of view.layers) {
    const members = membersOf.get(l.id)!
    if (!members.length) continue
    const y = layerY(layout, l.id, view)
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const n of members) {
      const p = stackPos(n, layout, derived, autoPos)
      nodes[n.id] = { p: [p.x, y, p.z], frame: 'flat', plateId: l.id }
      const r = cardRect(n, p)
      x0 = Math.min(x0, r.x0)
      x1 = Math.max(x1, r.x1)
      z0 = Math.min(z0, r.z0)
      z1 = Math.max(z1, r.z1)
    }
    x0 -= PAD
    x1 += PAD
    z0 -= PAD
    z1 += PAD + LABEL_ROOM
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
