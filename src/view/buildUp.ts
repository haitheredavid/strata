import type { ViewGraph } from './deriveView'

/** When each node of a view appears during the build-up, and how long it takes. */
export interface BuildUp {
  /** Start of each node's fade-in, as a share of the run in [0, 1 - fade). */
  start: Map<string, number>
  /** How long one node takes to fade in, as a share of the run. */
  fade: number
  /** Length of the whole run. */
  seconds: number
}

/** A node fades in over this long; the run lasts from MIN to MAX seconds, longer for bigger views. */
const FADE_S = 0.5
const MIN_S = 2.5
const MAX_S = 8
const PER_NODE_S = 0.012

/**
 * The order a view builds up in, like a time-lapse of the data arriving: one node after another,
 * upstream first (by lineage depth). Within a depth it sweeps each domain in the view's order, top to
 * bottom and left to right by `at` (the node's placed position), so the picture fills in rather than
 * speckles. A cluster follows the last of its jobs. Pure.
 */
export function buildUp(view: ViewGraph, depth: Map<string, number>, at?: (id: string) => readonly [number, number, number] | undefined): BuildUp {
  const n = view.nodes.length
  const seconds = Math.min(MAX_S, Math.max(MIN_S, MIN_S + n * PER_NODE_S))
  const fade = Math.min(0.3, FADE_S / seconds)
  // A folded domain sits at its shallowest table.
  const depthOf = (id: string, members?: string[]) =>
    depth.get(id) ?? (members?.length ? Math.min(...members.map((m) => depth.get(m) ?? 0)) : 0)
  const layerRank = new Map(view.layers.map((l, i) => [l.id, i]))
  const ranked = view.nodes.map((node, i) => {
    const p = at?.(node.id)
    return { id: node.id, d: depthOf(node.id, node.members), layer: layerRank.get(node.layerId) ?? layerRank.size, y: p ? -p[1] : 0, z: p?.[2] ?? 0, x: p?.[0] ?? 0, i }
  })
  ranked.sort((a, b) => a.d - b.d || a.layer - b.layer || a.y - b.y || a.z - b.z || a.x - b.x || a.i - b.i)
  const start = new Map<string, number>()
  ranked.forEach(({ id }, rank) => start.set(id, n > 1 ? (rank / (n - 1)) * (1 - fade) : 0))
  for (const c of view.clusters) start.set(c.id, Math.max(0, ...c.jobs.map((j) => start.get(j) ?? 0)))
  return { start, fade, seconds }
}

/** How far a node has faded in (0 hidden, 1 shown) at `progress` through the run. */
export function revealed(b: BuildUp, id: string, progress: number): number {
  const s = b.start.get(id)
  if (s === undefined || progress >= 1) return 1
  return Math.min(1, Math.max(0, (progress - s) / b.fade))
}
