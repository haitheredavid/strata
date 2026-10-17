import { create } from 'zustand'
import type { ColumnDetail, EdgeLayer, Graph, GroupBy, Layout, ModeId } from './model/types'
import { EMPTY_WORKFLOWS } from './model/workflow'
import { autoLayout } from './layout/autoLayout'
import { layoutAsync } from './layout/layoutClient'
import { seedLayout } from './layout/seedLayout'
import { MODES } from './layout/modes'
import { flowOrder } from './layout/modes/flow'
import { derivedStack } from './layout/modes/stack'
import { layerView, sceneView } from './view/deriveView'
import type { ViewInputs } from './view/deriveView'
import { timeClock } from './scene/timeClock'
import { DAY } from './sim/schedule'
import type { Schedule } from './sim/schedule'
import { isScheme } from './theme/schemes'
import { record, span } from './dev/perf'
import type { SchemeId } from './theme/schemes'
import { normaliseLayout } from './data/dataset'
import type { Dataset } from './data/dataset'

export type CameraPreset = 'iso' | 'top' | 'side'
export type CameraCommand =
  | { kind: 'preset'; preset: CameraPreset }
  | { kind: 'fly'; id: string }
  | { kind: 'frame'; ids: string[] }

/** Something the user should know: a failed load, storage trouble, a dataset's warnings. */
export interface Notice {
  id: number
  level: 'error' | 'warning'
  text: string
  detail?: string[]
  /** About the loaded dataset: replaced when another one loads. */
  dataset?: boolean
  /** Show the detail expanded. */
  open?: boolean
}

interface State {
  /** The loaded dataset; `graph` is its graph (kept at the top level for the many readers). */
  dataset: Dataset | null
  graph: Graph
  layout: Layout
  notices: Notice[]
  /** What the app is busy with (opening a file, laying out), or null. */
  status: string | null
  hoveredId: string | null
  focusedId: string | null
  hiddenLayers: string[]
  isolatedLayerId: string | null
  dragging: boolean
  cameraCommand: (CameraCommand & { nonce: number }) | null
  hopUp: number
  hopDown: number
  collapsedLayers: string[]
  pathOpen: boolean
  pathEnds: [string | null, string | null]
  pathIgnore: string[]
  activePath: number | null
  /** Pipeline lit by the lens button. */
  lensPipeline: string | null
  time: TimeState
  colorScheme: SchemeId

  /** Install a dataset: its saved layout (or a new one), with the per-dataset view state reset. */
  load: (dataset: Dataset) => void
  notify: (level: Notice['level'], text: string, detail?: string[]) => void
  dismiss: (id: number) => void
  setStatus: (status: string | null) => void
  /** Bring back the dataset's warnings notice, expanded. */
  showDatasetWarnings: () => void
  setLayout: (layout: Layout) => void
  resetLayout: () => void
  setLayerGap: (gap: number) => void
  moveLayer: (layerId: string, delta: -1 | 1) => void
  toggleLayer: (layerId: string) => void
  isolateLayer: (layerId: string | null) => void
  hover: (id: string | null) => void
  focus: (id: string | null) => void
  setDragging: (v: boolean) => void
  camera: (cmd: CameraCommand) => void
  setMode: (mode: ModeId) => void
  /** Drag a card to a world-space point on its plane; each mode stores it its own way. */
  dragNode: (id: string, p: [number, number, number]) => void
  setHops: (up: number, down: number) => void
  toggleCollapse: (layerId: string) => void
  setColumnDetail: (detail: ColumnDetail) => void
  toggleCard: (id: string) => void
  openPath: (open: boolean) => void
  setPathEnd: (i: 0 | 1, id: string | null) => void
  togglePathIgnore: (id: string) => void
  setActivePath: (i: number | null) => void
  setGroupBy: (g: GroupBy) => void
  setEdgeLayer: (e: EdgeLayer) => void
  togglePipeline: (id: string) => void
  /** Show only this pipeline; again to show them all. */
  soloPipeline: (id: string) => void
  setHiddenPipelines: (ids: string[]) => void
  togglePipelineTablesOnly: () => void
  toggleCompute: () => void
  setLens: (id: string | null) => void
  /** Open the day timeline; with a pipeline, light it up and jump to its first run. */
  openTimeline: (pipelineId?: string) => void
  setTime: (patch: Partial<TimeState>) => void
  closeTimeline: () => void
  setColorScheme: (scheme: SchemeId) => void
}

