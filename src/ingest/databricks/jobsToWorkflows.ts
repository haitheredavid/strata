import { stringify } from 'yaml'
import { SERVERLESS } from '../../model/workflow'
import { coresOf } from '../../parse/workflows'
import type { ClusterInfo, Job, JobTask, LineageRow, NewCluster, RawExport, Run } from './raw'

/** A strata id from a job name: lower snake case. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'job'

/** Pipeline ids per job: the job name's slug, with the job id added when two jobs share a name. */
export function pipelineIds(jobs: Job[]): Map<string, string> {
  const count = new Map<string, number>()
  for (const j of jobs) count.set(slug(j.settings.name ?? String(j.job_id)), (count.get(slug(j.settings.name ?? String(j.job_id))) ?? 0) + 1)
  return new Map(jobs.map((j) => {
    const s = slug(j.settings.name ?? String(j.job_id))
    return [String(j.job_id), count.get(s)! > 1 ? `${s}_${j.job_id}` : s]
  }))
}

/** Task ids are global in strata, and task keys repeat across jobs, so tasks are scoped to their job. */
export const taskId = (pipelineId: string, taskKey: string) => `${pipelineId}/${taskKey}`

/** A lineage end: the table name, else the path trimmed to its first segments (one source per location, not per file). */
export function endName(table?: string | null, path?: string | null): string | undefined {
  if (table) return table
  if (!path) return undefined
  const m = /^([a-z0-9]+:\/\/[^/]+)((?:\/[^/]+){0,2})/i.exec(path)
  return m ? m[1] + m[2] : path.split('/').slice(0, 4).join('/')
}

/** Words in a task's key and code path that name a layer, e.g. `jobs/medallion/silver/…` or `x__silver_refresh`. */
const tokens = (t: JobTask) =>
  `${t.task_key} ${t.notebook_task?.notebook_path ?? ''} ${t.spark_python_task?.python_file ?? ''}`.toLowerCase().split(/[^a-z0-9]+/)

/** Task ids are matched against lineage by time, then by layer name, then fall back to the job's last task. */
function attribute(job: Job, pid: string, rows: LineageRow[], runs: Map<string, Run>, warn: (w: string) => void) {
  const tasks = job.settings.tasks ?? []
  const byEdge = new Map<string, Set<string>>() // `${src}>${tgt}` → task keys
  const edgeKey = (r: LineageRow) => `${endName(r.source_table, r.source_path) ?? ''}>${endName(r.target_table, r.target_path) ?? ''}`
  const layerOf = (r: LineageRow) => (r.target_table ?? r.source_table ?? '').split('.')[0].toLowerCase()
  const byLayer = (keys: string[], r: LineageRow) => {
    const layer = layerOf(r)
    const hit = keys.filter((k) => layer && tokens(tasks.find((t) => t.task_key === k)!).includes(layer))
    return hit.length ? hit : keys
  }

  const pending: LineageRow[] = []
  for (const r of rows) {
    const run = r.job_run_id ? runs.get(String(r.job_run_id)) : undefined
    const a = Number(r.first_ms)
    const b = Number(r.last_ms)
    const inRun = (run?.tasks ?? []).filter((t) => t.start_time && a >= t.start_time - 1000 && b <= (t.end_time || Infinity) + 1000).map((t) => t.task_key)
    if (!inRun.length) {
      pending.push(r)
      continue
    }
    const keys = byLayer([...new Set(inRun)], r)
    const set = byEdge.get(edgeKey(r)) ?? new Set()
    keys.forEach((k) => set.add(k))
    byEdge.set(edgeKey(r), set)
  }
  // Rows from runs outside the export window: reuse what other runs of the job showed, else layer names.
  const leaf = tasks.find((t) => !tasks.some((o) => o.depends_on?.some((d) => d.task_key === t.task_key)))?.task_key
  let guessed = 0
  for (const r of pending) {
    if (byEdge.has(edgeKey(r))) continue
    const all = tasks.map((t) => t.task_key)
    const layered = byLayer(all, r)
    if (layered.length < all.length || all.length === 1) byEdge.set(edgeKey(r), new Set(layered))
    else if (leaf) {
      guessed++
      byEdge.set(edgeKey(r), new Set([leaf]))
    }
  }
  if (guessed) warn(`Job "${pid}": ${guessed} lineage edge(s) could not be placed on a task by run time and went to its last task`)

  const io = new Map<string, { reads: Set<string>; writes: Set<string> }>()
  for (const [edge, keys] of byEdge) {
    const [src, tgt] = edge.split('>')
    for (const k of keys) {
      const e = io.get(k) ?? { reads: new Set(), writes: new Set() }
      if (src) e.reads.add(src)
      if (tgt) e.writes.add(tgt)
      io.set(k, e)
    }
  }
  return io
}

