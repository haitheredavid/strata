import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { StatsGl } from '@react-three/drei'
import { installFrameClock, lastFrame } from './frames'
import { lastSpans } from './perf'
import { drawCallsCounter } from '../scene/gpu/renderer'

/** Dev overlay: stats-gl (FPS / CPU / GPU) plus draw calls, geometry counts, frame work and recent spans. */
export function PerfHud() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    installFrameClock()
    const drawCalls = drawCallsCounter()
    const el = document.createElement('pre')
    el.className = 'perf-hud'
    document.body.appendChild(el)
    // Text refresh on a timer, not per frame, so the HUD itself stays off the profile.
    const id = setInterval(() => {
      const { render, memory } = gl.info
      const spans = lastSpans()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 8)
        .map((s) => `${s.name.padEnd(16)} ${s.ms.toFixed(1).padStart(7)}ms`)
      el.textContent = [
        `calls ${drawCalls(gl.info as never)}  tris ${render.triangles}`,
        `geo ${memory.geometries}  tex ${memory.textures}`,
        `frame work ${lastFrame.work.toFixed(1)}ms  interval ${lastFrame.interval.toFixed(1)}ms`,
        ...spans,
      ].join('\n')
    }, 250)
    return () => {
      clearInterval(id)
      el.remove()
    }
  }, [gl])

  return <StatsGl className="perf-stats" trackGPU />
}
