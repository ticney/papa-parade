---
baseline_commit: c14ff68360d9b9af776b9d62422b91d663fdd57d
---

# Story 9.2: Caméra qui suit papa

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want a camera that follows Papa in the big room,
so that the characters stay as big as they are today.

**Requirements covered:** FR77 (the follow camera and the 900 ms glide; the room is 9.1, the off-screen bubble is 9.3). **Depends on:** 9.1 (`salon_kitchen`, done), the perfect's camera move of 2.5 (`cameraFx.ts`), the sequence framing of 4.4 / 4.10, reduced motion of 2.10, the hit-test of 1.13 / 1.17 / 1.21.

**Scope:** a level field `camera: "fixed" | "follow"`, a `feel.json › camera` block, the follow maths (pure, sim clock), its wiring into the game camera and `cameraFx`, the judged-threat framing, reduced motion, the hit-test and the test mirrors through a moving camera, and the tests that pin all of it. Only `salon_kitchen` declares `follow`.

**Not in this story:**
- The off-screen bubble, tapping or targeting a threat that is outside the frame, the silence bubble's re-placement while the camera moves (9.3).
- The `human` bot's visibility model (9.8). The maths are written so that 9.8 can reuse them without `three` (D3).
- Making `salon_kitchen` the first level, its own waves (9.8). `DEFAULT_LEVEL_ID` stays `salon_crawler`.
- The end photo's camera (3.6): it keeps fitting the whole room (question 3).
- Moving the room's furniture. If a test shows the room needs it, stop and tell Geo.

## Acceptance Criteria

