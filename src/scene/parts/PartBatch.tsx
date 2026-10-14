import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedBufferGeometry, ShaderMaterial } from 'three'
import type { BufferGeometry, Material, Mesh } from 'three'
import { nodeRenderer } from '../gpu/renderer'
import { partMaterial } from '../gpu/materials'
import type { Uniforms } from '../gpu/materials'
import { ANCHOR_TEX_W } from '../text/anchors'
import type { AnchorTable } from '../text/anchors'
import type { Parts } from './parts'

const vertexShader = /* glsl */ `
  uniform sampler2D anchors;
  uniform float time;
  attribute vec4 p0;
  attribute vec4 p1;
  attribute vec4 p2;
  varying vec4 vColor;
  vec3 rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  void main() {
    int a = int(p0.x + 0.5) * 2;
    vec3 apos = texelFetch(anchors, ivec2(a % ${ANCHOR_TEX_W}, a / ${ANCHOR_TEX_W}), 0).xyz;
    vec4 aquat = texelFetch(anchors, ivec2((a + 1) % ${ANCHOR_TEX_W}, (a + 1) / ${ANCHOR_TEX_W}), 0);
    vec3 v = position * p1.xyz;
    float t = time * p1.w;
    v = vec3(v.x * cos(t) - v.y * sin(t), v.x * sin(t) + v.y * cos(t), v.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(apos + rotate(aquat, v + p0.yzw), 1.0);
    vColor = p2;
  }
`

const fragmentShader = /* glsl */ `
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
    #include <colorspace_fragment>
  }
`

/** Draws one shape for every instance in `parts`, hung off the scene anchors (see Parts). */
export function PartBatch({ shape, parts, anchors, renderOrder = 0 }: { shape: BufferGeometry; parts: Parts; anchors: AnchorTable; renderOrder?: number }) {
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
    if (nodeRenderer) {
      const { material, uniforms } = partMaterial(anchors.texture)
      material.userData.u = uniforms
      return material
    }
    const m = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: { anchors: { value: anchors.texture }, time: { value: 0 } }, transparent: true })
    m.userData.u = m.uniforms
    return m
  }, [anchors])
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