/**
 * The simulated day's playhead. `t` (seconds since 00:00) is published when the set of running jobs
 * changes or on a seek; the per-frame position lives in `timeClock`. A span filters the scene to a window.
 */
export interface TimeState {
  open: boolean
  t: number
  span: [number, number] | null
  playing: boolean
  /** Simulated seconds per real second. */
  speed: number
  follow: boolean
}

export const TIME_SPEEDS = [600, 1800, 7200]
const CLOSED: TimeState = { open: false, t: 0, span: null, playing: false, speed: 1800, follow: false }

const NO_RUNS: Schedule = { runs: [], taskRuns: [], events: [] }
/** The loaded dataset's day of runs: a snapshot's real runs, else the simulated day. */
export const scheduleOf = (s: State): Schedule => s.dataset?.schedule ?? NO_RUNS

export const modeOf = (layout: Layout): ModeId => layout.mode ?? 'stack'

/** A layout change, re-framing the camera when the pipeline table filter changes which tables show. */
function reframed(layout: Layout, force = false) {
  if (!layout.pipelineTablesOnly && !force) return { layout }
  return { layout, cameraCommand: { kind: 'preset' as const, preset: MODES[modeOf(layout)].defaultPreset, nonce: Date.now() } }
}

/** The store fields `sceneView` reads; the scene and the store's layout actions share it. */
export const viewInputs = (s: State): ViewInputs => ({
  graph: s.graph,
  columnDetail: s.layout.columnDetail,
  collapsedCards: s.layout.collapsedCards,
  groupBy: s.layout.groupBy,
  edgeLayer: s.layout.edgeLayer,
  hiddenPipelines: s.layout.hiddenPipelines,
  pipelineTablesOnly: s.layout.pipelineTablesOnly,
  showCompute: s.layout.showCompute,
  hiddenLayers: s.hiddenLayers,
  isolatedLayerId: s.isolatedLayerId,
  collapsedLayers: s.collapsedLayers,
})

/** Tables above which a fresh layout starts with header-only cards and only the tables pipelines touch. */
export const LARGE_GRAPH = 150

function largeDefaults(graph: Graph, layout: Layout): Layout {
  if (graph.tables.length <= LARGE_GRAPH) return layout
  return { ...layout, columnDetail: 'header', pipelineTablesOnly: graph.workflows.pipelines.length > 0 }
}

const EMPTY_GRAPH: Graph = { tables: [], refs: [], layers: [], workflows: EMPTY_WORKFLOWS }

const storageKey = (layoutKey: string) => `strata:layout:${layoutKey}`
const SCHEME_KEY = 'strata:scheme'

function storage(op: (ls: Storage) => string | null | void) {
  try {
    return op(localStorage) ?? null
  } catch {
    return null // storage unavailable: nothing is persisted
  }
}

function savedScheme(): SchemeId {
  const v = storage((ls) => ls.getItem(SCHEME_KEY))
  return isScheme(v) ? v : 'default'
}

function loadSavedLayout(layoutKey: string, graph: Graph): Layout | null {
  try {
    const raw = localStorage.getItem(storageKey(layoutKey))
    if (!raw) return null
    const layout: Layout = JSON.parse(raw)
    return isLayoutFor(layout, graph) ? layout : null
  } catch {
    return null
  }
}

/** True when a layout covers every table and layer of the graph. */
export function isLayoutFor(layout: Layout, graph: Graph) {
  return (
    !!layout?.positions &&
    graph.tables.every((t) => layout.positions[t.id]) &&
    graph.layers.length === layout.layerOrder?.length &&
    graph.layers.every((l) => layout.layerOrder.includes(l.id))
  )
}

