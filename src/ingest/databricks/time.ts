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

/** `YYYY-MM-DD` of the day before `ms` in `tz`. */
export function yesterday(tz: string, ms = Date.now()): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return f.format(new Date(ms - 86_400_000))
}
