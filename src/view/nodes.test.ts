import { describe, expect, it } from 'vitest'
import { splitName } from './nodes'

describe('splitName', () => {
  it('splits a dotted name at its last dot', () => {
    expect(splitName('gold.procore.prime_contracts')).toEqual({ short: 'prime_contracts', prefix: 'gold.procore' })
    expect(splitName('silver.orders')).toEqual({ short: 'orders', prefix: 'silver' })
  })

  it('leaves undotted and edge-dotted names whole', () => {
    expect(splitName('orders')).toEqual({ short: 'orders', prefix: '' })
    expect(splitName('.hidden')).toEqual({ short: '.hidden', prefix: '' })
    expect(splitName('trailing.')).toEqual({ short: 'trailing.', prefix: '' })
  })
})
