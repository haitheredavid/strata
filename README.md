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
- **Flow**: each domain is an upright slab, ordered left to right by FK dependency. Domains that are referenced come first (upstream), and domains that reference them follow (downstream). On each slab, sub-columns follow FK depth within the domain, and rows are ordered by barycenter sweeps to reduce crossings. Focusing a table lifts its neighborhood off the slab. You can drag cards on their slab and reorder domains with ←/→.
- **Orbit**: the focused table sits at the center (or the most connected table, if nothing is focused). Tables it references sit on rings above it and tables that reference it sit below, one ring per hop. Tables outside the hop range sit on a faded outer ring. Click a table to re-center on it.
- **Diagram**: Flow's arrangement laid flat on the ground, with domains left to right and rows top to bottom. The lens narrows to a near-orthographic 3° (a dolly zoom that keeps the framing), so it reads like a 2D lineage diagram. Press Top for the straight-down view, and switch to Flow to watch each column stand up into its slab.

## Exploring

- **Focus depth**: `up + table + down` hop counts, as in dbt's `2+model+1`. It dims everything outside that neighborhood, in every mode.
- **Path**: click Path, or focus a table and Shift-click a second one. This lists every join path between the two tables, up to one hop longer than the shortest, as join chains. Click a path to isolate it. "Avoid" removes hub tables from the search.
- **Columns**: show all columns, keys only, or headers only. Double-click a card to fold just that card.
- **Domains**: collapse a domain to a single card (refs into it are merged and shown with ×N), or hide or isolate it.
- Search flies to a table. Iso / Top / Side (Front in Flow) are camera presets.
- The layout (mode, positions, domain order, column detail) autosaves to localStorage for each schema. You can also export and import it as JSON.

## Pipelines, jobs and medallion layers

Load the **Lakehouse sample** from the Samples menu, or drop a `.dbml` together with a workflow file.

- **Workflow file** (`*.workflows.yaml` or `.json`, loaded with Open DBML or Open workflows): pipelines made of tasks that read and write tables, shaped like Databricks Jobs. A DAB-style `resources.jobs` map also works.
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
  - Problems show as warnings in the panel instead of failing the load.
- **DBML notes**:
  - A table note can say which job builds it, with `job: clean_orders`, `from: bronze.orders_raw`, `emits: …` and `pipeline: …`.
  - A TableGroup note can set `pipeline:` and `trigger: schedule 0 2 * * *` for the jobs of its tables.
  - Notes and the workflow file are merged by task id; the file wins on conflicts.
- **Medallion layer** is taken from a `medallion:` note, then the schema name (bronze/raw, silver/clean, gold/curated), then a `brz_`/`slv_`/`gld_` prefix. Cards show a B/S/G chip.
- **Group by Medallion** lays out by layer instead of by domain. In Flow this reads sources → bronze → silver → gold, left to right.
- **Edges**: FK, Lineage or Both.
- **Lineage drawing**:
  - Jobs are hexagons placed between what they read and what they write.
  - Lineage wires are dashed, in the pipeline's colour, with pulses moving downstream.
  - Pulse size shows bytes per run (log scale) and the number of pulses on a wire shows runs per day: a daily batch is one dot, streaming a dense train. Set `bytes: 4GB` on a task to give its size; otherwise it is simulated from the medallion layer. Hover a job for its bytes in / out and runs a day.
  - Flow mode adds a translucent lane for each pipeline.
- **Triggers** label each pipeline's first jobs (CRON / FILE / ON UPDATE / AFTER / STREAMING). Dotted links run from the tables or the upstream pipeline that start it.
- **Events** are amber markers on the jobs that emit them.
- **Pipelines panel**:
  - show / hide each pipeline;
  - ◎ lights up everything a pipeline touches;
  - ▶ opens the day timeline on that pipeline's first run, with the pipeline lit up.
- The workflow file is remembered for each schema, so a reload keeps it.

## Day timeline

**Timeline** in the toolbar (or ▶ on a pipeline) opens a simulated day of runs across every pipeline.

- **Start times** come from each pipeline's trigger:
  - cron schedules fire at their times; file arrivals land three times a day; manual runs at 09:00; continuous runs all day.
  - `after:` pipelines start when the upstream run ends. Table-update pipelines start 60 s after a watched table is written.
  - A pipeline that is still running queues at most one more run.
- **Durations** come from the medallion layer a task writes (silver heaviest), scaled by how many tables it reads. A task's `duration: 12m` in the workflow file overrides this. Job clusters add a cold start once per run.
- **Rows**: one row per pipeline and one bar per task run.
  - The hatched start of a bar is queueing or cluster start-up. Its left edge is the medallion layer it writes, and ◆ marks an emitted event.
  - Hover a bar for times and the cluster it ran on. Click it to focus that job.
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

**All compute data is simulated.** It follows the shape of the real sources, so an importer could replace it later:

| Shown | Real source |
| --- | --- |
| Task start / end, cluster used | `system.lakeflow.job_task_run_timeline` (`compute_ids`) |
| Cluster spec | `system.compute.clusters` |
| Workers up, CPU busy | `system.compute.node_timeline` |
| Spark jobs, stages, tasks, shuffle, spill | Spark event log (`SparkListenerJobStart`, `SparkListenerStageCompleted`, `SparkListenerTaskEnd`) |

## Structure

`graph → deriveView (hide / collapse / detail) → mode.place → Placement → scene`

- `src/view/`: `deriveView` (grouping, collapse, jobs and lineage flows), `hops`, `findPaths` and `runOrder`. All are pure.
- `src/parse/`: DBML (`dbml.ts`), notes and medallion inference (`notes.ts`), and the workflow file and merge (`workflows.ts`).
- `src/layout/modes/`: `stack`, `flow` and `orbit`, each turning the view into world-space positions and card orientations. `jobs.ts` then places jobs in any mode, and `compute.ts` places clusters under them.
- `src/sim/`: the simulated day (`schedule.ts`) and Spark execution and utilization (`spark.ts`). Both are pure and deterministic.
- `src/layout/depth.ts`: FK depth (longest path, with cycles broken) and domain rank.
- `src/scene/anim.ts`: eases cards and plates toward their placement targets. Wires follow the animated transforms.

Stack: Vite, React, react-three-fiber + drei, `@dbml/core`, zustand, d3-force, yaml.
