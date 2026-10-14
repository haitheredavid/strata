/**
 * Reference implementation of one FK wire's curve, as the per-wire components built it before the
 * instanced renderer. Kept only so fkEdges.test.ts can check the batched system against it.
 */
import { CubicBezierCurve3, Vector3 } from 'three'
import { CARD_W } from '../layout/geometry'
import type { NodePlace } from '../layout/modes'
import type { ViewEdge, ViewNode } from '../view/deriveView'
import { anim } from '../scene/anim'

export interface End {
  node: ViewNode
  place: NodePlace
  column: string | undefined
}

export interface Props {
  edge: ViewEdge
  from: End
  to: End
  color: string
  /** Opacity and width with nothing hovered. */
  opacity: number
  width: number
  /** Whether hover restyles this wire (off while a lens, focus or path drives the styling). */
  hoverable: boolean
}

export const SEGMENTS = 32
const LIFT = 0.06
const X = new Vector3(1, 0, 0)
const Z = new Vector3(0, 0, 1)

const tmp = {
  xa: new Vector3(), xb: new Vector3(), na: new Vector3(), nb: new Vector3(), d: new Vector3(),
  a: new Vector3(), b: new Vector3(), ab: new Vector3(), ma: new Vector3(), mb: new Vector3(), p: new Vector3(),
}
const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3())

/**
 * Bezier between two column anchors, recomputed every frame from the animated card transforms.
 * - same plate: arc out sideways, lifted slightly off the plate
 * - across stacked plates: S-curve along the plate normal
 * - coplanar but different plates (flow columns): wide sideways arc bowed toward the viewer
 * - billboards (orbit): near-straight chord
 */
export function update(e: Props, ya: number, yb: number, out: Float32Array, labels: [Vector3, Vector3]) {
  const A = anim.get(e.from.node.id)
  const B = anim.get(e.to.node.id)
  if (!A || !B) return false
  const self = e.from.node.id === e.to.node.id
  const { xa, xb, na, nb, d, a, b, ab, ma, mb, p } = tmp
  xa.copy(X).applyQuaternion(A.quat)
  xb.copy(X).applyQuaternion(B.quat)
  na.copy(Z).applyQuaternion(A.quat)
  nb.copy(Z).applyQuaternion(B.quat)
  d.subVectors(B.pos, A.pos)
  const sa = self || d.dot(xa) >= 0 ? 1 : -1
  const sb = self || -d.dot(xb) > 0 ? 1 : -1

  a.set((sa * CARD_W) / 2, ya, 0).applyQuaternion(A.quat).add(A.pos).addScaledVector(na, LIFT)
  b.set((sb * CARD_W) / 2, yb, 0).applyQuaternion(B.quat).add(B.pos).addScaledVector(nb, LIFT)
  ab.subVectors(b, a)
  const dist = ab.length()
  ma.copy(a)
  mb.copy(b)

  if (self) {
    ma.addScaledVector(xa, 2).addScaledVector(na, 0.4)
    mb.addScaledVector(xb, 2).addScaledVector(nb, 0.4)
  } else if (e.from.place.frame === 'billboard') {
    ma.lerp(b, 0.3)
    mb.lerp(a, 0.3)
  } else if (Math.abs(ab.dot(na)) > 1e-2) {
    const off = ab.dot(na) * 0.5
    ma.addScaledVector(xa, sa * 1.5).addScaledVector(na, off)
    mb.addScaledVector(xb, sb * 1.5).addScaledVector(na, -off)
  } else {
    const same = e.from.place.plateId === e.to.place.plateId
    const side = Math.max(1.5, dist * 0.3)
    const lift = same ? 0.3 : Math.min(4, dist * 0.12)
    ma.addScaledVector(xa, sa * side).addScaledVector(na, lift)
    mb.addScaledVector(xb, sb * side).addScaledVector(nb, lift)
  }

  curve.v0.copy(a); curve.v1.copy(ma); curve.v2.copy(mb); curve.v3.copy(b)
  for (let i = 0; i <= SEGMENTS; i++) {
    curve.getPoint(i / SEGMENTS, p)
    out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z
  }
  labels[0].copy(a).addScaledVector(xa, sa * 0.25).addScaledVector(na, 0.05)
  labels[1].copy(b).addScaledVector(xb, sb * 0.25).addScaledVector(nb, 0.05)
  return true
}
