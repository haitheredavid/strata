import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { PlatePlace, Ring } from '../layout/modes'
import { anim, plateKey } from './anim'
import { CurveBatch } from './curves/CurveBatch'
import { CURVE_WRITE, Curves } from './curves/Curves'

const corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]

/** Every layer plate's border in one draw: four segments per plate, following its animated transform. */
export function PlateOutlines({ plates, colorOf, opacity }: { plates: PlatePlace[]; colorOf: (id: string) => string; opacity: number }) {
  const batch = useMemo(() => new CurveBatch(Math.max(16, plates.length * 4)), [plates.length])
  useFrame(() => {
    batch.resize(plates.length * 4)
    plates.forEach((pl, k) => {
      const e = anim.get(plateKey(pl.id))
      const [w, h] = pl.size
      const color = colorOf(pl.id)
      for (let s = 0; s < 4; s++) batch.setStyle(4 * k + s, color, e ? 0.6 * opacity : 0, 1.5)
      if (!e) return
      corners[0].set(-w / 2, -h / 2, 0)
      corners[1].set(w / 2, -h / 2, 0)
      corners[2].set(w / 2, h / 2, 0)
      corners[3].set(-w / 2, h / 2, 0)
      for (const c of corners) c.applyQuaternion(e.quat).add(e.pos)
      for (let s = 0; s < 4; s++) batch.setSegment(4 * k + s, corners[s], corners[(s + 1) % 4])
    })
  }, CURVE_WRITE)
  return <Curves batch={batch} />
}

// Quarter circle as a cubic bezier: control points at this fraction of the radius along the tangents.
const K = 0.5523
const p = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]

/** Orbit mode's hop rings: dashed circles, four bezier quarters each, one draw for all. */
export function RingLines({ rings }: { rings: Ring[] }) {
  const batch = useMemo(() => {
    const b = new CurveBatch(Math.max(16, rings.length * 4))
    b.resize(rings.length * 4)
    rings.forEach(({ y, r }, k) => {
      for (let q = 0; q < 4; q++) {
        const a0 = (q * Math.PI) / 2
        const a1 = a0 + Math.PI / 2
        p[0].set(r * Math.cos(a0), y, r * Math.sin(a0))
        p[1].set(r * (Math.cos(a0) - K * Math.sin(a0)), y, r * (Math.sin(a0) + K * Math.cos(a0)))
        p[2].set(r * (Math.cos(a1) + K * Math.sin(a1)), y, r * (Math.sin(a1) - K * Math.cos(a1)))
        p[3].set(r * Math.cos(a1), y, r * Math.sin(a1))
        b.setCurve(4 * k + q, p[0], p[1], p[2], p[3])
        b.setStyle(4 * k + q, '#3a4459', 0.5, 1, 0.6, 0.4)
      }
    })
    return b
  }, [rings])
  return <Curves batch={batch} />
}
