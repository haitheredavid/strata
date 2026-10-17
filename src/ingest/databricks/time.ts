/** True when `tz` is an IANA time zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(day)
}

/** Offset of `tz` from UTC at instant `ms`, in ms (positive east of UTC). */
function tzOffset(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** Epoch ms of 00:00 on `day` (`YYYY-MM-DD`) in time zone `tz`. */
export function dayStart(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Two passes settle the offset when 00:00 sits near a DST change.
  const first = guess - tzOffset(guess, tz)
  return guess - tzOffset(first, tz)
}

/** `YYYY-MM-DD` `n` calendar days after `day` (negative for before). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Seconds from 00:00 on `day` to 00:00 the next day in `tz`: 86 400, or 23 / 25 hours across a DST change. */
export const dayLength = (day: string, tz: string) => (dayStart(addDays(day, 1), tz) - dayStart(day, tz)) / 1000

/** `YYYY-MM-DD` of the day before the one `ms` falls on in `tz`. */
export function yesterday(tz: string, ms = Date.now()): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return addDays(f.format(new Date(ms)), -1)
}
