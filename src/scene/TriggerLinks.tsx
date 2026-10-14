import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Pipeline } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { runSteps } from '../view/runOrder'
import { nodeCenter } from './curve'
import { CurveBatch } from './curves/CurveBatch'
import { CURVE_WRITE, Curves } from './curves/Curves'

const v = { a: new Vector3(), b: new Vector3() }

interface Link { id: string; from: string; to: string; color: string }

/**
 * What starts a pipeline, drawn as faint dotted lines into its first jobs: from the tables a
 * `table_update` trigger watches, or from the last jobs of the pipeline it runs after. One draw for all.
 */
export function TriggerLinks({ view, pipelines, colorOf, opacity }: { view: ViewGraph; pipelines: Pipeline[]; colorOf: (pipelineId: string) => string; opacity: number }) {
  const links = useMemo(() => {
    const shown = new Set(view.nodes.map((n) => n.id))
    const ends = (p: Pipeline, last: boolean) => {
      const steps = runSteps(p).steps
      return (last ? steps.at(-1) : steps[0])?.map((id) => `job:${id}`) ?? []
    }
    const out: Link[] = []
    for (const p of pipelines) {
      const t = p.trigger
      const firsts = ends(p, false).filter((id) => shown.has(id))
      const from =
        t?.kind === 'table_update' ? t.tables
          : t?.kind === 'job' ? ends(pipelines.find((q) => q.id === t.pipeline) ?? { ...p, tasks: [] }, true)
            : []
      for (const f of from.filter((id) => shown.has(id)))
        for (const j of firsts) out.push({ id: `${f}>${j}`, from: f, to: j, color: colorOf(p.id) })
    }
    return out
  }, [view, pipelines, colorOf])

  const batch = useMemo(() => new CurveBatch(Math.max(16, links.length)), [links.length])
  useFrame(() => {
    batch.resize(links.length)
    links.forEach((l, k) => {
      const a = nodeCenter(l.from, v.a)
      const b = nodeCenter(l.to, v.b)
      batch.setStyle(k, l.color, a && b ? 0.5 * opacity : 0, 1, 0.15, 0.35)
      if (a && b) batch.setSegment(k, a, b)
    })
  }, CURVE_WRITE)

  return <Curves batch={batch} />
}
