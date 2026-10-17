import type { Graph } from '../model/types'

/** What a warning item points at: a task (focus it) or a pipeline (light it up). */
export type WarningLink = { kind: 'task'; id: string } | { kind: 'pipeline'; id: string }

export interface WarningItem {
  text: string
  link?: WarningLink
}

/** Warnings of one kind together: a count line and an item per instance. A one-off warning has no items. */
export interface WarningGroup {
  text: string
  items: WarningItem[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** The verb agreeing with `n`: `verb(1, 'has', 'have')`. */
const verb = (n: number, one: string, many: string) => (n === 1 ? one : many)

interface Kind {
  re: RegExp
  title: (n: number) => string
  item: (m: RegExpMatchArray, names: { task: (id: string) => string; pipeline: (id: string) => string }) => WarningItem
}

// The templates come from the workflow parser (src/parse/workflows.ts) and the snapshot mapping
// (src/ingest/databricks/jobsToWorkflows.ts); anything else stays a warning of its own.
const KINDS: Kind[] = [
  {
    re: /^Task "(.+)" reads and writes nothing$/,
    title: (n) => `${plural(n, 'task')} ${verb(n, 'reads', 'read')} and ${verb(n, 'writes', 'write')} nothing (no lineage for ${verb(n, 'it', 'them')})`,
    item: (m, names) => ({ text: names.task(m[1]), link: { kind: 'task', id: m[1] } }),
  },
  {
    re: /^Job "(.+)": (\d+) lineage edge\(s\) could not be placed on a task by run time and went to its last task$/,
    title: (n) => `Lineage of ${plural(n, 'job')} couldn't be placed on tasks by run time and went to the last task`,
    item: (m, names) => ({ text: `${names.pipeline(m[1])}: ${plural(Number(m[2]), 'edge')}`, link: { kind: 'pipeline', id: m[1] } }),
  },
  {
    re: /^Task "(.+)" runs on unknown cluster "(.+)"$/,
    title: (n) => `${plural(n, 'task')} ${verb(n, 'runs', 'run')} on clusters the workflow file doesn't define`,
    item: (m, names) => ({ text: `${names.task(m[1])} → ${m[2]}`, link: { kind: 'task', id: m[1] } }),
  },
  {
    re: /^Task "(.+)" depends on unknown task "(.+)"$/,
    title: (n) => `${plural(n, 'task')} ${verb(n, 'depends', 'depend')} on tasks that don't exist`,
    item: (m, names) => ({ text: `${names.task(m[1])} → ${m[2]}`, link: { kind: 'task', id: m[1] } }),
  },
  {
    re: /^Pipeline "(.+)" has no tasks$/,
    title: (n) => `${plural(n, 'pipeline')} ${verb(n, 'has', 'have')} no tasks`,
    item: (m, names) => ({ text: names.pipeline(m[1]), link: { kind: 'pipeline', id: m[1] } }),
  },
  {
    re: /^Pipeline "(.+)" has a dependency cycle: (.+)$/,
    title: (n) => `${plural(n, 'pipeline')} ${verb(n, 'has', 'have')} task dependency cycles (the tasks in a cycle run together as a last step)`,
    item: (m, names) => ({ text: `${names.pipeline(m[1])}: ${plural(m[2].split(', ').length, 'task')}`, link: { kind: 'pipeline', id: m[1] } }),
  },
  {
    re: /^Pipeline "(.+)" isn't run by an exported job: its updates aren't in the timeline$/,
    title: (n) => `${plural(n, 'declarative pipeline')} ${verb(n, "isn't", "aren't")} run by an exported job, so ${verb(n, 'its', 'their')} updates aren't in the timeline`,
    item: (m) => ({ text: m[1] }),
  },
]

/** Exporter messages reworded for the app (snapshots carry the exporter's wording, so older ones read the same). */
const REWORD: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^No foreign keys in Unity Catalog for these tables: only lineage edges will show$/, () => 'Unity Catalog has no foreign keys for these tables, so only lineage (job) edges are drawn'],
  [/^(\d+) job id\(s\) in lineage aren't saved jobs \(.*\): their lineage was left out$/, (m) => `Lineage from ${plural(Number(m[1]), 'one-off or deleted job')} isn't shown (one-time runs, notebook workflows, deleted jobs)`],
  [/^(\d+) (.+?)\(s\) no longer exist \(.*\): (.+)$/, (m) => `${plural(Number(m[1]), m[2])} in the workspace no longer ${verb(Number(m[1]), 'exists', 'exist')}: ${m[3]}`],
  [/^(\d+) foreign key\(s\) point outside the export and were left out$/, (m) => `${plural(Number(m[1]), 'foreign key')} ${verb(Number(m[1]), 'points', 'point')} to tables outside this export and ${verb(Number(m[1]), "isn't", "aren't")} drawn`],
]

/** Groups known warning kinds into one line each with linked items, in order of first appearance. */
export function groupWarnings(warnings: string[], graph: Graph): WarningGroup[] {
  const tasks = new Map(graph.workflows.pipelines.flatMap((p) => p.tasks.map((t) => [t.id, t.name])))
  const pipelines = new Map(graph.workflows.pipelines.map((p) => [p.id, p.name]))
  const names = { task: (id: string) => tasks.get(id) ?? id, pipeline: (id: string) => pipelines.get(id) ?? id }
  const out: (WarningGroup & { kind?: Kind })[] = []
  for (const w of warnings) {
    const kind = KINDS.find((k) => k.re.test(w))
    if (!kind) {
      const reword = REWORD.find(([re]) => re.test(w))
      out.push({ text: reword ? reword[1](w.match(reword[0])!) : w, items: [] })
      continue
    }
    let group = out.find((g) => g.kind === kind)
    if (!group) out.push((group = { text: '', items: [], kind }))
    group.items.push(kind.item(w.match(kind.re)!, names))
  }
  return out.map(({ kind, text, items }) => ({ text: kind ? kind.title(items.length) : text, items }))
}
