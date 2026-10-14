import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { SOURCES } from '../view/deriveView'
import { paletteFor } from './palette'
import { accentOf, sample, spread } from './schemes'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const lakehouse = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))

const colored = parseDbml(
  'Table a { id int [pk] }\nTable b { id int [pk] }',
  `
pipelines:
  - id: p
    color: "#123456"
    tasks: [{ id: x, reads: [a], writes: [b] }]
  - id: q
    tasks: [{ id: y, reads: [b] }]
`,
)

describe('schemes', () => {
  it('samples the gradient at its stops and between them', () => {
    expect(sample('viridis', 0)).toBe('#440154')
    expect(sample('viridis', 1)).toBe('#fde725')
    expect(sample('magma', 0.5)).toBe('#b73779')
    expect(sample('magma', -1)).toBe('#000004')
    expect(sample('viridis', 1 / 32)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('spreads n distinct colors across the usable range', () => {
    const cs = spread('magma', 5)
    expect(cs).toHaveLength(5)
    expect(new Set(cs).size).toBe(5)
    expect(cs[0]).not.toBe(sample('magma', 0)) // dark end clipped
    expect(spread('viridis', 1)).toHaveLength(1)
    expect(spread('viridis', 0)).toEqual([])
  })

  it('has a bright accent', () => {
    const lum = (hex: string) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0) / 3
    for (const id of ['viridis', 'magma', 'inferno', 'plasma', 'cividis'] as const) expect(lum(accentOf(id))).toBeGreaterThan(120)
  })
})

describe('paletteFor', () => {
  it('keeps parsed colors, workflow overrides included, in the default scheme', () => {
    const p = paletteFor(colored, 'default')
    expect(p.pipeline('p')).toBe('#123456')
    expect(p.layer(colored.layers[0].id)).toBe(colored.layers[0].color)
    expect(p.medallion('bronze')).toBe('#cd7f32')
    expect(p.accent).toBe('#4f9dff')
  })

  it('recolors everything from the gradient, ignoring overrides', () => {
    const p = paletteFor(colored, 'magma')
    expect(p.pipeline('p')).not.toBe('#123456')
    expect(spread('magma', 2)).toEqual([p.pipeline('p'), p.pipeline('q')])
  })

  it('gives every layer and pipeline its own color', () => {
    const p = paletteFor(lakehouse, 'viridis')
    const layers = lakehouse.layers.map((l) => p.layer(l.id))
    const pipes = lakehouse.workflows.pipelines.map((x) => p.pipeline(x.id))
    expect(new Set(layers).size).toBe(layers.length)
    expect(new Set(pipes).size).toBe(pipes.length)
    expect(new Set(['bronze', 'silver', 'gold'].map(p.medallion)).size).toBe(3)
    expect(p.layer(SOURCES)).toBe('#94a3b8') // neutral in every scheme
  })

  it('returns the same palette for the same graph and scheme', () => {
    expect(paletteFor(lakehouse, 'plasma')).toBe(paletteFor(lakehouse, 'plasma'))
    expect(paletteFor(lakehouse, 'plasma')).not.toBe(paletteFor(lakehouse, 'inferno'))
  })
})
