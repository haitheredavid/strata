import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedBufferGeometry } from 'three'
import type { BufferGeometry, Material, Mesh } from 'three'
import { partMaterial } from '../gpu/materials'
import type { Uniforms } from '../gpu/materials'
import type { AnchorTable } from '../text/anchors'
import type { Parts } from './parts'

/** Draws one shape for every instance in `parts`, hung off the scene anchors (see Parts). */
export function PartBatch({ shape, parts, anchors, renderOrder = 0, depthWrite = true }: { shape: BufferGeometry; parts: Parts; anchors: AnchorTable; renderOrder?: number; depthWrite?: boolean }) {
  const geometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    g.index = shape.index
    g.setAttribute('position', shape.getAttribute('position'))
    for (const [name, array] of [['p0', parts.p0], ['p1', parts.p1], ['p2', parts.p2]] as const) {
      const a = new InstancedBufferAttribute(array, 4)
      a.setUsage(35048) // DynamicDrawUsage
      g.setAttribute(name, a)
    }
    g.instanceCount = parts.count
    return g
  }, [shape, parts])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo<Material>(() => {
    const { material, uniforms } = partMaterial(anchors.texture)
    material.depthWrite = depthWrite
    material.userData.u = uniforms
    return material
  }, [anchors, depthWrite])
  useEffect(() => () => material.dispose(), [material])

  const mesh = useRef<Mesh<InstancedBufferGeometry, Material>>(null)
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    ;(m.material.userData.u as Uniforms).time.value = clock.elapsedTime
    if (parts.takeDirty()) for (const name of ['p1', 'p2']) (m.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true
    m.visible = parts.count > 0
  })

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={renderOrder} />
}
