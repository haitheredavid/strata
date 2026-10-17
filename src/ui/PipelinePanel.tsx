import { useState } from 'react'
import { useStore } from '../store'
import { TRIGGER_LABEL } from '../scene/timeClock'
import { usePalette } from '../theme/palette'

/** Lists longer than this get a filter box. */
const FILTER_AT = 12

/** Pipelines from DBML notes and the workflow file: show / hide / solo, light one up, or play its day. */
export function PipelinePanel() {
  const workflows = useStore((s) => s.graph.workflows)
  const hidden = useStore((s) => s.layout.hiddenPipelines) ?? []
  const lineage = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk')
  const lens = useStore((s) => s.lensPipeline)
  const timeline = useStore((s) => s.time.open)
  const togglePipeline = useStore((s) => s.togglePipeline)
  const soloPipeline = useStore((s) => s.soloPipeline)
  const tablesOnly = useStore((s) => s.layout.pipelineTablesOnly ?? false)
  const toggleTablesOnly = useStore((s) => s.togglePipelineTablesOnly)
  const setHidden = useStore((s) => s.setHiddenPipelines)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const listed = q ? workflows.pipelines.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)) : workflows.pipelines
  const solo = (id: string) => hidden.length === workflows.pipelines.length - 1 && !hidden.includes(id)
  const setLens = useStore((s) => s.setLens)
  const openTimeline = useStore((s) => s.openTimeline)
  const setEdgeLayer = useStore((s) => s.setEdgeLayer)
  const showCompute = useStore((s) => s.layout.showCompute ?? true)
  const toggleCompute = useStore((s) => s.toggleCompute)
  const palette = usePalette()

  return (
    <details open>
      <summary>Pipelines</summary>
      {workflows.pipelines.length > FILTER_AT && (
        <div className="row">
          <input className="filter" placeholder={`Filter ${workflows.pipelines.length} pipelines…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button title="Show these" onClick={() => setHidden(hidden.filter((id) => !listed.some((p) => p.id === id)))}>All</button>
          <button title="Hide these" onClick={() => setHidden([...new Set([...hidden, ...listed.map((p) => p.id)])])}>None</button>
        </div>
      )}
      {workflows.pipelines.length > 0 && (
        <div className="row">
          <span title="Leave out tables that no visible pipeline reads or writes">Tables</span>
          <button className={tablesOnly ? '' : 'on'} disabled={!lineage} onClick={() => tablesOnly && toggleTablesOnly()}>All</button>
          <button className={tablesOnly ? 'on' : ''} disabled={!lineage} onClick={() => !tablesOnly && toggleTablesOnly()}>In visible pipelines</button>
        </div>
      )}
      <ul className="pipelines">
        {listed.map((p) => {
          const off = hidden.includes(p.id) || !lineage
          return (
            <li key={p.id} className={off ? 'off' : ''} title={p.tasks.map((t) => t.name).join(' → ')}>
              <span className="swatch" style={{ background: palette.pipeline(p.id) }} />
              <span className="name">{p.name}</span>
              {p.trigger && <span className="trig">{TRIGGER_LABEL[p.trigger.kind]}</span>}
              <span className="count">{p.tasks.length}</span>
              <button title={hidden.includes(p.id) ? 'Show' : 'Hide'} onClick={() => togglePipeline(p.id)}>
                {hidden.includes(p.id) ? '○' : '●'}
              </button>
              <button title={solo(p.id) ? 'Show all pipelines' : 'Show only this pipeline'} className={solo(p.id) ? 'on' : ''} onClick={() => soloPipeline(p.id)}>
                ◐
              </button>
              <button
                title="Light up this pipeline"
                className={lens === p.id ? 'on' : ''}
                onClick={() => {
                  if (!lineage) setEdgeLayer('both')
                  setLens(lens === p.id ? null : p.id)
                }}
              >
                ◎
              </button>
              <button
                title="Play its day on the timeline"
                className={timeline && lens === p.id ? 'on' : ''}
                onClick={() => {
                  if (!lineage) setEdgeLayer('both')
                  openTimeline(p.id)
                }}
              >
                ▶
              </button>
            </li>
          )
        })}
      </ul>
      {lineage && workflows.pipelines.length > 0 && (
        <div className="row legend" title="Bytes come from a task's `bytes:` in the workflow file, else are simulated">
          Pulses: size = bytes per run · count = runs per day
        </div>
      )}
      {workflows.clusters.length > 0 && (
        <div className="row">
          <span title="The clusters jobs run on, drawn under the diagram">Compute · {workflows.clusters.length} clusters</span>
          <button className={showCompute && lineage ? 'on' : ''} disabled={!lineage} onClick={toggleCompute}>
            {showCompute ? 'Shown' : 'Hidden'}
          </button>
        </div>
      )}
    </details>
  )
}
