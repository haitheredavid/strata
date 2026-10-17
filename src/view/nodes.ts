import type { Graph } from '../model/types'
import { clusterNodeId } from '../model/workflow'
import { domainNodeId, jobNodeId } from './deriveView'

/** Something you can search for and focus: a table, a job, a cluster or an external source. */
export interface NodeRef {
  id: string
  name: string
  kind: 'table' | 'job' | 'cluster' | 'source'
}

const refs = new WeakMap<Graph, Map<string, NodeRef>>()

/** Every focusable node of the graph by view id, built once per graph. */
export function nodeRefs(graph: Graph): Map<string, NodeRef> {
  let m = refs.get(graph)
  if (m) return m
  m = new Map()
  const add = (r: NodeRef) => m!.set(r.id, r)
  for (const t of graph.tables) add({ id: t.id, name: t.name, kind: 'table' })
  for (const p of graph.workflows.pipelines) for (const t of p.tasks) add({ id: jobNodeId(t.id), name: t.name, kind: 'job' })
  for (const c of graph.workflows.clusters) add({ id: clusterNodeId(c.id), name: c.name, kind: 'cluster' })
  for (const s of graph.workflows.sources) add({ id: s.id, name: s.name, kind: 'source' })
  refs.set(graph, m)
  return m
}

/** A readable name for a view node id (a collapsed domain shows as its layer). */
export function nodeName(graph: Graph, id: string): string {
  const ref = nodeRefs(graph).get(id)
  if (ref) return ref.name
  return graph.layers.find((l) => domainNodeId(l.id) === id)?.name ?? id
}

/**
 * A dotted table name split for display: the last segment, then everything before it
 * (`gold.procore.prime_contracts` → `prime_contracts`, `gold.procore`). Undotted names have no prefix.
 */
export function splitName(name: string): { short: string; prefix: string } {
  const i = name.lastIndexOf('.')
  return i <= 0 || i === name.length - 1 ? { short: name, prefix: '' } : { short: name.slice(i + 1), prefix: name.slice(0, i) }
}
