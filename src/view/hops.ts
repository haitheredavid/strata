import { fkEnds } from './deriveView'
import type { ViewGraph } from './deriveView'

/** -1 = upstream (referenced by the center), +1 = downstream (references it), 0 = center. */
export type HopDir = -1 | 0 | 1
export interface Hop { hop: number; dir: HopDir }

/**
 * Directional neighborhood, like dbt's `up+node+down`: follows FKs to referenced tables for `up`
 * hops and to referencing tables for `down` hops.
 */
export function hops(view: Pick<ViewGraph, 'edges'>, id: string, up: number, down: number): Map<string, Hop> {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const e of view.edges) {
    const { child, parent } = fkEnds(e)
    if (child === parent) continue
    if (!parents.has(child)) parents.set(child, [])
    if (!children.has(parent)) children.set(parent, [])
    parents.get(child)!.push(parent)
    children.get(parent)!.push(child)
  }

  const out = new Map<string, Hop>([[id, { hop: 0, dir: 0 }]])
  const walk = (adj: Map<string, string[]>, depth: number, dir: HopDir) => {
    let frontier = [id]
    for (let h = 1; h <= depth && frontier.length; h++) {
      const next: string[] = []
      for (const n of frontier)
        for (const m of adj.get(n) ?? []) {
          const prev = out.get(m)
          if (prev && prev.hop <= h) continue
          out.set(m, { hop: h, dir })
          next.push(m)
        }
      frontier = next
    }
  }
  walk(parents, up, -1)
  walk(children, down, 1)
  return out
}
