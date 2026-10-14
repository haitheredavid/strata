import type { ModeId } from '../../model/types'
import { diagramMode } from './diagram'
import { flowMode } from './flow'
import { orbitMode } from './orbit'
import { stackMode } from './stack'
import type { Mode } from './types'

export const MODES: Record<ModeId, Mode> = { stack: stackMode, flow: flowMode, orbit: orbitMode, diagram: diagramMode }
export const MODE_IDS: ModeId[] = ['stack', 'flow', 'orbit', 'diagram']

export type { Frame, Mode, ModeCtx, NodePlace, Placement, PlatePlace, Ring, V3 } from './types'
