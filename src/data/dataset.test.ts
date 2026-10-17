import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../ingest/snapshot'
import { parseDbml } from '../parse/dbml'
import { simulateDay } from '../sim/schedule'
import { buildDataset, mergeLayout, normaliseLayout, withWorkflows } from './dataset'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const dbml = read('lakehouse.dbml')
const yaml = read('lakehouse.workflows.yaml')

function snapshot(): Snapshot {
  const graph = parseDbml(dbml, yaml)
  return {
    kind: 'strata-snapshot',
    version: 1,
    host: 'https://dbc-123.cloud.databricks.com',
    exportedAt: '2026-10-13T00:00:00Z',
    day: '2026-10-12',
    tz: 'America/New_York',
    dbml,
    workflows: yaml,
    runs: simulateDay(graph.workflows, graph.tables, 'real'),
    warnings: ['2 task run(s) are of tasks no longer in their job'],
  }
}

describe('buildDataset', () => {
  it('uses a snapshot’s runs and day, with its export notes ahead of workflow warnings', () => {
    const snap = snapshot()
    const d = buildDataset({ origin: 'snapshot', snapshot: snap })
    expect(d.schedule.taskRuns).toBe(snap.runs.taskRuns)
    expect(d.schedule).toMatchObject({ origin: 'snapshot', day: '2026-10-12', tz: 'America/New_York' })
    expect(d.meta).toEqual({ host: snap.host, day: '2026-10-12', tz: 'America/New_York' })
    expect(d.warnings[0]).toEqual({ text: snap.warnings[0], items: [] })
    expect(d.label).toBe('dbc-123 · 2026-10-12')
  })

  it('names one dataset per schema file content, whatever the file is called', () => {
    const a = buildDataset({ origin: 'file', name: 'a.dbml', dbml })
    const b = buildDataset({ origin: 'file', name: 'b.dbml', dbml, workflows: yaml })
    expect(a.key).toBe(b.key)
    expect(a.layoutKey).toBe(b.layoutKey)
    expect(b.graph.workflows.pipelines.length).toBeGreaterThan(0)
  })

  it('reports a broken schema with its line', () => {
    expect(() => buildDataset({ origin: 'file', name: 'bad.dbml', dbml: 'Table x {\n  id int\n' })).toThrow(/^Schema error on line \d+:/)
  })

  it('needs the fetched files for a sample', () => {
    expect(() => buildDataset({ origin: 'sample', id: 'lakehouse' })).toThrow(/files not loaded/)
    expect(buildDataset({ origin: 'sample', id: 'lakehouse' }, { dbml, workflows: yaml }).graph.workflows.pipelines.length).toBeGreaterThan(0)
  })
})

describe('withWorkflows', () => {
  const other = 'pipelines:\n  - id: only\n    tasks:\n      - id: t\n        reads: [bronze.orders_raw]\n'
  // lakehouse.dbml also defines jobs in table notes; those stay, the replaced file's pipelines go.
  const ids = (d: { graph: { workflows: { pipelines: { id: string }[] } } }) => d.graph.workflows.pipelines.map((p) => p.id)

  it('keeps a snapshot’s runs and identity when its workflow file is replaced', () => {
    const d = buildDataset({ origin: 'snapshot', snapshot: snapshot() })
    const next = withWorkflows(d, other)
    expect(ids(d)).toContain('ingest_sales')
    expect(ids(next)).toContain('only')
    expect(ids(next)).not.toContain('ingest_sales')
    expect(next.schedule.taskRuns).toBe(d.schedule.taskRuns)
    expect([next.key, next.layoutKey]).toEqual([d.key, d.layoutKey])
    expect(next.source).toMatchObject({ origin: 'snapshot', workflows: other })
  })

  it('rebuilds a sample from its own schema text', () => {
    const d = buildDataset({ origin: 'sample', id: 'lakehouse' }, { dbml, workflows: yaml })
    expect(ids(withWorkflows(d, other))).toContain('only')
    expect(ids(withWorkflows(d, other))).not.toContain('ingest_sales')
  })

  it('rejects a file with no pipelines, and synthetic graphs', () => {
    const d = buildDataset({ origin: 'file', name: 'l.dbml', dbml, workflows: yaml })
    expect(() => withWorkflows(d, 'pipelines: [')).toThrow(/Workflow file/)
    expect(() => withWorkflows(d, 'foo: 1')).toThrow(/no pipelines/)
    expect(() => withWorkflows(buildDataset({ origin: 'synth', options: { tables: 20 } }), yaml)).toThrow(/synthetic/)
  })
})

describe('normaliseLayout', () => {
  it('drops pipelines, cards and flow layers the graph no longer has', () => {
    const { graph } = buildDataset({ origin: 'file', name: 'l.dbml', dbml, workflows: yaml })
    const pipeline = graph.workflows.pipelines[0].id
    const table = graph.tables[0].id
    const layer = graph.layers[0].id
    const layout = normaliseLayout(
      { layerGap: 8, layerOrder: [], positions: {}, hiddenPipelines: [pipeline, 'gone'], collapsedCards: ['gone', table], flowOrder: [layer, 'gone', '__sources__'] },
      graph,
    )
    expect(layout.hiddenPipelines).toEqual([pipeline])
    expect(layout.collapsedCards).toEqual([table])
    expect(layout.flowOrder).toEqual([layer, '__sources__'])
  })
})

describe('snapshot layouts', () => {
  it('share a layout key across exports of the same host and catalogs, whatever the schema text', () => {
    const today = buildDataset({ origin: 'snapshot', snapshot: snapshot() })
    const tomorrow = buildDataset({ origin: 'snapshot', snapshot: { ...snapshot(), day: '2026-10-13', dbml: `${dbml}\nTable silver.extra { id int }\n` } })
    const elsewhere = buildDataset({ origin: 'snapshot', snapshot: { ...snapshot(), host: 'https://dbc-999.cloud.databricks.com' } })
    expect(tomorrow.key).not.toBe(today.key)
    expect(tomorrow.layoutKey).toBe(today.layoutKey)
    expect(elsewhere.layoutKey).not.toBe(today.layoutKey)
  })

  it('keep saved positions and layer order for what still exists and place the rest fresh', () => {
    const { graph } = buildDataset({ origin: 'file', name: 'l.dbml', dbml })
    const [a, b] = graph.tables
    const layers = graph.layers.map((l) => l.id)
    const saved = { layerGap: 12, layerOrder: [layers[1], 'gone', layers[0]], positions: { [a.id]: { x: 1, z: 1 }, gone: { x: 9, z: 9 } }, mode: 'flow' as const }
    const fresh = { layerGap: 8, layerOrder: layers, positions: { [a.id]: { x: 5, z: 5 }, [b.id]: { x: 6, z: 6 } } }
    const merged = mergeLayout(saved, fresh, graph)
    expect(merged.positions[a.id]).toEqual({ x: 1, z: 1 })
    expect(merged.positions[b.id]).toEqual({ x: 6, z: 6 })
    expect(merged.positions.gone).toBeUndefined()
    expect(merged.layerOrder).toEqual([layers[1], layers[0], ...layers.slice(2)])
    expect([merged.mode, merged.layerGap]).toEqual(['flow', 12])
  })
})
