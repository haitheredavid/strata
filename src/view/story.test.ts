import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import type { Layout } from '../model/types'
import { jobNodeId } from './deriveView'
import { captureScene, sameScene, sceneFields } from './story'
import type { StoryFields } from './story'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const graph = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))
const [t1, t2] = graph.tables.map((t) => t.id)
const p1 = graph.workflows.pipelines[0]
const base: Layout = { layerGap: 8, layerOrder: graph.layers.map((l) => l.id), positions: { [t1]: { x: 1, z: 2 } } }
const fields = (over: Partial<StoryFields> = {}): StoryFields => ({
  layout: base,
  focusedId: null,
  lensPipeline: null,
  hopUp: 1,
  hopDown: 1,
  pathOpen: false,
  pathEnds: [null, null],
  pathIgnore: [],
  activePath: null,
  time: { open: false, t: 0, span: null },
  ...over,
})

describe('story scenes', () => {
  it('put back the view, selection, path and timeline they were captured from, keeping positions', () => {
    const s = fields({
      layout: { ...base, mode: 'flow', groupBy: 'medallion', onlyPipeline: p1.id, pipelineTablesOnly: true },
      focusedId: jobNodeId(p1.tasks[0].id),
      hopUp: 2,
      hopDown: 0,
      pathOpen: true,
      pathEnds: [t1, t2],
      pathIgnore: [t2],
      activePath: 0,
      time: { open: true, t: 0, span: [3600, 7200] },
    })
    const scene = captureScene(s, 4000, { target: [0, 0, 0], offset: [1, 2, 3] })
    // Elsewhere: another mode, nothing selected, Day closed, a dragged card.
    const moved: Layout = { ...base, positions: { [t1]: { x: 9, z: 9 } }, mode: 'diagram', hiddenLayers: [graph.layers[0].id] }
    const back = sceneFields(moved, scene, graph)
    expect(back.layout.positions).toBe(moved.positions)
    expect(back.layout.hiddenLayers).toBeUndefined()
    expect(back).toMatchObject({ ...s, layout: { mode: 'flow', groupBy: 'medallion', onlyPipeline: p1.id }, time: { open: true, t: 4000, span: [3600, 7200] } })
  })

  it('drop ids the graph no longer has', () => {
    const scene = captureScene(fields({ focusedId: 'gone', lensPipeline: 'gone', pathOpen: true, pathEnds: ['gone', t1], pathIgnore: ['gone'] }), 0, null)
    const back = sceneFields(base, scene, graph)
    expect(back).toMatchObject({ focusedId: null, lensPipeline: null, pathEnds: [null, t1], pathIgnore: [] })
  })

  it('match the view regardless of camera, playhead and list order, and not after a filter changes', () => {
    const a = captureScene(fields({ layout: { ...base, hiddenLayers: [t1, t2] }, time: { open: true, t: 0, span: null } }), 10, null)
    const b = captureScene(fields({ layout: { ...base, hiddenLayers: [t2, t1] }, time: { open: true, t: 0, span: null } }), 900, { target: [1, 1, 1], offset: [0, 5, 0] })
    expect(sameScene(a, b)).toBe(true)
    expect(sameScene(a, captureScene(fields({ layout: { ...base, hiddenLayers: [t1] } }), 10, null))).toBe(false)
  })
})
