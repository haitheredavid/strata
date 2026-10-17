import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../../parse/dbml'
import { deriveView } from '../../view/deriveView'
import { hops } from '../../view/hops'
import { autoLayout } from '../autoLayout'
import { domainRank, fkDepth } from '../depth'
import { CARD_W, cardDepth, cardRect, rectsOverlap } from '../geometry'
import { placeDiagram } from './diagram'
import { flowOrder, placeFlow } from './flow'
import { placeJobs } from './jobs'
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

describe('a domain of hundreds of tables', () => {
  const tables = Array.from({ length: 300 }, (_, i) => `Table t${i} {\n  id int [pk]\n}`).join('\n')
  const big = parseDbml(`${tables}\nTableGroup big {\n${Array.from({ length: 300 }, (_, i) => `  t${i}`).join('\n')}\n}\n`)
  const v = deriveView(big)
  const l = autoLayout(big)

  it('wraps into a grid of sub-columns in flow, about as wide as tall, without overlaps', () => {
    const f = placeFlow(v, l, noFocus)
    const zs = new Set(v.nodes.map((n) => f.nodes[n.id].p[2]))
    expect(zs.size).toBeGreaterThan(5)
    const plate = f.plates.find((p) => p.id === 'big')!
    const [w, h] = plate.size
    expect(h / w).toBeLessThan(2)
    expect(w / h).toBeLessThan(2)
    const byColumn = new Map<number, number[]>()
    for (const n of v.nodes) byColumn.set(f.nodes[n.id].p[2], [...(byColumn.get(f.nodes[n.id].p[2]) ?? []), f.nodes[n.id].p[1]])
    for (const ys of byColumn.values()) {
      ys.sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(cardDepth(v.nodes[0]) - 1e-6)
    }
  })

  it('lays the same grid flat in diagram, without overlapping cards', () => {
    const d = placeDiagram(v, l)
    expect(new Set(v.nodes.map((n) => d.nodes[n.id].p[0])).size).toBeGreaterThan(5)
    const rects = v.nodes.map((n) => cardRect(n, { x: d.nodes[n.id].p[0], z: d.nodes[n.id].p[2] }))
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i], rects[j])).toBe(false)
  })

  it('packs the out-of-range ones in orbit as a disk of rings, not one ring hundreds of cards round', () => {
    const o = placeOrbit(v, l, { focusedId: 't0', hops: null, hopUp: 1, hopDown: 1 })
    const radii = v.nodes.filter((n) => n.id !== 't0').map((n) => Math.hypot(o.nodes[n.id].p[0], o.nodes[n.id].p[2]))
    expect(Math.max(...radii)).toBeLessThan(150) // one ring of 299 cards, 6 apart, would be ~286
    const at = v.nodes.map((n) => o.nodes[n.id].p)
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][2] - at[j][2])).toBeGreaterThan(4)
  })
})

describe('placeDiagram', () => {
  const p = placeDiagram(view, layout)

  it('lays every card flat on the ground', () => {
    for (const n of view.nodes) {
      expect(p.nodes[n.id].frame).toBe('flat')
      expect(p.nodes[n.id].p[1]).toBe(0)
    }
  })

  it('keeps flow\'s domain order left to right, without overlapping plates', () => {
    const plates = flowOrder(view, layout).map((l) => p.plates.find((pl) => pl.id === l)!)
    for (let i = 1; i < plates.length; i++)
      expect(plates[i].center[0] - plates[i].size[0] / 2).toBeGreaterThan(plates[i - 1].center[0] + plates[i - 1].size[0] / 2)
  })

  it('has no overlapping cards', () => {
    const rects = view.nodes.map((n) => cardRect(n, { x: p.nodes[n.id].p[0], z: p.nodes[n.id].p[2] }))
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i], rects[j])).toBe(false)
  })

  it('keeps flow\'s row order within a column', () => {
    const f = placeFlow(view, layout, noFocus)
    for (const a of view.nodes)
      for (const b of view.nodes)
        if (a.layerId === b.layerId && f.nodes[a.id].p[2] === f.nodes[b.id].p[2] && f.nodes[a.id].p[1] > f.nodes[b.id].p[1])
          expect(p.nodes[a.id].p[2]).toBeLessThan(p.nodes[b.id].p[2])
  })

  it('puts lineage jobs on the ground between domains', () => {
    const lake = parseDbml(readFileSync(new URL('../../../public/lakehouse.dbml', import.meta.url), 'utf8'),
      readFileSync(new URL('../../../public/lakehouse.workflows.yaml', import.meta.url), 'utf8'))
    const v = deriveView(lake, { lineage: true })
    const placed = placeJobs(v, placeDiagram(v, autoLayout(lake)), 'diagram', 8)
    const jobs = v.nodes.filter((n) => n.kind === 'job')
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) expect(placed.nodes[j.id].p[1]).toBeCloseTo(0.3)
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
