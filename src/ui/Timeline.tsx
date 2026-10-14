import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { scheduleFor, TIME_SPEEDS, useStore } from '../store'
import { timeClock, TRIGGER_LABEL } from '../scene/timeClock'
import { timeWindow } from '../scene/usePlacement'
import { clock, DAY, eventsIn, layerTotals, packLanes, span as dur } from '../sim/schedule'
import { MEDALLIONS } from '../model/workflow'
import type { Trigger } from '../model/workflow'
import { jobNodeId } from '../view/deriveView'
import { usePalette } from '../theme/palette'

const LANE = 8
const LANE_GAP = 2
const MIN_VIEW = 900
const TICK_STEPS = [900, 1800, 3600, 7200, 10800, 21600]

const speedLabel = (v: number) => (v < 3600 ? `${v / 60}m/s` : `${v / 3600}h/s`)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampView = (a: number, w: number): [number, number] => {
  const start = clamp(a, 0, DAY - w)
  return [start, start + w]
}

const triggerLine = (t?: Trigger) => {
  if (!t) return 'no trigger'
  const d = t.kind === 'schedule' ? t.cron : t.kind === 'file_arrival' ? t.path : t.kind === 'table_update' ? t.tables.join(', ') : t.kind === 'job' ? t.pipeline : ''
  return `${TRIGGER_LABEL[t.kind]} ${d}`.trim()
}

interface Drag { x: number; t: number; mode: 'new' | 'a' | 'b'; moved: boolean; taskRun?: string }

/**
 * The simulated day across every pipeline: one row per pipeline, a bar per task run (hatched head =
 * queue / cluster start, left edge = medallion layer written, ◆ = emitted event). Click to move the
 * playhead, drag to select a span (drag its edges to adjust), wheel to zoom, shift-wheel to pan.
 */
