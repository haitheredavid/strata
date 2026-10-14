import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { scheduleFor, useStore } from '../store'
import { DAY } from '../sim/schedule'
import { windowKey } from '../sim/runIndex'
import { timeWindow } from './usePlacement'
import type { TimeView } from './usePlacement'
import { timeClock } from './timeClock'

/**
 * Advances the day clock while playing (stopping at the span end or midnight), publishes `t` to the
 * store whenever the running jobs or the recent-runs window change, and (optionally) follows them with
 * the camera.
 */
/** Shortest gap between published playhead updates while playing. */
const PUBLISH_MS = 120

export function TimeDriver({ time }: { time: TimeView | null }) {
  const follow = useStore((s) => s.time.follow)
  const lastKey = useRef('')
  const lastPublish = useRef(0)

  useFrame((_, dt) => {
    const s = useStore.getState()
    if (!s.time.open) return
    const end = s.time.span?.[1] ?? DAY
    if (s.time.playing) {
      // Clamp dt so a stalled or backgrounded tab doesn't skip through the day on its next frame.
      timeClock.t = Math.min(end, timeClock.t + Math.min(dt, 0.1) * s.time.speed)
      if (timeClock.t >= end) s.setTime({ playing: false, t: end })
    }
    // The window matters too: a finished run must stop counting as done once it slides out, even if
    // nothing starts or stops for hours.
    const schedule = scheduleFor(s.graph)
    const key = `${windowKey(schedule, [timeClock.t, timeClock.t])}|${windowKey(schedule, timeWindow(timeClock.t, s.time.span))}`
    // While playing, a big day crosses a run boundary nearly every frame, and each publish restyles
    // the whole diagram; publish at most every PUBLISH_MS then. A paused or scrubbed playhead (the
    // store's t already moved) publishes right away.
    const now = performance.now()
    if (key !== lastKey.current && (!s.time.playing || now - lastPublish.current >= PUBLISH_MS)) {
      lastKey.current = key
      lastPublish.current = now
      if (s.time.t !== timeClock.t) s.setTime({ t: timeClock.t })
    }
  })

  useEffect(() => {
    if (!follow || !time?.active.size) return
    useStore.getState().camera({ kind: 'frame', ids: [...time.active, ...time.reached] })
  }, [follow, time])

  return null
}
