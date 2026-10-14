import { useMemo } from 'react'
import { Color, PlaneGeometry } from 'three'
import type { PlatePlace } from '../../layout/modes'
import type { SceneAnchors } from '../text/anchors'
import { PartBatch } from './PartBatch'
import { Parts } from './parts'

const QUAD = new PlaneGeometry(1, 1)
const tmp = new Color()

/**
 * Every layer plate's translucent body in one draw: a unit quad per plate, scaled to its size and
 * hung off its plate anchor (see AnchorDriver). Drawn first and without depth writes, under the cards.
 */
export function PlateBodies({ plates, anchors, colorOf, opacity }: { plates: PlatePlace[]; anchors: SceneAnchors; colorOf: (id: string) => string; opacity: number }) {
  const parts = useMemo(() => {
    const p = new Parts(plates.length)
    plates.forEach((pl, k) => {
      p.place(k, anchors.plateBase + k, 0, 0, 0, pl.size[0], pl.size[1], 1)
      tmp.set(colorOf(pl.id))
      p.style(k, tmp.r, tmp.g, tmp.b, 0.07 * opacity)
    })
    return p
  }, [plates, anchors, colorOf, opacity])
  return <PartBatch shape={QUAD} parts={parts} anchors={anchors.table} renderOrder={-1} depthWrite={false} />
}
