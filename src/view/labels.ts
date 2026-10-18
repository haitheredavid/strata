/** A name as a list shows it: the part that tells it apart, then the affixes it shares with its neighbours. */
export interface Label {
  short: string
  /** The stripped affixes, `procoreboomi_…_prod`; empty when nothing was stripped. */
  rest: string
}

/** Words and the separators between them: `a__b-c` → `a`, `__`, `b`, `-`, `c`. */
const SEP = /([._-]+)/

/** An affix word is shared when at least this many names (and this share of the list) carry it. */
const MIN_SHARED = 3
const SHARE = 0.25
/** Words stripped from each end at most. */
const DEPTH = 2

/**
 * Labels for a list of names: words that many names in the list start or end with (`procoreboomi_`,
 * `__platinum`, `_prod`) move out of the short name, so a narrow list shows what differs. A name
 * always keeps at least one word. Pure; the same name always gets the same label within one list.
 */
export function listLabels(names: readonly string[]): Map<string, Label> {
  const unique = [...new Set(names)]
  const parts = new Map(unique.map((n) => [n, n.split(SEP)]))
  const head = new Map(unique.map((n) => [n, 0])) // parts stripped from the front
  const tail = new Map(unique.map((n) => [n, 0])) // parts stripped from the back
  const left = (n: string) => parts.get(n)!.length - head.get(n)! - tail.get(n)! // parts not stripped yet
  const min = Math.max(MIN_SHARED, Math.ceil(unique.length * SHARE))

  for (const end of ['head', 'tail'] as const) {
    for (let depth = 0; depth < DEPTH; depth++) {
      const at = (n: string) => {
        const p = parts.get(n)!
        return end === 'head' ? p[head.get(n)!] : p[p.length - 1 - tail.get(n)!]
      }
      const count = new Map<string, number>()
      for (const n of unique) if (left(n) > 2) count.set(at(n), (count.get(at(n)) ?? 0) + 1)
      const shared = new Set([...count].filter(([, c]) => c >= min).map(([w]) => w))
      if (!shared.size) break
      // A word and its separator go together, so at least one word (3 parts: word, sep, word) remains.
      for (const n of unique) {
        if (left(n) <= 2 || !shared.has(at(n))) continue
        const m = end === 'head' ? head : tail
        m.set(n, m.get(n)! + 2)
      }
    }
  }

  const out = new Map<string, Label>()
  for (const n of unique) {
    const p = parts.get(n)!
    const h = head.get(n)!
    const t = tail.get(n)!
    const short = p.slice(h, p.length - t).join('')
    const pre = p.slice(0, h).join('')
    const suf = p.slice(p.length - t).join('')
    out.set(n, { short, rest: pre && suf ? `${pre}…${suf}` : pre || suf })
  }
  return out
}
