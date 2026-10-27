---
baseline_commit: 152b09f
---


# Story 1.15: Light Physics for Props

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.15 « Physique légère des objets ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see objects fall, roll, bounce and cause chain accidents,
so that the chaos makes a show.

**Requirements covered:** FR21 (`[P]` « physique légère ; les objets tombent, roulent, rebondissent et provoquent des accidents émergents »). Architecture: § Physique (L241-246), § Modèle d'état (L229-232: `World.props[]`, Rapier beside `World` behind `PhysicsPort`, its binary snapshot joined to the `World` snapshot), ADR-004 (determinism, snapshots), ADR-005 (« Rapier dans la sim, objets seulement … une dizaine d'objets »), entity patterns (L855-880: `ViewRegistry` + pools). GDD §11 « Physique légère ». No UX artefact covers props (DESIGN.md L372: the 3D world belongs to the architecture). Reduced motion does not touch the sim (EXPERIENCE.md L427-439), so physics is identical under it.

**Downstream consumers. Design the events and the `World` slice for them; none of them may need to change this story's code:**
- 1.16: the coffee-table gag pushes a prop with an impulse from `gags.ts`, and the prop may break another prop.
- 1.22: Mama's « Soupir » reads `world.mess` (objects on the floor and broken objects).
- 3.1: the noise gauge reacts **only** to `PropImpact` (« +5 à +15 % selon l'impulsion »). Its AC says « aucun code de 1.15 n'est modifié ».
- 3.6: the end photo renders a snapshot without simulating, so the views must render from `World` alone.
- 3.9: the highlight replay restores a snapshot (World + Rapier) into a **second** sim.

## Precondition (check first, stop if it fails)

Story 1.14 is `done` or at least `review` with its review fixes committed. `git status` is clean apart from `_bmad-output/`. Run `env | grep VITE_`; the agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap). Then run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note the unit and e2e counts in the Debug Log. The 1.14 baseline was 152 files, 2130 unit tests and 174 e2e. If the baseline is red, stop and say so.

## Acceptance Criteria

1. **Rapier, once, behind `PhysicsPort`.**
   - `src/sim/physics/rapierPhysics.ts` is the only file that imports `@dimforge/rapier3d-deterministic-compat` (0.21.0, already a dependency; the existing lint and architecture guardrails already enforce this).
   - It initialises the WASM **once per process** (a memoised `init()` promise) in Node (Vitest, `npm run sim`) as in the browser (chromium and webkit).
   - `createSim` awaits it and builds a Rapier world from the level geometry: one fixed cuboid per `COL_*` collider, a synthesised floor and room bounds (D4), and one dynamic body per `PROP_*` prop with the per-kind shape, mass, friction and restitution of `feel.physics.kinds` (D5).
   - Rapier's timestep is exactly `STEP_MS / 1000` (its default is 1/60: set it), so one `sim.step()` is one Rapier step whatever `timeScale` is (ADR-002).
   - Papa and the baby have no body (ADR-005).
2. **Impacts and breakage.** A prop pushed by the journaled test command `PushProp` (D7), or later by a gameplay helper (`pushProp`, for 1.16), falls and hits the floor, a collider or another prop. At the step where its contact impulse reaches `feel.physics.impactMinImpulseNs`, the sim emits `PropImpact{t, propId, impulseNs, otherPropId}` (D6), at most once per `feel.physics.impactCooldownMs` per prop. When its kind is `breakable` and the impulse reaches its `breakImpulseNs`, the sim also emits `PropBroken{t, propId, impulseNs}` once and marks the prop broken. A resting prop never emits anything: settling contacts stay below the threshold.
3. **Mess.** `world.mess.propsOnFloor` counts the unbroken props that spawned above the floor and now lie on it; `world.mess.propsBroken` counts the broken ones (D8). Both are updated by `runPhysics` every step.
4. **Snapshot, restore, replay.**
   - `SimSnapshot` goes to `version: 5` and carries the Rapier state as base64 (`physics`, D9).
   - `restore()` rebuilds the Rapier world from it.
   - A snapshot taken while props are moving, restored into the same sim **or into a second sim** built from the same content, continues to the same world hash and the same events as an uninterrupted run.
   - A new golden scenario `prop_fall` (PushProp on the mug: it falls, hits the vase and breaks it) replays to identical positions. Every golden reference is regenerated deliberately and the story says so (D11).
5. **Views from pools with interpolation.**
   - The client draws the props from `world.props` through a generic `ViewRegistry` (`src/client/render/views/viewRegistry.ts`) and a per-kind pool of `propView`s, prewarmed at scene creation.
   - Each frame, every view is placed at the pose interpolated between the previous and current step: lerp on position, slerp on rotation, both by `alpha`.
   - The static `PROP_*` meshes of the `.glb` are no longer drawn in place; they serve as the per-kind templates.
   - No `new Mesh`, `new Vector3`, closure or array is created per frame.
6. **Data, not code.**
   - Every tunable number lives in `content/feel.json` › `physics` and is validated by `FeelSchema`: gravity, impact threshold, cooldown, and per kind the shape, mass, friction, restitution, breakable flag and break threshold.
   - `content:check` refuses a level whose prop kind has no `feel.physics.kinds` entry.
   - `content/_schemas/` is regenerated and `tests/support/testFeel.json` updated.
   - Technical tolerances are UPPER_SNAKE constants in `src/shared/constants.ts`.
7. **A room where a chain accident can happen.** `salon_crawler` gains a breakable `PROP_vase_01` on the floor, next to the coffee table's +x edge, where the pushed mug lands (D10). The mug is breakable too. The prop is added through the Blender pipeline of story 1.6, never by editing the generated `*.geometry.json` by hand.
8. **Nothing else breaks.**
   - The four existing golden scenarios keep **exactly** the same event sequences: only their hashes move. No `PropImpact` may appear in them (the props rest).
   - `npm run sim` and `sim:replay` still exit 0.
   - The autoplay e2e (which compares the browser's world hash with Node's) stays green in chromium **and** webkit.
   - Draw calls stay ≤ 100.
   - `npm run ci` is green on the Mac.

