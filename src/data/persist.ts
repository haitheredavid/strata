import { isSnapshot } from '../ingest/snapshot'
import { datasetKey, sourceLabel } from './dataset'
import type { Dataset, DatasetSource } from './dataset'

// Datasets kept for the next visit, in IndexedDB (snapshots are too big for localStorage), plus a
// pointer to the last one opened. Files and snapshots are kept as a short recent list; samples and
// synthetic specs are tiny recipes and don't count against it.

const DB = 'strata'
const VERSION = 2
const STORE = 'datasets'
const LAST = 'strata:last'
/** Recent files and snapshots kept. */
const RECENT = 5

export interface SavedDataset {
  key: string
  label: string
  source: DatasetSource
  openedAt: number
}

/** Records are rebuilt from storage another version may have written: check the parts loading relies on. */
function isSaved(v: unknown): v is SavedDataset {
  if (!v || typeof v !== 'object' || !('key' in v) || typeof v.key !== 'string' || !('source' in v)) return false
  const s = v.source
  if (!s || typeof s !== 'object' || !('origin' in s)) return false
  if (s.origin === 'snapshot') return 'snapshot' in s && isSnapshot(s.snapshot)
  if (s.origin === 'file') return 'dbml' in s && typeof s.dbml === 'string'
  if (s.origin === 'sample') return 'id' in s && typeof s.id === 'string'
  return s.origin === 'synth' && 'options' in s && !!s.options && typeof s.options === 'object'
}

/** Version 1 kept one snapshot under `snapshots/last`; move it into `datasets`. */
function migrate(db: IDBDatabase, tx: IDBTransaction) {
  const datasets = db.createObjectStore(STORE)
  if (!db.objectStoreNames.contains('snapshots')) return
  const old = tx.objectStore('snapshots').get('last')
  old.onsuccess = () => {
    if (isSnapshot(old.result)) {
      const source: DatasetSource = { origin: 'snapshot', snapshot: old.result }
      const saved: SavedDataset = { key: datasetKey(source), label: sourceLabel(source), source, openedAt: 0 }
      datasets.put(saved, saved.key)
    }
    db.deleteObjectStore('snapshots')
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = (e) => {
      if (e.oldVersion < 2) migrate(req.result, req.transaction!)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

async function withStore<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await open()
  try {
    return await op(db.transaction(STORE, mode).objectStore(STORE))
  } finally {
    db.close()
  }
}

async function all(s: IDBObjectStore): Promise<SavedDataset[]> {
  const rows: unknown[] = await done(s.getAll())
  return rows.filter(isSaved)
}

/** Keeps `d` for the next visit and makes it the one a reload opens. Rejects when storage fails. */
export async function rememberDataset(d: Dataset): Promise<void> {
  const saved: SavedDataset = { key: d.key, label: d.label, source: d.source, openedAt: Date.now() }
  await withStore('readwrite', async (s) => {
    await done(s.put(saved, saved.key))
    const recent = (await all(s)).filter((x) => x.source.origin === 'file' || x.source.origin === 'snapshot').sort((a, b) => b.openedAt - a.openedAt)
    await Promise.all(recent.slice(RECENT).map((x) => done(s.delete(x.key))))
  })
  localStorage.setItem(LAST, d.key)
}

/** The last opened dataset's source, or null on a first visit. */
export async function lastSource(): Promise<DatasetSource | null> {
  const key = localStorage.getItem(LAST) ?? (await legacyLast())
  if (!key) return null
  const saved: unknown = await withStore('readonly', (s) => done(s.get(key)))
  if (isSaved(saved)) return saved.source
  return key.startsWith('sample:') ? { origin: 'sample', id: key.slice('sample:'.length) } : null
}

/** Before datasets, `strata:sample` held a sample id or 'snapshot' (the one kept in IndexedDB). */
async function legacyLast(): Promise<string | null> {
  const legacy = localStorage.getItem('strata:sample')
  if (!legacy) return null
  localStorage.removeItem('strata:sample')
  if (legacy !== 'snapshot') return `sample:${legacy}`
  const snapshots = await withStore('readonly', all)
  return snapshots.find((x) => x.source.origin === 'snapshot')?.key ?? null
}
