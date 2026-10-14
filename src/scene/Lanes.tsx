import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, TubeGeometry, Vector3 } from 'three'
import type { Mesh, MeshBasicMaterial } from 'three'
import type { Placement } from '../layout/modes'
import type { Pipeline } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { runSteps } from '../view/runOrder'
import { animState } from './anim'

interface Props {
  view: ViewGraph
  placement: Placement
  pipelines: Pipeline[]
  colorOf: (pipelineId: string) => string
  opacityOf: (pipelineId: string) => number
  /** Axis that keeps parallel lanes apart: up in 3D, across the page when the diagram lies flat. */
  spread?: 'y' | 'z'
}

const LANE_OPACITY = 0.2
const tmp = new Color()

/**
 * One translucent ribbon per pipeline, threading its run order: what the first step reads, each step's
 * jobs, then what the last step writes. Built from placement targets; fades out while cards move.
 * Every lane is merged into one geometry (per-vertex color and opacity), so they draw in one call.
 */
export function Lanes({ view, placement, pipelines, colorOf, opacityOf, spread = 'y' }: Props) {
  const geometry = useMemo(() => {
    const at = (id: string) => placement.nodes[id]?.p
    const mean = (ids: string[]) => {
      const ps = ids.map(at).filter(Boolean) as [number, number, number][]
      if (!ps.length) return null
      return new Vector3(...[0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length) as [number, number, number])
    }
    // What each job reads and writes, once, instead of a scan of every flow per pipeline.
    const readsOf = new Map<string, string[]>()
    const writesOf = new Map<string, string[]>()
    for (const f of view.flows) {
      const [m, job, other] = f.role === 'read' ? [readsOf, f.to, f.from] : [writesOf, f.from, f.to]
      const list = m.get(job)
      if (list) list.push(other)
      else m.set(job, [other])
    }
    const tubes: { geo: TubeGeometry; color: Color; alpha: number }[] = []
    pipelines.forEach((p, k) => {
      const steps = runSteps(p).steps.map((s) => s.map((id) => `job:${id}`).filter((id) => at(id)))
      const live = steps.filter((s) => s.length)
      if (!live.length) return
      const reads = live[0].flatMap((j) => readsOf.get(j) ?? [])
      const writes = live.at(-1)!.flatMap((j) => writesOf.get(j) ?? [])
      const pts = [mean(reads), ...live.map(mean), mean(writes)].filter((v): v is Vector3 => !!v)
      if (pts.length < 2) return
      const offset = (k - (pipelines.length - 1) / 2) * 0.35 // keep parallel lanes apart
      for (const v of pts) v[spread] += offset
      const geo = new TubeGeometry(new CatmullRomCurve3(pts, false, 'centripetal'), pts.length * 16, 0.22, 8, false)
      tubes.push({ geo, color: new Color(colorOf(p.id)), alpha: LANE_OPACITY * opacityOf(p.id) })
    })
    const merged = merge(tubes)
    tubes.forEach((t) => t.geo.dispose())
    return merged
  }, [view, placement, pipelines, colorOf, opacityOf, spread])
  useEffect(() => () => geometry.dispose(), [geometry])

  const mesh = useRef<Mesh<BufferGeometry, MeshBasicMaterial>>(null)
  useFrame(() => {
    if (mesh.current) mesh.current.material.opacity = 1 - animState.moving
  })
  return (
    <mesh ref={mesh} geometry={geometry} raycast={() => null} renderOrder={-1} frustumCulled={false}>
      <meshBasicMaterial vertexColors transparent depthWrite={false} />
    </mesh>
  )
}

/** One indexed geometry from many tubes, with each tube's color and opacity as per-vertex rgba. */
function merge(tubes: { geo: TubeGeometry; color: Color; alpha: number }[]) {
  let verts = 0
  let idx = 0
  for (const t of tubes) {
    verts += t.geo.getAttribute('position').count
    idx += t.geo.index!.count
  }
  const pos = new Float32Array(verts * 3)
  const col = new Float32Array(verts * 4)
  const index = new Uint32Array(idx)
  let v = 0
  let i = 0
  for (const t of tubes) {
    const p = t.geo.getAttribute('position').array as Float32Array
    const n = p.length / 3
    pos.set(p, v * 3)
    tmp.copy(t.color)
    for (let k = 0; k < n; k++) col.set([tmp.r, tmp.g, tmp.b, t.alpha], (v + k) * 4)
    const src = t.geo.index!.array
    for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v
    v += n
    i += src.length
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('color', new BufferAttribute(col, 4))
  g.setIndex(new BufferAttribute(index, 1))
  return g
}
