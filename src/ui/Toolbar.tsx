import { useRef } from 'react'
import { modeOf, useStore } from '../store'
import type { Layout } from '../model/types'
import { MODES, MODE_IDS } from '../layout/modes'
import { TablePicker } from './TablePicker'
import { openFiles } from './files'
import { DatasetMenu } from './DatasetMenu'
import { Menu } from './Menu'
import { SCHEMES } from '../theme/schemes'

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
  const colorScheme = useStore((s) => s.colorScheme)
  const setColorScheme = useStore((s) => s.setColorScheme)
  const fileInput = useRef<HTMLInputElement>(null)
  const layoutInput = useRef<HTMLInputElement>(null)

  const go = (id: string) => {
    focus(id)
    camera({ kind: 'fly', id })
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

      <DatasetMenu />
      <button onClick={() => fileInput.current?.click()} title="Open a workspace snapshot, a .dbml schema (with its workflow file), a workflow file for the open schema, or a layout">
        Open…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.dbml,.txt,.yaml,.yml"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          await openFiles(files)
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
      <TablePicker placeholder="Find… ( / )" nodes="all" onPick={go} />
      <button className={pathOpen ? 'on' : ''} disabled={!graph.tables.length} onClick={() => openPath(!pathOpen)}>
        Path
      </button>
      <button
        className={timeline ? 'on' : ''}
        disabled={!graph.workflows.pipelines.length}
        title="Scrub a simulated day of pipeline runs"
        onClick={() => (timeline ? closeTimeline() : openTimeline())}
      >
        Timeline
      </button>

      <div className="spacer" />
      <button onClick={resetLayout} disabled={mode === 'orbit'}>Auto layout</button>
      <Menu label="⋯" title="Layout file and colours" className="more">
        {(close) => (
          <>
            <div className="menu-head">Layout</div>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close()
                exportLayout()
              }}
            >
              Export layout
            </button>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close()
                layoutInput.current?.click()
              }}
            >
              Import layout…
            </button>
            <div className="menu-head">Colours</div>
            {SCHEMES.map(([id, label]) => (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={colorScheme === id}
                className={`menu-item${colorScheme === id ? ' current' : ''}`}
                onClick={() => {
                  close()
                  setColorScheme(id)
                }}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </Menu>
      <input
        ref={layoutInput}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            setLayout(JSON.parse(await f.text()) as Layout)
          } catch {
            useStore.getState().notify('error', `Couldn't read ${f.name} as a layout file`)
          }
        }}
      />
    </div>
  )
}
