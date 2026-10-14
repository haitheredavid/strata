import { describe, expect, it } from 'vitest'
import { synthGraph } from '../dev/synth'
import { activeRuns, windowKey } from './runIndex'
import { DAY, simulateDay, taskRunsIn } from './schedule'
import type { Window } from './schedule'

const g = synthGraph({ tables: 400, pipelines: 30, seed: 4 })
const s = simulateDay(g.workflows, g.tables)
const ids = (w: Window) => taskRunsIn(s, w).map((r) => r.id).sort().join()

describe('runIndex', () => {
  it('keys change exactly when the set of runs in a window does', () => {
    expect(s.taskRuns.length).toBeGreaterThan(50)
    let prev: { key: string; ids: string } | null = null
    for (let t = 0; t < DAY; t += 97) {
      for (const w of [[t, t], [Math.max(0, t - 3600), t]] as Window[]) {
        const now = { key: windowKey(s, w), ids: ids(w) }
        if (prev && w[0] !== w[1]) expect(now.key === prev.key).toBe(now.ids === prev.ids)
        if (w[0] !== w[1]) prev = now
      }
    }
  })

  it('point keys track the running set', () => {
    let prev: { key: string; ids: string } | null = null
    for (let t = 0; t < DAY; t += 61) {
      const now = { key: windowKey(s, [t, t]), ids: ids([t, t]) }
      if (prev) expect(now.key === prev.key).toBe(now.ids === prev.ids)
      expect(activeRuns(s, t).map((r) => r.id).sort().join()).toBe(now.ids)
      prev = now
    }
  })
})
