# strata

Prototype: DBML schemas as a 3D diagram with switchable layouts. Each `TableGroup` is a domain.

```sh
pnpm install
pnpm dev         # loads the last sample (commerce by default)
pnpm test
```

## Layout modes

The toolbar switches between modes. Switching animates, each table keeps its identity as it moves, and the camera stays where it is.

- **Stack**: each domain is a horizontal layer stacked on Y. Refs inside a domain stay on the plate; refs between domains wire between layers. Tables are placed with d3-force, and you can drag them.
- **Flow**: each domain is an upright slab, ordered left to right by FK dependency. Domains that are referenced come first (upstream), and domains that reference them follow (downstream). On each slab, sub-columns follow FK depth within the domain, and rows are ordered by barycenter sweeps to reduce crossings. A sub-column too tall to read (a domain of hundreds of tables) wraps into a grid about as wide as it is tall, keeping the row order. Focusing a table lifts its neighborhood off the slab. You can drag cards on their slab and reorder domains with ←/→.
- **Orbit**: the focused table sits at the center (or the most connected table, if nothing is focused). Tables it references sit on rings above it and tables that reference it sit below, one ring per hop. Tables outside the hop range lie faded at the equator, filling rings outward in domain order, so hundreds of them make a compact disk. Click a table to re-center on it.
- **Diagram**: Flow's arrangement laid flat on the ground, with domains left to right and rows top to bottom. The lens narrows to a near-orthographic 3° (a dolly zoom that keeps the framing), so it reads like a 2D lineage diagram. Press Top for the straight-down view, and switch to Flow to watch each column stand up into its slab.

## Exploring

- **Focus depth**: `up + table + down` hop counts, as in dbt's `2+model+1`. It dims everything outside that neighborhood, in every mode.
- **Path**: click Path, or focus a table and Shift-click a second one. This lists every join path between the two tables, up to one hop longer than the shortest, as join chains. Click a path to isolate it. "Avoid" removes hub tables from the search.
- **Columns**: show all columns, keys only, or headers only. Double-click a card to fold just that card.
- **Domains**: collapse a domain to a single card (refs into it are merged and shown with ×N), hide it (●/○), or show only it (◐). Hide, only-this and collapse are saved with the layout, like pipeline visibility.
- **Search** (`/`) finds tables, jobs, clusters and sources and flies to them; ↑ / ↓ pick a result. Iso / Top / Side (Front in Flow) are camera presets.
- **What's lit** builds up in layers: the timeline or a pipeline lens (◎) narrows the scene, and a focus or a path drills in from there, drawn in full over the rest. The panel's **Lit by** trail names each layer with ✕ to clear it, and **Esc** clears one at a time: path, focus, lens, the timeline's span, then "only this".
- **Keys**: `/` search, `T` timeline, `1`–`4` Stack / Flow / Orbit / Diagram, Esc as above. They're ignored while you type in a field.
- The layout (mode, positions, domain order, column detail) autosaves to localStorage for each schema. **⋯ → Export layout / Import layout** saves it as JSON; opening or dropping an exported layout applies it. Colour schemes are in the same menu.
- **Open…** (or a drop) takes a workspace snapshot, a `.dbml` with its workflow file, a workflow file for the open schema, or a layout, and works out which from the content.
- The chip at the left of the toolbar names the open dataset and opens the **Datasets** menu: the samples, the last five files and snapshots you opened (✕ forgets one), and synthetic presets in dev builds. Whatever you open comes back after a reload. ⚠ N shows the dataset's warnings.
- Load problems, workflow-file warnings and long layouts show as notices at the top left.

## Pipelines, jobs and medallion layers

Load the **Lakehouse sample** from the Datasets menu, or open a `.dbml` together with a workflow file.

