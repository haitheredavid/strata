import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml, UNGROUPED } from './dbml'
import { autoLayout } from '../layout/autoLayout'
import { cardRect, rectsOverlap } from '../layout/geometry'

const sample = readFileSync(new URL('../../public/sample.dbml', import.meta.url), 'utf8')

describe('parseDbml', () => {
  it('parses the sample schema', () => {
    const g = parseDbml(sample)
    expect(g.tables).toHaveLength(30)
    expect(g.refs).toHaveLength(47)
    expect(g.layers.map((l) => l.id)).toEqual(['auth', 'catalog', 'orders', 'billing', 'shipping'])
    expect(g.tables.find((t) => t.id === 'orders')!.layerId).toBe('orders')
  })

  it('marks FK columns on the many side', () => {
    const g = parseDbml(sample)
    const users = g.tables.find((t) => t.id === 'users')!
    expect(users.columns.find((c) => c.name === 'org_id')!.fk).toBe(true)
    expect(users.columns.find((c) => c.name === 'id')!.pk).toBe(true)
    expect(g.refs.find((r) => r.from.table === 'users')!.kind).toBe('n-1')
  })

  it('puts tables without a group on an ungrouped layer', () => {
    const g = parseDbml(`Table a {\n  id int [pk]\n}\nTable b {\n  a_id int\n}\nRef: b.a_id > a.id`)
    expect(g.layers.map((l) => l.id)).toEqual([UNGROUPED])
    expect(g.tables.every((t) => t.layerId === UNGROUPED)).toBe(true)
  })

  it('handles self refs, composite refs and schemas', () => {
    const g = parseDbml(`
Table s.a {
  id int [pk]
  parent_id int
  x int
  y int
}
Table b {
  ax int
  ay int
}
Ref: s.a.parent_id > s.a.id
Ref: b.(ax, ay) > s.a.(x, y)
`)
    expect(g.tables.map((t) => t.id).sort()).toEqual(['b', 's.a'])
    expect(g.refs.find((r) => r.from.table === 's.a')!.to.table).toBe('s.a')
    expect(g.refs.find((r) => r.from.table === 'b')!.from.columns).toEqual(['ax', 'ay'])
  })
})

describe('autoLayout', () => {
  it('is deterministic', () => {
    const g = parseDbml(sample)
    expect(autoLayout(g)).toEqual(autoLayout(g))
  })

  it('has no overlapping cards within a layer', () => {
    const g = parseDbml(sample)
    const layout = autoLayout(g)
    for (const l of g.layers) {
      const ts = g.tables.filter((t) => t.layerId === l.id)
      for (let i = 0; i < ts.length; i++)
        for (let j = i + 1; j < ts.length; j++)
          expect(rectsOverlap(cardRect(ts[i], layout.positions[ts[i].id]), cardRect(ts[j], layout.positions[ts[j].id]))).toBe(false)
    }
  })
})
