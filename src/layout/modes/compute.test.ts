import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../../parse/dbml'
import { buildWorkflows, coresOf, parseSidecar } from '../../parse/workflows'
import { clusterNodeId } from '../../model/workflow'
import { deriveView, jobNodeId } from '../../view/deriveView'
import { autoLayout } from '../autoLayout'
import { placeClusters } from './compute'
import { MODES } from '.'
import { placeJobs } from './jobs'

const read = (f: string) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))

describe('compute parsing', () => {
  const yaml = `
clusters:
  shared: { node_type_id: i3.2xlarge, autoscale: { min_workers: 2, max_workers: 6 } }
pipelines:
  - id: p
    job_clusters:
      - job_cluster_key: etl
        new_cluster: { node_type_id: m5d.4xlarge, num_workers: 3, spark_version: 15.4.x }
    tasks:
      - { id: a, writes: [x], job_cluster_key: etl }
      - { id: b, reads: [x], writes: [y], existing_cluster_id: shared }
      - { id: c, reads: [y], writes: [z], environment_key: default }
      - { id: d, reads: [z], writes: [w] }
      - { id: e, reads: [w], writes: [v], existing_cluster_id: nope }
`

  it('resolves job clusters, shared clusters, serverless and a default', () => {
    const side = parseSidecar(yaml)
    const wf = buildWorkflows([side.pipelines], ['x', 'y', 'z', 'w', 'v'], side.warnings, side.clusters)
    const on = Object.fromEntries(wf.pipelines[0].tasks.map((t) => [t.id, t.clusterId]))
    expect(on).toEqual({ a: 'p.etl', b: 'shared', c: 'serverless', d: 'p_cluster', e: 'p_cluster' })
    const byId = new Map(wf.clusters.map((c) => [c.id, c]))
    expect(byId.get('p.etl')).toMatchObject({ kind: 'job', nodeType: 'm5d.4xlarge', workers: { min: 3, max: 3 }, coresPerNode: 16, sparkVersion: '15.4.x' })
    expect(byId.get('shared')).toMatchObject({ kind: 'all_purpose', workers: { min: 2, max: 6 }, coresPerNode: 8 })
    expect(byId.get('serverless')?.kind).toBe('serverless')
    expect(wf.warnings).toContain('Task "e" runs on unknown cluster "nope"')
  })

  it('reads cores from node types', () => {
    expect(coresOf('i3.xlarge')).toBe(4)
    expect(coresOf('c5.9xlarge')).toBe(36)
    expect(coresOf('m6i.large')).toBe(2)
  })
})

describe('compute in the view', () => {
  it('links each visible job to its cluster, shared clusters to several pipelines', () => {
    const v = deriveView(graph, { lineage: true, compute: true })
    const shared = v.clusters.find((c) => c.id === clusterNodeId('analytics_shared'))!
    const pipelines = new Set(shared.jobs.map((j) => v.nodes.find((n) => n.id === j)!.pipelineId))
    expect([...pipelines].sort()).toEqual(['gold_analytics', 'ml_churn'])
    expect(v.computeLinks).toHaveLength(v.nodes.filter((n) => n.kind === 'job').length)
  })

  it('is off without the option and follows hidden pipelines', () => {
    expect(deriveView(graph, { lineage: true }).clusters).toEqual([])
    const v = deriveView(graph, { lineage: true, compute: true, hiddenPipelines: ['gold_analytics', 'ml_churn'] })
    expect(v.clusters.map((c) => c.id)).not.toContain(clusterNodeId('analytics_shared'))
    expect(v.computeLinks.some((l) => l.job === jobNodeId('build_funnel'))).toBe(false)
  })

  it('places clusters below everything else in every mode', () => {
    const layout = autoLayout(graph)
    const v = deriveView(graph, { lineage: true, compute: true })
    for (const mode of Object.values(MODES)) {
      const base = placeJobs(v, mode.place(v, layout, { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }), mode.id, 8)
      const p = placeClusters(v, base, mode.id, 8)
      const lowest = Math.min(...Object.values(base.nodes).map((n) => n.p[1]))
      for (const c of v.clusters) expect(p.nodes[c.id].p[1], `${mode.id} ${c.id}`).toBeLessThan(lowest)
    }
  })
})
