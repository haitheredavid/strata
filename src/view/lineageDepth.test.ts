import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { lineageDepth } from './lineageDepth'

describe('lineageDepth', () => {
  it('runs from what nothing feeds (0) to the most downstream (1), jobs in between', () => {
    const g = parseDbml(
      'Table raw { id int }\nTable clean { id int }\nTable mart { id int }\n',
      'pipelines: [{ id: p, tasks: [{ id: a, reads: [api], writes: [raw] }, { id: b, reads: [raw], writes: [clean] }, { id: c, reads: [clean], writes: [mart] }] }]',
    )
    const d = lineageDepth(g)
    const at = (id: string) => d.get(id)!
    expect(at('source:api')).toBe(0)
    expect(at('mart')).toBe(1)
    const order = ['source:api', 'job:a', 'raw', 'job:b', 'clean', 'job:c', 'mart'].map(at)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
  })

  it('puts referenced tables upstream of the tables referencing them, and survives cycles', () => {
    const g = parseDbml('Table users { id int [pk] }\nTable orders { id int [pk]\n user_id int [ref: > users.id] }\nTable a { id int [pk]\n b_id int [ref: > b.id] }\nTable b { id int [pk]\n c_id int [ref: > c.id] }\nTable c { id int [pk]\n a_id int [ref: > a.id] }\n')
    const d = lineageDepth(g)
    expect(d.get('orders')!).toBeGreaterThan(d.get('users')!)
    expect(['a', 'b', 'c'].every((id) => d.has(id) && d.get(id)! >= 0 && d.get(id)! <= 1)).toBe(true)
  })
})
