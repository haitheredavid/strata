import { CompilerError } from '@dbml/core'
import type { Graph, Layout } from '../model/types'
import type { Snapshot } from '../ingest/snapshot'
import { parseDbml } from '../parse/dbml'
import { parseSidecar } from '../parse/workflows'
import { simulateDay } from '../sim/schedule'
import type { Schedule } from '../sim/schedule'
import { hash32 } from '../sim/rng'
import { SYNTH_DEFAULTS, synthGraph, synthKey } from '../dev/synth'
import type { SynthOptions } from '../dev/synth'
import { MEDALLION_LAYERS, SOURCES } from '../view/deriveView'
import { span } from '../dev/perf'

/** Bundled schemas in `public/`. */
export const SAMPLES = [
  { id: 'commerce', label: 'Commerce sample', dbml: 'sample.dbml', workflows: null },
  { id: 'lakehouse', label: 'Lakehouse sample', dbml: 'lakehouse.dbml', workflows: 'lakehouse.workflows.yaml' },
] as const

/**
 * What a dataset is built from, kept so a reload can rebuild it. `workflows`, when set, replaces the
 * workflow file the schema came with (a sample's bundled one, or a snapshot's jobs).
 */
export type DatasetSource =
  | { origin: 'sample'; id: string; workflows?: string }
  | { origin: 'file'; name: string; dbml: string; workflows?: string }
  | { origin: 'snapshot'; snapshot: Snapshot; workflows?: string }
  | { origin: 'synth'; options: Partial<SynthOptions> }

/** A sample's bundled files, fetched from `public/`. */
export interface SampleFiles {
  dbml: string
  workflows: string | null
}

/** A loaded schema with its jobs and day of runs. Built by `buildDataset`; the store installs it whole. */
export interface Dataset {
  /** One per sample, synthetic spec, schema file (by content) or snapshot (by host and day). */
  key: string
  /** Names the saved layout: the schema content, so the same tables keep their positions. */
  layoutKey: string
  label: string
  source: DatasetSource
  /** The schema text the graph was parsed from ('' for synthetic graphs). */
  dbml: string
  graph: Graph
  /** A snapshot's real runs, else the simulated day. */
  schedule: Schedule
  /** Snapshot export notes and workflow file problems. */
  warnings: string[]
  meta?: { host: string; day: string; tz: string }
}

const hash = (s: string) => hash32(s).toString(36)

