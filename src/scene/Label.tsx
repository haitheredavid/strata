import type { ComponentProps } from 'react'
import { Text } from '@react-three/drei'
// troika reads woff/ttf/otf, not woff2. Bundled so scene text never waits on a font CDN.
import INTER from '@fontsource/inter/files/inter-latin-400-normal.woff?url'

/** Scene text in the bundled UI font. Suspends while the font loads, so render it under <Suspense>. */
export function Label(props: ComponentProps<typeof Text>) {
  return <Text font={INTER} {...props} />
}
