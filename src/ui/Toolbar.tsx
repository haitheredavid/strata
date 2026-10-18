import { useRef } from 'react'
import { modeOf, useStore } from '../store'
import type { ColumnDetail, EdgeLayer, GroupBy, Layout, ModeId } from '../model/types'
import { MODES } from '../layout/modes'
import { labsOn } from '../labs'
import { TablePicker } from './TablePicker'
import { openFiles } from './files'
import { DatasetMenu } from './DatasetMenu'
import { Menu } from './Menu'
import { COLOR_BY, SCHEMES, depthGradient, gradientCss } from '../theme/schemes'
import { PIPELINE_COLORS } from '../parse/workflows'
import { goTo, selectPipeline, showMode } from './select'

const DETAILS: [ColumnDetail, string][] = [['all', 'All'], ['keys', 'Keys'], ['header', 'Header']]
const GROUPS: [GroupBy, string][] = [['domain', 'Domain'], ['medallion', 'Medallion']]
const EDGES: [EdgeLayer, string][] = [['fk', 'FK'], ['lineage', 'Lineage'], ['both', 'Both']]
const LAB_LAYOUTS: ModeId[] = ['stack', 'orbit']

function Segmented<T extends string>({ options, value, onChange, disabled }: { options: [T, string][]; value: T; onChange: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <span className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} disabled={disabled?.(v)} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </span>
  )
}

