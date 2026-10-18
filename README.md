# strata

Lineage of a Databricks workspace (or any DBML schema with a workflow file) as a diagram you can search, select, trace and scrub through a day of runs. Each `TableGroup` is a domain.

```sh
pnpm install
pnpm dev         # loads the last dataset (the commerce sample by default)
pnpm test
```

## The screen

- **Toolbar**: the dataset chip (⚠ N opens its warnings), **Open…**, search, **Lineage | Day**, **2D | 3D**, **View ▾** and **⋯** (layout file, colours).
- **Navigator** (left, ‹ hides it): what's in the picture, as a filter panel. One box at the top filters domains and pipelines by name (every word must match). Each section's heading says how much of it is shown (`2 / 16`) and its ⋯ has *Show all* / *Hide all* (pipelines also group by trigger or by the domain they mostly write, and *Only tables shown pipelines touch*).
  - A row's swatch shows or hides it: filled is shown, an outline is hidden. The name frames a domain or selects a pipeline. Its ⋯ has *Show only this*, *Fold into one card* and *Move* for domains, *Show only this* and *Play its day* for pipelines.
  - Domains show a bar for their size next to the table count. Pipelines show their day as a strip, one tick per run (red for failed), and drop affixes most of the list shares (`__platinum`, `procoreboomi_…_prod`) until you hover. With a day of runs, **Failed / Ran / No runs** chips narrow the list.
  - Lists stop at 8 domains and 10 pipelines with *Show N more*. A narrowed list offers *Show only these N*, which hides every pipeline not in it. Shown pipelines with nothing in the picture (all their tables are in hidden domains) wait under *N not in the picture*.
