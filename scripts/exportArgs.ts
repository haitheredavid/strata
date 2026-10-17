import { parseArgs } from 'node:util'
import { IDENT } from '../src/ingest/databricks/sql'
import { isDay, isTimeZone, yesterday } from '../src/ingest/databricks/time'

export const USAGE = `Usage: pnpm export:databricks --profile <name> --catalogs a,b [--schemas 'x*,!*archive*'] [--day YYYY-MM-DD]
                          [--tz Zone] [--lineage-days 7] [--warehouse <id>] [--sql-timeout 15] [--out file] [--resume]
       pnpm export:databricks --from-raw snapshots/.raw/<name>.raw.json [--out file]`

/** What to export, from where. */
export interface ExportOptions {
  profile: string
  catalogs: string[]
  /** Schema globs; `!glob` excludes. */
  schemas: string[]
  day: string
  tz: string
  lineageDays: number
  warehouse?: string
  /** Minutes one SQL statement may run before it's cancelled. */
  sqlTimeoutMin: number
  /** Pick up the steps a failed run already saved. */
  resume: boolean
  out?: string
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'fromRaw'; file: string; out?: string; ignored: string[] }
  | { kind: 'export'; options: ExportOptions }

/** A bad command line, reported with the usage. */
export class ArgError extends Error {}

const FETCH_FLAGS = ['profile', 'catalogs', 'schemas', 'day', 'tz', 'lineage-days', 'warehouse', 'sql-timeout', 'resume'] as const

const OPTIONS = {
  profile: { type: 'string' },
  catalogs: { type: 'string' },
  schemas: { type: 'string' },
  day: { type: 'string' },
  tz: { type: 'string' },
  'lineage-days': { type: 'string' },
  warehouse: { type: 'string' },
  'sql-timeout': { type: 'string' },
  resume: { type: 'boolean' },
  out: { type: 'string' },
  'from-raw': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

function flags(argv: string[]) {
  try {
    return parseArgs({ args: argv, strict: true, allowPositionals: false, options: OPTIONS }).values
  } catch (e) {
    throw new ArgError(e instanceof Error ? e.message : String(e))
  }
}

/** Parses and checks the exporter's flags; throws `ArgError` with a readable message. */
export function parseExportArgs(argv: string[], systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now()): ParsedArgs {
  const values = flags(argv)
  if (values.help) return { kind: 'help' }
  if (values['from-raw'] !== undefined) {
    if (!values['from-raw']) throw new ArgError('--from-raw needs a file')
    return { kind: 'fromRaw', file: values['from-raw'], out: values.out, ignored: FETCH_FLAGS.filter((f) => values[f] !== undefined).map((f) => `--${f}`) }
  }

  const profile = values.profile ?? ''
  if (!profile) throw new ArgError('--profile is required (see `databricks auth profiles`); it is never picked for you')
  const catalogs = (values.catalogs ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!catalogs.length) throw new ArgError('--catalogs is required, e.g. --catalogs bronze,silver,gold')
  const badCatalog = catalogs.find((c) => !IDENT.test(c))
  if (badCatalog) throw new ArgError(`Catalog "${badCatalog}" isn't a plain name (letters, digits, _ and -)`)
  const schemas = (values.schemas ?? '*').split(',').map((s) => s.trim()).filter(Boolean)
  if (!schemas.length) throw new ArgError('--schemas is empty; leave it out to take every schema')

  const tz = values.tz ?? systemTz
  if (!isTimeZone(tz)) throw new ArgError(`--tz "${tz}" isn't a time zone (e.g. America/New_York, UTC)`)
  const day = values.day ?? yesterday(tz, now)
  if (!isDay(day)) throw new ArgError(`--day "${day}" isn't a date in YYYY-MM-DD form`)
  const lineageDays = Number(values['lineage-days'] ?? 7)
  if (!Number.isInteger(lineageDays) || lineageDays < 1 || lineageDays > 365)
    throw new ArgError(`--lineage-days must be a whole number of days from 1 to 365, not "${values['lineage-days']}"`)
  const sqlTimeoutMin = Number(values['sql-timeout'] ?? 15)
  if (!(sqlTimeoutMin > 0)) throw new ArgError(`--sql-timeout must be a positive number of minutes, not "${values['sql-timeout']}"`)

  return {
    kind: 'export',
    options: { profile, catalogs, schemas, day, tz, lineageDays, warehouse: values.warehouse, sqlTimeoutMin, resume: !!values.resume, out: values.out },
  }
}
