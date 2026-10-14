import type { NodeTable } from './world'

/**
 * Ray against every node's oriented rectangle (its local XY plane, facing local +Z), nearest hit
 * wins. Replaces per-mesh raycasting once nodes are drawn instanced. A bounding-sphere check skips
 * most nodes before the plane test, so a pick over 50k nodes is a fraction of a millisecond.
 */
export interface Ray {
  ox: number
  oy: number
  oz: number
  dx: number
  dy: number
  dz: number
}

export interface Hit {
  index: number
  distance: number
  /** Hit point in the node's local frame. */
  lx: number
  ly: number
}

/** Rotate (x, y, z) by quaternion (qx, qy, qz, qw); writes into `out`. */
function rotate(out: Float64Array, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  out[0] = x + qw * tx + (qy * tz - qz * ty)
  out[1] = y + qw * ty + (qz * tx - qx * tz)
  out[2] = z + qw * tz + (qx * ty - qy * tx)
}

const ax = new Float64Array(3)
const ay = new Float64Array(3)
const an = new Float64Array(3)

export function pickNode(nodes: NodeTable, ray: Ray, skip?: (i: number) => boolean): Hit | null {
  const { pos, quat, size } = nodes
  let best: Hit | null = null
  for (let i = 0; i < nodes.count; i++) {
    if (skip?.(i)) continue
    const px = pos[3 * i] - ray.ox
    const py = pos[3 * i + 1] - ray.oy
    const pz = pos[3 * i + 2] - ray.oz
    const hw = size[2 * i] / 2
    const hh = size[2 * i + 1] / 2
    // Bounding sphere: distance from the center to the ray line.
    const along = px * ray.dx + py * ray.dy + pz * ray.dz
    if (along < 0) continue
    const r2 = hw * hw + hh * hh
    if (px * px + py * py + pz * pz - along * along > r2) continue
    if (best && along - Math.sqrt(r2) > best.distance) continue

    const qx = quat[4 * i]
    const qy = quat[4 * i + 1]
    const qz = quat[4 * i + 2]
    const qw = quat[4 * i + 3]
    rotate(an, 0, 0, 1, qx, qy, qz, qw)
    const denom = an[0] * ray.dx + an[1] * ray.dy + an[2] * ray.dz
    if (Math.abs(denom) < 1e-9) continue // edge-on
    const t = (px * an[0] + py * an[1] + pz * an[2]) / denom
    if (t < 0 || (best && t >= best.distance)) continue
    // Hit point relative to the center, projected on the local X and Y axes.
    const hx = ray.dx * t - px
    const hy = ray.dy * t - py
    const hz = ray.dz * t - pz
    rotate(ax, 1, 0, 0, qx, qy, qz, qw)
    rotate(ay, 0, 1, 0, qx, qy, qz, qw)
    const lx = hx * ax[0] + hy * ax[1] + hz * ax[2]
    const ly = hx * ay[0] + hy * ay[1] + hz * ay[2]
    if (Math.abs(lx) > hw || Math.abs(ly) > hh) continue
    best = { index: i, distance: t, lx, ly }
  }
  return best
}
