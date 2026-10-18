import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { scopeChips } from './scope'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const [l1, l2] = graph.layers.map((l) => l.id)
const [p1] = graph.workflows.pipelines.map((p) => p.id)
const parts = (s: Parameters<typeof scopeChips>[0]) => scopeChips(s).map((c) => c.part)

describe('scopeChips', () => {
  it('is empty when nothing is narrowed', () => {
    expect(scopeChips({ graph })).toEqual([])
  })

  it('names each kind of narrowing once', () => {
    expect(parts({ graph, hiddenLayers: [l1, l2], collapsedLayers: [l1], hiddenPipelines: [p1], pipelineTablesOnly: true })).toEqual([
      'layers',
      'folded',
      'pipelines',
      'tablesOnly',
    ])
    expect(parts({ graph, onlyLayer: l1, onlyPipeline: p1 })).toEqual(['layers', 'pipelines'])
  })

  it('ignores ids of another grouping, and pipeline scope while lineage is off', () => {
    expect(scopeChips({ graph, hiddenLayers: ['not-a-layer'], collapsedLayers: ['nor-this'] })).toEqual([])
    expect(parts({ graph, edgeLayer: 'fk', hiddenPipelines: [p1], pipelineTablesOnly: true })).toEqual([])
  })
})
