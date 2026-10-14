import type { Snapshot } from './snapshot'
import { isSnapshot } from './snapshot'

// The last loaded snapshot, kept in IndexedDB so a reload brings it back (it's too big for localStorage).
const DB = 'strata'
const STORE = 'snapshots'
const KEY = 'last'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Keeps `snap` for the next visit; storage being unavailable just means it isn't kept. */
export async function stashSnapshot(snap: Snapshot): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(snap, KEY))
  } catch {
    /* not kept */
  }
}

/** The snapshot kept by `stashSnapshot`, or null. */
export async function stashedSnapshot(): Promise<Snapshot | null> {
  try {
    const v = await run('readonly', (s) => s.get(KEY))
    return isSnapshot(v) ? v : null
  } catch {
    return null
  }
}
