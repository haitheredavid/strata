import { create } from 'zustand'
import type { ColumnDetail, EdgeLayer, Graph, GroupBy, Layout, ModeId } from './model/types'
import { parseDbml } from './parse/dbml'
import { EMPTY_WORKFLOWS } from './model/workflow'
import { autoLayout } from './layout/autoLayout'
import { MODES } from './layout/modes'
import { flowOrder } from './layout/modes/flow'
import { deriveView } from './view/deriveView'
import { timeClock } from './scene/timeClock'
import { hash32 } from './sim/rng'
import { DAY, simulateDay } from './sim/schedule'
import type { Schedule } from './sim/schedule'
import { isScheme } from './theme/schemes'
import { span } from './dev/perf'
import type { SchemeId } from './theme/schemes'

export type CameraPreset = 'iso' | 'top' | 'side'
export type CameraCommand =
  | { kind: 'preset'; preset: CameraPreset }
  | { kind: 'fly'; tableId: string }
  | { kind: 'frame'; ids: string[] }

interface State {
  schemaKey: string
  graph: Graph
  layout: Layout
  error: string | null
  hoveredTableId: string | null
  focusedTableId: string | null
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
  /** Raw DBML and workflow sidecar text of the loaded schema. */
  source: string
  sidecar: string | null
  /** Pipeline lit by the lens button. */
  lensPipeline: string | null
  time: TimeState
  colorScheme: SchemeId

