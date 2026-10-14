import { describe, expect, it } from 'vitest'
import { Mesh, PlaneGeometry, Quaternion, Euler, Raycaster, Vector3 } from 'three'
import { synthGraph } from '../dev/synth'
import { autoLayout } from '../layout/autoLayout'
import { MODES } from '../layout/modes'
import { placeJobs } from '../layout/modes/jobs'
import { placeClusters } from '../layout/modes/compute'
import { deriveView } from '../view/deriveView'
import { anim, animState } from '../scene/anim'
import { buildWorld, pack } from './world'
import { pickNode } from './pick'

const graph = synthGraph({ tables: 200, pipelines: 6, seed: 5 })
const view = deriveView(graph, { lineage: true })
const layout = autoLayout(graph)
const ctx = { focusedId: null, hops: null, hopUp: 1, hopDown: 1 }
const placement = placeClusters(view, placeJobs(view, MODES.stack.place(view, layout, ctx), 'stack', 8), 'stack', 8)

describe('buildWorld', () => {
  it('indexes every placed node and every FK edge between them', () => {
    const w = buildWorld(view, placement)
    expect(w.nodes.count).toBe(Object.keys(placement.nodes).length)
    expect(w.fk.count).toBe(view.edges.length)
    for (let k = 0; k < w.fk.count; k++) {
      const e = view.edges.find((x) => x.id === w.fk.ids[k])!
      expect(w.nodes.ids[w.fk.src[k]]).toBe(e.from)
      expect(w.nodes.ids[w.fk.dst[k]]).toBe(e.to)
    }
  })
})

describe('pack', () => {
  it('copies only moved entries and reports the dirty range', () => {
    const w = buildWorld(view, placement)
    anim.clear()
    w.nodes.ids.forEach((id, i) => {
      const q = new Quaternion()
      anim.set(id, { pos: new Vector3(i, 0, 0), quat: q, target: new Vector3(), frame: 'flat', movedAt: 1 })
    })
    expect(pack(w)).toBe(true)
    expect(w.dirty).toEqual({ lo: 0, hi: w.nodes.count - 1 })
    expect(pack(w)).toBe(false)
    const e = anim.get(w.nodes.ids[7])!
    e.pos.set(99, 1, 2)
    e.movedAt = 2
    expect(pack(w)).toBe(true)
    expect(w.dirty).toEqual({ lo: 7, hi: 7 })
    expect([...w.nodes.pos.slice(21, 24)]).toEqual([99, 1, 2])
    anim.clear()
    animState.frame = 0
  })
})

describe('pickNode', () => {
  it('agrees with three raycasting on oriented rectangles', () => {
    const w = buildWorld(view, placement)
    const n = Math.min(60, w.nodes.count)
    const meshes: Mesh[] = []
    for (let i = 0; i < n; i++) {
      const q = new Quaternion().setFromEuler(new Euler(Math.sin(i) * 1.2, Math.cos(i * 1.7), i * 0.3))
      const p = new Vector3((i % 8) * 3 - 12, Math.floor(i / 8) * 3 - 10, Math.sin(i) * 4)
      w.nodes.pos.set([p.x, p.y, p.z], 3 * i)
      w.nodes.quat.set([q.x, q.y, q.z, q.w], 4 * i)
      const m = new Mesh(new PlaneGeometry(w.nodes.size[2 * i], w.nodes.size[2 * i + 1]))
      m.position.copy(p)
      m.quaternion.copy(q)
      m.updateMatrixWorld()
      m.userData.i = i
      meshes.push(m)
    }
    const nodes = { ...w.nodes, count: n }
    const rc = new Raycaster()
    let hits = 0
    for (let k = 0; k < 400; k++) {
      const origin = new Vector3(Math.sin(k) * 5, Math.cos(k * 0.7) * 5, 40)
      const target = new Vector3((k % 20) - 10, ((k * 7) % 20) - 10, 0)
      const dir = target.sub(origin).normalize()
      rc.set(origin, dir)
      const want = rc.intersectObjects(meshes, false)[0]
      const got = pickNode(nodes, { ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z })
      expect(got?.index ?? null).toBe(want ? want.object.userData.i : null)
      if (want) {
        hits++
        expect(got!.distance).toBeCloseTo(want.distance, 4)
      }
    }
    expect(hits).toBeGreaterThan(40)
  })
})
