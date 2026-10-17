import { describe, expect, it } from 'vitest'
import { planOpen } from './open'

const dbml = 'Table orders {\n  id int [pk]\n}\n'
const yaml = 'pipelines:\n  - id: p\n    tasks:\n      - id: t\n        reads: [orders]\n'
const snap = { kind: 'strata-snapshot', version: 1, host: 'https://h', exportedAt: '', day: '2026-10-12', tz: 'UTC', dbml, workflows: yaml, runs: { runs: [], taskRuns: [], events: [] }, warnings: [] }
const snapshot = JSON.stringify(snap)
const layout = JSON.stringify({ layerGap: 8, layerOrder: ['a'], positions: { orders: { x: 0, z: 0 } } })

describe('planOpen', () => {
  it('reports a snapshot it can’t use, with what is wrong, and still opens the rest', () => {
    const { day: _day, runs: _runs, ...broken } = snap
    const { plan, ignored, problems } = planOpen([
      { name: 'old.snapshot.json', text: JSON.stringify({ ...broken, version: 2 }) },
      { name: 'cut.snapshot.json', text: JSON.stringify(broken) },
      { name: 'schema.dbml', text: dbml },
    ])
    expect(plan.kind).toBe('schema')
    expect(ignored).toEqual([])
    expect(problems).toEqual([
      "old.snapshot.json isn't a usable snapshot: version 2 isn't supported (this app reads version 1)",
      "cut.snapshot.json isn't a usable snapshot: missing or invalid day (YYYY-MM-DD), runs.taskRuns",
    ])
  })

  it('opens a snapshot over anything dropped with it', () => {
    const { plan, ignored } = planOpen([
      { name: 'schema.dbml', text: dbml },
      { name: 'ws.snapshot.json', text: snapshot },
    ])
    expect(plan.kind).toBe('snapshot')
    expect(ignored).toEqual(['schema.dbml'])
  })

  it('pairs a schema with its workflow file and names what it skips', () => {
    const { plan, ignored } = planOpen([
      { name: 'jobs.yaml', text: yaml },
      { name: 'notes.png', text: '\u0089PNG' },
      { name: 'schema.dbml', text: dbml },
      { name: 'more.yml', text: yaml },
    ])
    expect(plan).toEqual({ kind: 'schema', name: 'schema.dbml', dbml, workflows: yaml })
    expect(ignored).toEqual(['notes.png', 'more.yml'])
  })

  it('recognises a schema by its content', () => {
    expect(planOpen([{ name: 'export.sql', text: dbml }]).plan.kind).toBe('schema')
  })

  it('tells a layout export from a workflow file among JSON files', () => {
    expect(planOpen([{ name: 'layout.json', text: layout }]).plan.kind).toBe('layout')
    expect(planOpen([{ name: 'jobs.json', text: JSON.stringify({ pipelines: [{ id: 'p', tasks: [{ id: 't' }] }] }) }]).plan.kind).toBe('workflows')
  })

  it('opens nothing for JSON that is none of those', () => {
    const { plan, ignored } = planOpen([{ name: 'package.json', text: '{"name":"x"}' }])
    expect(plan.kind).toBe('none')
    expect(ignored).toEqual(['package.json'])
  })
})