export function Toolbar() {
  const graph = useStore((s) => s.graph)
  const setLayout = useStore((s) => s.setLayout)
  const mode = useStore((s) => modeOf(s.layout))
  const day = useStore((s) => s.time.open)
  const openTimeline = useStore((s) => s.openTimeline)
  const closeTimeline = useStore((s) => s.closeTimeline)
  const fileInput = useRef<HTMLInputElement>(null)
  const layoutInput = useRef<HTMLInputElement>(null)
  const hasPipelines = graph.workflows.pipelines.length > 0

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

      <TablePicker placeholder="Search tables, jobs, pipelines…  /" nodes="all" onPick={(id, kind) => (kind === 'pipeline' ? selectPipeline(id) : goTo(id))} />

      <div className="segmented" role="group" aria-label="View">
        <button className={day ? '' : 'on'} title="The lineage diagram on its own" onClick={closeTimeline}>Lineage</button>
        <button className={day ? 'on' : ''} disabled={!hasPipelines} title="A day of runs under the diagram (T)" onClick={() => !day && openTimeline()}>
          Day
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Diagram">
        <button className={mode === 'diagram' ? 'on' : ''} title="Flat lineage diagram, from above (1)" onClick={() => showMode('diagram')}>2D</button>
        <button className={mode === 'flow' ? 'on' : ''} title="Each domain stands up as a slab (2)" onClick={() => showMode('flow')}>3D</button>
      </div>
      <ViewMenu />

      <Menu label="⋯" title="Layout file" className="more">
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

/** How the diagram is drawn: grouping, edges, card detail, spacing, compute racks, and lab layouts. */
function ViewMenu() {
  const layout = useStore((s) => s.layout)
  const hasPipelines = useStore((s) => s.graph.workflows.pipelines.length > 0)
  const hasClusters = useStore((s) => s.graph.workflows.clusters.length > 0)
  const setGroupBy = useStore((s) => s.setGroupBy)
  const setEdgeLayer = useStore((s) => s.setEdgeLayer)
  const setColumnDetail = useStore((s) => s.setColumnDetail)
  const setLayerGap = useStore((s) => s.setLayerGap)
  const toggleCompute = useStore((s) => s.toggleCompute)
  const resetLayout = useStore((s) => s.resetLayout)
  const buildUpOn = useStore((s) => s.buildUpOn)
  const setBuildUpOn = useStore((s) => s.setBuildUpOn)
  const playBuildUp = useStore((s) => s.playBuildUp)
  const mode = modeOf(layout)
  const lineage = (layout.edgeLayer ?? 'both') !== 'fk'

  return (
    <Menu label="View ▾" title="Grouping, edges, card detail and spacing" className="view-menu">
      {(close) => (
        <div className="view-pop">
          <div className="row">Group by <Segmented options={GROUPS} value={layout.groupBy ?? 'domain'} onChange={setGroupBy} /></div>
          <div className="row">
            Edges
            <Segmented options={EDGES} value={layout.edgeLayer ?? 'both'} onChange={setEdgeLayer} disabled={(v) => v !== 'fk' && !hasPipelines} />
          </div>
          <div className="row">Columns <Segmented options={DETAILS} value={layout.columnDetail ?? 'all'} onChange={setColumnDetail} /></div>
          <label className="row gap">
            {MODES[mode].gapLabel} <span>{layout.layerGap.toFixed(0)}</span>
            <input type="range" min={2} max={30} step={1} value={layout.layerGap} onChange={(e) => setLayerGap(Number(e.target.value))} />
          </label>
          {hasClusters && (
            <div className="row">
              <span title="The clusters jobs run on, drawn under the diagram">Compute racks</span>
              <Segmented
                options={[['on', 'Shown'], ['off', 'Hidden']]}
                value={lineage && (layout.showCompute ?? true) ? 'on' : 'off'}
                onChange={(v) => (v === 'on') !== (layout.showCompute ?? true) && toggleCompute()}
                disabled={() => !lineage}
              />
            </div>
          )}
          <div className="row">
            <span>Arrangement</span>
            <button onClick={resetLayout} disabled={mode === 'orbit'} title="Re-run the automatic layout, dropping dragged positions and domain order">Auto layout</button>
          </div>
          <div className="row">
            <span title="Opening a dataset fades its nodes in one by one, upstream first. A click or key skips to the end.">Build-up on open</span>
            <span className="build-up">
              <button title="Play the build-up now" onClick={() => (close(), playBuildUp(true))}>Replay</button>
              <Segmented options={[['on', 'On'], ['off', 'Off']]} value={buildUpOn ? 'on' : 'off'} onChange={(v) => setBuildUpOn(v === 'on')} />
            </span>
          </div>
          {labsOn() && (
            <div className="row">
              <span title="Experimental layouts (labs)">Labs</span>
              <span className="segmented">
                {LAB_LAYOUTS.map((id) => (
                  <button key={id} className={mode === id ? 'on' : ''} onClick={() => showMode(id)}>{MODES[id].label}</button>
                ))}
              </span>
            </div>
          )}
          <ColourSection />
          <p className="hint">
            / search · T day · 1 2D · 2 3D{labsOn() ? ' · 3 Stack · 4 Orbit' : ''} · Esc clears one step · click selects · Shift-click a second table for join paths · double-click folds a card · right-drag pans
          </p>
        </div>
      )}
    </Menu>
  )
}

/** The categorical default's swatch: its first pipeline colors as stripes. */
const DEFAULT_SWATCH = `linear-gradient(90deg, ${PIPELINE_COLORS.slice(0, 6).flatMap((c, i, a) => [`${c} ${(i / a.length) * 100}%`, `${c} ${((i + 1) / a.length) * 100}%`]).join(', ')})`

/** Color scheme (a swatch per scheme) and what colors mean: identity, or how far downstream. */
function ColourSection() {
  const scheme = useStore((s) => s.colorScheme)
  const colorBy = useStore((s) => s.colorBy)
  const setColorScheme = useStore((s) => s.setColorScheme)
  const setColorBy = useStore((s) => s.setColorBy)
  return (
    <>
      <div className="view-head">Colours</div>
      <div className="row">
        <span title="Domain & pipeline: each has its own colour. Lineage depth: sources dark, the most downstream tables bright.">Colour by</span>
        <Segmented options={COLOR_BY} value={colorBy} onChange={setColorBy} />
      </div>
      <div className="schemes" role="radiogroup" aria-label="Colour scheme">
        {SCHEMES.map(([id, label]) => (
          <button
            key={id}
            role="radio"
            aria-checked={scheme === id}
            className={`scheme${scheme === id ? ' current' : ''}`}
            title={id === 'default' && colorBy === 'depth' ? 'Default draws depth with Viridis' : label}
            onClick={() => setColorScheme(id)}
          >
            <span className="strip" style={{ background: id === 'default' ? (colorBy === 'depth' ? gradientCss(depthGradient(id)) : DEFAULT_SWATCH) : gradientCss(id) }} />
            {label}
          </button>
        ))}
      </div>
    </>
  )
}
