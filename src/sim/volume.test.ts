import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { parseBytes } from '../parse/workflows'
import { deriveView } from '../view/deriveView'
import { simulateDay } from './schedule'
import { flowVolumes, formatBytes, pulseShape } from './volume'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')

function lakehouse(yaml = read('lakehouse.workflows.yaml')) {
  const graph = parseDbml(read('lakehouse.dbml'), yaml)
  const flows = deriveView(graph, { lineage: true }).flows
  return { graph, flows, volumes: flowVolumes(flows, graph, simulateDay(graph.workflows, graph.tables)) }
}

describe('parseBytes', () => {
  it('reads plain bytes and SI / binary units', () => {
    expect(parseBytes(1234)).toBe(1234)
    expect(parseBytes('500MB')).toBe(5e8)
    expect(parseBytes('4 GB')).toBe(4e9)
    expect(parseBytes('1GiB')).toBe(1024 ** 3)
    expect(parseBytes('lots')).toBeUndefined()
  })

  it('warns on an unreadable size', () => {
    const g = parseDbml(read('lakehouse.dbml'), 'pipelines:\n  - id: p\n    tasks:\n      - id: t\n        bytes: lots\n        reads: [bronze.orders_raw]\n')
    expect(g.workflows.warnings.some((w) => w.includes('unreadable size'))).toBe(true)
  })
})

describe('flowVolumes', () => {
  it('is deterministic', () => {
    expect(lakehouse().volumes).toEqual(lakehouse().volumes)
  })

  it('uses a declared task size', () => {
    const { flows, volumes } = lakehouse()
    const orders = flows.filter((f) => f.taskId === 'ingest_orders')
    expect(orders.length).toBeGreaterThan(0)
    for (const f of orders) expect(volumes.get(f.id)!.bytes).toBe(18e9)
  })

  it('counts runs a day from the simulated schedule', () => {
    const { flows, volumes } = lakehouse()
    const runs = (task: string) => volumes.get(flows.find((f) => f.taskId === task)!.id)!.runsPerDay
    expect(runs('ingest_customers')).toBe(1) // cron 0 1 * * *
    expect(runs('ingest_events')).toBe(144) // streaming: 10-minute micro-batches
  })

  it('sizes simulated bronze writes above gold writes', () => {
    const { graph, flows, volumes } = lakehouse()
    const medallion = new Map(graph.tables.map((t) => [t.id, t.medallion]))
    const mean = (m: string) => {
      const xs = flows.filter((f) => f.role === 'write' && medallion.get(f.to) === m).map((f) => volumes.get(f.id)!.bytes)
      return xs.reduce((s, x) => s + x, 0) / xs.length
    }
    expect(mean('bronze')).toBeGreaterThan(mean('gold'))
  })
})

describe('pulseShape', () => {
  it('scales dot size with bytes and dot count with runs a day', () => {
    const flows = ['a', 'b'].map((id) => ({ id, from: 'x', to: 'y', pipelineId: 'p', taskId: id, role: 'write' as const }))
    const shape = pulseShape(flows, new Map([['a', { bytes: 1e7, runsPerDay: 1 }], ['b', { bytes: 1e10, runsPerDay: 144 }]]))
    expect(shape[0].scale).toBeLessThan(shape[1].scale)
    expect(shape[0].dots).toBe(1)
    expect(shape[1].dots).toBe(6)
  })
})

describe('formatBytes', () => {
  it('formats with a readable unit', () => {
    expect(formatBytes(18e9)).toBe('18.0 GB')
    expect(formatBytes(4.2e8)).toBe('420 MB')
    expect(formatBytes(512)).toBe('512 B')
  })
})
