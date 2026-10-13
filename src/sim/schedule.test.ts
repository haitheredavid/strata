import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { buildWorkflows, parseDuration } from '../parse/workflows'
import { activeAt, cronTimes, DAY, layerTotals, simulateDay, taskRunsIn } from './schedule'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const lakehouse = () => parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))

describe('cronTimes', () => {
  it('expands minute and hour fields', () => {
    expect(cronTimes('0 1 * * *')).toEqual([3600])
    expect(cronTimes('*/30 2 * * *')).toEqual([7200, 9000])
    expect(cronTimes('15 8-10/2 * * 1')).toEqual([8 * 3600 + 900, 10 * 3600 + 900])
    expect(cronTimes('0 0 2 * * ?')).toEqual([7200]) // Quartz, as Databricks writes it
  })
})

describe('parseDuration', () => {
  it('reads seconds, minutes and hours', () => {
    expect(parseDuration(90)).toBe(90)
    expect(parseDuration('90s')).toBe(90)
    expect(parseDuration('12m')).toBe(720)
    expect(parseDuration('1h30m')).toBe(5400)
    expect(parseDuration('soon')).toBeUndefined()
  })
})

describe('simulateDay', () => {
  it('is deterministic', () => {
    const g = lakehouse()
    expect(simulateDay(g.workflows, g.tables)).toEqual(simulateDay(g.workflows, g.tables))
  })

  it('starts tasks after their dependencies end', () => {
    const g = lakehouse()
    const s = simulateDay(g.workflows, g.tables)
    const tasks = new Map(g.workflows.pipelines.flatMap((p) => p.tasks).map((t) => [t.id, t]))
    for (const r of s.taskRuns.filter((x) => !x.continuous)) // streaming tasks run side by side
      for (const d of tasks.get(r.taskId)!.dependsOn) {
        const dep = s.taskRuns.find((x) => x.runId === r.runId && x.taskId === d)
        if (dep) expect(r.start).toBeGreaterThanOrEqual(dep.end)
      }
  })

  it('chains `after` and table-update triggers', () => {
    const g = lakehouse()
    const s = simulateDay(g.workflows, g.tables)
    const first = (id: string) => s.runs.find((r) => r.pipelineId === id)!
    expect(first('sales_refresh').start).toBeGreaterThan(first('ingest_sales').start)
    expect(first('sales_refresh').cause).toMatch(/update from/)
    expect(first('gold_analytics').start).toBeGreaterThanOrEqual(first('sales_refresh').end)
  })

  it('spends longer in silver than gold by default', () => {
    const g = lakehouse()
    const t = layerTotals(simulateDay(g.workflows, g.tables), [0, DAY])
    expect(t.silver).toBeGreaterThan(t.gold)
  })

  it('runs continuous pipelines all day and honours a duration override', () => {
    const wf = buildWorkflows(
      [[
        { id: 'stream', trigger: { kind: 'continuous' }, tasks: [{ id: 'ingest', reads: ['k'], writes: ['a'] }] },
        { id: 'batch', trigger: { kind: 'manual' }, tasks: [{ id: 'job', reads: ['a'], writes: ['b'], duration: 600 }] },
      ]],
      ['a', 'b'],
    )
    const s = simulateDay(wf, [])
    const stream = s.taskRuns.find((r) => r.taskId === 'ingest')!
    expect([stream.start, stream.end, stream.continuous]).toEqual([0, DAY, true])
    const job = s.taskRuns.find((r) => r.taskId === 'job')!
    expect(job.end - job.start - job.setup).toBe(600)
    expect(activeAt(s, 12 * 3600).has('job:ingest')).toBe(true)
    expect(taskRunsIn(s, [job.start, job.start])).toContain(job)
  })
})
