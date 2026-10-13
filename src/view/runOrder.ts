import type { Pipeline } from '../model/workflow'

export interface RunSteps {
  /** Task ids per step; tasks in one step can run in parallel. */
  steps: string[][]
  /** Tasks caught in a dependency cycle (appended as a final step). */
  cyclic: string[]
}

/** Topological layering of a pipeline's tasks by `dependsOn` (deps outside the pipeline are ignored). */
export function runSteps(p: Pick<Pipeline, 'tasks'>): RunSteps {
  const ids = p.tasks.map((t) => t.id)
  const inPipeline = new Set(ids)
  const deps = new Map(p.tasks.map((t) => [t.id, t.dependsOn.filter((d) => inPipeline.has(d) && d !== t.id)]))
  const done = new Set<string>()
  const steps: string[][] = []
  while (done.size < ids.length) {
    const ready = ids.filter((id) => !done.has(id) && deps.get(id)!.every((d) => done.has(d)))
    if (!ready.length) break
    steps.push(ready)
    for (const id of ready) done.add(id)
  }
  const cyclic = ids.filter((id) => !done.has(id))
  if (cyclic.length) steps.push(cyclic)
  return { steps, cyclic }
}
