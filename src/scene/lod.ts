import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { anim } from './anim'

/**
 * Column labels are most of the scene's text (two per row), and only legible up close. A driver ranks
 * the cards by camera distance a few times a second and keeps the set of cards near enough to show
 * their rows. A card shows rows when its row text would be at least MIN_PX tall and it is among the
 * MAX_NEAR nearest; it hides them again only past a margin, so cards don't flicker at the edge.
 * Graphs with at most MAX_NEAR cards always show every row.
 */
const MIN_PX = 5
const ROW_FONT = 0.22
const MAX_NEAR = 300
const HYSTERESIS = 1.25
const PERIOD = 0.25 // seconds between updates

const near = new Set<string>()
let dirty = true // the card list changed since the last pass
let since = 0

const setListeners = new Set<() => void>()
/** Called after any card enters or leaves the near set. */
export function onNearChange(fn: () => void) {
  setListeners.add(fn)
  return () => void setListeners.delete(fn)
}
export const isNear = (id: string) => near.has(id)

const tmp = new Vector3()

/**
 * Ranks `cards` by distance and updates the near set when cards cross the threshold. Mount once.
 */
export function LodDriver({ cards }: { cards: readonly string[] }) {
  useEffect(() => {
    dirty = true
  }, [cards])
  useFrame(({ camera, size }, dt) => {
    since += dt
    if (since < PERIOD && !dirty) return
    since = 0
    dirty = false
    const ids: Iterable<string> = cards
    const total = cards.length
    let next: Set<string>
    if (total <= MAX_NEAR) {
      next = new Set(ids)
    } else {
      // Distance at which ROW_FONT world units project to MIN_PX pixels.
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45
      const maxDist = (ROW_FONT * size.height) / (2 * Math.tan(((fov / 2) * Math.PI) / 180) * MIN_PX)
      const ranked: { id: string; d: number }[] = []
      for (const id of ids) {
        const e = anim.get(id)
        if (!e) continue
        const d = tmp.copy(e.pos).distanceTo(camera.position)
        if (d < maxDist * HYSTERESIS) ranked.push({ id, d })
      }
      ranked.sort((a, b) => a.d - b.d)
      next = new Set<string>()
      ranked.forEach(({ id, d }, i) => {
        const was = near.has(id)
        // Entering needs the strict bounds; staying only the looser ones.
        if (was ? i < MAX_NEAR * HYSTERESIS : i < MAX_NEAR && d < maxDist) next.add(id)
      })
    }
    const changed = next.size !== near.size || [...next].some((id) => !near.has(id))
    near.clear()
    for (const id of next) near.add(id)
    if (changed) for (const fn of setListeners) fn()
  })
  return null
}
