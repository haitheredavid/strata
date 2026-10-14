import { Suspense, useEffect, useMemo } from 'react'
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
import { ClusterNode } from './ClusterNode'
import { CLUSTER_COLOR } from './clusterStyle'
import { ComputeLinks } from './ComputeLinks'
import type { ComputeLink, ViewCluster } from '../view/deriveView'
import { TriggerLinks } from './TriggerLinks'
import { flowVolumes, formatBytes } from '../sim/volume'

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
      {/* Scene text suspends on its font; keep that inside the canvas so the DOM UI never blanks. */}
      <Suspense fallback={null}>
        <Diagram model={model} />
      </Suspense>
      {import.meta.env.DEV && <DevHandle />}
    </Canvas>
  )
}

function Diagram({ model }: { model: SceneModel }) {
  const { view, placement, reach, lit, time } = model
  const graph = useStore((s) => s.graph)
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
  const volumes = useMemo(() => flowVolumes(view.flows, graph, scheduleFor(graph)), [view, graph])
  const jobVolume = useMemo(() => {
    const m = new Map<string, { in: number; out: number; runs: number }>()
    for (const f of view.flows) {
      const v = volumes.get(f.id)!
      const job = f.role === 'read' ? f.to : f.from
      const e = m.get(job) ?? { in: 0, out: 0, runs: v.runsPerDay }
      e[f.role === 'read' ? 'in' : 'out'] += v.bytes
      m.set(job, e)
    }
    return (id: string) => {
      const e = m.get(id)
      if (!e) return undefined
      const runs = e.runs >= 100 ? 'streaming' : `${Math.round(e.runs)}×/day`
      return `${formatBytes(e.in)} in → ${formatBytes(e.out)} out · ${runs}`
    }
  }, [view, volumes])
  const pulseFlows = useMemo(() => view.flows.filter((f) => !lit || lit.flows.has(f.id)), [view, lit])

  // Clusters follow their jobs: lit when a job they run is lit / running.
  const clusterById = useMemo(() => new Map(view.clusters.map((c) => [c.id, c])), [view])
  const clusterOpacity = (c: ViewCluster) => {
    if (time) return c.jobs.some((j) => time.active.has(j)) ? 1 : c.jobs.some((j) => time.done.has(j)) ? 0.75 : 0.25
    if (reach?.has(c.id)) return 1
    if (lens) return c.jobs.some((j) => lens.has(j)) ? 1 : DIM
    return 0.9
  }
  const linkOpacity = (l: ComputeLink) => {
    if (time) return time.active.has(l.job) ? 0.9 : time.done.has(l.job) ? 0.3 : 0.04
    if (reach) return reach.has(l.job) && reach.has(l.cluster) ? 0.9 : 0.04
    if (lens) return lens.has(l.job) ? 0.6 : 0.04
    return 0.22 // hover brightens it in ComputeLine
  }

  return (
    <>
      {placement.plates.map((pl) => (
        <LayerPlate key={pl.id} plate={pl} opacity={lens ? 0.4 : 1} />
      ))}

      {placement.rings?.map((r, i) => <RingLine key={i} ring={r} />)}

      {view.nodes.map((n) => {
        const place = placement.nodes[n.id]
        if (!place) return null
        // Hover highlighting is read in each node, so it doesn't re-render the whole diagram.
        const highlighted = n.id === focused
        if (n.kind === 'job')
          return (
            <JobNode
              key={n.id}
              node={n}
              color={colorOf(n.pipelineId!)}
              opacity={nodeOpacity(n.id)}
              highlighted={highlighted}
              runState={runState(n.id)}
              volume={jobVolume(n.id)}
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
          let opacity: number
          let active = false
          if (lit) {
            active = lit.edges.has(e.id)
            opacity = active ? 1 : 0.04
          } else if (reach) {
            active = reach.has(e.from) && reach.has(e.to)
            opacity = active ? 1 : 0.05
          } else {
            // Step FK refs back when lineage is on so data flow reads first. Wire applies hover on top.
            opacity = pa.faded || pb.faded ? 0.25 : lineageActive ? 0.3 : 0.65
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
              hoverable={!lit && !reach}
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

      {view.clusters.map((c) =>
        placement.nodes[c.id] ? (
          <ClusterNode
            key={c.id}
            cluster={c}
            opacity={clusterOpacity(c)}
            highlighted={c.id === focused}
            schedule={time ? scheduleFor(graph) : null}
          />
        ) : null,
      )}
      <ComputeLinks
        links={view.computeLinks}
        colorOf={(id) => CLUSTER_COLOR[clusterById.get(id)?.cluster.kind ?? 'job']}
        opacityOf={linkOpacity}
        hoverable={!time && !reach && !lens}
      />

      {lineageActive && (
        <>
          <Pulses
            flows={pulseFlows}
            volumes={volumes}
            colorOf={colorOf}
            schedule={time ? scheduleFor(graph) : null}
            lens={time ? time.active : null}
          />
          <TriggerLinks view={view} pipelines={shownPipelines} opacity={lens || time ? 0.3 : 1} />
          {(mode.id === 'flow' || mode.id === 'diagram') && (
            <Lanes
              view={view}
              placement={placement}
              pipelines={shownPipelines}
              spread={mode.id === 'diagram' ? 'z' : 'y'}
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
