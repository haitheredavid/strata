import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'
import { useMemo } from 'react'
import type { Quaternion, Vector3 } from 'three'
import type { PlatePlace } from '../../layout/modes'
import type { World } from '../../world/world'

/**
 * Transforms that text hangs off, as a float texture the glyph shader reads: two texels per anchor
 * (position, then orientation quaternion). Cards, plates and wire ends are anchors; glyphs store an
 * anchor index and an offset in its local frame, so moving a card moves its text without touching
 * the glyph buffers.
 */
export const ANCHOR_TEX_W = 2048

export class AnchorTable {
  count: number
  data: Float32Array
  texture: DataTexture
  private dirty = true

  constructor(count: number) {
    this.count = count
    const rows = Math.max(1, Math.ceil((count * 2) / ANCHOR_TEX_W))
    this.data = new Float32Array(ANCHOR_TEX_W * rows * 4)
    for (let i = 0; i < count; i++) this.data[8 * i + 7] = 1 // identity quaternions
    this.texture = new DataTexture(this.data, ANCHOR_TEX_W, rows, RGBAFormat, FloatType)
    this.texture.minFilter = NearestFilter
    this.texture.magFilter = NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
  }

  /**
   * Make room for `count` anchors. The texture object stays the same (so materials that read it
   * keep working, and never recompile); only its storage grows.
   */
  resize(count: number) {
    this.count = count
    const rows = Math.max(1, Math.ceil((count * 2) / ANCHOR_TEX_W))
    if (rows * ANCHOR_TEX_W * 4 <= this.data.length) return
    const data = new Float32Array(ANCHOR_TEX_W * rows * 4)
    data.set(this.data)
    for (let i = this.data.length / 8; i < count; i++) data[8 * i + 7] = 1
    this.data = data
    this.texture.dispose() // free the old GPU storage; the next upload allocates the new size
    this.texture.image = { data, width: ANCHOR_TEX_W, height: rows }
    this.dirty = true
  }

  set(i: number, pos: Vector3, quat: Quaternion) {
    const o = 8 * i
    const d = this.data
    if (d[o] === pos.x && d[o + 1] === pos.y && d[o + 2] === pos.z && d[o + 4] === quat.x && d[o + 5] === quat.y && d[o + 6] === quat.z && d[o + 7] === quat.w) return
    d[o] = pos.x
    d[o + 1] = pos.y
    d[o + 2] = pos.z
    d[o + 4] = quat.x
    d[o + 5] = quat.y
    d[o + 6] = quat.z
    d[o + 7] = quat.w
    this.dirty = true
  }

  /** Copy packed positions (xyz) and quaternions (xyzw) for anchors [lo, hi] from arrays indexed the same way. */
  copy(pos: Float32Array, quat: Float32Array, lo: number, hi: number) {
    const d = this.data
    for (let i = lo; i <= hi; i++) {
      d[8 * i] = pos[3 * i]
      d[8 * i + 1] = pos[3 * i + 1]
      d[8 * i + 2] = pos[3 * i + 2]
      d[8 * i + 4] = quat[4 * i]
      d[8 * i + 5] = quat[4 * i + 1]
      d[8 * i + 6] = quat[4 * i + 2]
      d[8 * i + 7] = quat[4 * i + 3]
    }
    if (lo <= hi) this.dirty = true
  }

  /** Flag the texture for upload if anything changed since the last call. */
  flush() {
    if (!this.dirty) return
    this.dirty = false
    this.texture.needsUpdate = true
  }

  dispose() {
    this.texture.dispose()
  }
}

/**
 * Index layout of the scene's anchor table: world nodes first (same indices as `world.nodes`),
 * then plates, then two per FK edge (its label points).
 */
export interface SceneAnchors {
  table: AnchorTable
  plateBase: number
  fkBase: number
}

/**
 * The scene's anchor table for a world and its plates. One table for the component's lifetime,
 * resized as the world changes, so the materials that sample it are never rebuilt (on WebGPU a new
 * node material means a synchronous shader compile).
 */
export function useSceneAnchors(world: World, plates: PlatePlace[]): SceneAnchors {
  const table = useMemo(() => new AnchorTable(1), [])
  return useMemo(() => {
    const plateBase = world.nodes.count
    const fkBase = plateBase + plates.length
    table.resize(fkBase + world.fk.count * 2)
    return { table, plateBase, fkBase }
  }, [table, world, plates.length])
}
