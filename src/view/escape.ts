import type { Layout } from '../model/types'

export interface EscapeInputs {
  pathOpen: boolean
  focusedId: string | null
  lensPipeline: string | null
  time: { open: boolean; span: [number, number] | null }
  layout: Pick<Layout, 'onlyPipeline' | 'onlyLayer'>
}

export type EscapeStep = 'path' | 'focus' | 'lens' | 'span' | 'onlyPipeline' | 'onlyLayer'

/**
 * What one Esc clears: the innermost highlight first (path, then focus, then the pipeline lens), then
 * the timeline's span, then "only this" (pipeline, then layer). Null when there's nothing left.
 */
export function escapeStep(s: EscapeInputs): EscapeStep | null {
  if (s.pathOpen) return 'path'
  if (s.focusedId) return 'focus'
  if (s.lensPipeline) return 'lens'
  if (s.time.open && s.time.span) return 'span'
  if (s.layout.onlyPipeline) return 'onlyPipeline'
  if (s.layout.onlyLayer) return 'onlyLayer'
  return null
}
