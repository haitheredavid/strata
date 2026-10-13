import type { Cluster, Task } from '../model/workflow'
import { between, rand } from './rng'
import type { Schedule, TaskRun, Window } from './schedule'

/**
 * Simulated Spark execution inside task runs, shaped like what the Spark event log records
 * (`SparkListenerJobStart`, `StageCompleted`, `TaskEnd`): each task run is a few Spark jobs, each job a
 * few stages, each stage some partitions run in waves over the cluster's cores.
 */

export type StageOp = 'scan' | 'exchange' | 'join' | 'aggregate' | 'write' | 'optimize'

export interface SparkStage {
  id: number
  op: StageOp
  name: string
  start: number
  end: number
  /** Partitions. */
  tasks: number
  /** ceil(tasks / cores). */
  waves: number
  /** Share of the last wave spent waiting on one straggler, 0..1. */
  skew: number
  shuffleReadMB: number
  shuffleWriteMB: number
  spillMB: number
  /** Average share of the run's cores kept busy. */
  occupancy: number
}

export interface SparkJob {
  id: number
  desc: string
  start: number
  end: number
  stages: SparkStage[]
}

export interface SparkRun {
  run: TaskRun
  workers: number
  cores: number
  jobs: SparkJob[]
}

interface StagePlan { op: StageOp; name: string; weight: number; tasks: number }

const PARTITIONS = 200 // spark.sql.shuffle.partitions

/** Workers a cluster runs with while `concurrent` task runs share it: the minimum, scaling up with load. */
export const workersFor = (c: Cluster, concurrent: number) => Math.min(c.workers.max, c.workers.min + Math.max(0, concurrent - 1) * 2)

function plan(task: Task, run: TaskRun, key: string): { desc: string; stages: StagePlan[] }[] {
  const scanTasks = (name: string) => Math.round(between(`${key}:scan:${name}`, 24, run.medallion === 'bronze' ? 400 : 160))
  const jobs: { desc: string; stages: StagePlan[] }[] = []
  for (const r of task.reads)
    jobs.push({ desc: `scan ${r}`, stages: [{ op: 'scan', name: `Scan parquet ${r}`, weight: between(`${key}:w:${r}`, 0.6, 1.4), tasks: scanTasks(r) }] })
  if (task.reads.length > 1)
    jobs.push({
      desc: 'join',
      stages: [
        { op: 'exchange', name: 'Exchange hashpartitioning', weight: between(`${key}:w:x`, 0.5, 1), tasks: PARTITIONS },
        { op: 'join', name: 'SortMergeJoin', weight: between(`${key}:w:j`, 1, 2.2), tasks: PARTITIONS },
      ],
    })
  else jobs.push({ desc: 'transform', stages: [{ op: 'aggregate', name: 'HashAggregate', weight: between(`${key}:w:a`, 0.5, 1.2), tasks: PARTITIONS }] })
  for (const w of task.writes)
    jobs.push({
      desc: `write ${w}`,
      stages: [
        { op: 'exchange', name: 'Exchange (optimized write)', weight: between(`${key}:w:xw:${w}`, 0.3, 0.7), tasks: PARTITIONS },
        { op: 'write', name: `WriteToDeltaTable ${w}`, weight: between(`${key}:w:w:${w}`, 0.6, 1.3), tasks: Math.round(between(`${key}:wt:${w}`, 8, 64)) },
      ],
    })
  if (run.medallion === 'gold' && rand(`${key}:optimize`) < 0.35)
    jobs.push({ desc: 'optimize', stages: [{ op: 'optimize', name: `OPTIMIZE ${task.writes[0] ?? ''}`.trim(), weight: 0.5, tasks: 16 }] })
  return jobs
}

/** Spark jobs and stages filling one task run after its setup, on `workers` workers of the cluster. */
export function simulateSpark(run: TaskRun, task: Task, cluster: Cluster, workers: number): SparkRun {
  const cores = Math.max(1, workers * cluster.coresPerNode)
  const key = run.id
  const jobs = plan(task, run, key)
  const driverShare = 0.04 // planning / commit time on the driver between jobs
  const total = jobs.reduce((s, j) => s + j.stages.reduce((t, st) => t + st.weight, 0), 0)
  const work = run.end - run.start - run.setup
  const perWeight = (work * (1 - driverShare)) / total
  const gap = (work * driverShare) / jobs.length

  let t = run.start + run.setup
  let stageId = 0
  const out: SparkJob[] = jobs.map((j, jobId) => {
    t += gap
    const start = t
    const stages = j.stages.map((st) => {
      const dur = st.weight * perWeight
      const waves = Math.ceil(st.tasks / cores)
      // Silver joins and aggregations sometimes skew and spill: one partition far bigger than the rest.
      const heavy = run.medallion === 'silver' && (st.op === 'join' || st.op === 'aggregate')
      const skew = heavy && rand(`${key}:skew:${stageId}`) < 0.5 ? between(`${key}:skewv:${stageId}`, 0.3, 0.7) : between(`${key}:skewv:${stageId}`, 0, 0.12)
      const spillMB = heavy && skew > 0.3 ? Math.round(between(`${key}:spill:${stageId}`, 200, 4000)) : 0
      const fill = st.tasks / (waves * cores) // the last wave is partly empty
      const s: SparkStage = {
        id: stageId++,
        op: st.op,
        name: st.name,
        start: t,
        end: t + dur,
        tasks: st.tasks,
        waves,
        skew,
        shuffleReadMB: st.op === 'join' || st.op === 'write' || st.op === 'aggregate' ? Math.round(between(`${key}:sr:${stageId}`, 50, 6000)) : 0,
        shuffleWriteMB: st.op === 'exchange' ? Math.round(between(`${key}:sw:${stageId}`, 50, 6000)) : 0,
        spillMB,
        occupancy: Math.max(0.05, fill * (1 - skew * 0.8) * (st.op === 'write' ? 0.6 : 1)),
      }
      t += dur
      return s
    })
    return { id: jobId, desc: j.desc, start, end: t, stages }
  })
  return { run, workers, cores, jobs: out }
}

