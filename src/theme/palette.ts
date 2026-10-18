import { Color } from 'three'
import type { Graph } from '../model/types'
import type { ClusterKind } from '../model/workflow'
import type { StageOp } from '../sim/spark'
import { CLUSTER_COLOR, OP_COLOR } from '../scene/clusterStyle'
import { PIPELINE_COLORS } from '../parse/workflows'
import { jobNodeId, MEDALLION_LAYERS, SOURCES_LAYER, UNASSIGNED } from '../view/deriveView'
import { lineageDepth } from '../view/lineageDepth'
import { useStore } from '../store'
import { accentOf, along, depthGradient, scatter, spread } from './schemes'
import type { ColorBy, GradientId, SchemeId } from './schemes'

/** Every data color the app draws, resolved for one graph, color scheme and color meaning. */
export interface Palette {
  /** Domain / group layers, medallion layers and the sources layer. */
  layer(id: string): string
  pipeline(id: string): string
  /** A table's, source's or job's own color when colors follow lineage depth; null when they follow identity. */
  node(id: string): string | null
  medallion(id: string): string
  cluster(kind: ClusterKind): string
  op(op: StageOp): string
  accent: string
  /** The gradient depth is drawn with, for the legend; null when colors follow identity. */
  depth: GradientId | null
}

const FALLBACK = '#ffffff'
const DEFAULT_ACCENT = '#4f9dff'
const NEUTRAL = new Map([
  [SOURCES_LAYER.id, SOURCES_LAYER.color],
  [UNASSIGNED, MEDALLION_LAYERS.find((l) => l.id === UNASSIGNED)!.color],
])
const CLUSTER_KINDS = Object.keys(CLUSTER_COLOR) as ClusterKind[]
const OPS = Object.keys(OP_COLOR) as StageOp[]
const MEDALLIONS = MEDALLION_LAYERS.filter((l) => l.id !== UNASSIGNED).map((l) => l.id)

const zip = (ids: string[], colors: string[]) => new Map(ids.map((id, i) => [id, colors[i]]))

/**
 * Pipeline colors for workspaces with more pipelines than the parser's eight: those eight, then
 * colors picked greedily to be as far as possible (OKLab distance) from every earlier one, within a
 * lightness and chroma band that reads on the dark background. The closest pair here is further
 * apart than the closest pair of the original eight.
 */
export const PIPELINE_PALETTE = [
  ...PIPELINE_COLORS,
  '#ebc8fa', '#919600', '#469ba5', '#0091fa', '#bee1b4', '#aa7da0', '#b4b478', '#c37837',
  '#e1a5af', '#ff96ff', '#00aa69', '#a0b9ff', '#c35fcd', '#05fad2', '#91be00', '#ffc396',
  '#a5e1ff', '#3cafe6', '#73b9af', '#7887cd', '#e15087', '#b49bcd', '#cd9b00', '#c88c82',
]

/** Lightness offsets for each further pass through the palette. */
const PASSES = [0, -0.16, 0.12, -0.26]

/** The `i`th categorical pipeline color: the palette, then it again darker / lighter. */
export function pipelineColor(i: number): string {
  const n = PIPELINE_PALETTE.length
  const base = PIPELINE_PALETTE[i % n]
  const pass = Math.floor(i / n) % PASSES.length
  return pass === 0 ? base : `#${new Color(base).offsetHSL(0, 0, PASSES[pass]).getHexString()}`
}

/**
 * Pipeline colors in the default scheme. Up to the parser's eight, the parsed colors as they are.
 * Past that the parser cycles its eight, so each pipeline still showing a parser color takes the
 * palette color for its position instead; `color:` overrides from the workflow file stay. Position in
 * the graph's pipeline list, so a pipeline keeps its color across reloads and while others are hidden.
 */
function defaultPipelineColors(graph: Graph): Map<string, string> {
  const { pipelines } = graph.workflows
  const many = pipelines.length > PIPELINE_COLORS.length
  return new Map(pipelines.map((p, i) => [p.id, many && PIPELINE_COLORS.includes(p.color) ? pipelineColor(i) : p.color]))
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5)

