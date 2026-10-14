import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CubicBezierCurve3, Vector3 } from 'three'
import type { Mesh } from 'three'
import type { Line2 } from 'three-stdlib'
import { localAnchor } from '../layout/geometry'
import type { NodePlace } from '../layout/modes'
import type { ViewEdge, ViewNode } from '../view/deriveView'
import { Label } from './Label'
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
  opacity: number
  width: number
}

const SEGMENTS = 32
const LIFT = 0.06
const X = new Vector3(1, 0, 0)
const Z = new Vector3(0, 0, 1)

const tmp = {
  xa: new Vector3(), xb: new Vector3(), na: new Vector3(), nb: new Vector3(), d: new Vector3(),
  a: new Vector3(), b: new Vector3(), ab: new Vector3(), ma: new Vector3(), mb: new Vector3(),
}
const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3())

/**
 * Bezier between two column anchors, recomputed every frame from the animated card transforms.
 * - same plate: arc out sideways, lifted slightly off the plate
 * - across stacked plates: S-curve along the plate normal
 * - coplanar but different plates (flow columns): wide sideways arc bowed toward the viewer
 * - billboards (orbit): near-straight chord
 */
function update(e: Props, out: Float32Array, labels: [Vector3, Vector3]) {
  const A = anim.get(e.from.node.id)
  const B = anim.get(e.to.node.id)
  if (!A || !B) return false
  const self = e.from.node.id === e.to.node.id
  const { xa, xb, na, nb, d, a, b, ab, ma, mb } = tmp
  xa.copy(X).applyQuaternion(A.quat)
  xb.copy(X).applyQuaternion(B.quat)
  na.copy(Z).applyQuaternion(A.quat)
  nb.copy(Z).applyQuaternion(B.quat)
  d.subVectors(B.pos, A.pos)
  const sa = self || d.dot(xa) >= 0 ? 1 : -1
  const sb = self || -d.dot(xb) > 0 ? 1 : -1

  a.set(...localAnchor(e.from.node, e.from.column, sa)).applyQuaternion(A.quat).add(A.pos).addScaledVector(na, LIFT)
  b.set(...localAnchor(e.to.node, e.to.column, sb)).applyQuaternion(B.quat).add(B.pos).addScaledVector(nb, LIFT)
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
    const p = curve.getPoint(i / SEGMENTS)
    out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z
  }
  labels[0].copy(a).addScaledVector(xa, sa * 0.25).addScaledVector(na, 0.05)
  labels[1].copy(b).addScaledVector(xb, sb * 0.25).addScaledVector(nb, 0.05)
  return true
}

export function Wire(props: Props) {
  const { edge, color, opacity, width } = props
  const line = useRef<Line2>(null)
  const labelA = useRef<Mesh>(null)
  const labelB = useRef<Mesh>(null)
  const buf = useMemo(() => new Float32Array((SEGMENTS + 1) * 3), [])
  const anchors = useMemo<[Vector3, Vector3]>(() => [new Vector3(), new Vector3()], [])
  const initial = useMemo(() => Array.from({ length: SEGMENTS + 1 }, () => [0, 0, 0] as [number, number, number]), [])

  useFrame(({ camera }) => {
    if (!line.current) return
    const ok = update(props, buf, anchors)
    line.current.visible = ok
    if (!ok) return
    writeLine(line.current, buf)
    const fade = 1 - 0.75 * animState.moving
    line.current.material.opacity = opacity * fade
    for (const [ref, at] of [[labelA, anchors[0]], [labelB, anchors[1]]] as const) {
      if (!ref.current) continue
      ref.current.position.copy(at)
      ref.current.quaternion.copy(camera.quaternion)
    }
  })

  const [fromCard, , toCard] = edge.kind
  const labelOpacity = opacity * (edge.count > 1 ? 1 : 0.9)
  return (
    <group>
      <Line ref={line} points={initial} frustumCulled={false} color={color} lineWidth={width} transparent opacity={opacity} depthWrite={false} />
      <Label ref={labelA} fontSize={0.2} color="#ffffff" fillOpacity={labelOpacity} anchorX="center" anchorY="bottom" raycast={() => null}>
        {fromCard === 'n' ? 'N' : '1'}
      </Label>
      <Label ref={labelB} fontSize={0.2} color="#ffffff" fillOpacity={labelOpacity} anchorX="center" anchorY="bottom" raycast={() => null}>
        {(toCard === 'n' ? 'N' : '1') + (edge.count > 1 ? `  ×${edge.count}` : '')}
      </Label>
    </group>
  )
}
