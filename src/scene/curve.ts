import { CubicBezierCurve3, Vector3 } from 'three'
import { localAnchor } from '../layout/geometry'
import type { ViewNode } from '../view/deriveView'
import { anim } from './anim'

const X = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const tmp = new Vector3()

/** Animated center of a node. */
export function nodeCenter(id: string, out: Vector3): Vector3 | null {
  const e = anim.get(id)
  return e ? out.copy(e.pos) : null
}

/**
 * Where a lineage edge meets a node, from its animated transform: jobs connect at their center, cards
 * at the header row on whichever side faces `toward`.
 */
export function nodeAnchor(node: ViewNode, toward: Vector3, out: Vector3): Vector3 | null {
  const e = anim.get(node.id)
  if (!e) return null
  if (node.kind === 'job') return out.copy(e.pos)
  const x = tmp.copy(X).applyQuaternion(e.quat)
  const side = toward.clone().sub(e.pos).dot(x) >= 0 ? 1 : -1
  return out.set(...localAnchor(node, undefined, side)).applyQuaternion(e.quat).add(e.pos)
}

/** Latest curve of every lineage edge, keyed by flow id; pulses ride on these. */
export const flowCurves = new Map<string, CubicBezierCurve3>()

/** A gentle arch from `a` to `b`: control points a third of the way along, lifted with distance. */
export function archCurve(a: Vector3, b: Vector3, out: CubicBezierCurve3) {
  const lift = Math.min(3, a.distanceTo(b) * 0.12)
  out.v0.copy(a)
  out.v1.copy(a).lerp(b, 1 / 3).addScaledVector(UP, lift)
  out.v2.copy(a).lerp(b, 2 / 3).addScaledVector(UP, lift)
  out.v3.copy(b)
  return out
}
