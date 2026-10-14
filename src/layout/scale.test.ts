import { beforeAll, describe, expect, it } from 'vitest'
import { synthGraph } from '../dev/synth'
import type { Layout } from '../model/types'
import { deriveView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { MODE_IDS, MODES } from './modes'
import { placeClusters } from './modes/compute'
import { placeJobs } from './modes/jobs'

/**
 * Regression guard for big schemas: every mode must place 60k tables without throwing (e.g. a
 * `Math.min(...arr)` spread overflowing the call stack). Positions are a cheap spiral so the test
 * doesn't time autoLayout. Slow today (about a minute), so it runs with `pnpm test:scale`.
 */
describe.runIf(process.env.STRATA_SCALE)('60k tables', () => {
  let view: ViewGraph
  let layout: Layout
  const noFocus = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }

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
