import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import type { PlatePlace } from '../../layout/modes'
import type { FkCurves } from '../../world/fkEdges'
import { packOnce } from '../../world/world'
import type { World } from '../../world/world'
import { anim, plateKey } from '../anim'
import type { SceneAnchors } from './anchors'

const pos = new Vector3()
const quat = new Quaternion()

/** Keeps the anchor table in step with the animated scene: moved nodes, plates and (optionally) FK label points. */
export function AnchorDriver({ world, plates, anchors, fkCurves, fk }: { world: World; plates: PlatePlace[]; anchors: SceneAnchors; fkCurves: FkCurves; fk: boolean }) {
  useFrame(({ camera }) => {
    const { table, plateBase, fkBase } = anchors
    if (packOnce(world)) table.copy(world.nodes.pos, world.nodes.quat, world.dirty.lo, world.dirty.hi)
    plates.forEach((pl, k) => {
      const e = anim.get(plateKey(pl.id))
      if (e) table.set(plateBase + k, e.pos, e.quat)
    })
    if (fk)
      for (let k = 0; k < world.fk.count; k++)
        for (let end = 0; end < 2; end++) table.set(fkBase + 2 * k + end, pos.fromArray(fkCurves.labels, 6 * k + 3 * end), quat.copy(camera.quaternion))
    table.flush()
  })
  return null
}
