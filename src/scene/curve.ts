import { CubicBezierCurve3, Vector3 } from 'three'
import { localAnchor } from '../layout/geometry'
import type { ViewNode } from '../view/deriveView'
import { anim } from './anim'

const X = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const tmp = new Vector3()
const toward_ = new Vector3()

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
  const side = toward_.copy(toward).sub(e.pos).dot(x) >= 0 ? 1 : -1
  return out.set(...localAnchor(node, undefined, side)).applyQuaternion(e.quat).add(e.pos)
}

/** Latest curve of every lineage edge, keyed by flow id; pulses ride on these. */
export const flowCurves = new Map<string, CubicBezierCurve3>()

const liftOf = (a: Vector3, b: Vector3) => Math.min(3, a.distanceTo(b) * 0.12)

/** A gentle arch from `a` to `b`: control points a third of the way along, lifted with distance. */
export function archCurve(a: Vector3, b: Vector3, out: CubicBezierCurve3) {
  const lift = liftOf(a, b)
  out.v0.copy(a)
  out.v1.copy(a).lerp(b, 1 / 3).addScaledVector(UP, lift)
  out.v2.copy(a).lerp(b, 2 / 3).addScaledVector(UP, lift)
  out.v3.copy(b)
  return out
}

/** A node with at least this many lineage wires leaving (or entering) it on one side bundles them. */
export const BUNDLE_MIN = 6
/** How far from the hub toward the far ends' centroid a bundle's shared control point sits. */
const TRUNK = 0.9
/** How far from that centroid toward its own far end a bundled wire's other control point sits. */
const FAN = 0.25

/**
 * A wire that may be bundled at either end. `src` is the centroid of the far ends of the bundle
 * leaving `a` (null: not bundled there), `dst` that of the bundle entering `b`. A bundled end's
 * control point is shared by the whole bundle, close to the centroid, so the wires leave the hub as
 * one trunk; the other control point sits near the centroid too, so they fan out only near their
 * far ends. Unbundled at both ends, the plain arch.
 */
export function bundledCurve(a: Vector3, b: Vector3, src: Vector3 | null, dst: Vector3 | null, out: CubicBezierCurve3) {
  if (!src && !dst) return archCurve(a, b, out)
  const lift = liftOf(a, b)
  out.v0.copy(a)
  if (src) out.v1.copy(a).lerp(src, TRUNK).addScaledVector(UP, liftOf(a, src))
  else out.v1.copy(dst!).lerp(a, FAN).addScaledVector(UP, lift)
  if (dst) out.v2.copy(b).lerp(dst, TRUNK).addScaledVector(UP, liftOf(b, dst))
  else out.v2.copy(src!).lerp(b, FAN).addScaledVector(UP, lift)
  out.v3.copy(b)
  return out
}

/** Wires sharing a hub node at one end. */
export interface Bundle {
  hub: string
  /** Which end of its wires the hub is: 0 the source, 1 the target. */
  end: 0 | 1
  /** Wire indices. */
  members: number[]
}

/**
 * Every node's outgoing and incoming wires, where there are at least BUNDLE_MIN of them. Whether
 * they bundle also depends on which side of the hub their far ends lie (see FlowWires).
 */
export function bundleCandidates(wires: readonly { from: { id: string }; to: { id: string } }[]): Bundle[] {
  const groups = new Map<string, Bundle>()
  wires.forEach((w, k) => {
    for (const end of [0, 1] as const) {
      const hub = end === 0 ? w.from.id : w.to.id
      const key = `${end}:${hub}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { hub, end, members: [] }))
      g.members.push(k)
    }
  })
  return [...groups.values()].filter((g) => g.members.length >= BUNDLE_MIN)
}
