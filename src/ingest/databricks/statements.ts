import type { Statement } from '../../sim/schedule'
import type { StatementRow } from './raw'

const n = (v: unknown) => Number(v) || 0
const MB = 1e6

/** Statements by strata task run id, in seconds since `t0`, ordered by start. Rows of task runs not in the day are dropped. */
export function statementsByRun(rows: StatementRow[], taskRunIds: Map<string, string>, t0: number): Record<string, Statement[]> {
  const out: Record<string, Statement[]> = {}
  for (const r of rows) {
    const run = taskRunIds.get(String(r.task_run_id))
    if (!run) continue
    ;(out[run] ??= []).push({
      id: r.statement_id,
      type: (r.statement_type ?? 'OTHER').toUpperCase(),
      text: (r.text ?? '').replace(/\s+/g, ' ').trim(),
      status: (r.status ?? '').toUpperCase(),
      start: (n(r.start_ms) - t0) / 1000,
      end: (n(r.end_ms) - t0) / 1000,
      waiting: n(r.wait_ms) / 1000,
      compiling: n(r.compile_ms) / 1000,
      executing: n(r.exec_ms) / 1000,
      taskTime: n(r.task_ms) / 1000,
      readMB: Math.round(n(r.read_bytes) / MB),
      writtenMB: Math.round(n(r.written_bytes) / MB),
      shuffleMB: Math.round(n(r.shuffle_bytes) / MB),
      spillMB: Math.round(n(r.spill_bytes) / MB),
      readRows: n(r.read_rows),
      writtenRows: n(r.written_rows),
    })
  }
  for (const xs of Object.values(out)) xs.sort((a, b) => a.start - b.start)
  return out
}
