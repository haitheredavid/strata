import { addAfterEffect, addEffect } from '@react-three/fiber'

/**
 * Frame timing from r3f's global loop hooks: `interval` is time between frames (what the user sees),
 * `work` is time spent inside the frame (every useFrame plus the render call).
 */
export interface FrameSample {
  interval: number
  work: number
}

let recording: FrameSample[] | null = null
let frameStart = 0
let lastEnd = 0
/** Last frame's numbers, for the HUD. */
export const lastFrame: FrameSample = { interval: 0, work: 0 }

let installed = false
export function installFrameClock() {
  if (installed) return
  installed = true
  addEffect(() => {
    frameStart = performance.now()
  })
  addAfterEffect(() => {
    const now = performance.now()
    lastFrame.work = now - frameStart
    lastFrame.interval = lastEnd ? now - lastEnd : 0
    lastEnd = now
    recording?.push({ interval: lastFrame.interval, work: lastFrame.work })
  })
}

export function startRecording() {
  recording = []
}
export function stopRecording(): FrameSample[] {
  const r = recording ?? []
  recording = null
  return r
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const round = (n: number) => Math.round(n * 100) / 100

export interface FrameStats {
  frames: number
  intervalP50: number
  intervalP95: number
  workP50: number
  workP95: number
  workMax: number
}

export function frameStats(samples: FrameSample[]): FrameStats {
  const iv = samples.map((s) => s.interval).filter((v) => v > 0)
  const wk = samples.map((s) => s.work)
  return {
    frames: samples.length,
    intervalP50: round(pct(iv, 50)),
    intervalP95: round(pct(iv, 95)),
    workP50: round(pct(wk, 50)),
    workP95: round(pct(wk, 95)),
    workMax: round(wk.reduce((m, v) => (v > m ? v : m), 0)),
  }
}
