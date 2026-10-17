import { parse as parseYaml } from 'yaml'
import { sourceId } from '../../model/workflow'
import { inferMedallion } from '../../parse/notes'
import type { Snapshot } from '../snapshot'
import { jobsToWorkflows, taskId } from './jobsToWorkflows'
import { clusterInstances, nodeUsage } from './nodeUsage'
import type { RawExport } from './raw'
import { runsToSchedule } from './runsToSchedule'
import { statementsByRun } from './statements'
import { dayLength, dayStart } from './time'
import { fullName, ucToDbml } from './ucToDbml'

/** A workspace export as a strata snapshot: DBML from Unity Catalog, a workflow file from jobs and lineage, a day of runs. */
export function buildSnapshot(raw: RawExport, now = Date.now()): Snapshot {
  const { dbml, warnings: dbmlWarnings } = ucToDbml(raw.tables, raw.columns, raw.keys)
  const wf = jobsToWorkflows(raw)

  // Writes per task, read back from the file just written, so runs and lineage agree.
  const doc = parseYaml(wf.yaml) as { resources: { jobs: Record<string, { tasks: { id: string; writes?: string[] }[] }> } }
  const tables = new Set(raw.tables.map((t) => fullName(t.table_catalog, t.table_schema, t.table_name)))
  const nodeId = (name: string) => (tables.has(name) ? name : sourceId(name))
  const writesOf = new Map(Object.values(doc.resources.jobs).flatMap((j) => j.tasks.map((t) => [t.id, (t.writes ?? []).map(nodeId)] as const)))
  const medallionOf = (table: string) => {
    const [catalog, schema, ...name] = table.split('.')
    return name.length ? inferMedallion(catalog, name.join('.'), {}) ?? inferMedallion(schema, name.join('.'), {}) : undefined
  }
  const { schedule, taskRunIds, warnings: runWarnings } = runsToSchedule(raw.runs, {
    day: raw.day, tz: raw.tz, pipelineOf: wf.pipelineOf, clusterOf: wf.clusterOf, continuous: wf.continuous, writesOf, medallionOf, now,
  })

  if (raw.statements?.length) schedule.statements = statementsByRun(raw.statements, taskRunIds, dayStart(raw.day, raw.tz))
  if (raw.nodeTimeline?.length) {
    const instances = clusterInstances(raw.runs, (job, key) => {
      const pid = wf.pipelineOf.get(job)
      return pid ? wf.clusterOf.get(taskId(pid, key)) : undefined
    })
    schedule.usage = nodeUsage(raw.nodeTimeline, instances, dayStart(raw.day, raw.tz), dayLength(raw.day, raw.tz))
  }

  return {
    kind: 'strata-snapshot',
    version: 1,
    host: raw.host,
    exportedAt: raw.exportedAt,
    day: raw.day,
    tz: raw.tz,
    dbml,
    workflows: wf.yaml,
    runs: schedule,
    warnings: [...raw.warnings, ...dbmlWarnings, ...wf.warnings, ...runWarnings],
  }
}
