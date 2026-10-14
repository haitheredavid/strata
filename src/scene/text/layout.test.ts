import { describe, expect, it } from 'vitest'
import { layoutLine } from './layout'
import type { FontMetrics } from './layout'

// Monospace-ish fake: every glyph advances 0.5em, ellipsis 1em.
const chars = 'ab?… '
const m: FontMetrics = {
  index: new Map([...chars].map((c, i) => [c, i])),
  advance: Float32Array.from([...chars].map((c) => (c === '…' ? 1 : 0.5))),
  cell: 1.5,
  padLeft: 0.2,
  baseline: 1.1,
  cap: 0.7,
  ascent: 0.75,
  descent: 0.2,
}

describe('layoutLine', () => {
  it('places glyphs left to right from the anchor and skips spaces', () => {
    const l = layoutLine(m, 'ab a', 2, 'left', 'middle')
    expect(l.width).toBeCloseTo(4)
    expect(l.cells).toEqual([0, 1, 0])
    expect(l.xy.filter((_, i) => i % 2 === 0)).toEqual([-0.4, 0.6, 2.6].map((x) => expect.closeTo(x)))
    // baseline at -cap/2 * size; quad top = baseline + 1.1 * 2; bottom = top - 3
    expect(l.xy[1]).toBeCloseTo(-0.7 + 2.2 - 3)
  })

  it('anchors center and right', () => {
    expect(layoutLine(m, 'ab', 1, 'center', 'top').xy[0]).toBeCloseTo(-0.5 - 0.2)
    expect(layoutLine(m, 'ab', 1, 'right', 'bottom').xy[0]).toBeCloseTo(-1 - 0.2)
  })

  it('cuts long text with an ellipsis to fit maxWidth', () => {
    const l = layoutLine(m, 'abababab', 1, 'left', 'middle', 2.5)
    expect(l.width).toBeLessThanOrEqual(2.5 + 1e-6)
    expect(l.cells.at(-1)).toBe(3)
    expect(l.cells.length).toBe(4) // three letters + ellipsis
  })

  it('maps unknown characters to ?', () => {
    expect(layoutLine(m, 'z', 1, 'left', 'middle').cells).toEqual([2])
  })
})
