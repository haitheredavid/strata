import { useEffect } from 'react'
import { MODE_IDS } from '../layout/modes'
import { useStore } from '../store'

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/**
 * App-wide keys, ignored while typing: Esc clears one step (see `escapeStep`), / jumps to search,
 * T toggles the timeline, 1–4 switch layout mode.
 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const s = useStore.getState()
      if (e.key === 'Escape') s.escape()
      else if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.toolbar .search input')?.focus()
      } else if (e.key === 't' || e.key === 'T') {
        if (!s.graph.workflows.pipelines.length) return
        if (s.time.open) s.closeTimeline()
        else s.openTimeline()
      } else if (e.key >= '1' && e.key <= String(MODE_IDS.length)) s.setMode(MODE_IDS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
