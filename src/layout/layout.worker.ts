/// <reference lib="webworker" />
import { autoLayout } from './autoLayout'
import { fromWire } from './layoutWire'
import type { LayoutRequest, LayoutResponse } from './layoutWire'

/** Runs `autoLayout` off the main thread; replies with positions packed in table order. */
self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { id, layerGap } = e.data
  const graph = fromWire(e.data)
  const { positions } = autoLayout(graph, layerGap)
  const xz = new Float32Array(graph.tables.length * 2)
  graph.tables.forEach((t, i) => {
    xz[2 * i] = positions[t.id].x
    xz[2 * i + 1] = positions[t.id].z
  })
  const res: LayoutResponse = { id, xz }
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(res, [xz.buffer])
}
