import { parse as parseYaml } from 'yaml'
import type { Cluster, ClusterKind, Pipeline, Source, Task, Trigger, Workflows } from '../model/workflow'
import { SERVERLESS, sourceId } from '../model/workflow'
import { runSteps } from '../view/runOrder'
import { list, parseTriggerText } from './notes'

/** Pipeline / task as written in a sidecar file or DBML notes, before names are resolved. */
export interface RawTask {
  id: string
  name?: string
  reads?: string[]
  writes?: string[]
  dependsOn?: string[]
  emits?: string[]
  duration?: number
  bytes?: number
  /** Cluster id: a pipeline's job cluster (`<pipeline>.<key>`), a shared cluster, or `serverless`. */
  compute?: string
}
export interface RawPipeline {
  id: string
  name?: string
  color?: string
  trigger?: Trigger
  tasks: RawTask[]
  /** Job clusters declared on the pipeline (DAB `job_clusters`), ids already scoped to it. */
  clusters?: Cluster[]
}

export const PIPELINE_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#a78bfa', '#facc15', '#34d399', '#f87171']

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? list(v) : []

/** `90`, `90s`, `12m`, `1h30m` → seconds; undefined when it isn't a duration. */
export function parseDuration(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 0 ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) || undefined
  const m = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(s)
  if (!m || !(m[1] || m[2] || m[3])) return undefined
  return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) || undefined
}

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

/** `123456`, `500MB`, `4 GB`, `1.2TiB` → bytes; undefined when it isn't a size. */
export function parseBytes(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 0 ? Math.round(v) || undefined : undefined
  if (typeof v !== 'string') return undefined
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]i?b|b)?$/.exec(v.trim().toLowerCase())
  if (!m) return undefined
  return Math.round(Number(m[1]) * UNITS[m[2] ?? 'b']) || undefined
}

const CORES: Record<string, number> = {
  'i3.xlarge': 4, 'i3.2xlarge': 8, 'i3.4xlarge': 16, 'm5d.large': 2, 'm5d.xlarge': 4, 'm5d.2xlarge': 8,
  'm5d.4xlarge': 16, 'r5d.xlarge': 4, 'r5d.2xlarge': 8, Standard_DS3_v2: 4, Standard_DS4_v2: 8, Standard_DS5_v2: 16,
}

/** vCPUs of a node type: known types, then the AWS size suffix (`4xlarge` → 16), else 4. */
export function coresOf(nodeType: string) {
  if (CORES[nodeType]) return CORES[nodeType]
  const m = /\.(\d*)xlarge$/.exec(nodeType)
  if (m) return 4 * (Number(m[1]) || 1)
  return /\.large$/.test(nodeType) ? 2 : 4
}

export const serverlessCluster = (): Cluster => ({
  id: SERVERLESS, name: 'Serverless', kind: 'serverless', nodeType: 'serverless', workers: { min: 1, max: 8 }, coresPerNode: 4,
})

/**
 * A cluster spec: DAB `new_cluster` fields (`node_type_id`, `num_workers` or `autoscale`,
 * `spark_version`), directly or under `new_cluster`. `cores_per_node` overrides the node-type guess.
 */
function parseCluster(id: string, raw: Record<string, unknown>, kind: ClusterKind): Cluster {
  const spec = (raw.new_cluster ?? raw) as Record<string, unknown>
  const auto = spec.autoscale as { min_workers?: number; max_workers?: number } | undefined
  const fixed = Number(spec.num_workers ?? 2)
  const nodeType = String(spec.node_type_id ?? 'i3.xlarge')
  const k = String(raw.kind ?? kind)
  return {
    id,
    name: String(raw.cluster_name ?? raw.name ?? id),
    kind: k === 'job' || k === 'serverless' ? k : 'all_purpose',
    nodeType,
    workers: auto ? { min: Number(auto.min_workers ?? 1), max: Number(auto.max_workers ?? auto.min_workers ?? 1) } : { min: fixed, max: fixed },
    coresPerNode: Number(raw.cores_per_node ?? spec.cores_per_node) || coresOf(nodeType),
    ...(spec.spark_version ? { sparkVersion: String(spec.spark_version) } : {}),
  }
}

