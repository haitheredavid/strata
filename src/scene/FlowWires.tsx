import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CubicBezierCurve3, Vector3 } from 'three'
import type { FlowEdge, ViewNode } from '../view/deriveView'
import { anim, animState } from './anim'
import { BUNDLE_MIN, bundleCandidates, bundledCurve, flowCurves, nodeAnchor, nodeCenter } from './curve'
import type { Bundle } from './curve'
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

const X = new Vector3(1, 0, 0)
const v = {
  a: new Vector3(), b: new Vector3(), ca: new Vector3(), cb: new Vector3(), src: new Vector3(), dst: new Vector3(),
  p: new Vector3(), t: new Vector3(), s: new Vector3(), e: new Vector3(), axis: new Vector3(), d: new Vector3(),
}
const sums = [new Vector3(), new Vector3()]

/**
 * Per-wire state between frames. `ends`: anchor a, anchor b, center a, center b (12 floats per wire).
 * `centroid` / `on`: each end's bundle centroid (6 floats) and whether that end is bundled (2 flags).
 */
interface WireState {
  movedA: Int32Array
  movedB: Int32Array
  ends: Float32Array
  centroid: Float32Array
  on: Uint8Array
  dirty: Uint8Array
}

const wireState = (n: number): WireState => ({
  movedA: new Int32Array(n).fill(-1),
  movedB: new Int32Array(n).fill(-1),
  ends: new Float32Array(n * 12),
  centroid: new Float32Array(n * 6),
  on: new Uint8Array(n * 2),
  dirty: new Uint8Array(n),
})

/**
 * Split a bundle candidate by the side of the hub its far ends lie on (along the hub's local X, the
 * way cards pick the side a wire leaves from), and give each side with at least BUNDLE_MIN wires the
 * centroid of its far anchors. Marks wires whose bundling changed.
 */
function gather(b: Bundle, s: WireState) {
  const hub = anim.get(b.hub)
  if (!hub) return
  v.axis.copy(X).applyQuaternion(hub.quat)
  const near = b.end
  const far = 1 - near
  const side = (k: number) => (v.d.fromArray(s.ends, 12 * k + 6 + 3 * far).sub(v.p.fromArray(s.ends, 12 * k + 6 + 3 * near)).dot(v.axis) >= 0 ? 1 : 0)
  sums[0].set(0, 0, 0)
  sums[1].set(0, 0, 0)
  const count = [0, 0]
  for (const k of b.members) {
    if (s.movedA[k] === -1) continue // never placed
    const i = side(k)
    sums[i].add(v.d.fromArray(s.ends, 12 * k + 3 * far))
    count[i]++
  }
  for (const k of b.members) {
    if (s.movedA[k] === -1) continue
    const i = side(k)
    const f = 2 * k + near
    const o = 6 * k + 3 * near
    if (count[i] < BUNDLE_MIN) {
      if (s.on[f]) s.dirty[k] = 1
      s.on[f] = 0
      continue
    }
    v.d.copy(sums[i]).divideScalar(count[i])
    if (!s.on[f] || s.centroid[o] !== Math.fround(v.d.x) || s.centroid[o + 1] !== Math.fround(v.d.y) || s.centroid[o + 2] !== Math.fround(v.d.z)) {
      v.d.toArray(s.centroid, o)
      s.on[f] = 1
      s.dirty[k] = 1
    }
  }
}

/**
 * Every lineage edge in one draw: a dashed arch in the pipeline color plus a tapered arrowhead near
 * the target (two curves per flow). A node with many wires leaving (or entering) it on one side
 * bundles them: they share a trunk from the node and fan out near their far ends (see bundledCurve),
 * so a job writing dozens of tables draws one trunk instead of a star. Curves are rebuilt only when
 * an end (or a bundle they belong to) moved, and published to `flowCurves` for the pulses that ride on them.
 */
export function FlowWires({ wires, style }: { wires: FlowWireSpec[]; style: FlowWireStyle }) {
  const batch = useMemo(() => new CurveBatch(Math.max(16, wires.length * 2)), [wires.length])
  const curves = useMemo(() => wires.map(() => new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3())), [wires])
  const bundles = useMemo(() => bundleCandidates(wires), [wires])
  // Per-wire state for the current wire list; the frame loop replaces it when the list changes.
  const state = useRef<{ wires: FlowWireSpec[]; s: WireState } | null>(null)

  useEffect(() => {
    wires.forEach((w, k) => flowCurves.set(w.flow.id, curves[k]))
    return () => wires.forEach((w) => flowCurves.delete(w.flow.id))
  }, [wires, curves])

  useFrame(() => {
    batch.resize(wires.length * 2)
    if (state.current?.wires !== wires) state.current = { wires, s: wireState(wires.length) }
    const { s } = state.current
    let moved = false
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
      if (A.movedAt === s.movedA[k] && B.movedAt === s.movedB[k]) return
      s.movedA[k] = A.movedAt
      s.movedB[k] = B.movedAt
      // Aim each end at the other node's center, then anchor on the facing side.
      nodeCenter(w.from.id, v.ca)
      nodeCenter(w.to.id, v.cb)
      nodeAnchor(w.from, v.cb, v.a)
      nodeAnchor(w.to, v.ca, v.b)
      v.a.toArray(s.ends, 12 * k)
      v.b.toArray(s.ends, 12 * k + 3)
      v.ca.toArray(s.ends, 12 * k + 6)
      v.cb.toArray(s.ends, 12 * k + 9)
      s.dirty[k] = 1
      moved = true
    })
    if (!moved) return
    for (const b of bundles) gather(b, s)
    for (let k = 0; k < wires.length; k++) {
      if (!s.dirty[k]) continue
      s.dirty[k] = 0
      v.a.fromArray(s.ends, 12 * k)
      v.b.fromArray(s.ends, 12 * k + 3)
      const src = s.on[2 * k] ? v.src.fromArray(s.centroid, 6 * k) : null
      const dst = s.on[2 * k + 1] ? v.dst.fromArray(s.centroid, 6 * k + 3) : null
      const c = bundledCurve(v.a, v.b, src, dst, curves[k])
      batch.setCurve(2 * k, c.v0, c.v1, c.v2, c.v3)
      // Arrowhead: a short tapered segment along the tangent, just short of the target.
      c.getPoint(ARROW_AT, v.p)
      c.getTangent(ARROW_AT, v.t).normalize()
      v.s.copy(v.p).addScaledVector(v.t, -ARROW_LEN / 2)
      v.e.copy(v.p).addScaledVector(v.t, ARROW_LEN / 2)
      batch.setSegment(2 * k + 1, v.s, v.e)
    }
  }, CURVE_WRITE)

  return <Curves batch={batch} fade={() => 1 - 0.75 * animState.moving} />
}
