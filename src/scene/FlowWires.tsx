import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CubicBezierCurve3, Vector3 } from 'three'
import type { FlowEdge, ViewNode } from '../view/deriveView'
import { anim, animState } from './anim'
import { archCurve, flowCurves, nodeAnchor, nodeCenter } from './curve'
import { CurveBatch } from './curves/CurveBatch'
import { CURVE_WRITE, Curves } from './curves/Curves'

/** A drawn lineage edge: which flow, between which nodes. */
export interface FlowWireSpec {
  flow: FlowEdge
  from: ViewNode
  to: ViewNode
}

/** Per-wire style, in `wires` order; rebuilt on lens / focus / timeline changes without touching curves. */
export interface FlowWireStyle {
  color: string[]
  opacity: Float32Array
  width: Float32Array
}

const DASH = 0.5
const GAP = 0.25
const ARROW_AT = 0.94
const ARROW_LEN = 0.5 // world units, like the old cone
const ARROW_PX = 8

const v = { a: new Vector3(), b: new Vector3(), ca: new Vector3(), cb: new Vector3(), p: new Vector3(), t: new Vector3(), s: new Vector3(), e: new Vector3() }

/**
 * Every lineage edge in one draw: a dashed arch in the pipeline color plus a tapered arrowhead near
 * the target (two curves per flow). Curves are rebuilt only when an end moved, and published to
 * `flowCurves` for the pulses that ride on them.
 */
export function FlowWires({ wires, style }: { wires: FlowWireSpec[]; style: FlowWireStyle }) {
  const batch = useMemo(() => new CurveBatch(Math.max(16, wires.length * 2)), [wires.length])
  const curves = useMemo(() => wires.map(() => new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3())), [wires])
  const built = useRef<{ a: Int32Array; b: Int32Array }>({ a: new Int32Array(0), b: new Int32Array(0) })

  useEffect(() => {
    wires.forEach((w, k) => flowCurves.set(w.flow.id, curves[k]))
    built.current = { a: new Int32Array(wires.length).fill(-1), b: new Int32Array(wires.length).fill(-1) }
    return () => wires.forEach((w) => flowCurves.delete(w.flow.id))
  }, [wires, curves])

  useFrame(() => {
    batch.resize(wires.length * 2)
    const { a: ba, b: bb } = built.current
    wires.forEach((w, k) => {
      const color = style.color[k]
      batch.setStyle(2 * k, color, style.opacity[k], style.width[k], DASH, GAP)
      batch.setStyle(2 * k + 1, color, style.opacity[k], -ARROW_PX)
      const A = anim.get(w.from.id)
      const B = anim.get(w.to.id)
      if (!A || !B) {
        batch.setOpacity(2 * k, 0)
        batch.setOpacity(2 * k + 1, 0)
        return
      }
      if (A.movedAt === ba[k] && B.movedAt === bb[k]) return
      ba[k] = A.movedAt
      bb[k] = B.movedAt
      // Aim each end at the other node's center, then anchor on the facing side.
      nodeCenter(w.from.id, v.ca)
      nodeCenter(w.to.id, v.cb)
      nodeAnchor(w.from, v.cb, v.a)
      nodeAnchor(w.to, v.ca, v.b)
      const c = archCurve(v.a, v.b, curves[k])
      batch.setCurve(2 * k, c.v0, c.v1, c.v2, c.v3)
      // Arrowhead: a short tapered segment along the tangent, just short of the target.
      c.getPoint(ARROW_AT, v.p)
      c.getTangent(ARROW_AT, v.t).normalize()
      v.s.copy(v.p).addScaledVector(v.t, -ARROW_LEN / 2)
      v.e.copy(v.p).addScaledVector(v.t, ARROW_LEN / 2)
      batch.setSegment(2 * k + 1, v.s, v.e)
    })
  }, CURVE_WRITE)

  return <Curves batch={batch} fade={() => 1 - 0.75 * animState.moving} />
}
