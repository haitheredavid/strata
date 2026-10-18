import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Progressive disclosure for a list: how many items to render and the "Show N more" / "Show fewer"
 * toggle to put under it (null when the list fits). A list just over the cap shows whole, since a
 * toggle that reveals one or two rows costs as much room as the rows.
 */
export function useShowMore(total: number, cap: number): [number, ReactNode] {
  const [open, setOpen] = useState(false)
  if (total <= cap + 2) return [total, null]
  const toggle = (
    <button className="link show-more" onClick={() => setOpen(!open)}>
      {open ? 'Show fewer' : `Show ${total - cap} more`}
    </button>
  )
  return [open ? total : cap, toggle]
}
