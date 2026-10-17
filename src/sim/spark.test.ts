import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { DAY, simulateDay } from './schedule'
import { simulateSpark, sizingHint, sparkRunsOn, utilization } from './spark'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const g = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const s = simulateDay(g.workflows, g.tables)
const tasks = new Map(g.workflows.pipelines.flatMap((p) => p.tasks).map((t) => [t.id, t]))
const cluster = (id: string) => g.workflows.clusters.find((c) => c.id === id)!

describe('simulateSpark', () => {
  it('fills the task run after setup with ordered jobs and stages', () => {
    const run = s.taskRuns.find((r) => r.taskId === 'clean_orders')!
    const sr = simulateSpark(run, tasks.get('clean_orders')!, cluster(run.clusterId), 4)
    const stages = sr.jobs.flatMap((j) => j.stages)
    expect(stages[0].start).toBeGreaterThanOrEqual(run.start + run.setup)
    expect(stages.at(-1)!.end).toBeCloseTo(run.end, 3)
    for (let i = 1; i < stages.length; i++) expect(stages[i].start).toBeGreaterThanOrEqual(stages[i - 1].end - 1e-6)
    expect(stages.map((x) => x.op)).toEqual(expect.arrayContaining(['scan', 'join', 'write']))
    for (const st of stages) expect(st.waves).toBe(Math.ceil(st.tasks / sr.cores))
  })
})

describe('utilization', () => {
  it('stays in [0, 1], is down for idle job clusters and up for shared ones', () => {
    for (const c of g.workflows.clusters) {
      const u = utilization(s, tasks, c, [0, DAY], 288)
      for (const x of u) expect(x.busy >= 0 && x.busy <= 1).toBe(true)
      if (c.kind === 'all_purpose') expect(u.every((x) => x.up)).toBe(true)
      if (c.kind === 'job') expect(u.some((x) => !x.up)).toBe(true)
    }
  })

  it('gives a sizing hint with DBUs for a busy window', () => {
    const c = cluster('analytics_shared')
    const runs = sparkRunsOn(s, tasks, c, [0, DAY])
    expect(runs.length).toBeGreaterThan(0)
    const w: [number, number] = [runs[0].run.start, runs[0].run.end]
    const hint = sizingHint(utilization(s, tasks, c, w, 60), c, w[1] - w[0])
    expect(hint.avg).toBeGreaterThan(0)
    expect(hint.p95).toBeGreaterThanOrEqual(hint.avg)
    expect(hint.dbu).toBeGreaterThan(0)
    expect(hint.text).not.toBe('No work in view')
  })

  it('measures serverless as cores in use from statement parallelism, weighted by time executing', () => {
    const c = cluster('serverless')
    const run = s.taskRuns.find((r) => r.clusterId === c.id)! // the lakehouse's serverless runs are its streams
    const base = { type: 'SELECT', text: '', status: 'FINISHED', readMB: 0, writtenMB: 0, shuffleMB: 0, spillMB: 0, readRows: 0, writtenRows: 0 }
    // 0–60 s: 10 s waiting then 50 s executing at 8× parallelism; 60–120 s: 4× throughout.
    const statements = [
      { ...base, id: 'a', start: 0, end: 60, waiting: 10, compiling: 0, executing: 50, taskTime: 400 },
      { ...base, id: 'b', start: 60, end: 120, waiting: 0, compiling: 0, executing: 60, taskTime: 240 },
    ]
    const measured = { ...s, statements: { [run.id]: statements } }
    const u = utilization(measured, tasks, c, [0, 120], 2)
    expect(u.map((x) => x.cores)).toEqual([(8 * 50) / 60, 4])
    expect(u.map((x) => x.workers)).toEqual([(8 * 50) / 60 / c.coresPerNode, 4 / c.coresPerNode])
    expect(sizingHint(u, c, 120).text).toBe('Serverless scales itself')
    // Without statements it's still simulated, with no cores figure.
    expect(utilization(s, tasks, c, [0, 120], 2).every((x) => x.cores === undefined)).toBe(true)
  })
})
