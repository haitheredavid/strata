import { WebGPURenderer } from 'three/webgpu'

/**
 * Which renderer the canvas uses, from the URL while the WebGPU path reaches parity:
 * - `?renderer=webgpu`: three's WebGPURenderer (WebGPU, falling back to its WebGL2 backend)
 * - `?renderer=webgl`: WebGPURenderer forced onto its WebGL2 backend
 * - otherwise: the classic WebGLRenderer (drei lines, troika text)
 */
export type RendererKind = 'classic' | 'webgpu' | 'webgl'

export const rendererKind: RendererKind = (() => {
  const v = new URLSearchParams(location.search).get('renderer')
  return v === 'webgpu' || v === 'webgl' ? v : 'classic'
})()

export const nodeRenderer = rendererKind !== 'classic'

/** r3f `gl` factory for the node renderers (undefined keeps r3f's default WebGLRenderer). */
export const createRenderer = nodeRenderer
  ? async (props: { canvas: unknown }) => {
      const r = new WebGPURenderer({
        canvas: props.canvas as HTMLCanvasElement,
        antialias: true,
        forceWebGL: rendererKind === 'webgl',
      })
      await r.init()
      return r
    }
  : undefined

/** Draw calls in the last frame, whichever renderer is running. */
export function lastDrawCalls(info: { render: { calls: number; drawCalls?: number } }) {
  return info.render.drawCalls ?? info.render.calls
}
