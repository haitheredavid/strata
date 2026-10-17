import type { Layout } from '../model/types'
import { claimsSnapshot, isSnapshot, snapshotProblem } from '../ingest/snapshot'
import type { Snapshot } from '../ingest/snapshot'
import { parseSidecar } from '../parse/workflows'

export interface OpenedFile {
  name: string
  text: string
}

type Kind =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'badSnapshot'; problem: string }
  | { kind: 'schema' }
  | { kind: 'workflows' }
  | { kind: 'layout'; layout: Layout }
  | { kind: 'unknown' }

/** What to do with a set of dropped / picked files. */
export type OpenPlan =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'schema'; name: string; dbml: string; workflows?: string }
  | { kind: 'workflows'; text: string }
  | { kind: 'layout'; layout: Layout }
  | { kind: 'none' }

const DBML = /^\s*(Table|TableGroup|Ref|Enum|Project)\b/m

function isLayout(v: unknown): v is Layout {
  return !!v && typeof v === 'object' && 'positions' in v && 'layerOrder' in v && Array.isArray(v.layerOrder)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** What a file is, by content first: JSON is a snapshot, a layout or a workflow file; YAML is workflows; else DBML. */
function classify({ name, text }: OpenedFile): Kind {
  if (/\.json$/i.test(name) || /^\s*[{[]/.test(text)) {
    const v = parseJson(text)
    if (isSnapshot(v)) return { kind: 'snapshot', snapshot: v }
    if (claimsSnapshot(v)) return { kind: 'badSnapshot', problem: snapshotProblem(v) ?? 'invalid' }
    if (isLayout(v)) return { kind: 'layout', layout: v }
    if (v !== undefined) return parseSidecar(text).pipelines.length ? { kind: 'workflows' } : { kind: 'unknown' }
  }
  if (/\.ya?ml$/i.test(name)) return { kind: 'workflows' }
  if (/\.(dbml|txt)$/i.test(name) || DBML.test(text)) return { kind: 'schema' }
  return { kind: 'unknown' }
}

/**
 * Picks one action for `files`, in order: a snapshot; a schema with an optional workflow file; a lone
 * workflow file (for the open dataset); a layout. Files claiming to be snapshots that aren't valid are
 * listed in `problems`; every other file left out is listed in `ignored`.
 */
export function planOpen(files: OpenedFile[]): { plan: OpenPlan; ignored: string[]; problems: string[] } {
  const kinds = files.map((f) => ({ f, k: classify(f) }))
  const find = (kind: Kind['kind']) => kinds.find((x) => x.k.kind === kind)
  const problems = kinds.flatMap(({ f, k }) => (k.kind === 'badSnapshot' ? [`${f.name} isn't a usable snapshot: ${k.problem}`] : []))
  const bad = new Set(kinds.filter((x) => x.k.kind === 'badSnapshot').map((x) => x.f))
  const result = (plan: OpenPlan, ...used: (OpenedFile | undefined)[]) => ({
    plan,
    ignored: files.filter((f) => !used.includes(f) && !bad.has(f)).map((f) => f.name),
    problems,
  })

  const snapshot = find('snapshot')
  if (snapshot?.k.kind === 'snapshot') return result({ kind: 'snapshot', snapshot: snapshot.k.snapshot }, snapshot.f)
  const schema = find('schema')
  const workflows = find('workflows')
  if (schema) return result({ kind: 'schema', name: schema.f.name, dbml: schema.f.text, workflows: workflows?.f.text }, schema.f, workflows?.f)
  if (workflows) return result({ kind: 'workflows', text: workflows.f.text }, workflows.f)
  const layout = find('layout')
  if (layout?.k.kind === 'layout') return result({ kind: 'layout', layout: layout.k.layout }, layout.f)
  return result({ kind: 'none' })
}
