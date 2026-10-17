import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Graph } from '../model/types'
import type { Pipeline, Trigger } from '../model/workflow'
import { flowOrder } from '../layout/modes/flow'
import { SOURCES, hiddenPipelinesOf, layerView } from '../view/deriveView'
import { pipelineDomains } from '../view/pipelineDomain'
import { TRIGGER_LABEL } from '../scene/timeClock'
import { modeOf, useStore } from '../store'
import { usePalette } from '../theme/palette'
import { Menu } from './Menu'
import { selectPipeline } from './select'

/** Lists longer than this get a filter box. */
const FILTER_AT = 8
const NAV_KEY = 'strata:nav'
const remembered = () => {
  try {
    return localStorage.getItem(NAV_KEY)
  } catch {
    return null
  }
}
const remember = (v: string) => {
  try {
    localStorage.setItem(NAV_KEY, v)
  } catch {
    /* not remembered */
  }
}

/**
 * The left column: what's in the picture. Domains (or medallion layers) and pipelines, each with a
 * checkbox to show it, a ⋯ menu for "only this" and the rest, and a click to select or frame it.
 */
export function Navigator() {
  const [open, setOpen] = useState(() => remembered() !== 'closed')
  const toggle = () => {
    remember(open ? 'closed' : 'open')
    setOpen(!open)
  }
  const hasPipelines = useStore((s) => s.graph.workflows.pipelines.length > 0)
  if (!open)
    return (
      <nav className="navigator closed">
        <button className="nav-toggle" title="Show the navigator" onClick={toggle}>›</button>
      </nav>
    )
  return (
    <nav className="navigator">
      <button className="nav-toggle" title="Hide the navigator" onClick={toggle}>‹</button>
      <Layers />
      {hasPipelines && <Pipelines />}
    </nav>
  )
}

/** A navigator row: checkbox, swatch, name (click selects or frames), count, state badges and a ⋯ menu. */
function Row(props: {
  shown: boolean
  onShown: (shown: boolean) => void
  color: string
  name: string
  title?: string
  selected?: boolean
  onClick: () => void
  tag?: string
  count: number
  badges?: string[]
  menu: (close: () => void) => ReactNode
}) {
  return (
    <li className={`nav-row${props.shown ? '' : ' off'}${props.selected ? ' selected' : ''}`}>
      <input type="checkbox" checked={props.shown} title={props.shown ? 'Shown: uncheck to hide' : 'Hidden: check to show'} onChange={(e) => props.onShown(e.target.checked)} />
      <span className="swatch" style={{ background: props.color }} />
      <button className="name" title={props.title ?? props.name} onClick={props.onClick}>{props.name}</button>
      {props.badges?.map((b) => <span key={b} className="badge">{b}</span>)}
      {props.tag && <span className="trig">{props.tag}</span>}
      <span className="count">{props.count}</span>
      <Menu label="⋯" title="More" className="row-menu">
        {props.menu}
      </Menu>
    </li>
  )
}

function Item({ onClick, close, children, disabled }: { onClick: () => void; close: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button role="menuitem" className="menu-item" disabled={disabled} onClick={() => (close(), onClick())}>
      {children}
    </button>
  )
}

