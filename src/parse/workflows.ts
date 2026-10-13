import { parse as parseYaml } from 'yaml'
import type { Pipeline, Source, Task, Trigger, Workflows } from '../model/workflow'
import { sourceId } from '../model/workflow'
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
}
export interface RawPipeline {
  id: string
  name?: string
  color?: string
  trigger?: Trigger
  tasks: RawTask[]
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

function parseTrigger(v: unknown): Trigger | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return parseTriggerText(v)
  if (typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (o.schedule) return { kind: 'schedule', cron: String((o.schedule as { cron?: string }).cron ?? o.schedule) }
  if (o.file_arrival) return { kind: 'file_arrival', path: String((o.file_arrival as { url?: string }).url ?? o.file_arrival) }
  if (o.table_update) return { kind: 'table_update', tables: strings((o.table_update as { tables?: unknown }).tables ?? o.table_update) }
  if (o.after || o.job) return { kind: 'job', pipeline: String(o.after ?? o.job) }
  if (o.continuous) return { kind: 'continuous' }
  if (o.manual) return { kind: 'manual' }
  return undefined
}

/**
 * Sidecar file (YAML or JSON): `{ pipelines: [{ id, name?, trigger?, tasks: [{ id, reads, writes, depends_on, emits }] }] }`.
 * Also accepts a DAB-like `resources.jobs` map. Problems become warnings rather than errors.
 */
export function parseSidecar(text: string): { pipelines: RawPipeline[]; warnings: string[] } {
  const warnings: string[] = []
  let doc: unknown
  try {
    doc = parseYaml(text) // YAML is a superset of JSON
  } catch (e) {
    return { pipelines: [], warnings: [`Workflow file: ${(e as Error).message.split('\n')[0]}`] }
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

  const pipelines: RawPipeline[] = []
  entries.forEach(([key, p], i) => {
    const id = String(p.id ?? key ?? p.name ?? `pipeline_${i + 1}`)
    const tasks: RawTask[] = []
    const rawTasks = Array.isArray(p.tasks) ? (p.tasks as Record<string, unknown>[]) : []
    if (!rawTasks.length) warnings.push(`Pipeline "${id}" has no tasks`)
    rawTasks.forEach((t, j) => {
      const deps = (t.depends_on ?? t.dependsOn) as unknown
      const taskId = String(t.id ?? t.task_key ?? t.name ?? `${id}_task_${j + 1}`)
      const duration = parseDuration(t.duration)
      if (t.duration !== undefined && duration === undefined) warnings.push(`Task "${taskId}" has an unreadable duration "${t.duration}"`)
      tasks.push({
        id: taskId,
        name: t.name ? String(t.name) : undefined,
        reads: strings(t.reads),
        writes: strings(t.writes),
        // DAB style: depends_on: [{ task_key: x }]
        dependsOn: Array.isArray(deps)
          ? deps.map((d) => String(typeof d === 'object' && d ? (d as { task_key?: string }).task_key : d))
          : strings(deps),
        emits: strings(t.emits),
        duration,
      })
    })
    pipelines.push({
      id,
      name: p.name ? String(p.name) : undefined,
      color: p.color ? String(p.color) : undefined,
      trigger: parseTrigger(p.trigger),
      tasks,
    })
  })
  return { pipelines, warnings }
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
export function buildWorkflows(inputs: RawPipeline[][], tableIds: string[], warnings: string[] = []): Workflows {
  const pipelineMeta = new Map<string, Omit<RawPipeline, 'tasks'>>()
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

  return { pipelines: pipelines.filter((p) => p.tasks.length), sources: [...sources.values()], warnings }
}
