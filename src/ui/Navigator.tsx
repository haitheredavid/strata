import { Fragment, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Graph } from '../model/types'
import type { Pipeline, Trigger } from '../model/workflow'
import { flowOrder } from '../layout/modes/flow'
import { SOURCES, hiddenPipelinesOf, layerView } from '../view/deriveView'
import { listLabels } from '../view/labels'
import { pipelineDomains } from '../view/pipelineDomain'
import { useView } from '../scene/usePlacement'
import { modeOf, scheduleOf, useStore } from '../store'
import { usePalette } from '../theme/palette'
import { Menu } from './Menu'
import { RunStrip } from './runs'
import { runsOf, worstState } from '../view/runs'
import { selectPipeline } from './select'
import { useShowMore } from './ShowMore'

const NAV_KEY = 'strata:nav'
/** Rows a section lists before "Show N more". */
const DOMAIN_CAP = 8
const PIPELINE_CAP = 10

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

/** Every whitespace-separated word of the query occurs in the name, ignoring case. */
const matcher = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return (name: string) => {
    const n = name.toLowerCase()
    return words.every((w) => n.includes(w))
  }
}

/**
 * The left column, a facet panel for what's in the picture: one filter over everything, then domains
 * (or medallion layers) and pipelines. The swatch shows or hides a row, its name selects or frames it,
 * ⋯ holds "only this" and the rest. Long lists show their first rows and "Show N more".
 */
export function Navigator() {
  const [open, setOpen] = useState(() => remembered() !== 'closed')
  const [query, setQuery] = useState('')
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
      <div className="nav-top">
        <input
          className="filter"
          placeholder={hasPipelines ? 'Filter domains and pipelines…' : 'Filter domains…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (query ? setQuery('') : e.currentTarget.blur())}
        />
        <button className="nav-toggle" title="Hide the navigator" onClick={toggle}>‹</button>
      </div>
      <Layers query={query} />
      {hasPipelines && <Pipelines query={query} />}
    </nav>
  )
}

/** A section heading: the facet's name, how much of it is shown, and its ⋯ menu. */
function Head({ title, shown, total, menu }: { title: string; shown: number; total: number; menu: (close: () => void) => ReactNode }) {
  return (
    <div className="nav-head">
      <h3>{title}</h3>
      <span className="nav-tally" title={`${shown} of ${total} shown`}>{shown === total ? total : `${shown} / ${total}`}</span>
      <span className="spacer" />
      <Menu label="⋯" title={`${title}: show, hide, group`} className="row-menu">
        {menu}
      </Menu>
    </div>
  )
}

/** A navigator row: the swatch toggles it, the name selects or frames it, then an aside and a ⋯ menu. */
function Row(props: {
  shown: boolean
  onShown: (shown: boolean) => void
  color: string
  name: string
  rest?: string
  title?: string
  selected?: boolean
  onClick: () => void
  badge?: string
  aside?: ReactNode
  menu: (close: () => void) => ReactNode
}) {
  return (
    <li className={`nav-row${props.shown ? '' : ' off'}${props.selected ? ' selected' : ''}`}>
      <button
        className={`vis${props.shown ? ' on' : ''}`}
        style={{ '--c': props.color } as CSSProperties}
        aria-pressed={props.shown}
        aria-label={`${props.shown ? 'Hide' : 'Show'} ${props.name}`}
        title={props.shown ? 'Shown: click to hide' : 'Hidden: click to show'}
        onClick={() => props.onShown(!props.shown)}
      />
      <button className="name" title={props.title ?? props.name} onClick={props.onClick}>
        {props.name}
        {props.rest && <span className="rest"> {props.rest}</span>}
      </button>
      {props.badge && <span className="badge">{props.badge}</span>}
      {props.aside}
      <Menu label="⋯" title="More" className="row-menu">
        {props.menu}
      </Menu>
    </li>
  )
}

function Item({ onClick, close, children, disabled, current }: { onClick: () => void; close: () => void; children: ReactNode; disabled?: boolean; current?: boolean }) {
  return (
    <button role="menuitem" className={`menu-item${current ? ' current' : ''}`} disabled={disabled} onClick={() => (close(), onClick())}>
      {children}
    </button>
  )
}

/** A count with a bar for its share of the largest, so sizes compare at a glance. */
function Magnitude({ n, max, unit }: { n: number; max: number; unit: string }) {
  return (
    <span className="mag" title={`${n} ${unit}`}>
      <span className="track">
        <i style={{ width: `${max ? Math.max(4, (n / max) * 100) : 0}%` }} />
      </span>
      <span>{n}</span>
    </span>
  )
}

