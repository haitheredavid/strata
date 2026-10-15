import { useCallback, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { MODES } from '../layout/modes'
import { modeOf, scheduleFor, useStore } from '../store'
import { AnimDriver } from './anim'
import { LodDriver } from './lod'
import { Interaction } from '../world/Interaction'
import { CameraRig } from './CameraRig'
import { useSceneModel } from './usePlacement'
import type { SceneModel } from './usePlacement'
import { FkEdges } from './FkEdges'
import { packColors, rgb } from './colors'
import type { FkStyle } from './FkEdges'
import { CardBodies } from './CardBodies'
import type { CardStyle } from './CardBodies'
import { buildWorld, replace } from '../world/world'
import type { World } from '../world/world'
import type { ViewGraph } from '../view/deriveView'
import { fkCurves } from '../world/fkEdges'
import { FlowWires } from './FlowWires'
import { PlateOutlines, RingLines } from './Outlines'
import type { FlowWireSpec, FlowWireStyle } from './FlowWires'
import { Lanes } from './Lanes'
import { Pulses } from './Pulses'
import { TimeDriver } from './TimeDriver'
import { ComputeLinks } from './ComputeLinks'
import type { ComputeLink, ViewCluster } from '../view/deriveView'
import { TriggerLinks } from './TriggerLinks'
import { flowVolumes, formatBytes, pulseShape } from '../sim/volume'
import { usePalette } from '../theme/palette'
import { PerfHud } from '../dev/PerfHud'
import { Profiled } from '../dev/Profiled'
import { createRenderer, drawCallsCounter } from './gpu/renderer'
import type { RunState } from './labels'
import { SceneText } from './SceneText'
import { NodeParts } from './parts/NodeParts'
import { PlateBodies } from './parts/PlateBodies'
import { AnchorDriver } from './text/AnchorDriver'
import { useSceneAnchors } from './text/anchors'
import { runBench } from '../dev/bench'
import type { BenchOptions } from '../dev/bench'
import { allSpans, lastSpans, span } from '../dev/perf'
import type CameraControlsImpl from 'camera-controls'
import type { WebGPURenderer } from 'three/webgpu'

/** Last world built per view, reused across placements (see `replace`). */
const worlds = new WeakMap<ViewGraph, World>()

const showPerf = import.meta.env.DEV && /[?&](perf|synth)\b/.test(location.search)

const NO_EDGES: ReadonlySet<string> = new Set()
const DIM = 0.1
const FADED = 0.35

export function Scene() {
  const model = useSceneModel()

  return (
    <Canvas
      gl={createRenderer}
      // WebGPURenderer blends in a linear buffer whenever it tone maps or converts color spaces, which
      // makes translucent plates and wires read much stronger than the sRGB blending the scene was
      // designed with. Keep colors as sRGB values and draw straight to the canvas instead.
      legacy
      linear
      flat
      camera={{ position: [30, 30, 40], fov: 45, near: 0.5, far: 2000 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#0b0e14']} />
      <CameraRig view={model.view} placement={model.placement} />
      <AnimDriver placement={model.placement} />
      <Profiled id="Diagram">
        <Diagram model={model} />
      </Profiled>
      {import.meta.env.DEV && <DevHandle />}
      {showPerf && <PerfHud />}
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
  const palette = usePalette()
  const colorOf = palette.pipeline

  const nodeById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view])
  const shownPipelines = useMemo(
    () => pipelines.filter((p) => view.flows.some((f) => f.pipelineId === p.id)),
    [pipelines, view],
  )
  const lens = useMemo(() => lit?.nodes ?? (reach ? new Set(reach.keys()) : null), [lit, reach])
  const litPipelines = useMemo(
    () => (lit?.flows.size ? new Set(view.flows.filter((f) => lit.flows.has(f.id)).map((f) => f.pipelineId)) : null),
    [lit, view],
  )
  const laneOpacity = useCallback((id: string) => (litPipelines ? (litPipelines.has(id) ? 1.5 : 0.15) : 1), [litPipelines])

  // Only orbit fades nodes; keep the set's identity while its contents hold, so placement changes
  // that don't touch fading (layer gap, drags) don't restyle every node.
  const fadedKey = useMemo(() => Object.keys(placement.nodes).filter((id) => placement.nodes[id].faded).join('\n'), [placement])
  const faded = useMemo(() => new Set(fadedKey ? fadedKey.split('\n') : []), [fadedKey])
  const nodeOpacity = useCallback(
    (id: string) => {
      if (time) {
        if (time.active.has(id)) return 1
        if (time.done.has(id)) return 0.8
        if (time.reached.has(id)) return 1
        return lit?.nodes.has(id) ? 0.35 : DIM
      }
      if (lens) return lens.has(id) ? 1 : DIM
      return faded.has(id) ? FADED : 1
    },
    [time, lit, lens, faded],
  )
  const runState = useCallback(
    (id: string): RunState => (!time ? null : time.active.has(id) ? 'active' : time.done.has(id) ? 'done' : 'pending'),
    [time],
  )
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
  const pulseShapes = useMemo(() => pulseShape(view.flows, volumes), [view, volumes])
  const pulseFlows = useMemo(() => view.flows.filter((f) => !lit || lit.flows.has(f.id)), [view, lit])

  // Clusters follow their jobs: lit when a job they run is lit / running.
  const clusterById = useMemo(() => new Map(view.clusters.map((c) => [c.id, c])), [view])
  const clusterOpacity = useCallback(
    (c: ViewCluster) => {
      if (time) return c.jobs.some((j) => time.active.has(j)) ? 1 : c.jobs.some((j) => time.done.has(j)) ? 0.75 : 0.25
      if (reach?.has(c.id)) return 1
      if (lens) return c.jobs.some((j) => lens.has(j)) ? 1 : DIM
      return 0.9
    },
    [time, reach, lens],
  )
  const linkOpacity = useCallback(
    (l: ComputeLink) => {
      if (time) return time.active.has(l.job) ? 0.9 : time.done.has(l.job) ? 0.3 : 0.04
      if (reach) return reach.has(l.job) && reach.has(l.cluster) ? 0.9 : 0.04
      if (lens) return lens.has(l.job) ? 0.6 : 0.04
      return 0.22 // hover brightens it in ComputeLinks
    },
    [time, reach, lens],
  )
  const linkColor = useCallback((id: string) => palette.cluster(clusterById.get(id)?.cluster.kind ?? 'job'), [palette, clusterById])

  // Flat-array scene for the instanced renderers; rebuilt when the view or placement changes.
  const world = useMemo(() => {
    // Same view, same nodes: rewrite frames in place so the instanced renderers keep their buffers.
    const prev = worlds.get(view)
    const w = (prev && replace(prev, view, placement)) ?? span('buildWorld', () => buildWorld(view, placement))
    worlds.set(view, w)
    return w
  }, [view, placement])
  const curves = useMemo(() => fkCurves(world.fk.count), [world])
  const fkEdges = useMemo(() => {
    const byId = new Map(view.edges.map((e) => [e.id, e]))
    return world.fk.ids.map((id) => byId.get(id)!)
  }, [world, view])
  // FK styling only sees lit *edges*; the timeline and lenses light flows and give a fresh, empty edge
  // set on every publish. Collapse those to one constant so FK styles don't rebuild per publish.
  const litEdges = !lit ? null : lit.edges.size ? lit.edges : NO_EDGES
  const fkColors = useMemo(() => packColors(fkEdges.map((e) => palette.layer(nodeById.get(e.from)!.layerId))), [fkEdges, palette, nodeById])
  const fkStyle = useMemo<FkStyle>(() => {
    const style = new Float32Array(fkEdges.length * 2)
    fkEdges.forEach((e, k) => {
      const pa = placement.nodes[e.from]
      const pb = placement.nodes[e.to]
      let opacity: number
      let active = false
      if (litEdges) {
        active = litEdges.has(e.id)
        opacity = active ? 1 : 0.04
      } else if (reach) {
        active = reach.has(e.from) && reach.has(e.to)
        opacity = active ? 1 : 0.05
      } else {
        // Step FK refs back when lineage is on so data flow reads first. Hover is applied on top.
        opacity = pa.faded || pb.faded ? 0.25 : lineageActive ? 0.3 : 0.65
      }
      style[2 * k] = opacity
      style[2 * k + 1] = active ? 3 : 1.5
    })
    return { color: fkColors, style, hoverable: !litEdges && !reach }
  }, [fkEdges, fkColors, placement, litEdges, reach, lineageActive])

  const lodCards = useMemo(() => view.nodes.filter((n) => n.kind !== 'job').map((n) => n.id), [view])
  const fkOpacity = useCallback((k: number) => fkStyle.style[2 * k], [fkStyle])
  const showFk = edgeLayer !== 'lineage'
  const anchors = useSceneAnchors(world, placement.plates)
  useEffect(() => () => anchors.table.dispose(), [anchors.table])

  const cardStyle = useMemo<CardStyle>(() => {
    const n = world.nodes.count
    const color = new Float32Array(n * 4)
    const medal = new Float32Array(n * 4)
    world.nodes.ids.forEach((id, i) => {
      const node = nodeById.get(id)
      if (!node || node.kind === 'job') return
      rgb(palette.layer(node.layerId)).toArray(color, 4 * i)
      color[4 * i + 3] = nodeOpacity(id)
      if (node.medallion) rgb(palette.medallion(node.medallion)).toArray(medal, 4 * i)
      medal[4 * i + 3] = (node.medallion ? 1 : 0) + (id === focused || time?.reached.has(id) ? 2 : 0)
    })
    return { color, medal }
    // nodeOpacity reads the same inputs listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, nodeById, palette, focused, time, lit, reach, placement])

  // Which flows are drawn (changes with the view and placement) apart from how (lens, timeline).
  const flowWires = useMemo<FlowWireSpec[]>(() => {
    const out: FlowWireSpec[] = []
    for (const f of view.flows) {
      const a = nodeById.get(f.from)!
      const b = nodeById.get(f.to)!
      if (placement.nodes[a.id] && placement.nodes[b.id]) out.push({ flow: f, from: a, to: b })
    }
    return out
  }, [view, nodeById, placement])
  const flowStyle = useMemo<FlowWireStyle>(() => {
    const n = flowWires.length
    const style: FlowWireStyle = { color: new Array<string>(n), opacity: new Float32Array(n), width: new Float32Array(n) }
    flowWires.forEach(({ flow: f }, k) => {
      const job = f.role === 'read' ? f.to : f.from
      let opacity = 0.75
      if (time) opacity = time.active.has(job) ? 1 : time.done.has(job) ? 0.55 : lit?.flows.has(f.id) ? 0.15 : 0.03
      else if (lit) opacity = lit.flows.has(f.id) ? 1 : 0.05
      else if (reach) opacity = reach.has(f.from) && reach.has(f.to) ? 1 : 0.06
      const strong = opacity === 1 && (!!lit || !!reach || !!time)
      style.color[k] = colorOf(f.pipelineId)
      style.opacity[k] = opacity
      style.width[k] = strong ? 3 : 2
    })
    return style
  }, [flowWires, time, lit, reach, colorOf])

  return (
    <>
      <LodDriver cards={lodCards} />
      <Interaction world={world} placement={placement} nodeById={nodeById} draggable={mode.draggable} />
      <CardBodies world={world} style={cardStyle} />
      <NodeParts
          world={world}
          anchors={anchors.table}
          nodeById={nodeById}
          clusterById={clusterById}
          nodeOpacity={nodeOpacity}
          clusterOpacity={clusterOpacity}
          runState={runState}
          pipelineColor={colorOf}
          clusterColor={palette.cluster}
          focused={focused}
          schedule={time ? scheduleFor(graph) : null}
      />
      <AnchorDriver world={world} plates={placement.plates} anchors={anchors} fkCurves={curves} fk={showFk} />
      <SceneText
          world={world}
          plates={placement.plates}
          anchors={anchors}
          fkEdges={fkEdges}
          fkOpacity={fkOpacity}
          showFk={showFk}
          nodeById={nodeById}
          clusterById={clusterById}
          nodeOpacity={nodeOpacity}
          clusterOpacity={clusterOpacity}
          plateOpacity={lens ? 0.4 : 1}
          layerColor={palette.layer}
          pipelineColor={colorOf}
          clusterColor={palette.cluster}
          focused={focused}
          jobVolume={jobVolume}
      />
      <PlateBodies plates={placement.plates} anchors={anchors} colorOf={palette.layer} opacity={lens ? 0.4 : 1} />

      <PlateOutlines plates={placement.plates} colorOf={palette.layer} opacity={lens ? 0.4 : 1} />
      {placement.rings && <RingLines rings={placement.rings} />}

      {showFk && <FkEdges world={world} curves={curves} fkStyle={fkStyle} />}
      <FlowWires wires={flowWires} style={flowStyle} />

      <ComputeLinks
        links={view.computeLinks}
        colorOf={linkColor}
        opacityOf={linkOpacity}
        hoverable={!time && !reach && !lens}
      />

      {lineageActive && (
        <>
          <Pulses
            flows={pulseFlows}
            shapes={pulseShapes}
            colorOf={colorOf}
            schedule={time ? scheduleFor(graph) : null}
            lens={time ? time.active : null}
          />
          <TriggerLinks view={view} pipelines={shownPipelines} colorOf={colorOf} opacity={lens || time ? 0.3 : 1} />
          {(mode.id === 'flow' || mode.id === 'diagram') && (
            <Lanes
              view={view}
              placement={placement}
              pipelines={shownPipelines}
              colorOf={colorOf}
              spread={mode.id === 'diagram' ? 'z' : 'y'}
              opacityOf={laneOpacity}
            />
          )}
        </>
      )}
      <TimeDriver time={time} />
    </>
  )
}

/**
 * Dev only: lets automation step frames (`__strata.advance()`) when the tab is backgrounded, and run the
 * perf bench (`await __strata.bench({ synth: { tables: 5000 } })`).
 */
const drawCalls = drawCallsCounter()

function DevHandle() {
  const advance = useThree((s) => s.advance)
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  useEffect(() => {
    ;(window as unknown as { __strata: unknown }).__strata = {
      store: useStore,
      scene: () => get().scene,
      gl: () => gl,
      r3f: () => get(),
      info: () => ({ calls: drawCalls(gl.info as never), triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries }),
      advance: (n = 1) => {
        for (let i = 0; i < n; i++) advance(performance.now() + i * 16)
      },
      bench: (opts?: Partial<BenchOptions>) =>
        // r3f types `gl` as a WebGLRenderer; the canvas runs WebGPURenderer (see gpu/renderer)
        runBench({ gl: gl as unknown as WebGPURenderer, controls: () => get().controls as unknown as CameraControlsImpl | null }, opts),
      spans: () => ({ last: lastSpans(), all: allSpans() }),
    }
  }, [advance, gl, get])
  return null
}
