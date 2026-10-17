import type { SynthOptions } from '../dev/synth'

/**
 * The biggest real snapshot so far (608 tables, 93 pipelines, 11 domains) as synthetic options, since
 * real snapshots stay out of git. The "Snapshot shape (608)" dev preset loads the same graph.
 */
export const SNAPSHOT_SHAPE: Partial<SynthOptions> = { tables: 608, pipelines: 93, layers: 11 }

/**
 * Cold-run ceilings (ms) at `SNAPSHOT_SHAPE`, about 3× an M-series laptop, so a regression trips them
 * and machine noise doesn't. `autoLayout` and `filteredStack` run in a worker; the rest block a frame.
 */
export const SNAPSHOT_BUDGET_MS = {
  autoLayout: 3500,
  /** A pipeline-tables-only stack's own layout. */
  filteredStack: 2000,
  deriveView: 50,
  simulateDay: 50,
  /** Each mode's placement, plus jobs and clusters. */
  place: { stack: 600, flow: 150, orbit: 150, diagram: 150 },
}
