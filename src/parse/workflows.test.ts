import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDbml } from './dbml'
import { inferMedallion, noteFields, parseTriggerText } from './notes'
import { buildWorkflows, parseSidecar } from './workflows'
import { runSteps } from '../view/runOrder'

const read = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8')

describe('notes', () => {
  it('reads key: value lines and ignores the rest', () => {
    expect(noteFields('Owned by data eng\nMedallion: silver\n job: clean_x \nfrom: a, b')).toEqual({
      medallion: 'silver',
      job: 'clean_x',
      from: 'a, b',
    })
  })

  it('infers medallion from note, then schema, then table prefix', () => {
    expect(inferMedallion('bronze', 'x', { medallion: 'gold' })).toBe('gold')
    expect(inferMedallion('raw', 'x', {})).toBe('bronze')
    expect(inferMedallion('curated', 'x', {})).toBe('gold')
    expect(inferMedallion(null, 'slv_orders', {})).toBe('silver')
    expect(inferMedallion('public', 'orders', {})).toBeUndefined()
  })

  it('parses every trigger form', () => {
    expect(parseTriggerText('schedule 0 2 * * *')).toEqual({ kind: 'schedule', cron: '0 2 * * *' })
    expect(parseTriggerText('file_arrival /Volumes/x')).toEqual({ kind: 'file_arrival', path: '/Volumes/x' })
    expect(parseTriggerText('table_update a, b')).toEqual({ kind: 'table_update', tables: ['a', 'b'] })
    expect(parseTriggerText('after other')).toEqual({ kind: 'job', pipeline: 'other' })
    expect(parseTriggerText('manual')).toEqual({ kind: 'manual' })
    expect(parseTriggerText('continuous')).toEqual({ kind: 'continuous' })
    expect(parseTriggerText('nonsense')).toBeUndefined()
  })
})

describe('parseSidecar', () => {
  const yaml = `
pipelines:
  - id: p
    trigger: { schedule: "0 1 * * *" }
    tasks:
      - id: a
        reads: [ext.api]
        writes: [t1]
      - id: b
        depends_on: [a]
        reads: [t1]
        writes: [t2]
        emits: [done]
`
  it('parses YAML and the equivalent JSON identically', () => {
    const json = JSON.stringify({
      pipelines: [{
        id: 'p',
        trigger: { schedule: '0 1 * * *' },
        tasks: [
          { id: 'a', reads: ['ext.api'], writes: ['t1'] },
          { id: 'b', depends_on: ['a'], reads: ['t1'], writes: ['t2'], emits: ['done'] },
        ],
      }],
    })
    expect(parseSidecar(json)).toEqual(parseSidecar(yaml))
    expect(parseSidecar(yaml).pipelines[0].trigger).toEqual({ kind: 'schedule', cron: '0 1 * * *' })
  })

  it('accepts DAB-style resources.jobs with task_key dependencies', () => {
    const dab = `
resources:
  jobs:
    nightly:
      tasks:
        - task_key: x
          writes: [t1]
        - task_key: y
          depends_on: [{ task_key: x }]
          reads: [t1]
`
    const { pipelines } = parseSidecar(dab)
    expect(pipelines[0].id).toBe('nightly')
    expect(pipelines[0].tasks[1].dependsOn).toEqual(['x'])
  })

  it('reports problems as warnings', () => {
    expect(parseSidecar('pipelines: [').warnings[0]).toMatch(/Workflow file/)
    expect(parseSidecar('foo: 1').warnings).toContain('Workflow file has no pipelines')
  })
})

