import type { Column, ColumnDetail, EdgeLayer, Graph, GroupBy, Layer, RefKind } from '../model/types'
import type { Cluster, Medallion, Trigger } from '../model/workflow'
import { clusterNodeId } from '../model/workflow'

export interface ViewNode {
  id: string
  kind: 'table' | 'domain' | 'source' | 'job'
  layerId: string
  name: string
  /** Columns shown on the card (after detail level / collapse). */
  columns: Column[]
  /** Domain summaries: table ids folded in. */
  members?: string[]
  medallion?: Medallion
  /** Jobs: owning pipeline, its trigger if this job starts the run, and events it emits. */
  pipelineId?: string
  trigger?: Trigger
  emits?: string[]
}

export interface ViewEdge {
  id: string
  from: string
  to: string
  /** Ref columns, for join chains. */
  fromColumns: string[]
  toColumns: string[]
  kind: RefKind
  /** Refs merged into this edge (collapsed domains). */
  count: number
}

/** Lineage: data moving from a table into a job (`read`) or from a job into a table (`write`). */
export interface FlowEdge {
  id: string
  from: string
  to: string
  pipelineId: string
  taskId: string
  role: 'read' | 'write'
}

/** Compute a set of visible jobs runs on. Kept apart from `nodes` so layouts and path finding ignore it. */
export interface ViewCluster {
  id: string
  cluster: Cluster
  /** Job node ids running on it. */
  jobs: string[]
}

/** A job running on a cluster. */
export interface ComputeLink {
  id: string
  cluster: string
  job: string
}

export interface ViewGraph {
  nodes: ViewNode[]
  edges: ViewEdge[]
  flows: FlowEdge[]
  layers: Layer[]
  clusters: ViewCluster[]
  computeLinks: ComputeLink[]
}

export interface ViewOptions {
  columnDetail?: ColumnDetail
  collapsedCards?: string[]
  collapsedLayers?: string[]
  hiddenLayers?: string[]
  groupBy?: GroupBy
  /** Include jobs, sources and lineage flows. */
  lineage?: boolean
  hiddenPipelines?: string[]
  /** With lineage: the clusters jobs run on. */
  compute?: boolean
  /** With lineage: drop tables no visible pipeline reads or writes (and domains left empty). */
  pipelineTablesOnly?: boolean
}

export const SOURCES = '__sources__'
export const UNASSIGNED = '__unassigned__'
export const MEDALLION_LAYERS: Layer[] = [
  { id: 'bronze', name: 'bronze', color: '#cd7f32' },
  { id: 'silver', name: 'silver', color: '#c0c7d1' },
  { id: 'gold', name: 'gold', color: '#f5c542' },
  { id: 'platinum', name: 'platinum', color: '#9fd3e6' },
  { id: UNASSIGNED, name: 'unassigned', color: '#6b7280' },
]
export const SOURCES_LAYER: Layer = { id: SOURCES, name: 'sources', color: '#94a3b8' }

export const domainNodeId = (layerId: string) => `domain:${layerId}`
export const jobNodeId = (taskId: string) => `job:${taskId}`

const showColumn = (c: Column, detail: ColumnDetail) => detail === 'all' || (detail === 'keys' && (c.pk || c.fk))

