import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { synthGraph } from '../dev/synth'
import { parseDbml } from '../parse/dbml'
import { autoLayout } from './autoLayout'
import { fromWire, toWire } from './layoutWire'
import { seedLayout } from './seedLayout'

describe('layout worker wire format', () => {
  it('lays out exactly like the full graph', () => {
    const sample = parseDbml(readFileSync(new URL('../../public/sample.dbml', import.meta.url), 'utf8'))
    for (const g of [sample, synthGraph({ tables: 400, seed: 2 })])
      expect(autoLayout(fromWire(toWire(1, g, 8)), 8)).toEqual(autoLayout(g, 8))
  })
})

describe('seedLayout', () => {
  it('places every table and keeps layer order', () => {
    const g = synthGraph({ tables: 500 })
    const l = seedLayout(g)
    expect(Object.keys(l.positions)).toHaveLength(500)
    expect(l.layerOrder).toEqual(g.layers.map((x) => x.id))
  })
})
