import { SCENE_VIEW_KEYS } from '../model/types'
import type { CameraPose, Graph, Layout, SceneState } from '../model/types'
import { domainNodeId } from './deriveView'
import { nodeRefs } from './nodes'

/** The store fields a scene is captured from and puts back. */
export interface StoryFields {
  layout: Layout
  focusedId: string | null
  lensPipeline: string | null
  hopUp: number
  hopDown: number
  pathOpen: boolean
  pathEnds: [string | null, string | null]
  pathIgnore: string[]
  activePath: number | null
  time: { open: boolean; t: number; span: [number, number] | null }
}

/** What's on screen now, as a scene: `t` is the playhead (the store's is only republished now and then). */
export function captureScene(s: StoryFields, t: number, camera: CameraPose | null): SceneState {
  return {
    view: Object.fromEntries(SCENE_VIEW_KEYS.map((k) => [k, s.layout[k]])) as SceneState['view'],
    focusedId: s.focusedId,
    lensPipeline: s.lensPipeline,
    hops: [s.hopUp, s.hopDown],
    path: s.pathOpen ? { ends: [...s.pathEnds], ignore: [...s.pathIgnore], active: s.activePath } : null,
    time: s.time.open ? { t, span: s.time.span } : null,
    camera,
  }
}

/**
 * The store fields that show `scene` over `layout` (positions and the rest of the layout stay).
 * Ids the graph no longer has (a table dropped from a newer export) are left out rather than shown
 * as a dangling selection. Pure; the caller still normalises the layout.
 */
export function sceneFields(layout: Layout, scene: SceneState, graph: Graph): StoryFields {
  const refs = nodeRefs(graph)
  const node = (id: string | null) => (id && (refs.has(id) || graph.layers.some((l) => domainNodeId(l.id) === id)) ? id : null)
  const table = (id: string | null) => (id && refs.get(id)?.kind === 'table' ? id : null)
  const pipeline = (id: string | null) => (id && graph.workflows.pipelines.some((p) => p.id === id) ? id : null)
  const view = Object.fromEntries(SCENE_VIEW_KEYS.map((k) => [k, scene.view[k]]))
  const path = scene.path
  return {
    layout: { ...layout, ...view },
    focusedId: node(scene.focusedId),
    lensPipeline: pipeline(scene.lensPipeline),
    hopUp: scene.hops[0],
    hopDown: scene.hops[1],
    pathOpen: !!path,
    pathEnds: path ? [table(path.ends[0]), table(path.ends[1])] : [null, null],
    pathIgnore: path ? path.ignore.filter((id) => refs.has(id)) : [],
    activePath: path?.active ?? null,
    time: scene.time ? { open: true, t: scene.time.t, span: scene.time.span } : { open: false, t: 0, span: null },
  }
}

/** A scene with list order, the camera and the playhead left out, for telling whether the view still matches it. */
function canon(s: SceneState) {
  const sorted = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v].sort() : v)
  const view = Object.fromEntries(SCENE_VIEW_KEYS.map((k) => [k, sorted(s.view[k])]))
  return JSON.stringify({ ...s, view, camera: null, time: s.time && { span: s.time.span } })
}

/** Whether two scenes show the same thing, apart from where the camera is and where the playhead sits. */
export const sameScene = (a: SceneState, b: SceneState) => canon(a) === canon(b)
