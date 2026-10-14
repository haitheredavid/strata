import type { Medallion } from '../../model/workflow'
import { DAY } from '../../sim/schedule'
import type { PipelineRun, RunState, Schedule, SimEvent, TaskRun } from '../../sim/schedule'
import type { Run } from './raw'
import { dayStart } from './time'
import { taskId } from './jobsToWorkflows'

const STATE: Record<string, RunState> = {
  SUCCESS: 'success', SUCCESS_WITH_FAILURES: 'success', EXCLUDED: 'skipped',
  FAILED: 'failed', TIMEDOUT: 'failed', INTERNAL_ERROR: 'failed', MAXIMUM_CONCURRENT_RUNS_REACHED: 'skipped',
  CANCELED: 'canceled', UPSTREAM_CANCELED: 'canceled', UPSTREAM_FAILED: 'skipped', SKIPPED: 'skipped',
}

export function runState(s?: { life_cycle_state?: string; result_state?: string }): RunState | undefined {
  if (s?.result_state) return STATE[s.result_state]
  if (s?.life_cycle_state === 'RUNNING' || s?.life_cycle_state === 'PENDING' || s?.life_cycle_state === 'QUEUED') return 'running'
  return s?.life_cycle_state === 'SKIPPED' ? 'skipped' : undefined
}

const CAUSE: Record<string, string> = {
  PERIODIC: 'schedule', ONE_TIME: 'manual', RETRY: 'retry', RUN_JOB_TASK: 'run job task',
  FILE_ARRIVAL: 'file arrival', TABLE: 'table update', CONTINUOUS: 'continuous', CONTINUOUS_RESTART: 'continuous restart',
}

export interface RunsContext {
  day: string
  tz: string
  /** Strata pipeline id per job id. */
  pipelineOf: Map<string, string>
  clusterOf: Map<string, string>
  continuous: Set<string>
  /** Tables each task writes, and each table's layer. */
  writesOf: Map<string, string[]>
  medallionOf: (table: string) => Medallion | undefined
  /** Time the export ran, standing in for the end of runs still going. */
  now: number
}

/**
 * Real job runs as a strata `Schedule` for one day: times become seconds since that day's 00:00 in
 * `tz`, clipped to the day, and each task's queue + cluster start becomes its `setup`.
 */
export function runsToSchedule(rawRuns: Run[], ctx: RunsContext): { schedule: Schedule; taskRunIds: Map<string, string>; warnings: string[] } {
  const t0 = dayStart(ctx.day, ctx.tz)
  const sec = (ms: number) => (ms - t0) / 1000
  const clip = (s: number) => Math.min(DAY, Math.max(0, s))
  const runs: PipelineRun[] = []
  const taskRuns: TaskRun[] = []
  const events: SimEvent[] = []
  const taskRunIds = new Map<string, string>() // Jobs API task run id → strata task run id
  let unknownTasks = 0

  for (const r of [...rawRuns].sort((a, b) => a.start_time - b.start_time)) {
    const pid = ctx.pipelineOf.get(String(r.job_id))
    if (!pid) continue
    const end = sec(r.end_time || ctx.now)
    const start = sec(r.start_time)
    if (end <= 0 || start >= DAY) continue
    const runId = `${pid}#${r.run_id}`
    const continuous = ctx.continuous.has(pid)
    const cause = CAUSE[r.trigger ?? ''] ?? (r.trigger ?? 'run').toLowerCase()
    runs.push({ id: runId, pipelineId: pid, start: clip(start), end: clip(end), cause, state: runState(r.state) })
    if (start >= 0) events.push({ t: start, kind: 'trigger', name: cause, pipelineId: pid })

    for (const t of r.tasks ?? []) {
      if (!t.start_time) continue // never started: skipped or upstream failed
      const id = taskId(pid, t.task_key)
      const cluster = ctx.clusterOf.get(id)
      if (!cluster) {
        unknownTasks++ // the task was removed from the job since this run
        continue
      }
      const a = sec(t.start_time)
      const b = sec(t.end_time || ctx.now)
      if (b <= 0 || a >= DAY) continue
      const setup = ((t.queue_duration ?? 0) + (t.setup_duration ?? 0)) / 1000
      const start = clip(a)
      const end = clip(b)
      const attempt = t.attempt_number ?? 0
      const writes = ctx.writesOf.get(id) ?? []
      const tr: TaskRun = {
        id: `${runId}/${t.task_key}${attempt ? `~${attempt}` : ''}`,
        taskId: id,
        pipelineId: pid,
        runId,
        start,
        end,
        // Setup sits at the head of the run, so a run that started yesterday has used it up.
        setup: Math.min(end - start, Math.max(0, a + setup - start)),
        clusterId: cluster,
        medallion: writes.map(ctx.medallionOf).find((m) => !!m),
        state: runState(t.state),
        ...(attempt ? { attempt } : {}),
        ...(continuous ? { continuous: true } : {}),
      }
      taskRuns.push(tr)
      taskRunIds.set(String(t.run_id), tr.id)
      if (b <= DAY && tr.state === 'success')
        for (const w of writes) events.push({ t: b, kind: 'write', name: w, pipelineId: pid, taskRunId: tr.id })
    }
  }

  const warnings = unknownTasks ? [`${unknownTasks} task run(s) are of tasks no longer in their job and were left out`] : []
  taskRuns.sort((a, b) => a.start - b.start)
  events.sort((a, b) => a.t - b.t)
  return { schedule: { runs, taskRuns, events, origin: 'snapshot', day: ctx.day, tz: ctx.tz }, taskRunIds, warnings }
}
