import { Color, DoubleSide, Vector2, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  cos,
  sin,
  cameraProjectionMatrix,
  cross,
  float,
  fwidth,
  int,
  ivec2,
  length,
  max,
  min,
  modelViewMatrix,
  normalize,
  positionGeometry,
  select,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { Texture } from 'three'
import { ANCHOR_TEX_W as ANCHOR_W } from '../text/anchors'
import { HEADER_H } from '../../layout/geometry'

/**
 * TSL (node material) versions of the instanced renderers' shaders, for three's WebGPURenderer on
 * either of its backends. They read the same geometry attributes as the GLSL versions in
 * FkEdges / CardBodies, and expose uniforms with the same names and `.value` shape, so each
 * component only swaps the material.
 */
export interface Uniforms {
  [name: string]: { value: unknown }
}

const rgb = (css: string) => {
  const c = new Color(css)
  return new Vector3(c.r, c.g, c.b)
}

type F = Node<'float'>
type V2 = Node<'vec2'>
type V3 = Node<'vec3'>
type V4 = Node<'vec4'>

const rotate = (q: V4, v: V3) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2))

// ---------------------------------------------------------------------------------------------
// FK wires: cubic bezier per instance, expanded to a pixel-width ribbon in screen space.

export function fkEdgeMaterial(segments: number) {
  const u = {
    resolution: uniform(new Vector2(1, 1)),
    hovered: uniform(-1),
    hoverable: uniform(1),
    fade: uniform(1),
  }
  const seg = attribute('seg', 'float')
  const side = attribute('side', 'float')
  const c0 = attribute('c0', 'vec3')
  const c1 = attribute('c1', 'vec3')
  const c2 = attribute('c2', 'vec3')
  const c3 = attribute('c3', 'vec3')
  const ends = attribute('ends', 'vec2')
  const istyle = attribute('istyle', 'vec2')
  const icolor = attribute('icolor', 'vec3')

  // hovered: -1 nothing, -2 something that isn't a node here, else that node's index
  const hovering = u.hoverable.greaterThan(0.5).and(u.hovered.greaterThan(-1.5))
  const touch = abs(ends.x.sub(u.hovered)).lessThan(0.5).or(abs(ends.y.sub(u.hovered)).lessThan(0.5))
  const opacity = select(hovering, select(touch, float(1), float(0.3)), istyle.x)
  const width = select(hovering.and(touch), float(3), istyle.y)

  const bez = (t: F): V3 => {
    const s = float(1).sub(t)
    return c0
      .mul(s.mul(s).mul(s))
      .add(c1.mul(s.mul(s).mul(t).mul(3)))
      .add(c2.mul(s.mul(t).mul(t).mul(3)))
      .add(c3.mul(t.mul(t).mul(t)))
  }

  const mat = new MeshBasicNodeMaterial()
  mat.vertexNode = Fn(() => {
    const t = seg.div(segments)
    const mvp = (p: V3): V4 => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1)))
    const clip = mvp(bez(t)).toVar()
    const screen = (c: V4): V2 => c.xy.div(c.w).mul(u.resolution).mul(0.5)
    const a = screen(mvp(bez(max(t.sub(1 / segments), 0))))
    const b = screen(mvp(bez(min(t.add(1 / segments), 1))))
    const d = b.sub(a)
    const dir = select(length(d).greaterThan(1e-5), normalize(d), vec2(1, 0))
    const off = vec2(dir.y.negate(), dir.x).mul(side).mul(width).div(u.resolution).mul(clip.w)
    return vec4(clip.xy.add(off), clip.z, clip.w)
  })()
  mat.colorNode = icolor
  mat.opacityNode = opacity.mul(u.fade)
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.forceSinglePass = true // otherwise transparent + double-sided renders as two passes
  return { material: mat, uniforms: u as unknown as Uniforms }
}

// ---------------------------------------------------------------------------------------------
// Card bodies: one quad per node, layers composed in the fragment stage.

