import { Parser } from '@dbml/core'
import type { Graph, Layer, Ref, RefKind, Table } from '../model/types'
import { EMPTY_WORKFLOWS } from '../model/workflow'
import { inferMedallion, list, noteFields, parseTriggerText } from './notes'
import { buildWorkflows, parseSidecar } from './workflows'
import type { RawPipeline } from './workflows'

export const UNGROUPED = '__ungrouped__'

const PALETTE = ['#4f9dff', '#ff8a3d', '#3ccf91', '#c77dff', '#ff5d8f', '#f5c542', '#2ec4d6', '#a3a3a3']

// Minimal shapes of the @dbml/core model we read from.
interface DbmlField { name: string; type: { type_name: string }; pk: boolean }
interface DbmlTable { name: string; fields: DbmlField[]; group?: { name: string } | null; note?: string | null }
interface DbmlEndpoint { schemaName: string | null; tableName: string; fieldNames: string[]; relation: '1' | '*' }
interface DbmlSchema {
  name: string
  tables: DbmlTable[]
  tableGroups: { name: string; note?: string | null }[]
  refs: { endpoints: [DbmlEndpoint, DbmlEndpoint] }[]
}

const tableId = (schema: string | null, name: string) =>
  !schema || schema === 'public' ? name : `${schema}.${name}`

const KINDS: Record<string, RefKind> = { '1-1': '1-1', '1-*': '1-n', '*-1': 'n-1', '*-*': 'n-n' }

/**
 * Parses DBML (plus an optional workflow sidecar file) into a Graph. Table and TableGroup notes may
 * carry `key: value` lines: `medallion`, `job`, `from`, `emits`, `pipeline`, `trigger`.
 */
export function parseDbml(src: string, sidecar?: string | null): Graph {
  const db = Parser.parse(src, 'dbmlv2') as unknown as { schemas: DbmlSchema[] }

  const groupNames: string[] = []
  const groupFields = new Map<string, Record<string, string>>()
  for (const s of db.schemas)
    for (const g of s.tableGroups) {
      groupNames.push(g.name)
      groupFields.set(g.name, noteFields(g.note))
    }

  const tables: Table[] = []
  const notePipelines = new Map<string, RawPipeline>()
  for (const s of db.schemas) {
    for (const t of s.tables) {
      const id = tableId(s.name, t.name)
      const fields = noteFields(t.note)
      tables.push({
        id,
        name: id,
        layerId: t.group?.name ?? UNGROUPED,
        columns: t.fields.map((f) => ({ name: f.name, type: f.type.type_name, pk: !!f.pk, fk: false })),
        medallion: inferMedallion(s.name, t.name, fields),
        note: t.note ?? undefined,
      })
      // `job: x` on a table means task x writes it (reading `from`).
      if (fields.job) {
        const group = t.group ? groupFields.get(t.group.name) ?? {} : {}
        const pid = fields.pipeline ?? group.pipeline ?? 'dbml_notes'
        if (!notePipelines.has(pid)) {
          const trigger = group.trigger ?? fields.trigger
          notePipelines.set(pid, { id: pid, trigger: trigger ? parseTriggerText(trigger) : undefined, tasks: [] })
        }
        notePipelines.get(pid)!.tasks.push({ id: fields.job, reads: list(fields.from), writes: [id], emits: list(fields.emits) })
      }
    }
  }
  const byId = new Map(tables.map((t) => [t.id, t]))

  const refs: Ref[] = []
  for (const s of db.schemas) {
    for (const r of s.refs) {
      const [a, b] = r.endpoints
      const from = { table: tableId(a.schemaName, a.tableName), columns: a.fieldNames }
      const to = { table: tableId(b.schemaName, b.tableName), columns: b.fieldNames }
      if (!byId.has(from.table) || !byId.has(to.table)) continue
      refs.push({ id: `r${refs.length}`, from, to, kind: KINDS[`${a.relation}-${b.relation}`] ?? 'n-1' })
      // FK lives on the many side; for 1-1 mark the "from" side.
      const fkEnd = a.relation === '1' && b.relation === '*' ? to : from
      for (const c of byId.get(fkEnd.table)!.columns) if (fkEnd.columns.includes(c.name)) c.fk = true
    }
  }

  const layerIds = [...groupNames]
  if (tables.some((t) => t.layerId === UNGROUPED)) layerIds.push(UNGROUPED)
  const layers: Layer[] = layerIds.map((id, i) => ({
    id,
    name: id === UNGROUPED ? 'ungrouped' : id,
    color: PALETTE[i % PALETTE.length],
  }))

  const side = sidecar ? parseSidecar(sidecar) : null
  const inputs = [[...notePipelines.values()], ...(side ? [side.pipelines] : [])]
  const workflows = inputs.some((i) => i.length)
    ? buildWorkflows(inputs, tables.map((t) => t.id), side?.warnings ?? [], side?.clusters ?? [])
    : { ...EMPTY_WORKFLOWS, warnings: side?.warnings ?? [] }

  return { tables, refs, layers, workflows }
}
