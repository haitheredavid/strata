import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../store'
import type { RunView } from './usePlacement'
import { runClock } from './runClock'

const STEP_SECONDS = 1.6

/** Advances the run clock while playing, publishes the integer step, and (optionally) follows it with the camera. */
export function RunDriver({ run }: { run: RunView | null }) {
  const step = useStore((s) => s.run?.step ?? null)
  const follow = useStore((s) => s.run?.follow ?? false)

  useFrame((_, dt) => {
    const s = useStore.getState()
    if (!s.run || !run) return
    const total = run.steps.length
    // Clamp dt so a stalled or backgrounded tab doesn't skip through the whole run on its next frame.
    if (s.run.playing) runClock.t = Math.min(total - 1e-3, runClock.t + (Math.min(dt, 0.1) * s.run.speed) / STEP_SECONDS)
    const k = Math.floor(runClock.t)
    if (k !== s.run.step) s.updateRun({ step: k })
    if (s.run.playing && runClock.t >= total - 1e-3) s.updateRun({ playing: false })
  })

  useEffect(() => {
    if (!follow || step === null || !run) return
    const ids = [...(run.steps[step] ?? []), ...run.reached]
    if (ids.length) useStore.getState().camera({ kind: 'frame', ids })
  }, [step, follow, run])

  return null
}
