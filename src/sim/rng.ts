/** djb2 string hash → unsigned 32-bit. */
export function hash32(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** Deterministic number in [0, 1) for a key. Same key, same number. */
export function rand(key: string) {
  // mulberry32 step, seeded by the key hash, so nearby keys don't give nearby numbers
  let t = (hash32(key) + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Deterministic number in [lo, hi) for a key. */
export const between = (key: string, lo: number, hi: number) => lo + rand(key) * (hi - lo)