export function cardMaterial(outline: number) {
  const u = {
    hovered: uniform(-1),
    // the old card meshes' colors, as linear rgb
    bodyColor: uniform(rgb('#1b2130')),
    bodyHigh: uniform(rgb('#2a3344')),
    ink: uniform(rgb('#0b0e14')),
  }
  const ipos = attribute('ipos', 'vec3')
  const iquat = attribute('iquat', 'vec4')
  // Packed to stay within WebGPU's 8 vertex buffers (see CardBodies).
  const imeta = attribute('imeta', 'vec4')
  const icolor4 = attribute('icolor', 'vec4')
  const imedal = attribute('imedal', 'vec4')
  const isize = imeta.xy
  const icolor = icolor4.xyz

  const full = isize.add(outline * 2)
  const local = positionGeometry.xy.mul(full)

  const mat = new MeshBasicNodeMaterial()
  mat.vertexNode = Fn(() => {
    const world = ipos.add(rotate(iquat, vec3(local, 0.02)))
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(world, 1)))
    // table, domain, source are cards; jobs and clusters collapse off screen
    return select(imeta.z.lessThan(2.5), clip, vec4(2, 2, 2, 1))
  })()

  const over = (dst: V4, rgb: V3, a: F): V4 => vec4(rgb.mul(a).add(dst.rgb.mul(float(1).sub(a))), a.add(dst.a.mul(float(1).sub(a))))
  const inside = (p: V2, c: V2, half: V2) => abs(p.x.sub(c.x)).lessThanEqual(half.x).and(abs(p.y.sub(c.y)).lessThanEqual(half.y))

  const half = isize.mul(0.5)
  const top = half.y
  const op = icolor4.w
  const high = imedal.w.greaterThanEqual(2).or(abs(imeta.w.sub(u.hovered)).lessThan(0.5))
  const inCard = inside(local, vec2(0, 0), half)
  const mc = vec2(half.x.sub(0.32), top.sub(HEADER_H / 2))
  const hasMedal = imedal.w.mod(2).greaterThan(0.5)

  let c: V4 = over(vec4(0, 0, 0, 0), select(high, vec3(1, 1, 1), icolor), select(high, float(0.9), float(0.5)).mul(op))
  c = select(inCard, over(c, select(high, u.bodyHigh, u.bodyColor), op.mul(0.95)), c)
  c = select(inCard.and(local.y.greaterThanEqual(top.sub(HEADER_H))), over(c, icolor, op), c)
  c = select(inCard.and(hasMedal).and(inside(local, mc, vec2(0.22, 0.22))), over(c, u.ink, op.mul(0.85)), c)
  c = select(inCard.and(hasMedal).and(inside(local, mc, vec2(0.17, 0.17))), over(c, imedal.xyz, op), c)

  mat.colorNode = c.rgb.div(max(c.a, 1e-4))
  mat.opacityNode = c.a
  mat.alphaTest = 0.002
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.forceSinglePass = true
  return { material: mat, uniforms: u as unknown as Uniforms }
}

// ---------------------------------------------------------------------------------------------
// Curve batches: same ribbon as the FK wires, with per-curve color, width, taper and dashes.

export function curveMaterial(segments: number) {
  const u = {
    resolution: uniform(new Vector2(1, 1)),
    fade: uniform(1),
  }
  const seg = attribute('seg', 'float')
  const side = attribute('side', 'float')
  const c0 = attribute('c0', 'vec3')
  const c1 = attribute('c1', 'vec3')
  const c2 = attribute('c2', 'vec3')
  const c3 = attribute('c3', 'vec3')
  const istyle = attribute('istyle', 'vec4') // rgb, opacity
  const iline = attribute('iline', 'vec4') // width px (negative: taper), dash, gap, length

  const t = seg.div(segments)
  const bez = (t: F): V3 => {
    const s = float(1).sub(t)
    return c0
      .mul(s.mul(s).mul(s))
      .add(c1.mul(s.mul(s).mul(t).mul(3)))
      .add(c2.mul(s.mul(t).mul(t).mul(3)))
      .add(c3.mul(t.mul(t).mul(t)))
  }

  const mat = new MeshBasicNodeMaterial()
  mat.vertexNode = Fn(() => {
    const mvp = (p: V3): V4 => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1)))
    const clip = mvp(bez(t)).toVar()
    const screen = (c: V4): V2 => c.xy.div(c.w).mul(u.resolution).mul(0.5)
    const a = screen(mvp(bez(max(t.sub(1 / segments), 0))))
    const b = screen(mvp(bez(min(t.add(1 / segments), 1))))
    const d = b.sub(a)
    const dir = select(length(d).greaterThan(1e-5), normalize(d), vec2(1, 0))
    const width = select(iline.x.lessThan(0), iline.x.negate().mul(float(1).sub(t)), iline.x)
    const off = vec2(dir.y.negate(), dir.x).mul(side).mul(width).div(u.resolution).mul(clip.w)
    return vec4(clip.xy.add(off), clip.z, clip.w)
  })()

  // Dashes in world units along the curve; gaps discard via alphaTest.
  const along = t.mul(iline.w)
  const gap = iline.y.greaterThan(0).and(along.mod(iline.y.add(iline.z)).greaterThan(iline.y))
  mat.colorNode = istyle.xyz
  mat.opacityNode = select(gap, float(0), istyle.w.mul(u.fade))
  mat.alphaTest = 0.001
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.forceSinglePass = true
  return { material: mat, uniforms: u as unknown as Uniforms }
}

