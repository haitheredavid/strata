import { useEffect, useMemo, useState } from 'react'
import { CARD_W, HEADER_H, ROW_H } from '../layout/geometry'
import type { PlatePlace } from '../layout/modes'
import type { ViewCluster, ViewEdge, ViewNode } from '../view/deriveView'
import { splitName } from '../view/nodes'
import type { World } from '../world/world'
import { span } from '../dev/perf'
import { useStore } from '../store'
import { clusterSpec, KIND_LABEL } from './clusterStyle'
import { EVENT, RACK_GAP, RACK_MAX_SHOWN, RACK_ROW, triggerText } from './labels'
import { isNear, LABEL_PX, onNearChange } from './lod'
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
  /** Lit nodes (the probe, else the scope): their names get callouts while few enough. */
  lit: ReadonlySet<string> | null
  jobVolume: (id: string) => string | undefined
}

const CARD_Z = 0.04 // card group offset plus the label offset the old cards used
const HEADER_SIZE = 0.32
/** More lit nodes than this get no callouts (only the focused and hovered ones do): they would pile up. */
const MAX_CALLOUTS = 12

/**
 * Every label in the scene, built from the view in one pass and drawn by one TextLayer: card
 * headers and medallion letters, column rows on cards near the camera, job and cluster captions,
 * plate names and FK cardinality marks. Anchors: world nodes first, then plates, then two per FK
 * edge (see AnchorDriver). Labels fade in as they grow legible on screen (see LABEL_PX); the
 * focused, hovered and lit nodes' names also get callouts, drawn over everything at a legible
 * size until their own labels are.
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

  const items = useMemo(() => span('textItems', () => {
    void nearVersion
    const out: TextItem[] = []
    const { nodes } = world
    for (let i = 0; i < nodes.count; i++) {
      const id = nodes.ids[i]
      const n = p.nodeById.get(id)
      if (!n) {
        const c = p.clusterById.get(id)
        if (c) clusterText(out, i, c, 1, p.clusterColor(c.cluster.kind))
        continue
      }
      const opacity = 1 // the node's own opacity rides on its anchor (see the effect below)
      if (n.kind === 'job') {
        jobText(out, i, n, opacity, p.pipelineColor(n.pipelineId!))
        continue
      }
      cardText(out, i, n, nodes.size[2 * i + 1] / 2, opacity, isNear(id))
    }
    return out
  }) // `p` members are listed individually; callers pass memoized functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [world, nearVersion, p.nodeById, p.clusterById])

  // Node fades (lens, focus, timeline) write one opacity per anchor instead of rebuilding glyphs.
  const { anchors, nodeById, clusterById, nodeOpacity, clusterOpacity } = p
  useEffect(() => {
    const { nodes } = world
    for (let i = 0; i < nodes.count; i++) {
      const id = nodes.ids[i]
      const c = nodeById.has(id) ? undefined : clusterById.get(id)
      anchors.table.setAlpha(i, c ? clusterOpacity(c) : nodeOpacity(id))
    }
  }, [world, anchors, nodeById, clusterById, nodeOpacity, clusterOpacity])

  // Plate names and FK marks: few, but they follow every placement, so they get their own layer.
  const overlay = useMemo(() => {
    void nearVersion
    const out: TextItem[] = []
    // The focused job's bytes in / out and runs a day, under its name.
    const fi = p.focused ? world.nodes.index.get(p.focused) : undefined
    const volume = fi !== undefined && p.nodeById.get(p.focused!)?.kind === 'job' ? p.jobVolume(p.focused!) : undefined
    if (volume) out.push({ anchor: fi!, x: 0, y: -1.7, z: 0.05, text: volume, size: 0.24, color: '#cbd5e1', opacity: 1, anchorX: 'center', anchorY: 'middle' })
    const { nodes } = world
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, plates, nearVersion, p.fkEdges, p.showFk, p.fkOpacity, p.plateOpacity, p.focused, p.nodeById, p.jobVolume])

  const hovered = useStore((s) => s.hoveredId)
  const { focused, lit, pipelineColor } = p
  const callouts = useMemo(() => {
    const ids = new Set<string>()
    if (focused) ids.add(focused)
    if (hovered) ids.add(hovered)
    if (lit && lit.size <= MAX_CALLOUTS) for (const id of lit) ids.add(id)
    const out: TextItem[] = []
    for (const id of ids) {
      const i = world.nodes.index.get(id)
      const n = nodeById.get(id)
      if (i === undefined || !n) continue
      const job = n.kind === 'job'
      out.push({
        anchor: i,
        x: 0,
        y: 0,
        z: 0.3,
        text: job ? n.name : headerText(n).short,
        size: job ? 0.34 : HEADER_SIZE,
        color: job ? pipelineColor(n.pipelineId!) : '#f8fafc',
        opacity: 1,
        anchorX: 'center',
        anchorY: 'middle',
        minPx: LABEL_PX.callout,
        halo: true,
      })
    }
    return out
  }, [world, nodeById, focused, hovered, lit, pipelineColor])

  if (!atlas) return null
  return (
    <>
      <TextLayer atlas={atlas} anchors={p.anchors.table} items={items} />
      <TextLayer atlas={atlas} anchors={p.anchors.table} items={overlay} />
      <TextLayer atlas={atlas} anchors={p.anchors.table} items={callouts} renderOrder={3} overlay />
    </>
  )
}

/** A card's header text: tables by their last name segment, with the rest as a muted prefix. */
function headerText(n: ViewNode): { short: string; prefix: string } {
  if (n.kind === 'table') return splitName(n.name)
  return { short: n.kind === 'domain' ? n.name.toUpperCase() : n.name, prefix: '' }
}

function cardText(out: TextItem[], anchor: number, n: ViewNode, top: number, opacity: number, rows: boolean) {
  const headerY = top - HEADER_H / 2
  const maxWidth = CARD_W - (n.medallion ? 0.9 : 0.4)
  const { short, prefix } = headerText(n)
  // With a prefix, the name moves up a little and the prefix sits small and muted under it.
  const header = { anchor, x: -CARD_W / 2 + 0.2, z: CARD_Z, color: '#0b0e14', anchorX: 'left', anchorY: 'middle', maxWidth } as const
  if (prefix) {
    out.push({ ...header, y: headerY + 0.09, text: short, size: 0.3, opacity })
    out.push({ ...header, y: headerY - 0.2, text: prefix, size: 0.16, opacity: opacity * 0.6 })
  } else {
    out.push({ ...header, y: headerY, text: short, size: HEADER_SIZE, opacity })
  }
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

function jobText(out: TextItem[], anchor: number, n: ViewNode, opacity: number, color: string) {
  out.push({ anchor, x: 0, y: -1.25, z: 0.05, text: n.name, size: 0.34, color, opacity, anchorX: 'center', anchorY: 'middle' })
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