export interface WorkflowOut {
  /** DAB-shaped workflow file text. */
  yaml: string
  pipelineOf: Map<string, string>
  /** Cluster id per strata task id, as the workflow file resolves it. */
  clusterOf: Map<string, string>
  continuous: Set<string>
  warnings: string[]
}

/**
 * Jobs (and the Lakeflow pipelines they run) as a DAB `resources.jobs` workflow file, with reads and
 * writes from lineage and every task's compute named explicitly, so the parser never invents a cluster.
 */
export function jobsToWorkflows(raw: Pick<RawExport, 'jobs' | 'lineage' | 'runs' | 'pipelines' | 'clusters' | 'pools' | 'nodeTypes'>): WorkflowOut {
  const warnings: string[] = []
  const cores = new Map(raw.nodeTypes.map((n) => [n.node_type_id, n.num_cores]))
  const poolNode = new Map(raw.pools.map((p) => [p.instance_pool_id, p.node_type_id]))
  const dlt = new Map(raw.pipelines.map((p) => [p.pipeline_id, p]))
  const runs = new Map(raw.runs.map((r) => [String(r.run_id), r]))
  const pipelineOf = pipelineIds(raw.jobs)
  const clusterOf = new Map<string, string>()
  const continuous = new Set<string>()

  const spec = (c: NewCluster, extra: Record<string, unknown> = {}) => {
    const node = c.node_type_id ?? (c.instance_pool_id ? poolNode.get(c.instance_pool_id) : undefined) ?? 'unknown'
    return {
      ...extra,
      node_type_id: node,
      ...(c.autoscale ? { autoscale: c.autoscale } : { num_workers: c.num_workers ?? 0 }),
      ...(c.spark_version ? { spark_version: c.spark_version } : {}),
      cores_per_node: cores.get(node) ?? coresOf(node),
    }
  }

  const shared: Record<string, unknown> = {}
  const sharedCluster = (c: ClusterInfo) => (shared[c.cluster_id] ??= spec(c, { cluster_name: c.cluster_name ?? c.cluster_id, kind: 'all_purpose' }))
  const clusters = new Map(raw.clusters.map((c) => [c.cluster_id, c]))

  /** The cluster id a task runs on, declaring shared and pipeline clusters as they're met. */
  const computeOf = (pid: string, t: JobTask): string => {
    if (t.job_cluster_key) return `${pid}.${t.job_cluster_key}`
    if (t.existing_cluster_id) {
      const c = clusters.get(t.existing_cluster_id)
      if (c) sharedCluster(c)
      else shared[t.existing_cluster_id] ??= { cluster_name: t.existing_cluster_id, kind: 'all_purpose', node_type_id: 'unknown', num_workers: 0 }
      return t.existing_cluster_id
    }
    if (t.pipeline_task) {
      const p = dlt.get(t.pipeline_task.pipeline_id)
      const c = p?.spec?.clusters?.find((x) => !x.label || x.label === 'default')
      if (!p || p.spec?.serverless || !c) return SERVERLESS
      const id = `dlt_${slug(p.name ?? p.pipeline_id)}`
      shared[id] ??= spec(c, { cluster_name: `${p.name ?? p.pipeline_id} (pipeline)`, kind: 'job' })
      return id
    }
    if (t.new_cluster) {
      const id = `${pid}.${t.task_key}`
      shared[id] ??= spec(t.new_cluster, { cluster_name: `${pid}/${t.task_key}`, kind: 'job' })
      return id
    }
    // environment_key, SQL / dbt on a warehouse, run_job and condition tasks: no cluster of their own.
    return SERVERLESS
  }

  const lineageBy = new Map<string, LineageRow[]>()
  const push = (k: string, r: LineageRow) => lineageBy.set(k, [...(lineageBy.get(k) ?? []), r])
  for (const r of raw.lineage) {
    if (r.entity_type === 'JOB' && r.job_id) push(`job:${r.job_id}`, r)
    else if (r.entity_type === 'PIPELINE' && r.dlt_pipeline_id) push(`dlt:${r.dlt_pipeline_id}`, r)
  }

  const jobsById = new Map(raw.jobs.map((j) => [String(j.job_id), j]))
  const parentOf = new Map<string, string>() // child job id → pipeline id that runs it
  for (const j of raw.jobs)
    for (const t of j.settings.tasks ?? []) if (t.run_job_task) parentOf.set(String(t.run_job_task.job_id), pipelineOf.get(String(j.job_id))!)

  const jobs: Record<string, unknown> = {}
  for (const j of raw.jobs) {
    const s = j.settings
    const pid = pipelineOf.get(String(j.job_id))!
    const io = attribute(j, pid, lineageBy.get(`job:${j.job_id}`) ?? [], runs, (w) => warnings.push(w))
    const tasks = (s.tasks ?? []).map((t) => {
      const id = taskId(pid, t.task_key)
      const compute = computeOf(pid, t)
      clusterOf.set(id, compute)
      const own = io.get(t.task_key)
      const reads = new Set(own?.reads)
      const writes = new Set(own?.writes)
      if (t.pipeline_task)
        for (const r of lineageBy.get(`dlt:${t.pipeline_task.pipeline_id}`) ?? []) {
          const src = endName(r.source_table, r.source_path)
          const tgt = endName(r.target_table, r.target_path)
          if (src) reads.add(src)
          if (tgt) writes.add(tgt)
        }
      return {
        id,
        name: t.task_key,
        ...(t.depends_on?.length ? { depends_on: t.depends_on.map((d) => taskId(pid, d.task_key)) } : {}),
        reads: [...reads].sort(),
        writes: [...writes].sort(),
        compute,
      }
    })
    const isContinuous = !!s.continuous && s.continuous.pause_status !== 'PAUSED'
    if (isContinuous) continuous.add(pid)
    const parent = parentOf.get(String(j.job_id))
    const job: Record<string, unknown> = { name: s.name ?? pid, tasks }
    if (s.job_clusters?.length)
      job.job_clusters = s.job_clusters.map((c) => ({ job_cluster_key: c.job_cluster_key, ...spec(c.new_cluster) }))
    if (s.trigger) job.trigger = s.trigger
    else if (s.continuous) job.continuous = s.continuous
    else if (s.schedule) job.schedule = s.schedule
    else if (parent) job.trigger = { after: parent }
    jobs[pid] = job
  }

  // Lakeflow pipelines with lineage in the export but no job running them: one task each.
  const wrapped = new Set(raw.jobs.flatMap((j) => (j.settings.tasks ?? []).flatMap((t) => (t.pipeline_task ? [t.pipeline_task.pipeline_id] : []))))
  for (const p of raw.pipelines) {
    if (wrapped.has(p.pipeline_id) || !lineageBy.has(`dlt:${p.pipeline_id}`)) continue
    const pid = `dlt_${slug(p.name ?? p.pipeline_id)}`
    const rows = lineageBy.get(`dlt:${p.pipeline_id}`)!
    const id = taskId(pid, 'update')
    const compute = computeOf(pid, { task_key: 'update', pipeline_task: { pipeline_id: p.pipeline_id } })
    clusterOf.set(id, compute)
    if (p.spec?.continuous) continuous.add(pid)
    jobs[pid] = {
      name: p.name ?? pid,
      ...(p.spec?.continuous ? { continuous: {} } : { trigger: 'manual' }),
      tasks: [{
        id,
        name: 'update',
        reads: [...new Set(rows.map((r) => endName(r.source_table, r.source_path)).filter(Boolean))].sort(),
        writes: [...new Set(rows.map((r) => endName(r.target_table, r.target_path)).filter(Boolean))].sort(),
        compute,
      }],
    }
    warnings.push(`Pipeline "${p.name ?? p.pipeline_id}" isn't run by an exported job: its updates aren't in the timeline`)
  }

  // Lineage from jobs that aren't in the job list: mostly one-time runs (`dbutils.notebook.run`, runs
  // submit), which carry no link to the job that started them; also deleted jobs.
  const missing = new Set(raw.lineage.filter((r) => r.entity_type === 'JOB' && r.job_id && !jobsById.has(String(r.job_id))).map((r) => r.job_id))
  if (missing.size)
    warnings.push(`${missing.size} job id(s) in lineage aren't saved jobs (one-time or notebook-workflow runs, or deleted jobs): their lineage was left out`)

  const doc = { ...(Object.keys(shared).length ? { clusters: shared } : {}), resources: { jobs } }
  return { yaml: stringify(doc, { lineWidth: 0 }), pipelineOf, clusterOf, continuous, warnings }
}
