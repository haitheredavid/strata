import type { Medallion, Workflows } from './workflow'

export interface Column {
  name: string
  type: string
  pk: boolean
  fk: boolean
}

export interface Table {
  id: string
  name: string
  layerId: string
  columns: Column[]
  medallion?: Medallion
  note?: string
}

export interface RefEnd {
  table: string
  columns: string[]
}

export type RefKind = '1-1' | '1-n' | 'n-1' | 'n-n'

export interface Ref {
  id: string
  from: RefEnd
  to: RefEnd
  kind: RefKind
}

export interface Layer {
  id: string
  name: string
  color: string
}

export interface Graph {
  tables: Table[]
  refs: Ref[]
  layers: Layer[]
  workflows: Workflows
}

export interface Vec2 {
  x: number
  z: number
}

export type ModeId = 'stack' | 'flow' | 'orbit' | 'diagram'
export type ColumnDetail = 'all' | 'keys' | 'header'
export type GroupBy = 'domain' | 'medallion'
export type EdgeLayer = 'fk' | 'lineage' | 'both'

export interface Layout {
  layerGap: number
  layerOrder: string[]
  /** Stack mode: in-plane card centers. */
  positions: Record<string, Vec2>
  mode?: ModeId
  /** Flow mode: domain column order, left to right. Falls back to FK rank. */
  flowOrder?: string[]
  /** Flow mode: dragged card centers on their domain slab. */
  flowOverrides?: Record<string, { y: number; z: number }>
  columnDetail?: ColumnDetail
  /** Cards collapsed to their header (double-click). */
  collapsedCards?: string[]
  groupBy?: GroupBy
  edgeLayer?: EdgeLayer
  /** Stack mode with medallion grouping: dragged card centers. */
  medallionPositions?: Record<string, Vec2>
  hiddenPipelines?: string[]
  /** The one pipeline shown ("only this"); hiddenPipelines is kept for when it's cleared. */
  onlyPipeline?: string
  /** Hidden layers of the current grouping (domains, or medallion layers). */
  hiddenLayers?: string[]
  /** The one layer shown ("only this"); hiddenLayers is kept for when it's cleared. */
  onlyLayer?: string
  /** Layers folded into a single card. */
  collapsedLayers?: string[]
  /** With lineage: show only tables the visible pipelines read or write. */
  pipelineTablesOnly?: boolean
  /** With lineage: show the clusters jobs run on (default on). */
  showCompute?: boolean
  /** Saved scenes to step through, in order. Kept with the layout, so they save, export and import with it. */
  story?: StoryScene[]
}

/** The layout fields a story scene sets: what's drawn and how, not where cards sit. */
export const SCENE_VIEW_KEYS = [
  'mode',
  'groupBy',
  'edgeLayer',
  'columnDetail',
  'collapsedCards',
  'hiddenLayers',
  'onlyLayer',
  'collapsedLayers',
  'hiddenPipelines',
  'onlyPipeline',
  'pipelineTablesOnly',
  'showCompute',
] as const satisfies readonly (keyof Layout)[]

/** Where the camera looks from: its target, and the eye's offset from it for a 45° lens. */
export interface CameraPose {
  target: [number, number, number]
  offset: [number, number, number]
}

/** Everything a scene puts back: view settings, the selection (or join path), the Day timeline, the camera. */
export interface SceneState {
  view: Pick<Layout, (typeof SCENE_VIEW_KEYS)[number]>
  focusedId: string | null
  lensPipeline: string | null
  hops: [number, number]
  /** The join path finder: its ends, avoided tables and picked path. Null when it's closed. */
  path: { ends: [string | null, string | null]; ignore: string[]; active: number | null } | null
  /** The Day timeline's playhead and span. Null when it's closed. */
  time: { t: number; span: [number, number] | null } | null
  camera: CameraPose | null
}

/** One step of a story: a title and a note to tell it, and the state it shows. */
export interface StoryScene {
  id: string
  title: string
  note: string
  state: SceneState
}
