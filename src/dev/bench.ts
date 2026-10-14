import type CameraControlsImpl from 'camera-controls'
import type { WebGLRenderer } from 'three'
import { MODE_IDS } from '../layout/modes'
import type { ModeId } from '../model/types'
import { useStore } from '../store'
import { frameStats, startRecording, stopRecording } from './frames'
import type { FrameStats } from './frames'
import { clearSpans, lastSpans } from './perf'
import { synthGraph, synthKey } from './synth'
import type { SynthOptions } from './synth'

export interface BenchCtx {
  controls: () => CameraControlsImpl | null
  gl: WebGLRenderer
}

export interface BenchOptions {
  /** Load a synthetic graph first; omit to bench whatever is loaded. */
  synth?: Partial<SynthOptions>
  idleMs: number
  orbitMs: number
  hovers: number
  modeMs: number
  modes: ModeId[]
  timelineMs: number
}

const DEFAULTS: BenchOptions = { idleMs: 2000, orbitMs: 5000, hovers: 200, modeMs: 1500, modes: MODE_IDS, timelineMs: 5000 }

export interface PhaseResult extends FrameStats {
  phase: string
  /** Longest main-thread task seen in the phase (Chrome only; 0 elsewhere). */
  longTask: number
}

export interface BenchResult {
  graph: { tables: number; refs: number; pipelines: number }
  /** loadGraph call to the second rendered frame. */
  loadToFrameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  phases: PhaseResult[]
  spans: Record<string, number>
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))
async function frames(n: number) {
  for (let i = 0; i < n; i++) await nextFrame()
}
async function forMs(ms: number, each?: (dt: number) => void) {
  const end = performance.now() + ms
  let last = performance.now()
  while (performance.now() < end) {
    const now = await nextFrame()
    each?.((now - last) / 1000)
    last = now
  }
}

/** Long tasks via PerformanceObserver; `take()` returns the longest since the last take. */
function longTasks() {
  let max = 0
  let obs: PerformanceObserver | null = null
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) max = Math.max(max, e.duration)
    })
    obs.observe({ type: 'longtask', buffered: false })
  } catch {
    obs = null // not supported (Safari, Firefox)
  }
  return {
    take: () => {
      const m = max
      max = 0
      return Math.round(m)
    },
    stop: () => obs?.disconnect(),
  }
}

/**
 * Scripted run: load → idle → orbit → hover sweep → each mode → timeline. Each phase reports frame
 * interval / work percentiles. Run from the console: `await __strata.bench({ synth: { tables: 5000 } })`.
 */
export async function runBench(ctx: BenchCtx, opts: Partial<BenchOptions> = {}): Promise<BenchResult> {
  const o = { ...DEFAULTS, ...opts }
  const store = useStore
  const lt = longTasks()
  const phases: PhaseResult[] = []
  const phase = async (name: string, run: () => Promise<void>) => {
    lt.take()
    startRecording()
    await run()
    phases.push({ phase: name, ...frameStats(stopRecording()), longTask: lt.take() })
  }

  clearSpans()
  let loadToFrameMs = 0
  if (o.synth) {
    const t0 = performance.now()
    const graph = synthGraph(o.synth)
    store.getState().loadGraph(graph, synthKey(o.synth))
    await frames(2)
    loadToFrameMs = Math.round(performance.now() - t0)
  }
  const startMode = store.getState().layout.mode ?? 'stack'

  await phase('idle', () => forMs(o.idleMs))
  await phase('orbit', () =>
    forMs(o.orbitMs, (dt) => {
      ctx.controls()?.rotate(dt * 0.6, 0, false)
    }),
  )
  await phase('hover', async () => {
    const ids = store.getState().graph.tables.slice(0, o.hovers).map((t) => t.id)
    for (const id of ids) {
      store.getState().hover(id)
      await nextFrame()
      store.getState().hover(null)
      await nextFrame()
    }
  })
  for (const m of o.modes)
    await phase(`mode:${m}`, async () => {
      store.getState().setMode(m)
      await forMs(o.modeMs)
    })
  store.getState().setMode(startMode)

  if (store.getState().graph.workflows.pipelines.length && o.timelineMs > 0)
    await phase('timeline', async () => {
      store.getState().openTimeline()
      store.getState().setTime({ playing: true })
      await forMs(o.timelineMs)
      store.getState().closeTimeline()
    })

  lt.stop()
  await frames(1)
  const info = ctx.gl.info
  const g = store.getState().graph
  const result: BenchResult = {
    graph: { tables: g.tables.length, refs: g.refs.length, pipelines: g.workflows.pipelines.length },
    loadToFrameMs,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    phases,
    spans: Object.fromEntries(lastSpans().map((s) => [s.name, Math.round(s.ms * 100) / 100])),
  }
  console.table(phases)
  console.log('[strata bench]', result)
  return result
}
