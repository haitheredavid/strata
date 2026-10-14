import { useEffect, useMemo, useState } from 'react'
import { CARD_W, HEADER_H, ROW_H } from '../layout/geometry'
import type { PlatePlace } from '../layout/modes'
import type { ViewCluster, ViewEdge, ViewNode } from '../view/deriveView'
import type { World } from '../world/world'
import { clusterSpec, KIND_LABEL } from './clusterStyle'
import { EVENT, RACK_GAP, RACK_MAX_SHOWN, RACK_ROW, triggerText } from './labels'
import { isNear, onNearChange } from './lod'
import type { SceneAnchors } from './text/anchors'
import { loadAtlas } from './text/atlas'
import type { Atlas } from './text/atlas'
import { TextLayer } from './text/TextLayer'
import type { TextItem } from './text/TextLayer'

interface Props {
  world: World
  plates: PlatePlace[]
  anchors: SceneAnchors
  /** View edges in `world.fk` order and base opacity per edge. */
  fkEdges: ViewEdge[]
  fkOpacity: (k: number) => number
  showFk: boolean
  nodeById: Map<string, ViewNode>
  clusterById: Map<string, ViewCluster>
  nodeOpacity: (id: string) => number
  clusterOpacity: (c: ViewCluster) => number
  plateOpacity: number
  layerColor: (id: string) => string
  pipelineColor: (id: string) => string
  clusterColor: (kind: ViewCluster['cluster']['kind']) => string
  /** Focused node: jobs show their volume line while highlighted. */
  focused: string | null
  jobVolume: (id: string) => string | undefined
}

const CARD_Z = 0.04 // card group offset plus the label offset the old cards used

/**
 * Every label in the scene, built from the view in one pass and drawn by one TextLayer: card
 * headers and medallion letters, column rows on cards near the camera, job and cluster captions,
 * plate names and FK cardinality marks. Anchors: world nodes first, then plates, then two per FK
 * edge (see AnchorDriver).
 */
