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

/** Buckets `xs` by `key`, keeping `val` of each, in input order. */
export function groupBy<T, V>(xs: readonly T[], key: (x: T) => string, val: (x: T) => V): Map<string, V[]> {
  const m = new Map<string, V[]>()
  for (const x of xs) {
    const k = key(x)
    const list = m.get(k)
    if (list) list.push(val(x))
    else m.set(k, [val(x)])
  }
  return m
}

interface Base {
  pos: Map<string, { x: number; y: number; z: number }>
  order: string[]
}

let cache: { view: ViewGraph; key: string; base: Base } | null = null
let scaled: { base: Base; gap: number; out: Base } | null = null

/**
 * flowBase for a layout: the row ordering doesn't depend on the gap, only the slab x positions do
 * (linearly), so the expensive part is cached per order and just rescaled when the gap changes.
 */
export function flowBase(view: ViewGraph, layout: Pick<Layout, 'flowOrder' | 'layerGap' | 'groupBy'>): Base {
  const base = flowBaseUnit(view, layout)
  if (scaled && scaled.base === base && scaled.gap === layout.layerGap) return scaled.out
  const pos = new Map<string, { x: number; y: number; z: number }>()
  for (const [id, p] of base.pos) pos.set(id, { x: p.x * layout.layerGap, y: p.y, z: p.z })
  const out = { pos, order: base.order }
  scaled = { base, gap: layout.layerGap, out }
  return out
}

/**
 * Left-to-right layered layout: each domain is an upright slab facing +X, upstream domains first along X.
 * Across a slab (world -Z, i.e. left to right as seen from the front), sub-columns follow the
 * domain-local FK depth with referenced tables first. Rows are ordered by barycenter sweeps against
 * neighbors in every other column to cut down crossings.
 */
function flowBaseUnit(view: ViewGraph, layout: Pick<Layout, 'flowOrder' | 'groupBy'>): Base {
  const order = flowOrder(view, layout)
  const key = order.join(',')
  if (cache && cache.view === view && cache.key === key) return cache.base

  const byId = new Map(view.nodes.map((n) => [n.id, n]))
  const neighbors = new Map<string, string[]>(view.nodes.map((n) => [n.id, []]))
  for (const e of view.edges) {
    if (e.from === e.to) continue
    neighbors.get(e.from)?.push(e.to)
    neighbors.get(e.to)?.push(e.from)
  }
  // Lineage counts too: what a job reads sits near what it writes.
  const readsOf = groupBy(view.flows, (f) => f.to, (f) => f.from)
  const writesOf = groupBy(view.flows, (f) => f.from, (f) => f.to)
  for (const job of view.nodes) {
    if (job.kind !== 'job') continue
    const reads = readsOf.get(job.id) ?? []
    const writes = writesOf.get(job.id) ?? []
    for (const r of reads)
      for (const w of writes) {
        if (r === w) continue
        neighbors.get(r)?.push(w)
        neighbors.get(w)?.push(r)
      }
  }

  const idsOf = groupBy(view.nodes.filter((n) => n.kind !== 'job'), (n) => n.layerId, (n) => n.id)
  const innerOf = groupBy(
    view.edges.filter((e) => {
      const a = byId.get(e.from)?.layerId
      return a !== undefined && a === byId.get(e.to)?.layerId
    }),
    (e) => byId.get(e.from)!.layerId,
    (e) => e,
  )

  const columns: { x: number; z: number; ids: string[] }[] = []
  let cursor = 0
  for (const layerId of order) {
    const ids = idsOf.get(layerId) ?? []
    if (!ids.length) continue
    const depth = fkDepth(ids, innerOf.get(layerId) ?? [])
    let subs = 0
    for (const id of ids) subs = Math.max(subs, depth.get(id)! + 1)
    const bySub: string[][] = Array.from({ length: subs }, () => [])
    for (const id of ids) bySub[depth.get(id)!].push(id)
    bySub.forEach((sub, d) => columns.push({ x: cursor, z: ((subs - 1) / 2 - d) * SUB_STEP, ids: sub }))
    cursor += SLAB_SPACING // per unit of layer gap; flowBase scales it
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
  const membersOf = groupBy(view.nodes, (n) => n.layerId, (n) => n)
  for (const l of view.layers) {
    const members = membersOf.get(l.id)
    if (!members) continue
    let z0 = Infinity
    let z1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    let x = 0
    members.forEach((n, i) => {
      const b = { ...pos.get(n.id)!, ...overrides[n.id] }
      const h = cardDepth(n)
      if (i === 0) x = b.x
      z0 = Math.min(z0, b.z - CARD_W / 2)
      z1 = Math.max(z1, b.z + CARD_W / 2)
      y0 = Math.min(y0, b.y - h / 2)
      y1 = Math.max(y1, b.y + h / 2)
    })
    z0 -= PAD
    z1 += PAD
    y0 -= PAD
    y1 += PAD + LABEL_ROOM
    const center: V3 = [x - 0.05, (y0 + y1) / 2, (z0 + z1) / 2]
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