/** Up to this many tables, lay out on the main thread so a load shows the final layout at once. */
const SYNC_LAYOUT_MAX = 300

/**
 * A fresh stack layout for `graph`. Small graphs get `autoLayout` right away; big ones get an instant
 * spiral seed while the force layout runs in a worker (shown as the status), then the cards ease to
 * the result (unless the dataset changed or a card was dragged meanwhile).
 */
function freshLayout(graph: Graph, layoutKey: string, layerGap = 8): Layout {
  if (graph.tables.length <= SYNC_LAYOUT_MAX) return span('autoLayout', () => autoLayout(graph, layerGap))
  const seed = seedLayout(graph, layerGap)
  const started = performance.now()
  const status = `Laying out ${graph.tables.length.toLocaleString()} tables…`
  useStore.setState({ status })
  void layoutAsync(graph, layerGap)
    .then((positions) => {
      record('autoLayout:worker', performance.now() - started, started)
      const s = useStore.getState()
      if (!positions || s.dataset?.layoutKey !== layoutKey || s.layout.positions !== seed.positions) return
      useStore.setState({ layout: { ...s.layout, positions } })
    })
    .finally(() => {
      if (useStore.getState().status === status) useStore.setState({ status: null })
    })
  return seed
}

let noticeSeq = 0

function warningsNotice(d: Dataset, open: boolean): Notice {
  const n = d.warnings.length
  return { id: ++noticeSeq, level: 'warning', text: `${d.label}: ${n} warning${n > 1 ? 's' : ''}`, detail: d.warnings, dataset: true, open }
}

