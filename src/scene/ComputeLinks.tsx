import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { ComputeLink } from '../view/deriveView'
import { useStore } from '../store'
import { anim } from './anim'
import { nodeCenter } from './curve'
import { CurveBatch } from './curves/CurveBatch'
import { CURVE_WRITE, Curves } from './curves/Curves'

const RACK_TOP = new Vector3(0, 0.35, 0)

interface Props {
  links: ComputeLink[]
  colorOf: (clusterId: string) => string
  opacityOf: (link: ComputeLink) => number
  /** Whether hovering a link's job or cluster brightens it. */
  hoverable: boolean
}

const v = { a: new Vector3(), b: new Vector3(), top: new Vector3() }

/** Jobs to the cluster they run on: thin dotted lines from the job down to the top of the rack, one draw for all. */
export function ComputeLinks({ links, colorOf, opacityOf, hoverable }: Props) {
  const batch = useMemo(() => new CurveBatch(Math.max(16, links.length)), [links.length])
  const styles = useMemo(() => links.map((l) => ({ color: colorOf(l.cluster), opacity: opacityOf(l) })), [links, colorOf, opacityOf])

  useFrame(() => {
    batch.resize(links.length)
    const h = hoverable ? useStore.getState().hoveredTableId : null
    links.forEach((link, k) => {
      const hovered = h !== null && (h === link.job || h === link.cluster)
      const opacity = hovered ? 0.9 : styles[k].opacity
      const a = nodeCenter(link.job, v.a)
      const b = nodeCenter(link.cluster, v.b)
      if (!a || !b || opacity <= 0.01) {
        batch.setStyle(k, styles[k].color, 0, 1)
        return
      }
      batch.setStyle(k, styles[k].color, opacity, opacity > 0.5 ? 1.6 : 1, 0.08, 0.22)
      // Top of the rack, in the rack's own frame: racks billboard, so their up isn't always world +Y
      // (in diagram's top-down view it points along the ground).
      b.add(v.top.copy(RACK_TOP).applyQuaternion(anim.get(link.cluster)!.quat))
      batch.setSegment(k, a, b)
    })
  }, CURVE_WRITE)

  return <Curves batch={batch} />
}
