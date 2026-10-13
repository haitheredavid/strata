import { useEffect, useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CubicBezierCurve3, Quaternion, Vector3 } from 'three'
import type { Mesh } from 'three'
import type { Line2 } from 'three-stdlib'
import type { FlowEdge, ViewNode } from '../view/deriveView'
import { animState } from './anim'
import { archCurve, flowCurves, nodeAnchor, nodeCenter } from './curve'

const SEGMENTS = 24
const Y = new Vector3(0, 1, 0)

function sample(curve: CubicBezierCurve3, out: Float32Array) {
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = curve.getPoint(i / SEGMENTS)
    out[i * 3] = p.x
    out[i * 3 + 1] = p.y
    out[i * 3 + 2] = p.z
  }
  return out
}

interface Props {
  flow: FlowEdge
  from: ViewNode
  to: ViewNode
  color: string
  opacity: number
  width: number
}

/** Lineage edge: dashed arch in the pipeline color with an arrowhead in the data direction. */
export function FlowWire({ flow, from, to, color, opacity, width }: Props) {
  const line = useRef<Line2>(null)
  const head = useRef<Mesh>(null)
  const curve = useMemo(() => new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3()), [])
  const buf = useMemo(() => new Float32Array((SEGMENTS + 1) * 3), [])
  const initial = useMemo(() => Array.from({ length: SEGMENTS + 1 }, () => [0, 0, 0] as [number, number, number]), [])
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), ca: new Vector3(), cb: new Vector3(), q: new Quaternion() }), [])

  useEffect(() => {
    flowCurves.set(flow.id, curve)
    return () => void flowCurves.delete(flow.id)
  }, [flow.id, curve])

  useFrame(() => {
    if (!line.current || !head.current) return
    // Aim each end at the other node's center, then anchor on the facing side.
    const ca = nodeCenter(from.id, v.ca)
    const cb = nodeCenter(to.id, v.cb)
    const a = ca && cb && nodeAnchor(from, cb, v.a)
    const b = ca && cb && nodeAnchor(to, ca, v.b)
    const ok = !!(a && b)
    line.current.visible = head.current.visible = ok
    if (!ok) return
    archCurve(a, b, curve)
    line.current.geometry.setPositions(sample(curve, buf))
    line.current.computeLineDistances()
    line.current.material.opacity = opacity * (1 - 0.75 * animState.moving)
    // Arrowhead just short of the target, pointing along the curve.
    head.current.position.copy(curve.getPoint(0.94))
    head.current.quaternion.copy(v.q.setFromUnitVectors(Y, curve.getTangent(0.94).normalize()))
  })

  return (
    <group>
      <Line
        ref={line}
        points={initial}
        color={color}
        lineWidth={width}
        dashed
        dashSize={0.5}
        gapSize={0.25}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
      <mesh ref={head} raycast={() => null}>
        <coneGeometry args={[0.18, 0.5, 10]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    </group>
  )
}
