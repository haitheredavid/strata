import type { CameraPreset } from '../../store'
import type { Layout, ModeId } from '../../model/types'
import type { ViewGraph } from '../../view/deriveView'
import type { Hop } from '../../view/hops'

export type V3 = [number, number, number]

/**
 * Card orientation: `flat` faces +Y (lies on a layer), `upright` faces +Z, `side` faces +X (a slab in a
 * left-to-right row), `billboard` faces the camera.
 */
export type Frame = 'flat' | 'upright' | 'side' | 'billboard'

export interface NodePlace {
  p: V3
  frame: Frame
  /** Nodes sharing a plate are wired with in-plane arcs. */
  plateId?: string
  /** Pushed to the background (e.g. outside the orbit's hop range). */
  faded?: boolean
}

export interface PlatePlace {
  id: string
  center: V3
  size: [number, number]
  frame: Exclude<Frame, 'billboard'>
  label: string
  color: string
}

export interface Ring { y: number; r: number }

export interface Placement {
  nodes: Record<string, NodePlace>
  plates: PlatePlace[]
  rings?: Ring[]
}

export interface ModeCtx {
  focusedId: string | null
  /** Directional hop map around the focused node, if any. */
  hops: Map<string, Hop> | null
  hopUp: number
  hopDown: number
}

export interface Mode {
  id: ModeId
  label: string
  draggable: boolean
  defaultPreset: CameraPreset
  /** Labels for the layer panel. */
  gapLabel: string
  place(view: ViewGraph, layout: Layout, ctx: ModeCtx): Placement
}