- **Workflow file** (`*.workflows.yaml` or `.json`, opened with the schema or on its own over the open one): pipelines made of tasks that read and write tables, shaped like Databricks Jobs. A DAB-style `resources.jobs` map also works.
  ```yaml
  pipelines:
    - id: sales_refresh
      trigger: { table_update: [bronze.orders_raw] }   # schedule | file_arrival | table_update | after | manual | continuous
      tasks:
        - id: clean_orders
          reads: [bronze.orders_raw]
          writes: [silver.orders]
          emits: [orders.cleaned]
        - id: build_daily_sales
          depends_on: [clean_orders]                     # inferred from reads/writes when omitted
          reads: [silver.orders]
          writes: [gold.daily_sales]
  ```
  - Names that aren't tables in the schema (APIs, Kafka topics, volumes) become **sources**.
  - `catalog.schema.table` names match `schema.table`.
  - Problems show as warnings in a notice instead of failing the load. A workflow file opened on its own must contain pipelines, or it's rejected and the current ones stay.
- **DBML notes**:
  - A table note can say which job builds it, with `job: clean_orders`, `from: bronze.orders_raw`, `emits: …` and `pipeline: …`.
  - A TableGroup note can set `pipeline:` and `trigger: schedule 0 2 * * *` for the jobs of its tables.
  - Notes and the workflow file are merged by task id; the file wins on conflicts.
- **Medallion layer** is taken from a `medallion:` note, then the schema name (bronze/raw, silver/clean, gold/curated), then a `brz_`/`slv_`/`gld_` prefix. Cards show a B/S/G chip.
- **Group by Medallion** lays out by layer instead of by domain. In Flow this reads sources → bronze → silver → gold, left to right.
- **Edges**: FK, Lineage or Both.
- **Lineage drawing**:
  - Jobs are hexagons placed between what they read and what they write.
  - Lineage wires are dashed, in the pipeline's colour, with pulses moving downstream. Past 12 pipelines, each takes the colour of the domain it mostly writes, shaded apart from the others writing there.
  - Pulse size shows bytes per run (log scale) and the number of pulses on a wire shows runs per day: a daily batch is one dot, streaming a dense train. In a snapshot, sizes come from the bytes the job's statements read and wrote (query history, split evenly over its tables); otherwise `bytes: 4GB` on a task gives its size, and failing that it is simulated from the medallion layer. Hover a job for its bytes in / out and runs a day; a snapshot job whose size had to be simulated says so.
  - Flow mode adds a translucent lane for each pipeline; lanes not lit fade. Past 12 pipelines, only lit pipelines' lanes are drawn.
- **Triggers** label each pipeline's first jobs (CRON / FILE / ON UPDATE / AFTER / STREAMING). Dotted links run from the tables or the upstream pipeline that start it.
- **Events** are amber markers on the jobs that emit them.
- **Pipelines panel**:
  - ●/○ shows or hides a pipeline, ◐ shows only it (again to bring the others back);
  - ◎ lights up everything a pipeline touches;
  - ▶ opens the day timeline on that pipeline's first run, with the pipeline lit up.
  - Lighting up a pipeline or opening the timeline turns lineage edges on if they're off, and says so.
- Opening a workflow file replaces the open dataset's jobs and is remembered with it, so a reload keeps it. A snapshot keeps its real runs.

## Day timeline

**Timeline** in the toolbar (or ▶ on a pipeline) opens a day of runs across every pipeline: simulated unless a snapshot is loaded, and the header says which. A snapshot's day runs from local midnight to local midnight, so a day with a daylight-saving change is 23 or 25 hours long and its times are the zone's wall clock. It opens with the whole day as the span, so everything that ran is lit, and the playhead on the first run. **Clear span** or Esc goes back to the hour before the playhead. ▶ on a pipeline instead plays from just before its first run.

- **Start times** come from each pipeline's trigger:
  - cron schedules fire at their times; file arrivals land three times a day; manual runs at 09:00; continuous runs all day.
  - `after:` pipelines start when the upstream run ends. Table-update pipelines start 60 s after a watched table is written.
  - A pipeline that is still running queues at most one more run.
- **Durations** come from the medallion layer a task writes (silver heaviest), scaled by how many tables it reads. A task's `duration: 12m` in the workflow file overrides this. Job clusters add a cold start once per run.
- **Rows**: one row per pipeline and one bar per task run.
  - The hatched start of a bar is queueing or cluster start-up. Its left edge is the medallion layer it writes, and ◆ marks an emitted event.
  - Hover a bar for times and the cluster it ran on. Click it (or up to 6 px beside it) to focus that job.
