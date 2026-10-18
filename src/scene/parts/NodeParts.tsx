import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, ExtrudeGeometry, OctahedronGeometry, Shape, TorusGeometry } from 'three'
import type { Schedule } from '../../sim/schedule'
import { onCluster } from '../../sim/schedule'
import { measured, usageAt, workersFor } from '../../sim/spark'
import type { ViewCluster, ViewNode } from '../../view/deriveView'
import type { World } from '../../world/world'
import { useStore } from '../../store'
import { EVENT, JOB_R, RACK_GAP, RACK_MAX_SHOWN, RACK_ROW } from '../labels'
import type { AnchorTable } from '../text/anchors'
import { timeClock } from '../timeClock'
import type { RunState } from '../labels'
import { PartBatch } from './PartBatch'
import { Parts } from './parts'

/**
 * A hexagon (point up) with rounded corners, `depth` thick and centred on z = 0, facing +Z.
 * Corners are arcs of radius `round`, so the glyph reads soft at any zoom.
 */
function roundedHex(r: number, round: number, depth: number) {
  const s = new Shape()
  const corner = (k: number) => {
    const a = Math.PI / 2 + (k * Math.PI) / 3
    return [Math.cos(a) * r, Math.sin(a) * r] as const
  }
  // Each corner is cut back along both edges by `cut` and joined by a quadratic arc through it.
  const cut = round / Math.tan(Math.PI / 3)
  for (let k = 0; k < 6; k++) {
    const [px, py] = corner(k - 1)
    const [cx, cy] = corner(k)
    const [nx, ny] = corner(k + 1)
    const len = Math.hypot(cx - px, cy - py)
    const a = [cx + ((px - cx) / len) * cut, cy + ((py - cy) / len) * cut] as const
    const b = [cx + ((nx - cx) / len) * cut, cy + ((ny - cy) / len) * cut] as const
    if (k === 0) s.moveTo(...a)
    else s.lineTo(...a)
    s.quadraticCurveTo(cx, cy, ...b)
  }
  s.closePath()
  return new ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -depth / 2)
}

// Shapes in their node's local frame (faces +Z). A job is a small rounded hexagon: a dark face
// inside a thin rim in its pipeline's colour, about as tall as two card rows, so tables stay the
// main thing on screen. A first job's trigger is a thin circle around it.
const HEX_FACE = roundedHex(JOB_R - 0.09, 0.1, 0.1)
const HEX_RIM = roundedHex(JOB_R, 0.13, 0.08)
const RING = new TorusGeometry(JOB_R + 0.2, 0.022, 6, 48)
const EVENT_MARK = new OctahedronGeometry(0.14)
const BOX = new BoxGeometry(1, 1, 1)
const RACK_W = 1.8
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
    triggered.forEach(({ i }, k) => ring.place(k, i, 0, 0, 0))
    emitting.forEach(({ i }, k) => event.place(k, i, JOB_R + 0.12, JOB_R * 0.8, 0.1))
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
      L.ring.style(k, c.r, c.g, c.b, 0.5 * p.nodeOpacity(node.id))
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
      // Without the timeline there's no load to show: the workers sit as a faint stack.
      const rest = p.schedule ? 1 : 0.35
      for (let w = 0; w < shown; w++) {
        const wc = rgb(w < lit ? color : up ? IDLE : OFF)
        L.boxes.style(b + 1 + w, wc.r, wc.g, wc.b, op * rest)
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
