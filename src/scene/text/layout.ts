/** Font metrics in em units (multiply by the font size for world units). */
export interface FontMetrics {
  /** Atlas cell per character. */
  index: Map<string, number>
  /** Pen advance per atlas cell. */
  advance: Float32Array
  /** Cell side. */
  cell: number
  /** Cell left edge to the pen position. */
  padLeft: number
  /** Cell top to the baseline. */
  baseline: number
  /** Cap height, ascender and descender (positive) heights. */
  cap: number
  ascent: number
  descent: number
}

export type AnchorX = 'left' | 'center' | 'right'
export type AnchorY = 'top' | 'middle' | 'bottom'

export interface Laid {
  /** Atlas cell per glyph. */
  cells: number[]
  /** Lower-left corner of each glyph's quad (x, y pairs), relative to the anchor point. */
  xy: number[]
  /** Quad side, world units. */
  quad: number
  width: number
}

const ELLIPSIS = '…'

function cellOf(m: FontMetrics, ch: string) {
  return m.index.get(ch) ?? m.index.get('?') ?? 0
}

function measure(m: FontMetrics, text: string) {
  let w = 0
  for (const ch of text) w += m.advance[cellOf(m, ch)]
  return w
}

/**
 * Lay out one line. `anchorX` / `anchorY` say which point of the text block sits on the anchor (as
 * troika does: middle is half the cap height). Text wider than `maxWidth` is cut with an ellipsis.
 */
export function layoutLine(m: FontMetrics, text: string, size: number, anchorX: AnchorX, anchorY: AnchorY, maxWidth?: number): Laid {
  let s = text
  if (maxWidth !== undefined && measure(m, s) * size > maxWidth) {
    const room = maxWidth / size - m.advance[cellOf(m, ELLIPSIS)]
    let w = 0
    let cut = 0
    const chars = [...s]
    while (cut < chars.length && w + m.advance[cellOf(m, chars[cut])] <= room) w += m.advance[cellOf(m, chars[cut++])]
    s = chars.slice(0, cut).join('').trimEnd() + ELLIPSIS
  }
  const width = measure(m, s) * size
  const x0 = anchorX === 'left' ? 0 : anchorX === 'center' ? -width / 2 : -width
  const base = anchorY === 'middle' ? (-m.cap / 2) * size : anchorY === 'top' ? -m.ascent * size : m.descent * size
  const quad = m.cell * size
  const top = base + m.baseline * size
  const cells: number[] = []
  const xy: number[] = []
  let pen = x0
  for (const ch of s) {
    const c = cellOf(m, ch)
    if (ch !== ' ') {
      cells.push(c)
      xy.push(pen - m.padLeft * size, top - quad)
    }
    pen += m.advance[c] * size
  }
  return { cells, xy, quad, width }
}
