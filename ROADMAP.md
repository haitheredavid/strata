# Roadmap

strata is a prototype. It can now load a real Databricks workspace slice (`pnpm export:databricks`, then drop the `.snapshot.json`). Before pointing it at an active workspace every day, the prototype needs a solid core: one way to load data, one model for selection and visibility, visible feedback, and controls that hold up at hundreds of tables and pipelines. The phases are ordered; each leaves the app shippable.

## Phase 1: Solid prototype (interfaces and interactions) — done

Goal: every load goes through one path, every highlight and visibility rule is explicit, and the UI reports what it is doing.

*Landed 2026-10-17 in five slices (`c0a7d14`, `22439ed`, `a0729f9`, `4afa6b9` and the density commit). Where it differs from the items below:* highlights keep `lensPipeline` / `focusedId` / the path fields as their inputs and resolve them in `view/highlight.ts` (a scope from timeline or lens, a probe from path or focus) rather than one `highlight` field; layers get ◐ "only this" but no ◎ layer lens; datasets keep the five most recent files and snapshots, not one stash.

1. **Names and dead code.** Rename `focusedTableId` → `focusedId`, `hoveredTableId` → `hoveredId` and `CameraCommand.fly.tableId` → `id`, since they hold jobs and clusters too. Delete `layerVisible` in `store.ts`, which has no callers.
2. **One view-options source.** `sceneView` / `viewInputs` (in `view/deriveView.ts` and `store.ts`) are the canonical inputs. Move `LayerPanel`'s `fullView` and `moveLayer`'s bare `deriveView(s.graph)` onto them. This fixes `moveLayer` reordering an FK-only view in Flow/Diagram while the panel shows the lineage view.
   *Done when:* outside tests and `src/bench/`, `deriveView(` is called only from `sceneView` and `deriveView.ts` itself.
3. **Notices and status.** Add store `notices` (level, text, dismissible) and `status` (loading phase). Route these into one notices area: load errors that are swallowed today (sample `fetch`, `loadSidecar` parse, `loadFiles`/`loadLast` rejections, stash write failures), workflow warnings (today they only show inside the Pipelines section, which isn't mounted without pipelines), and the worker-layout "laying out…" phase. Replace raw `useStore.setState({ error })` calls with a `notify` action. Update the drop overlay text to mention snapshots, and stop it flickering on child drag-leave.
   *Done when:* a broken `.dbml`, a non-snapshot `.json` with no pipelines, and a 600-table load all show an in-app notice or status.
4. **Keyboard.** Ignore global keys while an input has focus. Esc clears one level at a time (path → lens → focus → isolate → timeline span). Add `/` for search, `T` for timeline, and `1`–`4` for modes. In `TablePicker`, ↑/↓ moves through results and the search covers jobs and clusters.
5. **`Dataset` and a single load path.** Define `Dataset { key, origin: 'sample' | 'file' | 'snapshot' | 'synth', label, source, sidecar, graph, schedule, warnings, meta?: { host, day, tz } }`, built by pure functions. One store action `load(dataset)` replaces `loadSchema` / `loadGraph` / `loadSnapshot`. It also normalises the saved layout against the graph (pruning stale `hiddenPipelines`, `collapsedCards` and `flowOrder` ids). The `scheduleFor` WeakMap goes away in favour of `dataset.schedule`. Loading a workflow file rebuilds the dataset and keeps a snapshot's runs. Split `ui/files.ts` into dataset builders, persistence (stash and last choice for every origin, including dropped files) and a thin file router.
   *Done when:* reloading after any load reopens it, and opening a workflow file over a snapshot keeps the timeline's `day · tz` badge.
6. **Toolbar.** Replace "Open DBML" and "Open workflows" with one **Open…** that sniffs the content. The Samples menu becomes **Datasets** (samples, the stashed snapshot as "host · day", dev synth presets) with **Forget snapshot**. Layout import/export moves to an overflow menu. Show a dataset chip (origin, host · day, warning count).
7. **One highlight and visibility model.** A single `highlight` (focus | lens | path | time) with stated precedence, shown in the panel as "Lit by: … ✕". Layer isolate and pipeline solo share one "only this" rule and glyph (●/○ show, ◐ only this, ◎ light up). The compute drawer closes without clearing focus. `openTimeline` / `setLens` turn lineage on themselves and say so in a notice. Decide and document what persists per dataset (visibility, mode, edges).
8. **Density at workspace size** (about 600 tables, 93 pipelines, 10+ domains): layer filter and hover-revealed row actions; pipeline list grouped by trigger or domain with a case-insensitive filter; timeline row filter plus "lit only"; Focus depth shown only while something is focused.

## Phase 2: Snapshot and exporter hardening — done

Goal: exports of an active workspace can be repeated and fail loudly and partially, never silently.

*Landed 2026-10-17. Where it differs from the items below:* the statement deadline is per statement (`--sql-timeout`, default 15 min) rather than one for the whole export; results always use `EXTERNAL_LINKS`; snapshot entries were already keyed by host + day by Phase 1's datasets; the CI guard covers any tracked `*.snapshot.json` / `*.raw.json`, not just `public/`. Exporter-only helpers (`exportArgs.ts`, `retry.ts`) live in `scripts/` because they use Node APIs.

- **Snapshot format:** validate `version` and the required fields (`workflows`, `runs.taskRuns`, `day`, `tz`) with a clear error. Key stash entries by host + day (`listSnapshots`, `forgetSnapshot`). Key layouts by host + catalog instead of `hash(dbml)`, so a daily re-export keeps positions for tables that still exist.
- **Exporter (`scripts/export-databricks.ts`):**
  - **Arguments:** report argument errors cleanly, validate `--tz` and `--lineage-days`, and warn about flags `--from-raw` ignores.
  - **Partial failure:** save raw payloads per step (or add `--resume`) so a mid-run failure keeps what was fetched.
  - **SQL:** add an overall deadline and cancel on Ctrl-C, use `EXTERNAL_LINKS` for large results, and run one statement per id chunk.
  - **Errors:** retry with backoff on 429 and 5xx, and turn silent `.catch(() => null)` drops into warnings.
  - **Warehouse:** require `--warehouse` or look it up via `warehouses list`, instead of the experimental `aitools` command.
- **Typecheck and tests:** move the pure SQL helpers (`sliceWhere`, `like`, `lit`, chunking) into `src/ingest/databricks/sql.ts` with tests, and bring `scripts/` under `tsc`. Add tests for store load paths, file routing and the stash.
- **Privacy:** CI fails if `public/**/*.snapshot.json` exists.

## Phase 3: Real-data fidelity — done, except Spark event logs

Goal: when a snapshot has real data, nothing on screen is simulated without saying so.

*Landed 2026-10-17.* Pulse bytes are split evenly over a task's tables (statements don't say which table they touched). Serverless utilization is shown as cores in use, not a busy share. Warnings are grouped in the app from the known message templates, so snapshots exported earlier group too. **Not done: Spark event logs.** No cluster in either the prod or the test workspace configures cluster log delivery (`cluster_log_conf` is absent from every exported job and cluster), so there are no event logs to read; classic clusters' flame charts stay simulated and say so. Revisit if log delivery is turned on.