- **Selecting time**: click to move the playhead, drag to select a span (drag its edges to adjust), wheel to zoom, shift-wheel to pan.
- **3D scene**: lights jobs running at the playhead, plus jobs in the span (or in the last hour). Reads pulse in, then writes pulse out, as each job progresses.
- **Medallion totals**: the B / S / G chip shows task time per layer in the span, or so far today. It shows where silver outweighs gold.

## Compute

Jobs are linked to the clusters they run on, drawn as racks under the diagram. Toggle them in the Pipelines panel.

- **Workflow file**: declare compute the DAB way.
  ```yaml
  clusters:                         # shared all-purpose clusters
    analytics_shared: { node_type_id: i3.2xlarge, autoscale: { min_workers: 2, max_workers: 6 } }
  pipelines:
    - id: sales_refresh
      job_clusters:
        - job_cluster_key: etl
          new_cluster: { node_type_id: i3.xlarge, autoscale: { min_workers: 2, max_workers: 8 } }
      tasks:
        - { id: clean_orders, job_cluster_key: etl }
        - { id: build_ltv, existing_cluster_id: analytics_shared }
        - { id: ingest_events, environment_key: default }   # serverless
  ```
  Tasks that name nothing get a job cluster for their pipeline, or serverless for streaming pipelines.
- **Racks**: workers light up with the work at the playhead. A warm all-purpose cluster idles grey; a job cluster is dark between runs. Focus a cluster to light the jobs it runs.
- **Compute drawer**: focus a job or a cluster to open a drawer above the timeline.
  - It shows the cluster spec, a utilization strip (workers up in grey, cores busy in colour), avg / p95 load, estimated DBUs and a right-sizing hint.
  - Its flame chart runs task run → Spark jobs → stages (scan, exchange, join, write…) → task waves. A red tail marks a skewed straggler, and a red outline marks a spill.
  - Hover a bar for details, click to zoom, double-click to reset.

**Without a snapshot, all compute data is simulated.** It follows the shape of the real sources, which a snapshot replaces where it has them:

| Shown | Real source |
| --- | --- |
| Task start / end, cluster used | `system.lakeflow.job_task_run_timeline` (`compute_ids`) |
| Cluster spec | `system.compute.clusters` |
| Workers up, CPU busy | `system.compute.node_timeline` |
| Spark jobs, stages, tasks, shuffle, spill | Spark event log (`SparkListenerJobStart`, `SparkListenerStageCompleted`, `SparkListenerTaskEnd`) |

## Databricks snapshots

A snapshot is a slice of a real workspace in one file. It holds Unity Catalog tables, the jobs whose lineage touches them, and one day of those jobs' runs. To make one, run the export locally with the `databricks` CLI's auth. It is read-only.

```sh
pnpm export:databricks --profile prod --catalogs bronze,silver,gold,platinum \
  --schemas 'procore*,!*archive*' --day 2026-10-12 --tz America/New_York
```

Then drop `snapshots/<host>-<day>.snapshot.json` onto the app. `snapshots/` is gitignored because it holds real workspace metadata. Keep it out of `public/`: CI fails if any `*.snapshot.json` or `*.raw.json` is committed.

- **Warehouse**: `--warehouse <id>`, or the export picks a running warehouse (else a serverless one) and says which.
- **Long queries**: a statement still running after `--sql-timeout` minutes (default 15) is cancelled. Ctrl-C cancels the running statements too. Results download through external links, so big slices aren't capped.
- **Failures**: rate limits and server errors are retried with backoff. Each step's result is saved to `snapshots/.raw/<host>-<day>.partial.json` as it lands; after a failure or Ctrl-C, rerun with `--resume` to continue from there. Things that can't be fetched (a deleted pipeline, a purged run) become warnings in the snapshot rather than stopping the export.
- **Arguments** are checked up front (`--tz`, `--day`, `--lineage-days`), and `--from-raw` says which fetch flags it ignores.

