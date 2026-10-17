import { useEffect, useLayoutEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import CameraControlsImpl from 'camera-controls'
import { MathUtils, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { CARD_W, cardDepth } from '../layout/geometry'
import { MODES } from '../layout/modes'
import type { Frame, Placement } from '../layout/modes'
import type { ViewGraph } from '../view/deriveView'
import { modeOf, useStore } from '../store'

const { ACTION } = CameraControlsImpl

const FOV = 45
/** Diagram mode narrows the lens this far: close enough to orthographic, still a perspective camera. */
const FLAT_FOV = 3
const FOV_RATE = 3

/** Distance multiplier that keeps the framing of a 45° lens at `fov`. */
const lensScale = (fov: number) => Math.tan(MathUtils.degToRad(FOV / 2)) / Math.tan(MathUtils.degToRad(fov / 2))

/** camera-controls keeps its orbit radius (now and where it is easing to) in these. */
type Radii = { _spherical: { radius: number }; _sphericalEnd: { radius: number }; _needsUpdate: boolean }

/** Where the eye sits relative to a card when flying to it. */
const FLY_OFFSET: Record<Exclude<Frame, 'billboard'>, [number, number, number]> = {
  flat: [4, 9, 9],
  upright: [3, 3, 13],
  side: [11, 4, 6],
}

export function CameraRig({ view, placement }: { view: ViewGraph; placement: Placement }) {
  const controls = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const cmd = useStore((s) => s.cameraCommand)
  const flat = useStore((s) => modeOf(s.layout) === 'diagram')
  const draggable = useStore((s) => MODES[modeOf(s.layout)].draggable)
  const hovered = useStore((s) => s.hoveredId)
  const dragging = useStore((s) => s.dragging)
  // Commands run against the placement of the render that issued them.
  const latest = useRef({ view, placement })
  useLayoutEffect(() => {
    latest.current = { view, placement }
  }, [view, placement])

  // Left-drag on a card moves the card, so stop it from also orbiting the camera. Only cards that can
  // actually drag block it: jobs, racks, domain summaries and cards in non-draggable modes still orbit.
  const kind = hovered ? view.nodes.find((n) => n.id === hovered)?.kind : undefined
  const block = dragging || (draggable && (kind === 'table' || kind === 'source') && placement.nodes[hovered!]?.frame !== 'billboard')
  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.mouseButtons.left = block ? ACTION.NONE : ACTION.ROTATE
    c.touches.one = block ? ACTION.NONE : ACTION.TOUCH_ROTATE
  }, [block])

  // Dolly zoom: ease the lens toward its mode's fov and scale the orbit radius with it, so the framing
  // holds while perspective flattens out (or comes back). Clip planes follow the distance.
  useFrame((state, dt) => {
    const c = controls.current
    const cam = state.camera as PerspectiveCamera
    if (!c || !cam.isPerspectiveCamera) return
    const goal = flat ? FLAT_FOV : FOV
    let changed = false
    if (cam.fov !== goal) {
      changed = true
      // ease in log space: the lens scale is what changes evenly
      const next = Math.abs(cam.fov - goal) < 0.01 ? goal : Math.exp(MathUtils.lerp(Math.log(cam.fov), Math.log(goal), 1 - Math.exp(-dt * FOV_RATE)))
      const r = lensScale(next) / lensScale(cam.fov)
      const radii = c as unknown as Radii
      radii._spherical.radius *= r
      radii._sphericalEnd.radius *= r
      radii._needsUpdate = true
      cam.fov = next
    }
    const d = c.distance
    const near = Math.max(0.1, d * 0.01)
    const far = Math.max(2000, d * 6)
    if (changed || cam.near !== near || cam.far !== far) {
      cam.near = near
      cam.far = far
      cam.updateProjectionMatrix()
    }
  })

  useEffect(() => {
    const c = controls.current
    if (!c || !cmd) return
    const { view, placement } = latest.current
    const flat = modeOf(useStore.getState().layout) === 'diagram'
    // Offsets below are for a 45° lens; stretch them to the lens in use now.
    const k = lensScale((camera as PerspectiveCamera).fov ?? FOV)

    if (cmd.kind === 'fly') {
      const n = placement.nodes[cmd.id]
      if (!n) return
      const [x, y, z] = n.p
      const off =
        n.frame === 'billboard'
          ? camera.position.clone().sub(new Vector3(x, y, z)).normalize().multiplyScalar(14).toArray()
          : FLY_OFFSET[n.frame]
      c.setLookAt(x + off[0] * k, y + off[1] * k, z + off[2] * k, x, y, z, true)
      return
    }

    // Frame what matters: faded nodes (orbit's outer ring) don't count unless nothing else is shown.
    const all = Object.keys(placement.nodes)
    const lit = all.filter((id) => !placement.nodes[id].faded)
    const ids = cmd.kind === 'frame' ? cmd.ids : lit.length > 1 ? lit : all
    const byId = new Map(view.nodes.map((n) => [n.id, n]))
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (const id of ids) {
      const n = placement.nodes[id]
      const v = byId.get(id)
      if (!n || !v) continue
      const [w, d] = [CARD_W / 2, cardDepth(v) / 2]
      const r = Math.max(w, d)
      const ext = n.frame === 'flat' ? [w, 0, d] : n.frame === 'upright' ? [w, d, 0] : n.frame === 'side' ? [0, d, w] : [r, r, r]
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], n.p[i] - ext[i])
        hi[i] = Math.max(hi[i], n.p[i] + ext[i])
      }
    }
    if (lo[0] === Infinity) return
    const [cx, cy, cz] = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2)
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 10)
    // Aim a little right of center so the side panel doesn't cover the far end of the scene.
    c.setFocalOffset(size * 0.12, 0, 0, true)

    const look = (dx: number, dy: number, dz: number) => c.setLookAt(cx + dx * k, cy + dy * k, cz + dz * k, cx, cy, cz, true)
    if (cmd.kind === 'frame') {
      const dir = camera.position.clone().sub(new Vector3(cx, cy, cz)).normalize()
      dir.multiplyScalar(size * 2)
      look(dir.x, dir.y, dir.z)
    } else if (cmd.preset === 'top') look(0, size * (flat ? 1.2 : 1.8), 0.01)
    else if (cmd.preset === 'iso') look(size * 1.0, size * 1.05, size * 1.3)
    else if (modeOf(useStore.getState().layout) === 'flow') {
      // Slabs face +X and run left to right: look from the front-right so faces read and the row recedes.
      look(size * 0.75, size * 0.45, size * 0.95)
    } else look(0, 0.5, size * 2)
  }, [cmd, camera])

  return <CameraControls ref={controls} makeDefault dollyToCursor smoothTime={0.35} />
}
