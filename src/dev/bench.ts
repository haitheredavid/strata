import type CameraControlsImpl from 'camera-controls'
import type { WebGPURenderer } from 'three/webgpu'
import { MODE_IDS } from '../layout/modes'
import type { ModeId } from '../model/types'
import { useStore } from '../store'
import { frameStats, startRecording, stopRecording } from './frames'
import type { FrameStats } from './frames'
import { allSpans, clearSpans, lastSpans } from './perf'
import { buildDataset } from '../data/dataset'
import type { SynthOptions } from './synth'

export interface BenchCtx {
  controls: () => CameraControlsImpl | null
  gl: WebGPURenderer
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
  /** Spans that cost the most during the phase: `name total ms / count, max ms`. */
  top: string
}

/** The three spans with the most total time since `since` (performance.now() time). */
function topSpans(since: number) {
  const by = new Map<string, { total: number; n: number; max: number }>()
  for (const s of allSpans()) {
    if (s.at < since) continue
    const e = by.get(s.name) ?? { total: 0, n: 0, max: 0 }
    e.total += s.ms
    e.n++
    e.max = Math.max(e.max, s.ms)
    by.set(s.name, e)
  }
  return [...by]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([name, e]) => `${name} ${e.total.toFixed(0)}/${e.n}, max ${e.max.toFixed(0)}`)
    .join(' · ')
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
    const since = performance.now()
    startRecording()
    await run()
    phases.push({ phase: name, ...frameStats(stopRecording()), longTask: lt.take(), top: topSpans(since) })
  }

  clearSpans()
  let loadToFrameMs = 0
  if (o.synth) {
    const t0 = performance.now()
    store.getState().load(buildDataset({ origin: 'synth', options: o.synth }))
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
  // WebGPURenderer's counters run across frames: sample draws and triangles as a per-frame average.
  const info = ctx.gl.info as unknown as { render: { drawCalls?: number; calls: number; triangles: number; frame?: number }; memory: { geometries: number } }
  const total = () => info.render.drawCalls ?? info.render.calls
  const before = { calls: total(), frame: info.render.frame ?? 0 }
  await frames(10)
  const sampled = Math.max(1, (info.render.frame ?? 10) - before.frame)
  const g = store.getState().graph
  const result: BenchResult = {
    graph: { tables: g.tables.length, refs: g.refs.length, pipelines: g.workflows.pipelines.length },
    loadToFrameMs,
    drawCalls: Math.round((total() - before.calls) / sampled),
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    phases,
    spans: Object.fromEntries(lastSpans().map((s) => [s.name, Math.round(s.ms * 100) / 100])),
  }
  console.table(phases)
  console.log('[strata bench]', result)
  return result
}
