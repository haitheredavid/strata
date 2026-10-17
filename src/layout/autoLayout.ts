import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum } from 'd3-force'
import type { Graph, Layout, Vec2 } from '../model/types'
import { EMPTY_WORKFLOWS } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { CARD_W, cardDepth } from './geometry'
import { GridHash } from './gridHash'

interface Node extends SimulationNodeDatum {
  id: string
  r: number
  tx: number
  tz: number
  pull: number
}

const MARGIN = 0.6
/** Force ticks per layer: fewer on big layers, where each tick costs more and the overlap pass cleans up. */
const ticksFor = (n: number) => (n < 500 ? 300 : n < 5000 ? 150 : 80)
/** Past this many tables in the whole graph, every layer gets a short, fast-cooling force pass. */
const BIG_GRAPH = 5000
const BIG_TICKS = 90
/** d3's default alpha decay cools to alphaMin in ~300 ticks; this cools in `ticks`. */
const decayFor = (ticks: number) => 1 - Math.pow(0.001, 1 / ticks)

function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function autoLayout(graph: Graph, layerGap = 8): Layout {
  const layerOrder = graph.layers.map((l) => l.id)
  const positions: Record<string, Vec2> = {}
  const tableById = new Map(graph.tables.map((t) => [t.id, t]))

  const neighbors = new Map<string, Set<string>>()
  for (const r of graph.refs) {
    if (r.from.table === r.to.table) continue
    if (!neighbors.has(r.from.table)) neighbors.set(r.from.table, new Set())
    if (!neighbors.has(r.to.table)) neighbors.set(r.to.table, new Set())
    neighbors.get(r.from.table)!.add(r.to.table)
    neighbors.get(r.to.table)!.add(r.from.table)
  }

  // One pass to bucket tables and same-layer links by layer, instead of a scan per layer.
  const tablesOf = new Map<string, Graph['tables']>(layerOrder.map((id) => [id, []]))
  for (const t of graph.tables) tablesOf.get(t.layerId)?.push(t)
  const linksOf = new Map<string, { source: string; target: string }[]>(layerOrder.map((id) => [id, []]))
  for (const r of graph.refs) {
    const a = tableById.get(r.from.table)
    const b = tableById.get(r.to.table)
    if (a && b && a !== b && a.layerId === b.layerId) linksOf.get(a.layerId)?.push({ source: a.id, target: b.id })
  }

  for (const layerId of layerOrder) {
    const tables = tablesOf.get(layerId)!
    const ids = new Set(tables.map((t) => t.id))

    const nodes: Node[] = tables.map((t, i) => {
      // Pull toward already-placed neighbors on other layers so vertical wires stay short.
      const placed = [...(neighbors.get(t.id) ?? [])].filter((n) => positions[n] && !ids.has(n))
      const tx = placed.length ? placed.reduce((s, n) => s + positions[n].x, 0) / placed.length : 0
      const tz = placed.length ? placed.reduce((s, n) => s + positions[n].z, 0) / placed.length : 0
      const angle = i * 2.399963 // golden-angle spiral seed: deterministic and spread out
      const rad = 3 * Math.sqrt(i + 0.5)
      return {
        id: t.id,
        r: Math.hypot(CARD_W, cardDepth(t)) / 2 + MARGIN,
        tx,
        tz,
        pull: placed.length ? 0.15 : 0.1,
        x: tx + rad * Math.cos(angle),
        y: tz + rad * Math.sin(angle),
      }
    })

    const links = linksOf.get(layerId)!

    // Big graphs: hundreds of small layers each paying the full 300 ticks is most of the cost, and the
    // overlap pass below cleans up what a shorter run leaves.
    const ticks = graph.tables.length > BIG_GRAPH ? Math.min(BIG_TICKS, ticksFor(nodes.length)) : ticksFor(nodes.length)
    forceSimulation(nodes)
      .alphaDecay(decayFor(ticks))
      .randomSource(lcg(42))
      .force('link', forceLink<Node, { source: string; target: string }>(links).id((n) => n.id).distance(6).strength(0.5))
      .force('charge', forceManyBody().strength(-20).distanceMax(12))
      .force('x', forceX<Node>((n) => n.tx).strength((n) => n.pull))
      .force('y', forceY<Node>((n) => n.tz).strength((n) => n.pull))
      .force('collide', forceCollide<Node>((n) => n.r).strength(1).iterations(4))
      .stop()
      .tick(ticks)

    for (const n of nodes) positions[n.id] = { x: n.x!, z: n.y! }
    resolveOverlaps(tables, positions)
  }

  return { layerGap, layerOrder, positions }
}

