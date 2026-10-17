import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  label: ReactNode
  title?: string
  className?: string
  /** Runs each time the menu opens (e.g. to refresh what it lists). */
  onOpen?: () => void
  /** The menu body; `close` dismisses it. */
  children: (close: () => void) => ReactNode
}

/** A toolbar button with a dropdown; closes on an outside click or Escape. */
export function Menu({ label, title, className, onOpen, children }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="menu" ref={root}>
      <button
        className={`${className ?? ''}${open ? ' on' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
