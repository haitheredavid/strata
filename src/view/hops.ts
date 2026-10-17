import { fkEnds } from './deriveView'
import type { ViewGraph } from './deriveView'

/** -1 = upstream (referenced by the center), +1 = downstream (references it), 0 = center. */
export type HopDir = -1 | 0 | 1
export interface Hop { hop: number; dir: HopDir }

/**
 * Directional neighborhood, like dbt's `up+node+down`: follows FKs to referenced tables for `up`
 * hops and to referencing tables for `down` hops, and lineage flows to what a table is built from
 * (`up`) and what's built from it (`down`). A job on the way doesn't cost a hop: one hop up from a
 * table reaches the jobs that write it and the tables those jobs read.
 */
export function hops(view: Pick<ViewGraph, 'edges'> & Partial<Pick<ViewGraph, 'flows'>>, id: string, up: number, down: number): Map<string, Hop> {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  const link = (child: string, parent: string) => {
    if (child === parent) return
    if (!parents.has(child)) parents.set(child, [])
    if (!children.has(parent)) children.set(parent, [])
    parents.get(child)!.push(parent)
    children.get(parent)!.push(child)
  }
  for (const e of view.edges) {
    const { child, parent } = fkEnds(e)
    link(child, parent)
  }
  for (const f of view.flows ?? []) link(f.to, f.from)

  const out = new Map<string, Hop>([[id, { hop: 0, dir: 0 }]])
  const walk = (adj: Map<string, string[]>, depth: number, dir: HopDir) => {
    let frontier = [id]
    for (let h = 1; h <= depth && frontier.length; h++) {
      const next: string[] = []
      const reach = (m: string) => {
        const prev = out.get(m)
        if (prev && prev.hop <= h) return
        out.set(m, { hop: h, dir })
        // Jobs are pass-through: their far side is reached on the same hop.
        if (m.startsWith('job:')) for (const k of adj.get(m) ?? []) reach(k)
        else next.push(m)
      }
      for (const n of frontier) for (const m of adj.get(n) ?? []) reach(m)
      frontier = next
    }
  }
  walk(parents, up, -1)
  walk(children, down, 1)
  return out
}
