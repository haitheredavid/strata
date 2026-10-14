import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { Material, Mesh } from 'three'
import { nodeRenderer } from '../gpu/renderer'
import { curveMaterial } from '../gpu/materials'
import type { Uniforms } from '../gpu/materials'
import type { CurveBatch } from './CurveBatch'

/** Samples along each curve; enough for the gentle arches and plate edges drawn here. */
export const CURVE_SEGMENTS = 24
/**
 * useFrame priority for code that writes a batch: after the animation driver (-1), before <Curves>
 * uploads (0). Positive priorities would take over rendering from r3f, so stay negative.
 */
export const CURVE_WRITE = -0.5

const vertexShader = /* glsl */ `
  #define SEG ${CURVE_SEGMENTS}.0
  uniform vec2 resolution;
  attribute float seg;
  attribute float side;
  attribute vec3 c0;
  attribute vec3 c1;
  attribute vec3 c2;
  attribute vec3 c3;
  attribute vec4 istyle; // rgb, opacity
  attribute vec4 iline;  // width px (negative: taper), dash, gap, length
  varying vec4 vStyle;
  varying vec3 vDash;    // dash, gap, distance along
  vec3 bez(float t) {
    float u = 1.0 - t;
    return u * u * u * c0 + 3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t * c3;
  }
  vec2 screen(vec4 clip) { return clip.xy / clip.w * resolution * 0.5; }
  void main() {
    float t = seg / SEG;
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 clip = mvp * vec4(bez(t), 1.0);
    vec2 a = screen(mvp * vec4(bez(max(t - 1.0 / SEG, 0.0)), 1.0));
    vec2 b = screen(mvp * vec4(bez(min(t + 1.0 / SEG, 1.0)), 1.0));
    vec2 dir = b - a;
    dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
    float width = iline.x < 0.0 ? -iline.x * (1.0 - t) : iline.x;
    clip.xy += vec2(-dir.y, dir.x) * side * width / resolution * clip.w;
    gl_Position = clip;
    vStyle = istyle;
    vDash = vec3(iline.y, iline.z, t * iline.w);
  }
`

const fragmentShader = /* glsl */ `
  uniform float fade;
  varying vec4 vStyle;
  varying vec3 vDash;
  void main() {
    if (vDash.x > 0.0 && mod(vDash.z, vDash.x + vDash.y) > vDash.x) discard;
    gl_FragColor = vec4(vStyle.rgb, vStyle.a * fade);
    #include <colorspace_fragment>
  }
`

function ribbon(g: InstancedBufferGeometry) {
  const n = CURVE_SEGMENTS + 1
  const seg = new Float32Array(n * 2)
  const side = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    seg[2 * i] = seg[2 * i + 1] = i
    side[2 * i] = -1
    side[2 * i + 1] = 1
  }
  const index: number[] = []
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const v = 2 * i
    index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
  }
  g.setIndex(index)
  g.setAttribute('seg', new BufferAttribute(seg, 1))
  g.setAttribute('side', new BufferAttribute(side, 1))
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * 3), 3)) // unused, sizes the draw
}

/** Attach the batch's arrays to a geometry (again after the batch grows). */
function bind(g: InstancedBufferGeometry, batch: CurveBatch) {
  const ctrl = new InstancedInterleavedBuffer(batch.ctrl, 12)
  ctrl.setUsage(35048) // DynamicDrawUsage
  g.setAttribute('c0', new InterleavedBufferAttribute(ctrl, 3, 0))
  g.setAttribute('c1', new InterleavedBufferAttribute(ctrl, 3, 3))
  g.setAttribute('c2', new InterleavedBufferAttribute(ctrl, 3, 6))
  g.setAttribute('c3', new InterleavedBufferAttribute(ctrl, 3, 9))
  for (const [name, array] of [['istyle', batch.style], ['iline', batch.line]] as const) {
    const a = new InstancedBufferAttribute(array, 4)
    a.setUsage(35048)
    g.setAttribute(name, a)
  }
}

function upload(attr: { clearUpdateRanges(): void; addUpdateRange(start: number, count: number): void; needsUpdate: boolean }, lo: number, hi: number, stride: number) {
  attr.clearUpdateRanges()
  attr.addUpdateRange(lo * stride, (hi - lo + 1) * stride)
  attr.needsUpdate = true
}

/**
 * Draws a CurveBatch in one call. Owners fill the batch in a useFrame at CURVE_WRITE priority; this
 * uploads what changed, after them. `fade` multiplies every curve's opacity (e.g. while cards move).
 */
export function Curves({ batch, fade = () => 1, renderOrder = 0 }: { batch: CurveBatch; fade?: () => number; renderOrder?: number }) {
  const size = useThree((s) => s.size)
  const geometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    ribbon(g)
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo<Material>(() => {
    if (nodeRenderer) {
      const { material, uniforms } = curveMaterial(CURVE_SEGMENTS)
      material.userData.u = uniforms
      return material
    }
    const m = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { resolution: { value: new Vector2(1, 1) }, fade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    m.userData.u = m.uniforms
    return m
  }, [])
  useEffect(() => () => material.dispose(), [material])

  const mesh = useRef<Mesh<InstancedBufferGeometry, Material>>(null)
  // Which batch (and which of its allocations) the geometry's buffers point at.
  const bound = useRef<{ batch: CurveBatch | null; version: number }>({ batch: null, version: -1 })

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const g = m.geometry
    if (bound.current.batch !== batch || bound.current.version !== batch.version) {
      bind(g, batch)
      bound.current = { batch, version: batch.version }
      batch.markAll()
    }
    g.instanceCount = batch.count
    const { ctrl: cd, style: sd } = batch.takeDirty()
    if (cd.lo <= cd.hi) upload((g.getAttribute('c0') as InterleavedBufferAttribute).data, cd.lo, cd.hi, 12)
    if (sd.lo <= sd.hi) upload(g.getAttribute('istyle') as InstancedBufferAttribute, sd.lo, sd.hi, 4)
    // line holds width/dash (style) and length (geometry): upload the union of both ranges
    const lo = Math.min(cd.lo, sd.lo)
    const hi = Math.max(cd.hi, sd.hi)
    if (lo <= hi) upload(g.getAttribute('iline') as InstancedBufferAttribute, lo, hi, 4)
    const u = m.material.userData.u as Uniforms
    ;(u.resolution.value as Vector2).set(size.width, size.height)
    u.fade.value = fade()
    m.visible = batch.count > 0
  })

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={renderOrder} />
}
