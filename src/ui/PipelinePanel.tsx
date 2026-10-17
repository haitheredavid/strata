import { Fragment, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { Graph } from '../model/types'
import type { Pipeline, Trigger } from '../model/workflow'
import { TRIGGER_LABEL } from '../scene/timeClock'
import { usePalette } from '../theme/palette'
import { hiddenPipelinesOf } from '../view/deriveView'

/** Lists longer than this get a filter box. */
const FILTER_AT = 12

/** Pipelines from DBML notes and the workflow file: show / hide / only this, light one up, or play its day. */
export function PipelinePanel() {
  const workflows = useStore((s) => s.graph.workflows)
  const graph = useStore((s) => s.graph)
  const hidden = useStore((s) => s.layout.hiddenPipelines) ?? []
  const only = useStore((s) => s.layout.onlyPipeline)
  const lineage = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk')
  const lens = useStore((s) => s.lensPipeline)
  const timeline = useStore((s) => s.time.open)
  const togglePipeline = useStore((s) => s.togglePipeline)
  const onlyPipeline = useStore((s) => s.onlyPipeline)
  const tablesOnly = useStore((s) => s.layout.pipelineTablesOnly ?? false)
  const toggleTablesOnly = useStore((s) => s.togglePipelineTablesOnly)
  const setHidden = useStore((s) => s.setHiddenPipelines)
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('trigger')
  const q = query.trim().toLowerCase()
  const listed = q ? workflows.pipelines.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : workflows.pipelines
  const shownOff = new Set(hiddenPipelinesOf({ graph, hiddenPipelines: hidden, onlyPipeline: only }))
  const many = workflows.pipelines.length > FILTER_AT
  const groups = useMemo(() => groupPipelines(listed, many ? grouping : 'none', graph), [listed, many, grouping, graph])
  const setLens = useStore((s) => s.setLens)
  const openTimeline = useStore((s) => s.openTimeline)
  const showCompute = useStore((s) => s.layout.showCompute ?? true)
  const toggleCompute = useStore((s) => s.toggleCompute)
  const palette = usePalette()

  return (
    <details open>
      <summary>Pipelines</summary>
      {many && (
        <>
          <div className="row">
            <input className="filter" placeholder={`Filter ${workflows.pipelines.length} pipelines…`} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button title="Show these" onClick={() => setHidden(hidden.filter((id) => !listed.some((p) => p.id === id)))}>All</button>
            <button title="Hide these" onClick={() => setHidden([...new Set([...hidden, ...listed.map((p) => p.id)])])}>None</button>
          </div>
          <div className="row">
            Group
            <span className="segmented">
              {GROUPINGS.map(([g, label]) => (
                <button key={g} className={grouping === g ? 'on' : ''} onClick={() => setGrouping(g)}>{label}</button>
              ))}
            </span>
          </div>
        </>
      )}
      {workflows.pipelines.length > 0 && (
        <div className="row">
          <span title="Leave out tables that no visible pipeline reads or writes">Tables</span>
          <button className={tablesOnly ? '' : 'on'} disabled={!lineage} onClick={() => tablesOnly && toggleTablesOnly()}>All</button>
          <button className={tablesOnly ? 'on' : ''} disabled={!lineage} onClick={() => !tablesOnly && toggleTablesOnly()}>In visible pipelines</button>
        </div>
      )}
      <ul className="pipelines">
        {groups.map(([group, ps]) => (
          <Fragment key={group}>
            {group && <li className="group">{group} <span className="count">{ps.length}</span></li>}
            {ps.map((p) => {
              const off = shownOff.has(p.id) || !lineage
              return (
                <li key={p.id} className={off ? 'off' : ''} title={p.tasks.map((t) => t.name).join(' → ')}>
                  <span className="swatch" style={{ background: palette.pipeline(p.id) }} />
                  <span className="name">{p.name}</span>
                  {p.trigger && <span className="trig">{TRIGGER_LABEL[p.trigger.kind]}</span>}
                  <span className="count">{p.tasks.length}</span>
                  <button title={hidden.includes(p.id) ? 'Show' : 'Hide'} className={hidden.includes(p.id) ? 'state' : ''} onClick={() => togglePipeline(p.id)}>
                    {hidden.includes(p.id) ? '○' : '●'}
                  </button>
                  <button title={only === p.id ? 'Show the others again' : 'Show only this one'} className={only === p.id ? 'on' : ''} onClick={() => onlyPipeline(p.id)}>
                    ◐
                  </button>
                  <button title="Light up this pipeline" className={lens === p.id ? 'on' : ''} onClick={() => setLens(lens === p.id ? null : p.id)}>
                    ◎
                  </button>
                  <button title="Play its day on the timeline" className={timeline && lens === p.id ? 'on' : ''} onClick={() => openTimeline(p.id)}>
                    ▶
                  </button>
                </li>
              )
            })}
          </Fragment>
        ))}
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

type Grouping = 'none' | 'trigger' | 'domain'
const GROUPINGS: [Grouping, string][] = [['none', 'None'], ['trigger', 'Trigger'], ['domain', 'Domain']]

const TRIGGER_GROUP: Record<Trigger['kind'], string> = {
  schedule: 'Scheduled',
  file_arrival: 'File arrival',
  table_update: 'Table update',
  job: 'After another job',
  manual: 'Manual',
  continuous: 'Continuous',
}

/** Pipelines in labelled groups (one unlabelled group for 'none'), groups A–Z, pipelines in file order. */
function groupPipelines(pipelines: Pipeline[], by: Grouping, graph: Graph): [string, Pipeline[]][] {
  if (by === 'none') return [['', pipelines]]
  const layerOf = new Map(graph.tables.map((t) => [t.id, t.layerId]))
  const layerName = new Map(graph.layers.map((l) => [l.id, l.name]))
  // A pipeline's domain: the layer most of the tables it writes are in.
  const domain = (p: Pipeline) => {
    const n = new Map<string, number>()
    for (const t of p.tasks) for (const w of t.writes) {
      const l = layerOf.get(w)
      if (l) n.set(l, (n.get(l) ?? 0) + 1)
    }
    const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0]
    return top ? layerName.get(top) ?? top : 'Writes no tables'
  }
  const groups = new Map<string, Pipeline[]>()
  for (const p of pipelines) {
    const g = by === 'trigger' ? (p.trigger ? TRIGGER_GROUP[p.trigger.kind] : 'No trigger') : domain(p)
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0]))
}