| strata | Comes from |
| --- | --- |
| Tables, columns | `system.information_schema.tables` / `columns`. The id is the full UC name. The catalog sets the medallion layer, and the schema is the domain. |
| PKs, FK refs | Informational constraints (`table_constraints`, `key_column_usage`, `referential_constraints`) |
| Pipelines, tasks, triggers, clusters | Jobs API (`jobs list --expand-tasks`), `pipelines get`, `clusters get`, `instance-pools get`, `clusters list-node-types`. Task ids are `<job>/<task_key>`. |
| Task reads / writes, sources | `system.access.table_lineage`. Lineage only names the job run, so each edge goes to the task that was running when it was written. If that can't be found, the edge goes to a task whose key or notebook path names the layer, and failing that to the job's last task. |
| Day timeline | `jobs list-runs --expand-tasks`. Each task's queue + setup becomes the hatched start of its bar. Failed runs get a red outline, and canceled or skipped runs are faded. |
| Cluster utilization, worker racks | `system.compute.node_timeline` per minute, for classic clusters. Each run's job cluster folds into its job-cluster key. |
| Serverless utilization | Statement parallelism (`total_task_duration_ms ÷ execution_duration_ms` from `system.query.history`), shown as cores in use rather than a busy share. |
| Flame chart | `system.query.history` statements per task run (waiting / compiling / executing, bytes, rows, shuffle, spill) on serverless and warehouses. Classic clusters keep simulated Spark jobs, since they deliver no event logs. |
| Pulse size | Bytes read and written by each task's statements, averaged per run. |

Snapshot warnings are grouped by kind in the ⚠ notice; items naming a task focus it, and items naming a job light it up.

The compute drawer's badge says which of these are real for the cluster in view.

Drop the snapshot onto the app; it's kept in IndexedDB, so a reload brings it back. A file that claims to be a snapshot but isn't usable (another version, missing fields) is reported with what's wrong. Layouts follow the workspace and catalogs rather than the file, so tomorrow's export keeps today's positions for the tables that are still there and places only the new ones.

Big workspaces need narrowing. When a schema has more than 150 tables, a fresh layout starts with header-only cards and **Tables: In visible pipelines**, which leaves out tables no shown pipeline touches. ◐ shows only one pipeline, and the Pipelines panel has a filter box with **All** / **None** for whatever it matches, and groups long lists by trigger or by the domain each pipeline mostly writes. The Layers panel gets a filter past eight layers, and row buttons show on hover unless they hold a state (hidden, only, folded). A filtered view gets its own layout in Stack; past 150 tables it's computed in a background worker, and the full layout's positions stand in until it lands. The timeline only lists visible pipelines, has a row filter and **Lit only** (the lit pipeline, or those that ran in the window), and keeps its time axis in view while you scroll.

`pnpm test:scale` and `pnpm bench` hold the load path to timing budgets at the 600-table snapshot shape (`src/bench/budgets.ts`); the **Snapshot shape (608)** dev preset loads the same synthetic graph.

The export also writes its raw payloads to `snapshots/.raw/`, so `--from-raw <file>` can redo the mapping offline. Anything it can't map shows up as a warning: ⚠ N next to the dataset chip. One example is lineage from `dbutils.notebook.run` runs, which carry no link to their job.

## Structure

`graph → deriveView (hide / collapse / detail) → mode.place → Placement → scene`

- `src/view/`: `deriveView` (grouping, collapse, jobs and lineage flows), `hops`, `findPaths` and `runOrder`. All are pure.
- `src/parse/`: DBML (`dbml.ts`), notes and medallion inference (`notes.ts`), and the workflow file and merge (`workflows.ts`).
- `src/layout/modes/`: `stack`, `flow` and `orbit`, each turning the view into world-space positions and card orientations. `jobs.ts` then places jobs in any mode, and `compute.ts` places clusters under them.
- `src/ingest/`: the snapshot format, and in `databricks/` the pure mapping from workspace payloads to DBML, a workflow file and a `Schedule`. `scripts/export-databricks.ts` fetches them.
- `src/sim/`: the simulated day (`schedule.ts`) and Spark execution and utilization (`spark.ts`). Both are pure and deterministic.
- `src/layout/depth.ts`: FK depth (longest path, with cycles broken) and domain rank.
- `src/scene/anim.ts`: eases cards and plates toward their placement targets. Wires follow the animated transforms.

Stack: Vite, React, react-three-fiber + drei, `@dbml/core`, zustand, d3-force, yaml.
