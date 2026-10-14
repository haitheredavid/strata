import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { anim } from './anim'

/**
 * Column labels are most of the scene's text (two per row), and only legible up close. Cards register
 * here; a driver ranks them by camera distance a few times a second and tells each whether to show
 * its rows. A card shows rows when its row text would be at least MIN_PX tall and it is among the
 * MAX_NEAR nearest; it hides them again only past a margin, so cards don't flicker at the edge.
 * Graphs with at most MAX_NEAR cards always show every row.
 */
const MIN_PX = 5
const ROW_FONT = 0.22
const MAX_NEAR = 300
const HYSTERESIS = 1.25
const PERIOD = 0.25 // seconds between updates

const listeners = new Map<string, (near: boolean) => void>()
const near = new Set<string>()
let dirty = true // a card registered since the last pass
let since = 0

function subscribe(id: string, fn: (near: boolean) => void) {
  listeners.set(id, fn)
  dirty = true
  return () => {
    if (listeners.get(id) === fn) listeners.delete(id)
    near.delete(id)
  }
}

const setListeners = new Set<() => void>()
/** Called after any card enters or leaves the near set. */
export function onNearChange(fn: () => void) {
  setListeners.add(fn)
  return () => void setListeners.delete(fn)
}
export const isNear = (id: string) => near.has(id)

/** Whether this card is close enough to draw its rows. */
export function useNear(id: string): boolean {
  const [isNear, setNear] = useState(() => near.has(id))
  useEffect(() => subscribe(id, setNear), [id])
  return isNear
}

const tmp = new Vector3()

/** Ranks registered cards by distance and flips the ones that crossed the threshold. Mount once. */
export function LodDriver() {
  useFrame(({ camera, size }, dt) => {
    since += dt
    if (since < PERIOD && !dirty) return
    since = 0
    dirty = false
    if (listeners.size <= MAX_NEAR) {
      let changed = false
      for (const [id, fn] of listeners) {
        if (near.has(id)) continue
        near.add(id)
        fn(true)
        changed = true
      }
      if (changed) for (const fn of setListeners) fn()
      return
    }
    // Distance at which ROW_FONT world units project to MIN_PX pixels.
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 45
    const maxDist = (ROW_FONT * size.height) / (2 * Math.tan(((fov / 2) * Math.PI) / 180) * MIN_PX)
    const ranked: { id: string; d: number }[] = []
    for (const id of listeners.keys()) {
      const e = anim.get(id)
      if (!e) continue
      const d = tmp.copy(e.pos).distanceTo(camera.position)
      if (d < maxDist * HYSTERESIS) ranked.push({ id, d })
    }
    ranked.sort((a, b) => a.d - b.d)
    const next = new Set<string>()
    ranked.forEach(({ id, d }, i) => {
      const was = near.has(id)
      // Entering needs the strict bounds; staying only the looser ones.
      if (was ? i < MAX_NEAR * HYSTERESIS : i < MAX_NEAR && d < maxDist) next.add(id)
    })
    for (const id of near) if (!next.has(id)) listeners.get(id)?.(false)
    for (const id of next) if (!near.has(id)) listeners.get(id)?.(true)
    const changed = next.size !== near.size || [...next].some((id) => !near.has(id))
    near.clear()
    for (const id of next) near.add(id)
    if (changed) for (const fn of setListeners) fn()
  })
  return null
}
