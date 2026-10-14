import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { Placement } from '../layout/modes'
import type { ViewNode } from '../view/deriveView'
import { useStore } from '../store'
import { anim, animState } from '../scene/anim'
import { pickNode } from './pick'
import { FRAME_CODE, KIND_CODE, packOnce } from './world'
import type { World } from './world'

const DRAG_THRESHOLD = 0.15 // world units before a press becomes a drag
const CLICK_SLOP = 4 // px a press on empty space may move and still count as a click
const NORMALS = [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)] // flat, upright, side

interface Drag {
  id: string
  index: number
  plane: Plane | null
  offset: Vector3
  start: Vector3
  at: Vector3
  moved: boolean
}

/**
 * Pointer input for the instanced scene: one listener set on the canvas, picking against the world
 * arrays (see pick.ts) instead of a mesh per node. Hover, click to focus, shift-click for a path,
 * double-click to fold a card, drag a card on its plane, click empty space to clear focus. Same
 * store actions and rules as the per-card handlers it replaces.
 */
export function Interaction({ world, placement, nodeById, draggable }: { world: World; placement: Placement; nodeById: Map<string, ViewNode>; draggable: boolean }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()
    let drag: Drag | null = null
    let down: { x: number; y: number; onNode: boolean } | null = null

    const cast = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray
    }
    const pick = (e: PointerEvent | MouseEvent) => {
      packOnce(world)
      const ray = cast(e)
      const h = pickNode(world.nodes, { ox: ray.origin.x, oy: ray.origin.y, oz: ray.origin.z, dx: ray.direction.x, dy: ray.direction.y, dz: ray.direction.z })
      return h ? h.index : -1
    }
    const isCard = (i: number) => world.nodes.kind[i] <= KIND_CODE.source

    const onMove = (e: PointerEvent) => {
      const s = useStore.getState()
      if (drag?.plane) {
        if (!cast(e).intersectPlane(drag.plane, hit)) return
        if (!drag.moved && hit.distanceTo(drag.start) < DRAG_THRESHOLD) return
        drag.moved = true
        // Move the card (and what reads its transform) directly; the layout is committed once on
        // release, so a drag doesn't re-run placement and autosave on every pointermove.
        animState.snapId = drag.id
        drag.at.copy(hit).add(drag.offset)
        anim.get(drag.id)?.target.copy(drag.at)
        return
      }
      if (drag || s.dragging) return
      const i = pick(e)
      const id = i < 0 ? null : world.nodes.ids[i]
      if (id !== s.hoveredTableId) s.hover(id)
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const i = pick(e)
      down = { x: e.clientX, y: e.clientY, onNode: i >= 0 }
      if (i < 0 || !isCard(i)) return
      const id = world.nodes.ids[i]
      const place = placement.nodes[id]
      if (!place) return
      const p = new Vector3(...place.p)
      const frame = world.nodes.frame[i]
      const canDrag = draggable && world.nodes.kind[i] !== KIND_CODE.domain && frame !== FRAME_CODE.billboard
      const plane = canDrag ? new Plane().setFromNormalAndCoplanarPoint(NORMALS[frame], p) : null
      const start = plane && cast(e).intersectPlane(plane, new Vector3())
      drag = { id, index: i, plane, offset: start ? p.clone().sub(start) : new Vector3(), start: start ?? p, at: p.clone(), moved: false }
      el.setPointerCapture(e.pointerId)
      useStore.getState().setDragging(true)
    }

    const endDrag = () => {
      const d = drag
      drag = null
      if (!d) return null
      const s = useStore.getState()
      if (d.moved) s.dragNode(d.id, [d.at.x, d.at.y, d.at.z])
      animState.snapId = null
      s.setDragging(false)
      return d
    }

    const onUp = (e: PointerEvent) => {
      const s = useStore.getState()
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const d = endDrag()
      const press = down
      down = null
      if (d) {
        if (d.moved) return
        if (e.shiftKey && s.focusedTableId && s.focusedTableId !== d.id) {
          s.setPathEnd(0, s.focusedTableId)
          s.setPathEnd(1, d.id)
          return
        }
        s.focus(s.focusedTableId === d.id ? null : d.id)
        return
      }
      if (!press || e.button !== 0) return
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) return // an orbit, not a click
      const i = press.onNode ? pick(e) : -1
      if (i < 0) {
        s.focus(null) // empty space
        return
      }
      const id = world.nodes.ids[i]
      s.focus(s.focusedTableId === id ? null : id) // jobs and clusters
    }

    const onDouble = (e: MouseEvent) => {
      const i = pick(e)
      if (i < 0 || !isCard(i) || world.nodes.kind[i] === KIND_CODE.domain) return
      const id = world.nodes.ids[i]
      const s = useStore.getState()
      s.toggleCard(id)
      s.focus(id)
    }

    const onLeave = () => {
      const s = useStore.getState()
      if (!drag && s.hoveredTableId) s.hover(null)
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('lostpointercapture', endDrag)
    el.addEventListener('dblclick', onDouble)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('lostpointercapture', endDrag)
      el.removeEventListener('dblclick', onDouble)
      el.removeEventListener('pointerleave', onLeave)
      endDrag()
    }
  }, [gl, camera, world, placement, nodeById, draggable])

  // A hovered node that left the scene (collapsed, hidden) stops being hovered.
  useEffect(() => {
    const s = useStore.getState()
    if (s.hoveredTableId && !world.nodes.index.has(s.hoveredTableId)) s.hover(null)
  }, [world])

  return null
}
