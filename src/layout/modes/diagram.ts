import type { Layout } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import { CARD_W, cardRect } from '../geometry'
import { flowBase, groupBy } from './flow'
import type { Mode, NodePlace, Placement, PlatePlace } from './types'

const SUB_STEP = CARD_W + 2.5 // between sub-columns of one domain
const PAD = 1.5
const LABEL_ROOM = 1.2

/**
 * Flow's arrangement laid flat on the ground for a top-down, near-orthographic read: the same domain
 * order, FK-depth sub-columns and row order, so switching between the two shows each slab tipping over
 * into its column. Domains run left to right along X, each sub-column its own X, rows top to bottom
 * along +Z. Jobs land in the gaps between domains.
 */
export function placeDiagram(view: ViewGraph, layout: Layout): Placement {
  const { pos, order } = flowBase(view, layout)
  const nodes: Record<string, NodePlace> = {}
  const plates: PlatePlace[] = []
  const byLayer = new Map(view.layers.map((l) => [l.id, l]))

  const membersOf = groupBy(view.nodes.filter((n) => n.kind !== 'job' && pos.has(n.id)), (n) => n.layerId, (n) => n)

  let cursor = 0
  for (const layerId of order) {
    const members = membersOf.get(layerId)
    if (!members) continue
    // Flow runs sub-columns along -Z across its slab; here they run along +X.
    const zs = [...new Set(members.map((n) => pos.get(n.id)!.z))].sort((a, b) => b - a)
    const subOf = new Map(zs.map((z, i) => [z, i]))
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const n of members) {
      const p = pos.get(n.id)!
      const x = cursor + subOf.get(p.z)! * SUB_STEP
      nodes[n.id] = { p: [x, 0, -p.y], frame: 'flat', plateId: layerId }
      const r = cardRect(n, { x, z: -p.y })
      x0 = Math.min(x0, r.x0)
      x1 = Math.max(x1, r.x1)
      z0 = Math.min(z0, r.z0)
      z1 = Math.max(z1, r.z1)
    }
    cursor += (zs.length - 1) * SUB_STEP + CARD_W + layout.layerGap * 1.5

    const l = byLayer.get(layerId)!
    x0 -= PAD
    x1 += PAD
    z0 -= PAD
    z1 += PAD + LABEL_ROOM
    plates.push({ id: l.id, center: [(x0 + x1) / 2, -0.02, (z0 + z1) / 2], size: [x1 - x0, z1 - z0], frame: 'flat', label: l.name, color: l.color })
  }
  return { nodes, plates }
}

export const diagramMode: Mode = {
  id: 'diagram',
  label: 'Diagram',
  draggable: false,
  defaultPreset: 'top',
  gapLabel: 'Column gap',
  place: (view, layout) => placeDiagram(view, layout),
}
