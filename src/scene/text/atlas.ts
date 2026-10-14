import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from 'three'
// troika reads woff/ttf/otf, and so does FontFace. Bundled so scene text never waits on a font CDN.
import INTER from '@fontsource/inter/files/inter-latin-400-normal.woff?url'
import type { FontMetrics } from './layout'

/**
 * A signed distance field glyph atlas, built at runtime: each character is drawn with Canvas2D into
 * a fixed cell, then a two-pass Euclidean distance transform turns coverage into distance, so one
 * texture stays crisp across zoom levels. Metrics come from measureText, in em units.
 */
export const CHARS = (() => {
  let s = ''
  for (let c = 32; c < 127; c++) s += String.fromCharCode(c)
  return s + '·×→…—'
})()

const COLS = 16
const CELL = 64 // px per cell
const FONT_PX = 44 // em size in px
const BASELINE = 48 // px from the cell top
const PAD = 8 // px left of the pen position
const SPREAD = 8 // px of distance mapped to the 0..1 range

export interface Atlas extends FontMetrics {
  texture: DataTexture
  cols: number
  rows: number
}

let pending: Promise<Atlas> | null = null

/** The shared atlas (built once per page). */
export function loadAtlas(): Promise<Atlas> {
  return (pending ??= build())
}

async function build(): Promise<Atlas> {
  let family = 'sans-serif'
  try {
    const face = new FontFace('StrataInter', `url(${INTER})`)
    await face.load()
    document.fonts.add(face)
    family = 'StrataInter'
  } catch {
    /* fall back to the system sans: metrics still come from what is drawn */
  }
  const rows = Math.ceil(CHARS.length / COLS)
  const w = COLS * CELL
  const h = rows * CELL
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.font = `${FONT_PX}px ${family}`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  const advance = new Float32Array(CHARS.length)
  const index = new Map<string, number>()
  for (let i = 0; i < CHARS.length; i++) {
    const ch = CHARS[i]
    index.set(ch, i)
    advance[i] = ctx.measureText(ch).width / FONT_PX
    ctx.fillText(ch, (i % COLS) * CELL + PAD, Math.floor(i / COLS) * CELL + BASELINE)
  }
  const cap = ctx.measureText('H').actualBoundingBoxAscent / FONT_PX
  const descent = ctx.measureText('gy').actualBoundingBoxDescent / FONT_PX
  const ascent = ctx.measureText('Hdl').actualBoundingBoxAscent / FONT_PX

  const img = ctx.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h * 4)
  const outside = new Float64Array(w * h)
  const inside = new Float64Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const a = img[p * 4 + 3] / 255
    // Subpixel start: partially covered pixels sit at fractional distance from the edge.
    outside[p] = a >= 0.5 ? 0 : a > 0 ? (0.5 - a) ** 2 : 1e20
    inside[p] = a < 0.5 ? 0 : a < 1 ? (a - 0.5) ** 2 : 1e20
  }
  edt2d(outside, w, h)
  edt2d(inside, w, h)
  for (let p = 0; p < w * h; p++) {
    const sd = Math.sqrt(outside[p]) - Math.sqrt(inside[p]) // > 0 outside the glyph
    const v = Math.round(Math.min(1, Math.max(0, 0.5 - sd / (2 * SPREAD))) * 255)
    out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = out[p * 4 + 3] = v
  }
  const texture = new DataTexture(out, w, h, RGBAFormat, UnsignedByteType)
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.flipY = false
  texture.needsUpdate = true

  return {
    texture,
    cols: COLS,
    rows,
    index,
    advance,
    cell: CELL / FONT_PX,
    padLeft: PAD / FONT_PX,
    baseline: BASELINE / FONT_PX,
    cap,
    ascent,
    descent,
  }
}

// Felzenszwalb & Huttenlocher's 1D squared distance transform, then rows and columns for 2D.
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]
  }
}