/** `https://dbc-123.cloud.databricks.com` → `dbc-123`. */
const shortHost = (host: string) => host.replace(/^https?:\/\//, '').split('.')[0]

export function datasetKey(source: DatasetSource): string {
  switch (source.origin) {
    case 'sample':
      return `sample:${source.id}`
    case 'synth':
      return synthKey(source.options)
    case 'file':
      return `file:${hash(source.dbml)}`
    case 'snapshot':
      return `snapshot:${source.snapshot.host}:${source.snapshot.day}`
  }
}

export function sourceLabel(source: DatasetSource): string {
  switch (source.origin) {
    case 'sample':
      return SAMPLES.find((s) => s.id === source.id)?.label ?? source.id
    case 'synth':
      return `Synthetic ${(source.options.tables ?? SYNTH_DEFAULTS.tables).toLocaleString()} tables`
    case 'file':
      return source.name
    case 'snapshot':
      return `${shortHost(source.snapshot.host)} · ${source.snapshot.day}`
  }
}

/** Parses DBML, turning the parser's first diagnostic into a readable error. */
function parse(dbml: string, workflows: string | null): Graph {
  try {
    return span('parse', () => parseDbml(dbml, workflows))
  } catch (e) {
    if (!(e instanceof CompilerError) || !e.diags.length) throw e
    const { message, location } = e.diags[0]
    throw new Error(`Schema error on line ${location.start.line}: ${message}`)
  }
}

const simulated = (graph: Graph) => span('simulateDay', () => simulateDay(graph.workflows, graph.tables))

/** Builds a dataset. `sample` holds the fetched files for a sample source. Throws with a readable message. */
export function buildDataset(source: DatasetSource, sample?: SampleFiles): Dataset {
  const key = datasetKey(source)
  const label = sourceLabel(source)
  if (source.origin === 'synth') {
    const graph = span('synth', () => synthGraph(source.options))
    return { key, layoutKey: hash(key), label, source, dbml: '', graph, schedule: simulated(graph), warnings: [] }
  }
  if (source.origin === 'snapshot') {
    const snap = source.snapshot
    const graph = parse(snap.dbml, source.workflows ?? snap.workflows)
    // Layouts follow the workspace slice, not the export: tomorrow's export of the same catalogs keeps
    // today's positions for the tables still there. Table ids are full UC names, catalog first.
    const catalogs = [...new Set(graph.tables.map((t) => t.id.split('.')[0]))].sort()
    return {
      key,
      layoutKey: hash(`snapshot:${snap.host}:${catalogs.join(',')}`),
      label,
      source,
      dbml: snap.dbml,
      graph,
      schedule: { ...snap.runs, origin: 'snapshot', day: snap.day, tz: snap.tz },
      warnings: [...snap.warnings, ...graph.workflows.warnings],
      meta: { host: snap.host, day: snap.day, tz: snap.tz },
    }
  }
  if (source.origin === 'sample' && !sample) throw new Error(`${label}: files not loaded`)
  const dbml = source.origin === 'file' ? source.dbml : sample!.dbml
  const graph = parse(dbml, source.workflows ?? (source.origin === 'sample' ? sample!.workflows : null))
  return { key, layoutKey: hash(dbml), label, source, dbml, graph, schedule: simulated(graph), warnings: graph.workflows.warnings }
}

/**
 * The dataset with `text` as its workflow file. A snapshot keeps its runs. Throws, leaving the dataset
 * as it was, when the file has no pipelines or the dataset has no schema to apply it to.
 */
export function withWorkflows(d: Dataset, text: string): Dataset {
  if (d.source.origin === 'synth') throw new Error('Workflow files apply to a schema; this dataset is synthetic')
  const { pipelines, warnings } = parseSidecar(text)
  if (!pipelines.length) throw new Error(warnings[0] ?? 'No pipelines found in the workflow file')
  return buildDataset({ ...d.source, workflows: text }, { dbml: d.dbml, workflows: null })
}

/** `layout` with ids the graph no longer has dropped (pipelines, folded cards, layers). */
export function normaliseLayout(layout: Layout, graph: Graph): Layout {
  const pipelines = new Set(graph.workflows.pipelines.map((p) => p.id))
  const cards = new Set([...graph.tables.map((t) => t.id), ...graph.workflows.sources.map((s) => s.id)])
  // Layer visibility is for the current grouping: its domains, or the fixed medallion layers.
  const layers = new Set(
    layout.groupBy === 'medallion' ? [...MEDALLION_LAYERS.map((l) => l.id), SOURCES] : [...graph.layers.map((l) => l.id), SOURCES],
  )
  const flowLayers = new Set([...graph.layers.map((l) => l.id), SOURCES])
  const keep = (id: string | undefined, ids: Set<string>) => (id && ids.has(id) ? id : undefined)
  return {
    ...layout,
    hiddenPipelines: layout.hiddenPipelines?.filter((id) => pipelines.has(id)),
    onlyPipeline: keep(layout.onlyPipeline, pipelines),
    collapsedCards: layout.collapsedCards?.filter((id) => cards.has(id)),
    flowOrder: layout.flowOrder?.filter((id) => flowLayers.has(id)),
    hiddenLayers: layout.hiddenLayers?.filter((id) => layers.has(id)),
    onlyLayer: keep(layout.onlyLayer, layers),
    collapsedLayers: layout.collapsedLayers?.filter((id) => layers.has(id)),
  }
}

/**
 * A saved layout carried over to a graph whose tables changed: saved positions and layer order for what
 * still exists, `fresh` placement for what's new, and the saved view settings.
 */
export function mergeLayout(saved: Layout, fresh: Layout, graph: Graph): Layout {
  const tables = new Set(graph.tables.map((t) => t.id))
  const layers = new Set(graph.layers.map((l) => l.id))
  const kept = Object.fromEntries(Object.entries(saved.positions ?? {}).filter(([id]) => tables.has(id)))
  const order = (saved.layerOrder ?? []).filter((id) => layers.has(id))
  return {
    ...saved,
    positions: { ...fresh.positions, ...kept },
    layerOrder: [...order, ...fresh.layerOrder.filter((id) => !order.includes(id))],
  }
}
