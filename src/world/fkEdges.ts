import { Quaternion, Vector3 } from 'three'
import { CARD_W } from '../layout/geometry'
import { FRAME_CODE } from './world'
import type { World } from './world'

/**
 * FK wire curves as data: four bezier control points per edge (12 floats) plus a label anchor at
 * each end (6 floats), matching the per-wire reference in fkEdges.reference.ts. Only edges with an
 * end that moved since the last pass are recomputed.
 *
 * - same plate: arc out sideways, lifted slightly off the plate
 * - across stacked plates: S-curve along the plate normal
 * - coplanar but different plates (flow columns): wide sideways arc bowed toward the viewer
 * - billboards (orbit): near-straight chord
 */
export interface FkCurves {
  /** v0, v1, v2, v3 xyz per edge. */
  ctrl: Float32Array
  /** Label anchor xyz at the from end, then the to end, per edge. */
  labels: Float32Array
  /** Node `packedAt` stamps each edge was built from; -1 forces a rebuild. */
  builtA: Int32Array
  builtB: Int32Array
}

const LIFT = 0.06
const X = new Vector3(1, 0, 0)
const Z = new Vector3(0, 0, 1)
const qa = new Quaternion()
const qb = new Quaternion()
const A = new Vector3()
const B = new Vector3()
const xa = new Vector3()
const xb = new Vector3()
const na = new Vector3()
const nb = new Vector3()
const d = new Vector3()
const a = new Vector3()
const b = new Vector3()
const ab = new Vector3()
const ma = new Vector3()
const mb = new Vector3()

export function fkCurves(count: number): FkCurves {
  return {
    ctrl: new Float32Array(count * 12),
    labels: new Float32Array(count * 6),
    builtA: new Int32Array(count).fill(-1),
    builtB: new Int32Array(count).fill(-1),
  }
}

/** Rebuild curves whose ends moved. Returns the changed edge range (lo > hi when none). */
export function updateFkCurves(world: World, out: FkCurves): { lo: number; hi: number } {
  const { nodes, fk } = world
  let lo = fk.count
  let hi = -1
  for (let k = 0; k < fk.count; k++) {
    const i = fk.src[k]
    const j = fk.dst[k]
    if (nodes.packedAt[i] === out.builtA[k] && nodes.packedAt[j] === out.builtB[k]) continue
    out.builtA[k] = nodes.packedAt[i]
    out.builtB[k] = nodes.packedAt[j]
    buildEdge(world, k, out)
    if (k < lo) lo = k
    hi = k
  }
  return { lo, hi }
}

function buildEdge(world: World, k: number, out: FkCurves) {
  const { nodes, fk } = world
  const i = fk.src[k]
  const j = fk.dst[k]
  A.fromArray(nodes.pos, 3 * i)
  B.fromArray(nodes.pos, 3 * j)
  qa.fromArray(nodes.quat, 4 * i)
  qb.fromArray(nodes.quat, 4 * j)
  const self = i === j
  xa.copy(X).applyQuaternion(qa)
  xb.copy(X).applyQuaternion(qb)
  na.copy(Z).applyQuaternion(qa)
  nb.copy(Z).applyQuaternion(qb)
  d.subVectors(B, A)
  const sa = self || d.dot(xa) >= 0 ? 1 : -1
  const sb = self || -d.dot(xb) > 0 ? 1 : -1

  a.set((sa * CARD_W) / 2, fk.anchorY[2 * k], 0).applyQuaternion(qa).add(A).addScaledVector(na, LIFT)
  b.set((sb * CARD_W) / 2, fk.anchorY[2 * k + 1], 0).applyQuaternion(qb).add(B).addScaledVector(nb, LIFT)
  ab.subVectors(b, a)
  const dist = ab.length()
  ma.copy(a)
  mb.copy(b)

  if (self) {
    ma.addScaledVector(xa, 2).addScaledVector(na, 0.4)
    mb.addScaledVector(xb, 2).addScaledVector(nb, 0.4)
  } else if (nodes.frame[i] === FRAME_CODE.billboard) {
    ma.lerp(b, 0.3)
    mb.lerp(a, 0.3)
  } else if (Math.abs(ab.dot(na)) > 1e-2) {
    const off = ab.dot(na) * 0.5
    ma.addScaledVector(xa, sa * 1.5).addScaledVector(na, off)
    mb.addScaledVector(xb, sb * 1.5).addScaledVector(na, -off)
  } else {
    const same = nodes.plate[i] === nodes.plate[j]
    const side = Math.max(1.5, dist * 0.3)
    const lift = same ? 0.3 : Math.min(4, dist * 0.12)
    ma.addScaledVector(xa, sa * side).addScaledVector(na, lift)
    mb.addScaledVector(xb, sb * side).addScaledVector(nb, lift)
  }

  a.toArray(out.ctrl, 12 * k)
  ma.toArray(out.ctrl, 12 * k + 3)
  mb.toArray(out.ctrl, 12 * k + 6)
  b.toArray(out.ctrl, 12 * k + 9)
  a.addScaledVector(xa, sa * 0.25).addScaledVector(na, 0.05).toArray(out.labels, 6 * k)
  b.addScaledVector(xb, sb * 0.25).addScaledVector(nb, 0.05).toArray(out.labels, 6 * k + 3)
}
