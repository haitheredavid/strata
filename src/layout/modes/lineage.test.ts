import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../../parse/dbml'
import { SOURCES, deriveView, domainNodeId, jobNodeId } from '../../view/deriveView'
import { autoLayout } from '../autoLayout'
import { flowOrder, placeFlow } from './flow'
import { placeJobs } from './jobs'
import { placeOrbit } from './orbit'
import { placeStack } from './stack'

const read = (f: string) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const layout = autoLayout(graph)
const noFocus = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }

describe('deriveView with lineage', () => {
  const view = deriveView(graph, { lineage: true })

  it('adds a job per task, sources, and read/write flows', () => {
    expect(view.nodes.filter((n) => n.kind === 'job')).toHaveLength(16)
    expect(view.nodes.filter((n) => n.kind === 'source').map((n) => n.name)).toContain('kafka.clickstream')
    expect(view.layers[0].id).toBe(SOURCES)
    const clean = view.flows.filter((f) => f.taskId === 'clean_orders')
    expect(clean.filter((f) => f.role === 'read').map((f) => f.from).sort()).toEqual(['bronze.order_lines_raw', 'bronze.orders_raw'])
    expect(clean.filter((f) => f.role === 'write').every((f) => f.from === jobNodeId('clean_orders'))).toBe(true)
  })

  it('leaves lineage out unless asked, and hides pipelines', () => {
    expect(deriveView(graph).flows).toEqual([])
    const v = deriveView(graph, { lineage: true, hiddenPipelines: ['ml_churn'] })
    expect(v.nodes.some((n) => n.id === jobNodeId('score_churn'))).toBe(false)
    expect(v.nodes.some((n) => n.name === 'models.churn_v3')).toBe(false)
  })

  it('re-points flows to collapsed domains and drops hidden ones', () => {
    const collapsed = deriveView(graph, { lineage: true, collapsedLayers: ['sales'] })
    const flows = collapsed.flows.filter((f) => f.taskId === 'clean_orders')
    expect(flows.every((f) => f.from === domainNodeId('sales') || f.to === domainNodeId('sales'))).toBe(true)
    expect(new Set(flows.map((f) => f.id)).size).toBe(flows.length)
    const hidden = deriveView(graph, { lineage: true, hiddenLayers: [SOURCES] })
    expect(hidden.flows.some((f) => f.from.startsWith('source:'))).toBe(false)
  })

  it('groups by medallion with a fixed flow order', () => {
    const v = deriveView(graph, { lineage: true, groupBy: 'medallion' })
    expect(v.layers.map((l) => l.id)).toEqual([SOURCES, 'bronze', 'silver', 'gold'])
    expect(flowOrder(v, { groupBy: 'medallion', flowOrder: ['gold', 'bronze', 'silver'] })).toEqual([SOURCES, 'bronze', 'silver', 'gold'])
  })
})

describe('placeJobs', () => {
  const view = deriveView(graph, { lineage: true, groupBy: 'medallion' })
  const ml = { ...layout, groupBy: 'medallion' as const }
  const placements = {
    stack: placeJobs(view, placeStack(view, ml), 'stack', 8),
    flow: placeJobs(view, placeFlow(view, ml, noFocus), 'flow', 8),
    orbit: placeJobs(view, placeOrbit(view, ml, noFocus), 'orbit', 8),
  }
  const jobs = view.nodes.filter((n) => n.kind === 'job')

  it('places every job, deterministically', () => {
    for (const [mode, p] of Object.entries(placements)) {
      expect(jobs.every((j) => p.nodes[j.id]?.frame === 'billboard'), mode).toBe(true)
    }
    expect(placeJobs(view, placeFlow(view, ml, noFocus), 'flow', 8)).toEqual(placements.flow)
  })

  it('puts a job between the layers it reads and writes', () => {
    const job = jobNodeId('clean_orders') // bronze -> silver
    const x = (id: string) => placements.flow.nodes[id].p[0]
    expect(x(job)).toBeGreaterThan(x('bronze.orders_raw'))
    expect(x(job)).toBeLessThan(x('silver.orders'))
    const y = (id: string) => placements.stack.nodes[id].p[1]
    expect(y(job)).toBeGreaterThan(y('bronze.orders_raw'))
    expect(y(job)).toBeLessThan(y('silver.orders'))
  })

  it('keeps jobs apart', () => {
    for (const p of Object.values(placements))
      for (let i = 0; i < jobs.length; i++)
        for (let j = i + 1; j < jobs.length; j++) {
          const [a, b] = [p.nodes[jobs[i].id].p, p.nodes[jobs[j].id].p]
          expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(2.5)
        }
  })
})
