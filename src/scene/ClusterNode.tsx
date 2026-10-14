import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group, MeshBasicMaterial } from 'three'
import type { Schedule } from '../sim/schedule'
import { onCluster } from '../sim/schedule'
import { workersFor } from '../sim/spark'
import type { ViewCluster } from '../view/deriveView'
import { useStore } from '../store'
import { Label } from './Label'
import { useReleaseHover } from './hover'
import { syncFromAnim } from './anim'
import { timeClock } from './timeClock'
import { clusterSpec, KIND_LABEL } from './clusterStyle'
import { usePalette } from '../theme/palette'
import { RACK_GAP, RACK_MAX_SHOWN, RACK_ROW } from './labels'

const OFF = '#242b3a'
const IDLE = '#334155'
const MAX_SHOWN = RACK_MAX_SHOWN
const W = 2.4
const ROW = RACK_ROW
const GAP = RACK_GAP

interface Props {
  cluster: ViewCluster
  opacity: number
  highlighted: boolean
  /** With the timeline open: workers light up with the work on the cluster at the playhead. */
  schedule: Schedule | null
  /** Visuals come from NodeParts / SceneText: keep only an invisible hit surface. */
  instanced?: boolean
}

/**
 * A cluster as a small rack: the driver on top, a row per worker (up to 8) below. Without the
 * timeline every worker shows its kind color; with it, workers light as tasks run on the cluster, a
 * warm all-purpose cluster idles grey, and a job cluster is dark between runs.
 */
export const ClusterNode = memo(function ClusterNode({ cluster: vc, opacity, highlighted: selected, schedule, instanced = false }: Props) {
  const c = vc.cluster
  const hover = useStore((s) => s.hover)
  useReleaseHover(vc.id)
  const highlighted = useStore((s) => s.hoveredTableId === vc.id) || selected
  const focus = useStore((s) => s.focus)
  const group = useRef<Group>(null)
  const driver = useRef<MeshBasicMaterial>(null)
  const workers = useRef<(MeshBasicMaterial | null)[]>([])
  const color = usePalette().cluster(c.kind)
  const shown = Math.min(MAX_SHOWN, c.workers.max)
  const rows = useMemo(() => Array.from({ length: shown }, (_, i) => -(i + 1) * (ROW + GAP)), [shown])

  useLayoutEffect(() => syncFromAnim(group.current, vc.id), [vc.id])
  useFrame(() => {
    syncFromAnim(group.current, vc.id)
    if (instanced) return
    if (!schedule) {
      driver.current?.color.set(color)
      workers.current.forEach((m) => m?.color.set(color))
      return
    }
    const { starting, working } = onCluster(schedule, c.id, timeClock.t)
    const up = starting.length + working.length > 0 || c.kind === 'all_purpose'
    // Busy workers: the minimum, plus autoscaling as more tasks share the cluster.
    const busy = working.length ? workersFor(c, working.length) : 0
    const lit = Math.round((busy / c.workers.max) * shown)
    const blink = starting.length && !working.length ? 0.5 + 0.5 * Math.sin(performance.now() / 150) : 1
    driver.current?.color.set(up ? color : OFF).multiplyScalar(blink)
    workers.current.forEach((m, i) => m?.color.set(i < lit ? color : up ? IDLE : OFF))
  })

  const hit = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), hover(vc.id)),
    onPointerOut: () => hover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      focus(useStore.getState().focusedTableId === vc.id ? null : vc.id)
    },
  }
  if (instanced) {
    const h = shown * (ROW + GAP) + 0.75
    return (
      <group ref={group}>
        <mesh visible={false} position={[0, -(shown * (ROW + GAP)) / 2, 0]} {...hit}>
          <boxGeometry args={[W + 0.25, h, 0.5]} />
        </mesh>
      </group>
    )
  }
  return (
    <group ref={group}>
      <group {...hit}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[W, 0.4, 0.5]} />
          <meshBasicMaterial ref={driver} color={color} transparent opacity={opacity} />
        </mesh>
        {rows.map((y, i) => (
          <mesh key={i} position={[0, y - 0.05, 0]}>
            <boxGeometry args={[W, ROW, 0.45]} />
            <meshBasicMaterial ref={(m) => void (workers.current[i] = m)} color={color} transparent opacity={opacity} />
          </mesh>
        ))}
        {/* frame */}
        <mesh position={[0, -(shown * (ROW + GAP)) / 2, -0.05]} raycast={() => null}>
          <boxGeometry args={[W + 0.25, shown * (ROW + GAP) + 0.75, 0.3]} />
          <meshBasicMaterial color={highlighted ? '#2a3344' : '#0f131c'} transparent opacity={opacity} />
        </mesh>
      </group>
      <Label position={[0, 0.55, 0.3]} fontSize={0.2} color={color} fillOpacity={opacity} anchorX="center" anchorY="bottom" raycast={() => null}>
        {KIND_LABEL[c.kind]}
      </Label>
      <Label position={[0, -(shown + 1) * (ROW + GAP) - 0.15, 0.3]} fontSize={0.32} color="#e2e8f0" fillOpacity={opacity} anchorX="center" anchorY="top" raycast={() => null}>
        {c.name}
      </Label>
      <Label position={[0, -(shown + 1) * (ROW + GAP) - 0.6, 0.3]} fontSize={0.22} color="#94a3b8" fillOpacity={opacity} anchorX="center" anchorY="top" raycast={() => null}>
        {clusterSpec(c)}
      </Label>
    </group>
  )
})
