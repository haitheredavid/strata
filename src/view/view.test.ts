import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { deriveView, domainNodeId } from './deriveView'
import { hops } from './hops'
import { findPaths } from './paths'

const sample = readFileSync(new URL('../../public/sample.dbml', import.meta.url), 'utf8')
const graph = parseDbml(sample)

const tiny = parseDbml(`
Table a { id int [pk] }
Table b { id int [pk]
  a_id int }
Table c { id int [pk]
  b_id int }
Table d { id int [pk]
  a_id int
  c_id int }
Ref: b.a_id > a.id
Ref: c.b_id > b.id
Ref: d.a_id > a.id
Ref: d.c_id > c.id
`)

describe('deriveView', () => {
  it('passes the graph through by default', () => {
    const v = deriveView(graph)
    expect(v.nodes).toHaveLength(30)
    expect(v.edges).toHaveLength(47)
  })

  it('collapses a domain into one node and merges its edges with counts', () => {
    const v = deriveView(graph, { collapsedLayers: ['billing'] })
    const id = domainNodeId('billing')
    expect(v.nodes.filter((n) => n.layerId === 'billing').map((n) => n.id)).toEqual([id])
    const touching = v.edges.filter((e) => e.from === id || e.to === id)
    expect(touching.length).toBeGreaterThan(0)
    expect(new Set(touching.map((e) => `${e.from}>${e.to}`)).size).toBe(touching.length)
    const internal = graph.refs.filter((r) => [r.from.table, r.to.table].every((t) => graph.tables.find((x) => x.id === t)!.layerId === 'billing'))
    expect(v.edges.reduce((s, e) => s + e.count, 0)).toBe(47 - internal.length)
  })

  it('filters columns by detail level and per-card collapse', () => {
    const keys = deriveView(graph, { columnDetail: 'keys' })
    expect(keys.nodes.every((n) => n.columns.every((c) => c.pk || c.fk))).toBe(true)
    const header = deriveView(graph, { columnDetail: 'header' })
    expect(header.nodes.every((n) => n.columns.length === 0)).toBe(true)
    const one = deriveView(graph, { collapsedCards: ['users'] })
    expect(one.nodes.find((n) => n.id === 'users')!.columns).toEqual([])
  })

  it('drops hidden layers and their edges', () => {
    const v = deriveView(graph, { hiddenLayers: ['auth'] })
    expect(v.nodes.some((n) => n.layerId === 'auth')).toBe(false)
    expect(v.layers.map((l) => l.id)).not.toContain('auth')
    const ids = new Set(v.nodes.map((n) => n.id))
    expect(v.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
  })

  it('keeps only tables the visible pipelines touch, dropping emptied domains', () => {
    const wf = parseDbml(`
Table a { id int }
Table b { id int }
Table c { id int }
TableGroup one { a
  b }
TableGroup two { c }
`, 'pipelines: [{ id: p, tasks: [{ id: t, reads: [a], writes: [b] }] }, { id: q, tasks: [{ id: u, writes: [c] }] }]')
    const tables = (o: object) => deriveView(wf, { lineage: true, pipelineTablesOnly: true, ...o }).nodes.filter((n) => n.kind === 'table').map((n) => n.id)
    expect(tables({})).toEqual(['a', 'b', 'c'])
    expect(tables({ hiddenPipelines: ['q'] })).toEqual(['a', 'b'])
    expect(deriveView(wf, { lineage: true, pipelineTablesOnly: true, hiddenPipelines: ['q'] }).layers.map((l) => l.id)).toEqual(['one'])
    // Off without lineage: FK-only views keep every table.
    expect(deriveView(wf, { pipelineTablesOnly: true, hiddenPipelines: ['p', 'q'] }).nodes).toHaveLength(3)
  })
})

describe('hops', () => {
  const v = deriveView(tiny)
  it('follows FKs upstream and downstream separately', () => {
    const h = hops(v, 'c', 1, 0)
    expect([...h.keys()].sort()).toEqual(['b', 'c'])
    expect(h.get('b')).toEqual({ hop: 1, dir: -1 })
    expect([...hops(v, 'c', 0, 1).keys()].sort()).toEqual(['c', 'd'])
  })

  it('respects depth limits', () => {
    expect([...hops(v, 'c', 2, 0).keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(hops(v, 'a', 0, 1).get('d')).toEqual({ hop: 1, dir: 1 })
    expect(hops(v, 'a', 0, 1).has('c')).toBe(false)
  })
})

describe('findPaths', () => {
  const v = deriveView(tiny)
  it('returns the shortest path first plus longer alternatives', () => {
    const ps = findPaths(v, 'a', 'c')
    expect(ps.map((p) => p.edges.length)).toEqual([2, 2])
    expect(ps.map((p) => p.nodes[1]).sort()).toEqual(['b', 'd'])
  })

  it('avoids ignored tables', () => {
    const ps = findPaths(v, 'a', 'c', { ignore: ['d'] })
    expect(ps.map((p) => p.nodes)).toEqual([['a', 'b', 'c']])
  })

  it('returns nothing when there is no path', () => {
    expect(findPaths(v, 'a', 'c', { ignore: ['b', 'd'] })).toEqual([])
    expect(findPaths(v, 'a', 'a')).toEqual([])
  })

  it('finds join paths across the sample', () => {
    const ps = findPaths(deriveView(graph), 'reviews', 'shipments')
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.every((p) => p.nodes[0] === 'reviews' && p.nodes.at(-1) === 'shipments')).toBe(true)
    expect(ps.every((p, i) => i === 0 || p.edges.length >= ps[i - 1].edges.length)).toBe(true)
  })
})
