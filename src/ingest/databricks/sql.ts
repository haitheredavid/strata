// Pure helpers for the exporter's SQL against Unity Catalog system tables.

/** Catalog names the exporter accepts (they're spliced into SQL as literals, but kept boring anyway). */
export const IDENT = /^[A-Za-z0-9_-]+$/

/** A Databricks SQL string literal. */
export const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** A glob (`procore*`) as a LIKE pattern, `_` and `%` taken literally. */
export const like = (glob: string) => lit(glob.replace(/[\\_%]/g, (c) => `\\${c}`).replace(/\*/g, '%'))

/**
 * The slice as a WHERE clause on catalog / schema columns: catalogs listed exactly, schemas by globs
 * (`procore*`), with `!glob` excluding. information_schema never counts.
 */
export function sliceWhere(catalogs: string[], schemas: string[], cat: string, sch: string) {
  const inc = schemas.filter((s) => !s.startsWith('!'))
  const exc = schemas.filter((s) => s.startsWith('!')).map((s) => s.slice(1))
  return [
    `${cat} IN (${catalogs.map(lit).join(', ')})`,
    `${sch} <> 'information_schema'`,
    inc.length ? `(${inc.map((g) => `${sch} LIKE ${like(g)}`).join(' OR ')})` : 'TRUE',
    ...exc.map((g) => `${sch} NOT LIKE ${like(g)}`),
  ].join(' AND ')
}

/** `items` in runs of at most `n` (one SQL statement each keeps statements and results small). */
export function chunks<T>(items: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

/** `expr IN (...)` for each run of `ids`: one predicate per statement. */
export const inLists = (expr: string, ids: string[], n: number) => chunks(ids, n).map((c) => `${expr} IN (${c.map(lit).join(', ')})`)
