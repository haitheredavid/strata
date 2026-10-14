import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Line2 } from 'three-stdlib'
import type { Pipeline } from '../model/workflow'
import type { ViewGraph } from '../view/deriveView'
import { runSteps } from '../view/runOrder'
import { nodeCenter } from './curve'
import { writeLine } from './lineBuffer'

/** Placeholder points; useFrame writes the real ends. A stable array so <Line> keeps its geometry. */
const SEGMENT: [number, number, number][] = [[0, 0, 0], [0, 0, 1]]

interface Link { id: string; from: string; to: string; color: string }

/**
 * What starts a pipeline, drawn as faint dotted lines into its first jobs: from the tables a
 * `table_update` trigger watches, or from the last jobs of the pipeline it runs after.
 */
export function TriggerLinks({ view, pipelines, opacity }: { view: ViewGraph; pipelines: Pipeline[]; opacity: number }) {
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
        for (const j of firsts) out.push({ id: `${f}>${j}`, from: f, to: j, color: p.color })
    }
    return out
  }, [view, pipelines])

  return (
    <>
      {links.map((l) => (
        <TriggerLine key={l.id} link={l} opacity={opacity} />
      ))}
    </>
  )
}

function TriggerLine({ link, opacity }: { link: Link; opacity: number }) {
  const line = useRef<Line2>(null)
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), buf: new Float32Array(6) }), [])
  useFrame(() => {
    if (!line.current) return
    const a = nodeCenter(link.from, v.a)
    const b = nodeCenter(link.to, v.b)
    line.current.visible = !!(a && b)
    if (!a || !b) return
    v.buf.set([a.x, a.y, a.z, b.x, b.y, b.z])
    writeLine(line.current, v.buf, true)
  })
  return (
    <Line
      ref={line}
      points={SEGMENT}
      frustumCulled={false}
      color={link.color}
      lineWidth={1}
      dashed
      dashSize={0.15}
      gapSize={0.35}
      transparent
      opacity={0.5 * opacity}
      depthWrite={false}
    />
  )
}