// ---------------------------------------------------------------------------------------------
// Scene text: glyph quads hung off an anchor texture, sampled from an SDF atlas.

export function textMaterial(atlas: { texture: Texture; cols: number; rows: number }, anchors: Texture) {
  const g0 = attribute('g0', 'vec4') // anchor, x, y, z
  const g1 = attribute('g1', 'vec4') // atlas cell, quad side, opacity
  const g2 = attribute('g2', 'vec4') // rgb
  const corner = uv()

  const mat = new MeshBasicNodeMaterial()
  mat.vertexNode = Fn(() => {
    const a = int(g0.x.add(0.5)).mul(2)
    const at = (i: Node<'int'>): V4 => textureLoad(anchors, ivec2(i.mod(ANCHOR_W), i.div(ANCHOR_W)))
    const apos = at(a).xyz
    const aquat = at(a.add(1))
    const local = vec3(g0.y.add(corner.x.mul(g1.y)), g0.z.add(corner.y.mul(g1.y)), g0.w)
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(apos.add(rotate(aquat, local)), 1)))
  })()
  const col = g1.x.mod(atlas.cols)
  const row = g1.x.div(atlas.cols).floor()
  const auv = vec2(col.add(corner.x), row.add(float(1).sub(corner.y))).div(vec2(atlas.cols, atlas.rows))
  const d = texture(atlas.texture, auv).r
  const w = max(fwidth(d).mul(0.7), 0.001)
  mat.colorNode = g2.xyz
  mat.opacityNode = smoothstep(float(0.5).sub(w), float(0.5).add(w), d).mul(g1.z)
  mat.alphaTest = 0.01
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  mat.forceSinglePass = true
  return mat
}

// ---------------------------------------------------------------------------------------------
// Node parts: instanced shapes hung off the anchor texture, spun about their local Z.

export function partMaterial(anchors: Texture) {
  const u = { time: uniform(0) }
  const p0 = attribute('p0', 'vec4') // anchor, offset xyz
  const p1 = attribute('p1', 'vec4') // scale xyz, spin rate
  const p2 = attribute('p2', 'vec4') // rgb, opacity

  const mat = new MeshBasicNodeMaterial()
  mat.vertexNode = Fn(() => {
    const a = int(p0.x.add(0.5)).mul(2)
    const at = (i: Node<'int'>): V4 => textureLoad(anchors, ivec2(i.mod(ANCHOR_W), i.div(ANCHOR_W)))
    const v = positionGeometry.mul(p1.xyz)
    const t = u.time.mul(p1.w)
    const spun = vec3(v.x.mul(cos(t)).sub(v.y.mul(sin(t))), v.x.mul(sin(t)).add(v.y.mul(cos(t))), v.z)
    const world = at(a).xyz.add(rotate(at(a.add(1)), spun.add(p0.yzw)))
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(world, 1)))
  })()
  mat.colorNode = p2.xyz
  mat.opacityNode = p2.w
  mat.transparent = true
  return { material: mat, uniforms: u as unknown as Uniforms }
}
