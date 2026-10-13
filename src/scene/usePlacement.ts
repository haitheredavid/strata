import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MODES } from '../layout/modes'
import type { Placement } from '../layout/modes'
import { placeJobs } from '../layout/modes/jobs'
import { deriveView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { hops } from '../view/hops'
import type { Hop } from '../view/hops'
import { findPaths } from '../view/paths'
import type { Path } from '../view/paths'
import { runSteps } from '../view/runOrder'
import { modeOf, useStore } from '../store'

export interface Lit {
  nodes: Set<string>
  edges: Set<string>
  flows: Set<string>
}

/** Run playback highlight: jobs of finished steps, of the active step, and the step list. */
export interface RunView {
  steps: string[][] // job node ids per step
  done: Set<string>
  active: Set<string>
  /** Tables / sources touched by finished or active jobs. */
  reached: Set<string>
}

export interface SceneModel {
  view: ViewGraph
  placement: Placement
  /** Focus neighborhood, when a visible node is focused. */
  reach: Map<string, Hop> | null
  paths: Path[]
  /** Nodes / edges / flows to light up (run > pipeline lens > path finder); null when none applies. */
  lit: Lit | null
  run: RunView | null
}

export const lineageOn = (edgeLayer: string | undefined) => edgeLayer !== 'fk'

/** graph → view: grouping, hide / isolate / collapse / column detail, visible pipelines. */
export function useView(): ViewGraph {
  const s = useStore(
    useShallow((s) => ({
      graph: s.graph,
      columnDetail: s.layout.columnDetail,
      collapsedCards: s.layout.collapsedCards,
      groupBy: s.layout.groupBy,
      edgeLayer: s.layout.edgeLayer,
      hiddenPipelines: s.layout.hiddenPipelines,
      hiddenLayers: s.hiddenLayers,
      isolatedLayerId: s.isolatedLayerId,
      collapsedLayers: s.collapsedLayers,
    })),
  )
  return useMemo(() => {
    const ids = deriveView(s.graph, { groupBy: s.groupBy, lineage: lineageOn(s.edgeLayer) }).layers.map((l) => l.id)
    const hidden = s.isolatedLayerId ? ids.filter((id) => id !== s.isolatedLayerId) : s.hiddenLayers
    return deriveView(s.graph, {
      hiddenLayers: hidden,
      collapsedLayers: s.collapsedLayers,
      columnDetail: s.columnDetail,
      collapsedCards: s.collapsedCards,
      groupBy: s.groupBy,
      lineage: lineageOn(s.edgeLayer),
      hiddenPipelines: s.hiddenPipelines,
    })
  }, [s.graph, s.groupBy, s.edgeLayer, s.isolatedLayerId, s.hiddenLayers, s.collapsedLayers, s.columnDetail, s.collapsedCards, s.hiddenPipelines])
}

/** Join paths for the path finder. */
export function usePaths(view: ViewGraph): Path[] {
  const s = useStore(useShallow((s) => ({ open: s.pathOpen, ends: s.pathEnds, ignore: s.pathIgnore })))
  const [a, b] = s.ends
  return useMemo(
    () => (s.open && a && b ? findPaths(view, a, b, { ignore: s.ignore }) : []),
    [view, s.open, a, b, s.ignore],
  )
}

/** Everything a pipeline touches: its jobs, their reads / writes, and the flows between them. */
function pipelineLit(view: ViewGraph, pipelineId: string): Lit {
  const flows = view.flows.filter((f) => f.pipelineId === pipelineId)
  const nodes = new Set(flows.flatMap((f) => [f.from, f.to]))
  return { nodes, edges: new Set(), flows: new Set(flows.map((f) => f.id)) }
}

/** view → mode placement (+ jobs), plus focus, path, lens and run highlights. */
export function useSceneModel(): SceneModel {
  const view = useView()
  const s = useStore(
    useShallow((s) => ({
      layout: s.layout,
      graph: s.graph,
      focused: s.focusedTableId,
      hopUp: s.hopUp,
      hopDown: s.hopDown,
      lens: s.lensPipeline,
      runPipeline: s.run?.pipelineId ?? null,
      runStep: s.run?.step ?? 0,
      activePath: s.activePath,
    })),
  )
  const { layout } = s

  const focusedNode = s.focused ? view.nodes.find((n) => n.id === s.focused) : undefined
  const focused = focusedNode ? focusedNode.id : null
  const reach = useMemo(() => {
    if (!focused) return null
    if (focusedNode?.kind !== 'job') return hops(view, focused, s.hopUp, s.hopDown)
    // A job's neighborhood is what it reads (upstream) and writes (downstream).
    const m = new Map<string, Hop>([[focused, { hop: 0, dir: 0 }]])
    for (const f of view.flows) {
      if (f.to === focused) m.set(f.from, { hop: 1, dir: -1 })
      if (f.from === focused) m.set(f.to, { hop: 1, dir: 1 })
    }
    return m
  }, [view, focused, focusedNode?.kind, s.hopUp, s.hopDown])

  const mode = MODES[modeOf(layout)]
  const placement = useMemo(
    () =>
      placeJobs(
        view,
        mode.place(view, layout, { focusedId: focused, hops: reach, hopUp: s.hopUp, hopDown: s.hopDown }),
        mode.id,
        layout.layerGap,
      ),
    [mode, view, layout, focused, reach, s.hopUp, s.hopDown],
  )

  const paths = usePaths(view)

  const run = useMemo<RunView | null>(() => {
    const p = s.runPipeline ? s.graph.workflows.pipelines.find((x) => x.id === s.runPipeline) : undefined
    if (!p) return null
    const steps = runSteps(p).steps.map((ids) => ids.map((id) => `job:${id}`))
    const done = new Set(steps.slice(0, s.runStep).flat())
    const active = new Set(steps[s.runStep] ?? [])
    const reached = new Set(
      view.flows.filter((f) => done.has(f.from) || done.has(f.to) || active.has(f.from) || active.has(f.to)).flatMap((f) => [f.from, f.to]),
    )
    return { steps, done, active, reached }
  }, [s.graph, s.runPipeline, s.runStep, view])

  const lit = useMemo<Lit | null>(() => {
    if (run && s.runPipeline) return pipelineLit(view, s.runPipeline)
    if (s.lens) return pipelineLit(view, s.lens)
    if (!paths.length) return null
    const shown = s.activePath !== null && paths[s.activePath] ? [paths[s.activePath]] : paths
    return { nodes: new Set(shown.flatMap((p) => p.nodes)), edges: new Set(shown.flatMap((p) => p.edges)), flows: new Set() }
  }, [run, s.runPipeline, s.lens, view, paths, s.activePath])

  return { view, placement, reach, paths, lit, run }
}
