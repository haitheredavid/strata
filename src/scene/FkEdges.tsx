import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  BufferAttribute,
  DoubleSide,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { Material, Mesh } from 'three'
import { nodeRenderer } from './gpu/renderer'
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

const vertexShader = /* glsl */ `
  #define SEG ${SEGMENTS}.0
  uniform vec2 resolution;
  uniform float hovered;
  uniform float hoverable;
  attribute float seg;
  attribute float side;
  attribute vec3 c0;
  attribute vec3 c1;
  attribute vec3 c2;
  attribute vec3 c3;
  attribute vec3 icolor;
  attribute vec2 istyle; // opacity, width (px)
  attribute vec2 ends;   // node indices
  varying vec3 vColor;
  varying float vAlpha;

  vec3 bez(float t) {
    float u = 1.0 - t;
    return u * u * u * c0 + 3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t * c3;
  }
  vec2 screen(vec4 clip) { return clip.xy / clip.w * resolution * 0.5; }

  void main() {
    float t = seg / SEG;
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 clip = vp * vec4(bez(t), 1.0);
    vec2 a = screen(vp * vec4(bez(max(t - 1.0 / SEG, 0.0)), 1.0));
    vec2 b = screen(vp * vec4(bez(min(t + 1.0 / SEG, 1.0)), 1.0));
    vec2 dir = b - a;
    dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);

    float opacity = istyle.x;
    float width = istyle.y;
    // hovered: -1 nothing, -2 something that isn't a node here, else that node's index
    if (hoverable > 0.5 && hovered > -1.5) {
      bool touch = abs(ends.x - hovered) < 0.5 || abs(ends.y - hovered) < 0.5;
      opacity = touch ? 1.0 : 0.3;
      width = touch ? 3.0 : width;
    }
    clip.xy += vec2(-dir.y, dir.x) * side * width / resolution * clip.w;
    gl_Position = clip;
    vColor = icolor;
    vAlpha = opacity;
  }
`

const fragmentShader = /* glsl */ `
  uniform float fade;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha * fade);
    #include <colorspace_fragment>
  }
`

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
    geometry.instanceCount = count
    return geometry
  }, [world, count, curves])

  useEffect(() => {
    geometry.setAttribute('icolor', new InstancedBufferAttribute(fkStyle.color, 3))
    geometry.setAttribute('istyle', new InstancedBufferAttribute(fkStyle.style, 2))
  }, [geometry, fkStyle])

  useEffect(() => () => geometry.dispose(), [geometry])

  // GLSL for the classic renderer, TSL for WebGPURenderer; uniforms ride on userData.u either way.
  const material = useMemo<Material>(() => {
    if (nodeRenderer) {
      const { material, uniforms } = fkEdgeMaterial(SEGMENTS)
      material.userData.u = uniforms
      return material
    }
    const m = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        resolution: { value: new Vector2(1, 1) },
        hovered: { value: -1 },
        hoverable: { value: 1 },
        fade: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide, // ribbon winding flips with the curve's screen direction
    })
    m.userData.u = m.uniforms
    return m
  }, [])
  useEffect(() => () => material.dispose(), [material])
  const mesh = useRef<Mesh<InstancedBufferGeometry, Material>>(null)

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
