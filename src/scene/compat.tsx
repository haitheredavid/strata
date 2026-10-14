import { forwardRef } from 'react'
import type { ComponentProps } from 'react'
import { Line as DreiLine } from '@react-three/drei'
import type { Line2 } from 'three-stdlib'
import { nodeRenderer } from './gpu/renderer'

/**
 * drei's <Line> is built on a WebGL ShaderMaterial, which WebGPURenderer can't draw. Under the node
 * renderer it renders nothing (callers already skip work when their ref is empty) until the
 * instanced curve renderer takes over those lines.
 */
export const Line = forwardRef<Line2, ComponentProps<typeof DreiLine>>(function Line(props, ref) {
  return nodeRenderer ? null : <DreiLine ref={ref} {...props} />
})
