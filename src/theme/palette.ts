import { Color } from 'three'
import type { Graph } from '../model/types'
import type { ClusterKind } from '../model/workflow'
import type { StageOp } from '../sim/spark'
import { CLUSTER_COLOR, OP_COLOR } from '../scene/clusterStyle'
import { PIPELINE_COLORS } from '../parse/workflows'
import { MEDALLION_LAYERS, SOURCES_LAYER, UNASSIGNED } from '../view/deriveView'
import { useStore } from '../store'
import { accentOf, spread } from './schemes'
import type { SchemeId } from './schemes'

/** Every data color the app draws, resolved for one graph and color scheme. */
export interface Palette {
  /** Domain / group layers, medallion layers and the sources layer. */
  layer(id: string): string
  pipeline(id: string): string
  medallion(id: string): string
  cluster(kind: ClusterKind): string
  op(op: StageOp): string
  accent: string
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

function build(graph: Graph, scheme: SchemeId): Palette {
  const pipelineIds = graph.workflows.pipelines.map((p) => p.id)
  const layerIds = graph.layers.map((l) => l.id)
  // Default keeps the parsed colors, including `color:` from the workflow file.
  const [layers, pipelines, medallions, clusters, ops, accent] =
    scheme === 'default'
      ? [
          new Map(graph.layers.map((l) => [l.id, l.color])),
          defaultPipelineColors(graph),
          new Map(MEDALLION_LAYERS.map((l) => [l.id, l.color])),
          new Map(Object.entries(CLUSTER_COLOR)),
          new Map(Object.entries(OP_COLOR)),
          DEFAULT_ACCENT,
        ]
      : [
          zip(layerIds, spread(scheme, layerIds.length)),
          zip(pipelineIds, spread(scheme, pipelineIds.length)),
          zip(MEDALLIONS, spread(scheme, MEDALLIONS.length)),
          zip(CLUSTER_KINDS, spread(scheme, CLUSTER_KINDS.length)),
          zip(OPS, spread(scheme, OPS.length)),
          accentOf(scheme),
        ]
  const medallion = (id: string) => medallions.get(id) ?? NEUTRAL.get(id) ?? FALLBACK
  const layer = (id: string) => layers.get(id) ?? (NEUTRAL.has(id) ? NEUTRAL.get(id)! : medallion(id))
  return {
    layer,
    pipeline: (id) => pipelines.get(id) ?? FALLBACK,
    medallion,
    cluster: (kind) => clusters.get(kind) ?? FALLBACK,
    op: (op) => ops.get(op) ?? FALLBACK,
    accent,
  }
}

const cache = new WeakMap<Graph, Map<SchemeId, Palette>>()

/** The palette for a graph and scheme; the same object for the same pair, so it's safe in memo deps. */
export function paletteFor(graph: Graph, scheme: SchemeId): Palette {
  let byScheme = cache.get(graph)
  if (!byScheme) cache.set(graph, (byScheme = new Map()))
  let p = byScheme.get(scheme)
  if (!p) byScheme.set(scheme, (p = build(graph, scheme)))
  return p
}

export const usePalette = () => useStore((s) => paletteFor(s.graph, s.colorScheme))
