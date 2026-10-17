import type { Graph, Vec2 } from '../model/types'
import { autoLayout } from './autoLayout'
import { toWire } from './layoutWire'
import type { LayoutResponse } from './layoutWire'

type Layouter = (graph: Graph, layerGap: number) => Promise<Record<string, Vec2> | null>

/**
 * `autoLayout` positions computed in a worker of its own. Each request resolves with null when a newer
 * request on the same channel superseded it (only the latest matters); a superseded job still running is
 * stopped by replacing the worker, so a quick second request doesn't wait behind the first. Falls back
 * to the main thread when workers are unavailable (tests, old browsers).
 */
function layoutChannel(): Layouter {
  let worker: Worker | null = null
  let nextId = 1
  let latest = 0
  const waiting = new Map<number, (r: LayoutResponse) => void>()

  const getWorker = (): Worker | null => {
    if (worker) return worker
    if (typeof Worker === 'undefined') return null
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      return null
    }
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
    return worker
  }

  return (graph, layerGap) => {
    const id = nextId++
    latest = id
    if (worker && waiting.size) {
      worker.terminate()
      worker = null
      for (const settle of waiting.values()) settle({ id: -1, xz: new Float32Array(0) })
      waiting.clear()
    }
    const w = getWorker()
    if (!w) return Promise.resolve(autoLayout(graph, layerGap).positions)
    return new Promise((resolve) => {
      waiting.set(id, ({ id: done, xz }) => {
        if (done !== id || id !== latest) return resolve(null)
        const positions: Record<string, Vec2> = {}
        graph.tables.forEach((t, i) => (positions[t.id] = { x: xz[2 * i], z: xz[2 * i + 1] }))
        resolve(positions)
      })
      const req = toWire(id, graph, layerGap)
      w.postMessage(req, [req.columnCounts.buffer, req.refs.buffer])
    })
  }
}

/** A loaded dataset's fresh layout. */
export const layoutAsync = layoutChannel()

/** A filtered view's own layout (a stack of the tables in visible pipelines); never supersedes a load's. */
export const viewLayoutAsync = layoutChannel()
