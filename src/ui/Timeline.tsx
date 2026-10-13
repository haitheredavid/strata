import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { runSteps } from '../view/runOrder'
import { runClock, TRIGGER_LABEL } from '../scene/runClock'
import type { Trigger } from '../model/workflow'

const SPEEDS = [0.5, 1, 2]

const triggerLine = (t?: Trigger) => {
  if (!t) return 'no trigger'
  const d = t.kind === 'schedule' ? t.cron : t.kind === 'file_arrival' ? t.path : t.kind === 'table_update' ? t.tables.join(', ') : t.kind === 'job' ? t.pipeline : ''
  return `${TRIGGER_LABEL[t.kind]} ${d}`.trim()
}

/** Run playback controls: play / pause / step, speed, camera follow, and a scrubber with one tick per step. */
export function Timeline() {
  const run = useStore((s) => s.run)
  const pipelines = useStore((s) => s.graph.workflows.pipelines)
  const updateRun = useStore((s) => s.updateRun)
  const stopRun = useStore((s) => s.stopRun)
  const pipeline = pipelines.find((p) => p.id === run?.pipelineId)
  const steps = useMemo(() => (pipeline ? runSteps(pipeline).steps : []), [pipeline])
  const names = useMemo(() => new Map(pipeline?.tasks.map((t) => [t.id, t.name])), [pipeline])

  // Mirror the fractional clock for the active step's progress bar.
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!run) return
    let raf = 0
    const tick = () => {
      setT(runClock.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run])

  if (!run || !pipeline) return null

  const seek = (k: number) => {
    const step = Math.max(0, Math.min(steps.length - 1, k))
    runClock.t = step
    updateRun({ step, playing: false })
  }
  const atEnd = run.step >= steps.length - 1 && t >= steps.length - 0.01
  const togglePlay = () => {
    if (atEnd) runClock.t = 0
    updateRun({ playing: !run.playing || atEnd, step: atEnd ? 0 : run.step })
  }

  return (
    <div className="timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="swatch" style={{ background: pipeline.color, width: 10, height: 10, borderRadius: 3, display: 'inline-block' }} />
        <span className="title">{pipeline.name}</span>
        <span className="trig">{triggerLine(pipeline.trigger)}</span>
        <button title="Previous step" onClick={() => seek(run.step - 1)} disabled={run.step === 0}>⏮</button>
        <button title={run.playing ? 'Pause' : 'Play'} onClick={togglePlay}>{run.playing ? '⏸' : '▶'}</button>
        <button title="Next step" onClick={() => seek(run.step + 1)} disabled={run.step >= steps.length - 1}>⏭</button>
        <button title="Speed" onClick={() => updateRun({ speed: SPEEDS[(SPEEDS.indexOf(run.speed) + 1) % SPEEDS.length] })}>
          {run.speed}×
        </button>
        <button title="Camera follows the active step" className={run.follow ? 'on' : ''} onClick={() => updateRun({ follow: !run.follow })}>
          Follow
        </button>
        <button title="Close" onClick={stopRun}>✕</button>
      </div>
      <div className="track">
        {steps.map((ids, k) => {
          const state = k < run.step ? 'done' : k === run.step ? 'active' : ''
          const fill = k < run.step ? 1 : k === run.step ? Math.max(0.04, t - k) : 0
          return (
            <div key={k} className={`step ${state}`} onClick={() => seek(k)} title={ids.map((id) => names.get(id)).join(', ')}>
              <div className="fill" style={{ background: pipeline.color, width: `${fill * 100}%`, opacity: k < run.step ? 0.3 : 0.85 }} />
              <span>
                {k + 1}. {ids.map((id) => names.get(id) ?? id).join(' + ')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
