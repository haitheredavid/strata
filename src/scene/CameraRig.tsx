import { useEffect, useLayoutEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import CameraControlsImpl from 'camera-controls'
import { Vector3 } from 'three'
import { CARD_W, cardDepth } from '../layout/geometry'
import type { Frame, Placement } from '../layout/modes'
import type { ViewGraph } from '../view/deriveView'
import { modeOf, useStore } from '../store'

const { ACTION } = CameraControlsImpl

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
  const overCard = useStore((s) => s.hoveredTableId !== null || s.dragging)
  // Commands run against the placement of the render that issued them.
  const latest = useRef({ view, placement })
  useLayoutEffect(() => {
    latest.current = { view, placement }
  }, [view, placement])

  // Left-drag on a card moves the card, so stop it from also orbiting the camera.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.mouseButtons.left = overCard ? ACTION.NONE : ACTION.ROTATE
    c.touches.one = overCard ? ACTION.NONE : ACTION.TOUCH_ROTATE
  }, [overCard])

  useEffect(() => {
    const c = controls.current
    if (!c || !cmd) return
    const { view, placement } = latest.current

    if (cmd.kind === 'fly') {
      const n = placement.nodes[cmd.tableId]
      if (!n) return
      const [x, y, z] = n.p
      const off =
        n.frame === 'billboard'
          ? camera.position.clone().sub(new Vector3(x, y, z)).normalize().multiplyScalar(14).toArray()
          : FLY_OFFSET[n.frame]
      c.setLookAt(x + off[0], y + off[1], z + off[2], x, y, z, true)
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

    if (cmd.kind === 'frame') {
      const dir = camera.position.clone().sub(new Vector3(cx, cy, cz)).normalize().multiplyScalar(size * 2)
      c.setLookAt(cx + dir.x, cy + dir.y, cz + dir.z, cx, cy, cz, true)
    } else if (cmd.preset === 'iso') c.setLookAt(cx + size * 1.0, cy + size * 1.05, cz + size * 1.3, cx, cy, cz, true)
    else if (cmd.preset === 'top') c.setLookAt(cx, cy + size * 1.8, cz + 0.01, cx, cy, cz, true)
    else if (modeOf(useStore.getState().layout) === 'flow') {
      // Slabs face +X and run left to right: look from the front-right so faces read and the row recedes.
      c.setLookAt(cx + size * 0.75, cy + size * 0.45, cz + size * 0.95, cx, cy, cz, true)
    } else c.setLookAt(cx, cy + 0.5, cz + size * 2, cx, cy, cz, true)
  }, [cmd, camera])

  return <CameraControls ref={controls} makeDefault dollyToCursor smoothTime={0.35} />
}
