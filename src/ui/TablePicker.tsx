import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { TRIGGER_LABEL } from '../scene/timeClock'
import { jobNodeId } from '../view/deriveView'
import { nodeRefs, splitName } from '../view/nodes'
import { matchRanges, searchNodes } from '../view/search'
import type { SearchCandidate, SearchKind } from '../view/search'

/** What a search result is: a node (table, job, cluster, source) or a whole pipeline. */
export type PickKind = SearchKind

interface Props {
  placeholder: string
  onPick: (id: string, kind: PickKind) => void
  /** Shown when the input is empty and not being edited. */
  value?: string | null
  /** What to search: tables only (path ends), or every node and pipeline. */
  nodes?: 'tables' | 'all'
}

/** Rows per kind in the grouped (all nodes) dropdown, and rows in the flat (tables) one. */
const PER_GROUP = 4
const FLAT = 8
const GROUP_LABEL: Record<SearchKind, string> = { pipeline: 'Pipelines', table: 'Tables', job: 'Jobs', source: 'Sources', cluster: 'Compute' }

/** `text` with the query's tokens in `<mark>`. */
function Marked({ text, query }: { text: string; query: string }) {
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of matchRanges(text, query)) {
    if (a > at) out.push(text.slice(at, a))
    out.push(<mark key={a}>{text.slice(a, b)}</mark>)
    at = b
  }
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

/**
 * Search by name with a dropdown: every query word must match, best matches first. Over all nodes it
 * groups by kind (Pipelines, Tables, Jobs, Sources, Compute); ↑ / ↓ move, Enter picks, Esc clears.
 */
export function TablePicker({ placeholder, onPick, value, nodes = 'tables' }: Props) {
  const graph = useStore((s) => s.graph)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState(0)

  const candidates = useMemo((): SearchCandidate[] => {
    const all = [...nodeRefs(graph).values()]
    if (nodes !== 'all') return all.filter((r) => r.kind === 'table')
    return [...graph.workflows.pipelines.map((p): SearchCandidate => ({ id: p.id, name: p.name, kind: 'pipeline' })), ...all]
  }, [graph, nodes])
  // The muted text after a row's name: a job's pipeline, a pipeline's trigger; else the dotted prefix (a table's schema).
  const context = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of graph.workflows.pipelines) {
      if (p.trigger) m.set(p.id, TRIGGER_LABEL[p.trigger.kind])
      for (const t of p.tasks) m.set(jobNodeId(t.id), p.name)
    }
    return m
  }, [graph])
  const groups = useMemo(() => searchNodes(candidates, query, { perGroup: nodes === 'all' ? PER_GROUP : FLAT }), [candidates, query, nodes])
  const rows = groups.flatMap((g) => g.hits)

  const pick = (r: SearchCandidate) => {
    onPick(r.id, r.kind)
    setQuery('')
  }

  let i = 0
  return (
    <div className={`search ${nodes}`}>
      <input
        placeholder={placeholder}
        value={editing || !value ? query : value}
        onFocus={() => setEditing(true)}
        onBlur={() => (setEditing(false), setQuery(''))}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (rows.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length)
          } else if (e.key === 'Enter' && rows[active]) pick(rows[active])
          else if (e.key === 'Escape') {
            if (query) setQuery('')
            else e.currentTarget.blur()
          }
        }}
      />
      {rows.length > 0 && (
        <ul>
          {groups.map((g) => (
            <Fragment key={g.kind}>
              {nodes === 'all' && (
                <li className="group" onMouseDown={(e) => e.preventDefault()}>
                  {GROUP_LABEL[g.kind]} <span className="count">{g.total}</span>
                </li>
              )}
              {g.hits.map((r) => {
                const at = i++
                const { short, prefix } = splitName(r.name)
                const ctx = context.get(r.id) ?? prefix
                return (
                  <li
                    key={`${r.kind}:${r.id}`}
                    className={at === active ? 'active' : ''}
                    title={r.name}
                    onMouseDown={() => pick(r)}
                    onMouseEnter={() => setActive(at)}
                  >
                    <span className="label">
                      <Marked text={short} query={query} />
                      {ctx && <span className="rest"> {ctx}</span>}
                    </span>
                  </li>
                )
              })}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  )
}