function Layers({ query }: { query: string }) {
  const graph = useStore((s) => s.graph)
  const layout = useStore((s) => s.layout)
  const toggleLayer = useStore((s) => s.toggleLayer)
  const onlyLayer = useStore((s) => s.onlyLayer)
  const setHiddenLayers = useStore((s) => s.setHiddenLayers)
  const clearScope = useStore((s) => s.clearScope)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const moveLayer = useStore((s) => s.moveLayer)
  const camera = useStore((s) => s.camera)
  const palette = usePalette()

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
  const match = matcher(query)
  const listed = ordered.filter((id) => match(layerById.get(id)!.name))
  const only = layout.onlyLayer
  const isShown = (id: string) => !hiddenSet.has(id) && (!only || only === id)
  const max = Math.max(0, ...ordered.map((id) => members.get(id)?.length ?? 0))
  const [limit, more] = useShowMore(listed.length, DOMAIN_CAP)
  const noun = fixed ? 'Medallion layers' : 'Domains'

  const setShown = (id: string, shown: boolean) => {
    if (only) onlyLayer(only) // any toggle ends "only this"
    if (hiddenSet.has(id) === shown) toggleLayer(id)
  }

  if (query && !listed.length) return null
  return (
    <section>
      <Head
        title={noun}
        shown={ordered.filter(isShown).length}
        total={ordered.length}
        menu={(close) => (
          <>
            <Item close={close} onClick={() => clearScope('layers')}>Show all</Item>
            <Item close={close} onClick={() => setHiddenLayers(ordered)}>Hide all</Item>
            <Item close={close} disabled={!collapsedSet.size} onClick={() => clearScope('folded')}>Unfold all</Item>
          </>
        )}
      />
      <ul className="nav-list">
        {listed.slice(0, limit).map((id) => {
          const l = layerById.get(id)!
          const i = movableIndex.get(id) ?? -1
          const collapsed = collapsedSet.has(id)
          const n = members.get(id)?.length ?? 0
          return (
            <Row
              key={id}
              shown={isShown(id)}
              onShown={(v) => setShown(id, v)}
              color={palette.layer(id)}
              name={l.name}
              title={`${l.name}: click to frame`}
              onClick={() => camera({ kind: 'frame', ids: members.get(id) ?? [] })}
              badge={collapsed ? 'folded' : undefined}
              aside={<Magnitude n={n} max={max} unit={id === SOURCES ? 'sources' : 'tables'} />}
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
      {more}
    </section>
  )
}

type Grouping = 'none' | 'trigger' | 'domain'
const GROUPINGS: [Grouping, string][] = [['none', 'No grouping'], ['trigger', 'Group by trigger'], ['domain', 'Group by domain']]

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

/** How a pipeline's day went, for the status facet. */
type Status = 'failed' | 'ran' | 'none'
const STATUS_LABEL: Record<Status, string> = { failed: 'Failed', ran: 'Ran', none: 'No runs' }

function Pipelines({ query }: { query: string }) {
  const graph = useStore((s) => s.graph)
  const pipelines = graph.workflows.pipelines
  const hidden = useStore((s) => s.layout.hiddenPipelines)
  const only = useStore((s) => s.layout.onlyPipeline)
  const lineage = useStore((s) => (s.layout.edgeLayer ?? 'both') !== 'fk')
  const selected = useStore((s) => s.lensPipeline)
  const schedule = useStore(scheduleOf)
  const togglePipeline = useStore((s) => s.togglePipeline)
  const onlyPipeline = useStore((s) => s.onlyPipeline)
  const setHidden = useStore((s) => s.setHiddenPipelines)
  const clearScope = useStore((s) => s.clearScope)
  const setLens = useStore((s) => s.setLens)
  const setEdgeLayer = useStore((s) => s.setEdgeLayer)
  const openTimeline = useStore((s) => s.openTimeline)
  const tablesOnly = useStore((s) => s.layout.pipelineTablesOnly ?? false)
  const toggleTablesOnly = useStore((s) => s.togglePipelineTablesOnly)
  const view = useView()
  const palette = usePalette()
  const [grouping, setGrouping] = useState<Grouping>('none')
  const [picked, setStatus] = useState<Status | null>(null)

  const labels = useMemo(() => listLabels(pipelines.map((p) => p.name)), [pipelines])
  const { byPipeline } = runsOf(schedule)
  const hasRuns = schedule.runs.length > 0
  const statusOf = useMemo(() => {
    const m = new Map<string, Status>()
    for (const p of pipelines) {
      const w = worstState(byPipeline.get(p.id) ?? [])
      m.set(p.id, w === 'none' ? 'none' : w === 'failed' ? 'failed' : 'ran')
    }
    return m
  }, [pipelines, byPipeline])
  const statusCounts = (['failed', 'ran', 'none'] as Status[]).map((st) => [st, pipelines.filter((p) => statusOf.get(p.id) === st).length] as const)
  const showStatus = hasRuns && statusCounts.filter(([, n]) => n > 0).length > 1
  // A status picked on another dataset (or one nothing has any more) doesn't narrow the list.
  const status = showStatus && statusCounts.some(([st, n]) => st === picked && n > 0) ? picked : null

  const shownOff = new Set(hiddenPipelinesOf({ graph, hiddenPipelines: hidden, onlyPipeline: only }))
  const isShown = (p: Pipeline) => !shownOff.has(p.id)
  // Pipelines shown but with no job in the picture: every table they touch is in a hidden domain, or none.
  const drawn = useMemo(() => new Set(view.nodes.flatMap((n) => (n.kind === 'job' && n.pipelineId ? [n.pipelineId] : []))), [view])
  const match = matcher(query)
  const listed = pipelines.filter((p) => match(p.name) && (!status || statusOf.get(p.id) === status))
  const main = lineage ? listed.filter((p) => !isShown(p) || drawn.has(p.id)) : listed
  const tail = lineage ? listed.filter((p) => isShown(p) && !drawn.has(p.id)) : []
  const [limit, more] = useShowMore(main.length, PIPELINE_CAP)
  // The list is narrowed by the filter or a status, and the picture doesn't already show exactly it.
  const listedSet = new Set(listed)
  const narrowed =
    (query.trim() !== '' || status !== null) && listed.length > 0 && listed.length < pipelines.length && pipelines.some((p) => isShown(p) !== listedSet.has(p))

  const setShown = (id: string, shown: boolean) => {
    if (only) onlyPipeline(only) // any toggle ends "only this"
    if ((hidden ?? []).includes(id) === shown) togglePipeline(id)
  }

  const row = (p: Pipeline) => {
    const l = labels.get(p.name)!
    return (
      <Row
        key={p.id}
        shown={isShown(p) && lineage}
        onShown={(v) => setShown(p.id, v)}
        color={palette.pipeline(p.id)}
        name={l.short}
        rest={l.rest}
        title={`${p.name}\n${p.tasks.length} task${p.tasks.length > 1 ? 's' : ''}: ${p.tasks.map((t) => t.name).join(' → ')}`}
        selected={selected === p.id}
        onClick={() => (selected === p.id ? setLens(null) : selectPipeline(p.id))}
        aside={hasRuns && <RunStrip runs={byPipeline.get(p.id) ?? []} label={p.name} />}
        menu={(close) => (
          <>
            <Item close={close} onClick={() => onlyPipeline(p.id)}>{only === p.id ? 'Show all again' : 'Show only this'}</Item>
            <Item close={close} disabled={!hasRuns} onClick={() => openTimeline(p.id)}>Play its day</Item>
          </>
        )}
      />
    )
  }

  // Rows up to the limit, cut across groups; the selected pipeline stays listed past the cut.
  const grouped = groupPipelines(main, grouping, graph)
  const firstIndex = grouped.map((_, gi) => grouped.slice(0, gi).reduce((n, [, ps]) => n + ps.length, 0))
  const groups = grouped.flatMap(([g, ps], gi): [string, Pipeline[]][] => {
    const keep = ps.filter((p, i) => firstIndex[gi] + i < limit || p.id === selected)
    return keep.length ? [[g, keep]] : []
  })

  if (query && !listed.length) return null
  return (
    <section>
      <Head
        title="Pipelines"
        shown={lineage ? pipelines.filter(isShown).length : 0}
        total={pipelines.length}
        menu={(close) => (
          <>
            <Item close={close} onClick={() => clearScope('pipelines')}>Show all</Item>
            <Item close={close} onClick={() => setHidden(pipelines.map((p) => p.id))}>Hide all</Item>
            <div className="menu-head">List</div>
            {GROUPINGS.map(([g, label]) => (
              <Item key={g} close={close} current={grouping === g} onClick={() => setGrouping(g)}>{label}</Item>
            ))}
            <div className="menu-head">Tables</div>
            <Item close={close} current={tablesOnly} disabled={!lineage} onClick={toggleTablesOnly}>
              Only tables shown pipelines touch
            </Item>
          </>
        )}
      />
      {!lineage && (
        <p className="nav-note">
          Lineage edges are off, so no pipeline is drawn. <button className="link" onClick={() => setEdgeLayer('both')}>Turn them on</button>
        </p>
      )}
      {showStatus && (
        <div className="nav-chips" role="group" aria-label="Filter by today's runs">
          {statusCounts.map(([st, n]) =>
            n ? (
              <button key={st} className={`facet ${st}${status === st ? ' on' : ''}`} aria-pressed={status === st} onClick={() => setStatus(status === st ? null : st)}>
                {STATUS_LABEL[st]} <span className="n">{n}</span>
              </button>
            ) : null,
          )}
        </div>
      )}
      {narrowed && (
        <button className="link nav-apply" title="Hide every pipeline not in this list" onClick={() => setHidden(pipelines.filter((p) => !listed.includes(p)).map((p) => p.id))}>
          Show only these {listed.length}
        </button>
      )}
      <ul className="nav-list">
        {groups.map(([group, ps]) => (
          <Fragment key={group}>
            {group && <li className="group">{group}</li>}
            {ps.map(row)}
          </Fragment>
        ))}
      </ul>
      {more}
      {tail.length > 0 && (
        <details className="nav-tail">
          <summary title="Shown, but every table they read or write is in a hidden domain (or they touch none)">
            {tail.length} not in the picture
          </summary>
          <ul className="nav-list">{tail.map(row)}</ul>
        </details>
      )}
    </section>
  )
}
