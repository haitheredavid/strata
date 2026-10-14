import { memo, useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CubicBezierCurve3, Vector3 } from 'three'
import type { Mesh, Quaternion } from 'three'
import type { Line2 } from 'three-stdlib'
import { CARD_W, anchorY } from '../layout/geometry'
import type { NodePlace } from '../layout/modes'
import type { ViewEdge, ViewNode } from '../view/deriveView'
import { Label } from './Label'
import { useStore } from '../store'
import { anim, animState } from './anim'
import { writeLine } from './lineBuffer'

interface End {
  node: ViewNode
  place: NodePlace
  column: string | undefined
}

interface Props {
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

const SEGMENTS = 32
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
function update(e: Props, ya: number, yb: number, out: Float32Array, labels: [Vector3, Vector3]) {
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

function place(label: Mesh | null, at: Vector3, facing: Quaternion) {
  if (!label) return
  label.position.copy(at)
  label.quaternion.copy(facing)
}

const sameEnd = (a: End, b: End) => a.node === b.node && a.place === b.place && a.column === b.column

/** Troika text mesh: fillOpacity is applied at render time, so it can be set without a re-render. */
type TextMesh = Mesh & { fillOpacity: number }

export const Wire = memo(function Wire(props: Props) {
  const { edge, color, hoverable } = props
  const line = useRef<Line2>(null)
  const labelA = useRef<TextMesh>(null)
  const labelB = useRef<TextMesh>(null)
  const buf = useMemo(() => new Float32Array((SEGMENTS + 1) * 3), [])
  const anchors = useMemo<[Vector3, Vector3]>(() => [new Vector3(), new Vector3()], [])
  const initial = useMemo(() => Array.from({ length: SEGMENTS + 1 }, () => [0, 0, 0] as [number, number, number]), [])
  const ya = useMemo(() => anchorY(props.from.node, props.from.column), [props.from.node, props.from.column])
  const yb = useMemo(() => anchorY(props.to.node, props.to.column), [props.to.node, props.to.column])
  // Last end stamps the curve was built from, and the props it was built with; -1 forces a rebuild.
  const built = useRef({ a: -1, b: -1, props })

  useFrame(({ camera }) => {
    const l = line.current
    if (!l) return
    const A = anim.get(edge.from)
    const B = anim.get(edge.to)
    const k = built.current
    if (!A || !B || A.movedAt !== k.a || B.movedAt !== k.b || k.props !== props) {
      const ok = update(props, ya, yb, buf, anchors)
      l.visible = ok
      if (!ok) return
      writeLine(l, buf)
      built.current = { a: A!.movedAt, b: B!.movedAt, props }
    }
    // Hover is read here rather than subscribed to, so hovering never re-renders the wires.
    const h = hoverable ? useStore.getState().hoveredTableId : null
    const touch = h !== null && (h === edge.from || h === edge.to)
    const opacity = touch ? 1 : h !== null ? 0.3 : props.opacity
    const width = touch ? 3 : props.width
    const fade = 1 - 0.75 * animState.moving
    l.material.opacity = opacity * fade
    if (l.material.linewidth !== width) l.material.linewidth = width
    const labelOpacity = opacity * (edge.count > 1 ? 1 : 0.9)
    for (const [label, at] of [[labelA.current, anchors[0]], [labelB.current, anchors[1]]] as const) {
      if (!label) continue
      place(label, at, camera.quaternion)
      label.fillOpacity = labelOpacity
    }
  })

  const [fromCard, , toCard] = edge.kind
  const labelOpacity = props.opacity * (edge.count > 1 ? 1 : 0.9)
  return (
    <group>
      <Line ref={line} points={initial} frustumCulled={false} color={color} lineWidth={props.width} transparent opacity={props.opacity} depthWrite={false} />
      <Label ref={labelA} fontSize={0.2} color="#ffffff" fillOpacity={labelOpacity} anchorX="center" anchorY="bottom" raycast={() => null}>
        {fromCard === 'n' ? 'N' : '1'}
      </Label>
      <Label ref={labelB} fontSize={0.2} color="#ffffff" fillOpacity={labelOpacity} anchorX="center" anchorY="bottom" raycast={() => null}>
        {(toCard === 'n' ? 'N' : '1') + (edge.count > 1 ? `  ×${edge.count}` : '')}
      </Label>
    </group>
  )
},
// Ends arrive as fresh objects each render; compare what's in them.
(a, b) =>
  a.edge === b.edge && sameEnd(a.from, b.from) && sameEnd(a.to, b.to) && a.color === b.color &&
  a.opacity === b.opacity && a.width === b.width && a.hoverable === b.hoverable,
)
