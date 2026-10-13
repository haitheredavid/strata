import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { MODES } from '../layout/modes'
import type { Ring } from '../layout/modes'
import { modeOf, scheduleFor, useStore } from '../store'
import { AnimDriver } from './anim'
import { CameraRig } from './CameraRig'
import { LayerPlate } from './LayerPlate'
import { TableCard } from './TableCard'
import { useSceneModel } from './usePlacement'
import type { SceneModel } from './usePlacement'
import { Wire } from './Wire'
import { FlowWire } from './FlowWire'
import { JobNode } from './JobNode'
import type { RunState } from './JobNode'
import { Lanes } from './Lanes'
import { Pulses } from './Pulses'
import { TimeDriver } from './TimeDriver'
import { TriggerLinks } from './TriggerLinks'

const DIM = 0.1
const FADED = 0.35

export function Scene() {
  const focus = useStore((s) => s.focus)
  const model = useSceneModel()

  return (
    <Canvas
      camera={{ position: [30, 30, 40], fov: 45, near: 0.5, far: 2000 }}
      dpr={[1, 2]}
      onPointerMissed={() => !useStore.getState().dragging && focus(null)}
    >
      <color attach="background" args={['#0b0e14']} />
      <CameraRig view={model.view} placement={model.placement} />
      <AnimDriver placement={model.placement} />
      <Diagram model={model} />
      {import.meta.env.DEV && <DevHandle />}
    </Canvas>
  )
}

