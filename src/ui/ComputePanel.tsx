import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { scheduleFor, useStore } from '../store'
import { clusterNodeId } from '../model/workflow'
import type { Cluster, Task } from '../model/workflow'
import { clock, packLanes, span as dur } from '../sim/schedule'
import type { Schedule, TaskRun, Window } from '../sim/schedule'
import { sizingHint, sparkRunsOn, utilization } from '../sim/spark'
import type { SparkRun } from '../sim/spark'
import { clusterSpec, KIND_LABEL } from '../scene/clusterStyle'
import { timeClock } from '../scene/timeClock'
import { usePalette } from '../theme/palette'
import type { Palette } from '../theme/palette'

const ROW = 15
const UTIL_H = 34

interface Rect { x0: number; x1: number; y: number; t0: number; t1: number; lines: string[] }

/** The focused job's or cluster's task runs, and the window to chart: the span, else the work around the playhead. */
function pickWindow(s: Schedule, cluster: Cluster, taskId: string | null, t: number, span: Window | null): { runs: TaskRun[]; window: Window } {
  const mine = s.taskRuns.filter((r) => r.clusterId === cluster.id && (!taskId || r.taskId === taskId))
  const batch = mine.filter((r) => !r.continuous)
  if (span) return { runs: mine, window: span }
  if (!batch.length) return { runs: mine, window: [t - 1800, t + 1800] }
  const dist = (r: TaskRun) => (t < r.start ? r.start - t : t >= r.end ? t - r.end : 0)
  const anchor = batch.reduce((a, b) => (dist(b) < dist(a) ? b : a))
  let [a, b] = [anchor.start, anchor.end]
  // A cluster's view widens to everything sharing it with the anchor run.
  for (let changed = !taskId; changed; ) {
    changed = false
    for (const r of batch)
      if (r.start < b && r.end > a && (r.start < a || r.end > b)) {
        ;[a, b] = [Math.min(a, r.start), Math.max(b, r.end)]
        changed = true
      }
  }
  const pad = (b - a) * 0.03
  return { runs: mine, window: [a - pad, b + pad] }
}

function flameRects(spark: SparkRun[], names: Map<string, string>, palette: Palette) {
  const out: (Rect & { color: string; label: string; depth: number; spill?: boolean; waves?: number; skew?: number })[] = []
  const lanes = packLanes(spark.map((sr) => ({ ...sr, start: sr.run.start, end: sr.run.end })))
  for (const { run: sr, lane } of lanes) {
    const y0 = lane * 4 * ROW
    const r = sr.run
    const name = names.get(r.taskId) ?? r.taskId
    out.push({
      depth: 0, y: y0, t0: r.start, t1: r.end, x0: 0, x1: 0, color: palette.pipeline(r.pipelineId), label: name,
      lines: [name, `${clock(r.start)}–${clock(r.end)} · ${dur(r.end - r.start)}`, `${dur(r.setup)} queue / cluster start`, `${sr.workers} workers · ${sr.cores} cores`],
    })
    for (const j of sr.jobs) {
      out.push({
        depth: 1, y: y0 + ROW, t0: j.start, t1: j.end, x0: 0, x1: 0, color: '#475569', label: `job ${j.id} ${j.desc}`,
        lines: [`Spark job ${j.id}: ${j.desc}`, `${dur(j.end - j.start)} · ${j.stages.length} stage${j.stages.length > 1 ? 's' : ''}`],
      })
      for (const st of j.stages)
        out.push({
          depth: 2, y: y0 + 2 * ROW, t0: st.start, t1: st.end, x0: 0, x1: 0, color: palette.op(st.op), label: st.name,
          spill: st.spillMB > 0, waves: st.waves, skew: st.skew,
          lines: [
            `Stage ${st.id}: ${st.name}`,
            `${dur(st.end - st.start)} · ${st.tasks} tasks in ${st.waves} wave${st.waves > 1 ? 's' : ''} · ${Math.round(st.occupancy * 100)}% cores busy`,
            ...(st.shuffleReadMB ? [`shuffle read ${st.shuffleReadMB} MB`] : []),
            ...(st.shuffleWriteMB ? [`shuffle write ${st.shuffleWriteMB} MB`] : []),
            ...(st.skew > 0.3 ? [`skewed: last wave ${Math.round(st.skew * 100)}% straggler`] : []),
            ...(st.spillMB ? [`spill ${st.spillMB} MB to disk`] : []),
          ],
        })
    }
  }
  return { rects: out, rows: Math.max(1, ...lanes.map((l) => l.lane + 1)) * 4 }
}

/**
 * Compute drawer for the focused job or cluster: spec, utilization over the window, a sizing hint,
 * and a flame chart of task run → Spark jobs → stages → task waves. All simulated; the shape follows
 * the Spark event log and `system.compute.node_timeline`. Click a bar to zoom, double-click to reset,
 * click empty space to move the playhead.
 */
