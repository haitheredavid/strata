import { Color } from 'three'

const tmp = new Color()

/** Pack CSS colors into a linear rgb array, one triple per entry. */
export function packColors(colors: string[]): Float32Array {
  const out = new Float32Array(colors.length * 3)
  colors.forEach((c, k) => tmp.set(c).toArray(out, 3 * k))
  return out
}
