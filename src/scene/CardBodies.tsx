import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry } from 'three'
import type { Material, Mesh } from 'three'
import { cardMaterial } from './gpu/materials'
import type { Uniforms } from './gpu/materials'
import { useStore } from '../store'
import { packOnce } from '../world/world'
import type { World } from '../world/world'

/**
 * Every card's visuals (outline, body, header band, medallion badge) in one instanced draw. Each
 * instance is a world node; non-card nodes (jobs, clusters) collapse to nothing in the vertex shader.
 * The fragment shader composes the layers the per-card meshes used to stack, in the same order and
 * with the same colors and opacities, so no polygon offsets are needed. Text is SceneText's.
 */
const OUTLINE = 0.04 // outline ring past the card edge (the old outline plane was +0.08 overall)

export interface CardStyle {
  /** Layer rgb + opacity per world node. */
  color: Float32Array
  /** Medallion rgb + flags (1 has medallion, 2 highlighted) per world node. */
  medal: Float32Array
}

export function CardBodies({ world, style }: { world: World; style: CardStyle }) {
  const n = world.nodes.count
  const geometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    const quad = new PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    const { nodes } = world
    const pos = new InstancedBufferAttribute(nodes.pos, 3)
    const quat = new InstancedBufferAttribute(nodes.quat, 4)
    pos.setUsage(35048) // DynamicDrawUsage
    quat.setUsage(35048)
    g.setAttribute('ipos', pos)
    g.setAttribute('iquat', quat)
    const meta = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) meta.set([nodes.size[2 * i], nodes.size[2 * i + 1], nodes.kind[i], i], 4 * i)
    g.setAttribute('imeta', new InstancedBufferAttribute(meta, 4))
    // Style buffers live as long as the geometry; style changes (lens, focus, timeline) copy into
    // them, since a new attribute means new GPU buffers and bindings on every change.
    for (const name of ['icolor', 'imedal']) g.setAttribute(name, new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(35048))
    g.instanceCount = n
    return g
  }, [world, n])

  const mesh = useRef<Mesh<InstancedBufferGeometry, Material>>(null)
  useEffect(() => {
    const g = mesh.current?.geometry
    if (!g) return
    for (const [name, data] of [['icolor', style.color], ['imedal', style.medal]] as const) {
      const a = g.getAttribute(name) as InstancedBufferAttribute
      ;(a.array as Float32Array).set(data.subarray(0, a.array.length))
      a.needsUpdate = true
    }
  }, [geometry, style])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo<Material>(() => {
    const { material, uniforms } = cardMaterial(OUTLINE)
    material.userData.u = uniforms
    return material
  }, [])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    if (packOnce(world)) {
      const { lo, hi } = world.dirty
      for (const [name, size] of [['ipos', 3], ['iquat', 4]] as const) {
        const a = m.geometry.getAttribute(name) as InstancedBufferAttribute
        a.clearUpdateRanges()
        a.addUpdateRange(lo * size, (hi - lo + 1) * size)
        a.needsUpdate = true
      }
    }
    const h = useStore.getState().hoveredId
    ;(m.material.userData.u as Uniforms).hovered.value = h === null ? -1 : (world.nodes.index.get(h) ?? -1)
  })

  // Drawn after the layer plates, so a plate never washes over the cards resting on it.
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={1} />
}
