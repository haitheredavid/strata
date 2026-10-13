import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Object3D } from 'three'
import type { InstancedMesh } from 'three'
import type { FlowEdge } from '../view/deriveView'
import { flowCurves } from './curve'
import { runClock } from './runClock'

const PER_FLOW = 2
const SPEED = 0.35 // curve lengths per second
const dummy = new Object3D()
const tmpColor = new Color()

interface Props {
  flows: FlowEdge[]
  colorOf: (pipelineId: string) => string
  /** When a run is playing: job node ids of the active step. Only their flows pulse. */
  active: Set<string> | null
}

/**
 * Light moving along lineage edges in the data direction. Idle, every visible flow pulses. During a
 * run, the active step's reads pulse in the first half of the step and its writes in the second half.
 */
export function Pulses({ flows, colorOf, active }: Props) {
  const mesh = useRef<InstancedMesh>(null)
  const count = Math.max(1, flows.length * PER_FLOW)
  const offsets = useMemo(() => flows.map((_, i) => (i * 0.37) % 1), [flows])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    let n = 0
    const frac = runClock.t % 1
    flows.forEach((f, i) => {
      const curve = flowCurves.get(f.id)
      if (!curve) return
      const job = f.role === 'read' ? f.to : f.from
      if (active) {
        if (!active.has(job)) return
        // reads flow into the job during the first half of the step, writes out during the second
        const local = f.role === 'read' ? frac * 2 : frac * 2 - 1
        if (local < 0 || local > 1) return
        for (let k = 0; k < PER_FLOW; k++) {
          const t = Math.min(1, Math.max(0, local - k * 0.15))
          dummy.position.copy(curve.getPoint(t))
          dummy.scale.setScalar(1.6 - k * 0.5)
          dummy.updateMatrix()
          m.setMatrixAt(n, dummy.matrix)
          m.setColorAt(n++, tmpColor.set(colorOf(f.pipelineId)))
        }
        return
      }
      for (let k = 0; k < PER_FLOW; k++) {
        const t = (clock.elapsedTime * SPEED + offsets[i] + k / PER_FLOW) % 1
        dummy.position.copy(curve.getPoint(t))
        dummy.scale.setScalar(1)
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
