import { describe, expect, it } from 'vitest'
import { CubicBezierCurve3, Euler, Quaternion, Vector3 } from 'three'
import { synthGraph } from '../dev/synth'
import { autoLayout } from '../layout/autoLayout'
import { MODES, MODE_IDS } from '../layout/modes'
import { anchorY } from '../layout/geometry'
import { deriveView } from '../view/deriveView'
import { anim } from '../scene/anim'
import { update } from '../scene/wireCurve'
import { buildWorld, pack } from './world'
import { fkCurves, updateFkCurves } from './fkEdges'

const graph = synthGraph({ tables: 150, seed: 6 })
const view = deriveView(graph)
const layout = autoLayout(graph)
const ctx = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }

describe('fk curves', () => {
  for (const mode of MODE_IDS)
    it(`match Wire's curves in ${mode} mode`, () => {
      const placement = MODES[mode].place(view, layout, ctx)
      anim.clear()
      // Tilt billboards so orientation-dependent branches get exercised.
      Object.entries(placement.nodes).forEach(([id, n], i) => {
        const q = new Quaternion()
        if (n.frame === 'flat') q.setFromEuler(new Euler(-Math.PI / 2, 0, 0))
        if (n.frame === 'side') q.setFromEuler(new Euler(0, Math.PI / 2, 0))
        if (n.frame === 'billboard') q.setFromEuler(new Euler(0.3, 0.2 * (i % 3), 0))
        anim.set(id, { pos: new Vector3(...n.p), quat: q, target: new Vector3(...n.p), frame: n.frame, movedAt: 1 })
      })
      const w = buildWorld(view, placement)
      pack(w)
      const c = fkCurves(w.fk.count)
      expect(updateFkCurves(w, c)).toEqual({ lo: 0, hi: w.fk.count - 1 })
      expect(updateFkCurves(w, c).hi).toBe(-1) // nothing moved since

      const byId = new Map(view.nodes.map((n) => [n.id, n]))
      const buf = new Float32Array(33 * 3)
      const labels: [Vector3, Vector3] = [new Vector3(), new Vector3()]
      for (let k = 0; k < w.fk.count; k++) {
        const e = view.edges.find((x) => x.id === w.fk.ids[k])!
        const from = { node: byId.get(e.from)!, place: placement.nodes[e.from], column: e.fromColumns[0] }
        const to = { node: byId.get(e.to)!, place: placement.nodes[e.to], column: e.toColumns[0] }
        const props = { edge: e, from, to, color: '', opacity: 1, width: 1, hoverable: true }
        update(props, anchorY(from.node, from.column), anchorY(to.node, to.column), buf, labels)
        const ctrl = c.ctrl.subarray(12 * k, 12 * k + 12)
        const curve = new CubicBezierCurve3(...[0, 3, 6, 9].map((o) => new Vector3().fromArray(ctrl, o)) as [Vector3, Vector3, Vector3, Vector3])
        for (const s of [0, 8, 16, 32]) {
          const p = curve.getPoint(s / 32)
          expect(p.x).toBeCloseTo(buf[s * 3], 3)
          expect(p.y).toBeCloseTo(buf[s * 3 + 1], 3)
          expect(p.z).toBeCloseTo(buf[s * 3 + 2], 3)
        }
        expect(c.labels[6 * k]).toBeCloseTo(labels[0].x, 3)
        expect(c.labels[6 * k + 5]).toBeCloseTo(labels[1].z, 3)
      }
      anim.clear()
    })
})
