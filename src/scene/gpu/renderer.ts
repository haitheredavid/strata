import { WebGPURenderer } from 'three/webgpu'

/**
 * The canvas renders with three's WebGPURenderer: WebGPU where the browser has it, else its WebGL2
 * backend. `?renderer=webgl` forces the WebGL2 backend (to compare, or to work around a driver).
 */
export const forceWebGL = /[?&]renderer=webgl\b/.test(location.search)

/** r3f `gl` factory. */
export async function createRenderer(props: { canvas: unknown }) {
  const r = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: true, forceWebGL })
  await r.init()
  return r
}

/**
 * WebGPURenderer's draw call counter runs across frames; this turns it into draws in the last frame
 * (call once per frame, e.g. from the HUD's timer, which reads the latest completed frame).
 */
export function drawCallsCounter() {
  let lastTotal = 0
  let lastFrame = -1
  let perFrame = 0
  return (info: { render: { drawCalls: number; frame: number } }) => {
    const { drawCalls, frame } = info.render
    if (frame !== lastFrame) {
      const frames = Math.max(1, frame - lastFrame)
      perFrame = lastFrame < 0 ? 0 : Math.round((drawCalls - lastTotal) / frames)
      lastTotal = drawCalls
      lastFrame = frame
    }
    return perFrame
  }
}