export function ComputePanel() {
  const focused = useStore((s) => s.focusedTableId)
  const graph = useStore((s) => s.graph)
  const time = useStore((s) => s.time)
  const on = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk' && (s.layout.showCompute ?? true))
  const setTime = useStore((s) => s.setTime)
  const focus = useStore((s) => s.focus)
  const schedule = useMemo(() => scheduleFor(graph), [graph])
  const tasks = useMemo(() => new Map<string, Task>(graph.workflows.pipelines.flatMap((p) => p.tasks).map((t) => [t.id, t])), [graph])
  const palette = usePalette()

  const target = useMemo(() => {
    if (!focused || !on) return null
    const cluster = graph.workflows.clusters.find((c) => clusterNodeId(c.id) === focused)
    if (cluster) return { cluster, taskId: null }
    const task = focused.startsWith('job:') ? tasks.get(focused.slice(4)) : undefined
    const onCluster = task && graph.workflows.clusters.find((c) => c.id === task.clusterId)
    return onCluster ? { cluster: onCluster, taskId: task.id } : null
  }, [focused, on, graph, tasks])

  // Without the timeline the chart anchors on the first run of the day.
  const firstRun = target && schedule.taskRuns.find((r) => r.clusterId === target.cluster.id && (!target.taskId || r.taskId === target.taskId) && !r.continuous)
  const t = time.open ? time.t : firstRun?.start ?? 0
  const { window: win, runs } = useMemo(
    () => (target ? pickWindow(schedule, target.cluster, target.taskId, t, time.open ? time.span : null) : { window: [0, 1] as Window, runs: [] }),
    [schedule, target, t, time.open, time.span],
  )
  const names = useMemo(() => new Map([...tasks.values()].map((x) => [x.id, x.name])), [tasks])
  const spark = useMemo(
    () => (target ? sparkRunsOn(schedule, tasks, target.cluster, win).filter((sr) => !target.taskId || sr.run.taskId === target.taskId) : []),
    [schedule, tasks, target, win],
  )
  const flame = useMemo(() => flameRects(spark, names, palette), [spark, names, palette])
  const streaming = runs.some((r) => r.continuous)

  // Zoom belongs to the window it was made in; a new window starts unzoomed.
  const [zoom, setZoom] = useState<{ of: Window; view: Window } | null>(null)
  const view = zoom && zoom.of[0] === win[0] && zoom.of[1] === win[1] ? zoom.view : win
  const setView = (v: Window) => setZoom({ of: win, view: v })
  const [width, setWidth] = useState(600)
  const util = useMemo(
    () => (target ? utilization(schedule, tasks, target.cluster, view, Math.max(20, Math.floor(width / 3))) : []),
    [schedule, tasks, target, view, width],
  )
  const hint = useMemo(() => (target ? sizingHint(util, target.cluster, view[1] - view[0]) : null), [util, target, view])

  const box = useRef<HTMLDivElement>(null)
  const utilCanvas = useRef<HTMLCanvasElement>(null)
  const flameCanvas = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [target])

  const height = flame.rows * ROW
  // Redraw every frame so the playhead follows the clock.
  useEffect(() => {
    if (!target) return
    let raf = 0
    const color = palette.cluster(target.cluster.kind)
    const x = (tt: number) => ((tt - view[0]) / (view[1] - view[0])) * width
    const prep = (c: HTMLCanvasElement | null, h: number) => {
      if (!c) return null
      const dpr = window.devicePixelRatio || 1
      if (c.width !== Math.round(width * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(width * dpr)
        c.height = Math.round(h * dpr)
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, h)
      return ctx
    }
    const overlay = (ctx: CanvasRenderingContext2D, h: number) => {
      if (time.open && time.span) {
        ctx.fillStyle = palette.accent
        ctx.globalAlpha = 0.1
        ctx.fillRect(x(time.span[0]), 0, x(time.span[1]) - x(time.span[0]), h)
        ctx.globalAlpha = 1
      }
      if (time.open) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(x(timeClock.t) - 1, 0, 2, h)
      }
    }
    const draw = () => {
      const u = prep(utilCanvas.current, UTIL_H)
      if (u) {
        const bw = width / Math.max(1, util.length)
        const max = target.cluster.workers.max
        util.forEach((s, i) => {
          if (!s.up) return
          u.fillStyle = '#1e2533'
          const wh = (s.workers / max) * UTIL_H
          u.fillRect(i * bw, UTIL_H - wh, bw, wh)
          u.fillStyle = color
          u.fillRect(i * bw, UTIL_H - wh * s.busy, Math.max(1, bw - 0.5), wh * s.busy)
        })
        overlay(u, UTIL_H)
      }
      const f = prep(flameCanvas.current, height)
      if (f) {
        f.font = '10px Inter, system-ui, sans-serif'
        f.textBaseline = 'middle'
        for (const r of flame.rects) {
          r.x0 = Math.max(0, x(r.t0))
          r.x1 = Math.min(width, x(r.t1))
          if (r.x1 <= 0 || r.x0 >= width) continue
          const w = Math.max(1, r.x1 - r.x0 - 1)
          f.fillStyle = r.color
          f.globalAlpha = r.depth === 0 ? 0.85 : 0.75
          f.fillRect(r.x0, r.y + 1, w, ROW - 2)
          f.globalAlpha = 1
          if (r.spill) {
            f.strokeStyle = '#ef4444'
            f.lineWidth = 1.5
            f.strokeRect(r.x0 + 0.75, r.y + 1.75, w - 1.5, ROW - 3.5)
          }
          // Waves under each stage: full waves alternate shade, a skewed last wave trails as one thin task.
          if (r.depth === 2 && r.waves) {
            const total = r.x1 - r.x0
            const tail = (r.skew ?? 0) * (total / r.waves)
            const ww = (total - tail) / r.waves
            for (let k = 0; k < r.waves && ww > 1.5; k++) {
              f.fillStyle = k % 2 ? 'rgb(255 255 255 / 0.18)' : 'rgb(255 255 255 / 0.32)'
              f.fillRect(r.x0 + k * ww, r.y + ROW + 1, Math.max(1, ww - 0.5), ROW - 2)
            }
            if (tail > 1) {
              f.fillStyle = 'rgb(239 68 68 / 0.7)'
              f.fillRect(r.x0 + r.waves * ww, r.y + ROW + ROW / 2 - 1.5, tail, 3)
            }
          }
          if (w > 36) {
            f.fillStyle = r.depth === 0 ? '#0b0e14' : '#e5e7eb'
            f.save()
            f.beginPath()
            f.rect(r.x0, r.y, w, ROW)
            f.clip()
            f.fillText(r.label, r.x0 + 4, r.y + ROW / 2)
            f.restore()
          }
        }
        overlay(f, height)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [target, view, width, util, flame, height, time.open, time.span, palette])

  if (!target || !hint) return null
  const c = target.cluster

  const hit = (e: MouseEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - b.left
    const py = e.clientY - b.top
    return { px, rect: flame.rects.find((r) => px >= r.x0 && px <= r.x1 && py >= r.y && py < r.y + ROW) }
  }
  const tAt = (px: number) => view[0] + (px / width) * (view[1] - view[0])

  return (
    <div className="compute" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="kind" style={{ color: palette.cluster(c.kind), borderColor: palette.cluster(c.kind) }}>{KIND_LABEL[c.kind]}</span>
        <span className="title">{c.name}</span>
        <span className="spec">{clusterSpec(c)}{c.sparkVersion ? ` · DBR ${c.sparkVersion.split('.x')[0]}` : ''}</span>
        {target.taskId && <span className="spec">· running {names.get(target.taskId)}</span>}
        <span className="sim" title="Generated from the workflow shape, not measured">simulated</span>
        <span className="spacer" />
        <span className="range">{clock(view[0])}–{clock(view[1])}</span>
        <button title="Close" onClick={() => focus(null)}>✕</button>
      </div>
      <div className="stats">
        <span>avg {Math.round(hint.avg * 100)}% · p95 {Math.round(hint.p95 * 100)}% cores busy</span>
        <span>≈ {hint.dbu.toFixed(1)} DBU</span>
        <span className="advice">{hint.text}</span>
        {streaming && <span className="spec">streaming micro-batches keep it busy all day</span>}
      </div>
      <div ref={box} className="charts">
        <canvas ref={utilCanvas} style={{ width, height: UTIL_H }} title="Workers up (grey) and cores busy (color)" />
        {flame.rects.length > 0 ? (
          <div className="flame">
            <canvas
              ref={flameCanvas}
              style={{ width, height }}
              onMouseMove={(e) => {
                const { rect } = hit(e)
                setTip(rect ? { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: rect.lines } : null)
              }}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => {
                const { px, rect } = hit(e)
                if (rect) {
                  const pad = (rect.t1 - rect.t0) * 0.05
                  setView([rect.t0 - pad, rect.t1 + pad])
                } else if (time.open) setTime({ t: tAt(px) })
              }}
              onDoubleClick={() => setZoom(null)}
            />
            {tip && (
              <div className="tip" style={{ left: Math.min(tip.x + 12, width - 240), top: tip.y + 12 }}>
                {tip.lines.map((l, i) => <div key={i} className={i ? '' : 'first'}>{l}</div>)}
              </div>
            )}
          </div>
        ) : (
          <div className="empty">{streaming ? 'Streaming task: no batch runs to chart' : 'No runs in view'}</div>
        )}
      </div>
    </div>
  )
}
