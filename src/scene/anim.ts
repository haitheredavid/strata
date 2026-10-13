import { useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { Frame, Placement, V3 } from '../layout/modes'

/**
 * Animated transforms, keyed by node id (and `plate:<id>`). Placement gives targets; the driver eases
 * toward them every frame so mode switches, focus changes and collapses tween instead of jumping.
 * Cards, plates and wires read from here in their own frame callbacks.
 */
interface Entry {
  pos: Vector3
  quat: Quaternion
  target: Vector3
  frame: Frame
}

export const anim = new Map<string, Entry>()
export const animState = {
  /** 0..1, how much is in flight. Wires fade while large moves happen. */
  moving: 0,
  /** Card under the pointer while dragging: follows the pointer without easing. */
  snapId: null as string | null,
}

const FLAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0))
const UPRIGHT = new Quaternion()
const SIDE = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0))
const RATE = 7

/** Copy a node's animated transform onto an object. */
export function syncFromAnim(obj: Object3D | null, id: string) {
  const e = anim.get(id)
  if (!e || !obj) return
  obj.position.copy(e.pos)
  obj.quaternion.copy(e.quat)
}

export const plateKey = (id: string) => `plate:${id}`

function frameQuat(frame: Frame, camera: Quaternion) {
  return frame === 'flat' ? FLAT : frame === 'upright' ? UPRIGHT : frame === 'side' ? SIDE : camera
}

function upsert(id: string, p: V3, frame: Frame, live: Set<string>) {
  live.add(id)
  const e = anim.get(id)
  if (e) {
    e.target.set(...p)
    e.frame = frame
  } else {
    const pos = new Vector3(...p)
    anim.set(id, { pos, quat: (frame === 'billboard' ? UPRIGHT : frameQuat(frame, UPRIGHT)).clone(), target: pos.clone(), frame })
  }
}

export function AnimDriver({ placement }: { placement: Placement }) {
  useLayoutEffect(() => {
    const live = new Set<string>()
    for (const [id, n] of Object.entries(placement.nodes)) upsert(id, n.p, n.frame, live)
    for (const pl of placement.plates) upsert(plateKey(pl.id), pl.center, pl.frame, live)
    for (const id of [...anim.keys()]) if (!live.has(id)) anim.delete(id)
  }, [placement])

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * RATE)
    let maxMove = 0
    for (const [id, e] of anim) {
      const q = frameQuat(e.frame, state.camera.quaternion)
      if (id === animState.snapId) {
        e.pos.copy(e.target)
      } else {
        maxMove = Math.max(maxMove, e.pos.distanceTo(e.target))
        e.pos.lerp(e.target, k)
      }
      // Billboards track the camera exactly; orientation changes between frames ease.
      if (e.frame === 'billboard' && e.quat.angleTo(q) < 0.02) e.quat.copy(q)
      else e.quat.slerp(q, k)
    }
    const target = Math.min(1, maxMove / 6)
    animState.moving += (target - animState.moving) * (target > animState.moving ? 0.5 : 0.1)
  }, -1)

  return null
}
