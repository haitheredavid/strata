import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, BufferAttribute, Vector2 } from 'three'
import type { Material, Mesh } from 'three'
import { fkEdgeMaterial } from './gpu/materials'
import type { Uniforms } from './gpu/materials'
import { useStore } from '../store'
import { updateFkCurves } from '../world/fkEdges'
import type { FkCurves } from '../world/fkEdges'
import { packOnce } from '../world/world'
import type { World } from '../world/world'
import { animState } from './anim'

/**
 * Every FK wire in one instanced draw. Each instance is an edge: its four bezier control points
 * (computed on the CPU only when an end moves, see world/fkEdges) plus color, opacity and width.
 * The vertex shader evaluates the curve along a shared ribbon and pushes it out to a pixel width in
 * screen space, like Line2. Hover is a uniform: the shader compares it with each edge's ends.
 */
const SEGMENTS = 32

/** Ribbon template shared by every edge: SEGMENTS + 1 pairs of vertices, two triangles per step. */
function ribbon(geometry: InstancedBufferGeometry) {
  const n = SEGMENTS + 1
  const seg = new Float32Array(n * 2)
  const side = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    seg[2 * i] = seg[2 * i + 1] = i
    side[2 * i] = -1
    side[2 * i + 1] = 1
  }
  const index: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const v = 2 * i
    index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
  }
  geometry.setIndex(index)
  geometry.setAttribute('seg', new BufferAttribute(seg, 1))
  geometry.setAttribute('side', new BufferAttribute(side, 1))
  // The shader ignores position, but three wants one to size the draw.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * 3), 3))
}

export interface FkStyle {
  /** rgb per edge, in `world.fk` order. */
  color: Float32Array
  /** opacity, width (px) per edge. */
  style: Float32Array
  /** Whether hover restyles wires (off while a lens, focus or path drives the styling). */
  hoverable: boolean
}

export function FkEdges({ world, curves, fkStyle }: { world: World; curves: FkCurves; fkStyle: FkStyle }) {
  const size = useThree((s) => s.size)
  const count = world.fk.count

  const geometry = useMemo(() => {
    const geometry = new InstancedBufferGeometry()
    ribbon(geometry)
    const ctrl = new InstancedInterleavedBuffer(curves.ctrl, 12)
    ctrl.setUsage(35048) // DynamicDrawUsage
    geometry.setAttribute('c0', new InterleavedBufferAttribute(ctrl, 3, 0))
    geometry.setAttribute('c1', new InterleavedBufferAttribute(ctrl, 3, 3))
    geometry.setAttribute('c2', new InterleavedBufferAttribute(ctrl, 3, 6))
    geometry.setAttribute('c3', new InterleavedBufferAttribute(ctrl, 3, 9))
    const ends = new Float32Array(count * 2)
    for (let k = 0; k < count; k++) {
      ends[2 * k] = world.fk.src[k]
      ends[2 * k + 1] = world.fk.dst[k]
    }
    geometry.setAttribute('ends', new InstancedBufferAttribute(ends, 2))
    // Style buffers live as long as the geometry; restyles copy into them (no new GPU buffers).
    geometry.setAttribute('icolor', new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(35048))
    geometry.setAttribute('istyle', new InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(35048))
    geometry.instanceCount = count
    return geometry
  }, [world, count, curves])

  const mesh = useRef<Mesh<InstancedBufferGeometry, Material>>(null)
  useEffect(() => {
    const g = mesh.current?.geometry
    if (!g) return
    for (const [name, data] of [['icolor', fkStyle.color], ['istyle', fkStyle.style]] as const) {
      const a = g.getAttribute(name) as InstancedBufferAttribute
      ;(a.array as Float32Array).set(data.subarray(0, a.array.length))
      a.needsUpdate = true
    }
  }, [geometry, fkStyle])

  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo<Material>(() => {
    const { material, uniforms } = fkEdgeMaterial(SEGMENTS)
    material.userData.u = uniforms
    return material
  }, [])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    if (packOnce(world) || curves.builtA[0] === -1) {
      const { lo, hi } = updateFkCurves(world, curves)
      if (lo <= hi) {
        const buf = (m.geometry.getAttribute('c0') as InterleavedBufferAttribute).data
        buf.clearUpdateRanges()
        buf.addUpdateRange(lo * 12, (hi - lo + 1) * 12)
        buf.needsUpdate = true
      }
    }
    const u = m.material.userData.u as Uniforms
    const h = useStore.getState().hoveredTableId
    u.hovered.value = h === null ? -1 : (world.nodes.index.get(h) ?? -2)
    u.fade.value = 1 - 0.75 * animState.moving
    u.hoverable.value = fkStyle.hoverable ? 1 : 0
    ;(u.resolution.value as Vector2).set(size.width, size.height)
  })

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
}
