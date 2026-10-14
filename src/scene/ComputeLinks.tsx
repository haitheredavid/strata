import { memo, useMemo, useRef } from 'react'
import { Line } from './compat'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ComputeLink } from '../view/deriveView'
import { useStore } from '../store'
import { anim } from './anim'
import { nodeCenter } from './curve'
import { writeLine } from './lineBuffer'

const RACK_TOP = new Vector3(0, 0.35, 0)
/** Placeholder points; useFrame writes the real ends. A stable array so <Line> keeps its geometry. */
const SEGMENT: [number, number, number][] = [[0, 0, 0], [0, 0, 1]]

interface Props {
  links: ComputeLink[]
  colorOf: (clusterId: string) => string
  opacityOf: (link: ComputeLink) => number
  /** Whether hovering a link's job or cluster brightens it. */
  hoverable: boolean
}

/** Jobs to the cluster they run on: thin dotted lines from the job down to the top of the rack. */
export function ComputeLinks({ links, colorOf, opacityOf, hoverable }: Props) {
  return (
    <>
      {links.map((l) => (
        <ComputeLine key={l.id} link={l} color={colorOf(l.cluster)} opacity={opacityOf(l)} hoverable={hoverable} />
      ))}
    </>
  )
}

const ComputeLine = memo(function ComputeLine({ link, color, opacity: base, hoverable }: { link: ComputeLink; color: string; opacity: number; hoverable: boolean }) {
  const hovered = useStore((s) => hoverable && (s.hoveredTableId === link.job || s.hoveredTableId === link.cluster))
  const opacity = hovered ? 0.9 : base
  const line = useRef<Line2>(null)
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), top: new Vector3(), buf: new Float32Array(6) }), [])
  useFrame(() => {
    if (!line.current) return
    const a = nodeCenter(link.job, v.a)
    const b = nodeCenter(link.cluster, v.b)
    line.current.visible = !!(a && b) && opacity > 0.01
    if (!a || !b) return
    // Top of the rack, in the rack's own frame: racks billboard, so their up isn't always world +Y
    // (in diagram's top-down view it points along the ground).
    b.add(v.top.copy(RACK_TOP).applyQuaternion(anim.get(link.cluster)!.quat))
    a.toArray(v.buf, 0)
    b.toArray(v.buf, 3)
    writeLine(line.current, v.buf, true)
  })
  return (
    <Line
      ref={line}
      points={SEGMENT}
      frustumCulled={false}
      color={color}
      lineWidth={opacity > 0.5 ? 1.6 : 1}
      dashed
      dashSize={0.08}
      gapSize={0.22}
      transparent
      opacity={opacity}
      depthWrite={false}
    />
  )
})
