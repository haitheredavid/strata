import { useEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial } from 'three'
import type { Material, Mesh } from 'three'
import { nodeRenderer } from '../gpu/renderer'
import { textMaterial } from '../gpu/materials'
import { ANCHOR_TEX_W } from './anchors'
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
}

const vertexShader = /* glsl */ `
  uniform sampler2D anchors;
  attribute vec4 g0; // anchor, x, y, z (quad lower-left in the anchor frame)
  attribute vec4 g1; // atlas cell, quad side, opacity
  attribute vec4 g2; // rgb
  uniform vec2 grid;  // atlas cols, rows
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  vec3 rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  void main() {
    int a = int(g0.x + 0.5) * 2;
    vec3 apos = texelFetch(anchors, ivec2(a % ${ANCHOR_TEX_W}, a / ${ANCHOR_TEX_W}), 0).xyz;
    vec4 aquat = texelFetch(anchors, ivec2((a + 1) % ${ANCHOR_TEX_W}, (a + 1) / ${ANCHOR_TEX_W}), 0);
    vec3 local = vec3(g0.y + uv.x * g1.y, g0.z + uv.y * g1.y, g0.w);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(apos + rotate(aquat, local), 1.0);
    float col = mod(g1.x, grid.x);
    float row = floor(g1.x / grid.x);
    vUv = vec2(col + uv.x, row + 1.0 - uv.y) / grid;
    vColor = g2.rgb;
    vOpacity = g1.z;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D atlas;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    float d = texture2D(atlas, vUv).r;
    float w = max(fwidth(d) * 0.7, 0.001);
    float a = smoothstep(0.5 - w, 0.5 + w, d) * vOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`

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
      g1.set([l.cells[j], l.quad, t.opacity, 0], 4 * k)
      g2.set([tmp.r, tmp.g, tmp.b, 0], 4 * k)
    }
  })
  return { g0, g1, g2, n }
}

/**
 * All scene text in one instanced draw: one quad per glyph, sampled from the SDF atlas, hung off
 * the anchor table. Rebuilds the glyph buffers when `items` changes; anchors move every frame.
 */
export function TextLayer({ atlas, anchors, items, renderOrder = 2 }: { atlas: Atlas; anchors: AnchorTable; items: TextItem[]; renderOrder?: number }) {
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
    if (nodeRenderer) return textMaterial(atlas, anchors.texture)
    return new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        anchors: { value: anchors.texture },
        atlas: { value: atlas.texture },
        grid: { value: [atlas.cols, atlas.rows] },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
  }, [atlas, anchors])
  useEffect(() => () => material.dispose(), [material])

  return <mesh ref={mesh} visible={false} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={renderOrder} />
}
