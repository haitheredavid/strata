import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { parseSynthSpec, synthDbml, synthGraph } from './synth'

describe('synthGraph', () => {
  it('is deterministic per seed', () => {
    const a = synthGraph({ tables: 300, pipelines: 5, seed: 7 })
    expect(synthGraph({ tables: 300, pipelines: 5, seed: 7 })).toEqual(a)
    expect(synthGraph({ tables: 300, pipelines: 5, seed: 8 }).refs).not.toEqual(a.refs)
  })

  it('builds valid refs, layers and pipelines', () => {
    const g = synthGraph({ tables: 500, pipelines: 10, tasksPerPipeline: 3 })
    const ids = new Set(g.tables.map((t) => t.id))
    const layers = new Set(g.layers.map((l) => l.id))
    expect(g.tables).toHaveLength(500)
    expect(g.tables.every((t) => layers.has(t.layerId))).toBe(true)
    expect(g.refs.length).toBeGreaterThan(300)
    expect(g.refs.every((r) => ids.has(r.from.table) && ids.has(r.to.table) && r.from.table !== r.to.table)).toBe(true)
    expect(g.workflows.pipelines).toHaveLength(10)
    expect(g.workflows.pipelines.every((p) => p.tasks.length === 3)).toBe(true)
  })

  it('emits DBML the parser reads back', () => {
    const g = synthGraph({ tables: 120 })
    const back = parseDbml(synthDbml(g))
    expect(back.tables.map((t) => t.id).sort()).toEqual(g.tables.map((t) => t.id).sort())
    expect(back.refs).toHaveLength(g.refs.length)
  })

  it('parses URL specs', () => {
    expect(parseSynthSpec('tables:20000, pipelines:300,seed:2,bogus:1,layers:x')).toEqual({ tables: 20000, pipelines: 300, seed: 2 })
  })
})