/**
 * Lineage depth on the gradient: each table, source and job at its own depth, a domain at the mean
 * depth of its tables, a pipeline at the mean depth of its jobs. Grouped by medallion layer (or with
 * domains ordered by dependency) the diagram reads as one sweep from the dark end to the bright end.
 */
function depthColors(graph: Graph, g: GradientId) {
  const depth = lineageDepth(graph)
  const at = (id: string) => depth.get(id) ?? 0.5
  const members = new Map<string, number[]>()
  for (const t of graph.tables) members.set(t.layerId, [...(members.get(t.layerId) ?? []), at(t.id)])
  return {
    nodes: new Map([...depth].map(([id, d]) => [id, along(g, d)])),
    layers: new Map(graph.layers.map((l) => [l.id, along(g, mean(members.get(l.id) ?? []))])),
    pipelines: new Map(graph.workflows.pipelines.map((p) => [p.id, along(g, mean(p.tasks.map((t) => at(jobNodeId(t.id)))))])),
  }
}

function build(graph: Graph, scheme: SchemeId, colorBy: ColorBy): Palette {
  const pipelineIds = graph.workflows.pipelines.map((p) => p.id)
  const layerIds = graph.layers.map((l) => l.id)
  const byDepth = colorBy === 'depth' ? depthGradient(scheme) : null
  // Ordered things (medallion layers, cluster kinds, stage ops) run along the gradient in order;
  // the categorical default keeps the parsed colors, including `color:` from the workflow file.
  const g: GradientId | null = scheme === 'default' ? byDepth : scheme
  const fixed = g
    ? {
        medallions: zip(MEDALLIONS, spread(g, MEDALLIONS.length)),
        clusters: zip(CLUSTER_KINDS, spread(g, CLUSTER_KINDS.length)),
        ops: zip(OPS, spread(g, OPS.length)),
      }
    : {
        medallions: new Map(MEDALLION_LAYERS.map((l) => [l.id, l.color])),
        clusters: new Map(Object.entries(CLUSTER_COLOR)),
        ops: new Map(Object.entries(OP_COLOR)),
      }
  const { layers, pipelines, nodes }: { layers: Map<string, string>; pipelines: Map<string, string>; nodes: Map<string, string> | null } = byDepth
    ? depthColors(graph, byDepth)
    : scheme === 'default'
      ? { layers: new Map(graph.layers.map((l) => [l.id, l.color])), pipelines: defaultPipelineColors(graph), nodes: null }
      : { layers: zip(layerIds, scatter(scheme, layerIds.length)), pipelines: zip(pipelineIds, scatter(scheme, pipelineIds.length)), nodes: null }
  const medallion = (id: string) => fixed.medallions.get(id) ?? NEUTRAL.get(id) ?? FALLBACK
  const layer = (id: string) => layers.get(id) ?? (NEUTRAL.has(id) ? NEUTRAL.get(id)! : medallion(id))
  return {
    layer,
    pipeline: (id) => pipelines.get(id) ?? FALLBACK,
    node: nodes ? (id) => nodes.get(id) ?? null : () => null,
    medallion,
    cluster: (kind) => fixed.clusters.get(kind) ?? FALLBACK,
    op: (op) => fixed.ops.get(op) ?? FALLBACK,
    accent: scheme === 'default' ? DEFAULT_ACCENT : accentOf(scheme),
    depth: byDepth,
  }
}

const cache = new WeakMap<Graph, Map<string, Palette>>()

/** The palette for a graph, scheme and color meaning; the same object for the same inputs, so it's safe in memo deps. */
export function paletteFor(graph: Graph, scheme: SchemeId, colorBy: ColorBy = 'identity'): Palette {
  let byKey = cache.get(graph)
  if (!byKey) cache.set(graph, (byKey = new Map()))
  const key = `${scheme}:${colorBy}`
  let p = byKey.get(key)
  if (!p) byKey.set(key, (p = build(graph, scheme, colorBy)))
  return p
}

export const usePalette = () => useStore((s) => paletteFor(s.graph, s.colorScheme, s.colorBy))
