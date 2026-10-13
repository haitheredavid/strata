import { create } from 'zustand'
import type { ColumnDetail, EdgeLayer, Graph, GroupBy, Layout, ModeId } from './model/types'
import { parseDbml } from './parse/dbml'
import { EMPTY_WORKFLOWS } from './model/workflow'
import { autoLayout } from './layout/autoLayout'
import { MODES } from './layout/modes'
import { flowOrder } from './layout/modes/flow'
import { deriveView } from './view/deriveView'
import { runClock } from './scene/runClock'

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
  run: Run | null

  /** Load a schema; `sidecar` replaces the saved workflow file for it (null keeps the saved one). */
  loadSchema: (src: string, sidecar?: string | null) => void
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
  setLens: (id: string | null) => void
  startRun: (pipelineId: string) => void
  updateRun: (patch: Partial<Run>) => void
  stopRun: () => void
}

/** Playback of one pipeline run; `step` is the active step index of its run order. */
export interface Run {
  pipelineId: string
  step: number
  playing: boolean
  speed: number
  follow: boolean
}

export const modeOf = (layout: Layout): ModeId => layout.mode ?? 'stack'

const EMPTY_GRAPH: Graph = { tables: [], refs: [], layers: [], workflows: EMPTY_WORKFLOWS }

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const storageKey = (schemaKey: string) => `strata:layout:${schemaKey}`
const sidecarKey = (schemaKey: string) => `strata:workflows:${schemaKey}`

function storage(op: (ls: Storage) => string | null | void) {
  try {
    return op(localStorage) ?? null
  } catch {
    return null // storage unavailable: nothing is persisted
  }
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
  run: null,

  loadSchema: (src, sidecarText = null) => {
    const schemaKey = hash(src)
    const sidecar = sidecarText ?? (storage((ls) => ls.getItem(sidecarKey(schemaKey))) as string | null)
    let graph: Graph
    try {
      graph = parseDbml(src, sidecar)
    } catch (e) {
      const diag = (e as { diags?: { message: string }[] }).diags?.[0]?.message
      set({ error: diag ?? String(e) })
      return
    }
    if (sidecarText) storage((ls) => ls.setItem(sidecarKey(schemaKey), sidecarText))
    const layout = loadSavedLayout(schemaKey, graph) ?? autoLayout(graph)
    set({
      source: src,
      sidecar,
      lensPipeline: null,
      run: null,
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
    })
  },

  loadSidecar: (text) => {
    const { source, schemaKey } = get()
    if (!source) return
    const graph = parseDbml(source, text)
    storage((ls) => ls.setItem(sidecarKey(schemaKey), text))
    set({ graph, sidecar: text, lensPipeline: null, run: null, error: graph.workflows.pipelines.length ? null : 'No pipelines found in workflow file' })
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
      if (mode === 'stack' && s.layout.groupBy === 'medallion') return { layout: { ...s.layout, medallionPositions: undefined } }
      if (mode === 'stack') return { layout: { ...s.layout, ...autoLayout(s.graph, s.layout.layerGap) } }
      return s
    }),
  setLayerGap: (layerGap) => set((s) => ({ layout: { ...s.layout, layerGap } })),
  moveLayer: (layerId, delta) =>
    set((s) => {
      if (s.layout.groupBy === 'medallion') return s // bronze → silver → gold is fixed
      const flow = modeOf(s.layout) === 'flow'
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
  setMode: (mode) =>
    set((s) => ({
      layout: { ...s.layout, mode },
      cameraCommand: { kind: 'preset', preset: MODES[mode].defaultPreset, nonce: Date.now() },
    })),
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
  setLens: (lensPipeline) => set({ lensPipeline }),
  startRun: (pipelineId) => {
    runClock.t = 0
    set((s) => ({
      run: { pipelineId, step: 0, playing: true, speed: 1, follow: s.run?.follow ?? false },
      lensPipeline: null,
      layout: { ...s.layout, hiddenPipelines: (s.layout.hiddenPipelines ?? []).filter((p) => p !== pipelineId) },
    }))
  },
  updateRun: (patch) => set((s) => (s.run ? { run: { ...s.run, ...patch } } : s)),
  stopRun: () => set({ run: null }),
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
