import type { Frame, Placement } from '../layout/modes'
import { CARD_W, anchorY, cardDepth } from '../layout/geometry'
import type { ViewGraph, ViewNode } from '../view/deriveView'
import { anim, animState } from '../scene/anim'

/**
 * The scene as flat typed arrays, ECS style: one dense index per node, one per edge, and columns of
 * data per index. Instanced renderers and picking read these; nothing here is per-object JS.
 *
 * Positions and orientations are packed from the animation entries (`anim`), which stay the source
 * of truth while the per-component renderers still exist. `pack()` copies only entries that moved
 * this frame and reports the dirty index range, so an idle frame costs one pass over a stamp array.
 */
export const FRAME_CODE: Record<Frame, number> = { flat: 0, upright: 1, side: 2, billboard: 3 }
export const KIND_CODE = { table: 0, domain: 1, source: 2, job: 3, cluster: 4 } as const
export type KindCode = (typeof KIND_CODE)[keyof typeof KIND_CODE]

/** Rough pick and cull sizes for non-card nodes (local width × height). */
const JOB_SIZE: [number, number] = [1.6, 1.6]
const CLUSTER_SIZE: [number, number] = [2.6, 2.6]

export interface NodeTable {
  count: number
  ids: string[]
  index: Map<string, number>
  kind: Uint8Array
  frame: Uint8Array
  /** xyz per node. */
  pos: Float32Array
  /** xyzw per node. */
  quat: Float32Array
  /** Local width and height per node (a card's height is its depth on its plane). */
  size: Float32Array
  /** `animState.frame` each node was last packed at; -1 before first pack. */
  packedAt: Int32Array
  /** Plate index per node (into `plates`), -1 for none; same-plate wires arc in-plane. */
  plate: Int32Array
  plates: string[]
}

export interface EdgeTable {
  count: number
  ids: string[]
  src: Uint32Array
  dst: Uint32Array
  /** Local Y of the anchor on each end (column row, or the header). */
  anchorY: Float32Array
}

export interface World {
  view: ViewGraph
  nodes: NodeTable
  fk: EdgeTable
  /** Dirty node range from the last `pack()`, inclusive; empty when lo > hi. */
  dirty: { lo: number; hi: number }
  /** `animState.frame` of the last `packOnce`, so several renderers share one pack per frame. */
  packedFrame: number
}

function nodeSize(n: ViewNode | undefined, kind: KindCode): [number, number] {
  if (kind === KIND_CODE.job) return JOB_SIZE
  if (kind === KIND_CODE.cluster || !n) return CLUSTER_SIZE
  return [CARD_W, cardDepth(n)]
}

/** Build the tables for a view and its placement. Cheap enough to redo on any topology change. */
export function buildWorld(view: ViewGraph, placement: Placement): World {
  const byId = new Map(view.nodes.map((n) => [n.id, n]))
  const ids: string[] = []
  for (const n of view.nodes) if (placement.nodes[n.id]) ids.push(n.id)
  for (const c of view.clusters) if (placement.nodes[c.id]) ids.push(c.id)
  const count = ids.length
  const nodes: NodeTable = {
    count,
    ids,
    index: new Map(ids.map((id, i) => [id, i])),
    kind: new Uint8Array(count),
    frame: new Uint8Array(count),
    pos: new Float32Array(count * 3),
    quat: new Float32Array(count * 4),
    size: new Float32Array(count * 2),
    packedAt: new Int32Array(count).fill(-1),
    plate: new Int32Array(count).fill(-1),
    plates: placement.plates.map((p) => p.id),
  }
  const plateIndex = new Map(nodes.plates.map((id, i) => [id, i]))
  ids.forEach((id, i) => {
    const n = byId.get(id)
    const kind = n ? KIND_CODE[n.kind] : KIND_CODE.cluster
    nodes.kind[i] = kind
    nodes.frame[i] = FRAME_CODE[placement.nodes[id].frame]
    const [w, h] = nodeSize(n, kind)
    nodes.size[2 * i] = w
    nodes.size[2 * i + 1] = h
    nodes.quat[4 * i + 3] = 1
    const plateId = placement.nodes[id].plateId
    if (plateId !== undefined) nodes.plate[i] = plateIndex.get(plateId) ?? -1
  })

  const fkIds: string[] = []
  const src: number[] = []
  const dst: number[] = []
  const ay: number[] = []
  for (const e of view.edges) {
    const a = nodes.index.get(e.from)
    const b = nodes.index.get(e.to)
    if (a === undefined || b === undefined) continue
    fkIds.push(e.id)
    src.push(a)
    dst.push(b)
    ay.push(anchorY(byId.get(e.from)!, e.fromColumns[0]), anchorY(byId.get(e.to)!, e.toColumns[0]))
  }
  const fk: EdgeTable = { count: fkIds.length, ids: fkIds, src: Uint32Array.from(src), dst: Uint32Array.from(dst), anchorY: Float32Array.from(ay) }
  return { view, nodes, fk, dirty: { lo: 0, hi: count - 1 }, packedFrame: -1 }
}

/**
 * Copy moved animation entries into the arrays. Returns true when anything changed; `world.dirty`
 * holds the changed index range for partial uploads.
 */
export function pack(world: World): boolean {
  const { nodes, dirty } = world
  dirty.lo = nodes.count
  dirty.hi = -1
  for (let i = 0; i < nodes.count; i++) {
    const e = anim.get(nodes.ids[i])
    if (!e || e.movedAt === nodes.packedAt[i]) continue
    nodes.packedAt[i] = e.movedAt
    nodes.pos[3 * i] = e.pos.x
    nodes.pos[3 * i + 1] = e.pos.y
    nodes.pos[3 * i + 2] = e.pos.z
    nodes.quat[4 * i] = e.quat.x
    nodes.quat[4 * i + 1] = e.quat.y
    nodes.quat[4 * i + 2] = e.quat.z
    nodes.quat[4 * i + 3] = e.quat.w
    if (i < dirty.lo) dirty.lo = i
    dirty.hi = i
  }
  return dirty.lo <= dirty.hi
}

/** `pack()` at most once per animation frame; later callers this frame see the same dirty range. */
export function packOnce(world: World): boolean {
  if (world.packedFrame !== animState.frame) {
    world.packedFrame = animState.frame
    pack(world)
  }
  return world.dirty.lo <= world.dirty.hi
}

/**
 * Reuse `world` for a new placement of the same view when it places the same nodes: frames and
 * plate indices are rewritten in place and the same object is returned, so the instanced renderers
 * keep their buffers. Returns null when the node set differs and the world must be rebuilt.
 */
export function replace(world: World, view: ViewGraph, placement: Placement): World | null {
  if (world.view !== view) return null
  const { nodes } = world
  let placed = 0
  for (const id in placement.nodes) if (nodes.index.has(id)) placed++
  if (placed !== nodes.count) return null
  nodes.plates = placement.plates.map((p) => p.id)
  const plateIndex = new Map(nodes.plates.map((id, i) => [id, i]))
  for (let i = 0; i < nodes.count; i++) {
    const place = placement.nodes[nodes.ids[i]]
    if (!place) return null
    nodes.frame[i] = FRAME_CODE[place.frame]
    nodes.plate[i] = place.plateId !== undefined ? (plateIndex.get(place.plateId) ?? -1) : -1
  }
  return world
}
