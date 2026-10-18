import { useShallow } from 'zustand/react/shallow'
import { litBy } from '../view/highlight'
import type { LitBy } from '../view/highlight'
import { nodeName } from '../view/nodes'
import { modeOf, useStore } from '../store'
import { MODES } from '../layout/modes'
import { usePalette } from '../theme/palette'
import { gradientCss } from '../theme/schemes'

/** What's lit, outermost first ("Timeline › orders_daily › orders"); ✕ clears one layer. */
export function LitByTrail() {
  const graph = useStore((s) => s.graph)
  const by = litBy(useStore(useShallow((s) => ({ time: s.time, lensPipeline: s.lensPipeline, focusedId: s.focusedId, pathOpen: s.pathOpen, pathEnds: s.pathEnds }))))
  const closeTimeline = useStore((s) => s.closeTimeline)
  const setLens = useStore((s) => s.setLens)
  const focus = useStore((s) => s.focus)
  const openPath = useStore((s) => s.openPath)
  if (!by.length) return null

  const crumb = (b: LitBy): [string, () => void] => {
    switch (b.kind) {
      case 'time':
        return ['Day', closeTimeline]
      case 'pipeline':
        return [graph.workflows.pipelines.find((p) => p.id === b.id)?.name ?? b.id, () => setLens(null)]
      case 'focus':
        return [nodeName(graph, b.id), () => focus(null)]
      case 'path':
        return ['Path', () => openPath(false)]
    }
  }
  return (
    <div className="lit-by">
      <span className="lit-by-label">Lit by</span>
      {by.map((b, i) => {
        const [label, clear] = crumb(b)
        return (
          <span key={b.kind} className="crumb">
            {i > 0 && <span className="sep">›</span>}
            <span className="crumb-name" title={label}>{label}</span>
            <button title={`Clear ${b.kind}`} onClick={clear}>✕</button>
          </span>
        )
      })}
    </div>
  )
}

/** Camera presets in the canvas corner. */
export function CameraCorner() {
  const camera = useStore((s) => s.camera)
  const mode = useStore((s) => modeOf(s.layout))
  return (
    <div className="camera-corner" role="group" aria-label="Camera">
      <button title="Three-quarter view" onClick={() => camera({ kind: 'preset', preset: 'iso' })}>Iso</button>
      <button title="Straight down" onClick={() => camera({ kind: 'preset', preset: 'top' })}>Top</button>
      <button title={mode === 'flow' ? 'Facing the slabs' : 'From the side'} onClick={() => camera({ kind: 'preset', preset: 'side' })}>{mode === 'flow' ? 'Front' : 'Side'}</button>
      <button title="Frame everything" onClick={() => camera({ kind: 'preset', preset: MODES[mode].defaultPreset })}>Fit</button>
    </div>
  )
}

/** While colors follow lineage depth: what dark and bright mean. */
export function DepthLegend() {
  const g = usePalette().depth
  if (!g) return null
  return (
    <div className="depth-legend" title="Colours follow lineage depth: how far downstream a table, job or pipeline sits">
      <span>upstream</span>
      <span className="strip" style={{ background: gradientCss(g) }} />
      <span>downstream</span>
    </div>
  )
}
