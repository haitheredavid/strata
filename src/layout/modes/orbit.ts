import type { Layout } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import { hops } from '../../view/hops'
import type { Hop } from '../../view/hops'
import type { Mode, ModeCtx, NodePlace, Placement, Ring } from './types'

const SLOT = 6 // arc length per card on a ring
const ELEVATION = 0.6 // radians above / below the equator for hop rings
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Most connected node: the default center when nothing is focused. */
export function hub(view: ViewGraph): string | null {
  const degree = new Map<string, number>()
  for (const e of view.edges) {
    if (e.from === e.to) continue
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  let best: string | null = view.nodes[0]?.id ?? null
  for (const n of view.nodes) if ((degree.get(n.id) ?? 0) > (degree.get(best!) ?? 0)) best = n.id
  return best
}

/**
 * Ego layout: the center table at the origin, referenced tables on rings above it and referencing
 * tables on rings below, one ring per hop. Rings are sorted by domain so domains stay together.
 * Everything outside the hop range lies faded at the equator, filling rings outward a card's width
 * apart (in domain order), so hundreds of them make a compact disk rather than one huge ring.
 */
export function placeOrbit(view: ViewGraph, layout: Layout, ctx: ModeCtx): Placement {
  const nodes: Record<string, NodePlace> = {}
  const rings: Ring[] = []
  const center = ctx.focusedId && view.nodes.some((n) => n.id === ctx.focusedId) ? ctx.focusedId : hub(view)
  if (!center) return { nodes, plates: [] }

  const reach: Map<string, Hop> = ctx.hops && ctx.focusedId === center ? ctx.hops : hops(view, center, ctx.hopUp, ctx.hopDown)
  const layerRank = new Map(layout.layerOrder.map((id, i) => [id, i]))
  const byId = new Map(view.nodes.map((n) => [n.id, n]))
  const sortKey = (id: string) => {
    const n = byId.get(id)!
    return `${String(layerRank.get(n.layerId) ?? 99).padStart(3, '0')}|${n.name}`
  }
  const base = layout.layerGap + 4

  const groups = new Map<string, string[]>() // `${dir}:${hop}` -> ids
  for (const [id, h] of reach) {
    if (h.dir === 0 || !byId.has(id) || byId.get(id)!.kind === 'job') continue
    const k = `${h.dir}:${h.hop}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(id)
  }

  nodes[center] = { p: [0, 0, 0], frame: 'billboard' }
  let outer = base
  for (const [k, ids] of groups) {
    const [dir, hop] = k.split(':').map(Number)
    ids.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    const r = Math.max(hop * base, (ids.length * SLOT) / (2 * Math.PI * Math.cos(ELEVATION)))
    const ringR = r * Math.cos(ELEVATION)
    const y = -dir * r * Math.sin(ELEVATION) // upstream (dir -1) above
    // Offset successive hops so cards on neighboring rings don't line up behind each other.
    const phase = hop * 0.5
    ids.forEach((id, i) => {
      const a = phase + (2 * Math.PI * (i + 0.5)) / ids.length
      nodes[id] = { p: [ringR * Math.cos(a), y, ringR * Math.sin(a)], frame: 'billboard' }
    })
    rings.push({ y, r: ringR })
    outer = Math.max(outer, r)
  }

  const rest = view.nodes.filter((n) => !nodes[n.id] && n.kind !== 'job').map((n) => n.id).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  let r = outer + base
  for (let i = 0, k = 0; i < rest.length; r += SLOT, k++) {
    const ring = rest.slice(i, i + Math.max(1, Math.floor((2 * Math.PI * r) / SLOT)))
    // Each ring starts a golden angle on from the last: staggered, and no two cards mirror each other.
    const start = (k + 0.1) * GOLDEN_ANGLE
    ring.forEach((id, j) => {
      const a = start + (2 * Math.PI * (j + 0.5)) / ring.length
      nodes[id] = { p: [r * Math.cos(a), 0, r * Math.sin(a)], frame: 'billboard', faded: true }
    })
    // Guides at the disk's inner and outer edge only.
    if (i === 0 || i + ring.length >= rest.length) rings.push({ y: 0, r })
    i += ring.length
  }

  return { nodes, plates: [], rings }
}

export const orbitMode: Mode = {
  id: 'orbit',
  label: 'Orbit',
  draggable: false,
  defaultPreset: 'iso',
  gapLabel: 'Shell gap',
  place: placeOrbit,
}