export function SceneText(p: Props) {
  const [atlas, setAtlas] = useState<Atlas | null>(null)
  useEffect(() => {
    let live = true
    void loadAtlas().then((a) => live && setAtlas(a))
    return () => {
      live = false
    }
  }, [])
  const [nearVersion, setNearVersion] = useState(0)
  useEffect(() => onNearChange(() => setNearVersion((v) => v + 1)), [])

  const { world, plates } = p
  const { plateBase, fkBase } = p.anchors

  const items = useMemo(() => {
    void nearVersion
    const out: TextItem[] = []
    const { nodes } = world
    for (let i = 0; i < nodes.count; i++) {
      const id = nodes.ids[i]
      const n = p.nodeById.get(id)
      if (!n) {
        const c = p.clusterById.get(id)
        if (c) clusterText(out, i, c, p.clusterOpacity(c), p.clusterColor(c.cluster.kind))
        continue
      }
      const opacity = p.nodeOpacity(id)
      if (n.kind === 'job') {
        jobText(out, i, n, opacity, p.pipelineColor(n.pipelineId!), id === p.focused ? p.jobVolume(id) : undefined)
        continue
      }
      cardText(out, i, n, nodes.size[2 * i + 1] / 2, opacity, isNear(id))
    }
    plates.forEach((pl, k) => {
      const [w, h] = pl.size
      out.push({
        anchor: plateBase + k,
        x: -w / 2 + 0.5,
        y: pl.frame === 'flat' ? -h / 2 + 0.6 : h / 2 - 0.7,
        z: 0.02,
        text: pl.label.toUpperCase(),
        size: 0.7,
        color: p.layerColor(pl.id),
        opacity: p.plateOpacity,
        anchorX: 'left',
        anchorY: 'middle',
      })
    })
    if (p.showFk)
      p.fkEdges.forEach((e, k) => {
        if (!isNear(nodes.ids[world.fk.src[k]]) && !isNear(nodes.ids[world.fk.dst[k]])) return
        const [fromCard, , toCard] = e.kind
        const opacity = p.fkOpacity(k) * (e.count > 1 ? 1 : 0.9)
        const mark = (anchor: number, text: string) =>
          out.push({ anchor, x: 0, y: 0, z: 0, text, size: 0.2, color: '#ffffff', opacity, anchorX: 'center', anchorY: 'bottom' })
        mark(fkBase + 2 * k, fromCard === 'n' ? 'N' : '1')
        mark(fkBase + 2 * k + 1, (toCard === 'n' ? 'N' : '1') + (e.count > 1 ? `  ×${e.count}` : ''))
      })
    return out
    // `p` members are listed individually; callers pass memoized functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, plates, nearVersion, p.fkEdges, p.showFk, p.nodeById, p.clusterById, p.nodeOpacity, p.clusterOpacity, p.plateOpacity, p.focused])

  return atlas ? <TextLayer atlas={atlas} anchors={p.anchors.table} items={items} /> : null
}

function cardText(out: TextItem[], anchor: number, n: ViewNode, top: number, opacity: number, rows: boolean) {
  const headerY = top - HEADER_H / 2
  out.push({
    anchor,
    x: -CARD_W / 2 + 0.2,
    y: headerY,
    z: CARD_Z,
    text: n.kind === 'domain' ? n.name.toUpperCase() : n.name,
    size: 0.32,
    color: '#0b0e14',
    opacity,
    anchorX: 'left',
    anchorY: 'middle',
    maxWidth: CARD_W - (n.medallion ? 0.9 : 0.4),
  })
  if (n.medallion)
    out.push({ anchor, x: CARD_W / 2 - 0.32, y: headerY, z: CARD_Z + 0.012, text: n.medallion[0].toUpperCase(), size: 0.22, color: '#0b0e14', opacity, anchorX: 'center', anchorY: 'middle' })
  if (!rows) return
  n.columns.forEach((c, i) => {
    const y = top - HEADER_H - (i + 0.5) * ROW_H
    const badge = c.pk ? 'PK' : c.fk ? 'FK' : ''
    out.push({
      anchor,
      x: -CARD_W / 2 + 0.2,
      y,
      z: CARD_Z,
      text: badge ? `${c.name}  ·${badge}` : c.name,
      size: 0.22,
      color: c.pk ? '#f5c542' : c.fk ? '#9ecbff' : '#d7dce5',
      opacity,
      anchorX: 'left',
      anchorY: 'middle',
    })
    out.push({ anchor, x: CARD_W / 2 - 0.2, y, z: CARD_Z, text: c.type, size: 0.2, color: '#7d8799', opacity, anchorX: 'right', anchorY: 'middle' })
  })
}

function jobText(out: TextItem[], anchor: number, n: ViewNode, opacity: number, color: string, volume: string | undefined) {
  out.push({ anchor, x: 0, y: -1.25, z: 0.05, text: n.name, size: 0.34, color, opacity, anchorX: 'center', anchorY: 'middle' })
  if (volume) out.push({ anchor, x: 0, y: -1.7, z: 0.05, text: volume, size: 0.24, color: '#cbd5e1', opacity, anchorX: 'center', anchorY: 'middle' })
  if (n.trigger) out.push({ anchor, x: 0, y: 1.55, z: 0.05, text: triggerText(n.trigger), size: 0.26, color: '#cbd5e1', opacity, anchorX: 'center', anchorY: 'middle' })
  if (n.emits?.length) out.push({ anchor, x: 1.45 + 0.42, y: 0.95, z: 0.1, text: n.emits.join(', '), size: 0.24, color: EVENT, opacity, anchorX: 'left', anchorY: 'middle' })
}

function clusterText(out: TextItem[], anchor: number, vc: ViewCluster, opacity: number, color: string) {
  const c = vc.cluster
  const bottom = -(Math.min(RACK_MAX_SHOWN, c.workers.max) + 1) * (RACK_ROW + RACK_GAP)
  out.push({ anchor, x: 0, y: 0.55, z: 0.3, text: KIND_LABEL[c.kind], size: 0.2, color, opacity, anchorX: 'center', anchorY: 'bottom' })
  out.push({ anchor, x: 0, y: bottom - 0.15, z: 0.3, text: c.name, size: 0.32, color: '#e2e8f0', opacity, anchorX: 'center', anchorY: 'top' })
  out.push({ anchor, x: 0, y: bottom - 0.6, z: 0.3, text: clusterSpec(c), size: 0.22, color: '#94a3b8', opacity, anchorX: 'center', anchorY: 'top' })
}