/** Spark runs for every task run on a cluster overlapping a window. Cached per schedule. */
const cache = new WeakMap<Schedule, Map<string, SparkRun>>()
export function sparkRunsOn(s: Schedule, tasks: Map<string, Task>, cluster: Cluster, w: Window): SparkRun[] {
  let m = cache.get(s)
  if (!m) cache.set(s, (m = new Map()))
  const runs = s.taskRuns.filter((r) => r.clusterId === cluster.id && !r.continuous && r.start < w[1] && r.end > w[0])
  return runs.map((r) => {
    let sr = m!.get(r.id)
    if (!sr) {
      const concurrent = s.taskRuns.filter((o) => o.clusterId === cluster.id && o.start < r.end && o.end > r.start).length
      sr = simulateSpark(r, tasks.get(r.taskId)!, cluster, workersFor(cluster, concurrent))
      m!.set(r.id, sr)
    }
    return sr
  })
}

export interface UtilSample { t: number; workers: number; busy: number; up: boolean }

/**
 * Cluster utilization over a window, in `n` buckets: workers up and the share of their cores busy.
 * Task runs sharing a cluster split its cores. Streaming tasks keep a steady ~half load.
 */
export function utilization(s: Schedule, tasks: Map<string, Task>, cluster: Cluster, [a, b]: Window, n: number): UtilSample[] {
  const spark = sparkRunsOn(s, tasks, cluster, [a, b])
  const streams = s.taskRuns.filter((r) => r.clusterId === cluster.id && r.continuous)
  const out: UtilSample[] = []
  for (let i = 0; i < n; i++) {
    const t = a + ((i + 0.5) / n) * (b - a)
    const live = spark.filter((sr) => sr.run.start <= t && t < sr.run.end)
    const streaming = streams.filter((r) => r.start <= t && t < r.end).length
    const concurrent = live.length + streaming
    const up = concurrent > 0 || cluster.kind === 'all_purpose'
    const workers = up ? workersFor(cluster, concurrent) : 0
    let busy = streaming * 0.45 * (0.8 + 0.4 * rand(`${cluster.id}:${Math.floor(t / 60)}`))
    for (const sr of live) {
      if (t < sr.run.start + sr.run.setup) continue
      const stage = sr.jobs.flatMap((j) => j.stages).find((st) => st.start <= t && t < st.end)
      busy += stage ? stage.occupancy : 0.03
    }
    // Concurrent runs split the cores, so the cluster's busy share is the mean of theirs.
    out.push({ t, workers, busy: concurrent ? Math.min(1, busy / concurrent) : 0, up })
  }
  return out
}

export interface SizingHint { avg: number; p95: number; text: string; dbu: number }

/** Average and p95 busy share while working, an estimated DBU count, and a plain right-sizing hint. */
export function sizingHint(samples: UtilSample[], cluster: Cluster, seconds: number): SizingHint {
  const working = samples.filter((x) => x.up && x.busy > 0.02).map((x) => x.busy).sort((p, q) => p - q)
  const avg = working.length ? working.reduce((s, x) => s + x, 0) / working.length : 0
  const p95 = working.length ? working[Math.min(working.length - 1, Math.floor(working.length * 0.95))] : 0
  const nodeHours = samples.reduce((s, x) => s + (x.up ? x.workers + 1 : 0), 0) * (seconds / Math.max(1, samples.length)) / 3600
  const dbu = nodeHours * (cluster.kind === 'serverless' ? 1.5 : cluster.coresPerNode / 4) * 0.75
  let text = 'No work in view'
  if (working.length) {
    const target = Math.max(1, Math.ceil((cluster.workers.max * p95) / 0.8))
    if (p95 > 0.9) text = 'Saturated at peak: more workers or larger nodes would cut run time'
    else if (cluster.kind === 'serverless') text = 'Serverless scales itself'
    else if (target < cluster.workers.max) text = `${target} worker${target > 1 ? 's' : ''} likely enough (now ${cluster.workers.min === cluster.workers.max ? cluster.workers.max : `${cluster.workers.min}–${cluster.workers.max}`})`
    else text = 'Sized about right'
  }
  return { avg, p95, text, dbu }
}