function Diagram({ model }: { model: SceneModel }) {
  const { view, placement, reach, lit, time } = model
  const graph = useStore((s) => s.graph)
  const hovered = useStore((s) => s.hoveredTableId)
  const focused = useStore((s) => s.focusedTableId)
  const mode = useStore((s) => MODES[modeOf(s.layout)])
  const edgeLayer = useStore((s) => s.layout.edgeLayer ?? 'both')
  const pipelines = useStore((s) => s.graph.workflows.pipelines)

  const layerById = useMemo(() => new Map(view.layers.map((l) => [l.id, l])), [view])
  const nodeById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view])
  const colorOf = useMemo(() => {
    const m = new Map(pipelines.map((p) => [p.id, p.color]))
    return (id: string) => m.get(id) ?? '#ffffff'
  }, [pipelines])
  const shownPipelines = useMemo(
    () => pipelines.filter((p) => view.flows.some((f) => f.pipelineId === p.id)),
    [pipelines, view],
  )
  const lens = lit?.nodes ?? (reach ? new Set(reach.keys()) : null)
  const litPipelines = lit?.flows.size ? new Set(view.flows.filter((f) => lit.flows.has(f.id)).map((f) => f.pipelineId)) : null

  const nodeOpacity = (id: string) => {
    if (time) {
      if (time.active.has(id)) return 1
      if (time.done.has(id)) return 0.8
      if (time.reached.has(id)) return 1
      return lit?.nodes.has(id) ? 0.35 : DIM
    }
    if (lens) return lens.has(id) ? 1 : DIM
    return placement.nodes[id]?.faded ? FADED : 1
  }
  const runState = (id: string): RunState =>
    !time ? null : time.active.has(id) ? 'active' : time.done.has(id) ? 'done' : 'pending'
  const lineageActive = view.flows.length > 0

  return (
    <>
      {placement.plates.map((pl) => (
        <LayerPlate key={pl.id} plate={pl} opacity={lens ? 0.4 : 1} />
      ))}

      {placement.rings?.map((r, i) => <RingLine key={i} ring={r} />)}

      {view.nodes.map((n) => {
        const place = placement.nodes[n.id]
        if (!place) return null
        const highlighted = n.id === hovered || n.id === focused
        if (n.kind === 'job')
          return (
            <JobNode
              key={n.id}
              node={n}
              color={colorOf(n.pipelineId!)}
              opacity={nodeOpacity(n.id)}
              highlighted={highlighted}
              runState={runState(n.id)}
            />
          )
        return (
          <TableCard
            key={n.id}
            node={n}
            place={place}
            color={layerById.get(n.layerId)!.color}
            opacity={nodeOpacity(n.id)}
            highlighted={highlighted || !!time?.reached.has(n.id)}
            draggable={mode.draggable}
          />
        )
      })}

      {edgeLayer !== 'lineage' &&
        view.edges.map((e) => {
          const a = nodeById.get(e.from)!
          const b = nodeById.get(e.to)!
          const pa = placement.nodes[a.id]
          const pb = placement.nodes[b.id]
          if (!pa || !pb) return null
          const touches = (id: string | null) => id !== null && (e.from === id || e.to === id)
          let opacity: number
          let active: boolean
          if (lit) {
            active = lit.edges.has(e.id)
            opacity = active ? 1 : 0.04
          } else if (reach) {
            active = reach.has(e.from) && reach.has(e.to)
            opacity = active ? 1 : 0.05
          } else {
            active = touches(hovered)
            // Step FK refs back when lineage is on so data flow reads first.
            const base = lineageActive ? 0.3 : 0.65
            opacity = hovered ? (active ? 1 : 0.3) : pa.faded || pb.faded ? 0.25 : base
          }
          return (
            <Wire
              key={e.id}
              edge={e}
              from={{ node: a, place: pa, column: e.fromColumns[0] }}
              to={{ node: b, place: pb, column: e.toColumns[0] }}
              color={layerById.get(a.layerId)!.color}
              opacity={opacity}
              width={active ? 3 : 1.5}
            />
          )
        })}

      {view.flows.map((f) => {
        const a = nodeById.get(f.from)!
        const b = nodeById.get(f.to)!
        if (!placement.nodes[a.id] || !placement.nodes[b.id]) return null
        const job = f.role === 'read' ? f.to : f.from
        let opacity = 0.75
        if (time) opacity = time.active.has(job) ? 1 : time.done.has(job) ? 0.55 : lit?.flows.has(f.id) ? 0.15 : 0.03
        else if (lit) opacity = lit.flows.has(f.id) ? 1 : 0.05
        else if (reach) opacity = reach.has(f.from) && reach.has(f.to) ? 1 : 0.06
        const strong = opacity === 1 && (!!lit || !!reach || !!time)
        return <FlowWire key={f.id} flow={f} from={a} to={b} color={colorOf(f.pipelineId)} opacity={opacity} width={strong ? 3 : 2} />
      })}

      {lineageActive && (
        <>
          <Pulses
            flows={view.flows.filter((f) => !lit || lit.flows.has(f.id))}
            colorOf={colorOf}
            schedule={time ? scheduleFor(graph) : null}
            lens={time ? time.active : null}
          />
          <TriggerLinks view={view} pipelines={shownPipelines} opacity={lens || time ? 0.3 : 1} />
          {mode.id === 'flow' && (
            <Lanes
              view={view}
              placement={placement}
              pipelines={shownPipelines}
              opacityOf={(id) => (litPipelines ? (litPipelines.has(id) ? 1.5 : 0.15) : 1)}
            />
          )}
        </>
      )}
      <TimeDriver time={time} />
    </>
  )
}

function RingLine({ ring }: { ring: Ring }) {
  const points = useMemo(
    () =>
      Array.from({ length: 97 }, (_, i) => {
        const a = (i / 96) * Math.PI * 2
        return [ring.r * Math.cos(a), ring.y, ring.r * Math.sin(a)] as [number, number, number]
      }),
    [ring.r, ring.y],
  )
  return <Line points={points} color="#3a4459" lineWidth={1} transparent opacity={0.5} dashed dashSize={0.6} gapSize={0.4} />
}

/** Dev only: lets automation step frames (`__strata.advance()`) when the tab is backgrounded. */
function DevHandle() {
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    ;(window as unknown as { __strata: unknown }).__strata = {
      store: useStore,
      advance: (n = 1) => {
        for (let i = 0; i < n; i++) advance(performance.now() + i * 16)
      },
    }
  }, [advance])
  return null
}
