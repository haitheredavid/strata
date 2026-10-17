import { describe, expect, it } from 'vitest'
import type { BenchFn } from 'vitest'
import { synthDbml, synthGraph } from '../dev/synth'
import type { SynthOptions } from '../dev/synth'
import { SNAPSHOT_BUDGET_MS, SNAPSHOT_SHAPE } from './budgets'
import { autoLayout, viewLayoutGraph } from '../layout/autoLayout'
import { MODE_IDS, MODES } from '../layout/modes'
import { placeClusters } from '../layout/modes/compute'
import { placeJobs } from '../layout/modes/jobs'
import type { Graph, Layout } from '../model/types'
import { parseDbml } from '../parse/dbml'
import { simulateDay } from '../sim/schedule'
import { deriveView } from '../view/deriveView'

/**
 * Load-path cost by graph size: parse → autoLayout → deriveView → place (+ jobs, clusters) → simulateDay.
 * `pnpm bench`. Sizes where a step is already too slow to iterate are left out of that step (see SHAPES).
 * The 600-table snapshot shape also times a pipeline-tables-only stack's layout, and fails a step whose
 * mean is over its `SNAPSHOT_BUDGET_MS` ceiling.
 */
const SHAPES: { name: string; options: Partial<SynthOptions>; budgets?: boolean }[] = [
  { name: 'snapshot shape (608 tables)', options: SNAPSHOT_SHAPE, budgets: true },
  ...[1_000, 10_000, 50_000].map((n) => ({ name: `${n} tables`, options: { tables: n, pipelines: Math.round(n / 80) } })),
]
/** Largest size autoLayout is timed at. */
const LAYOUT_MAX = 50_000
const opts = { iterations: 3, warmupIterations: 1, time: 0, warmupTime: 0 }

/** One timed step per test (vitest 5's `bench` fixture), held to `budget` ms (mean) when given. */
const step = (name: string, fn: BenchFn, budget?: number) =>
  it(name, { timeout: 600_000 }, async ({ bench, task }) => {
    const r = await bench(name, fn).run(opts)
    // vitest captures console in bench runs; stdout reaches the terminal
    const over = budget !== undefined && r.latency.mean > budget
    process.stdout.write(
      `[bench] ${task.suite?.name} · ${name}: mean ${r.latency.mean.toFixed(1)}ms, max ${r.latency.max.toFixed(1)}ms${budget === undefined ? '' : `, budget ${budget}ms${over ? ' OVER' : ''}`}\n`,
    )
    if (budget !== undefined) expect(r.latency.mean).toBeLessThan(budget)
  })

const graphs = new Map<string, Graph>()
const graphOf = (name: string, options: Partial<SynthOptions>) => {
  let g = graphs.get(name)
  if (!g) graphs.set(name, (g = synthGraph({ seed: 1, ...options })))
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

for (const { name, options, budgets } of SHAPES) {
  const n = options.tables ?? 0
  const g = () => graphOf(name, options)
  const b = budgets ? SNAPSHOT_BUDGET_MS : undefined
  describe(name, () => {
    if (n <= 10_000) {
      const dbml = synthDbml(g())
      step('parseDbml', () => void parseDbml(dbml))
    }
    if (n <= LAYOUT_MAX) step('autoLayout', () => void autoLayout(g()), b?.autoLayout)
    if (b) {
      const filtered = deriveView(g(), { lineage: true, pipelineTablesOnly: true })
      step('autoLayout (pipeline tables only)', () => void autoLayout(viewLayoutGraph(filtered)), b.filteredStack)
    }
    step('deriveView (lineage)', () => void deriveView(g(), { lineage: true }), b?.deriveView)
    step('simulateDay', () => void simulateDay(g().workflows, g().tables), b?.simulateDay)
    for (const id of MODE_IDS) {
      step(
        `place ${id} (+jobs, clusters)`,
        () => {
          const view = deriveView(g(), { lineage: true })
          const layout = spiral(g())
          placeClusters(view, placeJobs(view, MODES[id].place(view, layout, { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }), id, 8), id, 8)
        },
        b?.place[id],
      )
    }
  })
}
