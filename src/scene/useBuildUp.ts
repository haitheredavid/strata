import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Graph } from '../model/types'
import type { Placement } from '../layout/modes'
import { useStore } from '../store'
import { buildUp, revealed } from '../view/buildUp'
import type { ViewGraph } from '../view/deriveView'
import { lineageDepth } from '../view/lineageDepth'

/** Scene re-renders this often while building up: enough for smooth fades, light on restyling. */
const TICK_MS = 33
const SHOWN = () => 1

export interface BuildUpState {
  /** How far each node has faded in, 0 to 1; always 1 when nothing is building. */
  reveal: (id: string) => number
  /** Progress through the run in [0, 1), or null when nothing is building. */
  progress: number | null
}

/**
 * The build-up after a dataset opens (or a replay): nodes fade in one after another, upstream first
 * (see `buildUp`). The clock starts with the first frame the scene draws, and a click or key press
 * anywhere ends it, showing everything.
 */
export function useBuildUp(view: ViewGraph, placement: Placement, graph: Graph): BuildUpState {
  const run = useStore((s) => s.buildUp)
  const play = useStore((s) => s.playBuildUp)
  // Planned once per run (and per view): placements that move mid-run don't reshuffle the order.
  const plan = useMemo(
    () => (run === null ? null : buildUp(view, lineageDepth(graph), (id) => placement.nodes[id]?.p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, view, graph],
  )
  // A view that changes mid-run (a layout landing) keeps the clock going; the run's length follows it.
  const seconds = useRef(0)
  useEffect(() => {
    seconds.current = plan?.seconds ?? 0
  }, [plan])
  const [tick, setTick] = useState<{ run: number; p: number } | null>(null)

  useEffect(() => {
    if (run === null) return
    const t0 = performance.now()
    let last = -Infinity
    let raf = 0
    const step = (now: number) => {
      const p = (now - t0) / 1000 / seconds.current
      if (p >= 1) return play(false)
      if (now - last >= TICK_MS) {
        last = now
        setTick({ run, p })
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    const skip = () => play(false)
    window.addEventListener('pointerdown', skip, true)
    window.addEventListener('keydown', skip, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', skip, true)
      window.removeEventListener('keydown', skip, true)
    }
  }, [run, play])

  const progress = run === null ? null : tick?.run === run ? tick.p : 0
  const reveal = useCallback((id: string) => (plan && progress !== null ? revealed(plan, id, progress) : 1), [plan, progress])
  return { reveal: progress === null ? SHOWN : reveal, progress }
}
