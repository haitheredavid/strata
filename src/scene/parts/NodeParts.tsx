import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, CylinderGeometry, OctahedronGeometry, TorusGeometry } from 'three'
import type { Schedule } from '../../sim/schedule'
import { onCluster } from '../../sim/schedule'
import { measured, usageAt, workersFor } from '../../sim/spark'
import type { ViewCluster, ViewNode } from '../../view/deriveView'
import type { World } from '../../world/world'
import { useStore } from '../../store'
import { EVENT, RACK_GAP, RACK_MAX_SHOWN, RACK_ROW } from '../labels'
import type { AnchorTable } from '../text/anchors'
import { timeClock } from '../timeClock'
import type { RunState } from '../labels'
import { PartBatch } from './PartBatch'
import { Parts } from './parts'

// Shapes in their node's local frame (faces +Z), matching the old per-node meshes.
const HEX_FACE = new CylinderGeometry(0.75, 0.75, 0.2, 6).rotateX(Math.PI / 2)
const HEX_RIM = new CylinderGeometry(0.92, 0.92, 0.18, 6).rotateX(Math.PI / 2)
const RING = new TorusGeometry(1.25, 0.05, 8, 6)
const EVENT_MARK = new OctahedronGeometry(0.28)
const BOX = new BoxGeometry(1, 1, 1)
const RACK_W = 2.4
const OFF = '#242b3a'
const IDLE = '#334155'

interface Props {
  world: World
  anchors: AnchorTable
  nodeById: Map<string, ViewNode>
  clusterById: Map<string, ViewCluster>
  nodeOpacity: (id: string) => number
  clusterOpacity: (c: ViewCluster) => number
  runState: (id: string) => RunState
  /** A job's color: its pipeline's, or its own place along the gradient when colors follow lineage depth. */
  jobColor: (job: ViewNode) => string
  clusterColor: (kind: ViewCluster['cluster']['kind']) => string
  focused: string | null
  /** With the timeline open: racks light up with the work on them at the playhead. */
  schedule: Schedule | null
}

const colors = new Map<string, Color>()
const rgb = (css: string) => {
  let c = colors.get(css)
  if (!c) colors.set(css, (c = new Color(css)))
  return c
}

/**
 * Every job (hexagon, rim, trigger ring, event marker) and cluster rack (driver, worker rows,
 * frame) in five instanced draws. Layout is built when the world changes; colors, opacity, run
 * state pulses and rack lights are written per frame. Picking is Interaction's.
 */
