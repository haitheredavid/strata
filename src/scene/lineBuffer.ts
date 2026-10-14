import type { InterleavedBufferAttribute } from 'three'
import type { Line2 } from 'three-stdlib'

/**
 * Write a polyline (xyz triples) into a drei <Line>'s existing buffers. `setPositions` and
 * `computeLineDistances` allocate new typed arrays and GL buffers on every call; this reuses them and
 * only flags an upload when a value actually changed, so a still scene costs no GPU traffic.
 * Falls back to the allocating path if the point count differs from what the Line was built with.
 * Bounds are not recomputed: render these lines with `frustumCulled={false}`.
 */
export function writeLine(line: Line2, pts: Float32Array, dashed = false) {
  const g = line.geometry
  const n = pts.length / 3 - 1
  const start = g.attributes.instanceStart as InterleavedBufferAttribute | undefined
  if (!start || start.count !== n) {
    g.setPositions(pts)
    if (dashed) line.computeLineDistances()
    return
  }

  // Segment i is [p_i, p_i+1], interleaved as 6 floats.
  const seg = start.data.array as Float32Array
  let changed = false
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) {
      const v = pts[i * 3 + k]
      if (seg[i * 6 + k] !== v) {
        seg[i * 6 + k] = v
        changed = true
      }
    }
  }
  if (!changed) return
  start.data.needsUpdate = true
  if (!dashed) return

  const ds = g.attributes.instanceDistanceStart as InterleavedBufferAttribute | undefined
  if (!ds || ds.count !== n) {
    line.computeLineDistances()
    return
  }
  const dist = ds.data.array as Float32Array
  let acc = 0
  for (let i = 0; i < n; i++) {
    const j = i * 3
    dist[i * 2] = acc
    acc += Math.hypot(pts[j + 3] - pts[j], pts[j + 4] - pts[j + 1], pts[j + 5] - pts[j + 2])
    dist[i * 2 + 1] = acc
  }
  ds.data.needsUpdate = true
}
