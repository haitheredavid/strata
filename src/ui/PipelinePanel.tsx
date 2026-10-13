import { useStore } from '../store'
import { TRIGGER_LABEL } from '../scene/timeClock'

/** Pipelines from DBML notes and the workflow file: show / hide, light one up, or play its day. */
export function PipelinePanel() {
  const workflows = useStore((s) => s.graph.workflows)
  const hidden = useStore((s) => s.layout.hiddenPipelines) ?? []
  const lineage = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk')
  const lens = useStore((s) => s.lensPipeline)
  const timeline = useStore((s) => s.time.open)
  const togglePipeline = useStore((s) => s.togglePipeline)
  const setLens = useStore((s) => s.setLens)
  const openTimeline = useStore((s) => s.openTimeline)
  const setEdgeLayer = useStore((s) => s.setEdgeLayer)
  const showCompute = useStore((s) => s.layout.showCompute ?? true)
  const toggleCompute = useStore((s) => s.toggleCompute)

  return (
    <details open>
      <summary>Pipelines</summary>
      <ul className="pipelines">
        {workflows.pipelines.map((p) => {
          const off = hidden.includes(p.id) || !lineage
          return (
            <li key={p.id} className={off ? 'off' : ''} title={p.tasks.map((t) => t.name).join(' → ')}>
              <span className="swatch" style={{ background: p.color }} />
              <span className="name">{p.name}</span>
              {p.trigger && <span className="trig">{TRIGGER_LABEL[p.trigger.kind]}</span>}
              <span className="count">{p.tasks.length}</span>
              <button title={hidden.includes(p.id) ? 'Show' : 'Hide'} onClick={() => togglePipeline(p.id)}>
                {hidden.includes(p.id) ? '○' : '●'}
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
      {workflows.clusters.length > 0 && (
        <div className="row">
          <span title="The clusters jobs run on, drawn under the diagram">Compute · {workflows.clusters.length} clusters</span>
          <button className={showCompute && lineage ? 'on' : ''} disabled={!lineage} onClick={toggleCompute}>
            {showCompute ? 'Shown' : 'Hidden'}
          </button>
        </div>
      )}
      {workflows.warnings.length > 0 && (
        <ul className="warnings">
          {workflows.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </details>
  )
}
