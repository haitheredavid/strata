import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../ingest/snapshot'
import { memoryStorage } from '../test/memoryStorage'
import { buildDataset } from './dataset'
import { forgetDataset, lastSource, listDatasets, rememberDataset } from './persist'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')
const file = (i: number) => buildDataset({ origin: 'file', name: `s${i}.dbml`, dbml: `Table t${i} {\n  id int [pk]\n}\n` })
const snapshot: Snapshot = {
  kind: 'strata-snapshot',
  version: 1,
  host: 'https://dbc-123.cloud.databricks.com',
  exportedAt: '2026-10-13T00:00:00Z',
  day: '2026-10-12',
  tz: 'UTC',
  dbml: read('sample.dbml'),
  workflows: 'pipelines: []\n',
  runs: { runs: [], taskRuns: [], events: [] },
  warnings: [],
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('dataset persistence', () => {
  it('reopens the last dataset, files and samples alike', async () => {
    expect(await lastSource()).toBe(null)
    await rememberDataset(file(1))
    expect(await lastSource()).toMatchObject({ origin: 'file', name: 's1.dbml' })
    await rememberDataset(buildDataset({ origin: 'synth', options: { tables: 30 } }))
    expect(await lastSource()).toEqual({ origin: 'synth', options: { tables: 30 } })
  })

  it('keeps the five most recent files and snapshots; samples and synth don’t count', async () => {
    const now = vi.spyOn(Date, 'now')
    for (let i = 0; i < 6; i++) {
      now.mockReturnValue(1000 + i) // distinct openedAt, in opening order
      await rememberDataset(file(i))
    }
    now.mockRestore()
    await rememberDataset(buildDataset({ origin: 'synth', options: { tables: 30 } }))
    expect((await listDatasets()).map((d) => d.label)).toEqual(['s5.dbml', 's4.dbml', 's3.dbml', 's2.dbml', 's1.dbml'])
  })

  it('forgets a dataset, and a reload then starts from the sample', async () => {
    const d = file(1)
    await rememberDataset(d)
    await forgetDataset(d.key)
    expect(await listDatasets()).toEqual([])
    expect(await lastSource()).toBe(null)
  })

  it('carries over the single snapshot slot and pointer an older version kept', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('strata', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('snapshots').put(snapshot, 'last')
      req.onsuccess = () => (req.result.close(), resolve())
      req.onerror = () => reject(req.error)
    })
    localStorage.setItem('strata:sample', 'snapshot')
    expect(await lastSource()).toMatchObject({ origin: 'snapshot', snapshot: { host: snapshot.host, day: '2026-10-12' } })
    expect(localStorage.getItem('strata:sample')).toBe(null)
    expect((await listDatasets()).map((d) => d.label)).toEqual(['dbc-123 · 2026-10-12'])
  })
})
