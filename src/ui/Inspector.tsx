import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Graph, Table } from '../model/types'
import { clusterNodeId } from '../model/workflow'
import type { Cluster, Pipeline, Task } from '../model/workflow'
import { clockOf } from '../sim/schedule'
import type { PipelineRun, RunState, Schedule, TaskRun } from '../sim/schedule'
import { clusterSpec, KIND_LABEL } from '../scene/clusterStyle'
import { usePaths, useView } from '../scene/usePlacement'
import { scheduleOf, useStore } from '../store'
import { usePalette } from '../theme/palette'
import { domainNodeId, jobNodeId } from '../view/deriveView'
import type { ViewGraph } from '../view/deriveView'
import { nodeName, nodeRefs, splitName } from '../view/nodes'
import type { Path } from '../view/paths'
import { ComputeSection } from './ComputeSection'
import { triggerLine } from './describe'
import { goTo, selectPipeline } from './select'
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

/** The day's runs by task and by pipeline. */
const runIndexes = new WeakMap<Schedule, { byTask: Map<string, TaskRun[]>; byPipeline: Map<string, PipelineRun[]> }>()
function runsOf(s: Schedule) {
  let ix = runIndexes.get(s)
  if (ix) return ix
  ix = { byTask: new Map(), byPipeline: new Map() }
  for (const r of s.taskRuns) push(ix.byTask, r.taskId, r)
  for (const r of s.runs) push(ix.byPipeline, r.pipelineId, r)
  runIndexes.set(s, ix)
  return ix
}

const STATE_MARK: Record<RunState, string> = { success: '✓', failed: '✕', canceled: '–', skipped: '–', running: '…' }

/** `3 runs · 1 failed · last 14:32 ✓`, or `no runs today`. */
function RunSummary({ runs }: { runs: { start: number; end: number; state?: RunState; continuous?: boolean }[] }) {
  const schedule = useStore(scheduleOf)
  const clock = useMemo(() => clockOf(schedule), [schedule])
  if (!runs.length) return <span className="muted">no runs today</span>
  if (runs.some((r) => r.continuous)) return <span>streaming all day</span>
  const failed = runs.filter((r) => r.state === 'failed').length
  const last = runs.reduce((a, b) => (b.end > a.end ? b : a))
  const state = last.state ?? 'success'
  return (
    <span>
      {runs.length} run{runs.length > 1 ? 's' : ''}
      {failed > 0 && <span className="failed"> · {failed} failed</span>}
      {' · last '}
      {clock(last.end)} <span className={`state ${state}`} title={state}>{STATE_MARK[state]}</span>
    </span>
  )
}

/** A name that selects its node (or pipeline) and flies to it. */
function NodeLink({ id }: { id: string }) {
  const graph = useStore((s) => s.graph)
  const { short, prefix: rest } = splitName(nodeName(graph, id))
  return (
    <button className="link node-link" title={nodeName(graph, id)} onClick={() => goTo(id)}>
      {short}
      {rest && <span className="muted"> {rest}</span>}
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

/** Lists longer than this start folded, so the sections after them stay in view. */
const LONG_LIST = 12

function Section({ title, count, children, open }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="insp-section" open={open ?? (count === undefined || count <= LONG_LIST)}>
      <summary>
        {title}
        {count !== undefined && <span className="muted"> {count}</span>}
      </summary>
      {children}
    </details>
  )
}

/** Jobs as links with their pipeline colour and today's runs. */
function JobList({ tasks }: { tasks: Task[] }) {
  const schedule = useStore(scheduleOf)
  const palette = usePalette()
  const { byTask } = runsOf(schedule)
  return (
    <ul className="insp-list">
      {tasks.map((t) => (
        <li key={t.id}>
          <span className="swatch" style={{ background: palette.pipeline(t.pipelineId) }} />
          <NodeLink id={jobNodeId(t.id)} />
          <RunSummary runs={byTask.get(t.id) ?? []} />
        </li>
      ))}
    </ul>
  )
}

function NodeList({ ids }: { ids: string[] }) {
  return (
    <ul className="insp-list">
      {[...new Set(ids)].map((id) => (
        <li key={id}>
          <NodeLink id={id} />
        </li>
      ))}
    </ul>
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
      {pipeline ? <PipelineInspector id={pipeline} /> : focused ? <NodeInspector id={focused} /> : null}
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
      {writers.length > 0 && (
        <Section title="Written by" count={writers.length}>
          <JobList tasks={writers} />
        </Section>
      )}
      {readers.length > 0 && (
        <Section title="Read by" count={readers.length}>
          <JobList tasks={readers} />
        </Section>
      )}
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
      {out.length > 0 && (
        <Section title="References" count={new Set(out).size}>
          <NodeList ids={out} />
        </Section>
      )}
      {into.length > 0 && (
        <Section title="Referenced by" count={new Set(into).size}>
          <NodeList ids={into} />
        </Section>
      )}
      <Section title="Columns" count={table.columns.length}>
        <ul className="insp-cols">
          {table.columns.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              {c.pk && <span className="key">PK</span>}
              {c.fk && <span className="key">FK</span>}
              <span className="muted">{c.type}</span>
            </li>
          ))}
        </ul>
      </Section>
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
      {task.reads.length > 0 && (
        <Section title="Reads" count={task.reads.length}>
          <NodeList ids={task.reads} />
        </Section>
      )}
      {task.writes.length > 0 && (
        <Section title="Writes" count={task.writes.length}>
          <NodeList ids={task.writes} />
        </Section>
      )}
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
      <Section title="Runs jobs" count={jobs.length}>
        <JobList tasks={jobs} />
      </Section>
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
  const p = indexOf(graph).pipelines.get(id)
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
      <Section title="Tasks" count={p.tasks.length}>
        <JobList tasks={p.tasks} />
      </Section>
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
