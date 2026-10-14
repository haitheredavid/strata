import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three'
import type { MeshBasicMaterial } from 'three'
import type { Placement } from '../layout/modes'
import type { Pipeline } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { runSteps } from '../view/runOrder'
import { animState } from './anim'

interface Props {
  view: ViewGraph
  placement: Placement
  pipelines: Pipeline[]
  opacityOf: (pipelineId: string) => number
  /** Axis that keeps parallel lanes apart: up in 3D, across the page when the diagram lies flat. */
  spread?: 'y' | 'z'
}

/**
 * One translucent ribbon per pipeline, threading its run order: what the first step reads, each step's
 * jobs, then what the last step writes. Built from placement targets; fades out while cards move.
 */
export function Lanes({ view, placement, pipelines, opacityOf, spread = 'y' }: Props) {
  const lanes = useMemo(() => {
    const at = (id: string) => placement.nodes[id]?.p
    const mean = (ids: string[]) => {
      const ps = ids.map(at).filter(Boolean) as [number, number, number][]
      if (!ps.length) return null
      return new Vector3(...[0, 1, 2].map((i) => ps.reduce((s, p) => s + p[i], 0) / ps.length) as [number, number, number])
    }
    return pipelines.flatMap((p, k) => {
      const steps = runSteps(p).steps.map((s) => s.map((id) => `job:${id}`).filter((id) => at(id)))
      const live = steps.filter((s) => s.length)
      if (!live.length) return []
      const reads = view.flows.filter((f) => live[0].includes(f.to)).map((f) => f.from)
      const writes = view.flows.filter((f) => live.at(-1)!.includes(f.from)).map((f) => f.to)
      const pts = [mean(reads), ...live.map(mean), mean(writes)].filter((v): v is Vector3 => !!v)
      if (pts.length < 2) return []
      const offset = (k - (pipelines.length - 1) / 2) * 0.35 // keep parallel lanes apart
      for (const v of pts) v[spread] += offset
      const geo = new TubeGeometry(new CatmullRomCurve3(pts, false, 'centripetal'), pts.length * 16, 0.22, 8, false)
      return [{ id: p.id, color: p.color, geo }]
    })
  }, [view, placement, pipelines, spread])
  useEffect(() => () => lanes.forEach((l) => l.geo.dispose()), [lanes])

  return (
    <>
      {lanes.map((l) => (
        <Lane key={l.id} geo={l.geo} color={l.color} opacity={opacityOf(l.id)} />
      ))}
    </>
  )
}

function Lane({ geo, color, opacity }: { geo: TubeGeometry; color: string; opacity: number }) {
  const mat = useRef<MeshBasicMaterial>(null)
  useFrame(() => {
    if (mat.current) mat.current.opacity = 0.2 * opacity * (1 - animState.moving)
  })
  return (
    <mesh geometry={geo} raycast={() => null} renderOrder={-1}>
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.2 * opacity} depthWrite={false} />
    </mesh>
  )
}
