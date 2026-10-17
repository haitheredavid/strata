import { describe, expect, it } from 'vitest'
import { ArgError, parseExportArgs } from './exportArgs'
import { isTransient, withRetry } from './retry'

const base = ['--profile', 'test', '--catalogs', 'bronze,silver']
const parse = (...argv: string[]) => parseExportArgs(argv, 'America/New_York', Date.UTC(2026, 9, 13, 12))

describe('parseExportArgs', () => {
  it('fills in the day before, in the given zone, and the defaults', () => {
    expect(parse(...base)).toEqual({
      kind: 'export',
      options: {
        profile: 'test',
        catalogs: ['bronze', 'silver'],
        schemas: ['*'],
        day: '2026-10-12',
        tz: 'America/New_York',
        lineageDays: 7,
        warehouse: undefined,
        sqlTimeoutMin: 15,
        resume: false,
        out: undefined,
      },
    })
  })

  it.each([
    [['--catalogs', 'bronze'], /--profile is required/],
    [['--profile', 'p'], /--catalogs is required/],
    [[...base, '--catalogs', "x';drop"], /isn't a plain name/],
    [[...base, '--tz', 'Mars/Olympus'], /isn't a time zone/],
    [[...base, '--day', '2026-02-30'], /isn't a date/],
    [[...base, '--lineage-days', '0'], /from 1 to 365/],
    [[...base, '--lineage-days', '2.5'], /from 1 to 365/],
    [[...base, '--sql-timeout', 'soon'], /positive number of minutes/],
    [[...base, '--porfile', 'x'], /porfile/],
  ])('rejects %j', (argv, message) => {
    expect(() => parse(...argv)).toThrow(ArgError)
    expect(() => parse(...argv)).toThrow(message)
  })

  it('lists the fetch flags --from-raw ignores', () => {
    expect(parse('--from-raw', 'raw.json', '--profile', 'p', '--day', '2026-10-01', '--out', 'x.json')).toEqual({
      kind: 'fromRaw',
      file: 'raw.json',
      out: 'x.json',
      ignored: ['--profile', '--day'],
    })
  })
})

describe('withRetry', () => {
  it('retries rate limits and server errors, then gives up', async () => {
    let calls = 0
    const waits: number[] = []
    const fn = async () => {
      calls++
      throw new Error('databricks api get /x: Error: Too Many Requests (429)')
    }
    await expect(withRetry(fn, { attempts: 3, sleep: async (ms) => void waits.push(ms) })).rejects.toThrow(/429/)
    expect(calls).toBe(3)
    expect(waits).toHaveLength(2)
    expect(waits[1]).toBeGreaterThan(waits[0] * 1.5)
  })

  it('does not retry a request that is simply wrong', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw new Error('PERMISSION_DENIED: User does not have USE CATALOG')
    }
    await expect(withRetry(fn, { attempts: 5, sleep: async () => {} })).rejects.toThrow(/PERMISSION_DENIED/)
    expect(calls).toBe(1)
  })

  it('knows a transient failure when it sees one', () => {
    expect(['HTTP 503 Service Unavailable', 'read ECONNRESET', 'TEMPORARILY_UNAVAILABLE', 'status 502'].every(isTransient)).toBe(true)
    expect(['Error 404: not found', 'INVALID_PARAMETER_VALUE', 'took 5029 ms'].some(isTransient)).toBe(false)
  })
})
