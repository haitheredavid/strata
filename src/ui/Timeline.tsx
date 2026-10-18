import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { scheduleOf, TIME_SPEEDS, useStore } from '../store'
import { timeClock } from '../scene/timeClock'
import { timeWindow } from '../scene/usePlacement'
import { clockOf, daySeconds, eventsIn, layerTotals, packLanes, span as dur, taskRunsIn } from '../sim/schedule'
import { MEDALLIONS } from '../model/workflow'
import { hiddenPipelinesOf, jobNodeId } from '../view/deriveView'
import { listLabels } from '../view/labels'
import { usePalette } from '../theme/palette'
import { triggerLine } from './describe'
import { goTo, selectPipeline } from './select'

const LANE = 8
const LANE_GAP = 2
/** Lanes per row at most: runs packed deeper draw in the last lane, overlapping. */
const MAX_LANES = 3
/** Height of the "N with no runs today" row. */
const IDLE_H = 18
const MIN_VIEW = 900
const TICK_STEPS = [900, 1800, 3600, 7200, 10800, 21600]
/** How far (px) a click may miss a bar and still pick it: bars of short runs are only a few px wide. */
const HIT_SLOP = 6

/** Playback rate as a multiple of real time: `×1800`. */
const speedLabel = (v: number) => `×${v.toLocaleString('en-US')}`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampView = (a: number, w: number, len: number): [number, number] => {
  const start = clamp(a, 0, len - w)
  return [start, start + w]
}

const DAY_H_KEY = 'strata:dayHeight'
const DAY_H = 280
const DAY_MIN = 120

function savedHeight() {
  try {
    return Number(localStorage.getItem(DAY_H_KEY)) || DAY_H
  } catch {
    return DAY_H
  }
}

/** The Day view's dock under the diagram: the timeline, resized by dragging its top edge. */
export function DayDock() {
  const open = useStore((s) => s.time.open)
  const [height, setHeight] = useState(savedHeight)
  const drag = useRef<{ y: number; h: number } | null>(null)
  if (!open) return null
  const max = () => Math.max(DAY_MIN, window.innerHeight - 220)
  return (
    <div className="day" style={{ height: clamp(height, DAY_MIN, max()) }}>
      <div
        className="day-resize"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, h: height }
        }}
        onPointerMove={(e) => drag.current && setHeight(clamp(drag.current.h + drag.current.y - e.clientY, DAY_MIN, max()))}
        onPointerUp={() => {
          drag.current = null
          try {
            localStorage.setItem(DAY_H_KEY, String(Math.round(height)))
          } catch {
            /* not remembered */
          }
        }}
      />
      <Timeline />
    </div>
  )
}

interface Drag { x: number; t: number; mode: 'new' | 'a' | 'b'; moved: boolean; taskRun?: string }

/**
 * The simulated day across every pipeline: one row per pipeline in order of its first run (those with
 * none folded into one row), a bar per task run in up to three lanes (hatched head =
 * queue / cluster start, left edge = medallion layer written, ◆ = emitted event). Click to move the
 * playhead, drag to select a span (drag its edges to adjust), wheel to zoom, shift-wheel to pan.
 */
