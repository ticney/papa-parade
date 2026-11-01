# Story 3.5: Porte qui s'ouvre et rush final

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to hear the door open and have 10 seconds to hide everything,
so that every level ends in an apotheosis of panic.

Requirement: FR35 `[V1]`. First of the `[V1]` end-of-level stories: 3.6 (photo), 3.7 (reactions), 3.9 (replay) and 3.10 (Retour) build on the flow states added here.

## Acceptance Criteria

### The flow

1. **Opt-in.** `LevelSchema` gains an optional `finalRush: {}` (strict, no default, same pattern as `carry` and `cycle`). `salon_crawler` and `chambre_night` declare it. A level without it, every test fixture included, behaves exactly as today and ends in `ended`.
2. **The tunable.** `feel.endOfLevel.finalRushMs` (10 000, positive) in `FeelSchema`, `content/feel.json`, `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `content/_schemas` regenerated. `finalRushProblems` (pure, shared by `simLevelOf` and `content:check`, same words) refuses a `finalRush` level whose `durationMs` is not above `finalRushMs`.
3. **The start.** In a level with `finalRush`, at the first step where `world.time.sim >= durationMs - finalRushMs`, `runFlow` closes a running sequence first (`SequenceEnded{levelEnded}`), enters `finalRush`, writes `world.flow.finalRushAt` and emits `FinalRushStarted`, once.
4. **The end.** At `durationMs`, a `finalRush` level goes to `photo`, with `LevelEnded{timer}` and `LevelScored` in that same step (D2). `photo` is frozen like `ended`: `isFlowLive` is false, `step()` runs `ENDED_SYSTEMS`, commands are dropped.
5. **The other ends.** Noise at 100 % during the rush still gives `MamaWoke`, `LevelEnded{mamaWoke}` and `ended` (D4). A cycle completed before the rush still gives `cycleDone`. No sequence, and so no `cycleDone`, can start in the rush.
6. **What goes on and what stops in the rush.** Threats, the director, the baby, silences, noise, the instinct, the combo and physics run as usual, and a gag still costs its points (GDD: « Les gags du rush pèsent seulement sur la note »). The micro-sleep, the cry in the arms, a `pending` phone and the bedtime cycle do not start (their `=== 'playing'` tests stay). `sequenceRefusal` returns a new `finalRush` reason, with its text in `debug/cheats.ts`. A phone already ringing keeps ringing.

### The door

7. **Sound, visual, vibration.** `FinalRushStarted` plays the cue `final_rush_started` (`feedback.json › events`): a new clip `env_door_key`, a two-pulse ring on a new `door` ring anchor, and a `medium` haptic.
8. **The animation.** A closed door panel stands at `ANCHOR_door` in both levels and swings open from `world.flow.finalRushAt`, on the render's sim clock, so a pause or a slow-mo holds it. It stays open through `photo` and through `ended` after a `mamaWoke` in the rush. Under reduced motion it jumps open. It never opens in a level or game without a rush.

### Tidying

9. **The prop state.** `PropSlice.isMess` (`!isBroken && isOnFloor && spawnedAboveFloor`) is written by `runPhysics`, and `world.mess.propsOnFloor` is the count of it.
10. **The command.** In `finalRush` only, `TapObject{objectId}` naming a prop with `isMess` walks Papa to it (`startWalkTo`, `papa.objectId`, `ObjectTapped`). The same id outside the rush, or naming a prop without `isMess`, does nothing: no walk, no event. A real object's `TapObject` works as before in the rush.
11. **On arrival.** If the prop still has `isMess`, Papa tidies it: `PropTidied{propId}`, `world.score.propsTidied + 1`, the prop back at its spawn pose with zero velocities (`PhysicsPort.resetProp`), then Papa is idle. If it no longer has `isMess`, Papa is simply idle there. A broken prop cannot be tidied.
12. **The note.** A tidied prop leaves `propsOnFloor` in that same step, so the Soupir falls by `feel.mama.sighPerPropOnFloorPoints` (D6), still held to `sighMaxPoints`. A test scores the same game with and without the tidy and pins the difference through the feel's value, not a literal.
13. **The cue.** `PropTidied` plays `prop_tidied` (`feedback.json › events`): a new clip, a ring on `papa` and a `light` haptic.

### Client

14. **Touch.** In the rush a prop with `isMess` is a target at `objectTouchRadiusPx`, weighed with the baby and the objects by the existing « nearer to the finger » rule (threat still first), sending `TapObject` and the tap marker at the prop's floor point.
15. **Keyboard and gamepad.** With no threat up, Space / A in the rush sends `TapObject` for the nearest `isMess` prop within `contextReachM`, ahead of the baby and of any object; with none in reach the action behaves as today.
16. **The marker.** Each prop with `isMess` shows a verb marker « RANGE ! » (`verb.tidy` in `strings.fr.json`) in the rush, from the world's state each frame, hidden as soon as it is tidied and during `photo`. Class and text are written only when they change.
17. **The timer.** `timerHud` wears `pp-hud-timer--rush` from the world's state while `flow.state === 'finalRush'`, using a design token and no new DOM node. Under reduced motion it does not pulse.
18. **Mirrors.** `data-pp-flow` shows `finalRush` on `FinalRushStarted`, and on `LevelEnded` it shows `world.flow.state` (`photo` or `ended`), not a literal. New mirror `data-pp-props-tidied`, on events only; add its marker to `tools/build/inspectDist.ts`.

### Bots, tools, docs

19. **Bots.** `perfect` and `human` tidy through a shared `planTidy` (`threatTiming.ts`): in the rush, Papa idle, nothing of the bot's to answer, one `TapObject` on the nearest `isMess` prop; `human` waits `reactionMs` after `finalRushAt`. No `world.rng` draw; `random` and `idle` do nothing new, and no existing draw moves.
20. **Report.** `simReport` gains `finalRushes` and `propsTidied`, per run and in the totals; `simArgs` help says so.
21. **The cycle.** `cycleProblems` is given the playable time (`durationMs - finalRushMs` in a `finalRush` level), in `createSim.ts` and in `contentChecks.ts`. `chambre_night` must still pass.
22. **Id clash.** `content:check` and `simLevelOf` refuse a level where an object id equals a prop id (same words).
23. **Snapshot.** Version 28: `PropSlice.isMess`, `score.propsTidied` and `flow.finalRushAt`, all checked (see Traps).
24. **Docs.** `project-context.md` gets a « final rush » paragraph, line 78's snapshot version, and the « Three ways to end a level » paragraph updated. `EXPERIENCE.md` gets the tidy marker and the rush timer.

## Tasks / Subtasks

- [ ] Task 1: Flow states, feel and level opt-in (AC: 1, 2, 3, 4, 5, 6, 21, 23)
  - [ ] Add `finalRush` and `photo` to `FlowState` and `FLOW_STATES`; make `isFlowLive` false for `photo`
  - [ ] Classify every reader of `flow.state` (table below)
  - [ ] Add `feel.endOfLevel`, `LevelSchema.finalRush`, `SimLevel.hasFinalRush`, `finalRushProblems`; run `npm run content:schemas`
  - [ ] `runFlow`: the order noise, cycle, timer, rush start; `endLevel` picks `photo` or `ended`
  - [ ] `FinalRushStarted` in `events.ts` and its event list; `flow.finalRushAt` in `world.ts`
  - [ ] Pass the playable time to `cycleProblems` in both callers
  - [ ] Unit tests in `flowSystem.test.ts`, including a rush that cuts each sequence kind
- [ ] Task 2: Tidying in the sim (AC: 9, 10, 11, 12, 22, 23)
  - [ ] `PropSlice.isMess`, written in `runPhysics` step 6; `propsOnFloor` counts it
  - [ ] `SimPropSpec.spawnM`; `PhysicsPort.resetProp` in `rapierPhysics.ts` and in every fake port in tests
  - [ ] New `sim/papa/tidyProp.ts`; branch in `tapObject` and in `arrive`
  - [ ] `PropTidied`, `score.propsTidied`
  - [ ] Snapshot 28 and its checks; the object / prop id clash check
  - [ ] Tests: AC 10 to 12, re-settling emits no `PropImpact` and no noise, a tidied prop can be knocked over and tidied again, snapshot round trip in the middle of a rush walk
- [ ] Task 3: Door and cues (AC: 7, 8, 13)
  - [ ] `env_door_key` and `env_prop_tidied` in `tools/audio/makePlaceholderAudio.ts`; run `npm run assets:audio`
  - [ ] `door` in the ring anchor enum, the door point given to the feedback director
  - [ ] `final_rush_started`, `prop_tidied` and the two `events` rows in `feedback.json`
  - [ ] `feedback.json › door` schema (`openMs`, `openAngleDeg`, `widthM`, `heightM`, `thicknessM`)
  - [ ] `render/views/doorView.ts`, pure helpers tested; wired in `levelScene.ts`
- [ ] Task 4: Input, marker, timer, mirrors (AC: 14, 15, 16, 17, 18)
  - [ ] Hit test and Space / A in `inputMapper.ts`; widen `pickObject` and `ContextObject`
  - [ ] `ui/world/tidyMarkers.ts`, styles in `ui.css`, `verb.tidy`
  - [ ] `timerHud.setRush`, reduced-motion rule (`designTokens.test.ts` enforces it)
  - [ ] Mirrors in `boot.ts`; replace the literal at L1346; `inspectDist.ts`
- [ ] Task 5: Bots and report (AC: 19, 20)
  - [ ] `planTidy` in `threatTiming.ts`, wired in `perfectBot.ts` and `humanBot.ts`
  - [ ] `simReport.ts`, `simArgs.ts`, and the whole-report pins in `simReport.test.ts`
- [ ] Task 6: Goldens, e2e and docs (AC: 24 and all)
  - [ ] New `tests/golden/finalRush.test.ts` with its scenario, on a fixture that opts in
  - [ ] `npm run golden:update`, deliberately; say so in the Completion Notes and read the diff
  - [ ] New `tests/e2e/finalRush.spec.ts`; update `timer.spec.ts:120`; Chromium only
  - [ ] Regenerate the macOS screenshot references (the closed door is new in the frame), look at them, say so
  - [ ] `project-context.md`, `EXPERIENCE.md`
  - [ ] `npm run ci:fast` after each task, plus the touched specs (`timer`, `result`, `mamaWoke`, `chambreNight`, `sequence`, `ui`, `feedback`, `testApi`, `autoplay`) on Chromium

## Dev Notes

### Decisions

- **D1. Opt-in, not automatic.** The project's pattern (`carry`, `cycle`, `gauges.noise`) keeps every fixture and its assertions stable. Both live levels opt in, and 3.10's Retour levels will too.
- **D2. `photo` is frozen and is entered with the score.** Story 3.6 says the sim takes its final snapshot and the client renders it without simulation, and that near misses frozen on the photo count in the Hurlement. So the world stops, `LevelEnded` and `LevelScored` fire in the step that enters `photo`, and nothing in the sim moves `photo` to `ended`. In this story the client goes straight to Result, as today; 3.6 inserts its presentation between `LevelScored` and Result. `ended` remains the end of a `mamaWoke`, of a `cycleDone` and of a level without `finalRush`. Whether those ends also get a photo is 3.6's call (the GDD wants one).
- **D3. The rush starts last in the step**, in `runFlow`, after the noise, cycle and timer tests. A sequence that ends in that step has already ended on its own terms.
- **D4. Noise can still wake Mama during the rush.** The GDD freezes only the catastrophe gauge in the rush, and that gauge does not exist yet. Story 3.2 wants noise to matter « jusqu'à la dernière seconde ». Open point 2.
- **D5. A tidied prop goes back to where it spawned**, on the furniture, rather than vanishing. It needs no new body state, the mess recount sees it at once, and a gag can knock it over again. The AC says « le ramasse et le range ». Tidying is instant on arrival, with no reach check and no new Papa state: 10 seconds leave no room for a busy pose. Papa may tidy with the baby in his arms.
- **D6. No new sigh tunable.** A tidied prop stops counting, so `feel.mama.sighPerPropOnFloorPoints` is the reduction, which meets « selon `feel.json` ». A second value would let tidying pay more than the mess cost. Broken props and mischiefs stay: the GDD lists « dégâts » apart from « objets au sol ».
- **D7. The door panel is built by the client, not in Blender.** Both `.glb` files hold a `door_frame` node and no door panel (checked in the binaries at this story's creation). A procedural hinged box at `ANCHOR_door` needs no re-export, stays one draw call, and E7 replaces it. It lies parallel to the nearest wall of the bounds: the anchors are `[3, 0, -2.9]` in the salon and `[2, 0, -2.3]` in the bedroom, both against the back wall. Check its fit in the frame with a screenshot.
- **D8. No banner.** The door, the key sound, the timer and the « RANGE ! » markers tell the player what is happening. Geo judges this by playing (open point 5).

### Every reader of `flow.state` (lines at `55c547a`)

| Where | Today | Do |
|---|---|---|
| `sim/step.ts:62`, `sim/commandQueue.ts:65`, `sim/flow/flowSystem.ts:44` | `=== 'ended'` | `!isFlowLive(world)` |
| `sim/sequences/sequenceStart.ts:33` | `=== 'ended'` | `!isFlowLive` → `ended`; `finalRush` → new reason |
| `sim/snapshot.ts:491` | `ended` before the duration needs noise or a cycle | also refuse `photo` before `durationMs` and `finalRush` / `photo` in a level with no rush |
| `debug/cheats.ts:54,227`, `debug/feelPatch.ts:110`, `debug/feelPanel.ts:214` | `=== 'ended'` | `!isFlowLive` (at L227 the old test would run past the end) |
| `client/boot.ts:1346` | writes `'ended'` | writes `world.flow.state` |
| `sim/gauges/fatigueSystem.ts:39`, `sim/baby/carry.ts:139`, `sim/disruptions/disruptionsSystem.ts:39`, `sim/sequences/bedtimeCycle.ts:218`, `bots/threatTiming.ts:296` | `=== 'playing'` | leave: suspended in the rush, on purpose |
| `sim/director/directorSystem.ts:49`, `sim/sequences/*`, `sim/papa/papaSystem.ts:252`, `client/input/inputMapper.ts:227` | `=== 'sequence'` | leave: the rush is neither |
| `isFlowLive` readers (`bots/playGame.ts`, `debug/autoplay.ts`, `client/boot.ts`, `inputMapper.ts`, `disruptionsSystem.ts`) | `isFlowLive` | leave: they stop at `photo` and run through the rush |

Also update the stale comment in `flowFsm.ts` and the doc of `FlowSlice` in `world.ts`.

### Current state of the files this story changes

- **`sim/flow/flowSystem.ts`.** `endLevel` closes the sequence, the phone, the silence and the instinct, then enters `ended`, then `MamaWoke`, `LevelEnded`, `scoreLevel`. Keep that order and only choose the state. `endSequenceForLevelEnd` does not call `advanceCycle`, so a rush that cuts an entry leaves the cycle where it was, which is correct.
- **`sim/papa/papaSystem.ts`.** `tapObject` (L138) looks only in `ctx.level.objects`; an unknown id does nothing. `arrive` (L104) reads `papa.objectId`, runs the object's action, and falls through to idle. Add the prop branch after the object loop. **Reuse `papa.objectId`, add no `PapaIntent`:** `startWalkTo` clears it, and a move, glide or new tap already cancels it.
- **`sim/physics/propsSystem.ts`.** Step 6 recounts the mess, and step 4 skips sleeping bodies. `runPapa` runs before `runPhysics`, so a pose written by the tidy becomes the previous pose in step 2 and the view does not slide across the room.
- **`sim/physics/rapierPhysics.ts`.** Bodies are created at `prop.centerM` with no rotation. `resetProp` is `setTranslation`, `setRotation` (identity), `setLinvel` and `setAngvel` to zero, **all with `wakeUp: true`**, so the colliders follow and the prop re-settles like at spawn. Write through scratch objects, as `applyImpulse` does.
- **`client/input/inputMapper.ts`.** Touch hit test at about L574 to L617; Space / A in `act` at L349 to L389. `isLive` and `isHeldInPlace` need no change, since the rush is live and not held.
- **`client/input/hitTest.ts` and `contextObject.ts`.** `pickObject` needs only id and position, so narrow its parameter type. `ContextObject.kind` becomes `ObjectKind | null` so props can go through `pickContextObject`.
- **`client/feedback/feedbackDirector.ts`.** `anchorOf` (L122) resolves rings; add `door`. `handle(name, world)` is the path for rows of `feedback.json › events`.
- **`client/render/levelScene.ts`.** Add the door view beside `papa` and `baby`, and update it in `update`. `geometry.anchors` holds `door` (`REQUIRED_ANCHOR_IDS`).

### What must keep working

- A level without `finalRush` emits the same events in the same order: fixtures must not change.
- `chambre_night` still ends in `cycleDone` for the bots. Measured at creation with `human`, 30 games capped at 229 990 ms: 29 had ended, all `cycleDone`, so 1 in 30 is now cut by the rush and ends `timer`. Say what you measure.
- `playtest:metrics` leaves out games cut by the level's end; a rush cut is `SequenceEnded{levelEnded}`, so it stays out.
- The Result screen's headers: `timer`, `mamaWoke` and `cycleDone` are unchanged.
- Perf: one more draw call, against a budget of 100. Hot paths allocate nothing: the marker and door updates run every frame.

### Traps

- **`sim/snapshot.ts:112` refuses a `papa.objectId` that is not a level object.** A snapshot taken during a rush walk would be refused: accept prop ids too (AC 23's round trip pins it).
- **The mess check at `snapshot.ts:1023` recomputes `propsOnFloor`.** Check `isMess` against the same formula, and that the count equals the props with `isMess`.
- **`flow.finalRushAt`:** null in `playing` and `sequence`, non-null in `finalRush` and `photo`, either in `ended` (`mamaWoke` in the rush). Don't check it against the current `finalRushMs`: `SetFeel` can move that.
- **Every `PhysicsPort` fake must gain `resetProp`.** Find them with `grep -rl "forEachImpact" src tests tools`.
- **Tests that use live content and assert `'ended'` now see `photo`:** start from `tests/bots/playGame.test.ts`, `tests/tools/sim/playGame.test.ts`, `tests/bots/bedtimeCycleFuzz.test.ts` and `tests/e2e/timer.spec.ts`. Tests on fixtures must not change: if one does, the opt-in leaks.
- **`content:check` refuses a `uiElement` twin on a sim event's cue**, and requires a visual and a haptic with any audio. That is why the door has a ring.
- **New event names and `LEVEL_END_REASONS`-style typed lists:** `events.test.ts` pins the event list, and whole-report tests need the new zeros (`simReport.test.ts` L81, L178).
- **The worktree guard** refuses compound shell commands naming `git`, and commands with a shell variable in an option position. Use plain commands and the edit tools.
- **`VITE_DEBUG_ALLOWED=false` may be exported:** it was not set at this story's creation, but run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` if it is.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`. A 30 s timeout failing after minutes means it slept.
- **Old journals:** `sim:replay` fails on a journal recorded before a new world slice (deferred at 4.10's review, pre-existing). Say so if Geo's old journals stop replaying.

### Architecture compliance

- `src/sim` stays pure: no `three`, no real time, no `Math.random`. Rapier only in `physics/rapierPhysics.ts`. The client reads `world` and writes only through `sim.enqueue`.
- The architecture names `sim/flow/levelFlow.ts`; the code is `flowFsm.ts` and `flowSystem.ts`. Keep the code's names. `client/endOfLevel/` does not exist yet and is not needed here: 3.6 creates it.
- `enterFlowState` stays the only writer of `flow.state`. `finalRushAt` is written beside it in `runFlow`.
- No new system: `SYSTEMS` keeps its order, so the pinned order test does not move.

### Library and framework notes

Stack pinned (`three@0.186.1`, `@dimforge/rapier3d-deterministic-compat@0.21.0`, `zod@4.6.7`); nothing to add or upgrade, so no version research was needed. Confirm the `RigidBody` setter signatures against the installed package's types before writing `resetProp`.

### File structure

- **New:** `src/sim/papa/tidyProp.ts`, `src/client/render/views/doorView.ts`, `src/client/ui/world/tidyMarkers.ts`, `tests/golden/finalRush.test.ts`, `tests/e2e/finalRush.spec.ts`, two clips under `public/assets/audio/`, each with colocated tests where the convention asks.
- **Updated:** see the tables above, plus `src/content/schemas/{feel,level,feedback}.ts`, `src/sim/{world,events,snapshot,createSim,context,index}.ts`, `tools/content/contentChecks.ts`, `tests/support/testContent.ts`, `content/{feel,feedback,strings.fr}.json`, `content/levels/{salon_crawler,chambre_night}.json`, `content/_schemas/`.

### Testing

- **Sim:** real `createSim` with typed commands, time in `STEP_MS`. To drop a prop use the journaled `PushProp` or the table gag. Pin tunables through the feel's values, never literals.
- **Determinism:** the new golden covers a rush with a tidy, replayed from its journal. Add a rush with a tidy to a fuzz or to `determinism.test.ts`.
- **Bots:** on a fixture with the prop on the floor before the rush, `perfect` and `human` tidy it; `idle` does not; every draw of a game with no rush is unchanged.
- **E2E (Chromium):** freeze, advance to the rush in the salon, drop the mug with `__PP__.send(PushProp)`, assert `data-pp-flow`, the marker, a real tap, `data-pp-props-tidied`, the marker gone, then `photo` and the Result screen. One keyboard path. One reduced-motion check on the door.
- **Checks:** `npm run ci:fast` per task. `ci:story` belongs to the review, not to dev-story. `npm run ci` runs only when a merge completes the epic's stories.

### Previous story intelligence

- **4.10:** its review fixed a test using `not.toThrow('…')` that passed on any other error (assert acceptance properly), step literals in tests (use `STEP_MS`), tests pinning live tuning (use frozen fixtures), and stale doc comments and snapshot numbers left in `project-context.md`. Update them as you go.
- **4.10 deferred finding:** an entry can start with no time left. The rush makes this slightly more visible, because an entry due just before the rush is cut. Leave it as is.
- **4.9 and 4.10:** a new feel key must reach `testFeel.json` and `feelSample.json`, and every report test needs the new zero.
- **3.4 and 3.3:** the journal and metrics need no change here, since no journal field moves. The mirrors must stay out of a prod build (`dist:check`).

### Git intelligence

The last five commits are the 4.10 merge and its review. This story's patterns come from its neighbours: `cycle` (opt-in, shared `…Problems`, typed end reason) and `4.3`'s toilet (an object action, a client marker with states, a keyboard rule).

### Project Structure Notes

Follows the layers and aliases; `tidyMarkers.ts` sits beside `objectMarkers.ts` and `doorView.ts` beside the other views. The one variance from the architecture tree is the file naming of the flow, above.

### Project Context Rules

- Anything Geo might tune is data: `finalRushMs` in `feel.json`, the door's numbers in `feedback.json`, strings in `strings.fr.json`, colours as tokens.
- Units are suffixes; `…At` is sim time; events are past tense; no `enum`; constants in `shared/constants.ts`.
- `World` stays serializable, and any world shape change bumps the snapshot version with checks.
- Every cue with audio has a visual and a haptic. Reduced motion is client-only and never in the sim.
- No `console.*`; the sim never logs. Input handlers do almost nothing; no allocation per frame.
- Regenerating goldens or screenshots is deliberate and is said in the story. Never weaken a guardrail.
- No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **Only one prop can be tidied in each level, at most 5 points.** The salon's vase spawns on the floor, so it never counts as mess, which leaves `mug_01` there, and the bedroom has only a mug. If no gag has dropped the mug, the rush has nothing to tidy. **The panic the story promises needs more props in the rooms.** Geo's decision is pending; this story as written does not add them.
2. Noise can wake Mama during the rush (D4).
3. A tidied prop returns to the furniture instead of disappearing (D5).
4. Broken props cannot be tidied (D6).
5. No « Vite, range tout ! » banner (D8), and the music does not change in the rush. Both can follow after playing.
6. In Sieste, Mama sleeps next door, yet the cue is a key in the door, as this story's AC asks. It fits Retour better; a level could name its own clip later.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5], and stories 3.6, 3.7, 3.10
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Macro-boucle : la fin de niveau], `#Conditions de victoire et d'échec`, `#Note de Maman`
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L496, L589, L959
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L64-65, L208, L579
- [Source: _bmad-output/project-context.md] « Three ways to end a level », « The bedtime cycle », « Special sequences », « The pressing need »
- [Source: _bmad-output/implementation-artifacts/4-10-niveau-chambre-de-nuit-et-playtest-du-deuxieme-prototype.md#Traps], `#Review Findings`

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
