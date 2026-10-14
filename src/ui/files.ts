import { useStore } from '../store'
import { parseSynthSpec, synthGraph, synthKey } from '../dev/synth'

const isSidecar = (f: File) => /\.(ya?ml|json)$/i.test(f.name)

/** Load dropped / picked files: one schema (.dbml) plus an optional workflow file (.yaml/.yml/.json). */
export async function loadFiles(files: FileList | File[]) {
  const list = [...files]
  const schema = list.find((f) => !isSidecar(f))
  const sidecar = list.find(isSidecar)
  const s = useStore.getState()
  if (schema) s.loadSchema(await schema.text(), sidecar ? await sidecar.text() : null)
  else if (sidecar) s.loadSidecar(await sidecar.text())
}

export const SAMPLES = [
  { id: 'commerce', label: 'Commerce sample', dbml: 'sample.dbml', workflows: null },
  { id: 'lakehouse', label: 'Lakehouse sample', dbml: 'lakehouse.dbml', workflows: 'lakehouse.workflows.yaml' },
] as const

/** Synthetic graphs for profiling, offered in the sample picker in dev builds (`synth:<spec>` ids). */
export const SYNTH_PRESETS = [
  { id: 'synth:tables:1000,pipelines:20', label: 'Synthetic 1k' },
  { id: 'synth:tables:5000,pipelines:100', label: 'Synthetic 5k' },
  { id: 'synth:tables:20000,pipelines:300', label: 'Synthetic 20k' },
  { id: 'synth:tables:50000,pipelines:600', label: 'Synthetic 50k' },
]

/** Load a synthetic graph from a spec like `tables:20000,pipelines:300,seed:1`. */
export function loadSynth(spec: string) {
  const o = parseSynthSpec(spec)
  useStore.getState().loadGraph(synthGraph(o), synthKey(o))
}

export async function loadSample(id: string) {
  if (id.startsWith('synth:')) return loadSynth(id.slice('synth:'.length))
  const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0]
  const get = (f: string) => fetch(`${import.meta.env.BASE_URL}${f}`).then((r) => r.text())
  const [dbml, wf] = await Promise.all([get(sample.dbml), sample.workflows ? get(sample.workflows) : null])
  useStore.getState().loadSchema(dbml, wf)
  try {
    localStorage.setItem('strata:sample', sample.id)
  } catch {
    /* not persisted */
  }
}