function Timeline() {
  const time = useStore((s) => s.time)
  const graph = useStore((s) => s.graph)
  const palette = usePalette()
  const hiddenPipelines = useStore((s) => s.layout.hiddenPipelines)
  const onlyPipeline = useStore((s) => s.layout.onlyPipeline)
  const lens = useStore((s) => s.lensPipeline)
  const setTime = useStore((s) => s.setTime)
  const setLens = useStore((s) => s.setLens)
  const schedule = useStore(scheduleOf)
  // Snapshot days across a DST change are 23 or 25 hours long, and their clock is the zone's wall clock.
  const len = daySeconds(schedule)
  const clock = useMemo(() => clockOf(schedule), [schedule])
  const [view, setView] = useState<[number, number]>([0, len])
  const [viewLen, setViewLen] = useState(len)
  if (viewLen !== len) {
    setViewLen(len)
    setView([0, len])
  }
  const [showEvents, setShowEvents] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const drag = useRef<Drag | null>(null)

  const names = useMemo(() => new Map(graph.workflows.pipelines.flatMap((p) => p.tasks).map((t) => [t.id, t.name])), [graph])
  const labels = useMemo(() => listLabels(graph.workflows.pipelines.map((p) => p.name)), [graph])
  const allRows = useMemo(() => {
    // Hidden pipelines get no row, so an "only this" pipeline isn't lost among the rest.
    const hidden = new Set(hiddenPipelinesOf({ graph, hiddenPipelines, onlyPipeline }))
    return graph.workflows.pipelines.filter((p) => !hidden.has(p.id)).map((p) => {
      const runs = schedule.taskRuns.filter((r) => r.pipelineId === p.id)
      const placed = packLanes(runs).map((x) => ({ ...x, lane: Math.min(x.lane, MAX_LANES - 1) }))
      const lanes = Math.max(1, ...placed.map((x) => x.lane + 1))
      const emits = schedule.events.filter((e) => e.kind === 'emit' && e.pipelineId === p.id)
      const first = runs.reduce((t, r) => Math.min(t, r.start), Infinity)
      return { p, placed, emits, first, height: lanes * (LANE + LANE_GAP) + 6 }
    })
  }, [graph, schedule, hiddenPipelines, onlyPipeline])
  const [rowQuery, setRowQuery] = useState('')
  const [litOnly, setLitOnly] = useState(false)
  const [showIdle, setShowIdle] = useState(false)
  // "Lit only": the lens pipeline, else the pipelines that ran in the window, as a string key so the
  // rows only rebuild when that set changes, not on every published playhead move.
  const litKey = !litOnly
    ? null
    : lens ?? [...new Set(taskRunsIn(schedule, timeWindow(time.t, time.span)).map((r) => r.pipelineId))].sort().join('\n')
  // Like a Gantt chart: pipelines by their first run, then the ones with no runs today folded into one row.
  const { ran, idle } = useMemo(() => {
    const q = rowQuery.trim().toLowerCase()
    const lit = litKey === null ? null : new Set(litKey.split('\n'))
    const kept = allRows.filter((r) => (!q || r.p.name.toLowerCase().includes(q)) && (!lit || lit.has(r.p.id)))
    return {
      ran: kept.filter((r) => r.placed.length).sort((a, b) => a.first - b.first || a.p.name.localeCompare(b.p.name)),
      idle: kept.filter((r) => !r.placed.length).sort((a, b) => a.p.name.localeCompare(b.p.name)),
    }
  }, [allRows, rowQuery, litKey])
  const rows = useMemo(() => (showIdle ? [...ran, ...idle] : ran), [ran, idle, showIdle])
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
  }, [time.open, view, clock])

  // Wheel zooms around the cursor; shift-wheel (or a horizontal swipe) pans. Non-passive to stop page scroll.
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView(([a, b]) => {
        const w = b - a
        const pan = e.shiftKey ? e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0
        if (pan) return clampView(a + (pan / el.clientWidth) * w, w, len)
        const rect = el.getBoundingClientRect()
        const f = (e.clientX - rect.left) / rect.width
        const nw = clamp(w * Math.exp(e.deltaY * 0.002), MIN_VIEW, len)
        return clampView(a + f * w - f * nw, nw, len)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [time.open, len])

  // Lanes and labels don't depend on the playhead: memoized so a published t (several times a second
  // while playing) only updates the header, not one element per run.
  const labelRows = useMemo(() => {
    const label = ({ p, height }: (typeof rows)[number]) => {
      const { short, rest } = labels.get(p.name) ?? { short: p.name, rest: '' }
      return (
        <div
          key={p.id}
          className={`label ${lens && lens !== p.id ? 'off' : ''}`}
          style={{ height }}
          title={`${p.name}\n${triggerLine(p.trigger)} — click to select`}
          onClick={() => (lens === p.id ? setLens(null) : selectPipeline(p.id))}
        >
          <span className="swatch" style={{ background: palette.pipeline(p.id) }} />
          <span className="name">
            {short}
            {rest && <span className="rest">{rest}</span>}
          </span>
        </div>
      )
    }
    return (
      <>
        {ran.map(label)}
        {idle.length > 0 && (
          <div
            className="label idle"
            style={{ height: IDLE_H }}
            title={showIdle ? 'Fold the pipelines with no runs today' : idle.map((r) => r.p.name).join('\n')}
            onClick={() => setShowIdle(!showIdle)}
          >
            {showIdle ? '▾' : '▸'} {idle.length} with no runs today
          </div>
        )}
        {showIdle && idle.map(label)}
      </>
    )
  }, [ran, idle, showIdle, labels, lens, palette, setLens])
  const laneRows = useMemo(() => {
    const pct = (t: number) => ((t - view[0]) / (view[1] - view[0])) * 100
    const laneRow = ({ p, placed, emits, height }: (typeof rows)[number]) => (
      <div key={p.id} className="lane-row" data-pipeline={p.id} style={{ height, opacity: lens && lens !== p.id ? 0.3 : 1 }}>
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
    )
    return (
      <>
        {ran.map(laneRow)}
        {idle.length > 0 && <div className="lane-row idle" style={{ height: IDLE_H }} />}
        {showIdle && idle.map(laneRow)}
      </>
    )
  }, [ran, idle, showIdle, view, lens, palette, names, clusterName, clock])

  if (!time.open) return null

  const { span } = time
  const tAt = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect()
    return clamp(view[0] + ((clientX - r.left) / r.width) * (view[1] - view[0]), 0, len)
  }
  const pxOf = (t: number) => {
    const r = plot.current!.getBoundingClientRect()
    return r.left + (pct(t) / 100) * r.width
  }

  /** The run under the pointer: the bar hit, else the nearest bar within reach on the same lane. */
  const runAt = (e: PointerEvent<HTMLDivElement>): string | undefined => {
    const target = e.target as HTMLElement
    const hit = target.closest<HTMLElement>('[data-run]')?.dataset.run
    if (hit) return hit
    const rowEl = target.closest<HTMLElement>('[data-pipeline]')
    const row = rowEl && rows.find((r) => r.p.id === rowEl.dataset.pipeline)
    if (!rowEl || !row) return
    const lane = Math.floor((e.clientY - rowEl.getBoundingClientRect().top - 3) / (LANE + LANE_GAP))
    let best: string | undefined
    let bestPx = HIT_SLOP
    for (const { run, lane: l } of row.placed) {
      if (l !== lane) continue
      const px = Math.max(0, pxOf(run.start) - e.clientX, e.clientX - pxOf(run.end))
      if (px <= bestPx) [best, bestPx] = [run.id, px]
    }
    return best
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const near = (t: number) => Math.abs(pxOf(t) - e.clientX) < 6
    const mode = span && near(span[0]) ? 'a' : span && near(span[1]) ? 'b' : 'new'
    drag.current = { x: e.clientX, t: tAt(e.clientX), mode, moved: false, taskRun: runAt(e) }
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
      goTo(jobNodeId(run.taskId))
      setTime({ t: run.continuous ? tAt(e.clientX) : run.start })
      return
    }
    const t = tAt(e.clientX)
    setTime({ t, span: span && t >= span[0] && t <= span[1] ? span : null })
  }

  const end = span?.[1] ?? len
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
  const zoomed = view[1] - view[0] < len

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
        {schedule.origin === 'snapshot' ? (
          <span className="origin" title="Real job runs from a workspace snapshot">{schedule.day} · {schedule.tz}</span>
        ) : (
          <span className="origin" title="Runs generated from each pipeline's trigger and the medallion layer it writes; load a workspace snapshot for real ones">
            simulated day
          </span>
        )}
        {span && (
          <span className="range" title="The span lights everything that ran in it; Esc or ✕ goes back to the hour before the playhead">
            {clock(span[0])}–{clock(span[1])} · {dur(span[1] - span[0])}
            <button title="Clear the span" onClick={() => setTime({ span: null })}>✕</button>
          </span>
        )}
        <span className="totals" title={`Task run time by the medallion layer each task writes (streaming excluded), ${span ? 'in the span' : 'so far today'}`}>
          {MEDALLIONS.map((m) => (
            <span key={m}>
              <i style={{ background: palette.medallion(m) }} />
              {m[0].toUpperCase()} {dur(totals[m])}
            </span>
          ))}
        </span>
        <span className="spacer" />
        {zoomed ? (
          <button onClick={() => setView([0, len])}>Full day</button>
        ) : (
          <button disabled={!span || span[1] - span[0] >= len} onClick={() => span && setView(clampView(span[0] - (span[1] - span[0]) * 0.1, Math.min(len, Math.max(MIN_VIEW, (span[1] - span[0]) * 1.2)), len))}>
            Zoom to span
          </button>
        )}
        <button
          className={litOnly ? 'on' : ''}
          onClick={() => setLitOnly(!litOnly)}
          title={lens ? 'Only the lit pipeline' : span ? 'Only pipelines that ran in the span' : 'Only pipelines that ran in the last hour'}
        >
          Lit only
        </button>
        <button className={showEvents ? 'on' : ''} onClick={() => setShowEvents(!showEvents)} title={span ? 'Events in the span' : 'Events in the last hour'}>
          Events {events.length}
        </button>
      </div>

      <div className="tl-body">
        <div className="labels">
          <div className="axis">
            <input className="row-filter" placeholder={`Filter ${allRows.length} rows…`} value={rowQuery} onChange={(e) => setRowQuery(e.target.value)} />
          </div>
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
