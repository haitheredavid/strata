import type { Graph } from '../model/types'
import type { ClusterKind } from '../model/workflow'
import type { StageOp } from '../sim/spark'
import { CLUSTER_COLOR, OP_COLOR } from '../scene/clusterStyle'
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

function build(graph: Graph, scheme: SchemeId): Palette {
  const pipelineIds = graph.workflows.pipelines.map((p) => p.id)
  const layerIds = graph.layers.map((l) => l.id)
  // Default keeps the parsed colors, including `color:` from the workflow file.
  const [layers, pipelines, medallions, clusters, ops, accent] =
    scheme === 'default'
      ? [
          new Map(graph.layers.map((l) => [l.id, l.color])),
          new Map(graph.workflows.pipelines.map((p) => [p.id, p.color])),
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
  return {
    layer: (id) => layers.get(id) ?? (NEUTRAL.has(id) ? NEUTRAL.get(id)! : medallion(id)),
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