/** Applies grouping, hide / collapse / column detail and pipeline visibility to the parsed graph. Pure. */
export function deriveView(graph: Graph, opts: ViewOptions = {}): ViewGraph {
  const detail = opts.columnDetail ?? 'all'
  const hidden = new Set(opts.hiddenLayers ?? [])
  const collapsed = new Set(opts.collapsedLayers ?? [])
  const collapsedCards = new Set(opts.collapsedCards ?? [])
  const byMedallion = opts.groupBy === 'medallion'
  const groupOf = (t: Graph['tables'][number]) => (byMedallion ? t.medallion ?? UNASSIGNED : t.layerId)

  const wf = graph.workflows
  const hiddenPipelines = new Set(opts.hiddenPipelines ?? [])
  const pipelines = opts.lineage ? wf.pipelines.filter((p) => !hiddenPipelines.has(p.id)) : []
  const usedSources = new Set(pipelines.flatMap((p) => p.tasks.flatMap((t) => [...t.reads, ...t.writes])))
  const sources = wf.sources.filter((s) => usedSources.has(s.id))
  const allTables = opts.lineage && opts.pipelineTablesOnly ? graph.tables.filter((t) => usedSources.has(t.id)) : graph.tables

  // Tables by group, once, rather than a scan of every table per layer.
  const tablesOf = new Map<string, Graph['tables']>()
  for (const t of allTables) {
    const g = groupOf(t)
    const list = tablesOf.get(g)
    if (list) list.push(t)
    else tablesOf.set(g, [t])
  }
  const baseLayers = byMedallion
    ? MEDALLION_LAYERS.filter((l) => tablesOf.has(l.id))
    : opts.lineage && opts.pipelineTablesOnly ? graph.layers.filter((l) => tablesOf.has(l.id)) : graph.layers
  const layers = [...(sources.length ? [SOURCES_LAYER] : []), ...baseLayers].filter((l) => !hidden.has(l.id))

  const nodes: ViewNode[] = []
  const nodeOf = new Map<string, string>() // table / source id -> node id
  for (const l of layers) {
    if (l.id === SOURCES) {
      for (const s of sources) {
        const row: Column = { name: 'external', type: 'source', pk: false, fk: false }
        nodes.push({ id: s.id, kind: 'source', layerId: SOURCES, name: s.name, columns: [row] })
        nodeOf.set(s.id, s.id)
      }
      continue
    }
    const tables = tablesOf.get(l.id) ?? []
    if (collapsed.has(l.id) && tables.length) {
      const id = domainNodeId(l.id)
      // One pseudo-row carries the table count so the card renders and sizes like any other.
      const summary: Column = { name: `${tables.length} tables`, type: 'collapsed', pk: false, fk: false }
      nodes.push({ id, kind: 'domain', layerId: l.id, name: l.name, columns: [summary], members: tables.map((t) => t.id) })
      for (const t of tables) nodeOf.set(t.id, id)
      continue
    }
    for (const t of tables) {
      const columns = collapsedCards.has(t.id) ? [] : t.columns.filter((c) => showColumn(c, detail))
      nodes.push({ id: t.id, kind: 'table', layerId: l.id, name: t.name, columns, medallion: t.medallion })
      nodeOf.set(t.id, t.id)
    }
  }

  const edges: ViewEdge[] = []
  const merged = new Map<string, ViewEdge>()
  for (const r of graph.refs) {
    const from = nodeOf.get(r.from.table)
    const to = nodeOf.get(r.to.table)
    if (!from || !to) continue
    const viaDomain = from !== r.from.table || to !== r.to.table
    if (viaDomain && from === to) continue // internal to a collapsed domain
    if (!viaDomain) {
      edges.push({ id: r.id, from, to, fromColumns: r.from.columns, toColumns: r.to.columns, kind: r.kind, count: 1 })
      continue
    }
    const key = `${from}>${to}`
    const prev = merged.get(key)
    if (prev) prev.count++
    else {
      const e: ViewEdge = { id: `m:${key}`, from, to, fromColumns: r.from.columns, toColumns: r.to.columns, kind: r.kind, count: 1 }
      merged.set(key, e)
      edges.push(e)
    }
  }

  // Jobs and lineage. A job is shown when at least one table it touches is visible.
  const flows: FlowEdge[] = []
  const seenFlow = new Set<string>()
  const jobsOn = new Map<string, string[]>() // cluster id -> job node ids
  for (const p of pipelines) {
    const firstStep = new Set(p.tasks.filter((t) => !t.dependsOn.length).map((t) => t.id))
    for (const t of p.tasks) {
      const reads = [...new Set(t.reads.map((r) => nodeOf.get(r)).filter((n): n is string => !!n))]
      const writes = [...new Set(t.writes.map((w) => nodeOf.get(w)).filter((n): n is string => !!n))]
      if (!reads.length && !writes.length) continue
      const id = jobNodeId(t.id)
      nodes.push({
        id,
        kind: 'job',
        layerId: '',
        name: t.name,
        columns: [],
        pipelineId: p.id,
        trigger: firstStep.has(t.id) ? p.trigger : undefined,
        emits: t.emits,
      })
      const add = (from: string, to: string, role: FlowEdge['role']) => {
        const fid = `f:${from}>${to}`
        if (seenFlow.has(fid)) return
        seenFlow.add(fid)
        flows.push({ id: fid, from, to, pipelineId: p.id, taskId: t.id, role })
      }
      for (const r of reads) add(r, id, 'read')
      for (const w of writes) add(id, w, 'write')
      const on = jobsOn.get(t.clusterId)
      if (on) on.push(id)
      else jobsOn.set(t.clusterId, [id])
    }
  }

  const clusters: ViewCluster[] = []
  const computeLinks: ComputeLink[] = []
  if (opts.compute)
    for (const c of wf.clusters) {
      const jobs = jobsOn.get(c.id)
      if (!jobs) continue
      const id = clusterNodeId(c.id)
      clusters.push({ id, cluster: c, jobs })
      for (const job of jobs) computeLinks.push({ id: `c:${job}>${id}`, cluster: id, job })
    }

  return { nodes, edges, flows, layers, clusters, computeLinks }
}

/** Store fields the scene's view derives from. */
export interface ViewInputs {
  graph: Graph
  columnDetail?: ColumnDetail
  collapsedCards?: string[]
  groupBy?: GroupBy
  edgeLayer?: EdgeLayer
  hiddenPipelines?: string[]
  pipelineTablesOnly?: boolean
  showCompute?: boolean
  hiddenLayers: string[]
  isolatedLayerId: string | null
  collapsedLayers: string[]
}

export const lineageOn = (edgeLayer: string | undefined) => edgeLayer !== 'fk'

/** The scene's view: grouping, hide / isolate / collapse / column detail, visible pipelines. Pure. */
export function sceneView(s: ViewInputs): ViewGraph {
  const lineage = lineageOn(s.edgeLayer)
  const hidden = s.isolatedLayerId
    ? deriveView(s.graph, { groupBy: s.groupBy, lineage }).layers.map((l) => l.id).filter((id) => id !== s.isolatedLayerId)
    : s.hiddenLayers
  return deriveView(s.graph, {
    hiddenLayers: hidden,
    collapsedLayers: s.collapsedLayers,
    columnDetail: s.columnDetail,
    collapsedCards: s.collapsedCards,
    groupBy: s.groupBy,
    lineage,
    hiddenPipelines: s.hiddenPipelines,
    pipelineTablesOnly: s.pipelineTablesOnly,
    compute: s.showCompute ?? true,
  })
}

/** Child (FK holder) and parent (referenced) ends of an edge. */
export const fkEnds = (e: Pick<ViewEdge, 'from' | 'to' | 'kind'>) =>
  e.kind === '1-n' ? { child: e.to, parent: e.from } : { child: e.from, parent: e.to }