/** Entries of a YAML map or of a list of objects keyed by `key`. */
function keyed(v: unknown, key: string): [string, Record<string, unknown>][] {
  if (Array.isArray(v)) return v.map((x, i) => [String((x as Record<string, unknown>)[key] ?? (x as { name?: string }).name ?? i), x as Record<string, unknown>])
  return v && typeof v === 'object' ? Object.entries(v as Record<string, Record<string, unknown>>) : []
}

const PERIODIC_CRON: Record<string, (n: number) => string> = {
  HOURS: (n) => `0 */${n} * * *`,
  DAYS: () => '0 0 * * *',
  WEEKS: () => '0 0 * * 0',
}

/** A cron string from `{ cron }`, a DAB `{ quartz_cron_expression }`, or the value itself. */
const cronOf = (v: unknown) => {
  const o = (v ?? {}) as { cron?: string; quartz_cron_expression?: string }
  return String(o.cron ?? o.quartz_cron_expression ?? v)
}

const paused = (v: unknown) => (v as { pause_status?: string } | undefined)?.pause_status === 'PAUSED'

function parseTrigger(v: unknown): Trigger | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return parseTriggerText(v)
  if (typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  // A paused DAB trigger never fires on its own.
  if (paused(o)) return { kind: 'manual' }
  if (o.schedule) return { kind: 'schedule', cron: cronOf(o.schedule) }
  if (o.periodic) {
    const { interval = 1, unit = 'DAYS' } = o.periodic as { interval?: number; unit?: string }
    const cron = PERIODIC_CRON[unit.toUpperCase()]
    return cron ? { kind: 'schedule', cron: cron(Number(interval) || 1) } : undefined
  }
  if (o.file_arrival) return { kind: 'file_arrival', path: String((o.file_arrival as { url?: string }).url ?? o.file_arrival) }
  if (o.table_update) {
    const tu = o.table_update as { tables?: unknown; table_names?: unknown }
    return { kind: 'table_update', tables: strings(tu.tables ?? tu.table_names ?? o.table_update) }
  }
  if (o.after || o.job) return { kind: 'job', pipeline: String(o.after ?? o.job) }
  if (o.continuous) return { kind: 'continuous' }
  if (o.manual) return { kind: 'manual' }
  return undefined
}

/**
 * A pipeline's trigger: `trigger`, else DAB job-level `schedule` (`quartz_cron_expression`) or
 * `continuous`. A paused schedule or trigger becomes manual.
 */
function jobTrigger(p: Record<string, unknown>): Trigger | undefined {
  if (p.trigger) return parseTrigger(p.trigger)
  if (p.continuous) return paused(p.continuous) ? { kind: 'manual' } : { kind: 'continuous' }
  if (p.schedule) return paused(p.schedule) ? { kind: 'manual' } : { kind: 'schedule', cron: cronOf(p.schedule) }
  return undefined
}

/**
 * Sidecar file (YAML or JSON): `{ pipelines: [{ id, name?, trigger?, tasks: [{ id, reads, writes, depends_on, emits }] }] }`.
 * Also accepts a DAB-like `resources.jobs` map. Problems become warnings rather than errors.
 */
