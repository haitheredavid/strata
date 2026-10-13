import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ComputeLink } from '../view/deriveView'
import { nodeCenter } from './curve'

interface Props {
  links: ComputeLink[]
  colorOf: (clusterId: string) => string
  opacityOf: (link: ComputeLink) => number
}

/** Jobs to the cluster they run on: thin dotted lines from the job down to the top of the rack. */
export function ComputeLinks({ links, colorOf, opacityOf }: Props) {
  return (
    <>
      {links.map((l) => (
        <ComputeLine key={l.id} link={l} color={colorOf(l.cluster)} opacity={opacityOf(l)} />
      ))}
    </>
  )
}

function ComputeLine({ link, color, opacity }: { link: ComputeLink; color: string; opacity: number }) {
  const line = useRef<Line2>(null)
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), buf: new Float32Array(6) }), [])
  useFrame(() => {
    if (!line.current) return
    const a = nodeCenter(link.job, v.a)
    const b = nodeCenter(link.cluster, v.b)
    line.current.visible = !!(a && b) && opacity > 0.01
    if (!a || !b) return
    b.y += 0.35 // top of the rack
    v.buf.set([a.x, a.y, a.z, b.x, b.y, b.z])
    line.current.geometry.setPositions(v.buf)
    line.current.computeLineDistances()
  })
  return (
    <Line
      ref={line}
      points={[[0, 0, 0], [0, 0, 1]]}
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
}
