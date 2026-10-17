import type { ViewGraph } from './deriveView'
import type { Hop } from './hops'
import type { Path } from './paths'

/** Nodes, FK edges and lineage flows lit together. */
export interface LitSet {
  nodes: Set<string>
  edges: Set<string>
  flows: Set<string>
}

/**
 * What's lit, in two layers. The scope narrows the scene to what some pipelines touch (the timeline's
 * window, or the pipeline lens). The probe drills in: a found path, else the focus neighbourhood. A
 * probe is drawn in full even where it leaves the scope; the rest of the scope stays as a backdrop.
 */
export interface Highlight {
  scope: LitSet | null
  probe: LitSet | null
}

/** Everything the pipelines touch: their jobs, their reads / writes, and the flows between them. */
export function pipelineLit(view: ViewGraph, pipelineIds: Set<string>): LitSet {
  const flows = view.flows.filter((f) => pipelineIds.has(f.pipelineId))
  return { nodes: new Set(flows.flatMap((f) => [f.from, f.to])), edges: new Set(), flows: new Set(flows.map((f) => f.id)) }
}

/** The scope: pipelines that ran in the open timeline's window (already narrowed by the lens), else the lens. */
export function scopeLit(view: ViewGraph, timePipelines: Set<string> | null, lens: string | null): LitSet | null {
  if (timePipelines) return pipelineLit(view, timePipelines)
  return lens ? pipelineLit(view, new Set([lens])) : null
}

/** The probe: the found paths (or the one picked), else the focus neighbourhood with the edges and flows inside it. */
export function probeLit(view: ViewGraph, reach: Map<string, Hop> | null, paths: Path[], activePath: number | null): LitSet | null {
  if (paths.length) {
    const shown = activePath !== null && paths[activePath] ? [paths[activePath]] : paths
    return { nodes: new Set(shown.flatMap((p) => p.nodes)), edges: new Set(shown.flatMap((p) => p.edges)), flows: new Set() }
  }
  if (!reach) return null
  const inside = (e: { from: string; to: string }) => reach.has(e.from) && reach.has(e.to)
  return {
    nodes: new Set(reach.keys()),
    edges: new Set(view.edges.filter(inside).map((e) => e.id)),
    flows: new Set(view.flows.filter(inside).map((f) => f.id)),
  }
}

/** One layer of what's lit, outermost first, for the panel's "Lit by" trail. */
export type LitBy = { kind: 'time' } | { kind: 'pipeline'; id: string } | { kind: 'focus'; id: string } | { kind: 'path' }

export function litBy(s: {
  time: { open: boolean }
  lensPipeline: string | null
  focusedId: string | null
  pathOpen: boolean
  pathEnds: [string | null, string | null]
}): LitBy[] {
  const out: LitBy[] = []
  if (s.time.open) out.push({ kind: 'time' })
  if (s.lensPipeline) out.push({ kind: 'pipeline', id: s.lensPipeline })
  if (s.focusedId) out.push({ kind: 'focus', id: s.focusedId })
  if (s.pathOpen && s.pathEnds[0] && s.pathEnds[1]) out.push({ kind: 'path' })
  return out
}
