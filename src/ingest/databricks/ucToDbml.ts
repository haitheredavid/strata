import type { ColumnRow, KeyRow, TableRow } from './raw'

/** `catalog.schema.table`, the id strata uses for a UC table (DBML schema = catalog, table = `"schema.table"`). */
export const fullName = (c: string, s: string, t: string) => `${c}.${s}.${t}`

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const ref = (c: string, s: string, t: string) => `${q(c)}.${q(`${s}.${t}`)}`
/** TableGroup names must be plain identifiers. */
const groupName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')
/** Long nested types (`struct<…>`) are cut so cards stay readable. */
const MAX_TYPE = 48
const typeOf = (t: string) => (t.length > MAX_TYPE ? `${t.slice(0, MAX_TYPE - 1)}…` : t)
const KIND_NOTE: Record<string, string> = { VIEW: 'view', MATERIALIZED_VIEW: 'materialized view', STREAMING_TABLE: 'streaming table', FOREIGN: 'foreign table', EXTERNAL: 'external table' }

/**
 * Unity Catalog tables as DBML: one TableGroup per schema name (the same source system across
 * bronze / silver / gold), the catalog as the DBML schema so medallion inference reads it, PKs from
 * informational constraints and FK refs between tables in the export.
 */
export function ucToDbml(tables: TableRow[], columns: ColumnRow[], keys: KeyRow[]): { dbml: string; warnings: string[] } {
  const warnings: string[] = []
  const cols = new Map<string, ColumnRow[]>()
  for (const c of columns) {
    const id = fullName(c.table_catalog, c.table_schema, c.table_name)
    if (!cols.has(id)) cols.set(id, [])
    cols.get(id)!.push(c)
  }
  const known = new Map(tables.map((t) => [fullName(t.table_catalog, t.table_schema, t.table_name), t]))

  const pk = new Map<string, string[]>()
  const fks = new Map<string, { from: string; to: string; fromCols: string[]; toCols: string[] }>()
  for (const k of [...keys].sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position))) {
    const id = fullName(k.table_catalog, k.table_schema, k.table_name)
    if (k.constraint_type === 'PRIMARY KEY') pk.set(id, [...(pk.get(id) ?? []), k.column_name])
    else if (k.ref_catalog && k.ref_schema && k.ref_table && k.ref_column) {
      const key = `${id}:${k.constraint_name}`
      const to = fullName(k.ref_catalog, k.ref_schema, k.ref_table)
      const fk = fks.get(key) ?? { from: id, to, fromCols: [], toCols: [] }
      fk.fromCols.push(k.column_name)
      fk.toCols.push(k.ref_column)
      fks.set(key, fk)
    }
  }

  const out: string[] = []
  const groups = new Map<string, string[]>()
  for (const [id, t] of [...known].sort(([a], [b]) => a.localeCompare(b))) {
    const own = (cols.get(id) ?? []).sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position))
    const keyCols = pk.get(id) ?? []
    const kind = KIND_NOTE[t.table_type]
    out.push(`Table ${ref(t.table_catalog, t.table_schema, t.table_name)} {`)
    for (const c of own) out.push(`  ${q(c.column_name)} ${q(typeOf(c.data_type))}${keyCols.length === 1 && keyCols[0] === c.column_name ? ' [pk]' : ''}`)
    if (keyCols.length > 1) out.push('  indexes {', `    (${keyCols.map(q).join(', ')}) [pk]`, '  }')
    if (kind) out.push(`  Note: 'type: ${kind}'`)
    out.push('}', '')
    const g = groupName(t.table_schema)
    groups.set(g, [...(groups.get(g) ?? []), ref(t.table_catalog, t.table_schema, t.table_name)])
  }

  let dropped = 0
  for (const fk of fks.values()) {
    if (!known.has(fk.to)) {
      dropped++
      continue
    }
    const [fc, fs, ...ft] = fk.from.split('.')
    const [tc, ts, ...tt] = fk.to.split('.')
    out.push(`Ref: ${ref(fc, fs, ft.join('.'))}.(${fk.fromCols.map(q).join(', ')}) > ${ref(tc, ts, tt.join('.'))}.(${fk.toCols.map(q).join(', ')})`)
  }
  if (fks.size) out.push('')
  if (dropped) warnings.push(`${dropped} foreign key(s) point outside the export and were left out`)

  for (const [g, members] of [...groups].sort(([a], [b]) => a.localeCompare(b)))
    out.push(`TableGroup ${g} {`, ...members.map((m) => `  ${m}`), '}', '')

  if (tables.length && !fks.size) warnings.push('No foreign keys in Unity Catalog for these tables: only lineage edges will show')
  return { dbml: out.join('\n'), warnings }
}
