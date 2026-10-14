import { useMemo } from 'react'
import type { ColumnDetail, EdgeLayer, GroupBy } from '../model/types'
import { MODES } from '../layout/modes'
import { flowOrder } from '../layout/modes/flow'
import { SOURCES, deriveView } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import type { Path } from '../view/paths'
import { lineageOn, usePaths, useView } from '../scene/usePlacement'
import { modeOf, useStore } from '../store'
import { PipelinePanel } from './PipelinePanel'
import { TablePicker } from './TablePicker'
import { usePalette } from '../theme/palette'

const HINTS = {
  stack: 'Click a table to focus · Shift-click a second to find a path · Double-click to fold columns · Drag to move within its layer',
  flow: 'Layers flow left to right, referenced first · Focus pulls the neighborhood off its slab · Drag to move on the slab',
  orbit: 'Focused table at the center · referenced tables above, referencing below · Click a table to re-center',
  diagram: 'Flow laid flat with a near-flat lens · Top looks straight down · Switch to Flow to watch each column stand up into its slab',
}

const DETAILS: [ColumnDetail, string][] = [['all', 'All'], ['keys', 'Keys'], ['header', 'Header']]
const GROUPS: [GroupBy, string][] = [['domain', 'Domain'], ['medallion', 'Medallion']]
const EDGES: [EdgeLayer, string][] = [['fk', 'FK'], ['lineage', 'Lineage'], ['both', 'Both']]

function Segmented<T extends string>({ options, value, onChange, disabled }: { options: [T, string][]; value: T; onChange: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} disabled={disabled?.(v)} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function LayerPanel() {
  const graph = useStore((s) => s.graph)
  const layout = useStore((s) => s.layout)
  const hiddenLayers = useStore((s) => s.hiddenLayers)
  const isolatedLayerId = useStore((s) => s.isolatedLayerId)
  const collapsedLayers = useStore((s) => s.collapsedLayers)
  const toggleLayer = useStore((s) => s.toggleLayer)
  const isolateLayer = useStore((s) => s.isolateLayer)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const moveLayer = useStore((s) => s.moveLayer)
  const setLayerGap = useStore((s) => s.setLayerGap)
  const setColumnDetail = useStore((s) => s.setColumnDetail)
  const setGroupBy = useStore((s) => s.setGroupBy)
  const setEdgeLayer = useStore((s) => s.setEdgeLayer)
  const pathOpen = useStore((s) => s.pathOpen)
  const palette = usePalette()

  const modeId = modeOf(layout)
  const mode = MODES[modeId]
  const groupBy = layout.groupBy ?? 'domain'
  const hasPipelines = graph.workflows.pipelines.length > 0
  // Every layer that exists for the current grouping (ignoring hide / isolate), with node counts.
  const fullView = useMemo(
    () => deriveView(graph, { groupBy, lineage: lineageOn(layout.edgeLayer), hiddenPipelines: layout.hiddenPipelines, pipelineTablesOnly: layout.pipelineTablesOnly }),
    [graph, groupBy, layout.edgeLayer, layout.hiddenPipelines, layout.pipelineTablesOnly],
  )
  const layerById = useMemo(() => new Map(fullView.layers.map((l) => [l.id, l])), [fullView])
  // Node count per layer, once per view (not a scan of every node per row).
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of fullView.nodes) m.set(n.layerId, (m.get(n.layerId) ?? 0) + 1)
    return m
  }, [fullView])
  const ids = fullView.layers.map((l) => l.id)
  const fixed = groupBy === 'medallion'
  const leftToRight = modeId === 'flow' || modeId === 'diagram'
  const ordered =
    leftToRight
      ? flowOrder(fullView, layout)
      : modeId === 'stack'
        ? // top of the stack first, matching what you see in 3D; sources sit underneath
          [...(fixed ? ids.filter((id) => id !== SOURCES) : layout.layerOrder)].reverse().concat(ids.includes(SOURCES) ? [SOURCES] : [])
        : ids
  const movable = ordered.filter((id) => id !== SOURCES)
  const movableIndex = new Map(movable.map((id, i) => [id, i]))
  const hiddenSet = new Set(hiddenLayers)
  const collapsedSet = new Set(collapsedLayers)
  // Flow lists left to right, so "earlier" is a lower index; the stack lists top first.
  const [back, fwd] = leftToRight ? (['←', '→'] as const) : (['↑', '↓'] as const)
  const step = leftToRight ? -1 : 1

  return (
    <div className="panel">
      <details open>
        <summary>{groupBy === 'medallion' ? 'Medallion layers' : modeId === 'stack' ? 'Layers' : 'Domains'}</summary>
        <ul className="layers">
          {ordered.map((id) => {
            const l = layerById.get(id)
            if (!l) return null
            const count = counts.get(id) ?? 0
            const hidden = hiddenSet.has(id)
            const isolated = isolatedLayerId === id
            const collapsed = collapsedSet.has(id)
            const i = movableIndex.get(id) ?? -1
            return (
              <li key={id} className={hidden || (isolatedLayerId && !isolated) ? 'off' : ''}>
                <span className="swatch" style={{ background: palette.layer(id) }} />
                <span className="name">{l.name}</span>
                <span className="count">{count}</span>
                {modeId !== 'orbit' && !fixed && i >= 0 && (
                  <>
                    <button title="Move earlier" disabled={i === 0} onClick={() => moveLayer(id, step as 1 | -1)}>{back}</button>
                    <button title="Move later" disabled={i === movable.length - 1} onClick={() => moveLayer(id, -step as 1 | -1)}>{fwd}</button>
                  </>
                )}
                {id !== SOURCES && (
                  <button title={collapsed ? 'Expand' : 'Collapse to one card'} className={collapsed ? 'on' : ''} onClick={() => toggleCollapse(id)}>
                    {collapsed ? '⊞' : '⊟'}
                  </button>
                )}
                <button title={hidden ? 'Show' : 'Hide'} onClick={() => toggleLayer(id)}>{hidden ? '○' : '●'}</button>
                <button title="Isolate" className={isolated ? 'on' : ''} onClick={() => isolateLayer(isolated ? null : id)}>◎</button>
              </li>
            )
          })}
        </ul>

        <label className="gap">
          {mode.gapLabel} <span>{layout.layerGap.toFixed(0)}</span>
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={layout.layerGap}
            onChange={(e) => setLayerGap(Number(e.target.value))}
          />
        </label>
      </details>

      <details open>
        <summary>View</summary>
        <div className="row">Group by <Segmented options={GROUPS} value={groupBy} onChange={setGroupBy} /></div>
        <div className="row">
          Edges
          <Segmented
            options={EDGES}
            value={layout.edgeLayer ?? 'both'}
            onChange={setEdgeLayer}
            disabled={(v) => v !== 'fk' && !hasPipelines}
          />
        </div>
        <div className="row">Columns <Segmented options={DETAILS} value={layout.columnDetail ?? 'all'} onChange={setColumnDetail} /></div>
      </details>

      {hasPipelines && <PipelinePanel />}
      <FocusSection />
      {pathOpen && <PathSection />}

      <p className="hint">{HINTS[modeId]} · Esc to clear · Right-drag to pan</p>
    </div>
  )
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper" title={label}>
      <button onClick={() => onChange(value - 1)} disabled={value <= 0}>−</button>
      <span>{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= 6}>+</button>
    </span>
  )
}