## Tasks / Subtasks

- [ ] **T0: Baseline** (Precondition)
  - [ ] `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the untouched tree; counts go in the Debug Log.
- [ ] **T1: Feel `physics` section** (AC 1, 2, 6; D5)
  - [ ] `src/content/schemas/feel.ts`: add `PhysicsSchema` (Dev Notes › Feel) and add it to `FeelSchema`. Use `strictObject` with no `.default`, `.optional` or `.transform` (rules at the top of the file). Reuse the existing helpers (`durationMs`, …) and add a `positive(…)` helper if none fits.
  - [ ] `content/feel.json` and `tests/support/testFeel.json` get the values of Dev Notes › Feel.
  - [ ] Run `npm run content:schemas` and commit `content/_schemas/feel.schema.json`.
  - [ ] `tests/content/feelSchema.test.ts`: a missing kind field is refused at its path, as are a negative mass, `breakable: true` with a non-positive `breakImpulseNs`, and an unknown `shape`.
  - [ ] `feelMerge.test.ts`: a level override of `physics.kinds.mug.restitution` keeps the siblings.
  - [ ] `tools/content/contentChecks.ts`: every `props[].kind` of every `*.geometry.json` has a `feel.physics.kinds` entry. Error message: `<level>.geometry.json › props[i].kind "<kind>" has no feel.physics.kinds entry`. Add a test in `tests/content/checkContent.test.ts`.
- [ ] **T2: Content: the vase** (AC 7; D10)
  - [ ] In `assets-src/blender/salon_crawler.blend`, add `PROP_vase_01` to the `props` collection. It is a low-poly mesh with uniform scale and rotation in multiples of 90° (the extractor refuses anything else), with its origin at its bounding-box centre, standing on the floor at about `centerM [1.3, 0.15, -0.6]` with `halfExtentsM ≈ [0.08, 0.15, 0.08]`.
  - [ ] Run the story 1.6 pipeline (`npm run assets:export`, then `assets:extract`, then `assets:optimize`; check `1-6-salon-greybox-depuis-blender.md` for the exact order). Use Blender MCP or `/Applications/Blender.app` headless.
  - [ ] Check the regenerated `content/levels/salon_crawler.geometry.json`: it has two props, `mug_01` and `vase_01`. Check that `public/assets/levels/salon_crawler.glb` stays under `LEVEL_PAYLOAD_MAX_BYTES`.
  - [ ] Copy the new geometry into the frozen fixture `tests/support/testLevel.geometry.json`. It is byte-identical to the salon today; keep it so, deliberately, and say so.
  - [ ] `tests/support/testLevelGeometry.ts` (tiny room): its mug floats at `y = 0.7` with nothing under it, so it would fall at step 1 and add events to every test that uses that room. Put it on the floor at `centerM: [0, 0.05, 0]`.
  - [ ] If Blender cannot run, stop and tell Geo; do not hand-edit the generated JSON.
- [ ] **T3: `PhysicsPort` and `rapierPhysics.ts`** (AC 1, 2; D1-D4, D6)
  - [ ] Create `src/sim/physics/physicsPort.ts` with the interface only and no Rapier type (Dev Notes › PhysicsPort).
  - [ ] Create `src/sim/physics/rapierPhysics.ts` with `createRapierPhysics(options): Promise<PhysicsPort>` and a memoised module-level `initRapier()`. Use a **dynamic** `import('@dimforge/rapier3d-deterministic-compat')` inside it, so Vite puts the ~4.4 MB module in its own chunk (D2).
  - [ ] `src/sim/physics/rapierPhysics.test.ts` (Node), covering:
    - init twice gives one init;
    - the timestep is 0.01;
    - one fixed body per collider, plus the floor and the bounds;
    - a prop dropped from 1 m reports one impact above the threshold, and no impact while resting;
    - `applyImpulse` wakes a sleeping body;
    - `snapshot` → `restore` → N steps gives the same poses as N steps without the round trip;
    - after `dispose`, any call throws.
- [ ] **T4: `World` slice, system, command, events** (AC 2, 3; D6-D8)
  - [ ] `src/sim/world.ts`: add `PropSlice` and `MessSlice` and export them (Dev Notes › World). `createWorld` receives the prop specs and fills `props` index-aligned with `geometry.props`, plus `mess: { propsOnFloor: 0, propsBroken: 0 }`.
  - [ ] `src/sim/context.ts`: `StepContext.physics: PhysicsPort` and `SimLevel.props: readonly SimPropSpec[]` (constant data: id, kind, the kind's feel entry, `spawnedAboveFloor`).
  - [ ] `src/sim/commands.ts`: add `PushProp` to the union, to `COMMAND_TYPES` and to `commandProblem`. It needs a non-empty `propId` string and three finite impulse components that are not all 0. Add `commands.test.ts` cases.
  - [ ] `src/sim/events.ts`: add `PropImpact` and `PropBroken` to the union and to `SIM_EVENT_TYPES` (keep it sorted). Update `events.test.ts`.
  - [ ] Create `src/sim/physics/propsSystem.ts`, exporting the system `runPhysics(world, ctx)` (Dev Notes › Order inside `runPhysics`) and the helper `pushProp(world, ctx, propIndex, xNs, yNs, zNs)` that 1.16's gags will call.
  - [ ] `src/sim/step.ts`: insert `runPhysics` after `runPapa`, update the doc comment and the pinned order test.
  - [ ] `src/sim/physics/propsSystem.test.ts`: Dev Notes › Testing › propsSystem.
- [ ] **T5: `createSim`, `restore`, `dispose`, snapshot v5** (AC 1, 4; D3, D9, D12)
  - [ ] `createSim.ts`:
    - check every prop kind against `feel.physics.kinds` with `invariant` (a broken level);
    - `await createRapierPhysics({ geometry, physics: content.feel.physics })`;
    - put the port in `ctx`.
  - [ ] `Sim` gains `dispose(): void`. It frees the Rapier world, is idempotent, and makes a later `step` or `snapshot` throw through `invariant`. Call it where a sim is dropped:
    - `levelSession` (restart, `loadLevel`, `setFeel`);
    - `tools/sim/runSim.ts` (after each run);
    - `tools/sim/replaySim.ts`;
    - `src/sim/replay.ts` callers, which own the returned sim, so document that;
    - the golden helpers.
  - [ ] Create `src/shared/base64.ts` (`encodeBase64(bytes: Uint8Array): string`, `decodeBase64(text: string): Result<Uint8Array, string>`). It is pure, uses no `btoa` or `Buffer`, and has a colocated test with round trips of 0, 1, 2, 3 and 4096 random bytes, plus refusal of bad input.
  - [ ] `snapshot.ts`:
    - `version: 5`;
    - `physics: string`;
    - `takeSnapshot` receives the port's bytes;
    - `worldProblem` validates `props` (index-aligned with the level's props: same count and same ids; finite numbers; a unit quaternion within 1e-4; booleans; `lastImpactAt` null or finite) and `mess` (non-negative integers that match a recount from `props`);
    - version 4 is refused;
    - the comment at the top says « 5 since story 1.15: the Rapier world, base64 ».
  - [ ] `restore`:
    - decode the base64 first (an `invariant` on error);
    - restore Rapier into a new world, check the body count, then free the old one, so that a refused snapshot leaves the sim untouched.
  - [ ] `snapshot.test.ts`, covering:
    - mid-fall snapshot → restore → same hash as uninterrupted;
    - restore into a **second** sim;
    - each malformed field refused with its path;
    - corrupt base64 refused with the sim untouched.
- [ ] **T6: Client views** (AC 5; D13, D14)
  - [ ] Create `src/client/render/views/viewPool.ts` (`createViewPool<V>(make, prewarm)` with `acquire()`, `release(v)`, `size`) and `viewRegistry.ts` (Dev Notes › Client), each with a colocated test that counts creations, releases and reuse and checks that a second `sync` with the same entities creates nothing.
  - [ ] Create `src/client/render/views/propView.ts`:
    - `propPoseAt(prop, alpha, out)` (pure, tested);
    - `createPropView(template: Object3D, blobs: BlobKit, footprint)`, returning `{ object, update(prop, alpha), hide(), dispose() }`;
    - the broken look is a squash, `BROKEN_SCALE_Y`, an art constant at the top of the file like `papaView`'s.
  - [ ] `src/client/render/interpolate.ts`: add an allocation-free `interpolateXYZ`, with tests.
  - [ ] `levelScene.ts`:
    - pull the `PROP_*` nodes out of the model, toon-materialise them like today, and keep the first one of each kind as its template;
    - prewarm one pool per kind with the count of `geometry.props` of that kind;
    - build the registry;
    - `update(world, alpha)` calls `registry.sync(world.props, alpha)`;
    - `dispose` releases everything.
  - [ ] `levelScene.test.ts`: the case « keeps the visuals and props » becomes « keeps the visuals; props are drawn by pooled views at `world.props` poses ». Add a case where a prop moved in the `World` moves its view, and a case where a frame with the same world allocates no view.
  - [ ] `src/client/assets/loadLevelAssets.ts`: fix the doc comment, which should mention `PROP_` nodes.
- [ ] **T7: Goldens and determinism** (AC 4, 8; D11)
  - [ ] `tests/golden/scenarios.ts`: add `prop_fall` on `createTestGeometry()` with the planned level empty, seed 42, `PushProp` on `mug_01` at step 10 with an impulse towards +x calibrated in T9, until 3000 sim ms. Add `tests/golden/propFall.test.ts`, which pins the behaviour like `outletParry.test.ts` does: there is a `PropImpact` for the mug, a `PropImpact` for the vase with `otherPropId: 'mug_01'` (or the reverse), a `PropBroken` for the vase, then `mess` = `{propsOnFloor: 1, propsBroken: 1}`.
  - [ ] Run `npm run golden:update` and review the diff:
    - `core_basic`, `papa_walk`, `baby_wander` and `outlet_parry` change **only** `feelHash`, `geometryHash` and `worldHash`; their `eventTypes` and `eventsHash` stay identical;
    - paste that check in the Completion Notes;
    - if a prop event appears in any of them, stop: a resting prop is emitting, so fix the spawn or the settling. Never fix it by raising the threshold blindly.
  - [ ] `src/sim/determinism.test.ts`: add a case where a 10 000-step run with periodic `PushProp`s is identical twice.
  - [ ] Run `npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3 --journals`, then `npm run sim:replay` on a recorded journal: exit 0, and the quality distribution is the same as the baseline.
- [ ] **T8: E2E** (AC 1, 5, 8)
  - [ ] Create `tests/e2e/props.spec.ts` (chromium and webkit). It drives the game through `tests/e2e/support/testApi.ts` only, with no `waitForTimeout`:
    1. `ppLoadLevel`, `ppFreeze(true)`;
    2. `ppSend({type:'PushProp', propId:'mug_01', …})`, then `ppAdvance(300)`;
    3. `ppEvents()` contains a `PropImpact` for `mug_01`;
    4. the `mug_01` entry of `ppWorld().props` moved, and `mess.propsOnFloor` ≥ 1;
    5. `collectProblems` is empty (no console error: Rapier's WASM loaded in WebKit, NFR13);
    6. `data-pp-draw-calls` ≤ `DRAW_CALLS_MAX`.
  - [ ] Run the whole suite. `autoplay.spec.ts` compares the browser and Node world hashes, which now include the Rapier poses. If it fails only in one browser, **do not loosen it**: write it up in the Debug Log and stop for Geo (Dev Notes › Determinism scope).
  - [ ] The screenshot references `autoplay-frozen-*` change because the vase is new. Regenerate the darwin ones with `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` and the linux ones with the Docker command of story 1.13 › Screenshots (memory: mount the `pp-node-modules` volume). **Look at them** and say so in the Completion Notes.
- [ ] **T9: Calibrate, measure, document**
  - [ ] Calibrate the `prop_fall` impulse and, if needed, the `[ASSUMPTION]` values of Dev Notes › Feel, so that the mug leaves the table, hits the vase, and the vase breaks while the mug does not. Note the final numbers, and the measured impulses of each impact, in the Debug Log.
  - [ ] Measure the cost: 10 000 steps of the salon with both props moving, time per step in Node. The budget is sim ≤ 2 ms per frame of up to 10 steps, so aim for ≪ 0.2 ms per step for the whole step. Also note the size of the Rapier chunk of `npm run build:playtest` and its gzip size. Both go in the Debug Log, not in a CI test.
  - [ ] By hand: `(unset VITE_DEBUG_ALLOWED; npm run dev)`, open `/?debug=1`, send a `PushProp` from the console through `window.__PP__.send`, and write in the Debug Log what you saw: the fall, the interpolation is smooth, the vase squashes.
  - [ ] `_bmad-output/project-context.md` › the Rapier bullet: add « props are mirrored every step into `World.props` (poses, `isBroken`, `isOnFloor`) and `World.mess`; the Rapier state rides in `SimSnapshot.physics` (base64); `Sim.dispose()` frees it ».
  - [ ] `deferred-work.md`: Dev Notes › Deferred by this story. Close the items this story settles: L33 (Rapier in the snapshot), L92 (static `PROP_*`) and L93 (colliders reach the sim).
  - [ ] Final `(unset VITE_DEBUG_ALLOWED; npm run ci)` green; counts in the Debug Log.

## Dev Notes

### What exists today (stories 1.3 to 1.14)

- **`createSim` is already `async`** (`createSimWithSystems`, `src/sim/createSim.ts:123`) and every caller awaits it: `levelSession`, `runSim`, `replayJournal`, the goldens and the tests. `await initRapier()` therefore needs no signature change anywhere. `restore` is synchronous and stays so, because Rapier's `World.restoreSnapshot(bytes)` is synchronous.
- **Rapier facts, verified in Node against the installed 0.21.0 on 2026-10-27:**
  - `import RAPIER from '@dimforge/rapier3d-deterministic-compat'; await RAPIER.init();` works in plain Node (the WASM is inlined as base64, so it needs no file loader or Vite plugin).
  - The `timestep` defaults to `0.01666…`: **set `world.timestep = STEP_MS / 1000`**.
  - `world.takeSnapshot()` returns a `Uint8Array`, about 3.8 KB for one floor and one body. `RAPIER.World.restoreSnapshot(bytes)` gives a world that keeps the timestep and the body handles, and that steps **bit-identically** to the original.
  - Contact forces:
    - use `ColliderDesc…setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(forceN)`, `new RAPIER.EventQueue(true)`, `world.step(queue)`, `queue.drainContactForceEvents(e => …)`;
    - `e.totalForceMagnitude()` is a **force** (N), so the impulse is `force × timestep` (N·s);
    - `e.collider1()` and `e.collider2()` give the handles.
  - Measured on a 0.3 kg box dropped from 1.2 m: impact ≈ **1.58 N·s** at the first contact, then small bounces (0.05 to 0.12 N·s), then **a resting contact of `m·g·dt` ≈ 0.029 N·s every step** until the body sleeps (≈ 1.5 s later). The threshold must sit well above resting and below a real fall. `0.3` N·s separates them cleanly.
  - Rapier objects (`World`, `EventQueue`) hold WASM memory and must be `free()`d. The JS getters (`body.translation()`, `rotation()`) allocate a small object per call. That cannot be avoided through the public API: read only **awake** bodies (`isSleeping()`), so a resting room allocates nothing.
- The **guardrails** for the Rapier import already exist: `biome.json` (overrides for `src/sim/**` and `rapierPhysics.ts`), `tests/architecture/scanners.ts:439,483`, `biomeBoundaries.test.ts` and `layerBoundaries.test.ts`, and a fixture `tests/architecture/fixtures/layers/allowed/src/sim/physics/rapierPhysics.ts`. Do not touch them. If a guardrail blocks you, the code is wrong.
- **Geometry** (`content/levels/salon_crawler.geometry.json`, schema `src/content/schemas/levelGeometry.ts`):
  - seven axis-aligned box colliders (`{id, centerM, halfExtentsM}`): `coffee_table`, whose top is at y = 0.45 and whose +x edge is at x = 1.1, plus `counter`, `side_table`, `sofa`, `stairs`, `wall_back` and `wall_side`;
  - **no floor collider and no walls on the +x and +z sides**;
  - bounds `[-4.2, -0.8, -3.2]` → `[4.9, 2.5, 3]`;
  - one prop `{id:'mug_01', kind:'mug', centerM:[0.7, 0.5, -0.6], halfExtentsM:[0.05, 0.05, 0.05]}`, resting exactly on the table;
  - `PropSchema` has no mass, breakability or shape. The Blender export does not export custom properties (`export_extras=False`), so per-kind data comes from content (D5).
- **Client:**
  - `levelScene.ts` hides COL_, NAV_, ANCHOR_ and ZONE_ nodes, and keeps `PROP_mug_01` as a **static** toon mesh (`isHiddenInGame`, L102-112; pinned by `levelScene.test.ts:111-118`).
  - In the glb, the named `PROP_mug_01` is a parent `Object3D` (translation = its `centerM`) with one unnamed child mesh.
  - Views read sim slices directly and interpolate `prev → current` with `alpha` (`papaView.ts`: `papaPoseAt(slice, alpha, out)`, one mutable pose, art constants at the top).
  - `interpolate.ts` only has `lerp` and `interpolateXZ`.
  - No `ViewRegistry` and no generic pool exist. The only pools are `soundWaves.ts` (`SOUND_WAVE_POOL_SIZE`) and the tap marker.
  - `BlobKit` (`blobShadow.ts`) makes the blob shadows of Papa and the baby.
- **Test API:** `state()` returns `cloneJson(sim.world)`, so the props are visible there once they are in `World`. `send()` accepts any `SimCommand` type (it runs `commandProblem`), so `PushProp` works through `ppSend` with no change to `testApi.ts`.
- **Feedback:** `FeedbackEventName = SimEvent['type'] | …`, and an event that `content/feedback.json` does not list does nothing. `PropImpact` and `PropBroken` therefore need no client code to be harmless. This story adds no feedback entry (no sound asset yet; see Deferred).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | Rapier lives **beside** `World`, in a `PhysicsPort` held by `StepContext.physics`, like the nav grids. Every step, `runPhysics` mirrors each awake prop's pose into `World.props`. | `World` stays plain JSON (project-context L152). Views, `__PP__.state()`, the goldens and the autoplay hash all see the physics. 3.6 renders from `World` alone. |
| D2 | `rapierPhysics.ts` loads Rapier with a **dynamic** `import()` behind a memoised `initRapier(): Promise<RapierModule>`. | One init per process (AC 1). The 4.4 MB module gets its own chunk instead of swelling the entry. It loads during the loading screen, because `createSim` already runs there. |
| D3 | Prop identity is the geometry's string `id` (`mug_01`). `World.props` is **index-aligned** with `geometry.props`, like `world.threats` is with the level. Rapier handles stay inside `rapierPhysics.ts` (an index → body / collider-handle → index table, rebuilt after `restore`; handles survive the Rapier snapshot). | Ids are stable across runs and readable in events. 1.16 names props in JSON. No `nextId` is needed for content-defined entities. |
| D4 | The floor is a fixed cuboid whose top is at y = 0, covering the bounds plus a margin. The room is closed by four invisible fixed walls on the bounds' x/z faces (height = bounds max y). Thickness and margin are constants `PHYSICS_FLOOR_THICKNESS_M` and `PHYSICS_BOUNDS_WALL_THICKNESS_M` in `shared/constants.ts`. | The geometry has no `COL_floor` and two open sides: without this, a pushed mug falls forever or rolls out of the room. These are technical values, not feel. |
| D5 | Per-kind physics lives in `feel.physics.kinds.<kind>`: `shape`, `massKg`, `friction`, `restitution`, `breakable`, `breakImpulseNs`. The size comes from the geometry's `halfExtentsM`: `box` → cuboid; `cylinder` → radius `max(hx, hz)`, half-height `hy`; `ball` → radius `min(hx, hy, hz)`. Mass is set with `setMass`, not density. | It is data Geo tunes (GDD « physique légère »), and the epic puts the thresholds in `feel.json`. `content/objects/` only arrives in E6 (architecture L259), so it is an open point. Cylinders make « rouler » true. |
| D6 | Contacts come from Rapier contact-force events. Per collider, the force threshold is `impactMinImpulseNs / dtS`, so Rapier filters. Per step, keep for each prop the **largest** impulse and its partner in scratch typed arrays, then emit in **prop index order**. The event is `PropImpact{t, propId, impulseNs, otherPropId: string \| null}` (`null` = floor, wall or furniture). There is one event per prop per contact, so a prop-on-prop hit gives one event for each prop. The cooldown (`lastImpactAt`, in `World`) only throttles `PropImpact`; breakage is checked on every impulse above the threshold. | Deterministic order, independent of Rapier's drain order. No allocation. 3.1 has everything it needs (the impulse gives « +5 à +15 % selon l'impulsion », and the kind is in `world.props`). `otherPropId` makes chain accidents visible for 3.9's « gag avec ≥ 2 objets ». **Naming:** the epic writes `impulse`; the unit-suffix rule makes it `impulseNs`. |
| D7 | Test and debug command: `PushProp{t, propId, impulseXNs, impulseYNs, impulseZNs}`, journaled. It applies the impulse at the body's centre of mass and wakes it. An unknown or broken `propId` is **ignored silently**, exactly like `PressThreat` with an unknown `threatId` (`threatSystem.ts:67`). Test it. Gameplay goes through the internal helper `pushProp(...)` in `propsSystem.ts`, never through a command. | Every external state change goes through a journaled command (consistency rules), so replay and goldens see it. 1.16 calls the helper from `gags.ts`. |
| D8 | `MessSlice = { propsOnFloor, propsBroken }`. A prop is `isOnFloor` when its lowest point is within `PROP_ON_FLOOR_TOLERANCE_M` (constant, 0.02) of y = 0. Approximate the lowest point by `yM − halfExtentsM[1]`, using the largest half-extent once the prop is tipped (more than 45° from upright); document the approximation. `propsOnFloor` counts props that are `!isBroken && isOnFloor && spawnedAboveFloor`. A broken prop stays in Rapier as a body (it still collides) and counts only in `propsBroken`. No event is emitted for mess. | The vase spawns on the floor and must not count as mess. 1.22 reads both numbers. Keeping the body avoids removing a body mid-step and changing the handle tables. |
| D9 | `SimSnapshot` v5: `{ version: 5, seed, feelHash, geometryHash, levelHash, world, physics: string }` (base64 of `takeSnapshot()`, from `@shared/base64`). | A snapshot stays JSON (3.3 exports games, and `cloneJson` cannot carry a `Uint8Array`). Base64 in `shared` keeps the sim free of `btoa` and `Buffer`. |
| D10 | The salon gets `PROP_vase_01`, breakable, on the floor at the coffee table's +x side, and the mug becomes breakable. The pushed mug lands on the vase: that is the chain accident, and 1.16's « casse un autre prop ». | A single prop cannot show a chain accident (AC « heurte … un autre prop »). The budget is ≈ 10 props (ADR-005). |
| D11 | Golden: every reference is regenerated deliberately. The four existing scenarios change only hashes, and the new `prop_fall` pins the chain. | `World` gains `props` and `mess`, the fixture geometry gains the vase and the feel gains `physics`, so every `feelHash`, `geometryHash` and `worldHash` moves. Never loosen the comparison. |
| D12 | `Sim.dispose()` frees the Rapier world and is idempotent. A `step`, `snapshot` or `restore` after `dispose` fails an `invariant`. Tests that create many sims do not have to dispose, but the CLI and `levelSession` must (10 000 runs in `npm run sim`). | WASM memory is not garbage-collected. |
| D13 | The `ViewRegistry` gets its handlers **at creation** (`createViewRegistry({ keyOf, create, update, release })`) and `sync(entities, alpha)` takes only data. The architecture's example passes a handlers literal to every `sync`, which would allocate an object per frame. Note the deviation in the file's doc comment. | Zero allocation per frame (project-context L71-72). |
| D14 | `propView` is a `template.clone()` (it shares geometry and the toon material) plus a blob shadow from `BlobKit` (footprint from `halfExtentsM` x/z), placed at the interpolated pose under `content_root` (so the shake moves it). It is not instanced: two props, budget ≤ 100 draw calls. Instancing is deferred until there are about 10 props. | Simplest path that keeps the 1.6 art. Blob shadows under props are in the architecture's render budget. |

### Feel (`content/feel.json` › `physics`)

```json
"physics": {
  "gravityMps2": 9.81,
  "impactMinImpulseNs": 0.3,
  "impactCooldownMs": 100,
  "kinds": {
    "mug":  { "shape": "cylinder", "massKg": 0.3, "friction": 0.6, "restitution": 0.3, "breakable": true, "breakImpulseNs": 2.5 },
    "vase": { "shape": "cylinder", "massKg": 0.8, "friction": 0.6, "restitution": 0.1, "breakable": true, "breakImpulseNs": 0.6 }
  }
}
```

- These are `[ASSUMPTION]` values, calibrated in T9. Constraints: the mug falling from the table (≈ 0.45 m) must **not** break on the floor; the vase hit by the mug must break; a resting prop emits nothing.
- Schema:
  - `gravityMps2` > 0;
  - `impactMinImpulseNs` > 0;
  - `impactCooldownMs` is a `durationMs` ≥ 0 (sim ms);
  - `kinds` is `z.record(idSchema, KindSchema)`;
  - `shape` ∈ `['box', 'cylinder', 'ball']` (data list + type, as in `GAG_IDS`);
  - `massKg` > 0;
  - `friction` ≥ 0;
  - `restitution` ∈ [0, 1];
  - `breakable: boolean`;
  - `breakImpulseNs` > 0, required even when `breakable` is false (no optional keys, by the schema rule).
- Each key has a description that states its unit.

### World (`src/sim/world.ts`)

```ts
/** A free object (`PROP_*`): its pose mirrors its Rapier body at the end of each step (story 1.15). */
export interface PropSlice {
  /** The geometry id (`mug_01`); `world.props[i]` is `geometry.props[i]`. */
  id: string;
  kind: string;
  xM: number; yM: number; zM: number;
  /** Rotation as a unit quaternion. */
  qx: number; qy: number; qz: number; qw: number;
  /** Pose at the start of the last step, so that the view can interpolate between two steps. */
  prevXM: number; prevYM: number; prevZM: number;
  prevQx: number; prevQy: number; prevQz: number; prevQw: number;
  isOnFloor: boolean;
  isBroken: boolean;
  /** Sim time of the last `PropImpact`; null before the first. */
  lastImpactAt: SimMs | null;
}
export interface MessSlice { propsOnFloor: number; propsBroken: number; }
// World gains: props: PropSlice[]; mess: MessSlice;
```

- At spawn, the pose is the geometry `centerM` with an identity quaternion, `prev* = current`, both flags false.
- Rapier's poses are f32 values read as JS numbers. They survive JSON exactly.

### PhysicsPort (`src/sim/physics/physicsPort.ts`)

```ts
export interface PropPose { xM: number; yM: number; zM: number; qx: number; qy: number; qz: number; qw: number; }
export interface PhysicsPort {
  /** One Rapier step of exactly STEP_MS. */
  step(): void;
  applyImpulse(propIndex: number, xNs: number, yNs: number, zNs: number): void;
  isSleeping(propIndex: number): boolean;
  /** Writes the body's pose into `out`. */
  readPose(propIndex: number, out: PropPose): void;
  /** Calls `visit` for each contact of the last step whose impulse reached the threshold. `otherIndex` is -1 for a fixed body. */
  forEachImpact(visit: (propIndex: number, otherIndex: number, impulseNs: number) => void): void;
  snapshot(): Uint8Array;
  /** Replaces the Rapier world; leaves it untouched if `bytes` are refused. */
  restore(bytes: Uint8Array): void;
  dispose(): void;
}
```

- `forEachImpact` takes a callback. `propsSystem` passes one **created once** (module or factory scope), not a closure per step.

### Order inside `runPhysics` (slot: after `runPapa`, before the future `runGauges`)

1. For each `PushProp` of `ctx.commands` whose `propId` names an unbroken prop, call `pushProp(...)`. Otherwise do nothing.
2. Copy the current pose to `prev*` for every prop. A sleeping prop has prev = current, so its view does not jitter.
3. `ctx.physics.step()`.
4. For each awake prop, `readPose` into its slice (through a scratch `PropPose`).
5. Impacts: reset the scratch arrays (max impulse and partner per prop), fill them from `forEachImpact` (both sides of a prop–prop pair). Then, in index order, for each prop with impulse ≥ `impactMinImpulseNs`:
   - if `lastImpactAt` is null or `t − lastImpactAt ≥ impactCooldownMs`, push `PropImpact` and set `lastImpactAt`;
   - if the prop is unbroken, its kind is `breakable` and the impulse ≥ `breakImpulseNs`, set `isBroken` and push `PropBroken` after its `PropImpact`.
6. Update `isOnFloor` (D8) for awake props, then recount `mess`.

### Client (`src/client/render/views/`)

- `viewRegistry.ts`: `createViewRegistry<E, V>({ keyOf(e): string | number, create(e): V, update(v, e, alpha): void, release(v): void })` returns `{ sync(entities: readonly E[], alpha: number): void; readonly size: number; dispose(): void }`.
  - Keep a `Map<key, {view, seenAt}>` and a frame counter.
  - Views not seen in a frame are released.
  - No allocation once the set of keys is stable (test it).
- Pose: `propPoseAt(prop, alpha, out)` lerps the position. For rotation, use `Quaternion.slerpQuaternions` on scratch `Quaternion`s created once in `propView.ts` (the client may use `three`; the sim may not).
- Frozen-frame alpha caveat (`deferred-work.md:236`): a frozen frame renders `accumulatorMs / STEP_MS`, and props inherit that. Accept it; it is already deferred.

### Testing

- **`propsSystem.test.ts`** (Node, real Rapier through `createSim` with a small hand-built geometry; derive every expected number from `createTestContent().feel`, never from magic numbers):
  - a prop dropped from 1 m emits exactly one `PropImpact` with `otherPropId: null` and `impulseNs` ≥ the threshold;
  - nothing is emitted for 5 s of a resting room;
  - the cooldown: a bouncing prop's second impact inside the cooldown is not emitted, and one after it is;
  - prop on prop: both get a `PropImpact` naming each other;
  - break: a breakable kind above `breakImpulseNs` emits `PropBroken` once, and never again on later impacts;
  - an unbreakable kind never breaks;
  - `PushProp` on an unknown id and on a broken prop changes nothing and emits nothing;
  - `mess` counts: a prop spawned on the floor does not count, a fallen one does, a broken one moves to `propsBroken`;
  - `prev*` is the pose of the previous step;
  - a sleeping prop is not read;
  - the system order test.
- **Mutation check** (note the result in the Debug Log, as 1.14 did): comment out the `PropImpact` push and confirm that the tests fail.
- **Coverage:** `src/sim` stays ≥ 90 % (`npm run test:coverage`).
- **e2e:** T8. `props.spec.ts` follows `timeEffects.spec.ts`: `__PP__` only, `collectProblems`, no screenshot.

### Determinism scope

- The architecture promises replay « sur la même plateforme »; the epic says « sur la même machine ».
- The `deterministic-compat` build is built for cross-platform determinism (IEEE-754, no SIMD or FMA). The existing tests already assume more than the docs promise:
  - golden references are generated on macOS and checked on Linux CI;
  - the autoplay e2e compares chromium and webkit with Node.
- Keep both as they are. If either fails **only** across platforms, that is a finding for Geo (Open points), not a reason to weaken a check.

### Regression traps

- All four golden journals and their expected files move (hashes only). That change must be explained in the Completion Notes, as in 1.14.
- `tests/support/testLevelGeometry.ts`'s floating mug must be grounded (T2), or many sim tests gain prop events.
- Bots and `threatTiming` must not change: physics never touches threats, Papa or the baby in this story.
- `levelScene.test.ts` pins the static mug: update that case deliberately and do not delete it.
- Draw calls: the vase plus two blob shadows add about 3. Check `level.spec.ts`.
- `loop.ts` needs **no** change. If one seems needed, stop and write why in the Debug Log first (1.14 rule).
- Copy `drainEvents()` before stepping again (it is a reused array).
- Edge values: zero impulse (refused by `commandProblem`), NaN or Infinity (refused), huge impulses (the bounds walls hold the prop; a tunnelling prop is clamped by the floor because it is a thick cuboid. If you see tunnelling in the calibration, enable CCD on props with `setCcdEnabled(true)` and say so).

### Previous story intelligence (1.12 to 1.14 and their reviews)

- **Review hunts:**
  - docs or comments that disagree with the code (fix every comment that names 1.15: `snapshot.ts:10`, `step.ts:13-18`, `world.ts:132`, `gags.ts:5`, `loadLevelAssets.ts:13`);
  - edge values;
  - allocation in per-step and per-frame paths;
  - tests asserting with a tolerance where the arithmetic is exact (Rapier positions are deterministic: compare hashes exactly, not with `toBeCloseTo`, in replay tests);
  - silent fallbacks (every client fallback logs a `warn`);
  - state committed before validation (snapshot restore: validate everything, then swap).
- **Pattern to copy from 1.14:**
  - a data list plus a completeness proof for new unions (`PROP_SHAPES` + `…_ARE_COMPLETE`, as `SLOW_MO_SOURCES`);
  - `worldProblem` rejects each malformed field with its path;
  - the previous snapshot version is refused;
  - a by-hand check in the Debug Log;
  - one implementation commit `Story 1.15 : …` (in French) that also touches the story file, `sprint-status.yaml`, `deferred-work.md` and `project-context.md`.
- **1.13:** `startAndWait` and `levelSession` guard stale awaits with a generation counter. `dispose()` of a sim superseded by a newer `start()` must happen there too, for a sim created but never started.
- **1.12:** use a `Map` (not a plain object) for tallies keyed by content ids, and keep upper bounds on CLI inputs.

### Project Structure Notes

- **New files:**
  - `src/sim/physics/physicsPort.ts`, `rapierPhysics.ts` (+test), `propsSystem.ts` (+test) (architecture L491);
  - `src/shared/base64.ts` (+test);
  - `src/client/render/views/viewRegistry.ts`, `viewPool.ts`, `propView.ts` (+tests) (architecture L513);
  - `tests/golden/propFall.test.ts`, `tests/golden/journals/prop_fall*.json` (generated);
  - `tests/e2e/props.spec.ts`.
- **Modified files:**
  - `src/sim/{world,context,commands,events,step,snapshot,createSim,index}.ts` (`@sim` exports `PropSlice`, `MessSlice`, and `Sim.dispose` comes with the type);
  - `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json` (generated), `tests/support/testFeel.json`, `tests/support/testLevel.geometry.json`, `tests/support/testLevelGeometry.ts`;
  - `tools/content/contentChecks.ts`, `tools/sim/runSim.ts`, `tools/sim/replaySim.ts`;
  - `src/client/render/{levelScene,interpolate}.ts`, `src/client/app/levelSession.ts`, `src/client/assets/loadLevelAssets.ts` (comment);
  - `src/shared/constants.ts` (`PROP_ON_FLOOR_TOLERANCE_M`, `PHYSICS_FLOOR_THICKNESS_M`, `PHYSICS_BOUNDS_WALL_THICKNESS_M`);
  - `assets-src/blender/salon_crawler.blend`, `public/assets/levels/salon_crawler.glb` and `content/levels/salon_crawler.geometry.json` (generated);
  - every `tests/golden/journals/*.json` (generated);
  - `tests/e2e/__screenshots__/autoplay.spec.ts/*.png` (regenerated, 4 files).
- **No change** to:
  - `biome.json`, `tests/architecture/**`, `loop.ts`, `testApi.ts`, `content/feedback.json` or `gags.ts` (beyond its comment);
  - the bots.
- `src/shared/ids.ts` (architecture L468, `PropId`) does not exist. Do not create it for this story; plain `string` ids match the threat ids today.

### Project Context Rules

- Use `@dimforge/rapier3d-deterministic-compat@0.21.0` only, never the non-deterministic builds. Only `physics/rapierPhysics.ts` imports it. Rapier is for props only; Papa and the baby are kinematic.
- The sim:
  - never logs and never uses `try/catch`;
  - has no `Math.random`, `Date`, `performance`, `setTimeout`, `btoa` or `Buffer`;
  - keeps `World` plain JSON (no Rapier handles);
  - only allocates at creation (the Rapier getters of awake bodies are the documented exception).
- Systems are `(world, ctx) => void`, run in the fixed order, and never call each other. `pushProp` is a helper, not a system.
- Every tunable number is in `feel.json`, validated by Zod, with types from `z.infer`. Technical constants are UPPER_SNAKE in `shared/constants.ts`. Every value carries a unit suffix (`impulseNs`, `massKg`, `gravityMps2`, `yM`).
- Events are PascalCase past tense with `type` and `t`. Commands are PascalCase imperative.
- I/O returns `Result` (`decodeBase64`). There is no silent `catch`, and every client fallback logs a `warn`.
- Views are reconciled from `World` each frame by a `ViewRegistry` with pools. There is zero allocation per frame.
- Tests are colocated; e2e lives in `tests/e2e` and drives the game through `__PP__` only; goldens are never loosened; regenerated references are named in the story.

### Deferred by this story (add to `deferred-work.md`)

- Sounds, haptics and a feedback ring for `PropImpact` and `PropBroken` (stories 2.3 and 2.5; the « ring anchored on props » item moves there).
- Noise from impacts (3.1) and the mess score (1.22): both read only this story's events and `World`.
- Papa and the baby do not collide with props, and props are not nav obstacles (they walk through a fallen mug). Revisit when a gag or E6's dog needs it.
- A broken prop keeps its body and has no shards (E7 art).
- Instanced prop meshes once a room has about 10 props.
- Periodic 5 s snapshots stay with 3.9 (now carrying Rapier).
- Geometry cross-checks (props vs bounds, `kind` vs id prefix) stay open.

### Open points for Geo (do not block the dev)

- Per-kind physics sits in `feel.json` until `content/objects/` exists (E6). Is that OK, or would you rather have a `content/props/*.json` now?
- The calibrated values (masses, restitutions, break thresholds): play with them once the debug panel (2.1) exists.
- If Rapier positions differ between Node and WebKit (autoplay e2e) or between macOS and Linux (golden), what scope of determinism do we commit to?

### References

- `_bmad-output/planning-artifacts/epics.md` › Story 1.15 (L909-934); 1.16 (L936-958); 1.22 (L1118-1151); 3.1 (L1534-1561); FR21 (L54); « Exigences supplémentaires › Physique » (L183-186).
- `_bmad-output/planning-artifacts/game-architecture.md` › Modèle d'état (L226-232), Déterminisme (L234-239), Physique (L241-246), ADR-004/005 (L304-305), entity patterns (L855-880), Performances (L1079-1100), project tree (L491, L513).
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` › §11 Physique légère (L188), threat « Objet sur la table basse » (L237), Soupir (L393).
- `_bmad-output/project-context.md` L23, L40-43, L64, L71-74, L101-104, L115-122, L152.
- `_bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md` (patterns), `1-6-salon-greybox-depuis-blender.md` (asset pipeline), `1-13-autoplay-et-api-de-test-dans-le-navigateur.md` › Screenshots, `deferred-work.md` L33, L92, L93, L106, L148, L166, L222, L236.
- Rapier 0.21 typings: `node_modules/@dimforge/rapier3d-deterministic-compat/dist/pipeline/{world,event_queue}.d.ts`, `dist/geometry/collider.d.ts`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed: comprehensive developer guide created.

### File List

## Change Log

- 2026-10-27: story created (create-story).
