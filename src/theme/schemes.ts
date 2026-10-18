export type SchemeId = 'default' | 'viridis' | 'magma' | 'inferno' | 'plasma' | 'cividis'
export type GradientId = Exclude<SchemeId, 'default'>

export const SCHEMES: [SchemeId, string][] = [
  ['default', 'Default'],
  ['viridis', 'Viridis'],
  ['magma', 'Magma'],
  ['inferno', 'Inferno'],
  ['plasma', 'Plasma'],
  ['cividis', 'Cividis'],
]

export const isScheme = (v: unknown): v is SchemeId => SCHEMES.some(([id]) => id === v)

/** What colours mean: who a thing belongs to (domain, pipeline), or how far downstream it sits. */
export type ColorBy = 'identity' | 'depth'
export const COLOR_BY: [ColorBy, string][] = [
  ['identity', 'Domain & pipeline'],
  ['depth', 'Lineage depth'],
]
export const isColorBy = (v: unknown): v is ColorBy => COLOR_BY.some(([id]) => id === v)

/** The gradient a scheme draws depth with: its own, or Viridis for the categorical default. */
export const depthGradient = (id: SchemeId): GradientId => (id === 'default' ? 'viridis' : id)

interface Gradient {
  /** matplotlib samples at t = 0, 1/16 … 1. */
  stops: string[]
  /** Part of the gradient used for marks: the darkest end vanishes on the dark background. */
  range: [number, number]
}

const GRADIENTS: Record<GradientId, Gradient> = {
  viridis: {
    stops: ['440154', '48186a', '472d7b', '424086', '3b528b', '33638d', '2c728e', '26828e', '21918c', '1fa088', '28ae80', '3fbc73', '5ec962', '84d44b', 'addc30', 'd8e219', 'fde725'],
    range: [0.2, 1],
  },
  magma: {
    stops: ['000004', '0a0822', '1d1147', '36106b', '51127c', '6a1c81', '832681', '9c2e7f', 'b73779', 'd0416f', 'e75263', 'f56b5c', 'fc8961', 'fea772', 'fec488', 'fde2a3', 'fcfdbf'],
    range: [0.3, 0.97],
  },
  inferno: {
    stops: ['000004', '0b0724', '210c4a', '3d0965', '57106e', '71196e', '8a226a', 'a32c61', 'bc3754', 'd24644', 'e45a31', 'f1731d', 'f98e09', 'fcac11', 'f9cb35', 'f2ea69', 'fcffa4'],
    range: [0.3, 0.95],
  },
  plasma: {
    stops: ['0d0887', '310597', '4c02a1', '6600a7', '7e03a8', '9511a1', 'aa2395', 'bc3587', 'cc4778', 'da5a6a', 'e66c5c', 'f0804e', 'f89540', 'fdac33', 'fdc527', 'f8df25', 'f0f921'],
    range: [0.12, 0.95],
  },
  cividis: {
    stops: ['00224e', '002e6a', '1a386f', '32436d', '434e6c', '535a6d', '61656f', '6f7073', '7d7c78', '8c8878', '9b9476', 'aba072', 'bcae6c', 'cdbb63', 'dec958', 'f0d846', 'fee838'],
    range: [0.2, 1],
  },
}

const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, '0')

/** The gradient's color at `t` in [0, 1] (whole gradient, not the usable range). */
export function sample(id: GradientId, t: number): string {
  const { stops } = GRADIENTS[id]
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = channels(stops[i])
  const b = channels(stops[i + 1])
  return '#' + a.map((v, k) => hex2(v + (b[k] - v) * (x - i))).join('')
}

/** `n` colors evenly across the usable range, darkest first (for ordered things: medallion layers). */
export function spread(id: GradientId, n: number): string[] {
  const [lo, hi] = GRADIENTS[id].range
  if (n === 1) return [sample(id, (lo + hi) / 2)]
  return Array.from({ length: n }, (_, i) => sample(id, lo + ((hi - lo) * i) / (n - 1)))
}

/** The color at `t` in [0, 1] along the usable range: 0 its dark end, 1 its bright end. */
export function along(id: GradientId, t: number): string {
  const [lo, hi] = GRADIENTS[id].range
  return sample(id, lo + (hi - lo) * Math.max(0, Math.min(1, t)))
}

const GOLDEN = (Math.sqrt(5) - 1) / 2

/**
 * `n` colors for unordered things (domains, pipelines): positions step by the golden ratio, so
 * neighbours in a list land far apart on the gradient and each new one splits the widest gap left.
 */
export function scatter(id: GradientId, n: number): string[] {
  return Array.from({ length: n }, (_, i) => along(id, n === 1 ? 0.5 : (i * GOLDEN) % 1))
}

/** The usable range as a CSS gradient, dark to bright, for legends and swatches. */
export function gradientCss(id: GradientId, direction = '90deg'): string {
  return `linear-gradient(${direction}, ${Array.from({ length: 9 }, (_, i) => along(id, i / 8)).join(', ')})`
}

/** A bright color from the scheme for UI accents (dark text sits on it). */
export function accentOf(id: GradientId): string {
  return along(id, 0.75)
}
