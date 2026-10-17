import { useEffect, useMemo, useReducer } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MODES } from '../layout/modes'
import type { Placement } from '../layout/modes'
import { placeJobs } from '../layout/modes/jobs'
import { placeClusters } from '../layout/modes/compute'
import { needsWorkerLayout } from '../layout/modes/stack'
import { cachedViewLayout, storeViewLayout, viewLayoutGraph } from '../layout/autoLayout'
import { viewLayoutAsync } from '../layout/layoutClient'
import type { Layout } from '../model/types'
import { sceneView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { hops } from '../view/hops'
import type { Hop } from '../view/hops'
import { findPaths } from '../view/paths'
import type { Path } from '../view/paths'
import { taskRunsIn } from '../sim/schedule'
import type { Window } from '../sim/schedule'
import { jobNodeId } from '../view/deriveView'
import { probeLit, scopeLit } from '../view/highlight'
import type { Highlight } from '../view/highlight'
import { modeOf, scheduleOf, useStore, viewInputs } from '../store'
import { span } from '../dev/perf'

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
  /** Focus neighborhood, when a visible node is focused (drives orbit and flow placement too). */
  reach: Map<string, Hop> | null
  paths: Path[]
  /** What's lit: a scope (timeline / pipeline lens) and a probe (path / focus) drilling into it. */
  highlight: Highlight
  time: TimeView | null
}

/** graph → view: grouping, hide / only / collapse / column detail, visible pipelines. */
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

/**
 * A big derived stack (the tables in visible pipelines, past what lays out at once) is laid out in a
 * worker; until it lands the stack keeps the full layout's positions. Returns a revision that bumps when
 * a worker layout arrives, for the placement to re-run.
 */
function useWorkerLayout(view: ViewGraph, layout: Layout): number {
  const [revision, bump] = useReducer((n: number) => n + 1, 0)
  const wanted = modeOf(layout) === 'stack' && needsWorkerLayout(layout, view) && !cachedViewLayout(view)
  useEffect(() => {
    if (!wanted) return
    let live = true
    const status = `Laying out the ${view.nodes.filter((n) => n.kind === 'table').length} tables in visible pipelines…`
    useStore.getState().setStatus(status)
    void viewLayoutAsync(viewLayoutGraph(view), 8)
      .then((positions) => {
        if (!live || !positions) return
        storeViewLayout(view, positions)
        bump()
      })
      .finally(() => {
        if (useStore.getState().status === status) useStore.getState().setStatus(null)
      })
    return () => {
      live = false
    }
  }, [wanted, view])
  return revision
}

/** view → mode placement (+ jobs), plus focus, path, lens and run highlights. */
export function useSceneModel(): SceneModel {
  const view = useView()
  const s = useStore(
    useShallow((s) => ({
      layout: s.layout,
      schedule: scheduleOf(s),
      focused: s.focusedId,
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
  const workerLayout = useWorkerLayout(view, layout)
  const placement = useMemo(() => {
    // Layouts only know diagram nodes; a focused cluster doesn't rearrange them.
    const ctx = focusedCluster
      ? { focusedId: null, hops: null, hopUp: s.hopUp, hopDown: s.hopDown }
      : { focusedId: focused, hops: reach, hopUp: s.hopUp, hopDown: s.hopDown }
    const placed = span(`place:${mode.id}`, () => mode.place(view, layout, ctx))
    const withJobs = span('placeJobs', () => placeJobs(view, placed, mode.id, layout.layerGap))
    return span('placeClusters', () => placeClusters(view, withJobs, mode.id, layout.layerGap))
    // workerLayout: re-place once a big derived stack's worker layout lands in the view-layout cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, view, layout, focused, focusedCluster, reach, s.hopUp, s.hopDown, workerLayout],
  )

  const paths = usePaths(view)

  const time = useMemo<TimeView | null>(() => {
    if (!s.timeOpen) return null
    const lens = (id: string) => !s.lens || id === s.lens
    const active = new Set(taskRunsIn(s.schedule, [s.t, s.t]).filter((r) => lens(r.pipelineId)).map((r) => jobNodeId(r.taskId)))
    const inWindow = taskRunsIn(s.schedule, timeWindow(s.t, s.span)).filter((r) => lens(r.pipelineId))
    const done = new Set(inWindow.map((r) => jobNodeId(r.taskId)).filter((id) => !active.has(id)))
    const reached = new Set(
      view.flows.filter((f) => [f.from, f.to].some((id) => active.has(id) || done.has(id))).flatMap((f) => [f.from, f.to]),
    )
    return { active, done, reached, pipelines: new Set(inWindow.map((r) => r.pipelineId)) }
  }, [s.timeOpen, s.schedule, s.t, s.span, s.lens, view])

  // Separate memos: the timeline republishes the scope often; the probe only changes with focus / paths.
  const scope = useMemo(() => scopeLit(view, time?.pipelines ?? null, s.lens), [view, time, s.lens])
  const probe = useMemo(() => probeLit(view, reach, paths, s.activePath), [view, reach, paths, s.activePath])
  const highlight = useMemo<Highlight>(() => ({ scope, probe }), [scope, probe])

  return { view, placement, reach, paths, highlight, time }
}