  /** Load a schema; `sidecar` replaces the saved workflow file for it (null keeps the saved one). */
  loadSchema: (src: string, sidecar?: string | null) => void
  /** Load an already-built graph (e.g. a synthetic one); `key` names its saved layout. */
  loadGraph: (graph: Graph, key: string) => void
  loadSidecar: (text: string) => void
  setLayout: (layout: Layout) => void
  resetLayout: () => void
  setLayerGap: (gap: number) => void
  moveLayer: (layerId: string, delta: -1 | 1) => void
  toggleLayer: (layerId: string) => void
  isolateLayer: (layerId: string | null) => void
  hover: (tableId: string | null) => void
  focus: (tableId: string | null) => void
  setDragging: (v: boolean) => void
  camera: (cmd: CameraCommand) => void
  setMode: (mode: ModeId) => void
  /** Drag a card to a world-space point on its plane; each mode stores it its own way. */
  dragNode: (id: string, p: [number, number, number]) => void
  setHops: (up: number, down: number) => void
  toggleCollapse: (layerId: string) => void
  setColumnDetail: (detail: ColumnDetail) => void
  toggleCard: (tableId: string) => void
  openPath: (open: boolean) => void
  setPathEnd: (i: 0 | 1, id: string | null) => void
  togglePathIgnore: (id: string) => void
  setActivePath: (i: number | null) => void
  setGroupBy: (g: GroupBy) => void
  setEdgeLayer: (e: EdgeLayer) => void
  togglePipeline: (id: string) => void
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

const schedules = new WeakMap<Graph, Schedule>()
/** The simulated day for a graph's workflows (cached per graph). */
export function scheduleFor(graph: Graph): Schedule {
  let s = schedules.get(graph)
  if (!s) schedules.set(graph, (s = span('simulateDay', () => simulateDay(graph.workflows, graph.tables))))
  return s
}

export const modeOf = (layout: Layout): ModeId => layout.mode ?? 'stack'

const EMPTY_GRAPH: Graph = { tables: [], refs: [], layers: [], workflows: EMPTY_WORKFLOWS }

const hash = (s: string) => hash32(s).toString(36)

const storageKey = (schemaKey: string) => `strata:layout:${schemaKey}`
const sidecarKey = (schemaKey: string) => `strata:workflows:${schemaKey}`
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

function loadSavedLayout(schemaKey: string, graph: Graph): Layout | null {
  try {
    const raw = localStorage.getItem(storageKey(schemaKey))
    if (!raw) return null
    return isLayoutFor(JSON.parse(raw), graph) ? JSON.parse(raw) : null
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

/** State for a freshly loaded graph: its saved layout (or a new one) and every per-schema setting reset. */
function installGraph(graph: Graph, schemaKey: string, source: string, sidecar: string | null): Partial<State> {
  const layout = span('autoLayout', () => loadSavedLayout(schemaKey, graph) ?? autoLayout(graph))
  return {
    source,
    sidecar,
    lensPipeline: null,
    time: CLOSED,
    collapsedLayers: [],
    pathOpen: false,
    pathEnds: [null, null],
    pathIgnore: [],
    activePath: null,
    schemaKey,
    graph,
    layout,
    error: null,
    hoveredTableId: null,
    focusedTableId: null,
    hiddenLayers: [],
    isolatedLayerId: null,
    cameraCommand: { kind: 'preset', preset: MODES[modeOf(layout)].defaultPreset, nonce: Date.now() },
  }
}

export const useStore = create<State>((set, get) => ({
  schemaKey: '',
  graph: EMPTY_GRAPH,
  layout: { layerGap: 8, layerOrder: [], positions: {} },
  error: null,
  hoveredTableId: null,
  focusedTableId: null,
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
  source: '',
  sidecar: null,
  lensPipeline: null,
  time: CLOSED,
  colorScheme: savedScheme(),

  loadSchema: (src, sidecarText = null) => {
    const schemaKey = hash(src)
    const sidecar = sidecarText ?? (storage((ls) => ls.getItem(sidecarKey(schemaKey))) as string | null)
    let graph: Graph
    try {
      graph = span('parse', () => parseDbml(src, sidecar))
    } catch (e) {
      const diag = (e as { diags?: { message: string }[] }).diags?.[0]?.message
      set({ error: diag ?? String(e) })
      return
    }
    if (sidecarText) storage((ls) => ls.setItem(sidecarKey(schemaKey), sidecarText))
    set(installGraph(graph, schemaKey, src, sidecar))
  },

  loadGraph: (graph, key) => set(installGraph(graph, hash(key), '', null)),

  loadSidecar: (text) => {
    const { source, schemaKey } = get()
    if (!source) return
    const graph = parseDbml(source, text)
    storage((ls) => ls.setItem(sidecarKey(schemaKey), text))
    set({ graph, sidecar: text, lensPipeline: null, time: CLOSED, error: graph.workflows.pipelines.length ? null : 'No pipelines found in workflow file' })
  },

  setLayout: (layout) => {
    if (!isLayoutFor(layout, get().graph)) {
      set({ error: 'Layout file does not match the loaded schema' })
      return
    }
    set({ layout, error: null })
  },
  resetLayout: () =>
    set((s) => {
      const mode = modeOf(s.layout)
      if (mode === 'flow') return { layout: { ...s.layout, flowOrder: undefined, flowOverrides: undefined } }
      if (mode === 'diagram') return { layout: { ...s.layout, flowOrder: undefined } }
      if (mode === 'stack' && s.layout.groupBy === 'medallion') return { layout: { ...s.layout, medallionPositions: undefined } }
      if (mode === 'stack') return { layout: { ...s.layout, ...autoLayout(s.graph, s.layout.layerGap) } }
      return s
    }),
  setLayerGap: (layerGap) => set((s) => ({ layout: { ...s.layout, layerGap } })),
  moveLayer: (layerId, delta) =>
    set((s) => {
      if (s.layout.groupBy === 'medallion') return s // bronze → silver → gold is fixed
      const flow = modeOf(s.layout) === 'flow' || modeOf(s.layout) === 'diagram' // diagram shares flow's order
      const order = flow ? flowOrder(deriveView(s.graph), s.layout) : [...s.layout.layerOrder]
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
  hover: (hoveredTableId) => set({ hoveredTableId }),
  focus: (focusedTableId) => set({ focusedTableId }),
  setDragging: (dragging) => set({ dragging }),
  camera: (cmd) => set({ cameraCommand: { ...cmd, nonce: Date.now() } }),
  // The camera stays put across layout switches, so you can watch the cards move.
  setMode: (mode) => set((s) => ({ layout: { ...s.layout, mode } })),
  dragNode: (id, p) =>
    set((s) => {
      const mode = modeOf(s.layout)
      if (id.startsWith('job:')) return s
      if (mode === 'stack' && (s.layout.groupBy === 'medallion' || !s.layout.positions[id]))
        return { layout: { ...s.layout, medallionPositions: { ...s.layout.medallionPositions, [id]: { x: p[0], z: p[2] } } } }
      if (mode === 'stack')
        return { layout: { ...s.layout, positions: { ...s.layout.positions, [id]: { x: p[0], z: p[2] } } } }
      if (mode === 'flow')
        return { layout: { ...s.layout, flowOverrides: { ...s.layout.flowOverrides, [id]: { y: p[1], z: p[2] } } } }
      return s
    }),
  setHops: (hopUp, hopDown) => set({ hopUp: Math.max(0, hopUp), hopDown: Math.max(0, hopDown) }),
  toggleCollapse: (layerId) => set((s) => ({ collapsedLayers: toggle(s.collapsedLayers, layerId), focusedTableId: null })),
  setColumnDetail: (columnDetail) => set((s) => ({ layout: { ...s.layout, columnDetail } })),
  toggleCard: (tableId) =>
    set((s) => ({ layout: { ...s.layout, collapsedCards: toggle(s.layout.collapsedCards ?? [], tableId) } })),
  openPath: (pathOpen) =>
    set((s) => ({
      pathOpen,
      pathEnds: pathOpen ? [s.pathEnds[0] ?? s.focusedTableId, s.pathEnds[1]] : [null, null],
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
  toggleCompute: () => set((s) => ({ layout: { ...s.layout, showCompute: !(s.layout.showCompute ?? true) } })),
  setLens: (lensPipeline) => set({ lensPipeline }),
  openTimeline: (pipelineId) =>
    set((s) => {
      const runs = scheduleFor(s.graph).runs.filter((r) => r.start > 0 || r.end < DAY) // skip all-day streams
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

// Autosave layout per schema.
useStore.subscribe((s, prev) => {
  if (s.layout === prev.layout || !s.schemaKey) return
  try {
    localStorage.setItem(storageKey(s.schemaKey), JSON.stringify(s.layout))
  } catch {
    /* storage unavailable: layout just isn't persisted */
  }
})

/** Whether a layer is currently shown, given hide/isolate state. */
export const layerVisible = (s: Pick<State, 'hiddenLayers' | 'isolatedLayerId'>, layerId: string) =>
  s.isolatedLayerId ? s.isolatedLayerId === layerId : !s.hiddenLayers.includes(layerId)
