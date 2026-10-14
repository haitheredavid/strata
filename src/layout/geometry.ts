import type { Vec2 } from '../model/types'

export const CARD_W = 4
export const HEADER_H = 0.7
export const ROW_H = 0.38

interface Sized { columns: readonly { name: string }[] }

/** Card height along its local Y (world Z when the card lies flat). */
export const cardDepth = (t: Sized) => HEADER_H + t.columns.length * ROW_H

/**
 * Anchor of a column on a card edge, in the card's local frame: card faces +Z, header on top (+Y),
 * rows run down -Y. `side` is -1 (left) or +1 (right). Hidden columns anchor at the header.
 */
export function localAnchor(t: Sized, column: string | undefined, side: number): [number, number, number] {
  return [(side * CARD_W) / 2, anchorY(t, column), 0]
}

/** Local Y of a column's anchor (the header for a hidden column). Fixed per card, so callers cache it. */
export function anchorY(t: Sized, column: string | undefined): number {
  const top = cardDepth(t) / 2
  const i = column ? t.columns.findIndex((c) => c.name === column) : -1
  return i < 0 ? top - HEADER_H / 2 : top - HEADER_H - (i + 0.5) * ROW_H
}

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export function cardRect(t: Sized, pos: Vec2): Rect {
  const d = cardDepth(t)
  return { x0: pos.x - CARD_W / 2, x1: pos.x + CARD_W / 2, z0: pos.z - d / 2, z1: pos.z + d / 2 }
}

export const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1
