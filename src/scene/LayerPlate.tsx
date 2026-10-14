import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { PlatePlace } from '../layout/modes'
import { Label } from './Label'
import { syncFromAnim, plateKey } from './anim'

/**
 * Translucent domain plate, drawn in its local frame (faces +Z). Flat plates label the near edge,
 * upright ones the top. Borders are drawn for all plates at once by PlateOutlines.
 */
export function LayerPlate({ plate, color, opacity }: { plate: PlatePlace; color: string; opacity: number }) {
  const group = useRef<Group>(null)
  const [w, h] = plate.size
  const [x0, y0, y1] = [-w / 2, -h / 2, h / 2]
  const labelY = plate.frame === 'flat' ? y0 + 0.6 : y1 - 0.7

  // Start where the animation is (not at the target), then follow it every frame.
  useLayoutEffect(() => syncFromAnim(group.current, plateKey(plate.id)), [plate.id])
  useFrame(() => syncFromAnim(group.current, plateKey(plate.id)))

  return (
    <group ref={group}>
      <mesh raycast={() => null} renderOrder={-1}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={color} transparent opacity={0.07 * opacity} depthWrite={false} />
      </mesh>
      <Label
        position={[x0 + 0.5, labelY, 0.02]}
        fontSize={0.7}
        anchorX="left"
        anchorY="middle"
        color={color}
        fillOpacity={opacity}
        raycast={() => null}
      >
        {plate.label.toUpperCase()}
      </Label>
    </group>
  )
}
