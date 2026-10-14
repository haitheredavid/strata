import { useLayoutEffect, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh } from 'three'
import type { Trigger } from '../model/workflow'
import type { ViewNode } from '../view/deriveView'
import { useStore } from '../store'
import { syncFromAnim } from './anim'
import { TRIGGER_LABEL } from './timeClock'

const EVENT = '#fbbf24'

export type RunState = 'active' | 'done' | 'pending' | null

interface Props {
  node: ViewNode
  color: string
  opacity: number
  highlighted: boolean
  runState: RunState
  /** Bytes in / out per run and runs a day, shown while highlighted. */
  volume?: string
}

function triggerText(t: Trigger) {
  const detail =
    t.kind === 'schedule' ? t.cron
      : t.kind === 'file_arrival' ? t.path
        : t.kind === 'table_update' ? t.tables.join(', ')
          : t.kind === 'job' ? t.pipeline
            : ''
  return `${TRIGGER_LABEL[t.kind]}${detail ? `  ${detail}` : ''}`
}

/**
 * A job: hexagon in its pipeline's color, facing the camera. Jobs that start a pipeline carry a
 * spinning trigger ring and label; jobs that emit events carry an amber event marker above.
 */
export function JobNode({ node, color, opacity, highlighted, runState, volume }: Props) {
  const hover = useStore((s) => s.hover)
  const focus = useStore((s) => s.focus)
  const group = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const event = useRef<Group>(null)
  const pulse = useRef(0)

  useLayoutEffect(() => syncFromAnim(group.current, node.id), [node.id])
  useFrame((_, dt) => {
    syncFromAnim(group.current, node.id)
    if (ring.current) ring.current.rotation.z += dt * (node.trigger?.kind === 'continuous' ? 2 : 0.6)
    // Event marker pops while the job is the active run step.
    pulse.current += ((runState === 'active' ? 1 : 0) - pulse.current) * Math.min(1, dt * 6)
    if (event.current) event.current.scale.setScalar(1 + pulse.current * 0.6 + (runState === 'active' ? Math.sin(performance.now() / 120) * 0.08 : 0))
  })

  const active = runState === 'active'
  const face = active ? '#ffffff' : highlighted ? '#2a3344' : '#141925'
  return (
    <group ref={group}>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onPointerOver={(e) => (e.stopPropagation(), hover(node.id))}
        onPointerOut={() => hover(null)}
        onClick={(e) => {
          e.stopPropagation()
          focus(useStore.getState().focusedTableId === node.id ? null : node.id)
        }}
      >
        <cylinderGeometry args={[0.75, 0.75, 0.2, 6]} />
        <meshBasicMaterial color={face} transparent opacity={opacity} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.02]} raycast={() => null}>
        <cylinderGeometry args={[0.92, 0.92, 0.18, 6]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <Text position={[0, -1.25, 0.05]} fontSize={0.34} color={color} fillOpacity={opacity} anchorX="center" anchorY="middle" raycast={() => null}>
        {node.name}
      </Text>
      {highlighted && volume && (
        <Text position={[0, -1.7, 0.05]} fontSize={0.24} color="#cbd5e1" fillOpacity={opacity} anchorX="center" anchorY="middle" raycast={() => null}>
          {volume}
        </Text>
      )}

      {node.trigger && (
        <group>
          <mesh ref={ring} raycast={() => null}>
            <torusGeometry args={[1.25, 0.05, 8, 6]} />
            <meshBasicMaterial color={color} transparent opacity={0.8 * opacity} />
          </mesh>
          <Text position={[0, 1.55, 0.05]} fontSize={0.26} color="#cbd5e1" fillOpacity={opacity} anchorX="center" anchorY="middle" raycast={() => null}>
            {triggerText(node.trigger)}
          </Text>
        </group>
      )}

      {!!node.emits?.length && (
        <group ref={event} position={[1.45, 0.95, 0.1]}>
          <mesh raycast={() => null}>
            <octahedronGeometry args={[0.28]} />
            <meshBasicMaterial color={EVENT} transparent opacity={opacity} />
          </mesh>
          <Text position={[0.42, 0, 0]} fontSize={0.24} color={EVENT} fillOpacity={opacity} anchorX="left" anchorY="middle" raycast={() => null}>
            {node.emits.join(', ')}
          </Text>
        </group>
      )}
    </group>
  )
}