export function parseSidecar(text: string): { pipelines: RawPipeline[]; clusters: Cluster[]; warnings: string[] } {
  const warnings: string[] = []
  let doc: unknown
  try {
    doc = parseYaml(text) // YAML is a superset of JSON
  } catch (e) {
    return { pipelines: [], clusters: [], warnings: [`Workflow file: ${(e as Error).message.split('\n')[0]}`] }
  }
  const root = (doc ?? {}) as Record<string, unknown>
  let entries: [string | undefined, Record<string, unknown>][] = []
  if (Array.isArray(root.pipelines)) entries = root.pipelines.map((p) => [undefined, p as Record<string, unknown>])
  else if (root.pipelines && typeof root.pipelines === 'object')
    entries = Object.entries(root.pipelines as Record<string, Record<string, unknown>>)
  else {
    const jobs = (root.resources as { jobs?: Record<string, Record<string, unknown>> } | undefined)?.jobs
    if (jobs) entries = Object.entries(jobs)
  }
  if (!entries.length) warnings.push('Workflow file has no pipelines')
  // Shared (all-purpose) clusters that tasks name with `existing_cluster_id` or `compute`.
  const clusters = keyed(root.clusters, 'id').map(([id, c]) => parseCluster(String(c.id ?? id), c, 'all_purpose'))

  const pipelines: RawPipeline[] = []
  entries.forEach(([key, p], i) => {
    const id = String(p.id ?? key ?? p.name ?? `pipeline_${i + 1}`)
    const tasks: RawTask[] = []
    const rawTasks = Array.isArray(p.tasks) ? (p.tasks as Record<string, unknown>[]) : []
    const jobClusters = keyed(p.job_clusters, 'job_cluster_key').map(([key, c]) => parseCluster(`${id}.${key}`, { name: `${id}/${key}`, ...c }, 'job'))
    if (!rawTasks.length) warnings.push(`Pipeline "${id}" has no tasks`)
    rawTasks.forEach((t, j) => {
      const deps = (t.depends_on ?? t.dependsOn) as unknown
      const taskId = String(t.id ?? t.task_key ?? t.name ?? `${id}_task_${j + 1}`)
      const duration = parseDuration(t.duration)
      if (t.duration !== undefined && duration === undefined) warnings.push(`Task "${taskId}" has an unreadable duration "${t.duration}"`)
      const bytes = parseBytes(t.bytes)
      if (t.bytes !== undefined && bytes === undefined) warnings.push(`Task "${taskId}" has an unreadable size "${t.bytes}"`)
      tasks.push({
        id: taskId,
        name: t.name ? String(t.name) : undefined,
        reads: strings(t.reads),
        writes: strings(t.writes),
        // DAB style: depends_on: [{ task_key: x }]
        dependsOn: Array.isArray(deps)
          ? deps
            .map((d) => (typeof d === 'object' && d ? (d as { task_key?: string }).task_key : d))
            .filter((d) => d !== undefined && d !== null)
            .map(String)
          : strings(deps),
        emits: strings(t.emits),
        duration,
        bytes,
        compute: t.job_cluster_key
          ? `${id}.${t.job_cluster_key}`
          : t.existing_cluster_id ? String(t.existing_cluster_id)
            : t.environment_key ? SERVERLESS
              : t.compute ? String(t.compute) : undefined,
      })
    })
    pipelines.push({
      id,
      name: p.name ? String(p.name) : undefined,
      color: p.color ? String(p.color) : undefined,
      trigger: jobTrigger(p),
      tasks,
      ...(jobClusters.length ? { clusters: jobClusters } : {}),
    })
  })
  return { pipelines, clusters, warnings }
}

/** Resolves a name to a table id: exact, then `catalog.schema.table` suffixes, else an external source. */
function resolver(tableIds: string[]) {
  const ids = new Set(tableIds)
  return (name: string): { id: string; source?: Source } => {
    if (ids.has(name)) return { id: name }
    const parts = name.split('.')
    for (let k = parts.length - 1; k >= 1; k--) {
      const tail = parts.slice(parts.length - k).join('.')
      if (ids.has(tail)) return { id: tail }
    }
    const id = sourceId(name)
    return { id, source: { id, name } }
  }
}

/**
 * Merges pipeline definitions (later inputs win on scalar fields; reads/writes/emits are unioned) and
 * resolves them against the schema. Task ids are global, so a task named in notes and in the sidecar
 * is the same task. Tasks without `depends_on` get it inferred from data: a task depends on the tasks
 * in its pipeline that write what it reads.
 */
