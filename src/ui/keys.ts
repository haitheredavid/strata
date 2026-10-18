import { useEffect } from 'react'
import type { ModeId } from '../model/types'
import { labsOn } from '../labs'
import { useStore } from '../store'
import { showMode } from './select'

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** Number keys: 2D and 3D, then the lab layouts when labs are on. */
const KEY_MODES: ModeId[] = ['diagram', 'flow', 'stack', 'orbit']

/**
 * App-wide keys, ignored while typing: Esc clears one step (see `escapeStep`), or stops presenting
 * first; / jumps to search, T toggles the Day view, S the story, ← / → step through its scenes while
 * it's open, and 1 / 2 pick 2D / 3D (3 / 4 Stack / Orbit with labs).
 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const s = useStore.getState()
      const story = s.layout.story ?? []
      if (e.key === 'Escape') {
        if (s.presenting) s.present(false)
        else s.escape()
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && s.storyOpen && story.length) {
        e.preventDefault()
        const d = e.key === 'ArrowRight' ? 1 : -1
        const next = s.storyAt === null ? (d > 0 ? 0 : story.length - 1) : s.storyAt + d
        if (next >= 0 && next < story.length) s.showScene(next)
      } else if (e.key === 's' || e.key === 'S') s.openStory(!s.storyOpen)
      else if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.toolbar .search input')?.focus()
      } else if (e.key === 't' || e.key === 'T') {
        if (!s.graph.workflows.pipelines.length) return
        if (s.time.open) s.closeTimeline()
        else s.openTimeline()
      } else if (e.key >= '1' && e.key <= (labsOn() ? '4' : '2')) showMode(KEY_MODES[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
