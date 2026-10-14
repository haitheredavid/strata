import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial } from 'three'
import type { Mesh } from 'three'
import { HEADER_H } from '../layout/geometry'
import { useStore } from '../store'
import { packOnce } from '../world/world'
import type { World } from '../world/world'

/**
 * Every card's visuals (outline, body, header band, medallion badge) in one instanced draw. Each
 * instance is a world node; non-card nodes (jobs, clusters) collapse to nothing in the vertex shader.
 * The fragment shader composes the layers the per-card meshes used to stack, in the same order and
 * with the same colors and opacities, so no polygon offsets are needed. Text stays on TableCard.
 */
const OUTLINE = 0.04 // outline ring past the card edge (the old outline plane was +0.08 overall)

const vertexShader = /* glsl */ `
  uniform float hovered;
  attribute vec3 ipos;
  attribute vec4 iquat;
  attribute vec2 isize;
  attribute float ikind;
  attribute vec3 icolor;
  attribute vec4 imedal;   // rgb, has-medallion
  attribute vec2 istate;   // opacity, highlighted (focus / timeline)
  attribute float iindex;
  varying vec2 vLocal;
  varying vec2 vSize;
  varying vec3 vColor;
  varying vec4 vMedal;
  varying float vOpacity;
  varying float vHigh;

  vec3 rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

  void main() {
    bool card = ikind < 2.5; // table, domain, source
    vec2 full = isize + vec2(${OUTLINE * 2});
    vec2 local = position.xy * full;
    vLocal = local;
    vSize = isize;
    vColor = icolor;
    vMedal = imedal;
    vOpacity = istate.x;
    vHigh = max(istate.y, abs(iindex - hovered) < 0.5 ? 1.0 : 0.0);
    // Cards sit just in front of their plane, like the old group offset.
    vec3 world = ipos + rotate(iquat, vec3(local, 0.02));
    gl_Position = card ? projectionMatrix * viewMatrix * vec4(world, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 bodyColor;
  uniform vec3 bodyHigh;
  uniform vec3 ink;
  varying vec2 vLocal;
  varying vec2 vSize;
  varying vec3 vColor;
  varying vec4 vMedal;
  varying float vOpacity;
  varying float vHigh;

  // Premultiplied "over": layer (rgb, a) on top of dst.
  vec4 over(vec4 dst, vec3 rgb, float a) { return vec4(rgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
  bool inside(vec2 p, vec2 c, vec2 half_) { return all(lessThanEqual(abs(p - c), half_)); }

  void main() {
    vec2 half_ = vSize * 0.5;
    float top = half_.y;
    bool high = vHigh > 0.5;
    vec4 c = vec4(0.0);
    // outline plane (behind everything, slightly larger than the card)
    c = over(c, high ? vec3(1.0) : vColor, (high ? 0.9 : 0.5) * vOpacity);
    if (inside(vLocal, vec2(0.0), half_)) {
      c = over(c, high ? bodyHigh : bodyColor, 0.95 * vOpacity);
      if (vLocal.y >= top - ${HEADER_H.toFixed(3)}) c = over(c, vColor, vOpacity);
      if (vMedal.a > 0.5) {
        vec2 mc = vec2(half_.x - 0.32, top - ${(HEADER_H / 2).toFixed(3)});
        if (inside(vLocal, mc, vec2(0.22))) c = over(c, ink, 0.85 * vOpacity);
        if (inside(vLocal, mc, vec2(0.17))) c = over(c, vMedal.rgb, vOpacity);
      }
    }
    if (c.a < 0.002) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }
`

export interface CardStyle {
  /** rgb per world node (layer color). */
  color: Float32Array
  /** rgb + has-medallion per world node. */
  medal: Float32Array
  /** opacity, highlighted per world node. */
  state: Float32Array
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
    g.setAttribute('isize', new InstancedBufferAttribute(nodes.size, 2))
    g.setAttribute('ikind', new InstancedBufferAttribute(Float32Array.from(nodes.kind), 1))
    g.setAttribute('iindex', new InstancedBufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1))
    g.instanceCount = n
    return g
  }, [world, n])

  useEffect(() => {
    geometry.setAttribute('icolor', new InstancedBufferAttribute(style.color, 3))
    geometry.setAttribute('imedal', new InstancedBufferAttribute(style.medal, 4))
    geometry.setAttribute('istate', new InstancedBufferAttribute(style.state, 2))
  }, [geometry, style])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          hovered: { value: -1 },
          // the old card meshes' colors
          bodyColor: { value: new Color('#1b2130') },
          bodyHigh: { value: new Color('#2a3344') },
          ink: { value: new Color('#0b0e14') },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const mesh = useRef<Mesh<InstancedBufferGeometry, ShaderMaterial>>(null)

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
    const h = useStore.getState().hoveredTableId
    m.material.uniforms.hovered.value = h === null ? -1 : (world.nodes.index.get(h) ?? -1)
  })

  // Drawn after the layer plates, so a plate never washes over the cards resting on it.
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={1} />
}