export function Timeline() {
  const time = useStore((s) => s.time)
  const graph = useStore((s) => s.graph)
  const palette = usePalette()
  const hidden = useStore((s) => s.layout.hiddenPipelines)
  const lens = useStore((s) => s.lensPipeline)
  const setTime = useStore((s) => s.setTime)
  const closeTimeline = useStore((s) => s.closeTimeline)
  const setLens = useStore((s) => s.setLens)
  const focus = useStore((s) => s.focus)
  const schedule = useMemo(() => scheduleFor(graph), [graph])
  const [view, setView] = useState<[number, number]>([0, DAY])
  const [showEvents, setShowEvents] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const drag = useRef<Drag | null>(null)

  const names = useMemo(() => new Map(graph.workflows.pipelines.flatMap((p) => p.tasks).map((t) => [t.id, t.name])), [graph])
  const rows = useMemo(
    () =>
      // Hidden pipelines get no row, so a solo'd pipeline isn't lost among the rest.
      graph.workflows.pipelines.filter((p) => !hidden?.includes(p.id)).map((p) => {
        const placed = packLanes(schedule.taskRuns.filter((r) => r.pipelineId === p.id))
        const lanes = Math.max(1, ...placed.map((x) => x.lane + 1))
        const emits = schedule.events.filter((e) => e.kind === 'emit' && e.pipelineId === p.id)
        return { p, placed, emits, height: lanes * (LANE + LANE_GAP) + 6 }
      }),
    [graph, schedule, hidden],
  )
  const clusterName = useMemo(() => new Map(graph.workflows.clusters.map((c) => [c.id, c.name])), [graph])
  const runById = useMemo(() => new Map(schedule.taskRuns.map((r) => [r.id, r])), [schedule])

  const pct = (t: number) => ((t - view[0]) / (view[1] - view[0])) * 100

  // Playhead and clock follow the per-frame clock without re-rendering.
  useEffect(() => {
    if (!time.open) return
    let raf = 0
    const tick = () => {
      const x = ((timeClock.t - view[0]) / (view[1] - view[0])) * 100
      if (playhead.current) {
        playhead.current.style.left = `${x}%`
        playhead.current.style.display = x < 0 || x > 100 ? 'none' : ''
      }
      if (readout.current) readout.current.textContent = clock(timeClock.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [time.open, view])

  // Wheel zooms around the cursor; shift-wheel (or a horizontal swipe) pans. Non-passive to stop page scroll.
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView(([a, b]) => {
        const w = b - a
        const pan = e.shiftKey ? e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0
        if (pan) return clampView(a + (pan / el.clientWidth) * w, w)
        const rect = el.getBoundingClientRect()
        const f = (e.clientX - rect.left) / rect.width
        const nw = clamp(w * Math.exp(e.deltaY * 0.002), MIN_VIEW, DAY)
        return clampView(a + f * w - f * nw, nw)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [time.open])

  // Lanes and labels don't depend on the playhead: memoized so a published t (several times a second
  // while playing) only updates the header, not one element per run.
  const labelRows = useMemo(
    () => (
      <>
        {rows.map(({ p, height }) => (
          <div
            key={p.id}
            className={`label ${lens && lens !== p.id ? 'off' : ''}`}
            style={{ height }}
            title={`${triggerLine(p.trigger)} — click to light up`}
            onClick={() => setLens(lens === p.id ? null : p.id)}
          >
            <span className="swatch" style={{ background: palette.pipeline(p.id) }} />
            <span className="name">{p.name}</span>
          </div>
        ))}
      </>
    ),
    [rows, lens, palette, setLens],
  )
  const laneRows = useMemo(() => {
    const pct = (t: number) => ((t - view[0]) / (view[1] - view[0])) * 100
    return (
      <>
          {rows.map(({ p, placed, emits, height }) => (
            <div key={p.id} className="lane-row" style={{ height, opacity: lens && lens !== p.id ? 0.3 : 1 }}>
              {placed.map(({ run, lane }) => {
                if (run.end < view[0] || run.start > view[1]) return null
                const left = clamp(pct(run.start), 0, 100)
                const width = Math.max(0.2, clamp(pct(run.end), 0, 100) - left)
                const name = names.get(run.taskId) ?? run.taskId
                const title = run.continuous
                  ? `${name} · streaming all day`
                  : `${name} · ${clock(run.start)}–${clock(run.end)} · ${dur(run.end - run.start)} (${dur(run.setup)} queue/start)${run.medallion ? ` · writes ${run.medallion}` : ''} · on ${clusterName.get(run.clusterId) ?? run.clusterId}${run.state && run.state !== 'success' ? ` · ${run.state}` : ''}${run.attempt ? ` (retry ${run.attempt})` : ''}`
                return (
                  <div
                    key={run.id}
                    data-run={run.id}
                    className={`bar ${run.continuous ? 'stream' : ''} ${run.state && run.state !== 'success' ? run.state : ''}`}
                    title={title}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: 3 + lane * (LANE + LANE_GAP),
                      height: LANE,
                      background: palette.pipeline(p.id),
                      borderLeftColor: run.medallion ? palette.medallion(run.medallion) : palette.pipeline(p.id),
                    }}
                  >
                    {!run.continuous && <div className="setup" style={{ width: `${(run.setup / (run.end - run.start)) * 100}%` }} />}
                  </div>
                )
              })}
              {emits.map((ev, i) =>
                ev.t < view[0] || ev.t > view[1] ? null : (
                  <span key={i} className="emit" style={{ left: `${pct(ev.t)}%` }} title={`${clock(ev.t)} emits ${ev.name}`}>◆</span>
                ),
              )}
            </div>
          ))}
      </>
    )
  }, [rows, view, lens, palette, names, clusterName])

  if (!time.open) return null

  const { span } = time
  const tAt = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect()
    return clamp(view[0] + ((clientX - r.left) / r.width) * (view[1] - view[0]), 0, DAY)
  }
  const pxOf = (t: number) => {
    const r = plot.current!.getBoundingClientRect()
    return r.left + (pct(t) / 100) * r.width
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const near = (t: number) => Math.abs(pxOf(t) - e.clientX) < 6
    const mode = span && near(span[0]) ? 'a' : span && near(span[1]) ? 'b' : 'new'
    const taskRun = (e.target as HTMLElement).closest<HTMLElement>('[data-run]')?.dataset.run
    drag.current = { x: e.clientX, t: tAt(e.clientX), mode, moved: false, taskRun }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 4)) return
    d.moved = true
    const t = tAt(e.clientX)
    const cur = useStore.getState().time.span
    if (d.mode === 'a' && cur) setTime({ span: [Math.min(t, cur[1] - 60), cur[1]] })
    else if (d.mode === 'b' && cur) setTime({ span: [cur[0], Math.max(t, cur[0] + 60)] })
    else setTime({ span: [Math.min(d.t, t), Math.max(d.t, t)] })
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      const s = useStore.getState().time.span
      if (s && s[1] - s[0] < 60) return setTime({ span: null })
      // Keep the playhead inside the new span.
      if (s && (timeClock.t < s[0] || timeClock.t > s[1])) setTime({ t: s[0] })
      return
    }
    const run = d.taskRun ? runById.get(d.taskRun) : undefined
    if (run) {
      focus(jobNodeId(run.taskId))
      setTime({ t: run.continuous ? tAt(e.clientX) : run.start })
      return
    }
    const t = tAt(e.clientX)
    setTime({ t, span: span && t >= span[0] && t <= span[1] ? span : null })
  }

  const end = span?.[1] ?? DAY
  const togglePlay = () => {
    const atEnd = timeClock.t >= end - 1
    setTime({ playing: !time.playing || atEnd, ...(atEnd ? { t: span?.[0] ?? 0 } : {}) })
  }

  const totalsWindow: [number, number] = span ?? [0, time.t]
  const totals = layerTotals(schedule, totalsWindow, lens)
  const events = eventsIn(schedule, timeWindow(time.t, span)).filter((ev) => !lens || ev.pipelineId === lens)
  const step = TICK_STEPS.find((s) => (view[1] - view[0]) / s <= 12) ?? TICK_STEPS.at(-1)!
  const ticks: number[] = []
  for (let t = Math.ceil(view[0] / step) * step; t <= view[1]; t += step) ticks.push(t)
  const zoomed = view[1] - view[0] < DAY

  return (
    <div className="timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <button title={time.playing ? 'Pause' : 'Play'} onClick={togglePlay}>{time.playing ? '⏸' : '▶'}</button>
        <button title="Simulated time per second" onClick={() => setTime({ speed: TIME_SPEEDS[(TIME_SPEEDS.indexOf(time.speed) + 1) % TIME_SPEEDS.length] })}>
          {speedLabel(time.speed)}
        </button>
        <button title="Camera follows the running jobs" className={time.follow ? 'on' : ''} onClick={() => setTime({ follow: !time.follow })}>
          Follow
        </button>
        <span className="clock" ref={readout}>{clock(time.t)}</span>
        {schedule.origin === 'snapshot' && (
          <span className="origin" title="Real job runs from a workspace snapshot">{schedule.day} · {schedule.tz}</span>
        )}
        {span && <span className="range">{clock(span[0])}–{clock(span[1])} · {dur(span[1] - span[0])}</span>}
        <span className="totals" title="Task run time by the medallion layer each task writes (streaming excluded)">
          {MEDALLIONS.map((m) => (
            <span key={m}>
              <i style={{ background: palette.medallion(m) }} />
              {m[0].toUpperCase()} {dur(totals[m])}
            </span>
          ))}
          <em>{span ? 'in span' : 'so far today'}</em>
        </span>
        <span className="spacer" />
        <button disabled={!span} onClick={() => span && setView(clampView(span[0] - (span[1] - span[0]) * 0.1, Math.max(MIN_VIEW, (span[1] - span[0]) * 1.2)))}>
          Zoom to span
        </button>
        <button disabled={!zoomed} onClick={() => setView([0, DAY])}>Full day</button>
        <button disabled={!span} onClick={() => setTime({ span: null })}>Clear span</button>
        <button className={showEvents ? 'on' : ''} onClick={() => setShowEvents(!showEvents)} title={span ? 'Events in the span' : 'Events in the last hour'}>
          Events {events.length}
        </button>
        <button title="Close" onClick={closeTimeline}>✕</button>
      </div>

      <div className="tl-body">
        <div className="labels">
          <div className="axis" />
          {labelRows}
        </div>
        <div className="plot" ref={plot} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <div className="axis">
            {ticks.map((t) => (
              // Edge ticks align inward so their labels aren't clipped.
              <span key={t} style={{ left: `${pct(t)}%`, transform: `translateX(${pct(t) < 3 ? 0 : pct(t) > 97 ? -100 : -50}%)` }}>{clock(t)}</span>
            ))}
          </div>
          {laneRows}
          {span && <div className="span" style={{ left: `${clamp(pct(span[0]), 0, 100)}%`, width: `${clamp(pct(span[1]), 0, 100) - clamp(pct(span[0]), 0, 100)}%` }} />}
          <div className="playhead" ref={playhead} />
        </div>
      </div>

      {showEvents && (
        <ul className="events">
          {events.length === 0 && <li className="empty">No events {span ? 'in the span' : 'in the last hour'}</li>}
          {events.slice(0, 300).map((ev, i) => (
            <li key={i} onClick={() => setTime({ t: ev.t })}>
              <span className="at">{clock(ev.t)}</span>
              <span className={`kind ${ev.kind}`}>{ev.kind}</span>
              <span className="swatch" style={{ background: palette.pipeline(ev.pipelineId) }} />
              <span className="name">{ev.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
