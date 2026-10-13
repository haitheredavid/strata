import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../../parse/dbml'
import { deriveView } from '../../view/deriveView'
import { hops } from '../../view/hops'
import { autoLayout } from '../autoLayout'
import { domainRank, fkDepth } from '../depth'
import { CARD_W, cardDepth } from '../geometry'
import { flowOrder, placeFlow } from './flow'
import { placeOrbit } from './orbit'
import { placeStack } from './stack'

const sample = readFileSync(new URL('../../../public/sample.dbml', import.meta.url), 'utf8')
const graph = parseDbml(sample)
const view = deriveView(graph)
const layout = autoLayout(graph)
const noFocus = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }

describe('fkDepth', () => {
  it('puts referenced tables before referencing ones', () => {
    const d = fkDepth(view.nodes.map((n) => n.id), view.edges)
    expect(d.get('orgs')).toBe(0)
    expect(d.get('users')!).toBeGreaterThan(d.get('orgs')!)
    expect(d.get('order_items')!).toBeGreaterThan(d.get('orders')!)
  })

  it('terminates on self refs and mutual FKs', () => {
    const edges = [
      { from: 'a', to: 'a', kind: 'n-1' as const },
      { from: 'a', to: 'b', kind: 'n-1' as const },
      { from: 'b', to: 'a', kind: 'n-1' as const },
    ]
    const d = fkDepth(['a', 'b'], edges)
    expect([...d.keys()].sort()).toEqual(['a', 'b'])
    expect(fkDepth(['a', 'b'], edges)).toEqual(d)
  })
})

describe('domainRank', () => {
  it('orders the sample upstream first', () => {
    const order = flowOrder(view, {})
    expect(order[0]).toBe('auth')
    expect(order.indexOf('catalog')).toBeLessThan(order.indexOf('orders'))
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('billing'))
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('shipping'))
  })

  it('is stable when domains collapse', () => {
    expect(flowOrder(deriveView(graph, { collapsedLayers: ['auth', 'billing'] }), {})).toEqual(flowOrder(view, {}))
  })

  it('breaks cycles without looping', () => {
    const layerOf = (n: string) => n
    expect(domainRank(['x', 'y'], layerOf, [{ from: 'x', to: 'y', kind: 'n-1' }, { from: 'y', to: 'x', kind: 'n-1' }])).toHaveLength(2)
  })
})

describe('placeStack', () => {
  it('matches the stored positions and layer heights', () => {
    const p = placeStack(view, layout)
    const users = p.nodes.users
    expect(users.p).toEqual([layout.positions.users.x, layout.layerOrder.indexOf('auth') * layout.layerGap, layout.positions.users.z])
    expect(users.frame).toBe('flat')
    expect(p.plates).toHaveLength(5)
  })
})

describe('placeFlow', () => {
  const p = placeFlow(view, layout, noFocus)

  it('is deterministic', () => {
    expect(placeFlow(view, layout, noFocus)).toEqual(p)
  })

  it('puts domain slabs left to right in rank order', () => {
    const xs = flowOrder(view, layout).map((l) => p.plates.find((pl) => pl.id === l)!.center[0])
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('has no overlapping cards on a slab', () => {
    for (const l of view.layers) {
      const ns = view.nodes.filter((n) => n.layerId === l.id)
      for (let i = 0; i < ns.length; i++)
        for (let j = i + 1; j < ns.length; j++) {
          const [a, b] = [p.nodes[ns[i].id].p, p.nodes[ns[j].id].p]
          const overlapZ = Math.abs(a[2] - b[2]) < CARD_W
          const overlapY = Math.abs(a[1] - b[1]) < (cardDepth(ns[i]) + cardDepth(ns[j])) / 2
          expect(overlapZ && overlapY).toBe(false)
        }
    }
  })

  it('pulls the focus neighborhood off the slab', () => {
    const reach = hops(view, 'orders', 1, 1)
    const f = placeFlow(view, layout, { focusedId: 'orders', hops: reach, hopUp: 1, hopDown: 1 })
    expect(f.nodes.orders.p[0]).toBeGreaterThan(p.nodes.orders.p[0])
    expect(f.nodes.carriers.p[0]).toBe(p.nodes.carriers.p[0])
  })
})

describe('placeOrbit', () => {
  const reach = hops(view, 'orders', 2, 2)
  const p = placeOrbit(view, layout, { focusedId: 'orders', hops: reach, hopUp: 2, hopDown: 2 })

  it('centers the focused table', () => {
    expect(p.nodes.orders.p).toEqual([0, 0, 0])
  })

  it('puts upstream above, downstream below, outer hops further out', () => {
    for (const [id, h] of reach) {
      if (h.dir === 0) continue
      const [x, y, z] = p.nodes[id].p
      expect(Math.sign(y)).toBe(-h.dir)
      const r = Math.hypot(x, y, z)
      expect(r).toBeGreaterThan(0)
    }
    const r = (id: string) => Math.hypot(...p.nodes[id].p)
    const hop1 = [...reach].filter(([, h]) => h.hop === 1 && h.dir === -1).map(([id]) => r(id))
    const hop2 = [...reach].filter(([, h]) => h.hop === 2 && h.dir === -1).map(([id]) => r(id))
    if (hop1.length && hop2.length) expect(Math.min(...hop2)).toBeGreaterThan(Math.max(...hop1) - 1e-6)
  })

  it('fades tables outside the hop range', () => {
    const out = view.nodes.filter((n) => !reach.has(n.id))
    expect(out.every((n) => p.nodes[n.id].faded)).toBe(true)
  })
})
