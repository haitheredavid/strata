import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Group, Plane, Vector3 } from 'three'
import { CARD_W, HEADER_H, ROW_H, cardDepth } from '../layout/geometry'
import type { NodePlace } from '../layout/modes'
import { MEDALLION_LAYERS } from '../view/deriveView'
import type { ViewNode } from '../view/deriveView'
import { useStore } from '../store'
import { Label } from './Label'
import { syncFromAnim, animState } from './anim'

const DRAG_THRESHOLD = 0.15
const MEDALLION_COLOR = Object.fromEntries(MEDALLION_LAYERS.map((l) => [l.id, l.color])) as Record<string, string>
// Card layers sit ~0.005 apart, finer than the depth buffer resolves once the camera pulls back,
// so each layer also gets a polygon offset (in depth-buffer units, so it holds at any distance).
const layer = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n * 4 })
const NORMALS = { flat: new Vector3(0, 1, 0), upright: new Vector3(0, 0, 1), side: new Vector3(1, 0, 0) }

interface Props {
  node: ViewNode
  place: NodePlace
  color: string
  opacity: number
  highlighted: boolean
  draggable: boolean
}

/** A table (or collapsed domain) card, drawn in its local frame: faces +Z, header on top. */
export function TableCard({ node, place, color, opacity, highlighted, draggable }: Props) {
  const hover = useStore((s) => s.hover)
  const focus = useStore((s) => s.focus)
  const dragNode = useStore((s) => s.dragNode)
  const setDragging = useStore((s) => s.setDragging)
  const toggleCard = useStore((s) => s.toggleCard)

  const group = useRef<Group>(null)
  const drag = useRef<{ offset: Vector3; start: Vector3; moved: boolean; plane: Plane | null } | null>(null)
  const depth = cardDepth(node)
  const top = depth / 2
  const isDomain = node.kind === 'domain'

  // Start where the animation is (not at the target), then follow it every frame.
  useLayoutEffect(() => syncFromAnim(group.current, node.id), [node.id])
  useFrame(() => syncFromAnim(group.current, node.id))

  const hit = (e: ThreeEvent<PointerEvent>, plane: Plane) => {
    const v = new Vector3()
    return e.ray.intersectPlane(plane, v)
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    const p = new Vector3(...place.p)
    const plane = draggable && !isDomain && place.frame !== 'billboard'
      ? new Plane().setFromNormalAndCoplanarPoint(NORMALS[place.frame], p)
      : null
    const h = plane && hit(e, plane)
    drag.current = { offset: h ? p.clone().sub(h) : new Vector3(), start: h ?? p, moved: false, plane }
    setDragging(true)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d?.plane) return
    const h = hit(e, d.plane)
    if (!h) return
    if (!d.moved && h.distanceTo(d.start) < DRAG_THRESHOLD) return
    d.moved = true
    animState.snapId = node.id
    const p = h.add(d.offset)
    dragNode(node.id, [p.x, p.y, p.z])
  }

  // Up, cancel (touch gesture, palm rejection) and lost capture (alt-tab) all end the drag; otherwise
  // `dragging` sticks and the camera stays locked.
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d) return null
    animState.snapId = null
    setDragging(false)
    return d
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    e.stopPropagation()
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    const d = endDrag()!
    if (d.moved) return
    const s = useStore.getState()
    if (e.nativeEvent.shiftKey && s.focusedTableId && s.focusedTableId !== node.id) {
      s.setPathEnd(0, s.focusedTableId)
      s.setPathEnd(1, node.id)
      return
    }
    focus(s.focusedTableId === node.id ? null : node.id)
  }

  return (
    <group ref={group}>
      <group position={[0, 0, 0.02]}>
        {/* body: also the interaction surface */}
        <mesh
          onPointerOver={(e) => (e.stopPropagation(), hover(node.id))}
          onPointerOut={() => hover(null)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (isDomain) return
            toggleCard(node.id)
            focus(node.id)
          }}
        >
          <planeGeometry args={[CARD_W, depth]} />
          <meshBasicMaterial color={highlighted ? '#2a3344' : '#1b2130'} transparent opacity={0.95 * opacity} />
        </mesh>

        {/* outline */}
        <mesh position={[0, 0, -0.005]} raycast={() => null}>
          <planeGeometry args={[CARD_W + 0.08, depth + 0.08]} />
          <meshBasicMaterial color={highlighted ? '#ffffff' : color} transparent opacity={(highlighted ? 0.9 : 0.5) * opacity} {...layer(-1)} />
        </mesh>

        {/* header */}
        <mesh position={[0, top - HEADER_H / 2, 0.005]} raycast={() => null}>
          <planeGeometry args={[CARD_W, HEADER_H]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} {...layer(1)} />
        </mesh>
        <Label
          position={[-CARD_W / 2 + 0.2, top - HEADER_H / 2, 0.02]}
          fontSize={0.32}
          anchorX="left"
          anchorY="middle"
          color="#0b0e14"
          fillOpacity={opacity}
          maxWidth={CARD_W - (node.medallion ? 0.9 : 0.4)}
          depthOffset={-16}
          raycast={() => null}
        >
          {isDomain ? node.name.toUpperCase() : node.name}
        </Label>
        {node.medallion && (
          <group position={[CARD_W / 2 - 0.32, top - HEADER_H / 2, 0.012]}>
            <mesh raycast={() => null}>
              <planeGeometry args={[0.44, 0.44]} />
              <meshBasicMaterial color="#0b0e14" transparent opacity={0.85 * opacity} {...layer(2)} />
            </mesh>
            <mesh position={[0, 0, 0.002]} raycast={() => null}>
              <planeGeometry args={[0.34, 0.34]} />
              <meshBasicMaterial color={MEDALLION_COLOR[node.medallion]} transparent opacity={opacity} {...layer(3)} />
            </mesh>
            <Label position={[0, 0, 0.01]} fontSize={0.22} color="#0b0e14" fillOpacity={opacity} anchorX="center" anchorY="middle" depthOffset={-16} raycast={() => null}>
              {node.medallion[0].toUpperCase()}
            </Label>
          </group>
        )}

        {node.columns.map((c, i) => {
          const y = top - HEADER_H - (i + 0.5) * ROW_H
          const badge = c.pk ? 'PK' : c.fk ? 'FK' : ''
          return (
            <group key={c.name} position={[0, y, 0.02]}>
              <Label
                position={[-CARD_W / 2 + 0.2, 0, 0]}
                fontSize={0.22}
                anchorX="left"
                anchorY="middle"
                color={c.pk ? '#f5c542' : c.fk ? '#9ecbff' : '#d7dce5'}
                fillOpacity={opacity}
                depthOffset={-16}
                raycast={() => null}
              >
                {badge ? `${c.name}  ·${badge}` : c.name}
              </Label>
              <Label
                position={[CARD_W / 2 - 0.2, 0, 0]}
                fontSize={0.2}
                anchorX="right"
                anchorY="middle"
                color="#7d8799"
                fillOpacity={opacity}
                depthOffset={-16}
                raycast={() => null}
              >
                {c.type}
              </Label>
            </group>
          )
        })}
      </group>
    </group>
  )
}
