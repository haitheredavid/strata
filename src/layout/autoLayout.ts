import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum } from 'd3-force'
import type { Graph, Layout, Vec2 } from '../model/types'
import { EMPTY_WORKFLOWS } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { CARD_W, cardDepth, cardRect, rectsOverlap } from './geometry'

interface Node extends SimulationNodeDatum {
  id: string
  r: number
  tx: number
  tz: number
  pull: number
}

const MARGIN = 0.6
const TICKS = 300

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

  for (const layerId of layerOrder) {
    const tables = graph.tables.filter((t) => t.layerId === layerId)
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

    const links = graph.refs
      .filter((r) => r.from.table !== r.to.table && ids.has(r.from.table) && ids.has(r.to.table))
      .map((r) => ({ source: r.from.table, target: r.to.table }))

    forceSimulation(nodes)
      .randomSource(lcg(42))
      .force('link', forceLink<Node, { source: string; target: string }>(links).id((n) => n.id).distance(6).strength(0.5))
      .force('charge', forceManyBody().strength(-20).distanceMax(12))
      .force('x', forceX<Node>((n) => n.tx).strength((n) => n.pull))
      .force('y', forceY<Node>((n) => n.tz).strength((n) => n.pull))
      .force('collide', forceCollide<Node>((n) => n.r).strength(1).iterations(4))
      .stop()
      .tick(TICKS)

    for (const n of nodes) positions[n.id] = { x: n.x!, z: n.y! }
    resolveOverlaps(tables.map((t) => t.id), positions, tableById)
  }

  return { layerGap, layerOrder, positions }
}

/** Push apart any card rectangles that still overlap after the force pass. */
function resolveOverlaps(ids: string[], pos: Record<string, Vec2>, tables: Map<string, Graph['tables'][number]>) {
  for (let iter = 0; iter < 200; iter++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = tables.get(ids[i])!
        const b = tables.get(ids[j])!
        const ra = cardRect(a, pos[a.id])
        const rb = cardRect(b, pos[b.id])
        if (!rectsOverlap(ra, rb)) continue
        moved = true
        const ox = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0)
        const oz = Math.min(ra.z1, rb.z1) - Math.max(ra.z0, rb.z0)
        // Separate along the axis of least overlap.
        if (ox < oz) {
          const d = (ox / 2 + 0.05) * (pos[a.id].x <= pos[b.id].x ? -1 : 1)
          pos[a.id].x += d
          pos[b.id].x -= d
        } else {
          const d = (oz / 2 + 0.05) * (pos[a.id].z <= pos[b.id].z ? -1 : 1)
          pos[a.id].z += d
          pos[b.id].z -= d
        }
      }
    }
    if (!moved) return
  }
}

const viewCache = new WeakMap<ViewGraph, Record<string, Vec2>>()

/** `autoLayout` over a derived view (e.g. medallion grouping, external sources); cached per view. */
export function autoLayoutView(view: ViewGraph): Record<string, Vec2> {
  const hit = viewCache.get(view)
  if (hit) return hit
  const graph: Graph = {
    tables: view.nodes.filter((n) => n.kind !== 'job').map((n) => ({ id: n.id, name: n.name, layerId: n.layerId, columns: n.columns })),
    refs: view.edges.map((e) => ({ id: e.id, from: { table: e.from, columns: e.fromColumns }, to: { table: e.to, columns: e.toColumns }, kind: e.kind })),
    layers: view.layers,
    workflows: EMPTY_WORKFLOWS,
  }
  const positions = autoLayout(graph).positions
  viewCache.set(view, positions)
  return positions
}
