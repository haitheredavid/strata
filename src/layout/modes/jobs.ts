import type { ModeId } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import { GridHash } from '../gridHash'
import type { NodePlace, Placement, V3 } from './types'

const MIN_GAP = 3 // between job centers

const centroid = (ps: V3[]): V3 | null =>
  ps.length ? [0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length) as V3 : null

/**
 * Places job nodes between what they read and what they write, after a mode has placed the tables.
 * Stack: halfway between layers (or above a layer when reads and writes share it). Flow: in the gap
 * between slabs. Diagram: on the ground, in the gap between domain columns. Orbit: midway along the chord. Then nudges jobs apart so none overlap.
 */
export function placeJobs(view: ViewGraph, placement: Placement, mode: ModeId, gap: number): Placement {
  const jobs = view.nodes.filter((n) => n.kind === 'job' && !placement.nodes[n.id])
  if (!jobs.length) return placement
  const nodes: Record<string, NodePlace> = { ...placement.nodes }
  const at = (id: string) => nodes[id]?.p

  const readsOf = new Map<string, V3[]>()
  const writesOf = new Map<string, V3[]>()
  const push = (m: Map<string, V3[]>, k: string, p: V3 | undefined) => {
    if (!p) return
    const list = m.get(k)
    if (list) list.push(p)
    else m.set(k, [p])
  }
  for (const f of view.flows) {
    push(readsOf, f.to, at(f.from))
    push(writesOf, f.from, at(f.to))
  }

  const placed: { id: string; p: V3 }[] = []
  for (const job of jobs) {
    const reads = readsOf.get(job.id) ?? []
    const writes = writesOf.get(job.id) ?? []
    const r = centroid(reads)
    const w = centroid(writes)
    const a = r ?? w
    const b = w ?? r
    if (!a || !b) continue
    const p: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    if (mode === 'stack' && Math.abs(a[1] - b[1]) < 0.5) p[1] += gap * 0.5
    else if (mode === 'flow' && Math.abs(a[0] - b[0]) < 0.5) p[0] += gap * 0.6
    else if (mode === 'diagram' && Math.abs(a[0] - b[0]) < 0.5) p[0] += gap * 0.6
    else if (mode === 'orbit' && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.5) p[1] += 3
    if (mode === 'diagram') p[1] = 0.3 // just above the cards, under the wires' arch
    placed.push({ id: job.id, p })
  }

  // Push overlapping jobs apart, only along axes that keep them between their layers.
  separate(placed, mode === 'stack' || mode === 'diagram' ? [0, 2] : mode === 'flow' ? [1, 2] : [0, 1, 2], MIN_GAP)

  for (const { id, p } of placed) nodes[id] = { p, frame: 'billboard' }
  return { ...placement, nodes }
}

/**
 * Pushes points apart until none are closer than `gap`, moving them only along the `free` axes. A grid
 * of `gap`-sized cells finds the close pairs, so a pass is O(n) rather than all pairs.
 */
export function separate(placed: { p: V3 }[], free: number[], gap: number) {
  if (placed.length < 2) return
  const dims = free.length as 1 | 2 | 3
  const [f0, f1, f2] = free
  const grid = new GridHash(gap)
  const near: number[] = []
  const d = [0, 0, 0]
  for (let iter = 0; iter < 60; iter++) {
    grid.clear()
    placed.forEach(({ p }, i) => grid.insert(i, p[f0], f1 === undefined ? 0 : p[f1], f2 === undefined ? 0 : p[f2]))
    let moved = false
    for (let i = 0; i < placed.length; i++) {
      const pi = placed[i].p
      grid.near(near, dims, pi[f0], f1 === undefined ? 0 : pi[f1], f2 === undefined ? 0 : pi[f2])
      near.sort((a, b) => a - b) // same pair order as an all-pairs scan
      for (const j of near) {
        if (j <= i) continue
        const pj = placed[j].p
        let len2 = 0
        for (let n = 0; n < dims; n++) {
          d[n] = pj[free[n]] - pi[free[n]]
          len2 += d[n] * d[n]
        }
        if (len2 >= gap * gap) continue
        moved = true
        let len = Math.sqrt(len2)
        if (len < 1e-6) {
          for (let n = 0; n < dims; n++) d[n] = 0
          d[dims - 1] = 1 // coincident: separate along the last free axis, in list order
          len = 1
        }
        const push = (gap - len) / 2 / len
        for (let n = 0; n < dims; n++) {
          pi[free[n]] -= d[n] * push
          pj[free[n]] += d[n] * push
        }
      }
    }
    if (!moved) break
  }
}
