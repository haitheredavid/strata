import { Color } from 'three'

// CSS color → Color. Scenes use a handful of distinct colors across tens of thousands of edges and
// cards, so each is parsed once.
const parsed = new Map<string, Color>()

/** A parsed CSS color (shared; don't mutate it). */
export function rgb(css: string): Color {
  let c = parsed.get(css)
  if (!c) parsed.set(css, (c = new Color(css)))
  return c
}

/** Pack CSS colors into a linear rgb array, one triple per entry. */
export function packColors(colors: string[]): Float32Array {
  const out = new Float32Array(colors.length * 3)
  colors.forEach((c, k) => rgb(c).toArray(out, 3 * k))
  return out
}
