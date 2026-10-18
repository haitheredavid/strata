import type { ScopePart } from '../store'
import { hiddenPipelinesOf, layerView, SOURCES } from './deriveView'
import type { ViewInputs } from './deriveView'

/** One active narrowing of the picture, as the scope bar shows it. */
export interface ScopeChip {
  part: ScopePart
  label: string
  /** Longer wording for the tooltip. */
  title: string
}

/**
 * What the picture leaves out, one chip per kind: hidden or "only" domains, folded domains, hidden
 * or "only" pipelines, and tables-only. Empty when everything is shown. Pure.
 */
export function scopeChips(s: ViewInputs): ScopeChip[] {
  const out: ScopeChip[] = []
  const lineage = s.edgeLayer !== 'fk'
  const layers = layerView(s).layers.filter((l) => l.id !== SOURCES)
  const noun = s.groupBy === 'medallion' ? 'layers' : 'domains'
  const only = s.onlyLayer && layers.find((l) => l.id === s.onlyLayer)
  if (only) out.push({ part: 'layers', label: `Only ${only.name}`, title: `Only the ${only.name} ${noun.slice(0, -1)} is shown` })
  else {
    const hidden = new Set(s.hiddenLayers)
    const shown = layers.filter((l) => !hidden.has(l.id)).length
    if (shown < layers.length) out.push({ part: 'layers', label: `${shown} of ${layers.length} ${noun}`, title: `${layers.length - shown} ${noun} hidden` })
  }
  const folded = new Set(s.collapsedLayers)
  const nFolded = layers.filter((l) => folded.has(l.id)).length
  if (nFolded) out.push({ part: 'folded', label: `${nFolded} folded`, title: `${nFolded} ${noun} folded into one card each` })
  if (!lineage) return out

  const pipelines = s.graph.workflows.pipelines
  const onlyP = s.onlyPipeline && pipelines.find((p) => p.id === s.onlyPipeline)
  if (onlyP) out.push({ part: 'pipelines', label: `Only ${onlyP.name}`, title: `Only the ${onlyP.name} pipeline is shown` })
  else {
    const hidden = new Set(hiddenPipelinesOf(s))
    const shown = pipelines.filter((p) => !hidden.has(p.id)).length
    if (shown < pipelines.length) out.push({ part: 'pipelines', label: `${shown} of ${pipelines.length} pipelines`, title: `${pipelines.length - shown} pipelines hidden` })
  }
  if (s.pipelineTablesOnly && pipelines.length)
    out.push({ part: 'tablesOnly', label: 'Tables in shown pipelines', title: 'Tables no shown pipeline reads or writes are left out' })
  return out
}