export function buildWorkflows(inputs: RawPipeline[][], tableIds: string[], warnings: string[] = [], shared: Cluster[] = []): Workflows {
  const pipelineMeta = new Map<string, Omit<RawPipeline, 'tasks'>>()
  const declared = new Map(shared.map((c) => [c.id, c]))
  const tasks = new Map<string, RawTask & { pipelineId: string; explicitDeps: boolean }>()
  const union = (a: string[] | undefined, b: string[] | undefined) => [...new Set([...(a ?? []), ...(b ?? [])])]

  for (const input of inputs)
    for (const p of input) {
      const prev = pipelineMeta.get(p.id)
      pipelineMeta.set(p.id, {
        id: p.id,
        name: p.name ?? prev?.name,
        color: p.color ?? prev?.color,
        trigger: p.trigger ?? prev?.trigger,
      })
      for (const c of p.clusters ?? []) declared.set(c.id, c)
      for (const t of p.tasks) {
        const old = tasks.get(t.id)
        const explicit = !!t.dependsOn?.length
        tasks.set(t.id, {
          id: t.id,
          name: t.name ?? old?.name,
          pipelineId: p.id,
          reads: union(old?.reads, t.reads),
          writes: union(old?.writes, t.writes),
          emits: union(old?.emits, t.emits),
          duration: t.duration ?? old?.duration,
          bytes: t.bytes ?? old?.bytes,
          compute: t.compute ?? old?.compute,
          dependsOn: explicit ? t.dependsOn : old?.dependsOn,
          explicitDeps: explicit || !!old?.explicitDeps,
        })
      }
    }

  const resolve = resolver(tableIds)
  const sources = new Map<string, Source>()
  const ids = (names: string[] | undefined) =>
    [...new Set((names ?? []).map((n) => {
      const r = resolve(n)
      if (r.source) sources.set(r.id, r.source)
      return r.id
    }))]

  // Order pipelines as the last input (the sidecar) lists them, then any only found earlier (notes).
  const order: string[] = []
  for (const input of [...inputs].reverse()) for (const p of input) if (!order.includes(p.id)) order.push(p.id)
  const pipelines: Pipeline[] = order.map((id) => pipelineMeta.get(id)!).map((m, i) => ({
    id: m.id,
    name: m.name ?? m.id,
    color: m.color ?? PIPELINE_COLORS[i % PIPELINE_COLORS.length],
    trigger: m.trigger
      ? m.trigger.kind === 'table_update' ? { ...m.trigger, tables: ids(m.trigger.tables) } : m.trigger
      : undefined,
    tasks: [],
  }))
  const byId = new Map(pipelines.map((p) => [p.id, p]))

  // Compute: what the task names, else a job cluster per pipeline (serverless for streaming).
  const used = new Map<string, Cluster>()
  const clusterFor = (t: RawTask, p: Pipeline): string => {
    if (t.compute === SERVERLESS || (!t.compute && p.trigger?.kind === 'continuous')) {
      if (!used.has(SERVERLESS)) used.set(SERVERLESS, declared.get(SERVERLESS) ?? serverlessCluster())
      return SERVERLESS
    }
    const named = t.compute && (declared.get(t.compute) ?? declared.get(`${p.id}.${t.compute}`))
    if (t.compute && !named) warnings.push(`Task "${t.id}" runs on unknown cluster "${t.compute}"`)
    if (named) {
      used.set(named.id, named)
      return named.id
    }
    const id = `${p.id}_cluster`
    if (!used.has(id)) {
      const n = [...tasks.values()].filter((x) => x.pipelineId === p.id).length
      used.set(id, { id, name: id, kind: 'job', nodeType: 'i3.xlarge', workers: { min: 2, max: Math.min(8, 2 + n) }, coresPerNode: 4 })
    }
    return id
  }

  for (const t of tasks.values()) {
    const task: Task = {
      id: t.id,
      name: t.name ?? t.id,
      pipelineId: t.pipelineId,
      reads: ids(t.reads),
      writes: ids(t.writes),
      dependsOn: [],
      emits: t.emits ?? [],
      ...(t.duration ? { duration: t.duration } : {}),
      ...(t.bytes ? { bytes: t.bytes } : {}),
      clusterId: clusterFor(t, byId.get(t.pipelineId)!),
    }
    if (!task.reads.length && !task.writes.length) warnings.push(`Task "${t.id}" reads and writes nothing`)
    byId.get(t.pipelineId)!.tasks.push(task)
  }

  for (const p of pipelines) {
    const ownIds = new Set(p.tasks.map((t) => t.id))
    for (const task of p.tasks) {
      const raw = tasks.get(task.id)!
      if (raw.explicitDeps) {
        for (const d of raw.dependsOn ?? [])
          if (!tasks.has(d)) warnings.push(`Task "${task.id}" depends on unknown task "${d}"`)
        task.dependsOn = (raw.dependsOn ?? []).filter((d) => tasks.has(d))
      } else {
        task.dependsOn = p.tasks
          .filter((o) => o.id !== task.id && o.writes.some((w) => task.reads.includes(w)))
          .map((o) => o.id)
          .filter((id) => ownIds.has(id))
      }
    }
    const { cyclic } = runSteps(p)
    if (cyclic.length) warnings.push(`Pipeline "${p.id}" has a dependency cycle: ${cyclic.join(', ')}`)
    if (p.trigger?.kind === 'job' && !byId.has(p.trigger.pipeline))
      warnings.push(`Pipeline "${p.id}" runs after unknown pipeline "${p.trigger.pipeline}"`)
  }

  return { pipelines: pipelines.filter((p) => p.tasks.length), sources: [...sources.values()], clusters: [...used.values()], warnings }
}
