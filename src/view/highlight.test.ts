import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { deriveView, hiddenPipelinesOf, jobNodeId, sceneView } from './deriveView'
import { escapeStep } from './escape'
import type { EscapeInputs } from './escape'
import { probeLit, scopeLit } from './highlight'
import { hops } from './hops'
import { findPaths } from './paths'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const view = deriveView(graph, { lineage: true })

describe('scopeLit', () => {
  it('lights what the lens pipeline touches, and the timeline’s pipelines instead when it is open', () => {
    const lens = scopeLit(view, null, 'ml_churn')!
    expect(lens.nodes.has(jobNodeId('score_churn'))).toBe(true)
    expect(lens.nodes.has(jobNodeId('clean_orders'))).toBe(false)
    const time = scopeLit(view, new Set(['sales_refresh']), 'ml_churn')!
    expect(time.nodes.has(jobNodeId('clean_orders'))).toBe(true)
    expect(time.nodes.has(jobNodeId('score_churn'))).toBe(false)
  })

  it('is empty, not missing, for a lens with lineage off', () => {
    const scope = scopeLit(deriveView(graph), null, 'ml_churn')!
    expect(scope.nodes.size).toBe(0)
  })
})

describe('probeLit', () => {
  it('drills into a focus neighbourhood with the edges and flows inside it, even outside the scope', () => {
    const focus = jobNodeId('clean_orders')
    const reach = new Map([[focus, { hop: 0, dir: 0 as const }], ['bronze.orders_raw', { hop: 1, dir: -1 as const }]])
    const probe = probeLit(view, reach, [], null)!
    expect([...probe.nodes]).toEqual([focus, 'bronze.orders_raw'])
    expect([...probe.flows].every((id) => view.flows.find((f) => f.id === id)!.taskId === 'clean_orders')).toBe(true)
    expect(probe.flows.size).toBeGreaterThan(0)
    // The scope doesn't clip it: the ml_churn lens doesn't touch clean_orders.
    expect(scopeLit(view, null, 'ml_churn')!.nodes.has(focus)).toBe(false)
  })

  it('prefers found paths over the focus, and shows only the picked one', () => {
    const fk = deriveView(parseDbml(read('sample.dbml')))
    const paths = findPaths(fk, 'order_items', 'users')
    expect(paths.length).toBeGreaterThan(1)
    const reach = hops(fk, 'products', 1, 1)
    const all = probeLit(fk, reach, paths, null)!
    expect(all.nodes.has('products')).toBe(paths.some((p) => p.nodes.includes('products')))
    const one = probeLit(fk, reach, paths, 0)!
    expect([...one.nodes]).toEqual(paths[0].nodes)
    expect([...one.edges]).toEqual(paths[0].edges)
  })
})

describe('only this', () => {
  it('keeps the hidden pipelines for when "only this" is cleared', () => {
    expect(hiddenPipelinesOf({ graph, hiddenPipelines: ['ml_churn'], onlyPipeline: 'sales_refresh' })).not.toContain('sales_refresh')
    expect(hiddenPipelinesOf({ graph, hiddenPipelines: ['ml_churn'] })).toEqual(['ml_churn'])
  })

  it('shows one layer over the hidden set', () => {
    const v = sceneView({ graph, groupBy: 'medallion', hiddenLayers: ['silver'], onlyLayer: 'silver' })
    expect(new Set(v.nodes.filter((n) => n.kind === 'table').map((n) => n.layerId))).toEqual(new Set(['silver']))
  })
})

describe('escapeStep', () => {
  const none: EscapeInputs = { pathOpen: false, focusedId: null, lensPipeline: null, time: { open: false, span: null }, layout: {} }

  it('peels the innermost layer first', () => {
    const all: EscapeInputs = {
      pathOpen: true,
      focusedId: 'a',
      lensPipeline: 'p',
      time: { open: true, span: [0, 60] },
      layout: { onlyPipeline: 'p', onlyLayer: 'l' },
    }
    expect(escapeStep(all)).toBe('path')
    expect(escapeStep({ ...all, pathOpen: false })).toBe('focus')
    expect(escapeStep({ ...all, pathOpen: false, focusedId: null })).toBe('lens')
    expect(escapeStep({ ...none, time: { open: true, span: [0, 60] }, layout: all.layout })).toBe('span')
    expect(escapeStep({ ...none, layout: all.layout })).toBe('onlyPipeline')
    expect(escapeStep({ ...none, layout: { onlyLayer: 'l' } })).toBe('onlyLayer')
    expect(escapeStep(none)).toBe(null)
  })

  it('ignores a span left on a closed timeline', () => {
    expect(escapeStep({ ...none, time: { open: false, span: [0, 60] } })).toBe(null)
  })
})
