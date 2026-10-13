import type { Layout } from '../../model/types'
import { SOURCES } from '../../view/deriveView'
import type { ViewGraph } from '../../view/deriveView'
import { CARD_W, cardDepth } from '../geometry'
import { domainRank, fkDepth } from '../depth'
import type { Mode, NodePlace, Placement, PlatePlace, V3 } from './types'

const SUB_STEP = CARD_W + 3 // between FK-depth sub-columns across a slab
const V_GAP = 1.2
const PAD = 1.5
const LABEL_ROOM = 1.2
const POP = 1.2 // focus pop-out per hop, off the slab along +X
const SWEEPS = 4
/** Slab spacing along X is this multiple of the layer gap. */
const SLAB_SPACING = 2

/**
 * Slab order, left to right. External sources always come first. Medallion grouping is fixed
 * (bronze → silver → gold); domains use the saved order if it still matches, else upstream-first FK rank.
 */
export function flowOrder(view: ViewGraph, layout: Pick<Layout, 'flowOrder' | 'groupBy'>): string[] {
  const all = view.layers.map((l) => l.id)
  const head = all.includes(SOURCES) ? [SOURCES] : []
  const ids = all.filter((id) => id !== SOURCES)
  if (layout.groupBy === 'medallion') return [...head, ...ids]
  const saved = layout.flowOrder?.filter((id) => ids.includes(id))
  if (saved && saved.length === ids.length) return [...head, ...saved]
  const layerOf = new Map(view.nodes.map((n) => [n.id, n.layerId]))
  return [...head, ...domainRank(ids, (n) => layerOf.get(n), view.edges)]
}

interface Base {
  pos: Map<string, { x: number; y: number; z: number }>
  order: string[]
}

let cache: { view: ViewGraph; key: string; base: Base } | null = null

/**
 * Left-to-right layered layout: each domain is an upright slab facing +X, upstream domains first along X.
 * Across a slab (world -Z, i.e. left to right as seen from the front), sub-columns follow the
 * domain-local FK depth with referenced tables first. Rows are ordered by barycenter sweeps against
 * neighbors in every other column to cut down crossings.
 */
export function flowBase(view: ViewGraph, layout: Pick<Layout, 'flowOrder' | 'layerGap' | 'groupBy'>): Base {
  const order = flowOrder(view, layout)
  const key = `${layout.layerGap}|${order.join(',')}`
  if (cache && cache.view === view && cache.key === key) return cache.base

  const byId = new Map(view.nodes.map((n) => [n.id, n]))
  const neighbors = new Map<string, string[]>(view.nodes.map((n) => [n.id, []]))
  for (const e of view.edges) {
    if (e.from === e.to) continue
    neighbors.get(e.from)?.push(e.to)
    neighbors.get(e.to)?.push(e.from)
  }
  // Lineage counts too: what a job reads sits near what it writes.
  for (const job of view.nodes.filter((n) => n.kind === 'job')) {
    const reads = view.flows.filter((f) => f.to === job.id).map((f) => f.from)
    const writes = view.flows.filter((f) => f.from === job.id).map((f) => f.to)
    for (const r of reads)
      for (const w of writes) {
        if (r === w) continue
        neighbors.get(r)?.push(w)
        neighbors.get(w)?.push(r)
      }
  }

  const columns: { x: number; z: number; ids: string[] }[] = []
  let cursor = 0
  for (const layerId of order) {
    const ids = view.nodes.filter((n) => n.layerId === layerId && n.kind !== 'job').map((n) => n.id)
    if (!ids.length) continue
    const inner = view.edges.filter((e) => byId.get(e.from)?.layerId === layerId && byId.get(e.to)?.layerId === layerId)
    const depth = fkDepth(ids, inner)
    const subs = Math.max(...ids.map((id) => depth.get(id)!)) + 1
    for (let d = 0; d < subs; d++)
      columns.push({ x: cursor, z: ((subs - 1) / 2 - d) * SUB_STEP, ids: ids.filter((id) => depth.get(id) === d) })
    cursor += layout.layerGap * SLAB_SPACING
  }

  const pos = new Map<string, { x: number; y: number; z: number }>()
  const stackColumn = (c: { x: number; z: number; ids: string[] }) => {
    const hs = c.ids.map((id) => cardDepth(byId.get(id)!))
    let y = (hs.reduce((s, h) => s + h, 0) + V_GAP * (hs.length - 1)) / 2
    c.ids.forEach((id, i) => {
      pos.set(id, { x: c.x, y: y - hs[i] / 2, z: c.z })
      y -= hs[i] + V_GAP
    })
  }
  columns.forEach(stackColumn)

  for (let s = 0; s < SWEEPS; s++) {
    const pass = s % 2 === 0 ? columns : [...columns].reverse()
    for (const c of pass) {
      const own = new Set(c.ids)
      const key = new Map(
        c.ids.map((id) => {
          const ys = neighbors.get(id)!.filter((n) => !own.has(n) && pos.has(n)).map((n) => pos.get(n)!.y)
          return [id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : pos.get(id)!.y]
        }),
      )
      c.ids = [...c.ids].sort((a, b) => key.get(b)! - key.get(a)! || pos.get(b)!.y - pos.get(a)!.y)
      stackColumn(c)
    }
  }

  const base = { pos, order }
  cache = { view, key, base }
  return base
}

export function placeFlow(view: ViewGraph, layout: Layout, ctx: { hops: Map<string, { hop: number }> | null; hopUp: number; hopDown: number }): Placement {
  const { pos } = flowBase(view, layout)
  const overrides = layout.flowOverrides ?? {}
  const maxHop = Math.max(ctx.hopUp, ctx.hopDown)
  const nodes: Record<string, NodePlace> = {}
  for (const n of view.nodes) {
    if (n.kind === 'job') continue
    const p = { ...pos.get(n.id)!, ...overrides[n.id] }
    const h = ctx.hops?.get(n.id)
    const pop = h ? (maxHop + 1 - h.hop) * POP : 0
    nodes[n.id] = { p: [p.x + pop, p.y, p.z], frame: 'side', plateId: n.layerId }
  }

  const plates: PlatePlace[] = []
  for (const l of view.layers) {
    const members = view.nodes.filter((n) => n.layerId === l.id)
    if (!members.length) continue
    const boxes = members.map((n) => ({ p: pos.get(n.id)!, o: overrides[n.id], h: cardDepth(n) }))
    const at = boxes.map((b) => ({ ...b.p, ...b.o, h: b.h }))
    const z0 = Math.min(...at.map((b) => b.z - CARD_W / 2)) - PAD
    const z1 = Math.max(...at.map((b) => b.z + CARD_W / 2)) + PAD
    const y0 = Math.min(...at.map((b) => b.y - b.h / 2)) - PAD
    const y1 = Math.max(...at.map((b) => b.y + b.h / 2)) + PAD + LABEL_ROOM
    const center: V3 = [at[0].x - 0.05, (y0 + y1) / 2, (z0 + z1) / 2]
    plates.push({ id: l.id, center, size: [z1 - z0, y1 - y0], frame: 'side', label: l.name, color: l.color })
  }
  return { nodes, plates }
}

export const flowMode: Mode = {
  id: 'flow',
  label: 'Flow',
  draggable: true,
  defaultPreset: 'side',
  gapLabel: 'Column gap',
  place: placeFlow,
}
