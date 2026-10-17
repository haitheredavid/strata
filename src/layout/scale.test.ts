import { beforeAll, describe, expect, it } from 'vitest'
import { SNAPSHOT_BUDGET_MS, SNAPSHOT_SHAPE } from '../bench/budgets'
import { synthGraph } from '../dev/synth'
import type { Graph, Layout } from '../model/types'
import { simulateDay } from '../sim/schedule'
import { deriveView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { autoLayout, viewLayoutGraph } from './autoLayout'
import { MODE_IDS, MODES } from './modes'
import { placeClusters } from './modes/compute'
import { placeJobs } from './modes/jobs'

const noFocus = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }

/** Milliseconds `fn` takes, once. */
function timed(fn: () => unknown): number {
  const t = performance.now()
  fn()
  return performance.now() - t
}

/**
 * Load-path ceilings at the 600-table snapshot shape (`SNAPSHOT_BUDGET_MS`), each step timed cold on a
 * fresh view so no placement cache helps. Local only (`pnpm test:scale`): shared CI runners are too
 * noisy to fail a build on.
 */
describe.runIf(process.env.STRATA_SCALE)('snapshot-shape budgets', () => {
  let graph: Graph
  let layout: Layout
  beforeAll(() => {
    graph = synthGraph(SNAPSHOT_SHAPE)
  })

  it('lays out the whole graph', { timeout: 30_000 }, () => {
    expect(timed(() => (layout = autoLayout(graph)))).toBeLessThan(SNAPSHOT_BUDGET_MS.autoLayout)
  })

  it('derives the view and simulates the day', () => {
    expect(timed(() => deriveView(graph, { lineage: true }))).toBeLessThan(SNAPSHOT_BUDGET_MS.deriveView)
    expect(timed(() => simulateDay(graph.workflows, graph.tables))).toBeLessThan(SNAPSHOT_BUDGET_MS.simulateDay)
  })

  it('lays out a pipeline-tables-only stack', { timeout: 30_000 }, () => {
    const view = deriveView(graph, { lineage: true, pipelineTablesOnly: true })
    expect(timed(() => autoLayout(viewLayoutGraph(view)))).toBeLessThan(SNAPSHOT_BUDGET_MS.filteredStack)
  })

  for (const id of MODE_IDS)
    it(`places ${id} mode`, () => {
      const view = deriveView(graph, { lineage: true })
      const ms = timed(() => placeClusters(view, placeJobs(view, MODES[id].place(view, layout, noFocus), id, 8), id, 8))
      expect(ms).toBeLessThan(SNAPSHOT_BUDGET_MS.place[id])
    })
})

/**
 * Regression guard for big schemas: every mode must place 60k tables without throwing (e.g. a
 * `Math.min(...arr)` spread overflowing the call stack). Positions are a cheap spiral so the test
 * doesn't time autoLayout. Slow today (about a minute), so it runs with `pnpm test:scale`.
 */
describe.runIf(process.env.STRATA_SCALE)('60k tables', () => {
  let view: ViewGraph
  let layout: Layout

  beforeAll(() => {
    const graph = synthGraph({ tables: 60_000, pipelines: 400, seed: 3 })
    const positions: Layout['positions'] = {}
    graph.tables.forEach((t, i) => {
      const r = Math.sqrt(i) * 4
      const a = i * 2.399963
      positions[t.id] = { x: r * Math.cos(a), z: r * Math.sin(a) }
    })
    layout = { layerGap: 8, layerOrder: graph.layers.map((l) => l.id), positions }
    view = deriveView(graph, { lineage: true })
  })

  for (const id of MODE_IDS)
    it(`places every node in ${id} mode`, { timeout: 60_000 }, () => {
      const placed = placeClusters(view, placeJobs(view, MODES[id].place(view, layout, noFocus), id, layout.layerGap), id, layout.layerGap)
      expect(Object.keys(placed.nodes).length).toBeGreaterThanOrEqual(view.nodes.length)
    })
})
