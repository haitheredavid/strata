import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Object3D } from 'three'
import type { InstancedMesh } from 'three'
import type { FlowEdge } from '../view/deriveView'
import { flowCurves } from './curve'
import { activeAt } from '../sim/schedule'
import type { Schedule } from '../sim/schedule'
import { timeClock } from './timeClock'
import { pulseShape } from '../sim/volume'
import type { FlowVolume } from '../sim/volume'

const TRAIL = 2 // dots following a running job's progress on the timeline
const SPEED = 0.35 // curve lengths per second
const dummy = new Object3D()
const tmpColor = new Color()

interface Props {
  flows: FlowEdge[]
  colorOf: (pipelineId: string) => string
  /** While the day timeline is open: only running jobs pulse, paced by their own progress. */
  schedule: Schedule | null
  /** Running jobs that pass the timeline's filters. */
  lens: Set<string> | null
  volumes: Map<string, FlowVolume>
}

/**
 * Light moving along lineage edges in the data direction. Dot size shows bytes per run and the number
 * of dots on an edge shows runs per day. Idle, every visible flow pulses. With the timeline open, a
 * running job's reads pulse in the first half of its run and its writes in the second.
 */
export function Pulses({ flows, colorOf, schedule, lens, volumes }: Props) {
  const mesh = useRef<InstancedMesh>(null)
  const shape = useMemo(() => pulseShape(flows, volumes), [flows, volumes])
  const count = Math.max(1, shape.reduce((s, x) => s + Math.max(x.dots, TRAIL), 0))
  const offsets = useMemo(() => flows.map((_, i) => (i * 0.37) % 1), [flows])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    let n = 0
    const active = schedule ? activeAt(schedule, timeClock.t) : null
    flows.forEach((f, i) => {
      const curve = flowCurves.get(f.id)
      if (!curve) return
      const job = f.role === 'read' ? f.to : f.from
      if (active) {
        const frac = active.get(job)
        if (frac === undefined || !lens?.has(job)) return
        // reads flow into the job during the first half of its run, writes out during the second
        const local = f.role === 'read' ? frac * 2 : frac * 2 - 1
        if (local < 0 || local > 1) return
        for (let k = 0; k < TRAIL; k++) {
          const t = Math.min(1, Math.max(0, local - k * 0.15))
          dummy.position.copy(curve.getPoint(t))
          dummy.scale.setScalar(shape[i].scale * (1.4 - k * 0.45))
          dummy.updateMatrix()
          m.setMatrixAt(n, dummy.matrix)
          m.setColorAt(n++, tmpColor.set(colorOf(f.pipelineId)))
        }
        return
      }
      const { dots, scale } = shape[i]
      for (let k = 0; k < dots; k++) {
        const t = (clock.elapsedTime * SPEED + offsets[i] + k / dots) % 1
        dummy.position.copy(curve.getPoint(t))
        dummy.scale.setScalar(scale)
        dummy.updateMatrix()
        m.setMatrixAt(n, dummy.matrix)
        m.setColorAt(n++, tmpColor.set(colorOf(f.pipelineId)))
      }
    })
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