export function NodeParts(p: Props) {
  const { world } = p
  const layout = useMemo(() => {
    const jobs: { i: number; node: ViewNode }[] = []
    const racks: { i: number; vc: ViewCluster; shown: number }[] = []
    for (let i = 0; i < world.nodes.count; i++) {
      const id = world.nodes.ids[i]
      const n = p.nodeById.get(id)
      if (n?.kind === 'job') jobs.push({ i, node: n })
      const vc = !n ? p.clusterById.get(id) : undefined
      if (vc) racks.push({ i, vc, shown: Math.min(RACK_MAX_SHOWN, vc.cluster.workers.max) })
    }
    const face = new Parts(jobs.length)
    const rim = new Parts(jobs.length)
    const triggered = jobs.filter((j) => j.node.trigger)
    const emitting = jobs.filter((j) => j.node.emits?.length)
    const ring = new Parts(triggered.length)
    const event = new Parts(emitting.length)
    jobs.forEach(({ i }, k) => {
      face.place(k, i, 0, 0, 0)
      rim.place(k, i, 0, 0, -0.02)
    })
    triggered.forEach(({ i, node }, k) => ring.place(k, i, 0, 0, 0, 1, 1, 1, node.trigger!.kind === 'continuous' ? 2 : 0.6))
    emitting.forEach(({ i }, k) => event.place(k, i, 1.45, 0.95, 0.1))
    // Racks: driver, then one row per shown worker, then the frame behind them.
    const boxes = new Parts(racks.reduce((s, r) => s + r.shown + 2, 0))
    let b = 0
    const rackBox: number[] = []
    for (const { i, shown } of racks) {
      rackBox.push(b)
      boxes.place(b++, i, 0, 0, 0, RACK_W, 0.4, 0.5)
      for (let w = 0; w < shown; w++) boxes.place(b++, i, 0, -(w + 1) * (RACK_ROW + RACK_GAP) - 0.05, 0, RACK_W, RACK_ROW, 0.45)
      const h = shown * (RACK_ROW + RACK_GAP)
      boxes.place(b++, i, 0, -h / 2, -0.05, RACK_W + 0.25, h + 0.75, 0.3)
    }
    return { jobs, racks, face, rim, ring, event, boxes, rackBox, triggered, emitting, pulse: new Float32Array(emitting.length) }
    // nodeById / clusterById change with the view, as does the world
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world])

  useFrame((_, dt) => {
    const L = layout
    const hovered = useStore.getState().hoveredId
    L.jobs.forEach(({ node }, k) => {
      const op = p.nodeOpacity(node.id)
      const high = node.id === hovered || node.id === p.focused
      const face = rgb(p.runState(node.id) === 'active' ? '#ffffff' : high ? '#2a3344' : '#141925')
      L.face.style(k, face.r, face.g, face.b, op)
      const c = rgb(p.jobColor(node))
      L.rim.style(k, c.r, c.g, c.b, op)
    })
    L.triggered.forEach(({ node }, k) => {
      const c = rgb(p.jobColor(node))
      L.ring.style(k, c.r, c.g, c.b, 0.8 * p.nodeOpacity(node.id))
    })
    const ev = rgb(EVENT)
    L.emitting.forEach(({ node }, k) => {
      const active = p.runState(node.id) === 'active'
      // Event marker pops while the job is the active run step.
      L.pulse[k] += ((active ? 1 : 0) - L.pulse[k]) * Math.min(1, dt * 6)
      L.event.style(k, ev.r, ev.g, ev.b, p.nodeOpacity(node.id))
      L.event.scale(k, 1 + L.pulse[k] * 0.6 + (active ? Math.sin(performance.now() / 120) * 0.08 : 0))
    })
    L.racks.forEach(({ vc, shown }, r) => {
      const c = vc.cluster
      const op = p.clusterOpacity(vc)
      const color = p.clusterColor(c.kind)
      const high = vc.id === hovered || vc.id === p.focused
      const b = L.rackBox[r]
      let driver = rgb(color)
      let blink = 1
      let lit = shown
      let up = true
      if (p.schedule) {
        const { starting, working } = onCluster(p.schedule, c.id, timeClock.t)
        // Measured node use when the snapshot has it; else the minimum, plus autoscaling as tasks share the cluster.
        const real = measured(p.schedule, c.id) ? usageAt(p.schedule, c.id, timeClock.t) ?? null : undefined
        up = real !== undefined ? !!real : starting.length + working.length > 0 || c.kind === 'all_purpose'
        const busy = real !== undefined ? Math.min(c.workers.max, real?.workers ?? 0) : working.length ? workersFor(c, working.length) : 0
        lit = Math.round((busy / c.workers.max) * shown)
        blink = starting.length && !working.length ? 0.5 + 0.5 * Math.sin(performance.now() / 150) : 1
        driver = rgb(up ? color : OFF)
      }
      L.boxes.style(b, driver.r * blink, driver.g * blink, driver.b * blink, op)
      for (let w = 0; w < shown; w++) {
        const wc = rgb(w < lit ? color : up ? IDLE : OFF)
        L.boxes.style(b + 1 + w, wc.r, wc.g, wc.b, op)
      }
      const f = rgb(high ? '#2a3344' : '#0f131c')
      L.boxes.style(b + 1 + shown, f.r, f.g, f.b, op)
    })
  }, -0.5)

  const { face, rim, ring, event, boxes } = layout
  return (
    <>
      <PartBatch shape={HEX_RIM} parts={rim} anchors={p.anchors} />
      <PartBatch shape={HEX_FACE} parts={face} anchors={p.anchors} />
      <PartBatch shape={RING} parts={ring} anchors={p.anchors} />
      <PartBatch shape={EVENT_MARK} parts={event} anchors={p.anchors} />
      <PartBatch shape={BOX} parts={boxes} anchors={p.anchors} />
    </>
  )
}