/**
 * Push apart any card rectangles that still overlap after the force pass. A grid with cells as big as
 * the largest card finds the overlapping pairs, so each pass is O(n) rather than all pairs.
 */
function resolveOverlaps(tables: Graph['tables'], pos: Record<string, Vec2>) {
  const n = tables.length
  if (n < 2) return
  const halfD = new Float64Array(n)
  let cell = CARD_W
  tables.forEach((t, i) => {
    halfD[i] = cardDepth(t) / 2
    cell = Math.max(cell, halfD[i] * 2)
  })
  const ps = tables.map((t) => pos[t.id])
  const halfW = CARD_W / 2
  const grid = new GridHash(cell)
  const near: number[] = []
  for (let iter = 0; iter < 200; iter++) {
    grid.clear()
    ps.forEach((p, i) => grid.insert(i, p.x, p.z))
    let moved = false
    for (let i = 0; i < n; i++) {
      const a = ps[i]
      grid.near(near, 2, a.x, a.z)
      near.sort((x, y) => x - y) // same pair order as an all-pairs scan
      for (const j of near) {
        if (j <= i) continue
        const b = ps[j]
        const ox = 2 * halfW - Math.abs(a.x - b.x)
        const oz = halfD[i] + halfD[j] - Math.abs(a.z - b.z)
        if (ox <= 0 || oz <= 0) continue
        moved = true
        // Separate along the axis of least overlap.
        if (ox < oz) {
          const d = (ox / 2 + 0.05) * (a.x <= b.x ? -1 : 1)
          a.x += d
          b.x -= d
        } else {
          const d = (oz / 2 + 0.05) * (a.z <= b.z ? -1 : 1)
          a.z += d
          b.z -= d
        }
      }
    }
    if (!moved) return
  }
}

/** A few recent view layouts, keyed by the view's shape so a re-derived but unchanged view still hits. */
const viewCache = new Map<string, Record<string, Vec2>>()
const VIEW_CACHE_SIZE = 8

function viewKey(view: ViewGraph, layerIds: string[]): string {
  const parts: string[] = [layerIds.join(',')]
  for (const n of view.nodes) if (n.kind !== 'job') parts.push(`${n.id}:${n.layerId}:${n.columns.length}`)
  for (const e of view.edges) parts.push(`${e.from}>${e.to}`)
  return parts.join('|')
}

/** The cards of a view's layers (all of them by default) as a graph `autoLayout` can place. */
export function viewLayoutGraph(view: ViewGraph, layerIds: string[] = view.layers.map((l) => l.id)): Graph {
  const keep = new Set(layerIds)
  const nodes = view.nodes.filter((n) => n.kind !== 'job' && keep.has(n.layerId))
  const ids = new Set(nodes.map((n) => n.id))
  return {
    tables: nodes.map((n) => ({ id: n.id, name: n.name, layerId: n.layerId, columns: n.columns })),
    refs: view.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ id: e.id, from: { table: e.from, columns: e.fromColumns }, to: { table: e.to, columns: e.toColumns }, kind: e.kind })),
    layers: view.layers.filter((l) => keep.has(l.id)),
    workflows: EMPTY_WORKFLOWS,
  }
}

function remember(key: string, positions: Record<string, Vec2>) {
  viewCache.delete(key) // re-insert: most recent last
  viewCache.set(key, positions)
  if (viewCache.size > VIEW_CACHE_SIZE) viewCache.delete(viewCache.keys().next().value!)
}

/**
 * `autoLayout` over a derived view (e.g. medallion grouping, external sources). `layerIds` limits it to
 * those layers, for when only some nodes lack a stored position. Cached by the view's shape.
 */
export function autoLayoutView(view: ViewGraph, layerIds: string[] = view.layers.map((l) => l.id)): Record<string, Vec2> {
  const key = viewKey(view, layerIds)
  const positions = viewCache.get(key) ?? autoLayout(viewLayoutGraph(view, layerIds)).positions
  remember(key, positions)
  return positions
}

/** `autoLayoutView` of the whole view if it's been computed (here or in a worker), without computing it. */
export const cachedViewLayout = (view: ViewGraph) => viewCache.get(viewKey(view, view.layers.map((l) => l.id)))

/** Keeps a whole-view layout computed elsewhere (a worker) for `cachedViewLayout` and `autoLayoutView`. */
export const storeViewLayout = (view: ViewGraph, positions: Record<string, Vec2>) => remember(viewKey(view, view.layers.map((l) => l.id)), positions)