- **Canvas**: the diagram, then at the top the **Showing** bar (each narrowing in force: *Only procore*, *3 of 11 domains*, *2 folded*, *12 of 93 pipelines*, *Tables in shown pipelines*, each with ✕, and *Reset* for all) next to the **Lit by** trail, notices at the top left, and camera presets (Iso / Top / Side or Front / Fit) at the bottom right.
- **Inspector** (right, while something is selected): details of the selection, with every name a link that selects it and frames it with its neighbours. Lists are grouped (tables by schema, jobs by pipeline) with a bar for the mix in the heading, show 8 rows then *Show N more*, and get a filter past 12. Job rows carry the day strip instead of a line of text.
  - **Table**: domain, medallion, columns, the jobs that write and read it (with today's runs), FK neighbours, the focus depth, and **Find join path to…**.
  - **Job**: its pipeline, today's runs, reads and writes, the cluster it runs on, **Open in Day**, and its compute (below).
  - **Cluster**: spec, the jobs it runs, and its compute.
  - **Pipeline**: trigger, today's runs, its tasks, *Show only this*, *Play its day*.
  - A selection the current filters leave out of the diagram says so (and offers **Show all tables** when that's why).
- **Day** dock (under the Navigator and canvas, drag its top edge to resize): the timeline, below.

## Views

**Lineage** is the diagram on its own; **Day** adds the day's runs under it. **2D | 3D** switches how the diagram is drawn; each switch animates, every table keeps its identity as it moves, and the camera turns to the new mode's angle.

- **2D (Diagram)**: domains left to right by FK dependency (referenced domains first), laid flat with rows top to bottom. The lens narrows to a near-orthographic 3° (a dolly zoom that keeps the framing), so it reads like a 2D lineage diagram. Within a domain, sub-columns follow FK depth and rows are ordered by barycenter sweeps to reduce crossings; a sub-column too tall to read (hundreds of tables) wraps into a grid about as wide as it is tall.
- **3D (Flow)**: the same arrangement with each domain standing up as a slab. Selecting a table lifts its neighbourhood off the slab. You can drag cards on their slab and reorder domains from the Navigator's ⋯ menu.
- **Labs**: Stack (domains as horizontal layers, force-placed, draggable) and Orbit (the selected table at the centre, FK hops on rings above and below) are kept for exploration. Open the app with `?labs` to offer them in **View ▾** (and on keys 3 / 4); `?labs=0` hides them again. Without labs, a layout saved in either opens as the 2D diagram.

## Exploring

- **One selection**: click a table, job or cluster in the diagram, a pipeline in the Navigator, a bar in the Day timeline, a search result or any Inspector link. Selecting a pipeline lights everything it touches; selecting a node lights its neighbourhood. For tables that's `up + table + down` hops as in dbt's `2+model+1` (set in the Inspector), following FKs and lineage: one hop up reaches the jobs that write the table and the tables those jobs read.
- **Join paths**: **Find join path to…** in a table's Inspector, or Shift-click a second table. This lists every join path between the two, up to one hop longer than the shortest, as join chains. Click a path to isolate it. "Avoid" removes hub tables from the search.
- **Columns**: all, keys only, or headers only (View ▾). Double-click a card to fold just that card.
- **Search** (`/`) finds tables, jobs, clusters, sources and pipelines, grouped by kind with a count each; every word you type must match, and exact and starts-with matches come first. Rows show the short name with the match in bold and its schema or pipeline beside it. Picking one selects and frames it; ↑ / ↓ move through the results.
- **What's lit** builds up in layers: the Day timeline narrows the scene to what ran in its window, and the selection (or a join path) drills in from there, drawn in full over the rest. The **Lit by** trail names each layer with ✕ to clear it, and **Esc** clears one at a time: path, selection, the timeline's span, then "only this".
- **Build-up**: opening a dataset fills the picture in like a time-lapse. Domain outlines appear first, then nodes fade in one after another, upstream first (by lineage depth), sweeping each domain top to bottom. Wires follow once both ends are in, and lanes and trigger links settle in at the end. It takes 2.5 s for a small view, up to 8 s for a large one. Any click or key press skips to the end; the scroll wheel zooms without skipping. **View ▾ → Build-up on open** turns it off (kept across datasets) or **Replay**s it. With reduced motion set in the OS, a dataset opens without it.
- **Story** (toolbar, or `S`): scenes to step through when you're showing someone the workspace. A strip opens along the bottom of the canvas.
  - **+ Scene** saves what's on screen, after the current scene: the view settings (2D / 3D, grouping, edges, columns, hidden, "only this" and folded domains and pipelines, tables-only), the selection or lit pipeline with its hops, the join path finder, the Day timeline's playhead and span, and the camera. Card positions aren't part of a scene, so every scene shares the dataset's arrangement.
  - Click a scene (or press ← / →) to show it. The cards tween, and the camera flies to the scene's pose. A caption at the bottom left gives the scene's title and note; **Edit** changes them. If the view moves away from the scene, the caption offers **Update scene** or **Revert**.
  - Each scene's ⋯ menu can update it to what's on screen, move it earlier or later, or delete it.
  - **Present** hides the Navigator and Inspector and leaves the picture, the caption and the strip. Esc or **Stop** ends it.
  - A story is saved with the dataset's layout, so it comes back after a reload and travels with **⋯ → Export layout / Import layout**.
- **Keys**: `/` search, `T` Day, `S` story, ← / → scenes while the story is open, `1` / `2` 2D / 3D, Esc as above (or to stop presenting). They're ignored while you type in a field. **View ▾** lists them.
- Visibility (shown, only this, folded), mode, grouping, edges, column detail and positions autosave to localStorage for each dataset. **⋯ → Export layout / Import layout** saves them as JSON; opening or dropping an exported layout applies it.
- **Colours** (View ▾) are kept across datasets:
  - **Scheme**: Default (categorical) or a perceptual gradient: Viridis, Magma, Inferno, Plasma, Cividis. Each swatch previews it, and the UI accent follows it.
  - **Colour by Domain & pipeline**: each domain and pipeline gets its own colour. On a gradient, neighbours in a list step by the golden ratio along it, so they land far apart.
  - **Colour by Lineage depth**: every table, source and job is coloured by how far downstream it sits (longest path over lineage and FKs). Sources and raw tables are at the dark end, the most downstream tables at the bright end. Wires take the colour of their downstream end, domains and pipelines the mean of their members, and a legend at the bottom left says which end is which. Default draws depth with Viridis. Grouped by medallion layer, the 3D view reads as one sweep from dark to bright.
- **Open…** (or a drop) takes a workspace snapshot, a `.dbml` with its workflow file, a workflow file for the open schema, or a layout, and works out which from the content.
- The dataset chip opens the **Datasets** menu: the samples, the last five files and snapshots you opened (✕ forgets one), and synthetic presets in dev builds. Whatever you open comes back after a reload.
- Load problems and long layouts show as notices at the top left of the canvas. A dataset's warnings wait behind ⚠ N.

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
  - Jobs are small rounded hexagons, outlined in their pipeline's colour and about as tall as a card's header and first row, placed between what they read and what they write. Tables stay the largest thing on screen.
  - Lineage wires are dashed, in the pipeline's colour, with pulses moving downstream. Up to eight pipelines keep the parser's colours; past that they draw from a 32-colour list picked to stay apart, by position, so colours survive reloads and hiding others. A node with six or more wires on one side bundles them into a trunk that fans out near the far ends.
  - Card labels show the table's short name, with its catalog and schema smaller underneath. They fade in as you zoom, and the selection, what's hovered and what's lit get a readable callout at any zoom.
  - Pulse size shows bytes per run (log scale) and the number of pulses on a wire shows runs per day: a daily batch is one dot, streaming a dense train. In a snapshot, sizes come from the bytes the job's statements read and wrote (query history, split evenly over its tables); otherwise `bytes: 4GB` on a task gives its size, and failing that it is simulated from the medallion layer. Hover a job for its bytes in / out and runs a day; a snapshot job whose size had to be simulated says so.
  - Flow mode adds a translucent lane for each pipeline; lanes not lit fade. Past 12 pipelines, only lit pipelines' lanes are drawn.
- **Triggers** label each pipeline's first jobs (CRON / FILE / ON UPDATE / AFTER / STREAMING) in small grey text, with a thin circle around the job. Dotted links run from the tables or the upstream pipeline that start it.
- **Events** are small amber diamonds on the jobs that emit them.
- **Pipelines in the Navigator**: the swatch shows or hides a pipeline; ⋯ → *Show only this* shows only it (✕ on its *Showing* chip brings the others back) and *Play its day* opens the Day timeline on its first run with the pipeline selected. Clicking the name selects it, lighting everything it touches. Selecting a pipeline or opening the Day timeline turns lineage edges on if they're off, and says so.
- Opening a workflow file replaces the open dataset's jobs and is remembered with it, so a reload keeps it. A snapshot keeps its real runs.

## Day timeline

**Day** in the toolbar (`T`, or *Play its day* on a pipeline) opens a day of runs across every shown pipeline under the diagram: simulated unless a snapshot is loaded, and the header says which. A snapshot's day runs from local midnight to local midnight, so a day with a daylight-saving change is 23 or 25 hours long and its times are the zone's wall clock. It opens with the whole day as the span, so everything that ran is lit, and the playhead on the first run; the span's ✕ (or Esc) goes back to the hour before the playhead. *Play its day* instead plays from just before the pipeline's first run. The header reads left to right: play, speed (×600 / ×1,800 / ×7,200 real time), Follow, the clock, the day, the span, medallion totals, then Zoom to span / Full day, **Lit only** and **Events**.

- **Start times** come from each pipeline's trigger:
  - cron schedules fire at their times; file arrivals land three times a day; manual runs at 09:00; continuous runs all day.
  - `after:` pipelines start when the upstream run ends. Table-update pipelines start 60 s after a watched table is written.
  - A pipeline that is still running queues at most one more run.
- **Durations** come from the medallion layer a task writes (silver heaviest), scaled by how many tables it reads. A task's `duration: 12m` in the workflow file overrides this. Job clusters add a cold start once per run.
- **Rows**: one row per pipeline, ordered by first run so the day reads top-left to bottom-right, and one bar per task run. Pipelines with no runs fold into one *N with no runs today* row at the bottom. Overlapping runs stack up to three lanes deep, after which they share the last lane. Names drop the affixes most pipelines share until you hover.
  - The hatched start of a bar is queueing or cluster start-up. Its left edge is the medallion layer it writes, and ◆ marks an emitted event.
  - Hover a bar for times and the cluster it ran on. Click it (or up to 6 px beside it) to select that job and frame it. Click a row's name to select the pipeline.
- **Selecting time**: click to move the playhead, drag to select a span (drag its edges to adjust), wheel to zoom, shift-wheel to pan.
- **3D scene**: lights jobs running at the playhead, plus jobs in the span (or in the last hour). Reads pulse in, then writes pulse out, as each job progresses.
- **Medallion totals**: the B / S / G chip shows task time per layer in the span, or so far today. It shows where silver outweighs gold.

## Compute

Jobs are linked to the clusters they run on, drawn as racks under the diagram. Toggle them in **View ▾ → Compute racks**.

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
- **Racks**: workers light up with the work at the playhead. A warm all-purpose cluster idles grey; a job cluster is dark between runs. With the Day timeline closed there's no load to show, so racks sit faint. Select a cluster to light the jobs it runs.
- **Compute in the Inspector**: select a job or a cluster.
  - It shows the cluster spec, a utilization strip (workers up in grey, cores busy in colour), avg / p95 load, estimated DBUs and a right-sizing hint, over the job's run nearest the playhead (or the Day span, when it's narrower than the day).
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

Snapshot warnings are grouped by kind behind ⚠ N, in plain wording; items naming a task select it, and items naming a job select its pipeline.

The compute section's badge (in the Inspector) says which of these are real for the cluster in view.

Drop the snapshot onto the app; it's kept in IndexedDB, so a reload brings it back. A file that claims to be a snapshot but isn't usable (another version, missing fields) is reported with what's wrong. Layouts follow the workspace and catalogs rather than the file, so tomorrow's export keeps today's positions for the tables that are still there and places only the new ones.

Big workspaces need narrowing. When a schema has more than 150 tables, a fresh layout starts with header-only cards and only the tables shown pipelines touch (the *Showing* bar says so). The Navigator's filter, status chips and *Show only these N* narrow pipelines, and *Show only this* narrows to one. A filtered view gets its own layout in Stack (labs); past 150 tables it's computed in a background worker, and the full layout's positions stand in until it lands. The Day timeline only lists shown pipelines, has a row filter and **Lit only** (the selected pipeline, or those that ran in the window), and keeps its time axis in view while you scroll.

`pnpm test:scale` and `pnpm bench` hold the load path to timing budgets at the 600-table snapshot shape (`src/bench/budgets.ts`); the **Snapshot shape (608)** dev preset loads the same synthetic graph.

The export also writes its raw payloads to `snapshots/.raw/`, so `--from-raw <file>` can redo the mapping offline. Anything it can't map shows up as a warning: ⚠ N next to the dataset chip. One example is lineage from `dbutils.notebook.run` runs, which carry no link to their job.

## Structure

`graph → deriveView (hide / collapse / detail) → mode.place → Placement → scene`

- `src/view/`: `deriveView` (grouping, collapse, jobs and lineage flows), `hops`, `findPaths`, `runOrder`, and the list helpers `labels` (shared affixes), `search` (ranking), `scope` (what the picture leaves out), `groups` and `runs`. All are pure.
- `src/parse/`: DBML (`dbml.ts`), notes and medallion inference (`notes.ts`), and the workflow file and merge (`workflows.ts`).
- `src/layout/modes/`: `diagram` (2D) and `flow` (3D), plus the lab layouts `stack` and `orbit`, each turning the view into world-space positions and card orientations. `jobs.ts` then places jobs in any mode, and `compute.ts` places clusters under them.
- `src/ui/`: the shell. `Navigator` (scope), `Inspector` (the selection, with `ComputeSection`), `Timeline` (the Day dock), `Toolbar`, and `select.ts` (selecting and framing). `src/labs.ts` gates the lab layouts.
- `src/ingest/`: the snapshot format, and in `databricks/` the pure mapping from workspace payloads to DBML, a workflow file and a `Schedule`. `scripts/export-databricks.ts` fetches them.
- `src/sim/`: the simulated day (`schedule.ts`) and Spark execution and utilization (`spark.ts`). Both are pure and deterministic.
- `src/layout/depth.ts`: FK depth (longest path, with cycles broken) and domain rank.
- `src/scene/anim.ts`: eases cards and plates toward their placement targets. Wires follow the animated transforms.

Stack: Vite, React, react-three-fiber + drei, `@dbml/core`, zustand, d3-force, yaml.
