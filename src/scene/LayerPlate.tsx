import { useLayoutEffect, useRef } from 'react'
import { Line, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { PlatePlace } from '../layout/modes'
import { syncFromAnim, plateKey } from './anim'

/** Translucent domain plate, drawn in its local frame (faces +Z). Flat plates label the near edge, upright ones the top. */
export function LayerPlate({ plate, opacity }: { plate: PlatePlace; opacity: number }) {
  const group = useRef<Group>(null)
  const [w, h] = plate.size
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -h / 2, h / 2]
  const labelY = plate.frame === 'flat' ? y0 + 0.6 : y1 - 0.7

  // Start where the animation is (not at the target), then follow it every frame.
  useLayoutEffect(() => syncFromAnim(group.current, plateKey(plate.id)), [plate.id])
  useFrame(() => syncFromAnim(group.current, plateKey(plate.id)))

  return (
    <group ref={group}>
      <mesh raycast={() => null} renderOrder={-1}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={plate.color} transparent opacity={0.07 * opacity} depthWrite={false} />
      </mesh>
      <Line
        points={[[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [x0, y0, 0]]}
        color={plate.color}
        lineWidth={1.5}
        transparent
        opacity={0.6 * opacity}
      />
      <Text
        position={[x0 + 0.5, labelY, 0.02]}
        fontSize={0.7}
        anchorX="left"
        anchorY="middle"
        color={plate.color}
        fillOpacity={opacity}
        raycast={() => null}
      >
        {plate.label.toUpperCase()}
      </Text>
    </group>
  )
}
