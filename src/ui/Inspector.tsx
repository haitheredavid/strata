import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Graph, Table } from '../model/types'
import { clusterNodeId } from '../model/workflow'
import type { Cluster, Pipeline, Task } from '../model/workflow'
import { clockOf } from '../sim/schedule'
import { clusterSpec, KIND_LABEL } from '../scene/clusterStyle'
import { usePaths, useView } from '../scene/usePlacement'
import { scheduleOf, useStore } from '../store'
import { usePalette } from '../theme/palette'
import { domainNodeId, jobNodeId } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { filterGroups, groupItems, takeItems } from '../view/groups'
import type { Group } from '../view/groups'
import { listLabels } from '../view/labels'
import { nodeName, nodeRefs, splitName } from '../view/nodes'
import type { Path } from '../view/paths'
import { ComputeSection } from './ComputeSection'
import { triggerLine } from './describe'
import type { RunLike } from '../view/runs'
import { runsOf, runText } from '../view/runs'
import { RunStrip } from './runs'
import { goTo, selectPipeline } from './select'
import { useShowMore } from './ShowMore'
import { TablePicker } from './TablePicker'

/** Lookups the Inspector needs, built once per graph. */
interface Index {
  tables: Map<string, Table>
  tasks: Map<string, Task>
  pipelines: Map<string, Pipeline>
  clusters: Map<string, Cluster>
  writers: Map<string, Task[]>
  readers: Map<string, Task[]>
  onCluster: Map<string, Task[]>
  refsOut: Map<string, string[]>
  refsIn: Map<string, string[]>
}

const indexes = new WeakMap<Graph, Index>()
const push = <V,>(m: Map<string, V[]>, k: string, v: V) => m.set(k, [...(m.get(k) ?? []), v])

function indexOf(graph: Graph): Index {
  let ix = indexes.get(graph)
  if (ix) return ix
  const tasks = graph.workflows.pipelines.flatMap((p) => p.tasks)
  ix = {
    tables: new Map(graph.tables.map((t) => [t.id, t])),
    tasks: new Map(tasks.map((t) => [t.id, t])),
    pipelines: new Map(graph.workflows.pipelines.map((p) => [p.id, p])),
    clusters: new Map(graph.workflows.clusters.map((c) => [clusterNodeId(c.id), c])),
    writers: new Map(),
    readers: new Map(),
    onCluster: new Map(),
    refsOut: new Map(),
    refsIn: new Map(),
  }
  for (const t of tasks) {
    for (const w of t.writes) push(ix.writers, w, t)
    for (const r of t.reads) push(ix.readers, r, t)
    push(ix.onCluster, t.clusterId, t)
  }
  for (const r of graph.refs) {
    push(ix.refsOut, r.from.table, r.to.table)
    push(ix.refsIn, r.to.table, r.from.table)
  }
  indexes.set(graph, ix)
  return ix
}

/** Today's runs in one line: the strip, then `3 runs · 1 failed · last 14:32 ✓`. */
function RunSummary({ runs }: { runs: RunLike[] }) {
  const schedule = useStore(scheduleOf)
  const clock = useMemo(() => clockOf(schedule), [schedule])
  return (
    <>
      <RunStrip runs={runs} />
      <span className={runs.some((r) => r.state === 'failed') ? 'failed' : runs.length ? '' : 'muted'}>{runText(runs, clock)}</span>
    </>
  )
}

/** A name that selects its node (or pipeline) and flies to it; by default the short name with its schema muted. */
function NodeLink({ id, children }: { id: string; children?: ReactNode }) {
  const graph = useStore((s) => s.graph)
  const name = nodeName(graph, id)
  const { short, prefix: rest } = splitName(name)
  return (
    <button className="link node-link" title={name} onClick={() => goTo(id)}>
      {children ?? (
        <>
          {short}
          {rest && <span className="muted"> {rest}</span>}
        </>
      )}
    </button>
  )
}

function PipelineLink({ p }: { p: Pipeline }) {
  const palette = usePalette()
  return (
    <button className="link node-link" title={p.name} onClick={() => selectPipeline(p.id)}>
      <span className="swatch" style={{ background: palette.pipeline(p.id) }} />
      {p.name}
    </button>
  )
}

/** Rows a list shows before "Show N more". */
const LIST_CAP = 8
/** Lists longer than this get a filter box. */
const FILTER_FROM = 12
/** Swatch colour for groups that aren't a domain (sources, other names). */
const NEUTRAL = 'var(--muted)'

