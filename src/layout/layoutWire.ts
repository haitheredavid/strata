import type { Graph } from '../model/types'
import { EMPTY_WORKFLOWS } from '../model/workflow'

/**
 * What the layout worker needs from a graph, and nothing more: ids, layers, column counts (card size)
 * and FK endpoints. Much cheaper to post than the full graph with its columns, notes and workflows.
 */
export interface LayoutRequest {
  id: number
  layerGap: number
  layers: string[]
  tableIds: string[]
  tableLayers: string[]
  columnCounts: Uint16Array
  /** FK endpoints as table indices, from/to pairs. */
  refs: Uint32Array
}

export interface LayoutResponse {
  id: number
  /** x, z per table, in `tableIds` order. */
  xz: Float32Array
}

export function toWire(id: number, graph: Graph, layerGap: number): LayoutRequest {
  const index = new Map(graph.tables.map((t, i) => [t.id, i]))
  const refs = new Uint32Array(graph.refs.length * 2)
  let k = 0
  for (const r of graph.refs) {
    const a = index.get(r.from.table)
    const b = index.get(r.to.table)
    if (a === undefined || b === undefined) continue
    refs[k++] = a
    refs[k++] = b
  }
  return {
    id,
    layerGap,
    layers: graph.layers.map((l) => l.id),
    tableIds: graph.tables.map((t) => t.id),
    tableLayers: graph.tables.map((t) => t.layerId),
    columnCounts: Uint16Array.from(graph.tables, (t) => Math.min(t.columns.length, 65535)),
    refs: refs.slice(0, k),
  }
}

/** Rebuilds a graph `autoLayout` accepts: columns are placeholders, only their count matters. */
export function fromWire(req: LayoutRequest): Graph {
  const tables = req.tableIds.map((id, i) => ({
    id,
    name: id,
    layerId: req.tableLayers[i],
    columns: Array.from({ length: req.columnCounts[i] }, () => ({ name: '', type: '', pk: false, fk: false })),
  }))
  const refs: Graph['refs'] = []
  for (let k = 0; k < req.refs.length; k += 2) {
    const from = req.tableIds[req.refs[k]]
    const to = req.tableIds[req.refs[k + 1]]
    refs.push({ id: `r${k / 2}`, from: { table: from, columns: [] }, to: { table: to, columns: [] }, kind: 'n-1' })
  }
  return { tables, refs, layers: req.layers.map((id) => ({ id, name: id, color: '' })), workflows: EMPTY_WORKFLOWS }
}
