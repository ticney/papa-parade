# Story 1.8: The Baby Lives in the Living Room

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.8 « Le bébé vit dans le salon ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see the baby (a sphere) explore the living room while babbling,
so that I feel it is alive and unpredictable.

**Requirements covered:** FR15 (first half: the baby moves on its own and looks where it goes; target choice and gaze lock arrive with story 1.10), NFR4 / NFR12 (movement in sim time, testable in Node), FR66 (the baby lives with no human input). It is the **second agent of the sim**, the first system that draws from `world.rng`, and the baby slice that stories 1.9 (babble sound), 1.10 (target lock, approach), 1.21 (silent mischief) and 4.1 (carried) build on.

## Precondition (check first, stop if it fails)

Story 1.7 is in `review` (implementation committed as `adc3ea2`, review not yet run). Start only when 1.7 is `done` in `sprint-status.yaml` and its review fixes are committed (`git status` clean apart from `_bmad-output/`). If not, stop and tell Geo: this story edits several of the same files (`createSim.ts`, `world.ts`, `step.ts`, `snapshot.ts`, `walk.ts`, `levelScene.ts`, `levelSession.ts`, `boot.ts`, `tests/e2e/support/game.ts`, `move.spec.ts`). Build on whatever the 1.7 review changed; do not revert any of it.

## Acceptance Criteria

From the epic (1 to 3), then derived from the architecture and the existing tests (4 to 7).

1. **Wander and babble.** Given the baby at `ANCHOR_baby_spawn`, when the game runs with no threat planned, then its FSM alternates `wander` and `babble` (transitions only through `enterBabyState`, which emits `BabyStateChanged{t, from, to}`), and it crawls on the navigation grid at `feel.json` `baby.crawlSpeedMps`.
2. **Seeded destinations.** And its destinations (and how long it sits babbling) are drawn from the world's PRNG only: same seed, same trajectory; another seed, another trajectory.
3. **Babbling.** Given `world.baby.babbling`, when the baby is in `wander` or `babble`, then `babbling` is `true` (the babble sound arrives in story 1.9; nothing in this story sets it to `false`).
4. **Baby on screen.** The baby is drawn as a provisional toon sphere (radius `baby.bodyRadiusM`) with a gaze marker and a blob shadow; its position is interpolated between the last two steps and its gaze marker points where it crawls (D7).
5. **Deterministic.** A new golden scenario `baby_wander` passes; a snapshot taken mid-wander and restored with its journal tail gives the same world hash as the uninterrupted run; `core_basic` and `papa_walk` are regenerated deliberately.
6. **No regression.** Papa's movement (story 1.7) is unchanged: every `papaSystem`, `walk`, nav and `move.spec.ts` case still passes (edits limited to D10 and D11). The baby never blocks Papa and Papa never blocks the baby.
7. **Quality gates.** `npm run ci` passes. `biome.json` and the existing `tests/architecture/*.test.ts` are untouched. No new npm dependency. `src/sim` coverage stays ≥ 90 %. Golden references are regenerated **deliberately** (`npm run golden:update`) and the Completion Notes say which and why.

## Tasks / Subtasks

- [ ] **T0: Precondition (all ACs)** — check the Precondition section; `git status` clean; `npm run ci` green before the first edit (so any later failure is yours).
- [ ] **T1: Feel (AC 1, 2, 4)**
  - [ ] `FeelSchema` (`src/content/schemas/feel.ts`): new section `baby` (Dev Notes › Feel), `.describe` on every key with its unit, same style as `MovementSchema`; two `.refine`s: `babbleMinMs <= babbleMaxMs`, `wanderMinDistM <= wanderMaxDistM` (same shape as the fatigue refine).
  - [ ] `content/feel.json` and the frozen fixture `tests/support/testFeel.json`: the same six keys and values.
  - [ ] `npm run content:schemas` (regenerates `content/_schemas/feel.schema.json`; never edit it by hand), then `npm run content:check`. Add good and bad cases to `tests/content/feelSchema.test.ts` (each refine, a negative speed, a negative radius).
- [ ] **T2: Shared path following (AC 1, 6)**
  - [ ] Move `advanceAlongPath` from `src/sim/papa/walk.ts` to a new `src/sim/nav/followPath.ts`, typed on a structural `PathFollower` (`xM`, `zM`, `headingX`, `headingZ`, `path`, `pathIndex`) instead of `PapaSlice` (D6). Move its tests from `walk.test.ts` to `followPath.test.ts` unchanged in substance. `walk.ts` keeps `stepInDirection`; `papaSystem.ts` imports `advanceAlongPath` from `../nav/followPath.ts`. No behaviour change: the `papa_walk` golden events must not change because of this move (check before T5 changes the world).
