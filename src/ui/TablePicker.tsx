import { useState } from 'react'
import { useStore } from '../store'

interface Props {
  placeholder: string
  onPick: (id: string) => void
  /** Shown when the input is empty and not being edited. */
  value?: string | null
}

/** Substring search over table names with a small dropdown. */
export function TablePicker({ placeholder, onPick, value }: Props) {
  const graph = useStore((s) => s.graph)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)

  const matches = query
    ? graph.tables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : []

  const pick = (id: string) => {
    onPick(id)
    setQuery('')
  }

  return (
    <div className="search">
      <input
        placeholder={placeholder}
        value={editing || !value ? query : value}
        onFocus={() => setEditing(true)}
        onBlur={() => (setEditing(false), setQuery(''))}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) pick(matches[0].id)
          if (e.key === 'Escape') setQuery('')
        }}
      />
      {matches.length > 0 && (
        <ul>
          {matches.map((t) => (
            <li key={t.id} onMouseDown={() => pick(t.id)}>
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
