import { useEffect } from 'react'
import { useStore } from '../store'

/** R3F sends no pointerout when a hovered object unmounts, so drop the hover if it was this node. */
export function useReleaseHover(id: string) {
  useEffect(
    () => () => {
      const s = useStore.getState()
      if (s.hoveredTableId === id) s.hover(null)
    },
    [id],
  )
}
