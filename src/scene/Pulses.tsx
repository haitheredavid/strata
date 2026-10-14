import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Object3D } from 'three'
import type { InstancedMesh } from 'three'
import type { FlowEdge } from '../view/deriveView'
import { flowCurves } from './curve'
import { activeAt } from '../sim/schedule'
import type { Schedule } from '../sim/schedule'
import { timeClock } from './timeClock'
import { rand } from '../sim/rng'
import type { PulseShape } from '../sim/volume'

const TRAIL = 2 // dots following a running job's progress on the timeline
const SPEED = 0.35 // curve lengths per second
const dummy = new Object3D()
// CSS color → Color, parsed once rather than per dot per frame.
const colorCache = new Map<string, Color>()
const parsed = (css: string) => {
  let c = colorCache.get(css)
  if (!c) colorCache.set(css, (c = new Color(css)))
  return c
}

interface Props {
  flows: FlowEdge[]
  colorOf: (pipelineId: string) => string
  /** While the day timeline is open: only running jobs pulse, paced by their own progress. */
  schedule: Schedule | null
  /** Running jobs that pass the timeline's filters. */
  lens: Set<string> | null
  /** Per flow id, for every flow in the view (so the instance count holds as `flows` is filtered). */
  shapes: Map<string, PulseShape>
}

/**
 * Light moving along lineage edges in the data direction. Dot size shows bytes per run and the number
 * of dots on an edge shows runs per day. Idle, every visible flow pulses. With the timeline open, a
 * running job's reads pulse in the first half of its run and its writes in the second.
 */
export function Pulses({ flows, colorOf, schedule, lens, shapes }: Props) {
  const mesh = useRef<InstancedMesh>(null)
  // Sized for every flow, so a lens or the timeline filtering `flows` doesn't remount the mesh.
  const count = useMemo(() => Math.max(1, [...shapes.values()].reduce((s, x) => s + Math.max(x.dots, TRAIL), 0)), [shapes])
  // Phase by flow id, not list position, so filtering doesn't make dots jump.
  const offsets = useMemo(() => new Map([...shapes.keys()].map((id) => [id, rand(`${id}:pulse`)])), [shapes])
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    let n = 0
    const active = schedule ? activeAt(schedule, timeClock.t) : null
    for (const f of flows) {
      const curve = flowCurves.get(f.id)
      const shape = shapes.get(f.id)
      if (!curve || !shape) continue
      const job = f.role === 'read' ? f.to : f.from
      if (active) {
        const frac = active.get(job)
        if (frac === undefined || !lens?.has(job)) continue
        // reads flow into the job during the first half of its run, writes out during the second
        const local = f.role === 'read' ? frac * 2 : frac * 2 - 1
        if (local < 0 || local > 1) continue
        for (let k = 0; k < TRAIL; k++) {
          const t = Math.min(1, Math.max(0, local - k * 0.15))
          curve.getPoint(t, dummy.position)
          dummy.scale.setScalar(shape.scale * (1.4 - k * 0.45))
          dummy.updateMatrix()
          m.setMatrixAt(n, dummy.matrix)
          m.setColorAt(n++, parsed(colorOf(f.pipelineId)))
        }
        continue
      }
      const { dots, scale } = shape
      const offset = offsets.get(f.id)!
      for (let k = 0; k < dots; k++) {
        const t = (clock.elapsedTime * SPEED + offset + k / dots) % 1
        curve.getPoint(t, dummy.position)
        dummy.scale.setScalar(scale)
        dummy.updateMatrix()
        m.setMatrixAt(n, dummy.matrix)
        m.setColorAt(n++, parsed(colorOf(f.pipelineId)))
      }
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} raycast={() => null} frustumCulled={false}>
      <sphereGeometry args={[0.14, 10, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}
