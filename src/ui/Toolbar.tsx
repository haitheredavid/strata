import { useRef } from 'react'
import { modeOf, useStore } from '../store'
import type { Layout } from '../model/types'
import { MODES, MODE_IDS } from '../layout/modes'
import { TablePicker } from './TablePicker'
import { SAMPLES, loadFiles, loadSample } from './files'

export function Toolbar() {
  const graph = useStore((s) => s.graph)
  const camera = useStore((s) => s.camera)
  const focus = useStore((s) => s.focus)
  const setLayout = useStore((s) => s.setLayout)
  const resetLayout = useStore((s) => s.resetLayout)
  const mode = useStore((s) => modeOf(s.layout))
  const setMode = useStore((s) => s.setMode)
  const pathOpen = useStore((s) => s.pathOpen)
  const openPath = useStore((s) => s.openPath)
  const timeline = useStore((s) => s.time.open)
  const openTimeline = useStore((s) => s.openTimeline)
  const closeTimeline = useStore((s) => s.closeTimeline)
  const dbmlInput = useRef<HTMLInputElement>(null)
  const workflowInput = useRef<HTMLInputElement>(null)
  const hasSchema = graph.tables.length > 0
  const layoutInput = useRef<HTMLInputElement>(null)

  const go = (id: string) => {
    focus(id)
    camera({ kind: 'fly', tableId: id })
  }

  const exportLayout = () => {
    const blob = new Blob([JSON.stringify(useStore.getState().layout, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'layout.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="toolbar">
      <span className="brand">strata</span>

      <select className="sample" value="" onChange={(e) => e.target.value && loadSample(e.target.value)} title="Load a sample schema">
        <option value="">Samples…</option>
        {SAMPLES.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <button onClick={() => dbmlInput.current?.click()} title="Pick a .dbml file, optionally with its workflows .yaml/.json">
        Open DBML
      </button>
      <input
        ref={dbmlInput}
        type="file"
        accept=".dbml,.txt,.yaml,.yml,.json"
        multiple
        hidden
        onChange={async (e) => {
          if (e.target.files) await loadFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button disabled={!hasSchema} onClick={() => workflowInput.current?.click()} title="Load a pipelines / jobs file for this schema">
        Open workflows
      </button>
      <input
        ref={workflowInput}
        type="file"
        accept=".yaml,.yml,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) useStore.getState().loadSidecar(await f.text())
          e.target.value = ''
        }}
      />

      <div className="sep" />
      <div className="segmented" role="group" aria-label="Layout mode">
        {MODE_IDS.map((id) => (
          <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>
            {MODES[id].label}
          </button>
        ))}
      </div>

      <div className="sep" />
      <button onClick={() => camera({ kind: 'preset', preset: 'iso' })}>Iso</button>
      <button onClick={() => camera({ kind: 'preset', preset: 'top' })}>Top</button>
      <button onClick={() => camera({ kind: 'preset', preset: 'side' })}>{mode === 'flow' ? 'Front' : 'Side'}</button>

      <div className="sep" />
      <TablePicker placeholder="Find table…" onPick={go} />
      <button className={pathOpen ? 'on' : ''} disabled={!graph.tables.length} onClick={() => openPath(!pathOpen)}>
        Path
      </button>
      <button
        className={timeline ? 'on' : ''}
        disabled={!graph.workflows.pipelines.length}
        title="Scrub a simulated day of pipeline runs"
        onClick={() => {
          if (timeline) return closeTimeline()
          if ((useStore.getState().layout.edgeLayer ?? 'both') === 'fk') useStore.getState().setEdgeLayer('both')
          openTimeline()
        }}
      >
        Timeline
      </button>

      <div className="spacer" />
      <button onClick={resetLayout} disabled={mode === 'orbit'}>Auto layout</button>
      <button onClick={exportLayout}>Export layout</button>
      <button onClick={() => layoutInput.current?.click()}>Import layout</button>
      <input
        ref={layoutInput}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) {
            try {
              setLayout(JSON.parse(await f.text()) as Layout)
            } catch {
              useStore.setState({ error: 'Could not read layout file' })
            }
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}
