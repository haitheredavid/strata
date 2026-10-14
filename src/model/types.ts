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
  /** With lineage: show the clusters jobs run on (default on). */
  showCompute?: boolean
}