export const useStore = create<State>((set, get) => ({
  dataset: null,
  graph: EMPTY_GRAPH,
  layout: { layerGap: 8, layerOrder: [], positions: {} },
  notices: [],
  status: null,
  hoveredId: null,
  focusedId: null,
  hiddenLayers: [],
  isolatedLayerId: null,
  dragging: false,
  cameraCommand: null,
  hopUp: 1,
  hopDown: 1,
  collapsedLayers: [],
  pathOpen: false,
  pathEnds: [null, null],
  pathIgnore: [],
  activePath: null,
  lensPipeline: null,
  time: CLOSED,
  colorScheme: savedScheme(),

  load: (d) => {
    flushSave()
    const s = get()
    // The same schema again (e.g. with a new workflow file) keeps the view; another one starts afresh.
    const same = s.dataset?.layoutKey === d.layoutKey
    let layout = same ? s.layout : loadSavedLayout(d.layoutKey, d.graph)
    if (!layout) {
      const fresh = freshLayout(d.graph, d.layoutKey)
      layout = d.source.origin === 'synth' ? fresh : largeDefaults(d.graph, fresh)
    }
    const notices = s.notices.filter((n) => !n.dataset)
    if (d.warnings.length) notices.push(warningsNotice(d, false))
    set({
      dataset: d,
      graph: d.graph,
      layout: normaliseLayout(layout, d.graph),
      notices,
      lensPipeline: null,
      time: CLOSED,
      pathOpen: false,
      pathEnds: [null, null],
      pathIgnore: [],
      activePath: null,
      ...(same
        ? {}
        : {
            collapsedLayers: [],
            hoveredId: null,
            focusedId: null,
            hiddenLayers: [],
            isolatedLayerId: null,
            cameraCommand: { kind: 'preset', preset: MODES[modeOf(layout)].defaultPreset, nonce: Date.now() },
          }),
    })
  },
  notify: (level, text, detail) => set((s) => ({ notices: [...s.notices, { id: ++noticeSeq, level, text, detail }] })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setStatus: (status) => set({ status }),
  showDatasetWarnings: () =>
    set((s) => (s.dataset?.warnings.length ? { notices: [...s.notices.filter((n) => !n.dataset), warningsNotice(s.dataset, true)] } : s)),

  setLayout: (layout) => {
    if (!isLayoutFor(layout, get().graph)) return get().notify('error', 'That layout file is for a different schema')
    set({ layout })
  },
  resetLayout: () => {
    const s = get()
    const mode = modeOf(s.layout)
    if (mode === 'flow') set({ layout: { ...s.layout, flowOrder: undefined, flowOverrides: undefined } })
    else if (mode === 'diagram') set({ layout: { ...s.layout, flowOrder: undefined } })
    else if (mode === 'stack' && derivedStack(s.layout, sceneView(viewInputs(s)))) set({ layout: { ...s.layout, medallionPositions: undefined } })
    else if (mode === 'stack' && s.dataset) set({ layout: { ...s.layout, ...freshLayout(s.graph, s.dataset.layoutKey, s.layout.layerGap) } })
  },
  setLayerGap: (layerGap) => set((s) => ({ layout: { ...s.layout, layerGap } })),
  moveLayer: (layerId, delta) =>
    set((s) => {
      if (s.layout.groupBy === 'medallion') return s // bronze → silver → gold is fixed
      const flow = modeOf(s.layout) === 'flow' || modeOf(s.layout) === 'diagram' // diagram shares flow's order
      const order = flow ? flowOrder(layerView(viewInputs(s)), s.layout) : [...s.layout.layerOrder]
      const i = order.indexOf(layerId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= order.length) return s
      ;[order[i], order[j]] = [order[j], order[i]]
      return { layout: { ...s.layout, [flow ? 'flowOrder' : 'layerOrder']: order } }
    }),
  toggleLayer: (layerId) =>
    set((s) => ({
      hiddenLayers: s.hiddenLayers.includes(layerId)
        ? s.hiddenLayers.filter((l) => l !== layerId)
        : [...s.hiddenLayers, layerId],
    })),
  isolateLayer: (isolatedLayerId) => set({ isolatedLayerId }),
  hover: (hoveredId) => set({ hoveredId }),
  focus: (focusedId) => set({ focusedId }),
  setDragging: (dragging) => set({ dragging }),
  camera: (cmd) => set({ cameraCommand: { ...cmd, nonce: Date.now() } }),
  // The camera stays put across layout switches, so you can watch the cards move.
  setMode: (mode) => set((s) => ({ layout: { ...s.layout, mode } })),
  dragNode: (id, p) =>
    set((s) => {
      const mode = modeOf(s.layout)
      if (id.startsWith('job:')) return s
      if (mode === 'stack' && (!s.layout.positions[id] || derivedStack(s.layout, sceneView(viewInputs(s)))))
        return { layout: { ...s.layout, medallionPositions: { ...s.layout.medallionPositions, [id]: { x: p[0], z: p[2] } } } }
      if (mode === 'stack')
        return { layout: { ...s.layout, positions: { ...s.layout.positions, [id]: { x: p[0], z: p[2] } } } }
      if (mode === 'flow')
        return { layout: { ...s.layout, flowOverrides: { ...s.layout.flowOverrides, [id]: { y: p[1], z: p[2] } } } }
      return s
    }),
  setHops: (hopUp, hopDown) => set({ hopUp: Math.max(0, hopUp), hopDown: Math.max(0, hopDown) }),
  toggleCollapse: (layerId) => set((s) => ({ collapsedLayers: toggle(s.collapsedLayers, layerId), focusedId: null })),
  setColumnDetail: (columnDetail) => set((s) => ({ layout: { ...s.layout, columnDetail } })),
  toggleCard: (id) =>
    set((s) => ({ layout: { ...s.layout, collapsedCards: toggle(s.layout.collapsedCards ?? [], id) } })),
  openPath: (pathOpen) =>
    set((s) => ({
      pathOpen,
      pathEnds: pathOpen ? [s.pathEnds[0] ?? s.focusedId, s.pathEnds[1]] : [null, null],
      activePath: null,
    })),
  setPathEnd: (i, id) =>
    set((s) => {
      const pathEnds: [string | null, string | null] = [...s.pathEnds]
      pathEnds[i] = id
      return { pathEnds, pathOpen: true, activePath: null }
    }),
  togglePathIgnore: (id) => set((s) => ({ pathIgnore: toggle(s.pathIgnore, id), activePath: null })),
  setActivePath: (activePath) => set({ activePath }),
  setGroupBy: (groupBy) =>
    set((s) => ({
      layout: { ...s.layout, groupBy },
      hiddenLayers: [],
      isolatedLayerId: null,
      collapsedLayers: [],
      cameraCommand: { kind: 'preset', preset: MODES[modeOf(s.layout)].defaultPreset, nonce: Date.now() },
    })),
  setEdgeLayer: (edgeLayer) => set((s) => ({ layout: { ...s.layout, edgeLayer } })),
  togglePipeline: (id) =>
    set((s) => ({ layout: { ...s.layout, hiddenPipelines: toggle(s.layout.hiddenPipelines ?? [], id) } })),
  soloPipeline: (id) =>
    set((s) => {
      const others = s.graph.workflows.pipelines.map((p) => p.id).filter((p) => p !== id)
      const solo = others.every((p) => s.layout.hiddenPipelines?.includes(p)) && !s.layout.hiddenPipelines?.includes(id)
      return reframed({ ...s.layout, hiddenPipelines: solo ? [] : others })
    }),
  setHiddenPipelines: (hiddenPipelines) => set((s) => reframed({ ...s.layout, hiddenPipelines })),
  togglePipelineTablesOnly: () => set((s) => reframed({ ...s.layout, pipelineTablesOnly: !s.layout.pipelineTablesOnly }, true)),
  toggleCompute: () => set((s) => ({ layout: { ...s.layout, showCompute: !(s.layout.showCompute ?? true) } })),
  setLens: (lensPipeline) => set({ lensPipeline }),
  openTimeline: (pipelineId) =>
    set((s) => {
      const runs = scheduleOf(s).runs.filter((r) => r.start > 0 || r.end < DAY) // skip all-day streams
      const first = pipelineId ? runs.find((r) => r.pipelineId === pipelineId) : runs[0]
      const t = first ? Math.max(0, first.start - 300) : s.time.open ? s.time.t : 0
      timeClock.t = t
      return {
        time: { ...s.time, open: true, t, span: null, playing: !!pipelineId },
        lensPipeline: pipelineId ?? null,
        layout: pipelineId
          ? { ...s.layout, hiddenPipelines: (s.layout.hiddenPipelines ?? []).filter((p) => p !== pipelineId) }
          : s.layout,
      }
    }),
  setTime: (patch) =>
    set((s) => {
      if (patch.t !== undefined) timeClock.t = patch.t
      return { time: { ...s.time, ...patch } }
    }),
  closeTimeline: () => set((s) => ({ time: { ...s.time, open: false, playing: false } })),
  setColorScheme: (colorScheme) => {
    storage((ls) => ls.setItem(SCHEME_KEY, colorScheme))
    set({ colorScheme })
  },
}))

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

// Autosave layout per schema, debounced and off the busy path: a slider drag changes the layout every
// frame, and stringifying a big layout each time stalls the drag.
const SAVE_DELAY = 500
let saveTimer: ReturnType<typeof setTimeout> | undefined
let pending: { layoutKey: string; layout: Layout } | null = null
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : fn())
function flushSave() {
  if (!pending) return
  const { layoutKey, layout } = pending
  pending = null
  try {
    localStorage.setItem(storageKey(layoutKey), JSON.stringify(layout))
  } catch {
    /* storage unavailable: layout just isn't persisted */
  }
}
useStore.subscribe((s, prev) => {
  const layoutKey = s.dataset?.layoutKey
  if (s.layout === prev.layout || !layoutKey) return
  if (pending && pending.layoutKey !== layoutKey) flushSave() // switching dataset: keep the old one's edits
  pending = { layoutKey, layout: s.layout }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => idle(flushSave), SAVE_DELAY)
})
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSave)