function Layers() {
  const graph = useStore((s) => s.graph)
  const layout = useStore((s) => s.layout)
  const toggleLayer = useStore((s) => s.toggleLayer)
  const onlyLayer = useStore((s) => s.onlyLayer)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const moveLayer = useStore((s) => s.moveLayer)
  const camera = useStore((s) => s.camera)
  const palette = usePalette()
  const [query, setQuery] = useState('')

  const modeId = modeOf(layout)
  const groupBy = layout.groupBy ?? 'domain'
  // Every layer of the current grouping (ignoring hide / only / collapse), with its nodes.
  const fullView = useMemo(
    () =>
      layerView({
        graph,
        groupBy,
        edgeLayer: layout.edgeLayer,
        hiddenPipelines: layout.hiddenPipelines,
        onlyPipeline: layout.onlyPipeline,
        pipelineTablesOnly: layout.pipelineTablesOnly,
      }),
    [graph, groupBy, layout.edgeLayer, layout.hiddenPipelines, layout.onlyPipeline, layout.pipelineTablesOnly],
  )
  const layerById = useMemo(() => new Map(fullView.layers.map((l) => [l.id, l])), [fullView])
  const members = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of fullView.nodes) m.set(n.layerId, [...(m.get(n.layerId) ?? []), n.id])
    return m
  }, [fullView])
  const ids = fullView.layers.map((l) => l.id)
  const fixed = groupBy === 'medallion'
  const leftToRight = modeId === 'flow' || modeId === 'diagram'
  // The saved stack order also names layers this view leaves out (pipeline filters); list only the present ones.
  const ordered = (
    leftToRight
      ? flowOrder(fullView, layout)
      : modeId === 'stack'
        ? // top of the stack first, matching what you see in 3D; sources sit underneath
          [...(fixed ? ids.filter((id) => id !== SOURCES) : layout.layerOrder)].reverse().concat(ids.includes(SOURCES) ? [SOURCES] : [])
        : ids
  ).filter((id) => layerById.has(id))
  const movable = ordered.filter((id) => id !== SOURCES)
  const movableIndex = new Map(movable.map((id, i) => [id, i]))
  const hiddenSet = new Set(layout.hiddenLayers)
  const collapsedSet = new Set(layout.collapsedLayers)
  // Flow lists left to right, so "earlier" is a lower index; the stack lists top first.
  const [back, fwd] = leftToRight ? (['left', 'right'] as const) : (['up', 'down'] as const)
  const step = leftToRight ? -1 : 1
  const q = query.trim().toLowerCase()
  const listed = q ? ordered.filter((id) => layerById.get(id)?.name.toLowerCase().includes(q)) : ordered
  const only = layout.onlyLayer

  const setShown = (id: string, shown: boolean) => {
    if (only) onlyLayer(only) // any checkbox ends "only this"
    if (hiddenSet.has(id) === shown) toggleLayer(id)
  }

  return (
    <section>
      <h3>{fixed ? 'Medallion layers' : 'Domains'}</h3>
      {ordered.length > FILTER_AT && (
        <input className="filter" placeholder={`Filter ${ordered.length} ${fixed ? 'layers' : 'domains'}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {only && layerById.get(only) && (
        <p className="only-note">
          Only {layerById.get(only)!.name} <button className="link" onClick={() => onlyLayer(only)}>Show all</button>
        </p>
      )}
      <ul className="nav-list">
        {listed.map((id) => {
          const l = layerById.get(id)!
          const i = movableIndex.get(id) ?? -1
          const collapsed = collapsedSet.has(id)
          return (
            <Row
              key={id}
              shown={!hiddenSet.has(id) && (!only || only === id)}
              onShown={(v) => setShown(id, v)}
              color={palette.layer(id)}
              name={l.name}
              onClick={() => camera({ kind: 'frame', ids: members.get(id) ?? [] })}
              count={members.get(id)?.length ?? 0}
              badges={[...(only === id ? ['only'] : []), ...(collapsed ? ['folded'] : [])]}
              menu={(close) => (
                <>
                  <Item close={close} onClick={() => onlyLayer(id)}>{only === id ? 'Show all again' : 'Show only this'}</Item>
                  {id !== SOURCES && (
                    <Item close={close} onClick={() => toggleCollapse(id)}>{collapsed ? 'Expand' : 'Fold into one card'}</Item>
                  )}
                  {modeId !== 'orbit' && !fixed && i >= 0 && (
                    <>
                      <Item close={close} disabled={i === 0} onClick={() => moveLayer(id, step as 1 | -1)}>Move {back}</Item>
                      <Item close={close} disabled={i === movable.length - 1} onClick={() => moveLayer(id, -step as 1 | -1)}>Move {fwd}</Item>
                    </>
                  )}
                </>
              )}
            />
          )
        })}
      </ul>
    </section>
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
  const layerName = new Map(graph.layers.map((l) => [l.id, l.name]))
  const domains = pipelineDomains(graph)
  const domain = (p: Pipeline) => {
    const l = domains.get(p.id)
    return l ? layerName.get(l) ?? l : 'Writes no tables'
  }
  const groups = new Map<string, Pipeline[]>()
  for (const p of pipelines) {
    const g = by === 'trigger' ? (p.trigger ? TRIGGER_GROUP[p.trigger.kind] : 'No trigger') : domain(p)
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0]))
}

function Pipelines() {
  const graph = useStore((s) => s.graph)
  const pipelines = graph.workflows.pipelines
  const hidden = useStore((s) => s.layout.hiddenPipelines) ?? []
  const only = useStore((s) => s.layout.onlyPipeline)
  const lineage = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk')
  const selected = useStore((s) => s.lensPipeline)
  const togglePipeline = useStore((s) => s.togglePipeline)
  const onlyPipeline = useStore((s) => s.onlyPipeline)
  const setHidden = useStore((s) => s.setHiddenPipelines)
  const setLens = useStore((s) => s.setLens)
  const openTimeline = useStore((s) => s.openTimeline)
  const tablesOnly = useStore((s) => s.layout.pipelineTablesOnly ?? false)
  const toggleTablesOnly = useStore((s) => s.togglePipelineTablesOnly)
  const palette = usePalette()
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('trigger')
  const q = query.trim().toLowerCase()
  const listed = q ? pipelines.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : pipelines
  const shownOff = new Set(hiddenPipelinesOf({ graph, hiddenPipelines: hidden, onlyPipeline: only }))
  const many = pipelines.length > FILTER_AT
  const groups = useMemo(() => groupPipelines(listed, many ? grouping : 'none', graph), [listed, many, grouping, graph])

  const setShown = (id: string, shown: boolean) => {
    if (only) onlyPipeline(only) // any checkbox ends "only this"
    if (hidden.includes(id) === shown) togglePipeline(id)
  }

  return (
    <section>
      <h3>Pipelines</h3>
      {many && (
        <>
          <div className="row">
            <input className="filter" placeholder={`Filter ${pipelines.length} pipelines…`} value={query} onChange={(e) => setQuery(e.target.value)} />
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
      <div className="row">
        <span title="Leave out tables that no shown pipeline reads or writes">Tables</span>
        <span className="segmented">
          <button className={tablesOnly ? '' : 'on'} disabled={!lineage} onClick={() => tablesOnly && toggleTablesOnly()}>All</button>
          <button className={tablesOnly ? 'on' : ''} disabled={!lineage} onClick={() => !tablesOnly && toggleTablesOnly()}>In shown pipelines</button>
        </span>
      </div>
      {only && (
        <p className="only-note">
          Only {pipelines.find((p) => p.id === only)?.name ?? only} <button className="link" onClick={() => onlyPipeline(only)}>Show all</button>
        </p>
      )}
      <ul className="nav-list">
        {groups.map(([group, ps]) => (
          <Fragment key={group}>
            {group && <li className="group">{group} <span className="group-count">{ps.length}</span></li>}
            {ps.map((p) => (
              <Row
                key={p.id}
                shown={!shownOff.has(p.id) && lineage}
                onShown={(v) => setShown(p.id, v)}
                color={palette.pipeline(p.id)}
                name={p.name}
                title={`${p.name}\n${p.tasks.map((t) => t.name).join(' → ')}`}
                selected={selected === p.id}
                onClick={() => (selected === p.id ? setLens(null) : selectPipeline(p.id))}
                // Grouped by trigger, the group heading already says it.
                tag={p.trigger && !(many && grouping === 'trigger') ? TRIGGER_LABEL[p.trigger.kind] : undefined}
                count={p.tasks.length}
                badges={only === p.id ? ['only'] : []}
                menu={(close) => (
                  <>
                    <Item close={close} onClick={() => onlyPipeline(p.id)}>{only === p.id ? 'Show all again' : 'Show only this'}</Item>
                    <Item close={close} onClick={() => openTimeline(p.id)}>Play its day</Item>
                  </>
                )}
              />
            ))}
          </Fragment>
        ))}
      </ul>
    </section>
  )
}
