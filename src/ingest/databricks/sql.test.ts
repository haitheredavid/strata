import { describe, expect, it } from 'vitest'
import { chunks, inLists, like, lit, sliceWhere } from './sql'

describe('SQL helpers', () => {
  it('quotes literals so a quote or backslash can’t end them', () => {
    expect(lit("o'brien")).toBe("'o\\'brien'")
    expect(lit('a\\b')).toBe("'a\\\\b'")
  })

  it('turns globs into LIKE patterns with _ and % taken literally', () => {
    expect(like('procore*')).toBe("'procore%'")
    expect(like('a_b%c*')).toBe("'a\\\\_b\\\\%c%'")
  })

  it('slices by catalog and schema globs, with ! excluding', () => {
    expect(sliceWhere(['bronze', 'silver'], ['procore*', '!*archive*'], 'c', 's')).toBe(
      "c IN ('bronze', 'silver') AND s <> 'information_schema' AND (s LIKE 'procore%') AND s NOT LIKE '%archive%'",
    )
    expect(sliceWhere(['gold'], ['!tmp*'], 'c', 's')).toBe("c IN ('gold') AND s <> 'information_schema' AND TRUE AND s NOT LIKE 'tmp%'")
  })

  it('splits id lists into one IN predicate per chunk', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([], 3)).toEqual([])
    expect(inLists('id', ['a', 'b', 'c'], 2)).toEqual(["id IN ('a', 'b')", "id IN ('c')"])
  })
})