function FocusSection() {
  const focused = useStore((s) => s.focusedTableId)
  const hopUp = useStore((s) => s.hopUp)
  const hopDown = useStore((s) => s.hopDown)
  const setHops = useStore((s) => s.setHops)

  return (
    <details open>
      <summary>Focus depth</summary>
      <div className="focus">
        <Stepper label="Upstream hops (tables it references)" value={hopUp} onChange={(v) => setHops(v, hopDown)} />
        <span className="focus-name">{focused ?? 'table'}</span>
        <Stepper label="Downstream hops (tables referencing it)" value={hopDown} onChange={(v) => setHops(hopUp, v)} />
      </div>
    </details>
  )
}

/** Join chain for one path: `orders.user_id = users.id`, one hop per line. */
function joins(view: ViewGraph, path: Path) {
  const byId = new Map(view.edges.map((e) => [e.id, e]))
  return path.edges.map((id, i) => {
    const e = byId.get(id)!
    const forward = e.from === path.nodes[i]
    const [l, lc, r, rc] = forward
      ? [e.from, e.fromColumns, e.to, e.toColumns]
      : [e.to, e.toColumns, e.from, e.fromColumns]
    return `${l}.${lc.join(',')} = ${r}.${rc.join(',')}`
  })
}

function PathSection() {
  const view = useView()
  const paths = usePaths(view)
  const ends = useStore((s) => s.pathEnds)
  const ignore = useStore((s) => s.pathIgnore)
  const active = useStore((s) => s.activePath)
  const setPathEnd = useStore((s) => s.setPathEnd)
  const togglePathIgnore = useStore((s) => s.togglePathIgnore)
  const setActivePath = useStore((s) => s.setActivePath)
  const camera = useStore((s) => s.camera)

  const select = (i: number) => {
    const next = active === i ? null : i
    setActivePath(next)
    camera({ kind: 'frame', ids: next === null ? paths.flatMap((p) => p.nodes) : paths[i].nodes })
  }
  const via = [...new Set(paths.flatMap((p) => p.nodes.slice(1, -1)))]

  return (
    <details open>
      <summary>Path</summary>
      <div className="path-ends">
        <TablePicker placeholder="From…" value={ends[0]} onPick={(id) => setPathEnd(0, id)} />
        <button title="Swap" onClick={() => (setPathEnd(0, ends[1]), setPathEnd(1, ends[0]))}>⇄</button>
        <TablePicker placeholder="To…" value={ends[1]} onPick={(id) => setPathEnd(1, id)} />
      </div>
      {ends[0] && ends[1] && !paths.length && <p className="hint">No join path (check hidden / collapsed domains and ignored tables).</p>}
      <ol className="paths">
        {paths.map((p, i) => (
          <li key={i} className={active === i ? 'on' : ''} onClick={() => select(i)}>
            <span className="len">{p.edges.length} hop{p.edges.length > 1 ? 's' : ''}</span>
            {joins(view, p).map((j) => <code key={j}>{j}</code>)}
          </li>
        ))}
      </ol>
      {(via.length > 0 || ignore.length > 0) && (
        <div className="ignore">
          <span>Avoid:</span>
          {[...new Set([...ignore, ...via])].map((id) => (
            <button key={id} className={ignore.includes(id) ? 'on' : ''} onClick={() => togglePathIgnore(id)}>
              {id}
            </button>
          ))}
        </div>
      )}
    </details>
  )
}
