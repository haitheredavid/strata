import type { ComponentProps } from 'react'
import { Text } from '@react-three/drei'
// troika reads woff/ttf/otf, not woff2. Bundled so scene text never waits on a font CDN.
import { sdfText } from './gpu/renderer'
import INTER from '@fontsource/inter/files/inter-latin-400-normal.woff?url'

/**
 * Scene text in the bundled UI font. Suspends while the font loads, so render it under <Suspense>.
 * Drawn after the instanced card bodies (renderOrder 1) so headers and rows stay on top.
 */
export function Label(props: ComponentProps<typeof Text>) {
  // Scene text comes from SceneText's SDF layer (troika's material is WebGL-only anyway)
  if (sdfText) return null
  return <Text font={INTER} renderOrder={2} {...props} />
}