- Pulse size from `system.query.history` read/written bytes when statements exist (`sim/volume.ts` ignores them today).
- Serverless utilization from statement parallelism (the compute badge already names it).
- Optional Spark event logs from cluster log delivery for classic clusters' flame charts.
- DST-correct days: the day ends at the next local midnight, not `+86 400 s`, in the exporter and `runsToSchedule`, and the timeline length follows.
- Lineage-attribution warnings grouped with counts and links to the affected job.
- Wording: README and Timeline say "simulated unless a snapshot is loaded".

## Phase 4: Large-workspace scale — done, flow layout stays on the main thread

Goal: a full catalog (thousands of tables, hundreds of pipelines) stays interactive in every mode.

*Landed 2026-10-17.* Tall flow sub-columns wrap into a near-square grid; Diagram follows. Filtered stacks of any size get their own layout, from a worker past 150 tables. Orbit's out-of-range tables fill concentric rings into a disk instead of one ring. Past 12 pipelines, colours follow the domain a pipeline writes (shaded within it) and only lit lanes are drawn; grouping by job prefix was left out, since domain is what the Pipelines panel already groups by. Budgets live in `src/bench/budgets.ts`, used by `test:scale` and `pnpm bench`, with a **Snapshot shape (608)** dev preset. **Deviation:** FK depth and barycenter sweeps stay on the main thread. At the 608-table shape a cold flow placement takes about 20 ms (about 100 ms at 20k tables) and is cached per view, so a worker round trip would cost more than it saves.

- Flow/Diagram: a size threshold that wraps tall columns into a grid, and moves FK depth and barycenter sweeps into the layout worker.
- Filtered stack views over `MAX_DERIVED` get their own worker layout instead of falling back to stored positions.
- Orbit: cap or cluster the out-of-range ring.
- Pipeline lanes and colours grouped by job prefix or domain; unfocused lanes fade.
- `test:scale` and the bench gain timing budgets for the 600-table snapshot shape (use `src/dev/synth.ts` presets, since real snapshots stay out of git).

