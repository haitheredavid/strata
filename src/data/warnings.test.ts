import { describe, expect, it } from 'vitest'
import { parseDbml } from '../parse/dbml'
import { groupWarnings } from './warnings'

const graph = parseDbml(
  'Table a { id int }\nTable b { id int }\n',
  'pipelines:\n  - id: p1\n    name: Orders daily\n    tasks:\n      - id: load\n        name: Load orders\n        writes: [a]\n',
)

describe('groupWarnings', () => {
  it('collects each known kind into one counted line with linked items, keeping one-offs as they are', () => {
    const groups = groupWarnings(
      [
        'No foreign keys in Unity Catalog for these tables: only lineage edges will show',
        'Task "load" reads and writes nothing',
        'Job "p1": 111 lineage edge(s) could not be placed on a task by run time and went to its last task',
        'Task "gone/x" reads and writes nothing',
        'Pipeline "p1" has a dependency cycle: p1/a, p1/b',
      ],
      graph,
    )
    expect(groups).toEqual([
      { text: 'No foreign keys in Unity Catalog for these tables: only lineage edges will show', items: [] },
      {
        text: '2 tasks read and write nothing (no lineage for them)',
        items: [
          { text: 'Load orders', link: { kind: 'task', id: 'load' } },
          { text: 'gone/x', link: { kind: 'task', id: 'gone/x' } },
        ],
      },
      {
        text: "Lineage of 1 job couldn't be placed on tasks by run time and went to the last task",
        items: [{ text: 'Orders daily: 111 edges', link: { kind: 'pipeline', id: 'p1' } }],
      },
      {
        text: '1 pipeline has task dependency cycles (the tasks in a cycle run together as a last step)',
        items: [{ text: 'Orders daily: 2 tasks', link: { kind: 'pipeline', id: 'p1' } }],
      },
    ])
  })
})
