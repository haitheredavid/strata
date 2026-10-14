import type { ModeId } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import { separate } from './jobs'
import type { NodePlace, Placement, V3 } from './types'

const MIN_GAP = 4.5 // between cluster centers

/**
 * Places clusters under the diagram, after jobs are placed: each sits below the centroid of its jobs,
 * a gap beneath the lowest plate or card, so compute reads as the floor the pipelines run on. Clusters
 * are then pushed apart horizontally.
 */
export function placeClusters(view: ViewGraph, placement: Placement, mode: ModeId, gap: number): Placement {
  if (!view.clusters.length) return placement
  if (mode === 'diagram') return placeClustersBelow(view, placement)
  let low = Infinity
  for (const id in placement.nodes) low = Math.min(low, placement.nodes[id].p[1])
  for (const pl of placement.plates) low = Math.min(low, pl.frame === 'flat' ? pl.center[1] : pl.center[1] - pl.size[1] / 2)
  const floor = (low === Infinity ? 0 : low) - (mode === 'stack' ? gap * 0.75 : 4)

  const placed: { id: string; p: V3 }[] = []
  for (const c of view.clusters) {
    const at = c.jobs.map((j) => placement.nodes[j]?.p).filter((p): p is V3 => !!p)
    if (!at.length) continue
    const x = at.reduce((s, p) => s + p[0], 0) / at.length
    const z = at.reduce((s, p) => s + p[2], 0) / at.length
    placed.push({ id: c.id, p: [x, floor, z] })
  }
  separate(placed, [0, 2], MIN_GAP)

  const nodes: Record<string, NodePlace> = { ...placement.nodes }
  for (const { id, p } of placed) nodes[id] = { p, frame: 'billboard' }
  return { ...placement, nodes }
}

/** Diagram: a row of clusters past the bottom edge of the diagram (+Z), each under its jobs' centroid. */
function placeClustersBelow(view: ViewGraph, placement: Placement): Placement {
  let edge = -Infinity
  for (const pl of placement.plates) edge = Math.max(edge, pl.center[2] + pl.size[1] / 2)
  const floor = (edge === -Infinity ? 0 : edge) + 4
  const placed: { id: string; p: V3 }[] = []
  for (const c of view.clusters) {
    const at = c.jobs.map((j) => placement.nodes[j]?.p).filter((p): p is V3 => !!p)
    if (!at.length) continue
    placed.push({ id: c.id, p: [at.reduce((s, p) => s + p[0], 0) / at.length, 0.3, floor] })
  }
  separate(placed, [0], MIN_GAP)
  const nodes: Record<string, NodePlace> = { ...placement.nodes }
  for (const { id, p } of placed) nodes[id] = { p, frame: 'billboard' }
  return { ...placement, nodes }
}
