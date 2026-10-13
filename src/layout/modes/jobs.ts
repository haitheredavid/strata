import type { ModeId } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import type { NodePlace, Placement, V3 } from './types'

const MIN_GAP = 3 // between job centers

const centroid = (ps: V3[]): V3 | null =>
  ps.length ? [0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length) as V3 : null

/**
 * Places job nodes between what they read and what they write, after a mode has placed the tables.
 * Stack: halfway between layers (or above a layer when reads and writes share it). Flow: in the gap
 * between slabs. Orbit: midway along the chord. Then nudges jobs apart so none overlap.
 */
export function placeJobs(view: ViewGraph, placement: Placement, mode: ModeId, gap: number): Placement {
  const jobs = view.nodes.filter((n) => n.kind === 'job' && !placement.nodes[n.id])
  if (!jobs.length) return placement
  const nodes: Record<string, NodePlace> = { ...placement.nodes }
  const at = (id: string) => nodes[id]?.p

  const placed: { id: string; p: V3 }[] = []
  for (const job of jobs) {
    const reads = view.flows.filter((f) => f.to === job.id).map((f) => at(f.from)).filter((p): p is V3 => !!p)
    const writes = view.flows.filter((f) => f.from === job.id).map((f) => at(f.to)).filter((p): p is V3 => !!p)
    const r = centroid(reads)
    const w = centroid(writes)
    const a = r ?? w
    const b = w ?? r
    if (!a || !b) continue
    const p: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    if (mode === 'stack' && Math.abs(a[1] - b[1]) < 0.5) p[1] += gap * 0.5
    else if (mode === 'flow' && Math.abs(a[0] - b[0]) < 0.5) p[0] += gap * 0.6
    else if (mode === 'orbit' && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.5) p[1] += 3
    placed.push({ id: job.id, p })
  }

  // Push overlapping jobs apart, only along axes that keep them between their layers.
  separate(placed, mode === 'stack' ? [0, 2] : mode === 'flow' ? [1, 2] : [0, 1, 2], MIN_GAP)

  for (const { id, p } of placed) nodes[id] = { p, frame: 'billboard' }
  return { ...placement, nodes }
}

/** Pushes points apart until none are closer than `gap`, moving them only along the `free` axes. */
export function separate(placed: { p: V3 }[], free: number[], gap: number) {
  for (let iter = 0; iter < 60; iter++) {
    let moved = false
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const [pi, pj] = [placed[i].p, placed[j].p]
        const d = free.map((k) => pj[k] - pi[k])
        let len = Math.hypot(...d)
        if (len >= gap) continue
        moved = true
        if (len < 1e-6) {
          d[d.length - 1] = 1 // coincident: separate along the last free axis, in list order
          len = 1
        }
        const push = (gap - len) / 2 / len
        free.forEach((k, n) => {
          pi[k] -= d[n] * push
          pj[k] += d[n] * push
        })
      }
    if (!moved) break
  }
}
