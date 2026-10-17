import { describe, expect, it } from 'vitest'
import { CubicBezierCurve3, Vector3 } from 'three'
import { archCurve, BUNDLE_MIN, bundleCandidates, bundledCurve } from './curve'

const curve = () => new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3())

describe('bundleCandidates', () => {
  it('groups wires by shared end, keeping groups of at least BUNDLE_MIN', () => {
    const hub = { id: 'job' }
    const wires = [
      ...Array.from({ length: BUNDLE_MIN }, (_, i) => ({ from: hub, to: { id: `t${i}` } })),
      ...Array.from({ length: BUNDLE_MIN - 1 }, (_, i) => ({ from: { id: `s${i}` }, to: hub })),
    ]
    expect(bundleCandidates(wires)).toEqual([{ hub: 'job', end: 0, members: [0, 1, 2, 3, 4, 5] }])
  })
})

describe('bundledCurve', () => {
  it('is the plain arch when neither end is bundled', () => {
    const a = new Vector3(0, 0, 0)
    const b = new Vector3(10, 0, 4)
    const c = bundledCurve(a, b, null, null, curve())
    const arch = archCurve(a, b, curve())
    expect(c.v1).toEqual(arch.v1)
    expect(c.v2).toEqual(arch.v2)
  })

  it('shares the trunk control point and keeps the ends', () => {
    const hub = new Vector3(0, 0, 0)
    const centroid = new Vector3(20, 0, 0)
    const ends = [new Vector3(20, 0, -40), new Vector3(20, 0, 40)]
    const [c0, c1] = ends.map((b) => bundledCurve(hub, b, centroid, null, curve()))
    expect(c0.v1).toEqual(c1.v1)
    expect(c0.v0).toEqual(hub)
    expect(c0.v3).toEqual(ends[0])
    // Near the hub the two wires run together; they part only near their ends.
    const gap = (t: number) => Math.abs(c0.getPoint(t).z - c1.getPoint(t).z)
    expect(gap(0.25)).toBeLessThan(0.1 * 80)
    expect(gap(0.25)).toBeLessThan(gap(0.5))
    expect(gap(1)).toBeCloseTo(80)
  })

  it('bundles at the target end the same way', () => {
    const hub = new Vector3(20, 0, 0)
    const centroid = new Vector3(0, 0, 0)
    const [c0, c1] = [new Vector3(0, 0, -30), new Vector3(0, 0, 30)].map((a) => bundledCurve(a, hub, null, centroid, curve()))
    expect(c0.v2).toEqual(c1.v2)
  })
})
