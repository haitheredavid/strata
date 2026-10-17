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
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-12') }))
    s().setMode('stack')
    s().dragNode('silver.orders', [42, 0, -7])
    s().load(sample()) // another dataset: the snapshot's layout is saved on the way out
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-13', '\nTable silver.refunds {\n  id int [pk]\n}\n') }))
    expect(s().layout.positions['silver.orders']).toEqual({ x: 42, z: -7 })
    expect(s().layout.positions['silver.refunds']).toBeDefined()
    expect(s().layout.mode).toBe('stack')
  })

  it("replaces the previous dataset's warnings but keeps errors until they're dismissed", () => {
    const s = () => useStore.getState()
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-12') }))
    s().notify('error', 'Couldn’t open broken.dbml')
    s().load(buildDataset({ origin: 'snapshot', snapshot: snapshot('2026-10-13') }))
    expect(s().notices.map((n) => [n.level, n.detail ?? n.text])).toEqual([
      ['error', 'Couldn’t open broken.dbml'],
      ['warning', ['exported 2026-10-13']],
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
