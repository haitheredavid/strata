import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MODES } from '../layout/modes'
import type { Placement } from '../layout/modes'
import { placeJobs } from '../layout/modes/jobs'
import { placeClusters } from '../layout/modes/compute'
import { sceneView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { hops } from '../view/hops'
import type { Hop } from '../view/hops'
import { findPaths } from '../view/paths'
import type { Path } from '../view/paths'
import { taskRunsIn } from '../sim/schedule'
import type { Window } from '../sim/schedule'
import { jobNodeId } from '../view/deriveView'
import { modeOf, scheduleFor, useStore, viewInputs } from '../store'
import { span } from '../dev/perf'

export interface Lit {
  nodes: Set<string>
  edges: Set<string>
  flows: Set<string>
}

/** Day timeline highlight for the current window. */
export interface TimeView {
  /** Jobs running at the playhead. */
  active: Set<string>
  /** Other jobs that ran in the window. */
  done: Set<string>
  /** Tables / sources touched by active or done jobs. */
  reached: Set<string>
  pipelines: Set<string>
}

/** Without a span, the playhead looks back this far for recently finished jobs. */
export const RECENT = 3600

export const timeWindow = (t: number, span: [number, number] | null): Window => span ?? [Math.max(0, t - RECENT), t]

export interface SceneModel {
  view: ViewGraph
  placement: Placement
  /** Focus neighborhood, when a visible node is focused. */
  reach: Map<string, Hop> | null
  paths: Path[]
  /** Nodes / edges / flows to light up (timeline > pipeline lens > path finder); null when none applies. */
  lit: Lit | null
  time: TimeView | null
}

/** graph → view: grouping, hide / isolate / collapse / column detail, visible pipelines. */
export function useView(): ViewGraph {
  const s = useStore(useShallow(viewInputs))
  return useMemo(() => span('deriveView', () => sceneView(s)), [s])
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

/** Everything the pipelines touch: their jobs, their reads / writes, and the flows between them. */
function pipelineLit(view: ViewGraph, pipelineIds: Set<string>): Lit {
  const flows = view.flows.filter((f) => pipelineIds.has(f.pipelineId))
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
      timeOpen: s.time.open,
      t: s.time.t,
      span: s.time.span,
      activePath: s.activePath,
    })),
  )
  const { layout } = s

  const focusedNode = s.focused ? view.nodes.find((n) => n.id === s.focused) : undefined
  const focusedCluster = s.focused ? view.clusters.find((c) => c.id === s.focused) : undefined
  const focused = focusedNode?.id ?? focusedCluster?.id ?? null
  const reach = useMemo(() => {
    if (!focused) return null
    const m = new Map<string, Hop>([[focused, { hop: 0, dir: 0 }]])
    if (focusedCluster) {
      // A cluster's neighborhood is the jobs it runs.
      for (const j of focusedCluster.jobs) m.set(j, { hop: 1, dir: -1 })
      return m
    }
    if (focusedNode?.kind !== 'job') return hops(view, focused, s.hopUp, s.hopDown)
    // A job's neighborhood is what it reads (upstream), writes (downstream) and the cluster it runs on.
    for (const f of view.flows) {
      if (f.to === focused) m.set(f.from, { hop: 1, dir: -1 })
      if (f.from === focused) m.set(f.to, { hop: 1, dir: 1 })
    }
    for (const l of view.computeLinks) if (l.job === focused) m.set(l.cluster, { hop: 1, dir: 1 })
    return m
  }, [view, focused, focusedNode?.kind, focusedCluster, s.hopUp, s.hopDown])

  const mode = MODES[modeOf(layout)]
  const placement = useMemo(() => {
    // Layouts only know diagram nodes; a focused cluster doesn't rearrange them.
    const ctx = focusedCluster
      ? { focusedId: null, hops: null, hopUp: s.hopUp, hopDown: s.hopDown }
      : { focusedId: focused, hops: reach, hopUp: s.hopUp, hopDown: s.hopDown }
    const placed = span(`place:${mode.id}`, () => mode.place(view, layout, ctx))
    const withJobs = span('placeJobs', () => placeJobs(view, placed, mode.id, layout.layerGap))
    return span('placeClusters', () => placeClusters(view, withJobs, mode.id, layout.layerGap))
  }, [mode, view, layout, focused, focusedCluster, reach, s.hopUp, s.hopDown],
  )

  const paths = usePaths(view)

  const time = useMemo<TimeView | null>(() => {
    if (!s.timeOpen) return null
    const schedule = scheduleFor(s.graph)
    const lens = (id: string) => !s.lens || id === s.lens
    const active = new Set(taskRunsIn(schedule, [s.t, s.t]).filter((r) => lens(r.pipelineId)).map((r) => jobNodeId(r.taskId)))
    const inWindow = taskRunsIn(schedule, timeWindow(s.t, s.span)).filter((r) => lens(r.pipelineId))
    const done = new Set(inWindow.map((r) => jobNodeId(r.taskId)).filter((id) => !active.has(id)))
    const reached = new Set(
      view.flows.filter((f) => [f.from, f.to].some((id) => active.has(id) || done.has(id))).flatMap((f) => [f.from, f.to]),
    )
    return { active, done, reached, pipelines: new Set(inWindow.map((r) => r.pipelineId)) }
  }, [s.timeOpen, s.graph, s.t, s.span, s.lens, view])

  const lit = useMemo<Lit | null>(() => {
    if (time) return pipelineLit(view, time.pipelines)
    if (s.lens) return pipelineLit(view, new Set([s.lens]))
    if (!paths.length) return null
    const shown = s.activePath !== null && paths[s.activePath] ? [paths[s.activePath]] : paths
    return { nodes: new Set(shown.flatMap((p) => p.nodes)), edges: new Set(shown.flatMap((p) => p.edges)), flows: new Set() }
  }, [time, s.lens, view, paths, s.activePath])

  return { view, placement, reach, paths, lit, time }
}
