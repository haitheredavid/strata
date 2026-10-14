/**
 * Many copies of one shape hung off scene anchors, in one draw: each instance has an anchor, an
 * offset and scale in the anchor's frame, a spin rate about its local Z, and a color and opacity.
 * Jobs and cluster racks are made of a few of these (hex face, hex rim, trigger ring, event marker,
 * rack boxes), so every job and cluster in the scene costs five draws in total.
 */
export class Parts {
  count: number
  /** anchor, x, y, z */
  p0: Float32Array
  /** scale x, y, z, spin (radians per second) */
  p1: Float32Array
  /** r, g, b, opacity */
  p2: Float32Array
  styleDirty = true

  constructor(count: number) {
    this.count = count
    this.p0 = new Float32Array(count * 4)
    this.p1 = new Float32Array(count * 4)
    this.p2 = new Float32Array(count * 4)
  }

  place(i: number, anchor: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, spin = 0) {
    this.p0.set([anchor, x, y, z], 4 * i)
    this.p1.set([sx, sy, sz, spin], 4 * i)
  }

  /** Color as linear rgb (0..1) and opacity; flags an upload only on change. */
  style(i: number, r: number, g: number, b: number, a: number) {
    const o = 4 * i
    const s = this.p2
    if (s[o] === r && s[o + 1] === g && s[o + 2] === b && s[o + 3] === a) return
    s[o] = r
    s[o + 1] = g
    s[o + 2] = b
    s[o + 3] = a
    this.styleDirty = true
  }

  /** Whether styles changed since the last call. */
  takeDirty() {
    const d = this.styleDirty
    this.styleDirty = false
    return d
  }

  /** Scale only (event marker pulse). */
  scale(i: number, s: number) {
    const o = 4 * i
    if (this.p1[o] === s) return
    this.p1[o] = this.p1[o + 1] = this.p1[o + 2] = s
    this.styleDirty = true
  }
}