function Section({ title, count, note, bar, children }: { title: string; count?: number; note?: string; bar?: ReactNode; children: ReactNode }) {
  return (
    <details className="insp-section" open>
      <summary>
        {title}
        {count !== undefined && <span className="muted"> {count}</span>}
        {note && <span className="note" title={note}>{note}</span>}
        {bar}
      </summary>
      {children}
    </details>
  )
}

/** One row of a grouped list: its full name (what the filter matches) and how it renders. */
interface Row {
  id: string
  name: string
  node: ReactNode
}

/** A group's header: its name, swatch colour, and the header row's content. */
interface Head {
  label: string
  color: string
  node: ReactNode
}

/**
 * A list section: rows in groups with a header each (a single group's name moves into the summary
 * instead), a composition bar of the groups, a filter box for long lists, and "Show N more".
 * Without `heads` the rows show as one plain list.
 */
function ListSection({ title, groups, heads }: { title: string; groups: Group<Row>[]; heads?: Map<string, Head> }) {
  const [query, setQuery] = useState('')
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const q = query.trim().toLowerCase()
  const shown = q ? filterGroups(groups, (r) => r.name.toLowerCase().includes(q)) : groups
  const [limit, more] = useShowMore(
    shown.reduce((n, g) => n + g.items.length, 0),
    LIST_CAP,
  )
  const grouped = heads !== undefined && groups.length > 1
  const bar = grouped && (
    <span className="insp-bar" title={groups.map((g) => `${heads.get(g.key)!.label} ${g.items.length}`).join(' · ')}>
      {groups.map((g) => (
        <i key={g.key} style={{ flexGrow: g.items.length, background: heads.get(g.key)!.color }} />
      ))}
    </span>
  )
  const sizes = new Map(shown.map((g) => [g.key, g.items.length]))
  return (
    <Section title={title} count={total} note={!grouped && heads ? heads.get(groups[0].key)?.label : undefined} bar={bar}>
      {total > FILTER_FROM && (
        <input className="filter insp-filter" placeholder={`Filter ${total}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <ul className={`insp-list${grouped ? ' grouped' : ''}`}>
        {takeItems(shown, limit).map((g) => (
          <Fragment key={g.key}>
            {grouped && (
              <li className="insp-group">
                {heads.get(g.key)!.node}
                <span>{sizes.get(g.key)}</span>
              </li>
            )}
            {g.items.map((r) => (
              <li key={r.id}>{r.node}</li>
            ))}
          </Fragment>
        ))}
      </ul>
      {q && !shown.length && <p className="hint">Nothing matches.</p>}
      {more}
    </Section>
  )
}

/** Jobs with their pipeline colour and a strip of today's runs; grouped under their pipelines when they span several, unless `flat`. */
function JobSection({ title, tasks, ix, flat }: { title: string; tasks: Task[]; ix: Index; flat?: boolean }) {
  const schedule = useStore(scheduleOf)
  const palette = usePalette()
  const { byTask } = runsOf(schedule)
  const labels = listLabels(tasks.map((t) => t.name))
  const rows: (Row & { pipelineId: string })[] = tasks.map((t) => {
    const l = labels.get(t.name)!
    return {
      id: t.id,
      name: t.name,
      pipelineId: t.pipelineId,
      node: (
        <>
          <span className="swatch" style={{ background: palette.pipeline(t.pipelineId) }} />
          <NodeLink id={jobNodeId(t.id)}>
            {l.short}
            {l.rest && <span className="rest"> {l.rest}</span>}
          </NodeLink>
          <RunStrip runs={byTask.get(t.id) ?? []} />
        </>
      ),
    }
  })
  const groups = groupItems(rows, (r) => r.pipelineId)
  // One job per pipeline: headers would double the rows, and each row's swatch already names its pipeline.
  if (flat || (groups.length > 1 && groups.length === rows.length)) return <ListSection title={title} groups={[{ key: '', items: rows }]} />
  const heads = new Map<string, Head>()
  for (const { key } of groups) {
    const p = ix.pipelines.get(key)
    heads.set(key, { label: p?.name ?? key, color: palette.pipeline(key), node: p ? <PipelineLink p={p} /> : <span>{key}</span> })
  }
  return <ListSection title={title} groups={groups} heads={heads} />
}

/** Tables (and sources) grouped by schema, each by its short name; the schema heads its group. */
function NodeSection({ title, ids, ix }: { title: string; ids: string[]; ix: Index }) {
  const graph = useStore((s) => s.graph)
  const palette = usePalette()
  const rows: (Row & { schema: string })[] = [...new Set(ids)]
    .map((id) => {
      const name = nodeName(graph, id)
      // Paths and URLs (volumes, APIs) aren't dotted names: they keep their whole name.
      const { short, prefix } = ix.tables.has(id) || !name.includes('/') ? splitName(name) : { short: name, prefix: '' }
      return { id, name, schema: prefix, node: <NodeLink id={id}>{short}</NodeLink>, short }
    })
    .sort((a, b) => a.short.localeCompare(b.short))
  const groups = groupItems(rows, (r) => r.schema)
  const heads = new Map<string, Head>()
  for (const g of groups) {
    const table = g.items.map((r) => ix.tables.get(r.id)).find((t) => t)
    const label = g.key || 'other'
    const color = table ? palette.layer(table.layerId) : NEUTRAL
    heads.set(g.key, {
      label,
      color,
      node: (
        <span className="insp-group-name" title={label}>
          <span className="swatch" style={{ background: color }} />
          {label}
        </span>
      ),
    })
  }
  return <ListSection title={title} groups={groups} heads={heads} />
}

function Columns({ table }: { table: Table }) {
  const [limit, more] = useShowMore(table.columns.length, LIST_CAP)
  return (
    <Section title="Columns" count={table.columns.length}>
      <ul className="insp-cols">
        {table.columns.slice(0, limit).map((c) => (
          <li key={c.name}>
            <span>{c.name}</span>
            {c.pk && <span className="key">PK</span>}
            {c.fk && <span className="key">FK</span>}
            <span className="muted">{c.type}</span>
          </li>
        ))}
      </ul>
      {more}
    </Section>
  )
}

function Header({ kind, name, onClose, color }: { kind: string; name: string; onClose: () => void; color?: string }) {
  const { short, prefix: rest } = splitName(name)
  return (
    <header className="insp-head">
      <div className="insp-kind">
        {color && <span className="swatch" style={{ background: color }} />}
        {kind}
        <span className="spacer" />
        <button className="close" title="Clear the selection (Esc)" onClick={onClose}>✕</button>
      </div>
      <h2 title={name}>{short}</h2>
      {rest && <div className="muted insp-sub" title={name}>{rest}</div>}
    </header>
  )
}

/** The right column: details of what's selected, with links to its neighbours, and the path finder. */
export function Inspector() {
  const focused = useStore((s) => s.focusedId)
  const pipeline = useStore((s) => s.lensPipeline)
  const pathOpen = useStore((s) => s.pathOpen)
  if (!focused && !pipeline && !pathOpen) return null
  return (
    <aside className="inspector">
      {pipeline ? <PipelineInspector key={pipeline} id={pipeline} /> : focused ? <NodeInspector key={focused} id={focused} /> : null}
      {pathOpen && <PathSection />}
    </aside>
  )
}

function NodeInspector({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)
  const focus = useStore((s) => s.focus)
  const ix = indexOf(graph)
  const kind = nodeRefs(graph).get(id)?.kind
  const close = () => focus(null)
  return (
    <>
      {kind === 'table' ? (
        <TableInspector table={ix.tables.get(id)!} ix={ix} onClose={close} />
      ) : kind === 'job' ? (
        <JobInspector task={ix.tasks.get(id.slice('job:'.length))!} ix={ix} onClose={close} />
      ) : kind === 'cluster' ? (
        <ClusterInspector cluster={ix.clusters.get(id)!} ix={ix} onClose={close} />
      ) : kind === 'source' ? (
        <>
          <Header kind="Source" name={nodeName(graph, id)} onClose={close} />
          <ReadWrite ix={ix} id={id} />
        </>
      ) : (
        <DomainInspector name={nodeName(graph, id)} layerId={graph.layers.find((l) => domainNodeId(l.id) === id)?.id ?? null} onClose={close} />
      )}
      <NotDrawn id={id} />
    </>
  )
}

/** A note when the selection is filtered out of the diagram, with the filter that's most likely why. */
function NotDrawn({ id }: { id: string }) {
  const view = useView()
  const graph = useStore((s) => s.graph)
  const tablesOnly = useStore((s) => s.layout.pipelineTablesOnly ?? false)
  const toggleTablesOnly = useStore((s) => s.togglePipelineTablesOnly)
  if (view.nodes.some((n) => n.id === id) || view.clusters.some((c) => c.id === id)) return null
  const task = id.startsWith('job:') ? indexOf(graph).tasks.get(id.slice('job:'.length)) : undefined
  if (task && !task.reads.length && !task.writes.length) return <p className="insp-note">Not drawn: this task reads and writes no tables, so it has no place in the lineage.</p>
  return (
    <p className="insp-note">
      Not drawn in the current view: a hidden domain or pipeline, a folded domain{tablesOnly ? ', or Tables: In shown pipelines' : ''} leaves it out.
      {tablesOnly && (
        <button className="link" onClick={toggleTablesOnly}>
          Show all tables
        </button>
      )}
    </p>
  )
}

function DomainInspector({ name, layerId, onClose }: { name: string; layerId: string | null; onClose: () => void }) {
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  return (
    <>
      <Header kind="Folded domain" name={name} onClose={onClose} />
      {layerId && (
        <div className="insp-actions">
          <button onClick={() => toggleCollapse(layerId)}>Expand</button>
        </div>
      )}
    </>
  )
}

/** Jobs that write and read a table or source. */
function ReadWrite({ ix, id }: { ix: Index; id: string }) {
  const writers = ix.writers.get(id) ?? []
  const readers = ix.readers.get(id) ?? []
  return (
    <>
      {writers.length > 0 && <JobSection title="Written by" tasks={writers} ix={ix} />}
      {readers.length > 0 && <JobSection title="Read by" tasks={readers} ix={ix} />}
    </>
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

function TableInspector({ table, ix, onClose }: { table: Table; ix: Index; onClose: () => void }) {
  const graph = useStore((s) => s.graph)
  const hopUp = useStore((s) => s.hopUp)
  const hopDown = useStore((s) => s.hopDown)
  const setHops = useStore((s) => s.setHops)
  const setPathEnd = useStore((s) => s.setPathEnd)
  const palette = usePalette()
  const layer = graph.layers.find((l) => l.id === table.layerId)
  const out = ix.refsOut.get(table.id) ?? []
  const into = ix.refsIn.get(table.id) ?? []
  return (
    <>
      <Header kind="Table" name={table.name} onClose={onClose} color={palette.layer(table.layerId)} />
      <div className="insp-meta">
        {layer && <span>{layer.name}</span>}
        {table.medallion && (
          <span className="chip" style={{ borderColor: palette.medallion(table.medallion), color: palette.medallion(table.medallion) }}>
            {table.medallion}
          </span>
        )}
        <span className="muted">{table.columns.length} columns</span>
      </div>
      <div className="insp-row">
        <span className="muted">Neighbourhood</span>
        <Stepper label="Upstream hops" value={hopUp} onChange={(v) => setHops(v, hopDown)} />
        <span className="muted">up</span>
        <Stepper label="Downstream hops" value={hopDown} onChange={(v) => setHops(hopUp, v)} />
        <span className="muted">down</span>
      </div>
      <ReadWrite ix={ix} id={table.id} />
      {out.length > 0 && <NodeSection title="References" ids={out} ix={ix} />}
      {into.length > 0 && <NodeSection title="Referenced by" ids={into} ix={ix} />}
      <Columns table={table} />
      <div className="insp-actions">
        <TablePicker
          placeholder="Find join path to…"
          onPick={(to) => {
            setPathEnd(0, table.id)
            setPathEnd(1, to)
          }}
        />
      </div>
    </>
  )
}

function JobInspector({ task, ix, onClose }: { task: Task; ix: Index; onClose: () => void }) {
  const schedule = useStore(scheduleOf)
  const palette = usePalette()
  const pipeline = ix.pipelines.get(task.pipelineId)
  const cluster = ix.clusters.get(clusterNodeId(task.clusterId))
  const runs = runsOf(schedule).byTask.get(task.id) ?? []
  const openInDay = () => {
    const s = useStore.getState()
    const first = runs.find((r) => !r.continuous)
    s.openTimeline()
    s.focus(jobNodeId(task.id))
    if (first) s.setTime({ t: first.start })
  }
  return (
    <>
      <Header kind="Job" name={task.name} onClose={onClose} color={palette.pipeline(task.pipelineId)} />
      {pipeline && (
        <div className="insp-row">
          <span className="muted">in</span>
          <PipelineLink p={pipeline} />
        </div>
      )}
      <div className="insp-row">
        <span className="muted">Today</span>
        <RunSummary runs={runs} />
      </div>
      {task.reads.length > 0 && <NodeSection title="Reads" ids={task.reads} ix={ix} />}
      {task.writes.length > 0 && <NodeSection title="Writes" ids={task.writes} ix={ix} />}
      {cluster && (
        <div className="insp-row">
          <span className="muted">Runs on</span>
          <NodeLink id={clusterNodeId(cluster.id)} />
        </div>
      )}
      <div className="insp-actions">
        <button disabled={!schedule.taskRuns.length} onClick={openInDay}>Open in Day</button>
      </div>
      <Section title="Compute">
        <ComputeSection id={jobNodeId(task.id)} />
      </Section>
    </>
  )
}

function ClusterInspector({ cluster, ix, onClose }: { cluster: Cluster; ix: Index; onClose: () => void }) {
  const palette = usePalette()
  const jobs = ix.onCluster.get(cluster.id) ?? []
  return (
    <>
      <Header kind={KIND_LABEL[cluster.kind].toLowerCase()} name={cluster.name} onClose={onClose} color={palette.cluster(cluster.kind)} />
      <div className="insp-meta">
        <span>{clusterSpec(cluster)}</span>
        {cluster.sparkVersion && <span className="muted">DBR {cluster.sparkVersion.split('.x')[0]}</span>}
      </div>
      <JobSection title="Runs jobs" tasks={jobs} ix={ix} />
      <Section title="Compute">
        <ComputeSection id={clusterNodeId(cluster.id)} />
      </Section>
    </>
  )
}

function PipelineInspector({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)
  const schedule = useStore(scheduleOf)
  const only = useStore((s) => s.layout.onlyPipeline)
  const onlyPipeline = useStore((s) => s.onlyPipeline)
  const openTimeline = useStore((s) => s.openTimeline)
  const setLens = useStore((s) => s.setLens)
  const palette = usePalette()
  const ix = indexOf(graph)
  const p = ix.pipelines.get(id)
  if (!p) return null
  const tables = new Set(p.tasks.flatMap((t) => [...t.reads, ...t.writes]))
  return (
    <>
      <Header kind="Pipeline" name={p.name} onClose={() => setLens(null)} color={palette.pipeline(p.id)} />
      <div className="insp-meta">
        <span>{triggerLine(p.trigger)}</span>
      </div>
      <div className="insp-row">
        <span className="muted">Today</span>
        <RunSummary runs={runsOf(schedule).byPipeline.get(p.id) ?? []} />
      </div>
      <div className="insp-row">
        <span className="muted">Touches</span>
        <span>{tables.size} tables and sources</span>
      </div>
      <div className="insp-actions">
        <button className={only === p.id ? 'on' : ''} onClick={() => onlyPipeline(p.id)}>{only === p.id ? 'Show all' : 'Show only this'}</button>
        <button disabled={!schedule.taskRuns.length} onClick={() => openTimeline(p.id)}>Play its day</button>
      </div>
      <JobSection title="Tasks" tasks={p.tasks} ix={ix} flat />
    </>
  )
}

/** Join chain for one path: `orders.user_id = users.id`, one hop per line. */
function joins(view: ViewGraph, path: Path) {
  const byId = new Map(view.edges.map((e) => [e.id, e]))
  return path.edges.map((id, i) => {
    const e = byId.get(id)!
    const forward = e.from === path.nodes[i]
    const [l, lc, r, rc] = forward ? [e.from, e.fromColumns, e.to, e.toColumns] : [e.to, e.toColumns, e.from, e.fromColumns]
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
  const openPath = useStore((s) => s.openPath)
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
    <section className="insp-path">
      <div className="insp-kind">
        Join paths
        <span className="spacer" />
        <button className="close" title="Close the path finder" onClick={() => openPath(false)}>✕</button>
      </div>
      <div className="path-ends">
        <TablePicker placeholder="From…" value={ends[0]} onPick={(id) => setPathEnd(0, id)} />
        <button title="Swap" onClick={() => (setPathEnd(0, ends[1]), setPathEnd(1, ends[0]))}>⇄</button>
        <TablePicker placeholder="To…" value={ends[1]} onPick={(id) => setPathEnd(1, id)} />
      </div>
      {ends[0] && ends[1] && !paths.length && <p className="hint">No join path (check hidden or folded domains and avoided tables).</p>}
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
    </section>
  )
}
