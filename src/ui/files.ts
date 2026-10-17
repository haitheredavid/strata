import { SAMPLES, buildDataset, sourceLabel, withWorkflows } from '../data/dataset'
import type { Dataset, DatasetSource, SampleFiles } from '../data/dataset'
import { planOpen } from '../data/open'
import { lastSource, rememberDataset } from '../data/persist'
import { parseSynthSpec } from '../dev/synth'
import { useStore } from '../store'

/** Synthetic graphs for profiling, offered in the sample picker in dev builds (`synth:<spec>` ids). */
export const SYNTH_PRESETS = [
  { id: 'synth:tables:1000,pipelines:20', label: 'Synthetic 1k' },
  { id: 'synth:tables:5000,pipelines:100', label: 'Synthetic 5k' },
  { id: 'synth:tables:20000,pipelines:300', label: 'Synthetic 20k' },
  { id: 'synth:tables:50000,pipelines:600', label: 'Synthetic 50k' },
]

const notify = (level: 'error' | 'warning', text: string, detail?: string[]) => useStore.getState().notify(level, text, detail)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Shows `status` while `work` runs, after letting it paint (parsing a big schema blocks the thread). */
async function busy<T>(status: string, work: () => Promise<T>): Promise<T> {
  useStore.getState().setStatus(status)
  try {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)))
    return await work()
  } finally {
    if (useStore.getState().status === status) useStore.getState().setStatus(null)
  }
}

async function fetchSample(id: string): Promise<SampleFiles> {
  const sample = SAMPLES.find((s) => s.id === id)
  if (!sample) throw new Error(`Unknown sample "${id}"`)
  const get = async (f: string) => {
    const r = await fetch(`${import.meta.env.BASE_URL}${f}`)
    if (!r.ok) throw new Error(`Could not fetch ${f} (${r.status})`)
    return r.text()
  }
  const [dbml, workflows] = await Promise.all([get(sample.dbml), sample.workflows ? get(sample.workflows) : null])
  return { dbml, workflows }
}

/** Installs `d` and keeps it for the next visit (unless `remember` is off). */
async function install(d: Dataset, remember = true) {
  useStore.getState().load(d)
  if (!remember) return
  try {
    await rememberDataset(d)
  } catch {
    notify('warning', `${d.label} won't reopen after a reload: browser storage is full or unavailable`)
  }
}

/** Builds and installs a dataset; failures become notices. Resolves to whether it loaded. */
export async function openSource(source: DatasetSource, remember = true): Promise<boolean> {
  try {
    await busy(`Opening ${sourceLabel(source)}…`, async () => {
      const sample = source.origin === 'sample' ? await fetchSample(source.id) : undefined
      await install(buildDataset(source, sample), remember)
    })
    return true
  } catch (e) {
    notify('error', `Couldn't open ${sourceLabel(source)}: ${message(e)}`)
    return false
  }
}

/** A sample, or a synthetic preset (`synth:<spec>`), from the sample picker. */
export function openSample(id: string) {
  return openSource(id.startsWith('synth:') ? { origin: 'synth', options: parseSynthSpec(id.slice('synth:'.length)) } : { origin: 'sample', id })
}

/**
 * Dropped / picked files: a workspace snapshot, a schema (.dbml) with an optional workflow file, a lone
 * workflow file for the open dataset, or an exported layout. Anything else is reported, not guessed at.
 */
export async function openFiles(files: FileList | File[]) {
  const list = [...files]
  if (!list.length) return
  let read
  try {
    read = await busy('Reading files…', () => Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() }))))
  } catch (e) {
    return notify('error', `Couldn't read ${list.map((f) => f.name).join(', ')}: ${message(e)}`)
  }
  const { plan, ignored, problems } = planOpen(read)
  for (const p of problems) notify('error', p)
  const s = useStore.getState()
  switch (plan.kind) {
    case 'snapshot':
      await openSource({ origin: 'snapshot', snapshot: plan.snapshot })
      break
    case 'schema':
      await openSource({ origin: 'file', name: plan.name, dbml: plan.dbml, workflows: plan.workflows })
      break
    case 'workflows':
      if (!s.dataset) {
        notify('error', 'Open a schema first: a workflow file adds jobs to the open one')
        break
      }
      try {
        await install(withWorkflows(s.dataset, plan.text))
      } catch (e) {
        notify('error', `Couldn't apply the workflow file: ${message(e)}`)
      }
      break
    case 'layout':
      s.setLayout(plan.layout)
      break
    case 'none':
      if (ignored.length) notify('error', `Not a schema, workflow file, snapshot or layout: ${ignored.join(', ')}`)
      return
  }
  if (ignored.length) notify('warning', `Ignored ${ignored.join(', ')}`)
}

/** First load: a dev `?synth=` spec, else the last dataset opened, else the commerce sample. */
export async function boot() {
  const synth = import.meta.env.DEV ? new URLSearchParams(location.search).get('synth') : null
  if (synth) {
    await openSource({ origin: 'synth', options: parseSynthSpec(synth) }, false)
    return
  }
  let last: DatasetSource | null = null
  try {
    last = await lastSource()
  } catch {
    /* storage unavailable: start from the sample */
  }
  if (last && (await openSource(last))) return
  await openSource({ origin: 'sample', id: 'commerce' })
}
