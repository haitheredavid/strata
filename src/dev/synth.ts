import type { Column, Graph, Layer, Ref, Table } from '../model/types'
import type { Cluster, Medallion } from '../model/workflow'
import { buildWorkflows } from '../parse/workflows'
import type { RawPipeline, RawTask } from '../parse/workflows'
import { hash32 } from '../sim/rng'

/** Shape of a synthetic schema. Everything is derived from `seed`, so the same options give the same graph. */
export interface SynthOptions {
  tables: number
  /** Average outgoing FKs per table. */
  refsPerTable: number
  /** Domains (TableGroups). Defaults to about one per 50 tables. */
  layers?: number
  pipelines: number
  tasksPerPipeline: number
  /** Shared all-purpose clusters some tasks run on. */
  clusters: number
  columns: [number, number]
  seed: number
}

export const SYNTH_DEFAULTS: SynthOptions = {
  tables: 1000,
  refsPerTable: 1.5,
  pipelines: 0,
  tasksPerPipeline: 4,
  clusters: 4,
  columns: [4, 12],
  seed: 1,
}

const LAYER_COLORS = ['#4f9dff', '#ff8a3d', '#3ccf91', '#c77dff', '#ff5d8f', '#f5c542', '#2ec4d6', '#a3a3a3']
const TYPES = ['int', 'bigint', 'varchar', 'text', 'timestamp', 'decimal', 'boolean', 'uuid']
const MEDALLIONS: Medallion[] = ['bronze', 'silver', 'gold']

/** mulberry32 stream: one seeded generator instead of hashing a key per draw. */
function stream(seed: number) {
  let s = hash32(`synth:${seed}`) | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A synthetic schema for profiling. FKs mostly stay inside a domain, some point upstream, and targets
 * are skewed so a few hub tables collect most references (like `users` or `orgs` in a real schema).
 * Pipelines chain tasks downstream through the domains, as an ingest → transform → publish job would.
 */
export function synthGraph(opts: Partial<SynthOptions> = {}): Graph {
  const o = { ...SYNTH_DEFAULTS, ...opts }
  const r = stream(o.seed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  // Skewed pick from [0, n): low indices (hubs) come up far more often.
  const skew = (n: number) => Math.min(n - 1, Math.floor(n * r() ** 3))

  const nLayers = Math.max(1, o.layers ?? Math.ceil(o.tables / 50))
  const layers: Layer[] = Array.from({ length: nLayers }, (_, i) => ({
    id: `d${i}`,
    name: `d${i}`,
    color: LAYER_COLORS[i % LAYER_COLORS.length],
  }))

  const byLayer: Table[][] = layers.map(() => [])
  const tables: Table[] = []
  for (let i = 0; i < o.tables; i++) {
    const l = i < nLayers ? i : int(0, nLayers - 1) // every domain gets at least one table
    const columns: Column[] = [{ name: 'id', type: 'int', pk: true, fk: false }]
    const n = int(o.columns[0], o.columns[1])
    for (let c = 1; c < n; c++) columns.push({ name: `c${c}`, type: TYPES[int(0, TYPES.length - 1)], pk: false, fk: false })
    const t: Table = {
      id: `t${i}`,
      name: `t${i}`,
      layerId: layers[l].id,
      columns,
      medallion: MEDALLIONS[Math.min(2, Math.floor((l / nLayers) * 3))],
    }
    tables.push(t)
    byLayer[l].push(t)
  }

  const refs: Ref[] = []
  const layerIndex = new Map(layers.map((l, i) => [l.id, i]))
  for (const t of tables) {
    const l = layerIndex.get(t.layerId)!
    const k = Math.round(o.refsPerTable * 2 * r()) // mean refsPerTable
    const seen = new Set<string>()
    for (let j = 0; j < k; j++) {
      // 80% inside the domain, the rest to an upstream (or any, for the first) domain
      const pool = r() < 0.8 || l === 0 ? byLayer[l] : byLayer[int(0, l - 1)]
      const to = pool[skew(pool.length)]
      if (to === t || seen.has(to.id)) continue
      seen.add(to.id)
      const col = `${to.id}_id`
      t.columns.push({ name: col, type: 'int', pk: false, fk: true })
      refs.push({ id: `r${refs.length}`, from: { table: t.id, columns: [col] }, to: { table: to.id, columns: ['id'] }, kind: 'n-1' })
    }
  }

  const shared: Cluster[] = Array.from({ length: o.clusters }, (_, i) => ({
    id: `shared${i}`,
    name: `shared-${i}`,
    kind: 'all_purpose',
    nodeType: 'i3.xlarge',
    workers: { min: 2, max: 8 },
    coresPerNode: 4,
  }))

  const raw: RawPipeline[] = []
  for (let p = 0; p < o.pipelines; p++) {
    const tasks: RawTask[] = []
    let l = int(0, Math.max(0, nLayers - o.tasksPerPipeline))
    let reads = [`src.feed${p}`]
    for (let j = 0; j < o.tasksPerPipeline; j++) {
      const pool = byLayer[Math.min(nLayers - 1, l)]
      const writes = [...new Set(Array.from({ length: int(1, 2) }, () => pool[int(0, pool.length - 1)].id))]
      const c = r()
      tasks.push({
        id: `p${p}_t${j}`,
        reads,
        writes,
        dependsOn: j ? [`p${p}_t${j - 1}`] : undefined,
        compute: c < 0.2 && shared.length ? shared[int(0, shared.length - 1)].id : c < 0.3 ? 'serverless' : undefined,
      })
      reads = writes
      l++
    }
    raw.push({ id: `p${p}`, name: `pipeline ${p}`, trigger: { kind: 'schedule', cron: `${int(0, 59)} ${int(0, 23)} * * *` }, tasks })
  }
  const workflows = raw.length
    ? buildWorkflows([raw], tables.map((t) => t.id), [], shared)
    : { pipelines: [], sources: [], clusters: [], warnings: [] }

  return { tables, refs, layers, workflows }
}

/** The graph's tables, groups and refs as DBML, to time `parseDbml` on the same shape. Workflows are left out. */
export function synthDbml(graph: Graph): string {
  const out: string[] = []
  for (const t of graph.tables) {
    out.push(`Table ${t.id} {`)
    for (const c of t.columns) out.push(`  ${c.name} ${c.type}${c.pk ? ' [pk]' : ''}`)
    out.push('}')
  }
  for (const l of graph.layers) {
    out.push(`TableGroup ${l.id} {`)
    for (const t of graph.tables) if (t.layerId === l.id) out.push(`  ${t.id}`)
    out.push('}')
  }
  for (const ref of graph.refs) out.push(`Ref: ${ref.from.table}.${ref.from.columns[0]} > ${ref.to.table}.${ref.to.columns[0]}`)
  return out.join('\n')
}

/** Parses `tables:20000,pipelines:300,seed:1` (the `?synth=` URL form). Unknown keys are ignored. */
export function parseSynthSpec(spec: string): Partial<SynthOptions> {
  const o: Partial<SynthOptions> = {}
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':').map((s) => s.trim())
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    if (k === 'tables' || k === 'layers' || k === 'pipelines' || k === 'tasksPerPipeline' || k === 'clusters' || k === 'seed' || k === 'refsPerTable')
      o[k] = n
  }
  return o
}

/** Stable key for a synthetic graph's saved layout. */
export const synthKey = (o: Partial<SynthOptions>) => `synth:${JSON.stringify({ ...SYNTH_DEFAULTS, ...o })}`
