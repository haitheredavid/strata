import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDataset, withWorkflows } from './data/dataset'
import type { Snapshot } from './ingest/snapshot'
import { useStore } from './store'
import { memoryStorage } from './test/memoryStorage'

const read = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8')
const dbml = read('lakehouse.dbml')
const yaml = read('lakehouse.workflows.yaml')

const snapshot = (day: string, extra = ''): Snapshot => ({
  kind: 'strata-snapshot',
  version: 1,
  host: 'https://dbc-123.cloud.databricks.com',
  exportedAt: `${day}T23:00:00Z`,
  day,
  tz: 'UTC',
  dbml: dbml + extra,
  workflows: yaml,
  runs: { runs: [], taskRuns: [], events: [] },
  warnings: [`exported ${day}`],
})
const sample = () => buildDataset({ origin: 'file', name: 'sample.dbml', dbml: read('sample.dbml') })

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

describe('store.load', () => {
  it('keeps positions from an earlier export of the same slice and places tables that are new', () => {
    const s = () => useStore.getState()
    localStorage.setItem('strata:labs', '1') // Stack is a lab layout
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-12') }))
    s().setMode('stack')
    s().dragNode('silver.orders', [42, 0, -7])
    s().load(sample()) // another dataset: the snapshot's layout is saved on the way out
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-13', '\nTable silver.refunds {\n  id int [pk]\n}\n') }))
    expect(s().layout.positions['silver.orders']).toEqual({ x: 42, z: -7 })
    expect(s().layout.positions['silver.refunds']).toBeDefined()
    expect(s().layout.mode).toBe('stack')
  })

  it("shows a dataset's warnings on demand, and drops them when another dataset loads, keeping errors", () => {
    const s = () => useStore.getState()
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-12') }))
    s().notify('error', 'Couldn’t open broken.dbml')
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-13') }))
    expect(s().notices.map((n) => n.level)).toEqual(['error'])
    s().showDatasetWarnings()
    expect(s().notices.map((n) => [n.level, n.detail ?? n.text])).toEqual([
      ['error', 'Couldn’t open broken.dbml'],
      ['warning', [{ text: 'exported 2026-10-13', items: [] }]],
    ])
    s().load(sample())
    expect(s().notices.map((n) => n.level)).toEqual(['error'])
  })

  it('keeps the view over a new workflow file, but drops "only this" for a pipeline it no longer has', () => {
    const s = () => useStore.getState()
    const d = buildDataset({ origin: 'file', name: 'lakehouse.dbml', dbml, workflows: yaml })
    s().load(d)
    s().focus('silver.orders')
    s().onlyPipeline('ml_churn') // from the workflow file; sales_refresh would survive (DBML notes define it)
    s().load(withWorkflows(d, 'pipelines:\n  - id: other\n    tasks:\n      - id: t\n        reads: [silver.orders]\n'))
    expect(s().focusedId).toBe('silver.orders')
    expect(s().layout.onlyPipeline).toBeUndefined()
  })
})

describe('selection', () => {
  it('holds one thing: selecting a pipeline clears a focused node, and focusing a node clears the pipeline', () => {
    const s = () => useStore.getState()
    s().load(buildDataset({ origin: 'file', name: 'lakehouse.dbml', dbml, workflows: yaml }))
    s().focus('silver.orders')
    s().setLens('ml_churn')
    expect([s().focusedId, s().lensPipeline]).toEqual([null, 'ml_churn'])
    s().focus('silver.orders')
    expect([s().focusedId, s().lensPipeline]).toEqual(['silver.orders', null])
    s().openTimeline('ml_churn')
    expect([s().focusedId, s().lensPipeline]).toEqual([null, 'ml_churn'])
  })
})

describe('lab layouts', () => {
  it('reopen a saved Stack or Orbit layout as the diagram unless labs are on', () => {
    const s = () => useStore.getState()
    const d = buildDataset({ origin: 'file', name: 'lakehouse.dbml', dbml, workflows: yaml })
    s().load(d)
    expect(s().layout.mode ?? 'diagram').toBe('diagram')
    s().setMode('orbit')
    s().load(sample()) // saves the lakehouse layout on the way out
    s().load(d)
    expect(s().layout.mode).toBe('diagram')
    localStorage.setItem('strata:labs', '1')
    s().setMode('orbit')
    s().load(sample())
    s().load(d)
    expect(s().layout.mode).toBe('orbit')
  })
})
