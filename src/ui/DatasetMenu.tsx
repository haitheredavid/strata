import { useState } from 'react'
import { useStore } from '../store'
import { SAMPLES, datasetKey } from '../data/dataset'
import type { DatasetSource } from '../data/dataset'
import { forgetDataset, listDatasets } from '../data/persist'
import type { SavedDataset } from '../data/persist'
import { parseSynthSpec } from '../dev/synth'
import { SYNTH_PRESETS, openSample, openSource } from './files'
import { Menu } from './Menu'

const ORIGIN: Record<DatasetSource['origin'], string> = { sample: 'Sample', file: 'File', snapshot: 'Snapshot', synth: 'Synthetic' }

/** The open dataset as a chip that opens the Datasets menu, plus its warning count. */
export function DatasetMenu() {
  const dataset = useStore((s) => s.dataset)
  const showWarnings = useStore((s) => s.showDatasetWarnings)
  const notify = useStore((s) => s.notify)
  const [recent, setRecent] = useState<SavedDataset[]>([])
  const refresh = () => listDatasets().then(setRecent, () => setRecent([]))
  const forget = async (r: SavedDataset) => {
    try {
      await forgetDataset(r.key)
    } catch {
      notify('error', `Couldn't forget ${r.label}: browser storage is unavailable`)
    }
    await refresh()
  }
  const warnings = dataset?.warnings.length ?? 0

  const item = (key: string, label: string, origin: DatasetSource['origin'], pick: () => void, title?: string) => (
    <button key={key} role="menuitem" className={`menu-item${dataset?.key === key ? ' current' : ''}`} title={title} onClick={pick}>
      <span className="origin">{ORIGIN[origin]}</span>
      <span className="label">{label}</span>
    </button>
  )

  return (
    <>
      <Menu
        className="chip"
        title={dataset ? `${dataset.label}: switch datasets` : 'Datasets: samples and recently opened files'}
        onOpen={refresh}
        label={
          <>
            {dataset && <span className="origin">{ORIGIN[dataset.source.origin]}</span>}
            <span className="label">{dataset?.label ?? 'Datasets'}</span>
            <span className="caret">▾</span>
          </>
        }
      >
        {(close) => (
          <>
            <div className="menu-head">Samples</div>
            {SAMPLES.map((s) =>
              item(datasetKey({ origin: 'sample', id: s.id }), s.label, 'sample', () => {
                close()
                void openSample(s.id)
              }),
            )}
            {recent.length > 0 && <div className="menu-head">Recent</div>}
            {recent.map((r) => (
              <div key={r.key} className="menu-row">
                {item(r.key, r.label, r.source.origin, () => {
                  close()
                  void openSource(r.source)
                }, r.source.origin === 'snapshot' ? r.source.snapshot.host : undefined)}
                <button className="forget" title={`Forget ${r.label}`} onClick={() => void forget(r)}>
                  ✕
                </button>
              </div>
            ))}
            {import.meta.env.DEV && (
              <>
                <div className="menu-head">Synthetic (dev)</div>
                {SYNTH_PRESETS.map((p) =>
                  item(datasetKey({ origin: 'synth', options: parseSynthSpec(p.id.slice('synth:'.length)) }), p.label, 'synth', () => {
                    close()
                    void openSample(p.id)
                  }),
                )}
              </>
            )}
          </>
        )}
      </Menu>
      {warnings > 0 && (
        <button className="chip-warn" title="Show this dataset's warnings" onClick={showWarnings}>
          ⚠ {warnings}
        </button>
      )}
    </>
  )
}
