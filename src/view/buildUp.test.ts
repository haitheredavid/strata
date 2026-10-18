import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { buildUp, revealed } from './buildUp'
import { deriveView } from './deriveView'
import { lineageDepth } from './lineageDepth'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const view = deriveView(graph, { lineage: true, compute: true })
const depth = lineageDepth(graph)
const b = buildUp(view, depth)

describe('buildUp', () => {
  it('brings every node in one after another, upstream first, all shown by the end', () => {
    const starts = view.nodes.map((n) => b.start.get(n.id)!)
    expect(new Set(starts).size).toBe(starts.length)
    for (const n of view.nodes) {
      expect(revealed(b, n.id, 0)).toBeLessThan(1)
      expect(revealed(b, n.id, 1)).toBe(1)
    }
    const byStart = [...view.nodes].sort((x, y) => b.start.get(x.id)! - b.start.get(y.id)!)
    for (let i = 1; i < byStart.length; i++) expect(depth.get(byStart[i].id) ?? 0).toBeGreaterThanOrEqual(depth.get(byStart[i - 1].id) ?? 0)
  })

  it('shows a cluster once its jobs are in, and takes longer for bigger views', () => {
    for (const c of view.clusters) for (const j of c.jobs) expect(b.start.get(c.id)!).toBeGreaterThanOrEqual(b.start.get(j)!)
    const small = buildUp({ ...view, nodes: view.nodes.slice(0, 3), clusters: [] }, depth)
    expect(small.seconds).toBeLessThan(buildUp({ ...view, nodes: [...view.nodes, ...view.nodes.map((n) => ({ ...n, id: `${n.id}'` }))] }, depth).seconds)
  })

  it('leaves nodes it does not know shown', () => {
    expect(revealed(b, 'not-in-the-view', 0)).toBe(1)
  })
})
