import { describe, it } from 'vitest'
import type { BenchFn } from 'vitest'
import { synthDbml, synthGraph } from '../dev/synth'
import { autoLayout } from '../layout/autoLayout'
import { MODE_IDS, MODES } from '../layout/modes'
import { placeClusters } from '../layout/modes/compute'
import { placeJobs } from '../layout/modes/jobs'
import type { Graph, Layout } from '../model/types'
import { parseDbml } from '../parse/dbml'
import { simulateDay } from '../sim/schedule'
import { deriveView } from '../view/deriveView'

/**
 * Load-path cost by graph size: parse → autoLayout → deriveView → place (+ jobs, clusters) → simulateDay.
 * `pnpm bench`. Sizes where a step is already too slow to iterate are left out of that step (see SIZES).
 */
const SIZES = [1_000, 10_000, 50_000]
/** autoLayout is O(n²) today; past this it takes minutes. */
const LAYOUT_MAX = 5_000
const opts = { iterations: 3, warmupIterations: 1, time: 0, warmupTime: 0 }

/** One timed step per test (vitest 5's `bench` fixture). */
const step = (name: string, fn: BenchFn) =>
  it(name, { timeout: 600_000 }, async ({ bench, task }) => {
    const r = await bench(name, fn).run(opts)
    // vitest captures console in bench runs; stdout reaches the terminal
    process.stdout.write(`[bench] ${task.suite?.name} · ${name}: mean ${r.latency.mean.toFixed(1)}ms, max ${r.latency.max.toFixed(1)}ms\n`)
  })

const graphs = new Map<number, Graph>()
const graphOf = (n: number) => {
  let g = graphs.get(n)
  if (!g) graphs.set(n, (g = synthGraph({ tables: n, pipelines: Math.round(n / 80), seed: 1 })))
  return g
}

/** Spiral positions: a valid layout without paying for autoLayout. */
function spiral(g: Graph): Layout {
  const positions: Layout['positions'] = {}
  g.tables.forEach((t, i) => {
    const r = Math.sqrt(i) * 4
    positions[t.id] = { x: r * Math.cos(i * 2.399963), z: r * Math.sin(i * 2.399963) }
  })
  return { layerGap: 8, layerOrder: g.layers.map((l) => l.id), positions }
}

for (const n of SIZES) {
  describe(`${n} tables`, () => {
    if (n <= 10_000) {
      const dbml = synthDbml(graphOf(n))
      step('parseDbml', () => void parseDbml(dbml))
    }
    if (n <= LAYOUT_MAX) step('autoLayout', () => void autoLayout(graphOf(n)))
    step('deriveView (lineage)', () => void deriveView(graphOf(n), { lineage: true }))
    step('simulateDay', () => void simulateDay(graphOf(n).workflows, graphOf(n).tables))
    for (const id of MODE_IDS) {
      // stack places sources and jobs with a full force layout, quadratic for now
      if (id === 'stack' && n > 10_000) continue
      step(`place ${id} (+jobs, clusters)`, () => {
        const g = graphOf(n)
        const view = deriveView(g, { lineage: true })
        const layout = spiral(g)
        placeClusters(view, placeJobs(view, MODES[id].place(view, layout, { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }), id, 8), id, 8)
      })
    }
  })
}
