import { describe, expect, it } from 'vitest'
import { listLabels } from './labels'

describe('listLabels', () => {
  it('moves affixes most of the list shares out of the short name', () => {
    const names = ['document__platinum', 'project__platinum', 'quality_observation__platinum', 'budget__platinum', 'tripwires_2_base_data']
    const l = listLabels(names)
    expect(l.get('document__platinum')).toEqual({ short: 'document', rest: '__platinum' })
    expect(l.get('quality_observation__platinum')!.short).toBe('quality_observation')
    expect(l.get('tripwires_2_base_data')).toEqual({ short: 'tripwires_2_base_data', rest: '' })
  })

  it('strips shared words from both ends', () => {
    const names = ['procoreboomi_rfis__incremental_prod', 'procoreboomi_notes_logs_prod', 'procoreboomi_checklists_prod', 'daily-construction-log-prod', 'other']
    const l = listLabels(names)
    expect(l.get('procoreboomi_notes_logs_prod')).toEqual({ short: 'notes_logs', rest: 'procoreboomi_…_prod' })
    expect(l.get('procoreboomi_rfis__incremental_prod')!.short).toBe('rfis__incremental')
    expect(l.get('daily-construction-log-prod')!.short).toBe('daily-construction-log')
  })

  it('always keeps a word, and leaves short lists and rare affixes alone', () => {
    const l = listLabels(['a_prod', 'b_prod', 'c_prod', 'prod'])
    expect(l.get('prod')!.short).toBe('prod')
    expect(l.get('a_prod')!.short).toBe('a')
    // Two names sharing a word aren't a pattern.
    expect(listLabels(['x__gold', 'y__gold']).get('x__gold')!.short).toBe('x__gold')
  })
})
