import { useStore } from '../store'

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

export async function loadSample(id: string) {
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
