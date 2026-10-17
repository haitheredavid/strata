import type { ModeId } from './model/types'

const KEY = 'strata:labs'

/** Layouts kept for exploration but not part of the product: offered only with labs on. */
export const LAB_MODES: ReadonlySet<ModeId> = new Set(['stack', 'orbit'])

// `?labs` turns labs on and `?labs=0` off; either is remembered for later visits.
try {
  const param = new URLSearchParams(location.search).get('labs')
  if (param !== null) localStorage.setItem(KEY, param === '0' ? '0' : '1')
} catch {
  /* no location or storage (tests, private mode): labs stays as stored, else off */
}

/** Whether experimental layouts (Stack, Orbit) are offered. */
export function labsOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
