/** What a search can find: a node (table, job, cluster, source) or a whole pipeline. */
export type SearchKind = 'pipeline' | 'table' | 'job' | 'source' | 'cluster'

export interface SearchCandidate {
  id: string
  name: string
  kind: SearchKind
}

/** One kind's hits: how many matched in all, and the best `perGroup` of them. */
export interface SearchGroup<C extends SearchCandidate = SearchCandidate> {
  kind: SearchKind
  total: number
  hits: C[]
}

/** The order groups are listed in. */
export const SEARCH_KINDS: readonly SearchKind[] = ['pipeline', 'table', 'job', 'source', 'cluster']

/** Whitespace-separated, lower-cased query tokens. */
export const queryTokens = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

const WORD = /[._\- ]+/

/** Lower is better: exact name, short name starts with the query, a word starts with the first token, contains. */
function rank(name: string, query: string, first: string): number {
  if (name === query) return 0
  if (name.slice(name.lastIndexOf('.') + 1).startsWith(query)) return 1
  if (name.split(WORD).some((w) => w.startsWith(first))) return 2
  return 3
}

/**
 * Candidates whose name contains every query token (case-insensitive), ranked (exact > short name starts
 * with the query > a word starts with the first token > contains, then shorter, then A–Z) and grouped by
 * kind in `SEARCH_KINDS` order. Kinds without hits are left out. Pure.
 */
export function searchNodes<C extends SearchCandidate>(candidates: readonly C[], query: string, opts: { perGroup?: number } = {}): SearchGroup<C>[] {
  const tokens = queryTokens(query)
  if (!tokens.length) return []
  const q = tokens.join(' ')
  const scored: { c: C; name: string; rank: number }[] = []
  for (const c of candidates) {
    const name = c.name.toLowerCase()
    if (!tokens.every((t) => name.includes(t))) continue
    scored.push({ c, name, rank: rank(name, q, tokens[0]) })
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0))
  const perGroup = opts.perGroup ?? Infinity
  const groups: SearchGroup<C>[] = []
  for (const kind of SEARCH_KINDS) {
    const all = scored.filter((s) => s.c.kind === kind)
    if (all.length) groups.push({ kind, total: all.length, hits: all.slice(0, perGroup).map((s) => s.c) })
  }
  return groups
}

/** Where the query's tokens occur in `text` (case-insensitive), as sorted, merged `[start, end)` ranges. */
export function matchRanges(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase()
  const found: [number, number][] = []
  for (const t of queryTokens(query))
    for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) found.push([i, i + t.length])
  found.sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of found) {
    const last = out.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}