- [ ] **T3: Baby in the sim (`src/sim/baby/`, AC 1 to 3, 6)**
  - [ ] Events (`events.ts`): `BabyStateChanged{t, from: BabyState, to: BabyState}`. No other baby event (D8).
  - [ ] `babyFsm.ts`: `BabyState = 'wander' | 'babble'` (D1) and `enterBabyState(world, ctx, next)`, the architecture's exact pattern (same as `enterPapaState`).
  - [ ] `World.baby` slice (Dev Notes › Baby in the World), created from `baby_spawn` (snapped to the nearest open cell of the baby's grid if its clearance closes it; an invariant if there is none), starting in `babble` with `wanderAt = feel.baby.babbleMinMs` (D2). Generalise `papaSpawnOf` in `createSim.ts` into one `spawnOf(geometry, grid, anchorId)` used for both; keep its two invariant messages naming the anchor.
  - [ ] `context.ts` / `createSim.ts`: `NavContext.baby: NavGrid`, built once with `clearanceM = feel.baby.bodyRadiusM` (D5). Keep `ctx.nav.papa` as it is.
  - [ ] `wander.ts` (+ test): pure `pickWanderCell(grid, xM, zM, minDistM, maxDistM, rng): number` (D4) and `planWander(baby, grid, cell): boolean` (A* + string pulling into a new `baby.path`, from the baby's exact position to the cell centre). Unit tests on `createTestNavGrid` (tiny hand-drawn grids, Dev Notes › Sim test cases).
  - [ ] `babySystem.ts` (+ test): `runBaby(world, ctx)` per Dev Notes › Movement rules. Reads `ctx.feel.baby` each step (a `SetFeel` changes speed, distances and durations at once; the radius only at the next level).
  - [ ] `step.ts`: `SYSTEMS = [applyCommands, advanceTime, runBaby, runPapa]` (its architecture slot: after the director, before threats and Papa). Update the comment and the pinned order in `step.test.ts`.
  - [ ] `snapshot.ts`: `worldProblem` checks the baby slice (`babyProblem`, same style as `papaProblem`; `BABY_STATES` list). No version bump (D9).
  - [ ] `index.ts`: export `BabyState` and `BabySlice` (the client view and the debug mirrors need them).
- [ ] **T4: Existing tests that see the baby now (AC 6)**
  - [ ] Every test that asserts an **exact** event list from a sim built with the real `SYSTEMS` filters to its own subject (D10): at least `src/sim/papa/papaSystem.test.ts` (`types(events)` → a `papaEvents()` filter); check `timeScale.test.ts`, `createSim.test.ts`, `replay.test.ts`, `snapshot.test.ts`, `determinism.test.ts`, `commandQueue.test.ts` and fix only those that fail. Never weaken what a test proves about its own subject. List each edit in the Completion Notes.
- [ ] **T5: Golden and determinism (AC 2, 5)**
  - [ ] New scenario `baby_wander` in `tests/golden/scenarios.ts` (Dev Notes › Golden scenario) and `tests/golden/babyWander.test.ts`, which pins what it covers (pattern of `papaWalk.test.ts`).
  - [ ] `npm run golden:update`: `core_basic` and `papa_walk` change (world shape, `BabyStateChanged` in `eventTypes`, `feelHash`), `baby_wander` is new. Review all three diffs; check that `papa_walk`'s **papa** events are identical to before (filter the old and new `eventTypes`), so only the baby was added. Say so in the Completion Notes.
  - [ ] `snapshot.test.ts`: a snapshot taken mid-wander (baby in `wander`, path half done), restored with its journal tail, gives the uninterrupted hash; a snapshot world without `baby` is refused with a message naming `world.baby`.
- [ ] **T6: Rendering (AC 4)**
  - [ ] `src/client/render/materials/palette.ts`: add `paper` (DESIGN.md `colors.paper`, `#FFFFFF`, doc line like the others).
  - [ ] `src/client/render/views/babyView.ts` (+ test of the pure maths): Dev Notes › Baby view. `babyPoseAt(baby, alpha, out)` interpolates with `interpolateXZ` and sets `yawRad = atan2(gazeX, gazeZ)`; `update(baby, alpha)` allocates nothing.
  - [ ] `levelScene.ts`: create the baby view next to Papa's; `update(world, alpha)` updates both. `createLevelScene(assets, bodies: { papaRadiusM, babyRadiusM })` (D11); update its doc comment and `LevelScene.update`'s (« Papa and the baby »).
  - [ ] `levelScene.test.ts`: the test « moves Papa with the sim, interpolated, and nothing else » becomes « moves Papa and the baby … »; add the baby to the toon-material test; the dispose test covers the baby's geometries. `levelSession.ts` / `levelSession.test.ts`: pass `{ papaRadiusM: feel.movement.papaRadiusM, babyRadiusM: feel.baby.bodyRadiusM }` to `createScene` (the fake's signature follows).
- [ ] **T7: Debug mirrors (AC 1, 4)**
  - [ ] `boot.ts` (only when `VITE_DEBUG_ALLOWED === 'true'`, event-driven, never per frame): `data-pp-baby-state` (from `BabyStateChanged`), `data-pp-baby-at` (`x,z` with 2 decimals, on `BabyStateChanged`, read from `levelSession.active.sim.world.baby`), both written once when a level enters `level` (`mirrorNewLevel`). Add the two names to the `mirror` union.
- [ ] **T8: End-to-end (AC 1, 4, 6)**
  - [ ] `tests/e2e/support/game.ts`: `babyAt(page)` (parses `data-pp-baby-at`, like `papaAt`).
  - [ ] `tests/e2e/baby.spec.ts` (new, chromium + webkit) per Dev Notes › E2E script.
  - [ ] Existing specs whose **message** claims Papa moved but whose check is a `sceneShot` comparison (the baby now changes the scene on its own): keep every assertion and add a check that is Papa's own, at least in `move.spec.ts` « Papa walks again after the resume », `pauseResume.spec.ts` steps 1 and 5, and the countdown test of `ui.spec.ts`. `data-pp-papa-at` is written on Papa's events only (`PapaStateChanged`, `PapaArrived`, `PapaBlocked`), not per frame: so prove the walk by its end (`walkPath` → `idle`, then `papaAt` differs from its value before the pause), or for a held key, release it after the resume and compare `papaAt` once `idle`. The « nothing moved while paused » `sceneShot` checks stay as they are (they now also prove the baby is frozen).
- [ ] **T9: Docs and verification (AC 7)**
  - [ ] `deferred-work.md`: mark « Clearance per agent from data » resolved in story 1.8 (the baby's radius and grid); move « Inverted-hull outline on Papa » to « Papa and the baby, art pass E7 »; add Dev Notes › Deferred by this story.
  - [ ] Run `npm run lint`, `npm run typecheck` and `npm test` after T3/T4 and after T6, not only at the end. Then `npm run ci` end to end.
  - [ ] Manual check in the built-in browser pane on `npm run dev` (844 × 390): the baby sits at its spawn, then crawls, stops, crawls again, never through furniture, never onto the stairs; its gaze marker faces where it goes; pause freezes it; « Recommencer » puts it back at the spawn; Papa still walks as before and passes through the baby. Screenshots are the evidence; say what was **not** checked (a real phone).
  - [ ] Break things to prove the guards bite, then restore: `babbleMinMs > babbleMaxMs` in a copy of the feel → `content:check` fails; a snapshot world with `baby.state: 'sleep'` → refused; a `Math.random()` in `babySystem.ts` → Biome and `simPurity` fail.
  - [ ] `git status`: only the files of the File List changed; nothing committed.

## Dev Notes

### What exists today (stories 1.1 to 1.7)

- **Sim** (`src/sim/`): `createSim({ content, geometry, seed, journal?, strictInvariants? })`; `World = { time, rng, nextId, papa }`; `SYSTEMS = [applyCommands, advanceTime, runPapa]`; commands `SetTimeScale`, `TapFloor`, `Move`, `MoveStop`; events `TimeScaleChanged`, `PapaStateChanged`, `PapaPathPlanned`, `PapaArrived`, `PapaBlocked`, `InvariantViolated`. `ctx = { feel, events, queue, commands, nav: { papa }, strictInvariants, t, requestFreezeRealMs }`. Journal and snapshot are version 2 and carry `seed`, `feelHash`, `geometryHash`.
- **Nothing draws from `world.rng` yet.** `src/shared/rng.ts` (sfc32): `nextFloat(rng)` in `[0, 1)`, `nextInt(rng, minInclusive, maxExclusive)` (integers only, `min < max`). Only `determinism.test.ts`'s probe system uses them.
- **Navigation** (`src/sim/nav/`): `createNavGrid(geometry, clearanceM)` → `NavGrid` with `open`, `region`, `cellAt`, `centerXM/ZM`, `isOpenAt`, `nearestOpenCell(xM, zM, region)`, its own A* `scratch` (so two grids never share scratch). `findPath(grid, from, to, out)`, `smoothPath(grid, cells, startX, startZ, goalX, goalZ, outPath)`. Clearance is `k = max(0, ceil(clearanceM / cellM − ε))` cells: any radius in `(0, 0.25]` gives `k = 1`, like Papa.
- **Papa** (`src/sim/papa/`): `papaFsm.ts` (`enterPapaState`), `papaSystem.ts` (`runPapa`: writes `prev…`, applies its commands, moves once), `walk.ts` (`advanceAlongPath(papa: PapaSlice, budgetM)`, `stepInDirection`). `tapFloor` in `papaSystem.ts` is the reference for planning: cell checks, `findPath` into `grid.scratch.cells`, then `smoothPath` into a **new** `number[]` that becomes part of the world.
- **Geometry** (frozen copy `tests/support/testLevel.geometry.json`, loaded by `createTestGeometry()`): `baby_spawn (-0.5, 0, 1.2)` is on open floor for `k = 1` (row 16, column 14; rows 15 to 17 fully walkable), so no snapping today. Blocks: sofa, coffee table, side table, counter, stairs (`NAV_block_*`). `behind_sofa` is a `hidden` zone (z from −3.0 to −2.2) reachable along rows 1 and 2.
- **Client**: `levelScene.ts` builds Papa with `createPapaView(scene, toon, shadows.kit, papaRadiusM)`; `papaView.ts` is the pattern to copy (pure `papaPoseAt` + allocation-free `update`, art constants at the top, `blobs.createMesh`, `blobSizeM`). `PALETTE` has `cream`, `ink`, `primary`. `boot.ts` mirrors Papa on events (`mirrorPapaEvent`, `mirrorNewLevel`).
- **E2E**: `sceneShot` hides the DOM layers; several tests use « the scene changed » to prove the sim runs (`pauseResume.spec.ts`, `ui.spec.ts` countdown test, `move.spec.ts`). Draw calls are capped at 100 (`level.spec.ts`), and « Recommencer » must leave the same geometries / textures counts (the baby view must dispose its geometries).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | `BabyState` holds only `'wander' \| 'babble'` today. Each later story adds its states to the union, to `BABY_STATES` in `snapshot.ts` and to the system: `targetLocked`, `approach`, `act` (1.10), `mischiefSilent` (1.21), `carried` (4.1), `gagRecovery` (with the gags). | A state nothing can enter is dead code that the snapshot check would accept. The architecture union is the target, not today's contract. |
| D2 | The baby starts in `babble` at its spawn, with `wanderAt = feel.baby.babbleMinMs` (no draw). The first `BabyStateChanged` is `babble → wander` at the first step where `time.sim >= wanderAt`. | The level opens calm, with the baby sitting and babbling. No rng draw before the first step, and short tests (`timeScale.test.ts`: 5 steps, `createSim.test.ts`: 3 steps) see no baby event with the frozen feel. |
| D3 | `babble` ends at a deadline, `world.baby.wanderAt` (sim time), not at `enteredAt + duration`. When a wander cannot be planned (no candidate cell, A* fails), the baby stays in `babble` and `wanderAt` moves to `now + a new draw`. | `enterBabyState('babble')` from `babble` is a no-op (the pattern), so `enteredAt` cannot be reset; without a deadline it would retry, and draw, every step. `…At` is the project's name for a sim time. |
| D4 | Destination: among the open cells of the baby's current region (baby grid), those whose centre is at a squared distance from the baby in `[wanderMinDistM², wanderMaxDistM²]` (no `sqrt`), counted in index order; one `nextInt(rng, 0, count)` picks the k-th. If `count = 0`, the same with every open cell of the region except the baby's own; if still none, D3's failure path (no destination draw). The destination is the cell centre. | Uniform, deterministic, bounded (two passes over 768 cells per decision, a few times a minute), no allocation, no rejection loop with a variable number of draws. |
| D5 | The baby has its own grid, `ctx.nav.baby = createNavGrid(geometry, feel.baby.bodyRadiusM)`, read once at `createSim` (like Papa's). Papa and the baby never collide: each walks on its own grid and ignores the other. | Story 1.7 D3 planned per-agent grids. Kinematic characters on the floor grid (architecture › Physique); a crawler blocking Papa's path would be a design question, not this story's (Open point 4). |
| D6 | `advanceAlongPath` moves to `src/sim/nav/followPath.ts` and takes a structural `PathFollower`. | Papa (walk), the baby (crawl) and the glide of story 1.10 all follow a smoothed path. A baby system importing from `papa/` would tie two domains together. |
| D7 | The slice keeps **two** unit vectors: `heading` (the body's direction of travel, written by `advanceAlongPath`) and `gaze` (where the eyes look, what the view draws). In this story `runBaby` copies heading to gaze every step of `wander` and leaves gaze alone in `babble`. Story 1.10 locks gaze on the target while the body may still turn (`approach`). | The epic: « son regard suit la direction de marche » now, and « son regard se verrouille sur sa cible » in 1.10 (FR15, GDD › Micro-boucle). The view reads gaze only, so 1.10 does not change the view contract. The gaze lock is diegetic (EXPERIENCE.md › HUD & Diegetic UI). |
| D8 | One event only: `BabyStateChanged`. No `BabyPathPlanned` / `BabyArrived`. | The epic asks for `BabyStateChanged`; arrival is `wander → babble`. The client reads positions from the world. Fewer events in every golden. |
| D9 | No snapshot or journal version bump. `worldProblem` refuses a world without a valid `baby` with a message naming the field. Old journals are refused anyway: the feel gained a section, so `feelHash` differs. | The envelope does not change (story 1.7 bumped because it added `geometryHash`). A clear refusal is what matters. |
| D10 | A unit test that asserts an exact event list from a sim with the real `SYSTEMS` filters to its subject (papa events in `papaSystem.test.ts`, …). Tests that need the baby out of the way may also use `createSimWithSystems` without `runBaby`, but only where the baby is irrelevant to what is proved. | Each test keeps proving what it proved; the baby's events are proved by its own tests and the golden. |
| D11 | `createLevelScene(assets, bodies: { papaRadiusM: number; babyRadiusM: number })`. The scene never imports content JSON; `levelSession` passes the feel's values. | Story 1.7 passed `papaRadiusM` alone; a second number in an options object stays readable. |
| D12 | Baby view: a sphere of radius `baby.bodyRadiusM` in `PALETTE.paper`, a small `PALETTE.ink` gaze marker (a cone or a flattened sphere) on its surface at about eye height pointing along +z of a group turned by `yawRad`, and a blob shadow. Three draw calls; no outline. | Readable on the floor and the sofa from the iso camera, never a threat colour (`parry`, `dodge`, `alert`) nor the `smell` green of story 5.3. Papa is `primary`; white keeps them apart. |

### Feel (`content/feel.json`, new section `baby`)

| Key | Value | Schema | Meaning |
|---|---|---|---|
| `crawlSpeedMps` | `0.6` | `> 0` | Crawling speed while wandering, in metres per second. |
| `bodyRadiusM` | `0.2` | `>= 0` | The baby's half width: its centre stays this far from furniture and walls; also the sphere's radius. Read once when the level starts (a `SetFeel` takes effect at the next level). |
| `babbleMinMs` | `1500` | `>= 0` | Shortest sit-and-babble pause between two wanders, in ms; also the first pause at the level start (D2). |
| `babbleMaxMs` | `4000` | `>= 0`, `>= babbleMinMs` | Longest pause, in ms. |
| `wanderMinDistM` | `1` | `>= 0` | A new destination is at least this far from where the baby sits, in metres. |
| `wanderMaxDistM` | `3.5` | `> 0`, `>= wanderMinDistM` | …and at most this far, in metres. |

Starting values, not GDD numbers (the GDD gives none): Open point 1. The section's description cites FR15 and GDD › Micro-boucle (« l'enfant repère un danger » comes later; here it explores).

### Baby in the World

```ts
baby: {
  state: BabyState;            // 'wander' | 'babble' (D1)
  enteredAt: SimMs;
  xM: number; zM: number;      // on the floor plane (y = 0)
  prevXM: number; prevZM: number;
  headingX: number; headingZ: number; // unit vector, direction of travel; (0, 1) at spawn
  gazeX: number; gazeZ: number;       // unit vector, where it looks; (0, 1) at spawn (D7)
  path: number[];              // flat waypoints still ahead, wander only (empty otherwise)
  pathIndex: number;           // next waypoint, in points
  wanderAt: SimMs;             // babble only: when it sets off again (D3)
  babbling: boolean;           // true in wander and babble (AC 3); story 1.21 sets it to false
}
```

Plain data (JSON round trip equal); same field names as `PapaSlice` where they mean the same thing, so `advanceAlongPath` and `interpolateXZ` serve both. `createWorld` takes the baby's spawn and the first `wanderAt`; pick a readable signature (an options object is welcome now that there are two spawns).

### Movement rules (`babySystem.ts`)

Per step, in this order:

1. `prevXM/prevZM ← xM/zM`.
2. **`babble`** and `time.sim >= wanderAt`: `cell = pickWanderCell(…)` (D4, at most one draw); if `cell >= 0` and `planWander` succeeds → `enterBabyState('wander')`; else `wanderAt = time.sim + draw` (D3).
3. **`wander`** (including one just entered: like Papa, planning and the first movement happen in the same step): `advanceAlongPath(baby, crawlSpeedMps × STEP_MS / 1000)`; then `gaze ← heading`. On arrival: clear the path, `wanderAt = time.sim + draw`, `enterBabyState('babble')`.
4. Draw of a pause: `babbleMinMs + nextFloat(rng) × (babbleMaxMs − babbleMinMs)` (one `nextFloat`, even when min = max, so the draw count does not depend on tuning). The draw order (destination, then pause on arrival) is part of every golden: keep it.
5. The baby's own cell not open (impossible after spawn snapping, but cheap): snap to the nearest open cell of any region before planning, no event (same as Papa).
6. `babbling` stays `true`. No `Math.sqrt` needed except inside the shared path helpers; no trigonometry, no `Math.hypot` (story 1.7 D15).

Budget: 6 mm per step at 0.6 m/s; slow-mo slows the baby on its own (steps are sim time). The hot path allocates nothing; one `number[]` per planned wander (event-driven, a few per minute) is fine, as for Papa's taps.

### Sim test cases (`babySystem.test.ts`, `wander.test.ts`, `followPath.test.ts`)

- **Spawn:** at `baby_spawn`, `babble`, `babbling: true`, heading and gaze `(0, 1)`, `wanderAt = babbleMinMs`; a geometry whose `baby_spawn` is closed for its radius snaps it to the nearest open cell; no open cell → invariant naming the anchor.
- **First wander** exactly at the first step with `time.sim >= babbleMinMs`, with one `BabyStateChanged(babble → wander)`.
- **Alternation:** over 60 s of sim time, events strictly alternate `babble → wander`, `wander → babble`, at least three full cycles; `babbling` is `true` at every step.
- **On the grid:** at every step the baby's position is in an open cell of `ctx.nav.baby` (rebuild the grid in the test with the same radius, as `papaSystem.test.ts` does).
- **Distances and pauses:** each destination (where a wander ends) is within `[wanderMinDistM, wanderMaxDistM]` of where it began (± half a cell diagonal: the destination is a cell centre); each pause lasts within `[babbleMinMs, babbleMaxMs]` (to one step).
- **Speed:** distance moved per step ≤ the budget (+1e-9), equal to it in the middle of a straight segment; two feels with different `crawlSpeedMps` → the faster arrives first on the same seed.
- **Gaze:** equal to heading at every `wander` step; unchanged through a `babble`.
- **Seed:** two sims, same seed → identical baby trace (positions and events) over 30 s; another seed → a different trace.
- **Papa independence:** Papa's taps and direction walks do not stop or move the baby, and the baby does not block Papa (a tap through the baby's position arrives).
- **`pickWanderCell`** on hand-drawn grids (`createTestNavGrid`, a seeded `createRng`): only cells of the start region; only within the ring; uniform over candidates (each of a handful of candidates is picked over many draws); fallback to the whole region when the ring is empty; `-1` in a one-cell region, with **no** draw consumed (compare the rng state).
- **Failure path:** a one-cell region (custom geometry) keeps the baby in `babble` with a new `wanderAt` each time, no event, no throw.
- **`followPath`:** the moved `advanceAlongPath` tests, now also run on a minimal `PathFollower` object.

### Golden scenario (`baby_wander`)

Seed of your choice, `untilSimMs` 30 000, frozen test geometry and feel, **no commands** (the baby lives on its own). `tests/golden/babyWander.test.ts` pins: at least three full `wander`/`babble` cycles, strict alternation, the first `BabyStateChanged` at the first step ≥ `babbleMinMs` of the test feel. Commit the journal and its expected file; regenerate `core_basic` and `papa_walk` (see T5).

### Baby view (`src/client/render/views/babyView.ts`)

- Same shape as `papaView.ts`: art constants at the top with units (`BABY_GAZE_MARKER_SIZE_M`, `BABY_GAZE_MARKER_HEIGHT_PCT` or similar; Geo tunes them here until E7), a pure `babyPoseAt(baby, alpha, out: BabyPose)` (position via `interpolateXZ`, `yawRad = Math.atan2(gazeX, gazeZ)`), `createBabyView(scene, toon, blobs, radiusM)` → `{ update(baby, alpha), dispose() }`.
- Low-poly sphere (`SphereGeometry` with few segments, or `IcosahedronGeometry`): the triangle cap of `level.spec.ts` must still hold. It rests on the floor (`y = radiusM`). The gaze marker is a child of a group that turns; the blob does not turn (`blobs.createMesh('blob_baby')`, `blobSizeM(2 × radiusM)`).
- Materials from the scene's toon cache (`toon.get(new Color(PALETTE.paper))`, `PALETTE.ink`); `dispose` frees the view's geometries only (the cache owns materials). Name the meshes (`baby`, `baby_gaze`) like Papa's.
- `update` allocates nothing (no `new`, no closures, no template strings).
- Tests (Node, no WebGL): `babyPoseAt` at `alpha` 0, 0.5, 1; yaw for gaze `(0, 1)`, `(1, 0)`, `(−1, 0)`; `update` places the group and turns only the gaze group; `dispose` removes the group.
- Turning is instant at waypoints, like Papa. Smoothing the turn is an art choice (Open point 3).

### E2E script (`tests/e2e/baby.spec.ts`)

Helpers from `support/game.ts`; numbers from the **live** `content/feel.json` and `content/levels/salon_crawler.geometry.json` read in the test (never written in it); no `waitForTimeout` (bounded `expect.poll` / `waitFrames`); `collectProblems` and expect none.

1. **Spawn.** `startLevel`: `data-pp-baby-at` equals the `baby_spawn` anchor, `data-pp-baby-state="babble"`.
2. **Lives.** Within `babbleMinMs` + `RESUME_COUNTDOWN_MS` + margin, the state turns `wander`; then, within a bound derived from `wanderMaxDistM`, `crawlSpeedMps` and a detour factor (say why in a comment), it turns `babble` again and `babyAt` differs from the spawn.
3. **Pause.** Paused (Escape) for a while: `data-pp-baby-state` and `data-pp-baby-at` do not change, and the scene is still (`sceneShot`).
4. **Restart.** « Recommencer »: the baby is back at the spawn, `babble`.

### Story 1.7 review findings that reach this story

The 1.7 code review (2026-10-27, `### Review Findings` in `1-7-deplacer-papa.md`) was in progress when this story was written. Read its final state before coding, and give the baby whatever Papa got:

- **Speed and radius caps.** If `walkSpeedMps` gets a cap from `NAV_CELL_M` and `STEP_MS` and `papaRadiusM` a maximum, give `crawlSpeedMps` and `bodyRadiusM` the same bounds in the schema (`advanceAlongPath` is path-bound, but a radius that closes every cell still kills `createSim`).
- **Snapshot cross-field checks.** If `papaProblem` gains them (state vs path / direction, position on the grid), `babyProblem` gets the matching ones (`wander` has a path with `pathIndex` inside it, `babble` has none; gaze and heading are unit vectors).
- **`replayJournal` returns `err`** for a level the sim cannot be created on: a missing `baby_spawn` or no open cell for the baby must then be an `err` too, not a throw.
- **Unit-suffix guard in `tests/content/feelSchema.test.ts`.** The review may narrow `[a-z]M` to an explicit list. The baby's metre keys (`bodyRadiusM`, `wanderMinDistM`, `wanderMaxDistM`) must pass the rule as it ends up, by an explicit, commented entry if needed (`DistM`), never by loosening the pattern.
- **Spawn region** (deferred there): `spawnOf` keeps today's behaviour for both agents; the « spawn is in the main region » check comes with level validation.

### Previous story intelligence (1.5 to 1.7 and their reviews)

- Hot path: no template string in an `invariant(...)` called per step or per frame (test the condition first). `runBaby`, `followPath`, `babyView.update` allocate nothing.
- Every `createSim` / `replayJournal` call site already passes `geometry` (story 1.7); `createTestGeometry()` and `createTestContent()` are the frozen fixtures. A story that adds a feel key also adds it to `tests/support/testFeel.json`.
- `Math.ceil(-1e-9)` is `-0`: story 1.7 found it the hard way; `+ 0` normalises. Nothing in the sim may depend on a sign of zero (`cloneJson` would change it).
- Vitest runs in Node without a DOM: tests take their environment as parameters. DOM behaviour is Playwright's.
- Playwright: no `waitForTimeout`; poll with bounds computed from the feel; WebKit and Chromium both run. `sceneShot` hides `#pp-world`, `#pp-hud`, `#pp-ui`.
- Biome lints CSS and TS (no CSS here); new code follows the import order Biome wants (run `npm run lint`, fix the code, never `biome.json`).
- The 1.7 manual check noted Papa's blob is hardly visible from the iso view and that Papa shares the sofa's purple: the baby's white sphere is chosen to read (D12); do not change Papa's colour in this story.
- The dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.8 : …`, by Geo.

### Architecture guardrails and traps (read before coding)

- **Sim purity:** no `three`, no DOM, no `Math.random` / `Date` / `performance` / `setTimeout`; randomness **only** `world.rng` through `@shared/rng`. `@content` imports in `src/sim` are `import type` only. Relative imports inside `src/sim`; `@sim` is `src/sim/index.ts` only.
- **Systems never call each other.** `runBaby` reads `ctx.feel.baby`, `ctx.nav.baby`, writes `world.baby` and `world.rng`, pushes `BabyStateChanged`. It reads nothing of `world.papa`, and `runPapa` nothing of `world.baby`.
- **FSM:** never write `baby.state = …` outside `enterBabyState`; durations from sim time (`wanderAt`, `enteredAt`), never frame counts.
- **No GDD or feel number in code:** speed, radius, distances, pauses are `feel.json`; the sphere's look and the gaze marker are art constants in the view.
- **Client reads, never writes, the world.** The baby has no command in this story (`TapBaby` arrives with 1.21).
- **Existing tests that must keep passing unchanged:** everything in `tests/architecture/*.test.ts`, `boot.spec.ts`, `level.spec.ts`, `contentError.spec.ts`, every nav test, `walk.test.ts` minus the moved cases, `papaWalk.test.ts`. Deliberate edits: `step.test.ts` (order), the D10 filters, the moved `followPath` tests, `levelScene.test.ts`, `levelSession.test.ts`, `feelSchema.test.ts`, `snapshot.test.ts`, the golden files, and the T8 `papaAt` additions. List every edited existing test in the Completion Notes with the reason.

### Project Structure Notes

- New (all in the architecture tree): `src/sim/baby/{babyFsm,babySystem,wander}.ts` (+ tests for `babySystem` and `wander`; `babble.ts` of the tree is story 1.21's silence, not this story's), `src/sim/nav/followPath.ts` (+ test; an addition in the tree's `nav/` folder), `src/client/render/views/babyView.ts` (+ test), `tests/golden/journals/baby_wander{,.expected}.json`, `tests/golden/babyWander.test.ts`, `tests/e2e/baby.spec.ts`.
- Modified: `src/sim/{world,context,createSim,step,snapshot,events,index}.ts` (+ tests), `src/sim/papa/{walk,papaSystem}.ts` (+ tests), `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json` (generated), `tests/support/testFeel.json`, `tests/content/feelSchema.test.ts`, `tests/golden/scenarios.ts`, `tests/golden/journals/{core_basic,papa_walk}{,.expected}.json` (regenerated), `src/client/render/{levelScene.ts,levelScene.test.ts}`, `src/client/render/materials/palette.ts`, `src/client/app/{levelSession.ts,levelSession.test.ts}`, `src/client/boot.ts`, `tests/e2e/support/game.ts`, `tests/e2e/{move,pauseResume,ui}.spec.ts`, `deferred-work.md`, `sprint-status.yaml`.
- No new top-level folder; no file in `src/debug`; no `window.__PP__` (story 1.13); no `WaveDirector` (story 1.10 / 1.18); no audio (story 1.9).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests; Geo plays and tunes. Every baby number is in `feel.json`; the baby lives with no input, so headless sims and bots (1.12) see it for free.
- **Sim:** fixed 10 ms steps of sim time; `World` serializable; systems in the fixed order (commands → timing → director → baby → threats → papa → …); FSM via `enter…State`; randomness only `world.rng`; never logs, emits events; no `try/catch`.
- **IA du bébé et navigation (architecture):** FSM `wander → babble → targetLocked → approach → act`, plus `mischiefSilent`, `carried`, `gagRecovery`; 0.25 m grid from the `NAV_` nodes, A* with smoothing. This story implements the first two states only (D1).
- **P4 (silence as telegraph):** `baby.babbling` is true by default; only `mischiefSilent` (1.21) sets it to false. The client (1.9) loops the babble while it is true: keep the field even though nothing reads it yet.
- **Performance:** zero allocation in hot paths; ≤ 100 draw calls (the baby adds three).
- **Debug code** behind `if (import.meta.env.VITE_DEBUG_ALLOWED === 'true')`; the `data-pp-*` mirrors are the stopgap until `window.__PP__` (1.13).
- **Errors:** no `console.*`; the sim uses `invariant`, the client `log`.
- **Stack pinned:** three 0.186.1 (`SphereGeometry`, `IcosahedronGeometry`, `ConeGeometry` are in it), no new dependency, no Capacitor. No web research was needed: nothing new from outside the pinned stack.
- **Tests:** unit tests colocated; sim tests in Node with `createSim` + `stepN`; golden regenerated deliberately and said so; `src/sim` coverage ≥ 90 % (the baby code must reach it); never weaken an architecture test.

### Items this story resolves (mark them in `deferred-work.md`)

- « Clearance per agent from data beyond `papaRadiusM` » → `feel.baby.bodyRadiusM` and `ctx.nav.baby`.

### Deferred by this story

- **Inverted-hull outline** on Papa and the baby (ADR-008): art pass E7.
- **Baby and Papa colliding** (Papa stepping round the baby, or the baby round Papa): Open point 4.
- **Hidden zones in wander:** the baby may wander behind the sofa (`behind_sofa`) while babbling; story 1.21 decides whether wander avoids hidden zones once silence exists.
- **Smoothed turning** of the gaze marker and any crawl animation (bob, squash and stretch): E7.
- **Debug view of the baby's path and grid:** story 2.1's navigation view.

### Open points for Geo (do not block the dev)

1. `crawlSpeedMps: 0.6`, pauses of 1.5 to 4 s, hops of 1 to 3.5 m are guesses: tune them in `feel.json`. A faster baby makes threats (1.10) feel more urgent.
2. `bodyRadiusM: 0.2` gives the same one-cell clearance as Papa: the baby cannot squeeze where Papa cannot. A radius of 0 would let it hug the furniture (and reach spots Papa cannot).
3. The gaze marker snaps to a new direction at each waypoint.
4. Papa walks through the baby and the baby through Papa.
5. The baby may sit behind the sofa, out of the camera's best view, while still babbling.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8 : Le bébé vit dans le salon], and for what comes next [#Story 1.9] (`babbling` read by the audio), [#Story 1.10] (`targetLocked`, approach to `ANCHOR_outlet_01`), [#Story 1.21] (`mischiefSilent`, `babbling = false`, `TapBaby`), [#Exigences fonctionnelles › FR15]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#IA du bébé et navigation], [#Modèle d'état], [#Patterns d'état] (`enterBabyState`), [#Patterns de communication] (system order), [#Système d'événements], [#P4 — Le silence comme télégraphe], [#Déterminisme, journal et replay], [#Arborescence] (`src/sim/baby/`, `views/babyView.ts`), [#Règles de cohérence]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Boucle de jeu] (micro-loop: the gaze locks on the target), [#Mécaniques principales › 8. Le silence comme télégraphe] (the baby babbles continuously), [#Direction artistique et audio] (« bébé à tête énorme »; babbling informs)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#HUD & Diegetic UI] (the gaze lock is diegetic, no DOM), [DESIGN.md] (frontmatter `colors.paper`, `colors.ink`; threat colours reserved)
- [Source: _bmad-output/project-context.md] (Engine-Specific Rules, Performance Rules, Testing Rules)
- [Source: _bmad-output/implementation-artifacts/1-7-deplacer-papa.md] (D3 per-agent grids, D11 interpolation, D15 no sign of zero, papa test and golden patterns) and [deferred-work.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-10-27: Story 1.8 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
