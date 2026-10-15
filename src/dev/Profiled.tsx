import { Profiler } from 'react'
import type { ReactNode } from 'react'
import { record } from './perf'

/** React render time of a subtree, recorded as a `render:<id>` span on every commit it takes part in. */
export function Profiled({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={(_, __, actual, ___, start) => record(`render:${id}`, actual, start)}>
      {children}
    </Profiler>
  )
}
