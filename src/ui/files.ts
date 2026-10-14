import { readSnapshot } from '../ingest/snapshot'
import type { Snapshot } from '../ingest/snapshot'
import { stashedSnapshot, stashSnapshot } from '../ingest/stash'
import { useStore } from '../store'
import { parseSynthSpec, synthGraph, synthKey } from '../dev/synth'

const isSidecar = (f: File) => /\.(ya?ml|json)$/i.test(f.name)

/**
 * Load dropped / picked files: a workspace snapshot (`.snapshot.json`), or one schema (.dbml) plus an
 * optional workflow file (.yaml/.yml/.json).
 */
export async function loadFiles(files: FileList | File[]) {
  const list = [...files]
  for (const f of list.filter((f) => /\.json$/i.test(f.name))) {
    const snap = readSnapshot(await f.text())
    if (snap) return openSnapshot(snap)
  }
  const schema = list.find((f) => !isSidecar(f))
  const sidecar = list.find(isSidecar)
  const s = useStore.getState()
  if (schema) s.loadSchema(await schema.text(), sidecar ? await sidecar.text() : null)
  else if (sidecar) s.loadSidecar(await sidecar.text())
}

/** What reopens on the next visit: a sample id, or this for the stashed snapshot. */
export const SNAPSHOT = 'snapshot'

function remember(id: string) {
  try {
    localStorage.setItem('strata:sample', id)
  } catch {
    /* not persisted */
  }
}

async function openSnapshot(snap: Snapshot) {
  useStore.getState().loadSnapshot(snap)
  if (useStore.getState().error) return
  await stashSnapshot(snap)
  remember(SNAPSHOT)
}

/** Reopens the last session's choice: the stashed snapshot, else a sample. */
export async function loadLast(last: string | null) {
  const snap = last === SNAPSHOT ? await stashedSnapshot() : null
  if (snap) useStore.getState().loadSnapshot(snap)
  else await loadSample(last ?? 'commerce')
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
  remember(sample.id)
}
