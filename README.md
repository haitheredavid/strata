# strata

Prototype: DBML schemas as a 3D diagram with switchable layouts. Each `TableGroup` is a domain.

```sh
pnpm install
pnpm dev         # loads the last sample (commerce by default)
pnpm test
```

## Layout modes

The toolbar switches between modes. Switching animates, and each table keeps its identity as it moves.

- **Stack**: each domain is a horizontal layer stacked on Y. Refs inside a domain stay on the plate; refs between domains wire between layers. Tables are placed with d3-force, and you can drag them.
- **Flow**: each domain is an upright slab, ordered left to right by FK dependency. Domains that are referenced come first (upstream), and domains that reference them follow (downstream). On each slab, sub-columns follow FK depth within the domain, and rows are ordered by barycenter sweeps to reduce crossings. Focusing a table lifts its neighborhood off the slab. You can drag cards on their slab and reorder domains with ←/→.
- **Orbit**: the focused table sits at the center (or the most connected table, if nothing is focused). Tables it references sit on rings above it and tables that reference it sit below, one ring per hop. Tables outside the hop range sit on a faded outer ring. Click a table to re-center on it.

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
  - Flow mode adds a translucent lane for each pipeline.
- **Triggers** label each pipeline's first jobs (CRON / FILE / ON UPDATE / AFTER / STREAMING). Dotted links run from the tables or the upstream pipeline that start it.
- **Events** are amber markers on the jobs that emit them.
- **Pipelines panel**:
  - show / hide each pipeline;
  - ◎ lights up everything a pipeline touches;
  - ▶ plays a run step by step: tasks that can run in parallel share a step, reads pulse in and then writes pulse out. The timeline has play / pause / step, speed, and an optional camera follow.
- The workflow file is remembered for each schema, so a reload keeps it.

## Structure

`graph → deriveView (hide / collapse / detail) → mode.place → Placement → scene`

- `src/view/`: `deriveView` (grouping, collapse, jobs and lineage flows), `hops`, `findPaths` and `runOrder`. All are pure.
- `src/parse/`: DBML (`dbml.ts`), notes and medallion inference (`notes.ts`), and the workflow file and merge (`workflows.ts`).
- `src/layout/modes/`: `stack`, `flow` and `orbit`, each turning the view into world-space positions and card orientations. `jobs.ts` then places jobs in any mode.
- `src/layout/depth.ts`: FK depth (longest path, with cycles broken) and domain rank.
- `src/scene/anim.ts`: eases cards and plates toward their placement targets. Wires follow the animated transforms.

Stack: Vite, React, react-three-fiber + drei, `@dbml/core`, zustand, d3-force, yaml.
