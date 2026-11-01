---
baseline_commit: dbe4b3d85053b3c58839b6de7b9cba1a9f750777
---

# Story 3.5: Porte qui s'ouvre et rush final

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to hear the door open and have 10 seconds to hide everything,
so that every level ends in an apotheosis of panic.

Requirement: FR35 `[V1]`. First of the `[V1]` end-of-level stories: 3.6 (photo), 3.7 (reactions), 3.9 (replay) and 3.10 (Retour) build on the flow states added here.

## Acceptance Criteria

### The flow

1. **Opt-in.** `LevelSchema` gains an optional `finalRush: { spillAnchor }` (strict, no default, same pattern as `carry` and `cycle`). `salon_crawler` declares `coffee_table` and `chambre_night` declares `nightstand`. A level without it, every test fixture included, behaves exactly as today and ends in `ended`.
2. **The tunables.** `feel.endOfLevel.finalRushMs` (10 000, positive) and `feel.endOfLevel.doorSpillCount` (2, whole, 0 or more) in `FeelSchema`, `content/feel.json`, `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `content/_schemas` regenerated. `finalRushProblems` (pure, shared by `simLevelOf` and `content:check`, same words) refuses a `finalRush` level whose `durationMs` is not above `finalRushMs`, whose `spillAnchor` is not an anchor of the level, or with fewer than `doorSpillCount` props that can spill (AC 30).
3. **The start.** In a level with `finalRush`, at the first step where `world.time.sim >= durationMs - finalRushMs`, `runFlow` closes a running sequence first (`SequenceEnded{levelEnded}`), enters `finalRush`, writes `world.flow.finalRushAt`, emits `FinalRushStarted` and spills the props (AC 30), once.
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

### The rooms (Geo's call, 2026-11-01)

25. **New props.** `salon_crawler` gains `mug_02`, `book_01` and `toy_01` on the coffee table; `chambre_night` gains `book_01` and `toy_01` on the nightstand. So the salon has 4 props that can be tidied and the bedroom 3. The `.blend` files, `.glb` files and `*.geometry.json` are regenerated by the export pipeline, never edited by hand.
26. **New kinds.** `feel.physics.kinds` gains `book` and `toy`, both `box` and `breakable: false` (D9). A tidying player should not lose them to breakage.
27. **They all fall.** A test on the live geometry of each level, with the live feel: repeated `table_object_fall` gags drop every prop of that table, one gag per prop, and each ends with `isOnFloor` and `isMess` true, on neither the furniture nor the bed. Each prop can then be tidied and sits back on its table, not on the floor.
28. **The first fall does not change.** `mug_01` stays the nearest prop to each table's anchor, so the first gag still drops it and the live specs that follow it (`tests/e2e/props.spec.ts`, `threats.spec.ts`) keep their meaning.
29. **At rest.** With no command, until the rush starts, the new props stay on their furniture with no `PropImpact` and no noise.

### The door's spill (Geo's call, 2026-11-01)

30. **The spill.** When the rush starts, the door's opening knocks over up to `doorSpillCount` props: the unbroken, off-floor props with `breakable: false` nearest the level's `spillAnchor`, within `feel.gags.tableObjectFall.propReachDistM`, each pushed away from the anchor at `pushImpulseNs` (ties to the lower index, no `world.rng` draw). A breakable prop never spills. Fewer eligible props means fewer pushes; `doorSpillCount: 0` means no spill.
31. **It can always be answered.** On each live level, with no earlier gag, exactly 2 props fall (`toy_01` and `book_01`), none breaks, the salon's vase and the mugs do not move, and both end with `isMess` true. `perfect` and `human` then tidy both before `photo`, so their Soupir ends as if nothing had spilled. An `idle` game loses `2 × sighPerPropOnFloorPoints` against the same game with `doorSpillCount: 0` (pinned through the feel's values).
32. **Shared code.** The choice and the push move out of `tableObjectFall` into one helper (`sim/physics/dropProps.ts`), which both call. The table gag's behaviour does not change: its existing tests and goldens pass unedited.

### Bots, tools, docs

19. **Bots.** `perfect` and `human` tidy through a shared `planTidy` (`threatTiming.ts`): in the rush, Papa idle, nothing of the bot's to answer, one `TapObject` on the nearest `isMess` prop; `human` waits `reactionMs` after `finalRushAt`. No `world.rng` draw; `random` and `idle` do nothing new, and no existing draw moves.
20. **Report.** `simReport` gains `finalRushes` and `propsTidied`, per run and in the totals; `simArgs` help says so.
21. **The cycle.** `cycleProblems` is given the playable time (`durationMs - finalRushMs` in a `finalRush` level), in `createSim.ts` and in `contentChecks.ts`. `chambre_night` must still pass.
22. **Id clash.** `content:check` and `simLevelOf` refuse a level where an object id equals a prop id (same words).
23. **Snapshot.** Version 28: `PropSlice.isMess`, `score.propsTidied` and `flow.finalRushAt`, all checked (see Traps).
24. **Docs.** `project-context.md` gets a « final rush » paragraph, line 78's snapshot version, and the « Three ways to end a level » paragraph updated. `EXPERIENCE.md` gets the tidy marker and the rush timer. The GDD's end-of-level section and `decision-log.md` get the door's spill.

## Tasks / Subtasks

- [x] Task 1: Flow states, feel and level opt-in (AC: 1, 2, 3, 4, 5, 6, 21, 23)
  - [x] Add `finalRush` and `photo` to `FlowState` and `FLOW_STATES`; make `isFlowLive` false for `photo`
  - [x] Classify every reader of `flow.state` (table below)
  - [x] Add `feel.endOfLevel`, `LevelSchema.finalRush`, `SimLevel.hasFinalRush`, `finalRushProblems`; run `npm run content:schemas`
  - [x] `runFlow`: the order noise, cycle, timer, rush start; `endLevel` picks `photo` or `ended`
  - [x] `FinalRushStarted` in `events.ts` and its event list; `flow.finalRushAt` in `world.ts`
  - [x] Pass the playable time to `cycleProblems` in both callers
  - [x] Unit tests in `flowSystem.test.ts`, including a rush that cuts each sequence kind
- [x] Task 2: Tidying in the sim (AC: 9, 10, 11, 12, 22, 23)
  - [x] `PropSlice.isMess`, written in `runPhysics` step 6; `propsOnFloor` counts it
  - [x] `SimPropSpec.spawnM`; `PhysicsPort.resetProp` in `rapierPhysics.ts` and in every fake port in tests
  - [x] New `sim/papa/tidyProp.ts`; branch in `tapObject` and in `arrive`
  - [x] `PropTidied`, `score.propsTidied`
  - [x] Snapshot 28 and its checks; the object / prop id clash check
  - [x] Tests: AC 10 to 12, re-settling emits no `PropImpact` and no noise, a tidied prop can be knocked over and tidied again, snapshot round trip in the middle of a rush walk
- [x] Task 3: Door and cues (AC: 7, 8, 13)
  - [x] `env_door_key` and `env_prop_tidied` in `tools/audio/makePlaceholderAudio.ts`; run `npm run assets:audio`
  - [x] `door` in the ring anchor enum, the door point given to the feedback director
  - [x] `final_rush_started`, `prop_tidied` and the two `events` rows in `feedback.json`
  - [x] `feedback.json › door` schema (`openMs`, `openAngleDeg`, `widthM`, `heightM`, `thicknessM`)
  - [x] `render/views/doorView.ts`, pure helpers tested; wired in `levelScene.ts`
- [x] Task 4: Input, marker, timer, mirrors (AC: 14, 15, 16, 17, 18)
  - [x] Hit test and Space / A in `inputMapper.ts`; widen `pickObject` and `ContextObject`
  - [x] `ui/world/tidyMarkers.ts`, styles in `ui.css`, `verb.tidy`
  - [x] `timerHud.setRush`, reduced-motion rule (`designTokens.test.ts` enforces it)
  - [x] Mirrors in `boot.ts`; replace the literal at L1346; `inspectDist.ts`
- [ ] Task 5: Bots and report (AC: 19, 20)
  - [ ] `planTidy` in `threatTiming.ts`, wired in `perfectBot.ts` and `humanBot.ts`
  - [ ] `simReport.ts`, `simArgs.ts`, and the whole-report pins in `simReport.test.ts`
- [ ] Task 6: The new props (AC: 25, 26, 27, 28, 29)
  - [ ] Add `book` and `toy` to `FeelSchema`'s content (`content/feel.json`); the fixtures need them only if a fixture uses them
  - [ ] Add the nodes to both `.blend` files (Blender MCP if connected, else `/Applications/Blender.app -b -P` with a throwaway script), copying the existing `PROP_mug_01` collection and material
  - [ ] `npm run assets:export -- <id>`, `assets:extract -- <id>`, `assets:optimize -- <id>` for both levels
  - [ ] Live-geometry tests (AC 27, 28, 29), then adjust positions until they pass
  - [ ] Run `npm run sim` with `random` and `human` on both levels and write the before and after in the Completion Notes: `endsByReason`, `meanStars`, `noisePeakMeanPct`
- [ ] Task 7: The door's spill (AC: 30, 31, 32)
  - [ ] `sim/physics/dropProps.ts`, extracted from `tableObjectFall` with its gag tests still green and unedited
  - [ ] `doorSpillCount`, `finalRush.spillAnchor`, `SimLevel` holding the anchor's point, the new `finalRushProblems` cases
  - [ ] The spill in `runFlow`, after `FinalRushStarted`
  - [ ] Tests of AC 30 and 31 on both live levels, plus a rush after the gags have already dropped the table's props
  - [ ] Report `noisePeakMeanPct` and `endsByReason` with the spill in the Completion Notes (open point 1)
- [ ] Task 8: Goldens, e2e and docs (AC: 24 and all)
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
- **D9. More props, on the tables that already have a gag.** `table_object_fall` is the only gag that moves a prop: it pushes the unbroken off-floor prop nearest the threat's anchor, within `propReachDistM` (0.5 m), straight away from the anchor. Each failed table threat therefore drops one more prop, with no new sim code. Sigh is capped at 15 (3 props at 5), so 3 or 4 props can fill it. `book` and `toy` do not break, so what falls can always be tidied; the salon's vase stays where it is. Two kinds need a template node each, and `takePropNodes` shares the first node of a kind with its siblings (`mug_02` reuses `mug_01`'s).

- **D10. The door spills what cannot break.** Without a spill, a player who parries everything has nothing to tidy (measured before this story, 50 salon games: `human` 0 `table_object_fall` gags, `random` about 6.4 per game). Limiting it to `breakable: false` is what keeps it fair. In the salon the next prop by distance after the toy, `mug_02`, and the nearest, `mug_01`, are mugs; `mug_01` goes `+x` towards the vase, whose break threshold is 0.35 N·s, and a player must never lose 8 points to the door with no way to answer. The two kinds that spill go `+z` and `-x`, away from the vase and the bed. They cost 10 points only if left on the floor, and Papa walks at 3 m/s, about 3 s across the salon, so 10 s is enough for both. The level names its table, since nothing else says where the door's shock lands. The GDD has no such rule; this is Geo's decision of 2026-11-01, and the GDD gets a line (AC 24's docs).

### The new props: starting values

Game coordinates, in metres. These come from a hand calculation, not from a run: the tests of AC 27 to 29 are the proof, so move a prop if they fail. The exporter is Y-up, so a game `z` is Blender's `-y`; check the result in the generated `geometry.json`.

| Level | Prop | `centerM` | `halfExtentsM` | Falls towards |
|---|---|---|---|---|
| salon (anchor `0.5, -0.6`, top 0.45, `x` -0.1 to 1.1, `z` -0.9 to -0.3) | `mug_01` (today) | `0.7, 0.5, -0.6` | `0.05` | `+x`, 0.2 m from the anchor |
| | `toy_01` | `0.5, 0.5, -0.38` | `0.05` | `+z`, 0.22 m |
| | `mug_02` | `0.5, 0.5, -0.82` | `0.05` | `-z`, 0.22 m, into the gap before the sofa |
| | `book_01` | `0.25, 0.47, -0.6` | `0.07, 0.02, 0.1` | `-x`, 0.25 m |
| bedroom (anchor `-1.3, -2.15`, top 0.6, `x` -1.55 to -1.05, `z` -2.4 to -1.9) | `mug_01` (today) | `-1.3, 0.65, -2.15` | `0.05` | along the baby's gaze (it sits on the anchor) |
| | `toy_01` | `-1.3, 0.65, -2.0` | `0.05` | `+z`, 0.15 m |
| | `book_01` | `-1.45, 0.62, -2.15` | `0.07, 0.02, 0.1` | `-x`, 0.15 m |

| Kind | `shape` | `massKg` | `friction` | `restitution` | `breakable` | `breakImpulseNs` |
|---|---|---|---|---|---|---|
| `book` | `box` | 0.25 | 0.5 | 0.1 | false | 1 (required by the schema, unread) |
| `toy` | `box` | 0.3 | 0.6 | 0.3 | false | 1 (required by the schema, unread) |

- **Why the book is light:** `pushImpulseNs` is 0.72, and a 0.4 kg book with friction 0.6 would slide about 0.27 m and stay on the table. At 0.25 kg and friction 0.5 it slides about 0.85 m.
- **Don't send anything `+x` from the nightstand:** the bed starts at `x = -1`, 5 cm from the edge, and its top (0.5) is under the nightstand's. A prop would land on it and never count as being on the floor. The mug's push along the gaze can do this today: AC 27 covers it, and if it fails move the mug off the anchor while keeping it the nearest (AC 28).
- **The salon's mug can hit the vase** on its way down (`+x`, the vase at `x = 1.3`). That is today's behaviour; leave it.

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
- Perf: the door adds one draw call and the props up to 3 more (outlines may double those), against a budget of 100, checked by `perf.spec.ts` in `npm run ci`. Hot paths allocate nothing: the marker and door updates run every frame.
- `dist:check`: each level's `.glb` + audio stays ≤ 3 MiB.
- **More falls mean more noise and a bigger Soupir** for a player who misses table threats: each fall is a `PropImpact` (+5 to +15 %). This is intended, but a level that starts ending in `mamaWoke` for `random` is worth telling Geo. `human` should not move, since it never misses that threat.

### Traps

- **`sim/snapshot.ts:112` refuses a `papa.objectId` that is not a level object.** A snapshot taken during a rush walk would be refused: accept prop ids too (AC 23's round trip pins it).
- **The mess check at `snapshot.ts:1023` recomputes `propsOnFloor`.** Check `isMess` against the same formula, and that the count equals the props with `isMess`.
- **`flow.finalRushAt`:** null in `playing` and `sequence`, non-null in `finalRush` and `photo`, either in `ended` (`mamaWoke` in the rush). Don't check it against the current `finalRushMs`: `SetFeel` can move that.
- **`runFlow` runs after `runPhysics`,** so a spill's impulse moves the prop in the next step. The doc of `pushProp` asks for a call before `runPhysics` only « so that the push counts in this step », so a one-step delay is fine; adjust that comment.
- **Choosing two props in one step:** a pushed prop is still off the floor until it lands, so a plain « nearest » loop picks the same prop twice. The helper keeps a local list of what it pushed (one allocation per level, not a hot path).
- **The spill's `PropImpact`s feed the noise,** up to +15 % each, so a player near 100 % can be woken by the door (open point 1). Don't special-case it.
- **The Blender MCP runs AI Python unguarded:** use it only on these two project `.blend` files, committed first. Blender is not on the `PATH`; `assets:export` finds `/Applications/Blender.app`.
- **Tests on fixtures must not see the new props.** `tests/support/test*.geometry.json` are separate files: leave them alone. A test that uses live content and counts props will change: `grep -rln "mug_01\|vase_01" src tests`.
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
- **Regenerated:** `assets-src/blender/{salon_crawler,chambre_night}.blend`, `public/assets/levels/{salon_crawler,chambre_night}.glb`, `content/levels/{salon_crawler,chambre_night}.geometry.json`.
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

1. **The door's spill can itself wake Mama.** Two falls add up to +30 % noise, so a player at about 70 % or more when the door opens may get `mamaWoke` and lose a star from the spill alone. The story leaves that in, since it is the same rule as any fall. If it feels unfair in play, the fix is to exempt those two impacts.
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
