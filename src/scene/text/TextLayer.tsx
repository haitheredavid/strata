import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry } from 'three'
import type { Material, Mesh } from 'three'
import { textMaterial } from '../gpu/materials'
import type { Uniforms } from '../gpu/materials'
import type { AnchorTable } from './anchors'
import type { Atlas } from './atlas'
import { layoutLine } from './layout'
import { span } from '../../dev/perf'
import type { AnchorX, AnchorY } from './layout'

/** One line of scene text, placed in an anchor's local frame. */
export interface TextItem {
  anchor: number
  x: number
  y: number
  z: number
  text: string
  size: number
  color: string
  opacity: number
  anchorX: AnchorX
  anchorY: AnchorY
  maxWidth?: number
  /**
   * A callout: faces the camera, drawn at least this many px per em, grown about the anchor (so place
   * it at x = y = 0), at full strength whatever the anchor's opacity, and gone once the text is legible
   * at `size`.
   */
  minPx?: number
  /** A dark outline, for text drawn over wires and other cards. */
  halo?: boolean
}

const tmp = new Color()

/** Glyph instance arrays for a list of items. */
function build(atlas: Atlas, items: TextItem[]) {
  const laid = items.map((t) => layoutLine(atlas, t.text, t.size, t.anchorX, t.anchorY, t.maxWidth))
  const n = laid.reduce((s, l) => s + l.cells.length, 0)
  const g0 = new Float32Array(n * 4)
  const g1 = new Float32Array(n * 4)
  const g2 = new Float32Array(n * 4)
  let k = 0
  items.forEach((t, i) => {
    const l = laid[i]
    tmp.set(t.color)
    for (let j = 0; j < l.cells.length; j++, k++) {
      g0.set([t.anchor, t.x + l.xy[2 * j], t.y + l.xy[2 * j + 1], t.z], 4 * k)
      g1.set([l.cells[j], l.quad, t.opacity, t.minPx ?? 0], 4 * k)
      g2.set([tmp.r, tmp.g, tmp.b, t.halo ? 1 : 0], 4 * k)
    }
  })
  return { g0, g1, g2, n }
}

/**
 * All scene text in one instanced draw: one quad per glyph, sampled from the SDF atlas, hung off
 * the anchor table. Rebuilds the glyph buffers when `items` changes; anchors move every frame. Text
 * fades with its size on screen (see LABEL_PX). `overlay` draws over everything (callouts).
 */
export function TextLayer({ atlas, anchors, items, renderOrder = 2, overlay = false }: { atlas: Atlas; anchors: AnchorTable; items: TextItem[]; renderOrder?: number; overlay?: boolean }) {
  const geometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    const quad = new PlaneGeometry(1, 1)
    quad.translate(0.5, 0.5, 0) // corners 0..1, so uv and position agree
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    g.setAttribute('uv', quad.getAttribute('uv'))
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const mesh = useRef<Mesh>(null)
  useEffect(() => {
    const g = mesh.current?.geometry as InstancedBufferGeometry | undefined
    if (!g) return
    const { g0, g1, g2, n } = span('textGlyphs', () => build(atlas, items))
    g.setAttribute('g0', new InstancedBufferAttribute(g0, 4))
    g.setAttribute('g1', new InstancedBufferAttribute(g1, 4))
    g.setAttribute('g2', new InstancedBufferAttribute(g2, 4))
    g.instanceCount = n
    if (mesh.current) mesh.current.visible = n > 0
  }, [geometry, atlas, items])

  const material = useMemo<Material>(() => {
    const { material, uniforms } = textMaterial(atlas, anchors.texture, overlay)
    material.userData.u = uniforms
    return material
  }, [atlas, anchors, overlay])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera, size }) => {
    const m = mesh.current
    if (m) ((m.material as Material).userData.u as Uniforms).pxScale.value = (size.height / 2) * camera.projectionMatrix.elements[5]
  })

  return <mesh ref={mesh} visible={false} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={renderOrder} />
}