1. **The level says which camera it has.** `LevelSchema` gains `camera: "fixed" | "follow"`, default `fixed` (D1). `content/levels/salon_kitchen.json` declares `"camera": "follow"`; `salon_crawler.json` and `chambre_night.json` do not change and play `fixed`. `npm run content:schemas` regenerates `content/_schemas/level.schema.json` (committed). `levelSchema.test.ts` pins the default, the two values and a refused third one; `salonKitchen.test.ts` pins `follow` on the live level.
2. **The tuning is data.** `feel.json` gains a top-level `camera` block (D2): frame size, dead zone, edge margin, catch-up time, damping, reduced-motion catch-up, with Zod bounds and refines, documented `describe`s, and `content/_schemas/feel.schema.json` regenerated. The feel panel shows them (it is generated from the schema) and a `SetFeel` on them applies on the next frame. `feelSchema.test.ts` pins every bound and refine.
3. **The camera follows Papa** (AC 1 of the epic). In a `follow` level, when Papa walks or glides, the view follows his drawn position with a dead zone and a smooth catch-up (continuous velocity: no jump, no jolt), on the sim clock: a pause and a hitstop hold it, a slow-mo slows it. Papa's drawn point never comes nearer the frame's edge than `edgeMarginPct`, including during a 900 ms glide across the room. Pinned by `src/shared/followCamera.test.ts` (D3, Testing).
4. **It never rotates, and never leaves the room.** The camera's orientation is the iso one (`ISO_YAW_DEG`, `ISO_PITCH_DEG`) at every frame, except during a perfect's move, after which it comes back to it exactly (the quaternion of the base framing, bit for bit, and `fx().cameraYawDeg` 0). The view never shows beyond the room's box grown by `ISO_FIT_MARGIN_PCT` (the fixed camera's own breathing room), whether following, during a perfect's zoom and lean, or during a sequence framing; on an axis where the frame is wider than the room, the view is centred on the room (D4). Pinned by unit tests and by the e2e spec.
5. **The characters keep their size.** At 844 × 390 and 667 × 375, the follow camera in `salon_kitchen` draws a metre of floor at the same number of pixels as the fixed camera in `salon_crawler` (within 1 %). Pinned by a unit test on the live geometries and feel (D2).
6. **A judged threat is framed.** In a `follow` level, from a judgement (`ResponseResolved`, or `GagTriggered` of a threat) that happens while a slow-mo or a sequence framing runs, or that starts one, until that slow-mo and that framing are over, the follow aims at the judged threat instead of Papa (Papa's edge margin still wins); then it goes back to Papa with the usual catch-up. Through a perfect's zoom the threat's icon point stays inside the zoomed frame. Pinned by unit tests on the glue (D5).
7. **The hit-test hits the right world point on a moved camera** (AC 3 of the epic). With the camera moved off its start, a tap on a threat icon presses that threat, a tap on an object's icon sends `TapObject` for it, a tap on the floor sends `TapFloor` within 0.1 m of the world point under the finger (priority threat > baby / object > floor, unchanged). `hitTest.test.ts` proves it on a panned camera; `salonKitchen.spec.ts` proves it with real taps in the browser after Papa has walked to the kitchen. The test mirrors (`data-pp-threat-px`, `data-pp-object-px`) stay true while the camera moves, and `__PP__` gives a live page point of any world point (D9).
8. **Reduced motion** (AC 4 of the epic). Under « Réduire les animations » (or the OS preference), the catch-up uses `camera.reducedCatchUpMs` (longer than `catchUpMs`) with no overshoot at all (critically damped: the distance to the target never grows and never changes sign). The row « Follow camera (large room, v2.3): Slower catch-up, no overshoot (story 9.2) » of the reduced-motion table in `EXPERIENCE.md` is checked and kept (it is already there: D8). The perfect's turn stays removed and its zoom capped at 50 %, as today. The setting never reaches `src/sim`, `src/bots`, `tools/sim` (`comfortSettings.test.ts` unchanged and green).
9. **The glide in the big room is capped at the level's `glideMaxMs`** (AC 5 of the epic). A test on the live `salon_kitchen` content: the effective `glideMaxMs` is 900, and a glide from `papa_spawn` to the farthest planned threat lasts exactly 900 ms of sim time (`PapaGlideStarted.arriveAt − t`), Papa arriving at its goal (D10).
10. **The fixed camera does not move by a pixel.** In a `fixed` level, the camera, `cameraFx` and the mirrors behave exactly as before: the existing `isoCamera`, `cameraFx`, `hitTest` tests pass unchanged, the darwin screenshot references of `autoplay.spec.ts` are not regenerated and pass, and every existing e2e spec keeps its level.
11. **Goldens move on purpose, and only their hashes.** `npm run golden:update` is run deliberately (the new feel keys and level field): only `feelHash`, `levelHash` and `worldHash` move in `tests/golden/journals/`; no `eventTypes`, no `eventsHash`. Said in the Completion Notes with the file count.
12. **Geo can see it.** Screenshots of `salon_kitchen` at 844 × 390 and 667 × 375, Papa at his spawn and Papa at the kitchen end, in `_bmad-output/implementation-artifacts/9-2-screenshots/`, with what was checked by eye and what only Geo can judge (how much the camera moves, the dead zone, the catch-up). The merge waits for Geo's OK on the feel.

## Tasks / Subtasks

- [ ] **T0. Pre-flight** (all ACs)
  - [ ] `env | grep VITE_`: if `VITE_DEBUG_ALLOWED` is set, wrap `dev` and `e2e` in `(unset VITE_DEBUG_ALLOWED; …)`.
  - [ ] `git worktree list`: **3.15** (`story/3-15-sequelles-des-gags`) touches `content/feel.json`, `feel.ts`, `content/_schemas/`, `testHost.ts`, `boot.ts`, `testApi`, the goldens. **7.4** (cadrages parodiques) may touch the sequence framing. Whichever merges second regenerates schemas and goldens after merging `main`: note it, do not block on it.
- [ ] **T1. Content: `level.camera` and `feel.camera`** (AC 1, 2)
  - [ ] `src/content/schemas/level.ts`: `LEVEL_CAMERA_MODES = ['fixed', 'follow'] as const`, `LevelCameraMode`, and `camera: z.enum(LEVEL_CAMERA_MODES).default('fixed')` with a `describe` (D1). Update the header comment's list of stories.
  - [ ] `src/content/schemas/feel.ts`: a `CameraSchema` (D2) and `camera` in `FeelSchema` (after `fx`). Every key has a unit suffix and a `describe`; client only (say so in the block's `describe`, like `fx`).
  - [ ] `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json` (if it is a whole feel: check how 3.6 updated it): the block with the D2 values. `content/levels/salon_kitchen.json`: `"camera": "follow"`.
  - [ ] `npm run content:schemas`, `npm run content:check`. Tests in `levelSchema.test.ts`, `feelSchema.test.ts`, `salonKitchen.test.ts`.
  - [ ] `npm run ci:fast`: the goldens go red on hashes only (expected). Run `npm run golden:update` once, read the diff (AC 11), and say so in the notes.
- [ ] **T2. The follow maths, pure** (AC 3, 4, 8)
  - [ ] `src/shared/followCamera.ts` (D3): view-plane projection, the room's view extent, the clamp, the dead zone, the edge margin, the spring, the snap. Std lib only, no `three`, no `@content` import (a structural `FollowParams` interface that `Feel['camera']` satisfies), allocation-free in the step.
  - [ ] `src/shared/followCamera.test.ts`: the list in Testing. Constants in `src/shared/constants.ts` (`FOLLOW_SNAP_AFTER_MS`, any other non-tunable).
- [ ] **T3. The camera** (AC 3, 4, 5, 10)
  - [ ] `src/client/render/isoCamera.ts`: `fitFollowCamera(camera, room, frame, centreXM, centreZM, aspect)` (or an equivalent): `fitIsoCamera` on a box of `frameWidthM × frameDepthM`, with the room's `heightM` and `floorYM`, centred on the follow point. `fitIsoCamera` itself does not change.
  - [ ] `src/client/render/cameraFx.ts`: a way to move the captured base without resetting the move (D4), and, in follow mode only, the clamp of the composed view. The fixed path stays bit for bit (no change to the existing tests).
  - [ ] Scale test (AC 5) with the live geometries and feel.
- [ ] **T4. Wiring in `boot.ts` and the level** (AC 3, 6, 8)
  - [ ] The level's camera mode reaches the client when the camera is first fitted (`onLevelReady`), D7. `fitViewToCanvas` fits the follow frame for a `follow` level.
  - [ ] `beforeRender`: step the follow on the drawn sim clock, target Papa's drawn pose (`level.papaPose`) or the judged threat (D5), params from `world.feel.camera` and `prefersReducedMotion()`, then `cameraFx.update` as today.
  - [ ] `onSimEvent`: record the judged threat (D5) beside the existing `cameraFx.focusOn`.
  - [ ] Unit tests on the glue (a `followRig.ts` or similar module beside `cameraFx.ts`, so `boot.ts` stays thin): mode choice, reduced params, judged-threat target and its end, snap at level start.
- [ ] **T5. Hit-test and test hooks** (AC 7)
  - [ ] `hitTest.test.ts`: `pickFloor`, `pickThreat`, `pickObject`, `pickBaby` through a camera panned by `fitFollowCamera` land where the projection says (round trip world → screen → world within 1e-6 m). No change to `hitTest.ts` is expected; if one is needed, say why.
  - [ ] Mirrors: in a `follow` level re-project `data-pp-threat-px` (the last telegraphed threat) and `data-pp-object-px` when the camera has moved since they were written (D9). Mirrored builds only.
  - [ ] `TestHost` / `__PP__`: `pagePoint(xM, yM, zM)` (live projection, page px) and `fx()` gains `cameraMode`, `cameraCentreXM`, `cameraCentreZM`. `testApi.test.ts`, `tests/e2e/support/testApi.ts` (`ppPagePoint`), and the `pagePointOf` doc comment says it is the fixed camera's.
- [ ] **T6. Glide cap** (AC 9)
  - [ ] A test on the live `salon_kitchen` content (in `salonKitchen.test.ts` or a sim test with the live bundle): effective feel `glideMaxMs` 900; `PressThreat` on the farthest planned threat from `papa_spawn` → `arriveAt − t === 900`, and Papa reaches the glide's goal.
- [ ] **T7. Browser** (AC 4, 7, 10, 12)
  - [ ] `tests/e2e/salonKitchen.spec.ts`: new tests (Testing › E2E). Keep the three of 9.1 green (the tap test must still pass, now on a follow camera).
  - [ ] Run in the background: `npm run e2e -- tests/e2e/salonKitchen.spec.ts tests/e2e/testApi.spec.ts tests/e2e/juice.spec.ts tests/e2e/reducedMotion.spec.ts tests/e2e/autoplay.spec.ts tests/e2e/move.spec.ts tests/e2e/threat.spec.ts tests/e2e/level.spec.ts tests/e2e/chambreNight.spec.ts tests/e2e/sequence.spec.ts --project=chromium`.
  - [ ] Screenshots (AC 12) by a throwaway spec, then delete it.
- [ ] **T8. Docs**
  - [ ] `_bmad-output/project-context.md`: replace « The camera is the fixed one until 9.2 » in the `salon_kitchen` paragraph; one paragraph on the follow camera (mode, `feel.camera`, sim clock, clamp, judged threat, reduced motion, mirrors and `__PP__.pagePoint`); the reduced-motion rule (L91 area) names the follow.
  - [ ] `deferred-work.md`: a section for this story (Dev Notes › Deferred items); mark the 9.1 item « The fixed camera shrinks the characters » resolved.
  - [ ] `EXPERIENCE.md`: check the reduced-motion row is there and matches (D8); change nothing else in the UX docs.

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`camera` is a level field with a default.** `camera: z.enum(['fixed', 'follow']).default('fixed')`, like `objects` and `gauges` (which default too). Only `salon_kitchen.json` writes it. The sim never reads it; it is in the parsed level, so `levelHash` moves in every journal (AC 11). `content:check` needs nothing new. | The architecture's level format (v2.3) has `camera: "fixed" \| "follow"` and says the client alone reads it. A default keeps the salon and the bedroom files untouched (the epic: « la chambre garde `fixed` »; the architecture also keeps the current salon `fixed`). |
| D2 | **`feel.camera`, top level, client only, read live from `world.feel.camera`.** Keys and starting values: `frameWidthM` **9.1** and `frameDepthM` **6.2** (the camera box of `salon_crawler`: its geometry bounds are 9.1 × 6.2 m; the follow fits a box of that size, with the room's own `heightM` and `floorYM`, so the scale is the salon's at every aspect: AC 5); `deadZoneWidthPct` **30** and `deadZoneHeightPct` **30** (a centred rectangle, in % of the frame, where Papa moves without moving the camera); `edgeMarginPct` **15** (Papa's drawn point never nearer an edge than this share of the frame: a hard limit, above the HUD band's 12 %); `catchUpMs` **400** (sim ms for the camera to cover 95 % of a sudden jump of its target); `dampingRatio` **0.8** (1 = no overshoot; below, a slight bounce: at 0.8 about 1.5 %); `reducedCatchUpMs` **800**. Bounds: frame 3 to 30 m; dead zone 0 to 80 %; margin 0 to 40 %; `catchUpMs` 50 to 3000; `dampingRatio` 0.5 to 1; `reducedCatchUpMs` up to 5000. Refines: `deadZone…Pct / 2 + edgeMarginPct < 50` on each axis (the dead zone sits inside the hard limit); `reducedCatchUpMs >= catchUpMs`. A level can still override any of them through `feelOverrides`. | The epic, the GDD (« zone morte et vitesse de rattrapage, réglables comme le reste du feeling ») and the architecture (`feel.camera`: zone morte, rattrapage) put it in the feel. No document gives a number; these are starting points for Geo's playtest (GDD assumption 12). A spring (second order) and not a plain exponential lag: the lag jumps in velocity when Papa sets off, which reads as the « à-coup » the GDD forbids. The epic's « sans rebond » under reduced motion implies the normal catch-up may bounce a little. The key is not named `reducedMotion…` so no comfort name sits in the feel the sim carries (2.10's rule is on `src/sim`, `src/bots`, `tools/sim`; `reducedCatchUpMs` stays clear of the regex anyway). |
| D3 | **The maths are pure, in `src/shared/followCamera.ts`, on the sim clock.** Work in the view plane: for a world point, `u` along the camera's right `(cos yaw, 0, −sin yaw)` and `v` along its up `(−sin pitch · sin yaw, cos pitch, −sin pitch · cos yaw)`, with `ISO_YAW_DEG` / `ISO_PITCH_DEG` (a test checks these against `three`'s camera matrix columns after `fitIsoCamera`). The state is the view centre `(u, v)` and its velocity. Each update: (1) the target is the point to aim at (Papa, or the judged threat: D5); with Papa inside the dead zone around the current centre, the goal is the current centre; outside it, the goal is the nearest centre that puts him back on its edge; (2) the spring moves the centre toward the goal, sub-stepped at `STEP_MS` (stable, frame-rate independent), with ω from `catchUpMs` (dev's choice of formula, pinned by the 95 % test) and `dampingRatio` (or `reducedCatchUpMs` and 1); (3) the hard edge margin: if Papa's point is nearer an edge than `edgeMarginPct`, the centre is pushed and the velocity component into that edge set to 0; (4) the clamp: the centre stays within the room's view extent (its 8 corners projected, grown by `ISO_FIT_MARGIN_PCT` as `fitIsoCamera` does) minus the frame's half size, and on an axis where the frame is larger than that extent the centre is the extent's middle. The clamp wins over the margin (only possible at a wall, where Papa cannot go). A delta of sim time ≤ 0 does nothing; above `FOLLOW_SNAP_AFTER_MS` (a constant, e.g. 1000: a debug `advance`, a restart) the centre snaps to its goal. The client converts the centre back to a floor point for `three`. | The architecture: the `human` bot of 9.8 « recalcule le cadre depuis la position de papa et `feel.camera`, sans `three` » and bots may import only `@sim` and `shared`. So the maths go to `shared` now, and `isoCamera.ts` keeps the `three` side (variance below). The sim clock (the one `cameraFx` already uses, `world.time.sim − STEP_MS × (1 − alpha)`) makes a frozen e2e level a still camera, holds the camera in a pause and the hitstop, slows it in a slow-mo with everything else, and lets 9.8 replay it from a journal. View-plane coordinates make the dead zone, the margin and the clamp plain 2D rectangles. |
| D4 | **Compose with `cameraFx`, do not replace it.** `cameraFx` keeps the perfect's zoom, lean and turn and the sequence framing on top of a *base*. Today the base is captured once per fit (`captureBase`, which also resets the move's state: calling it every frame would break the refocus glide). Add a method that translates the captured base (position and centre by the same floor vector) without touching the move's state, and makes the next `update` write the camera even when no move is under way (today `update` returns early with both blends at 0 and nothing displaced). In follow mode only, `update` clamps the composed centre so the *zoomed* view stays inside the room's view extent (the same clamp as D3, with the half size divided by the zoom; the perfect's ≤ 12° turn is ignored by the clamp, a documented tolerance, and is 0 under reduced motion). Fixed mode never calls the new method and never clamps: bit for bit as today (AC 10). | The perfect's lean (35 %) at 18 % zoom can show a strip beyond the base view near a wall: the AC « sans sortir des bornes de la pièce » holds only if the composed view is clamped. The fixed camera has always allowed it and its screenshots are references: it stays. The orientation never changes except through the perfect's turn, which `restore()` already puts back from `baseQuaternion` (AC 4): a test pins it in follow mode, after the base has moved during the move. |
| D5 | **The judged threat.** `boot.ts`'s `onSimEvent` already sends `cameraFx.focusOn(threat)` on a perfect. Beside it, in a follow level, record the threat of every `ResponseResolved` and of every `GagTriggered` (its `threatId`, the threat's `xM` / `zM`). While any slow-mo of `world.time.slowMos` runs or `sequenceFraming.blend > 0`, and the judgement happened at or after the start of that period (or started it: `perfect` and `lastThreat` start at the judgement), the follow's target is that threat's floor point; once no slow-mo and no framing is left, the target is Papa again and the camera goes back with the usual catch-up. Papa's edge margin still applies. | The GDD: « Pendant les ralentis et les cadrages serrés, elle cadre la menace jugée ». « Ralentis » is plural: `perfect` and `lastThreat` (both at a judgement), `instinct` and `comboCashIn` (a judgement may fall inside them); a fail inside an instinct slow-mo frames its gag. The sequence framing still leans toward Papa as 4.4 wrote it (it is a sequence's, and the chambre is fixed anyway). 2.5 decided « a `lastThreat` slow-mo moves nothing »: that was for the fixed camera's zoom, and stays so: in follow mode only the follow's *aim* changes, no zoom is added. |
| D6 | **Papa's drawn position, not the sim's.** The target is `level.papaPose` (interpolated, written by `level.update`, which runs just before `beforeRender`), so Papa and the camera move in the same frame with no jitter. Papa out of the room (the toilet, 4.3) keeps his last pose: the camera stays. | The draw clock is the one the camera already uses (deferred: the camera clock is 10 ms behind the rings: unchanged). |
| D7 | **Start, resize, end.** The mode is known when the camera is first fitted (`onLevelReady`): pass it with the level (for example `LevelScene.cameraMode` beside `room`, set from `levelPlan.level.camera`; dev's choice). The first follow update of a level snaps to the goal for Papa's start (no catch-up from where the previous level left the camera); the frame behind the loading screen is already the follow framing. A resize refits the frame at the new aspect, keeps the centre, re-clamps and re-applies the edge margin, with no catch-up (« on resize the follow camera keeps Papa framed and the character scale unchanged », EXPERIENCE `[ASSUMPTION]`). The level's end and `onFxReset` leave the follow centre where it is (the Result is drawn over the last frame). | `fitViewToCanvas` runs on every resize and at `onLevelReady`; today it refits the whole room, which in follow mode would undo the follow. |
| D8 | **Reduced motion.** `prefersReducedMotion()` picks `reducedCatchUpMs` and a damping ratio of 1. The threat framing (D5) is an aim, not a zoom: it stays. The 50 % zoom cap and the removed turn are `cameraFx`'s, unchanged. `EXPERIENCE.md` already has the row (« Follow camera (large room, v2.3) · Slower catch-up, no overshoot (story 9.2) ») and the architecture has the rule (« Caméra qui suit : rattrapage plus lent et sans rebond »): the epic's « ligne ajoutée au tableau » is done in the UX docs; check it, and add the rule to `project-context.md`. | UX-DR18 points at the EXPERIENCE table; the epic's list under 2.10 is history, not to edit. |
| D9 | **The hit-test needs no change; the mirrors do.** `createHitTester` reads the camera's matrices at each pick, and the camera is moved in `beforeRender`, before the draw: a tap between two frames is tested against the frame on screen. The world UI already lays out through the camera every frame. What goes stale is the Playwright side: `data-pp-threat-px` is written at the telegraph and `data-pp-object-px` once per level (deferred 2.5 already notes they are « valid at the base framing only »). In a follow level, re-project both whenever the camera's base has moved since they were written (written only on change, as `mirror` does; mirrored builds only). Add `__PP__.pagePoint(xM, yM, zM)` (the live camera, page px, the projection `threatScreenPoints` uses) and `cameraMode`, `cameraCentreXM`, `cameraCentreZM` to `fx()`. `pagePointOf` in `tests/e2e/support/game.ts` stays the fixed camera's (its comment says so); follow specs use `ppPagePoint`. | The epic: « les specs e2e de tap passent sur une caméra déplacée ». A spec that taps a mirror written before the camera moved would miss and blame the hit-test. `__PP__` is a shared contract: run `testApi.spec.ts`. |
| D10 | **The 900 ms glide is already there; pin it.** 9.1 put `feelOverrides: { movement: { glideMaxMs: 900 } }` in `salon_kitchen.json`, and `startGlide` lasts `min(glideMaxMs, pathLength / walkSpeedMps)`. At `walkSpeedMps` 3, any path over 2.7 m hits the cap; `outlet_01` (1.6, −3.45) is about 5.8 m in a straight line from `papa_spawn` (5.25, 1), so a press on it from the spawn glides exactly 900 ms (read the path length from the sim; if a planned threat's path turns out shorter, press from the kitchen end instead and say so). The follow must keep up: AC 3's glide test (13 m in 900 ms) is the follow's, not the sim's. | The epic's AC 5. The camera side is what is new: at about 15 m/s the spring lags by roughly `2 × dampingRatio × speed / ω`, which the edge margin bounds. |

### What the numbers say (read before tuning)

Measured with `fitIsoCamera`'s own maths (a scratchpad script on the live bounds; reproduce it in the scale test):

| Aspect | `salon_crawler` fixed: view W × H (m) | `salon_kitchen` fixed | Kitchen's view extent (W × H) |
|---|---|---|---|
| 844 × 390 (2.16) | 20.1 × 9.3 | 26.1 × 12.1 | 15.4 × 11.6 |
| 667 × 375 (1.78) | 16.5 × 9.3 | 21.4 × 12.1 | 15.4 × 11.6 |
| 4:3 | 12.4 × 9.3 | 16.1 × 12.1 | 15.4 × 11.6 |

So at the salon's scale on a landscape phone the frame (16.5 to 20 m wide) is **wider than the whole kitchen** (15.4 m): horizontally the view stays centred on the room (D3's clamp), and the camera travels only on the screen's vertical, about 2.3 m (11.6 + 4 % against 9.3). Walking the room's 13.5 m length moves Papa about 9.5 m across the screen and 5.5 m up it, so the follow *is* visible, but it is a vertical one. This is what « characters keep their size » gives with this room; whether Geo wants a tighter frame (bigger characters, more travel) is question 1. Do not change `frameWidthM` / `frameDepthM` to make the camera move more: AC 5 pins them.

### What exists, and what must keep working

- **`src/client/render/isoCamera.ts`**: `createIsoCamera`, `fitIsoCamera(camera, room, aspect, view?)` (projects the 8 corners of the room box, grows by `ISO_FIT_MARGIN_PCT` 4, widens one axis to the aspect; `ISO_CAMERA_DISTANCE_M` 40, orthographic). The photo uses it with its own `view`. Unchanged; a box centred on any point projects symmetric about it, so a follow frame is a translation of one fit.
- **`src/client/render/cameraFx.ts`**: `perfectCameraBlendAt`, `sequenceFramingBlendAt`, `createFramingChain`, `createCameraFx(camera)` with `captureBase`, `focusOn`, `update(world, clockMs, perfectCamera, isMotionReduced, framing)`, `reset`, `zoom`, `yawDeg`. Zoom and pan add; reduced motion caps zoom at `REDUCED_MOTION_ZOOM_CAP_PCT` 50 and drops the turn. `restore()` writes the base back exactly. Its tests must pass as they are.
- **`src/client/boot.ts`**: `camera`, `photoCamera`, `cameraFx`, `sequenceFraming`, `framingChain` (L233–242); `fitViewToCanvas` (L264–272, on `ResizeObserver` and `resize`); `onLevelReady` sets `room` and refits (L1110–1121); `beforeRender` computes the drawn sim clock and the sequence framing, then `cameraFx.update` (L1122–1160); `onFxReset` → `cameraFx.reset()`; `onSimEvent` → `cameraFx.focusOn` on a perfect (L1423–1427); mirrors `ppObjectPx` (L685–700, once per level) and `ppThreatPx` (L840–858, at each telegraph); `threatScreenPoints` (L2085–2095); `fx()` (L2060–2080).
- **`src/client/app/levelSession.ts`**: the render callback runs `level.update` → `beforeRender` → `renderer.render(level.scene, camera)` → `onLevelFrame` (L533–541); `stopLoop` calls `onFxReset`. `onLevelReady(level, threatEntries)` comes after `makeScene`, before the loop.
- **`src/client/render/levelScene.ts`**: `roomOf(geometry)` (L224), `LevelScene.room`, `LevelScene.papaPose` (interpolated). The shake moves `content_root`, never the camera (taps ignore it: accepted in 2.5).
- **`src/client/input/hitTest.ts`**: projects through the camera at each pick; `moveDirection.ts` reads the camera's basis (a pan does not change it); `autoTarget` may pick an off-screen threat (9.3).
- **World UI** (`threatMarkers`, `papaHint`, `worldUi.render(camera)`) lays out through the camera each frame: it follows by itself. The **silence bubble** (`hud/silenceBubble.ts`) is placed when it shows and on resize only: in a follow level its side can go stale. Leave it to 9.3 (deferred).
- **`src/sim/papa/glide.ts`**: `min(glideMaxMs, len / walkSpeedMps)`. No sim change in this story.
- **Feel panel** (`src/debug/feelPanel.ts`, `feelControls.ts`): built from the JSON Schema, so `feel.camera` gets its controls by regenerating the schemas; `SetFeel` reaches `world.feel`, which the client reads per frame.
- **Must not change:** `src/sim/**` (no sim file is expected to change; tests that read the live content may be added under `tests/`), `src/bots/**`, `fitIsoCamera`, the fixed path of `cameraFx`, `salon_crawler.*`, `chambre_night.*`, `salon_kitchen.geometry.json` and `.glb`, `DEFAULT_LEVEL_ID`, `public/_headers`, the darwin references.

**Expected changes:** new `src/shared/followCamera.ts` (+ test), a client glue module (+ test), `9-2-screenshots/*`; modified `src/content/schemas/{level,feel}.ts`, `content/feel.json`, `content/levels/salon_kitchen.json`, `content/_schemas/{level,feel}.schema.json`, `src/shared/constants.ts`, `src/client/render/{isoCamera,cameraFx}.ts` (+ tests), `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/render/levelScene.ts` (if the mode goes there), `src/client/input/hitTest.test.ts`, `src/debug/testApi.ts` (+ test), `tests/e2e/support/{testApi,game}.ts`, `tests/e2e/salonKitchen.spec.ts`, `tests/content/{levelSchema,feelSchema,salonKitchen}.test.ts`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json` (if a whole feel), `tests/golden/journals/*` (hashes), `_bmad-output/project-context.md`, `deferred-work.md`, `sprint-status.yaml`, this story.

### Deferred items

Add a section for 9.2 in `deferred-work.md`:
- « The silence bubble's side is computed when it shows » (`silenceBubble.place`): in a follow level the camera moves under it. For 9.3.
- « An off-screen threat cannot be tapped or seen » until the bubble: for 9.3. Keyboard and gamepad auto-target already reach it.
- « The follow is stepped once per frame on the drawn clock, not once per sim step »: 9.8's visibility model steps the same function per sim step; the two can differ by a fraction of a step. Accepted for a model of perception.
- « The clamp ignores the perfect's turn (≤ 12°) »: a sliver beyond the room's box is possible during the turn, near a wall.
- « The end photo fits the whole big room » (question 3).
- « The follow frame is the salon's size, which barely moves the camera on a landscape phone » (question 1).
- Mark resolved: « The fixed camera shrinks the characters in `salon_kitchen` » (9.1).

### Testing

- **`src/shared/followCamera.test.ts`** (pure, fast): the view basis matches `three`'s camera columns after `fitIsoCamera` (this test may import `three`: `tests` and test files may; the module may not); Papa moving inside the dead zone leaves the centre still; a jump of the target is covered to 95 % in `catchUpMs` (± 10 %); velocity is continuous (no step change between two sub-steps when the target starts moving); at `dampingRatio` 0.8 the overshoot is above 0 and under 3 %; at 1, and with the reduced params, the distance to the goal never increases and never changes sign, and the reduced catch-up is slower; a 13 m glide in 900 ms keeps Papa's point at least `edgeMarginPct` from every edge at each sub-step; the centre never leaves the clamped extent; a frame larger than the extent on an axis gives the extent's middle on it; a delta above `FOLLOW_SNAP_AFTER_MS` snaps; a delta ≤ 0 does nothing; the same inputs give the same outputs (no hidden state, no `Math.random`, no `Date`).
- **`isoCamera.test.ts` / `cameraFx.test.ts`**: the existing tests unchanged; new ones for `fitFollowCamera` (a translation of the fit), the base move under a perfect (the move keeps going, the refocus glide is not broken), the camera's quaternion back to the base one exactly after the perfect in follow mode, the composed clamp at a wall, fixed mode unclamped.
- **Scale (AC 5)**: with `content/levels/{salon_crawler,salon_kitchen}.geometry.json` and the live `feel.json`, at 2.16 and 1.78: `(top − bottom) / zoom` of the follow camera equals the salon's fixed one within 1 %.
- **Glue tests**: mode fixed → no follow; follow + reduced → reduced params; judged-threat target from a `ResponseResolved` inside a slow-mo, back to Papa when the slow-mo ends; a `GagTriggered` inside an `instinct` slow-mo; a judgement with no slow-mo and no framing changes nothing; first update snaps.
- **`hitTest.test.ts`**: the four picks on a panned camera.
- **Content**: `levelSchema.test.ts` (default, values, refusal), `feelSchema.test.ts` (bounds, both refines), `salonKitchen.test.ts` (`camera: 'follow'`; the glide cap of AC 9 if done there).
- **Architecture**: `comfortSettings.test.ts`, `layerBoundaries.test.ts` (`shared` imports nothing), `biomeBoundaries`, unchanged and green.
- **E2E** (`salonKitchen.spec.ts`, Chromium): (1) the three tests of 9.1, green; (2) « the camera follows Papa »: frozen, seed fixed, `__PP__.send` a `TapFloor` (or a `TapObject` on `coffee_machine`) that walks Papa to the kitchen end, advance until he arrives, wait frames: `fx().cameraMode` is `follow`, the centre has moved by more than 1 m, `fx().cameraYawDeg` is 0; (3) « taps hit the right point on a moved camera »: from there, a real tap at `ppPagePoint` of the coffee machine's icon point sends `TapObject{coffee_machine}` (journal); a real tap at `ppPagePoint` of a floor point near Papa sends `TapFloor` within 0.1 m of it; step until a threat opens, tap `threatIconPoint` (the re-projected mirror) and get its `ResponseResolved`. Neighbours: `testApi`, `juice`, `reducedMotion`, `autoplay` (screenshots unchanged), `move`, `threat`, `level`, `chambreNight`, `sequence`, through `npm run e2e -- … --project=chromium` in the background.
- **Goldens**: `npm run golden:update` once, deliberately; read the diff (AC 11).
- **Before the merge**: one `npm run ci:story`, after the review. `npm run ci` is not needed (this merge does not complete Epic 9).

### Project Structure Notes

- **Variance (architecture):** the architecture puts the follow mode in `src/client/render/isoCamera.ts`. Here the maths go to `src/shared/followCamera.ts` and `isoCamera.ts` keeps the `three` side (`fitFollowCamera`). Reason: the architecture's own 9.8 line (the bot recomputes the frame « sans `three` ») and the layer table (bots import `@sim` and `shared` only). Say it in the Completion Notes.
- **Variance (hit-test priority):** the epic writes « menace > objet > sol »; the code is threat > baby / object (the nearer) > floor (1.21). Keep the code's; the AC says so.
- **Variance (glide formula):** the architecture writes it two ways; the code is `min(glideMaxMs, len / walkSpeedMps)`. Keep the code.
- New files are `camelCase.ts`, factories `create<Name>`, constants `UPPER_SNAKE` in `shared/constants.ts` with unit suffixes; FSM-like modes are string-literal unions (`'fixed' | 'follow'`), never `enum`.

### Project Context Rules

- **Golden rule:** the AI writes and tests; Geo plays and tunes the feel. Every follow number is in `feel.json › camera`; only non-tunable plumbing (`FOLLOW_SNAP_AFTER_MS`) is a constant.
- **Layers:** `shared` imports nothing but the std lib (no `three`, no `zod`, no `@content`). The client may import `@shared`, `@content`, `@sim`, `three`. No `console.*`; log through `@shared/log` (never in `shared/followCamera.ts`: it has nothing to log).
- **Sim purity:** no sim change. Reduced motion is client only; its name never enters `src/sim`, `src/bots`, `tools/sim`.
- **Time:** `…At` / `t` are sim time; the follow runs on the drawn sim clock; `…AtReal` is real time. Never mix them. Units are suffixes (`catchUpMs`, `frameWidthM`, `deadZoneWidthPct`).
- **Per-frame code allocates nothing** (`cameraFx` and the hit-test are preallocated: keep it so; the mirrors' re-projection is debug-only).
- **Content:** JSON keys camelCase, `content:schemas` regenerated and committed, never edited by hand.
- **Checks:** `ci:fast` after each task; the touched e2e specs on Chromium through `npm run e2e -- …` in the background (never `npx playwright test`); `ci:story` once before the merge; check `VITE_DEBUG_ALLOWED` first.
- **Git:** this worktree, branch `story/9-2-camera-qui-suit-papa`. Commits « Story 9.2 : <titre> ». Merge only after the review, a green `ci:story` and Geo's OK.

### Previous story intelligence

- **9.1** built `salon_kitchen` (walkable 13.5 × 7 m, x ∈ [−6.75, 6.75], z ∈ [−3.5, 3.5]; bounds [−6.95, −0.8, −3.7] to [7.65, 2.5, 3.5]; `papa_spawn` (5.25, 1), `baby_spawn` (2.25, 0.7), `coffee_machine` (−6.4, 1.05, −2), `stove` (−5.15, 0.92, −3.125), `outlet_01` (1.6, 0.3, −3.45)) and noted that the fixed camera shrinks the characters to about three quarters (the table above: 9.3 / 12.1 = 0.77). Its `salonKitchen.spec.ts` (`openFrozen`, `ppAdvance`, `threatIconPoint`, `typesOf`, `shot`, `collectProblems`, `OWN_WARNINGS`) is the model for the new tests. Its review lesson: never claim a visual check you did not make, and say in the notes what the screenshots show and do not.
- **2.5** made the perfect's camera a move *around* the fitted framing, on the sim clock, so that the world UI and the hit-test read the same camera as the draw: this story keeps that contract with a moving base.
- **3.6** added feel keys and regenerated the goldens deliberately (54 files, `feelHash` and `worldHash` only, `testFeel.json` and `feelSample.json` updated): the same procedure here, with `levelHash` too.
- **4.4 / 4.10** compose the sequence framing with the perfect's move and chain framings (`createFramingChain`): do not touch the chain; the follow sits under both.

### Git intelligence

Recent commits: `c14ff68` (9.1 merge: the room, its tests, NFR15), `fce389d` (2.13 merge: characters, `papaView`, `characterMotion`). Nothing has touched `cameraFx.ts` or `isoCamera.ts` since 4.10 and 3.6. Open worktrees: 3.15 (feel, goldens, `boot.ts`, `testHost.ts`: merge-order conflict on schemas and goldens, resolved by regenerating), 3.7, 7.4.

### Latest technical information

No new dependency. `three@0.186.1` (pinned): `OrthographicCamera.zoom` scales the frustum after `updateProjectionMatrix()`; `Vector3.project(camera)` uses `matrixWorldInverse` and `projectionMatrix`, both refreshed by `updateMatrixWorld(true)` / `updateProjectionMatrix()` as `cameraFx` already does; `Raycaster.setFromCamera` on an orthographic camera casts parallel rays from the near plane, so a translated camera needs nothing else. No web research was needed: the follow is our own maths, and the stack is pinned.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.2, #Epic 9, FR77, FR61, UX-DR18, #Story 2.5, #Story 2.10]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Cadre de level design (Caméra qui suit, Grand salon), mécanique 3 (glissade 0,9 s), mécanique 12 (menace hors cadre), Effets de feeling, hypothèse 12]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Chaîne d'entrées (step 2), #Retours multimodaux (mouvement réduit), #Contenu et feeling (`camera`), #Automatisation (modèle de visibilité), #Format du niveau v2.3 (`camera`), module table (Rendu), E9 mapping row 9.2]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md#Camera (v2.3); EXPERIENCE.md#State Patterns, #Interaction Primitives (Tap), #Reduced motion table, #Responsive]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md#FR77, #Story 9.2, architecture changes (Rendu, P4, L220, L250)]
- [Source: _bmad-output/project-context.md (sequences framing, end photo, reduced motion, `salon_kitchen` paragraph, hit-test priority)]
- [Source: _bmad-output/implementation-artifacts/9-1-grand-salon-avec-cuisine-ouverte-dans-blender.md, deferred-work.md (2.5 mirrors, 9.1 camera)]
- [Source: src/client/render/{isoCamera,cameraFx,levelScene,interpolate}.ts, src/client/boot.ts, src/client/app/{levelSession,testHost}.ts, src/client/input/{hitTest,moveDirection}.ts, src/client/ui/hud/silenceBubble.ts, src/content/schemas/{feel,level}.ts, src/sim/papa/glide.ts, src/sim/world.ts (`SlowMoSource`), src/debug/{testApi,feelPanel}.ts, tests/e2e/salonKitchen.spec.ts, tests/e2e/support/{game,testApi}.ts, tests/architecture/comfortSettings.test.ts]

### Questions for Geo (do not block the dev)

1. **The frame.** At the salon's scale (« les personnages gardent leur taille »), a landscape phone sees the whole width of the kitchen; the camera moves only up and down, about 2.3 m. Is that the follow you want, or should the frame be tighter (bigger characters, a camera that travels across the room)? It is two numbers in `feel.camera`; AC 5 would then pin the new scale instead of the salon's.
2. **The starting values** (dead zone 30 %, margin 15 %, catch-up 400 ms, damping 0.8, reduced 800 ms) are guesses for the playtest.
3. **The end photo** still fits the whole big room (small characters). Keep it, or frame it around Papa later (3.7 / 7.4)?

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-11-04 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