## Phase 5: Product shell (core interactions) — done

Goal: narrow the prototype to one loop (search → select → inspect → trace up or downstream → scrub the day) in a layout where panels don't cover the scene.

*Started 2026-10-17 from a UI/UX review run against the 600-table snapshot.* The first fixes came before the shell: the dock stopped at the side panel, the plain timeline opens with the whole day as its span so the scene isn't dark, timeline bars are at least 6 px and a click up to 6 px off picks the nearest run in that lane, Navigator rows don't reserve width for hidden buttons (pipeline names were cut to 3–8 characters), the layer list and `moveLayer` skip layers the view leaves out, and the unused `App.css` is gone.

*Landed the same day. Where it differs from the items below:*
- **Selection state:** `focusedId` (node) and `lensPipeline` (pipeline) stay as two store fields, but they're now exclusive: setting one clears the other. Scope stays in `layout`.
- **Selecting and framing:** selecting from search, a link or a timeline bar frames the node with its direct neighbours. This replaces the camera's `fly` command, which was removed. Framing keeps the current viewing direction, so 2D stays square on.
- **Neighbourhood:** a table's neighbourhood (`hops`) now follows lineage as well as FKs, and jobs don't count as a hop. With no FKs in Unity Catalog, selecting a table used to light only itself. Orbit (labs) gets lineage hops through the same function.
- **Day:** the dock sits under the Navigator and the diagram, and you drag its top edge to make it taller. There's no separate full-height Day layout.
- **Inspector:** a table lists the jobs that write and read it, and its FK neighbours, rather than a transitive list of upstream and downstream tables. Lists longer than 12 start folded.
- **Selection the filters hide:** the Inspector says so, and offers **Show all tables** when "In shown pipelines" is the cause.
- **Search** finds pipelines too.
- **Labels:**
  - Card labels fade in by on-screen size in the text shader.
  - The selection, hover and lit nodes get callouts while 12 or fewer are lit.
  - A node with six or more wires on one side bundles them.
  - Pipelines past eight take colours from a fixed 32-colour list.

1. **Fixed shell.** Toolbar, left **Navigator**, centre canvas, right **Inspector**, bottom **Day** dock (resizable). Nothing floats over the canvas apart from the Lit-by trail and a corner camera control (Iso / Top / Side). The camera frames inside whatever the panels leave visible, replacing `PANEL_SHIFT`.
2. **Inspector.** Replaces the Focus section, the Path section and the compute drawer.
   - **Table:** full UC name, medallion, columns, upstream and downstream tables and jobs as links, the jobs that write it and their last run.
   - **Job:** trigger, today's runs and failures, reads and writes, compute (spec, utilization, flame).
   - **Cluster:** spec, utilization, the jobs it runs.
   - **Actions:** Find path to…, Solo, Open in Day.
   *Done when:* selecting anything shows its details without scrolling, at 1280×800.
3. **Scope / Selection / Time.** Fold the eleven visibility and highlight inputs into three concepts:
   - **Scope** (Navigator, saved per dataset) covers hide and only-this for layers and pipelines, tables-only and collapse.
   - **Selection** (Inspector) covers focus, lens, path ends and hops. Selecting a pipeline lights it, so lens and focus merge.
   - **Time** (Day dock) covers playhead, span and lit-only.
   Group by, edges and columns move to a **View ▾** menu.
4. **Navigator rows.** A checkbox for scope. Clicking the row selects it. Solo, fold and reorder move to a row menu, replacing the ● ○ ◐ ◎ ▶ ⊟ ↑ ↓ glyph buttons. Full names wrap or show on hover.
5. **Two views.** **Lineage**: Diagram from above by default, with *Lift to 3D* for Flow's slabs. **Day**: the timeline full height, with the lineage view as a small view kept in sync. Stack and Orbit go behind a labs flag. If Orbit stays, it uses lineage hops, since Unity Catalog snapshots have no FKs and every table lands in its out-of-range disk.
6. **Day dock.** Clicking a bar selects the job and moves the camera to it. Speed reads `×1800`, not `30m/s`. The header fits on one line at 1280 px. Snapshot warnings stay behind the ⚠ chip instead of opening expanded over the scene, and use user-facing wording.
7. **Readability at 600+ tables.** Short labels (`prime_contracts`, with `gold.procore` as secondary text). Labels that appear with zoom in Diagram. Bundled edges for hub jobs (one job writing 40 tables draws a star). Pipeline colours that stay distinct past 12. The toolbar fits on one row at 1280 px.
