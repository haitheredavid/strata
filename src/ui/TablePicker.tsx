import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { nodeRefs } from '../view/nodes'
import type { NodeRef } from '../view/nodes'

/** What a search result is: a node (table, job, cluster, source) or a whole pipeline. */
export type PickKind = NodeRef['kind'] | 'pipeline'
type Candidate = { id: string; name: string; kind: PickKind }

interface Props {
  placeholder: string
  onPick: (id: string, kind: PickKind) => void
  /** Shown when the input is empty and not being edited. */
  value?: string | null
  /** What to search: tables only (path ends), or every node and pipeline. */
  nodes?: 'tables' | 'all'
}

const MAX = 8

/** Substring search by name with a small dropdown; ↑ / ↓ move, Enter picks, Esc clears. */
export function TablePicker({ placeholder, onPick, value, nodes = 'tables' }: Props) {
  const graph = useStore((s) => s.graph)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState(0)

  const candidates = useMemo((): Candidate[] => {
    const all = [...nodeRefs(graph).values()]
    if (nodes !== 'all') return all.filter((r) => r.kind === 'table')
    return [...graph.workflows.pipelines.map((p): Candidate => ({ id: p.id, name: p.name, kind: 'pipeline' })), ...all]
  }, [graph, nodes])
  const q = query.trim().toLowerCase()
  const matches: Candidate[] = []
  if (q)
    for (const r of candidates) {
      if (!r.name.toLowerCase().includes(q)) continue
      matches.push(r)
      if (matches.length === MAX) break
    }

  const pick = (r: Candidate) => {
    onPick(r.id, r.kind)
    setQuery('')
  }

  return (
    <div className="search">
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
            if (matches.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
          } else if (e.key === 'Enter' && matches[active]) pick(matches[active])
          else if (e.key === 'Escape') {
            if (query) setQuery('')
            else e.currentTarget.blur()
          }
        }}
      />
      {matches.length > 0 && (
        <ul>
          {matches.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} className={i === active ? 'active' : ''} onMouseDown={() => pick(r)} onMouseEnter={() => setActive(i)}>
              <span className="label">{r.name}</span>
              {nodes === 'all' && r.kind !== 'table' && <span className="origin">{r.kind}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
