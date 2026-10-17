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

  it('never yields a zero size', () => {
    expect(parseBytes(0.3)).toBeUndefined()
    expect(parseBytes(1.6)).toBe(2)
    expect(parseBytes('0.3')).toBeUndefined()
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

  it('takes measured bytes from query history over a declared size, split over the tables a task reads', () => {
    const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
    const flows = deriveView(graph, { lineage: true }).flows
    const schedule = simulateDay(graph.workflows, graph.tables)
    const stmt = { id: 's', type: 'MERGE', text: '', status: 'FINISHED', start: 0, end: 1, waiting: 0, compiling: 0, executing: 1, taskTime: 1, shuffleMB: 0, spillMB: 0, readRows: 0, writtenRows: 0 }
    // Two runs of ingest_orders (declared 18 GB): 600 MB and 200 MB read, 50 MB written each.
    const runs = schedule.taskRuns.filter((r) => r.taskId === 'ingest_orders').slice(0, 2)
    schedule.statements = Object.fromEntries(runs.map((r, i) => [r.id, [{ ...stmt, readMB: i ? 200 : 600, writtenMB: 50 }]]))
    const volumes = flowVolumes(flows, graph, schedule)
    const task = graph.workflows.pipelines.flatMap((p) => p.tasks).find((t) => t.id === 'ingest_orders')!
    for (const f of flows.filter((x) => x.taskId === 'ingest_orders')) {
      const v = volumes.get(f.id)!
      expect(v.bytesFrom).toBe('measured')
      expect(v.bytes).toBe(f.role === 'read' ? Math.round(400e6 / task.reads.length) : Math.round(50e6 / task.writes.length))
    }
    expect(volumes.get(flows.find((f) => f.taskId === 'ingest_customers')!.id)!.bytesFrom).toBe('simulated')
  })
})

describe('pulseShape', () => {
  it('scales dot size with bytes and dot count with runs a day', () => {
    const flows = ['a', 'b'].map((id) => ({ id, from: 'x', to: 'y', pipelineId: 'p', taskId: id, role: 'write' as const }))
    const shape = pulseShape(flows, new Map([['a', { bytes: 1e7, runsPerDay: 1 }], ['b', { bytes: 1e10, runsPerDay: 144 }]]))
    expect(shape.get('a')!.scale).toBeLessThan(shape.get('b')!.scale)
    expect(shape.get('a')!.dots).toBe(1)
    expect(shape.get('b')!.dots).toBe(6)
  })

  it('keeps sizes finite for a zero-byte flow', () => {
    const flows = ['a', 'b'].map((id) => ({ id, from: 'x', to: 'y', pipelineId: 'p', taskId: id, role: 'write' as const }))
    const shape = pulseShape(flows, new Map([['a', { bytes: 0, runsPerDay: 1 }], ['b', { bytes: 1e10, runsPerDay: 1 }]]))
    for (const s of shape.values()) expect(Number.isFinite(s.scale)).toBe(true)
  })
})

describe('formatBytes', () => {
  it('formats with a readable unit', () => {
    expect(formatBytes(18e9)).toBe('18.0 GB')
    expect(formatBytes(4.2e8)).toBe('420 MB')
    expect(formatBytes(512)).toBe('512 B')
  })
})
