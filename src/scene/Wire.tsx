import { memo, useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Mesh, Quaternion } from 'three'
import type { Line2 } from 'three-stdlib'
import { anchorY } from '../layout/geometry'
import { Label } from './Label'
import { useStore } from '../store'
import { anim, animState } from './anim'
import { SEGMENTS, update } from './wireCurve'
import type { End, Props } from './wireCurve'
import { writeLine } from './lineBuffer'

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
