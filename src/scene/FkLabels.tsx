import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { useStore } from '../store'
import type { ViewEdge } from '../view/deriveView'
import type { FkCurves } from '../world/fkEdges'
import type { World } from '../world/world'
import { Label } from './Label'
import { isNear, onNearChange } from './lod'

/** Troika text mesh: fillOpacity is applied at render time, so it can be set without a re-render. */
type TextMesh = Mesh & { fillOpacity: number }

interface Props {
  world: World
  curves: FkCurves
  /** View edges in `world.fk` order. */
  edges: ViewEdge[]
  /** opacity, width per edge (as given to FkEdges). */
  style: Float32Array
  hoverable: boolean
}

/**
 * Cardinality labels ("1" / "N", "×count" for merged refs) at the ends of FK wires. Text is a draw
 * call per label, so only wires touching a card near enough to read (see lod.ts) get them.
 */
export function FkLabels({ world, curves, edges, style, hoverable }: Props) {
  const [version, setVersion] = useState(0)
  useEffect(() => onNearChange(() => setVersion((v) => v + 1)), [])
  const shown = useMemo(() => {
    void version
    const ks: number[] = []
    for (let k = 0; k < world.fk.count; k++)
      if (isNear(world.nodes.ids[world.fk.src[k]]) || isNear(world.nodes.ids[world.fk.dst[k]])) ks.push(k)
    return ks
  }, [world, version])
  const meshes = useRef(new Map<number, TextMesh>())

  useFrame(({ camera }) => {
    const h = hoverable ? useStore.getState().hoveredTableId : null
    for (const k of shown) {
      const e = edges[k]
      const touch = h !== null && (h === e.from || h === e.to)
      const base = touch ? 1 : h !== null ? 0.3 : style[2 * k]
      const opacity = base * (e.count > 1 ? 1 : 0.9)
      for (let end = 0; end < 2; end++) {
        const m = meshes.current.get(2 * k + end)
        if (!m) continue
        m.position.fromArray(curves.labels, 6 * k + 3 * end)
        m.quaternion.copy(camera.quaternion)
        m.fillOpacity = opacity
      }
    }
  })

  const ref = (slot: number) => (m: TextMesh | null) => {
    if (m) meshes.current.set(slot, m)
    else meshes.current.delete(slot)
  }

  return (
    <>
      {shown.map((k) => {
        const e = edges[k]
        const [fromCard, , toCard] = e.kind
        return (
          <group key={e.id}>
            <Label ref={ref(2 * k)} fontSize={0.2} color="#ffffff" anchorX="center" anchorY="bottom" raycast={() => null}>
              {fromCard === 'n' ? 'N' : '1'}
            </Label>
            <Label ref={ref(2 * k + 1)} fontSize={0.2} color="#ffffff" anchorX="center" anchorY="bottom" raycast={() => null}>
              {(toCard === 'n' ? 'N' : '1') + (e.count > 1 ? `  ×${e.count}` : '')}
            </Label>
          </group>
        )
      })}
    </>
  )
}
