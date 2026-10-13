import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { scheduleFor, useStore } from '../store'
import { DAY, taskRunsIn } from '../sim/schedule'
import type { TimeView } from './usePlacement'
import { timeClock } from './timeClock'

/**
 * Advances the day clock while playing (stopping at the span end or midnight), publishes `t` to the
 * store whenever the set of running jobs changes, and (optionally) follows them with the camera.
 */
export function TimeDriver({ time }: { time: TimeView | null }) {
  const follow = useStore((s) => s.time.follow)
  const lastKey = useRef('')

  useFrame((_, dt) => {
    const s = useStore.getState()
    if (!s.time.open) return
    const end = s.time.span?.[1] ?? DAY
    if (s.time.playing) {
      // Clamp dt so a stalled or backgrounded tab doesn't skip through the day on its next frame.
      timeClock.t = Math.min(end, timeClock.t + Math.min(dt, 0.1) * s.time.speed)
      if (timeClock.t >= end) s.setTime({ playing: false, t: end })
    }
    const key = taskRunsIn(scheduleFor(s.graph), [timeClock.t, timeClock.t]).map((r) => r.id).join()
    if (key !== lastKey.current) {
      lastKey.current = key
      if (s.time.t !== timeClock.t) s.setTime({ t: timeClock.t })
    }
  })

  useEffect(() => {
    if (!follow || !time?.active.size) return
    useStore.getState().camera({ kind: 'frame', ids: [...time.active, ...time.reached] })
  }, [follow, time])

  return null
}
