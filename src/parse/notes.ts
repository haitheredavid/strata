import { MEDALLIONS } from '../model/workflow'
import type { Medallion, Trigger } from '../model/workflow'

/** `key: value` lines from a DBML note. Keys are lower-cased; other lines are ignored. */
export function noteFields(note: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (note ?? '').split('\n')) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(line)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return out
}

export const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const SCHEMA_MEDALLION: Record<string, Medallion> = {
  bronze: 'bronze', raw: 'bronze', landing: 'bronze',
  silver: 'silver', clean: 'silver', cleansed: 'silver', refined: 'silver',
  gold: 'gold', curated: 'gold', mart: 'gold', marts: 'gold',
  platinum: 'platinum',
}
const PREFIXES: [RegExp, Medallion][] = [
  [/^(brz|bronze|raw)_/i, 'bronze'],
  [/^(slv|silver)_/i, 'silver'],
  [/^(gld|gold)_/i, 'gold'],
  [/^(plt|platinum)_/i, 'platinum'],
]

/** Medallion layer: explicit `medallion:` note, then schema name, then table-name prefix. */
export function inferMedallion(schema: string | null, name: string, fields: Record<string, string>): Medallion | undefined {
  const explicit = fields.medallion?.toLowerCase()
  if (MEDALLIONS.includes(explicit as Medallion)) return explicit as Medallion
  const bySchema = schema ? SCHEMA_MEDALLION[schema.toLowerCase()] : undefined
  if (bySchema) return bySchema
  return PREFIXES.find(([re]) => re.test(name))?.[1]
}

/**
 * Trigger from text: `schedule 0 2 * * *`, `file_arrival /Volumes/raw/x`, `table_update a, b`,
 * `after other_pipeline`, `manual`, `continuous`.
 */
export function parseTriggerText(text: string): Trigger | undefined {
  const m = /^\s*([a-z_]+)\s*(.*?)\s*$/i.exec(text)
  if (!m) return undefined
  const [, kind, rest] = m
  switch (kind.toLowerCase()) {
    case 'schedule':
    case 'cron':
      return rest ? { kind: 'schedule', cron: rest } : undefined
    case 'file_arrival':
    case 'file':
      return rest ? { kind: 'file_arrival', path: rest } : undefined
    case 'table_update':
    case 'on_update':
      return { kind: 'table_update', tables: list(rest) }
    case 'after':
    case 'job':
      return rest ? { kind: 'job', pipeline: rest } : undefined
    case 'manual':
      return { kind: 'manual' }
    case 'continuous':
      return { kind: 'continuous' }
  }
  return undefined
}