describe('buildWorkflows', () => {
  it('resolves tables, makes unknown names sources, and infers dependencies', () => {
    const wf = buildWorkflows(
      [[{ id: 'p', tasks: [
        { id: 'a', reads: ['crm.accounts'], writes: ['main.bronze.t1'] },
        { id: 'b', reads: ['bronze.t1'], writes: ['silver.t2'] },
      ] }]],
      ['bronze.t1', 'silver.t2'],
    )
    const [a, b] = wf.pipelines[0].tasks
    expect(a.reads).toEqual(['source:crm.accounts'])
    expect(a.writes).toEqual(['bronze.t1']) // catalog prefix stripped
    expect(b.dependsOn).toEqual(['a'])
    expect(wf.sources.map((s) => s.name)).toEqual(['crm.accounts'])
  })

  it('merges notes and sidecar by task id, sidecar winning', () => {
    const notes = [{ id: 'notes', tasks: [{ id: 'a', reads: ['x'], writes: ['y'] }] }]
    const side = [{ id: 'p', name: 'P', tasks: [{ id: 'a', writes: ['z'], emits: ['e'] }] }]
    const wf = buildWorkflows([notes, side], ['x', 'y', 'z'])
    expect(wf.pipelines.map((p) => p.id)).toEqual(['p'])
    expect(wf.pipelines[0].tasks[0]).toMatchObject({ pipelineId: 'p', reads: ['x'], writes: ['y', 'z'], emits: ['e'] })
  })

  it('warns about unknown dependencies, cycles and unknown upstream pipelines', () => {
    const wf = buildWorkflows(
      [[{ id: 'p', trigger: { kind: 'job', pipeline: 'nope' }, tasks: [
        { id: 'a', writes: ['t'], dependsOn: ['b'] },
        { id: 'b', writes: ['t'], dependsOn: ['a', 'ghost'] },
      ] }]],
      ['t'],
    )
    expect(wf.warnings.join('\n')).toMatch(/unknown task "ghost"/)
    expect(wf.warnings.join('\n')).toMatch(/dependency cycle/)
    expect(wf.warnings.join('\n')).toMatch(/unknown pipeline "nope"/)
  })
})

describe('runSteps', () => {
  const task = (id: string, dependsOn: string[] = []) => ({ id, name: id, pipelineId: 'p', reads: [], writes: [], dependsOn, emits: [] })
  it('groups parallel tasks into steps', () => {
    expect(runSteps({ tasks: [task('a'), task('b'), task('c', ['a', 'b']), task('d', ['c'])] })).toEqual({
      steps: [['a', 'b'], ['c'], ['d']],
      cyclic: [],
    })
  })
  it('reports cycles instead of looping', () => {
    const r = runSteps({ tasks: [task('a'), task('b', ['c']), task('c', ['b'])] })
    expect(r.steps).toEqual([['a'], ['b', 'c']])
    expect(r.cyclic).toEqual(['b', 'c'])
  })
})

describe('lakehouse sample', () => {
  const g = parseDbml(read('lakehouse.dbml'), read('lakehouse.workflows.yaml'))

  it('infers medallion layers from schemas', () => {
    expect(g.tables.find((t) => t.id === 'silver.orders')!.medallion).toBe('silver')
    expect(g.tables.every((t) => t.medallion)).toBe(true)
  })

  it('merges note-defined jobs into the sidecar pipelines without warnings', () => {
    expect(g.workflows.warnings).toEqual([])
    expect(g.workflows.pipelines.map((p) => p.id)).toEqual([
      'ingest_sales', 'ingest_reference', 'stream_events', 'sales_refresh', 'gold_analytics', 'ml_churn',
    ])
    const sales = g.workflows.pipelines.find((p) => p.id === 'sales_refresh')!
    expect(sales.tasks.map((t) => t.id).sort()).toEqual(['build_daily_sales', 'clean_customers', 'clean_orders', 'clean_payments', 'clean_products'])
    expect(runSteps(sales).steps).toHaveLength(2)
    expect(sales.tasks.find((t) => t.id === 'clean_orders')!.writes.sort()).toEqual(['silver.order_lines', 'silver.orders'])
  })

  it('works without a sidecar (notes only)', () => {
    const notesOnly = parseDbml(read('lakehouse.dbml'))
    expect(notesOnly.workflows.pipelines.flatMap((p) => p.tasks).length).toBe(5)
  })
})
