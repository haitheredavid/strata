import { WebGPURenderer } from 'three/webgpu'

/**
 * The canvas renders with three's WebGPURenderer: WebGPU where the browser has it, else its WebGL2
 * backend. `?renderer=webgl` forces the WebGL2 backend (to compare, or to work around a driver).
 */
export const forceWebGL = /[?&]renderer=webgl\b/.test(location.search)

/** Optional features three can use; anything else the adapter offers is left off the device. */
const WANTED = ['float32-filterable', 'timestamp-query', 'depth32float-stencil8', 'core-features-and-limits'] as GPUFeatureName[]

/**
 * Our own WebGPU device. three asks for a `compatibility` adapter and then requires every feature
 * the adapter lists; Firefox answers the first with a core adapter and can reject the second, which
 * three swallows by falling back to WebGL2. A plain adapter and only the features three uses keeps
 * Firefox on WebGPU, and when it does fail the console says why.
 */
async function gpuDevice(): Promise<GPUDevice | undefined> {
  if (forceWebGL || typeof navigator === 'undefined' || !navigator.gpu) return undefined
  // Each attempt asks for a fresh adapter: a lost one can't make devices. Firefox can hand back an
  // adapter whose device is already lost (e.g. the discrete GPU on a dual-GPU Mac, or a GPU process
  // left bad by an earlier failure), so fall back to the default GPU, then to no optional features.
  const attempts: { adapter: GPURequestAdapterOptions; features: boolean }[] = [
    { adapter: { powerPreference: 'high-performance' }, features: true },
    { adapter: {}, features: true },
    { adapter: {}, features: false },
  ]
  for (const { adapter: options, features } of attempts) {
    try {
      const adapter = await navigator.gpu.requestAdapter(options)
      if (!adapter) continue
      const requiredFeatures = features ? WANTED.filter((f) => adapter.features.has(f)) : []
      const device = await adapter.requestDevice({ requiredFeatures })
      void device.lost.then((info) => console.warn(`[strata] WebGPU device lost (${info.reason}): ${info.message}`))
      return device
    } catch (e) {
      console.warn(`[strata] WebGPU device request failed (${JSON.stringify(options)}, features: ${features}):`, e)
    }
  }
  console.warn('[strata] no usable WebGPU device; using the WebGL2 backend')
  return undefined
}

/** r3f `gl` factory. */
export async function createRenderer(props: { canvas: unknown }) {
  const device = await gpuDevice()
  const r = new WebGPURenderer({
    canvas: props.canvas as HTMLCanvasElement,
    antialias: true,
    // No device (unsupported or refused): take three's WebGL2 path directly.
    forceWebGL: forceWebGL || !device,
    device,
  })
  await r.init()
  const backend = r.backend as unknown as { isWebGPUBackend?: boolean }
  console.info(`[strata] renderer: ${backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 backend'}`)
  return r
}

/**
 * WebGPURenderer's draw call counter runs across frames; this turns it into draws in the last frame
 * (call once per frame, e.g. from the HUD's timer, which reads the latest completed frame). The
 * WebGL2 backend may report only `calls`.
 */
export function drawCallsCounter() {
  let lastTotal = 0
  let lastFrame = -1
  let perFrame = 0
  return (info: { render: { drawCalls?: number; calls: number; frame?: number } }) => {
    const total = info.render.drawCalls ?? info.render.calls
    const frame = info.render.frame ?? 0
    if (frame !== lastFrame) {
      const frames = Math.max(1, frame - lastFrame)
      perFrame = lastFrame < 0 ? 0 : Math.round((total - lastTotal) / frames)
      lastTotal = total
      lastFrame = frame
    }
    return perFrame
  }
}
