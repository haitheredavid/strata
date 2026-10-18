import { describe, expect, it } from 'vitest'
import { matchRanges, searchNodes } from './search'
import type { SearchCandidate } from './search'

const c = (name: string, kind: SearchCandidate['kind'] = 'table'): SearchCandidate => ({ id: `${kind}:${name}`, name, kind })
const names = (cs: readonly SearchCandidate[], q: string) => searchNodes(cs, q).flatMap((g) => g.hits.map((h) => h.name))

describe('searchNodes', () => {
  it('requires every token, case-insensitively, in any order', () => {
    const cs = [c('document__platinum'), c('documents'), c('gold.procore.PLATINUM_docs'), c('project__platinum')]
    expect(names(cs, 'doc plat').sort()).toEqual(['document__platinum', 'gold.procore.PLATINUM_docs'])
    expect(names(cs, 'plat DOC').sort()).toEqual(['document__platinum', 'gold.procore.PLATINUM_docs'])
    expect(names(cs, '   ')).toEqual([])
  })

  it('ranks exact, then short-name prefix, then word start, then contains', () => {
    const cs = [c('gold.x.reproject'), c('gold.x.my_project_log'), c('gold.x.projects'), c('project')]
    expect(names(cs, 'project')).toEqual(['project', 'gold.x.projects', 'gold.x.my_project_log', 'gold.x.reproject'])
  })

  it('breaks rank ties by shorter name, then alphabetically', () => {
    const cs = [c('orders_big'), c('orders_b'), c('orders_a')]
    expect(names(cs, 'orders')).toEqual(['orders_a', 'orders_b', 'orders_big'])
  })

  it('groups by kind in a fixed order with totals and capped hits', () => {
    const cs = [c('sales_cluster', 'cluster'), c('sales_a'), c('sales_b'), c('sales_c'), c('sales_job', 'job'), c('sales', 'pipeline')]
    const groups = searchNodes(cs, 'sales', { perGroup: 2 })
    expect(groups.map((g) => [g.kind, g.total, g.hits.length])).toEqual([
      ['pipeline', 1, 1],
      ['table', 3, 2],
      ['job', 1, 1],
      ['cluster', 1, 1],
    ])
  })
})

describe('matchRanges', () => {
  it('finds every token occurrence and merges overlaps', () => {
    expect(matchRanges('Document_doc', 'doc')).toEqual([[0, 3], [9, 12]])
    expect(matchRanges('platinum', 'plat tin')).toEqual([[0, 6]])
    expect(matchRanges('orders', 'xyz')).toEqual([])
  })
})
