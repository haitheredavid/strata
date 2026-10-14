import { Color } from 'three'
import type { Vector3 } from 'three'

/**
 * A growable set of curves drawn in one instanced call by <Curves>. Each curve is a cubic bezier
 * (a straight segment is one with its control points on the chord) with an rgb color, opacity,
 * pixel width and an optional world-space dash pattern. Owners write curves in their frame loop;
 * only the written index ranges are uploaded.
 */
export class CurveBatch {
  count = 0
  capacity: number
  /** c0, c1, c2, c3 xyz per curve. */
  ctrl: Float32Array
  /** r, g, b, opacity per curve. */
  style: Float32Array
  /** width px (negative: tapers to a point, for arrowheads), dash, gap, approximate length. */
  line: Float32Array
  /** Bumped whenever the arrays are reallocated, so the mesh rebuilds its attributes. */
  version = 0
  ctrlDirty = { lo: Infinity, hi: -1 }
  styleDirty = { lo: Infinity, hi: -1 }

  constructor(capacity = 16) {
    this.capacity = capacity
    this.ctrl = new Float32Array(capacity * 12)
    this.style = new Float32Array(capacity * 4)
    this.line = new Float32Array(capacity * 4)
  }

  /** Set the number of curves, growing the arrays if needed. */
  resize(count: number) {
    if (count > this.capacity) {
      let cap = this.capacity
      while (cap < count) cap *= 2
      const grow = (a: Float32Array, n: number) => {
        const b = new Float32Array(cap * n)
        b.set(a)
        return b
      }
      this.ctrl = grow(this.ctrl, 12)
      this.style = grow(this.style, 4)
      this.line = grow(this.line, 4)
      this.capacity = cap
      this.version++
    }
    this.count = count
  }

  /** Mark every curve for upload (after the mesh rebinds its buffers). */
  markAll() {
    this.ctrlDirty = { lo: 0, hi: this.count - 1 }
    this.styleDirty = { lo: 0, hi: this.count - 1 }
  }

  /** Dirty ranges since the last call, then reset. */
  takeDirty() {
    const out = { ctrl: this.ctrlDirty, style: this.styleDirty }
    this.ctrlDirty = { lo: Infinity, hi: -1 }
    this.styleDirty = { lo: Infinity, hi: -1 }
    return out
  }

  private mark(d: { lo: number; hi: number }, i: number) {
    if (i < d.lo) d.lo = i
    if (i > d.hi) d.hi = i
  }

  /** Bezier from a to d with control points b, c. */
  setCurve(i: number, a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
    const o = 12 * i
    a.toArray(this.ctrl, o)
    b.toArray(this.ctrl, o + 3)
    c.toArray(this.ctrl, o + 6)
    d.toArray(this.ctrl, o + 9)
    // Arc length lies between the chord and the control polygon; their mean is close enough for dashes.
    const chord = a.distanceTo(d)
    const poly = a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(d)
    this.line[4 * i + 3] = (chord + poly) / 2
    this.mark(this.ctrlDirty, i)
  }

  /** Straight segment from a to b. */
  setSegment(i: number, a: Vector3, b: Vector3) {
    const o = 12 * i
    for (let k = 0; k < 3; k++) {
      const ak = a.getComponent(k)
      const bk = b.getComponent(k)
      this.ctrl[o + k] = ak
      this.ctrl[o + 3 + k] = ak + (bk - ak) / 3
      this.ctrl[o + 6 + k] = ak + ((bk - ak) * 2) / 3
      this.ctrl[o + 9 + k] = bk
    }
    this.line[4 * i + 3] = a.distanceTo(b)
    this.mark(this.ctrlDirty, i)
  }

  /** Color (CSS or Color), opacity, width in px, dash and gap in world units (dash 0: solid). */
  setStyle(i: number, color: string | Color, opacity: number, width: number, dash = 0, gap = 0) {
    const s = this.style
    const l = this.line
    const c = typeof color === 'string' ? parsed(color) : color
    const o = 4 * i
    if (s[o] === c.r && s[o + 1] === c.g && s[o + 2] === c.b && s[o + 3] === opacity && l[o] === width && l[o + 1] === dash && l[o + 2] === gap) return
    s[o] = c.r
    s[o + 1] = c.g
    s[o + 2] = c.b
    s[o + 3] = opacity
    l[o] = width
    l[o + 1] = dash
    l[o + 2] = gap
    this.mark(this.styleDirty, i)
  }

  /** Change only the opacity (hover, fades). */
  setOpacity(i: number, opacity: number) {
    if (this.style[4 * i + 3] === opacity) return
    this.style[4 * i + 3] = opacity
    this.mark(this.styleDirty, i)
  }
}

// CSS color → Color, parsed once.
const colors = new Map<string, Color>()
function parsed(css: string) {
  let c = colors.get(css)
  if (!c) colors.set(css, (c = new Color(css)))
  return c
}
