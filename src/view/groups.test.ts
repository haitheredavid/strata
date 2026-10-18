import { describe, expect, it } from 'vitest'
import { filterGroups, groupItems, takeItems } from './groups'

const names = ['gold.a.x', 'silver.b.y', 'gold.a.z', 'silver.b.w', 'gold.a.v', 'raw']
const schema = (n: string) => n.split('.').slice(0, -1).join('.')

describe('groupItems', () => {
  it('puts the largest group first and keeps item order inside a group', () => {
    const g = groupItems(names, schema)
    expect(g.map((x) => x.key)).toEqual(['gold.a', 'silver.b', ''])
    expect(g[0].items).toEqual(['gold.a.x', 'gold.a.z', 'gold.a.v'])
  })
})

describe('filterGroups', () => {
  it('keeps matching items and drops emptied groups', () => {
    const g = filterGroups(groupItems(names, schema), (n) => n.includes('.y') || n.includes('.x'))
    expect(g.map((x) => [x.key, x.items])).toEqual([
      ['gold.a', ['gold.a.x']],
      ['silver.b', ['silver.b.y']],
    ])
  })
})

describe('takeItems', () => {
  it('counts items across groups and cuts the group that crosses the limit', () => {
    const g = takeItems(groupItems(names, schema), 4)
    expect(g.map((x) => x.items.length)).toEqual([3, 1])
    expect(takeItems(groupItems(names, schema), 10).flatMap((x) => x.items)).toHaveLength(names.length)
  })
})
