/** Items of a list that share a key (a schema, a pipeline), in the list's order. */
export interface Group<T> {
  key: string
  items: T[]
}

/** Groups items by key, largest group first (ties by key); items keep their order within a group. Pure. */
export function groupItems<T>(items: readonly T[], keyOf: (item: T) => string): Group<T>[] {
  const byKey = new Map<string, T[]>()
  for (const item of items) {
    const k = keyOf(item)
    const g = byKey.get(k)
    if (g) g.push(item)
    else byKey.set(k, [item])
  }
  return [...byKey]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
}

/** The groups with only the items that match; groups left empty drop out. */
export function filterGroups<T>(groups: readonly Group<T>[], match: (item: T) => boolean): Group<T>[] {
  return groups.map((g) => ({ key: g.key, items: g.items.filter(match) })).filter((g) => g.items.length > 0)
}

/** The first `limit` items across the groups in order; the group that crosses the limit is cut short. */
export function takeItems<T>(groups: readonly Group<T>[], limit: number): Group<T>[] {
  const out: Group<T>[] = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    out.push(g.items.length <= left ? g : { key: g.key, items: g.items.slice(0, left) })
    left -= g.items.length
  }
  return out
}
