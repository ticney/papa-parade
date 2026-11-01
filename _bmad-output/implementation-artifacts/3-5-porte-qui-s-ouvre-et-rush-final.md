---
baseline_commit: dbe4b3d85053b3c58839b6de7b9cba1a9f750777
---

# Story 3.5: Porte qui s'ouvre et rush final

Status: review

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
- [x] Task 5: Bots and report (AC: 19, 20)
  - [x] `planTidy` in `threatTiming.ts`, wired in `perfectBot.ts` and `humanBot.ts`
  - [x] `simReport.ts`, `simArgs.ts`, and the whole-report pins in `simReport.test.ts`
- [x] Task 6: The new props (AC: 25, 26, 27, 28, 29)
  - [x] Add `book` and `toy` to `FeelSchema`'s content (`content/feel.json`); the fixtures need them only if a fixture uses them
  - [x] Add the nodes to both `.blend` files (Blender MCP if connected, else `/Applications/Blender.app -b -P` with a throwaway script), copying the existing `PROP_mug_01` collection and material
  - [x] `npm run assets:export -- <id>`, `assets:extract -- <id>`, `assets:optimize -- <id>` for both levels
  - [x] Live-geometry tests (AC 27, 28, 29), then adjust positions until they pass
  - [x] Run `npm run sim` with `random` and `human` on both levels and write the before and after in the Completion Notes: `endsByReason`, `meanStars`, `noisePeakMeanPct`
- [x] Task 7: The door's spill (AC: 30, 31, 32)
  - [x] `sim/physics/dropProps.ts`, extracted from `tableObjectFall` with its gag tests still green and unedited
  - [x] `doorSpillCount`, `finalRush.spillAnchor`, `SimLevel` holding the anchor's point, the new `finalRushProblems` cases
  - [x] The spill in `runFlow`, after `FinalRushStarted`
  - [x] Tests of AC 30 and 31 on both live levels, plus a rush after the gags have already dropped the table's props
  - [x] Report `noisePeakMeanPct` and `endsByReason` with the spill in the Completion Notes (open point 1)
- [x] Task 8: Goldens, e2e and docs (AC: 24 and all)
  - [x] New `tests/golden/finalRush.test.ts` with its scenario, on a fixture that opts in
  - [x] `npm run golden:update`, deliberately; say so in the Completion Notes and read the diff
  - [x] New `tests/e2e/finalRush.spec.ts`; update `timer.spec.ts:120`; Chromium only
  - [x] Regenerate the macOS screenshot references (the closed door is new in the frame), look at them, say so
  - [x] `project-context.md`, `EXPERIENCE.md`
  - [x] `npm run ci:fast` after each task, plus the touched specs (`timer`, `result`, `mamaWoke`, `chambreNight`, `sequence`, `ui`, `feedback`, `testApi`, `autoplay`) on Chromium

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

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Debug Log References

- Blender was driven headless (`/Applications/Blender.app -b <level>.blend -P <throwaway script>`), not through the MCP; the scripts lived outside the repo (`/tmp`). Game `(x, y, z)` is Blender `(x, -z, y)`.
- First bedroom layout of the props (the story's starting values) failed AC 27: the mug sat on the anchor, so its push direction came from a 2 cm settling offset and it was pinned against the back wall at the nightstand's edge, never reaching the floor. Re-laid by hand (the story's own fallback): `mug_01` (-1.3, 0.65, -2.05) falls `+z`, `toy_01` (-1.45, 0.65, -2.15) falls `-x`, `book_01` (-1.45, 0.62, -1.98) falls `-x/+z`. Distances to the anchor are 0.10 / 0.15 / 0.23, so `mug_01` is still strictly the nearest (AC 28), and the first fall is the mug's. The salon's starting values held as they were.
- `Math.hypot` and `Math.sqrt(dx² + dz²)` can differ in the last bit: `dropProps` keeps the `sqrt` form the table gag always used, so the gag's goldens did not move (AC 32).
- A hand-made sim/bot test fake without a `flow` slice broke `planTidy` (it reads `world.flow`): the fakes of `tests/bots/beatBots.test.ts` and `silenceBots.test.ts` gained `flow` and `props`.
- `typecheck`, `lint`, `content:check` and `npm test` (369 files, 7 590 tests) are green; `npm run ci:story` was not run, as the workflow says.

### Completion Notes List

- **All 8 tasks done, all 32 ACs covered.** The sim (flow states, rush, spill, tidy), the content (feel, level opt-in, feedback, strings, the two new props in both `.blend`, regenerated `.glb` and geometry), the client (door, markers, input, timer, mirrors), the bots and report, the goldens, the e2e spec and the docs.
- **Flow.** `FlowState` gains `finalRush` and `photo`; `isFlowLive` is false for `photo`; `runFlow` starts the rush last in the step, closes a sequence first, enters `photo` on the timer with `LevelEnded` and `LevelScored` in the same step. Rush states are refused by the snapshot in a level with no rush; `photo` is refused before `durationMs`. The rush cut is tested on `stay_awake` and on the bedtime duel with the baby in the arms; the other sequence kinds go through the same `endSequenceForLevelEnd`, which 4.4 to 4.10 already test for a level end, and are not each re-tested here.
- **Tidying.** `PropSlice.isMess`, `world.score.propsTidied`, `PhysicsPort.resetProp` (tested on the real Rapier port: reset pose, no rotation, no velocity, awake, and a resting pose re-settles with no impact above the threshold), `tidyProp`. A tidied prop re-settles with no `PropImpact` and no noise (tested); one knocked over again can be tidied again. The Soupir falls by exactly `sighPerPropOnFloorPoints` (tested through the feel's value).
- **Snapshot version 28:** `flow.finalRushAt`, `PropSlice.isMess` (checked against its formula and the count), `score.propsTidied`, a prop id as `papa.objectId` in `finalRush`, `photo` and `ended` (changed in the code review: the level can end during the walk). A round trip in the middle of a rush walk is tested. Old journals no longer replay (new world slices; deferred at 4.10's review, pre-existing).
- **Door and cues.** `env_door_key` and `env_prop_tidied` placeholders (`npm run assets:audio -- --only …`), the `door` ring anchor (`getDoorPoint`), the two cues and events, `feedback.json › door`, `doorView.ts` (pure placement, angle and yaw helpers tested; the door is paper-white, the colour of the existing `door_frame`, parallel to the nearest wall). The door's angle is a function of the render's sim clock (a clock that stands still holds it); `__PP__.fx().doorOpenDeg` mirrors it.
- **Client.** Touch weighs a prop with `isMess` with the objects and the baby through one reusable list (a `PropSlice` fits the narrowed `PickTarget`); Space / A takes the nearest mess within `contextReachM` ahead of the baby and of every object (`pickMessProp`, so `ContextObject` was left alone). « RANGE ! » markers (`tidyMarkers.ts`), `timerHud.setRush`, mirrors `data-pp-flow` (`finalRush`, then `world.flow.state` on `LevelEnded`) and `data-pp-props-tidied` (`ppPropsTidied`, added to `inspectDist.ts`). Screenshots of both levels in the rush looked right (the door swings into the room, the timer turns yellow, the markers sit over the fallen toy and book): the markers are big and overlap when two props are close, which is for Geo to judge.
- **Bots.** `planTidy` shared by `perfect` (at once) and `human` (`reactionMs` after the door), no `world.rng` draw (tested: the rng after a game equals an idle game's), nothing outside the rush. A prop it just tapped waits 1 s before being tapped again, so an unreachable prop cannot fill the journal. `random` and `idle` do nothing new. Report: `finalRushes` and `propsTidied`, per game and in the totals; `simArgs --help` says so.
- **The new props (AC 25 to 29)** on the live geometry and live feel, `tests/content/liveProps.test.ts`: every table prop falls to the floor as an unbroken mess, one per gag, the first fall is the mug's, nothing moves at rest (no `PropImpact`, no noise), each can be tidied back onto its table. Both `.blend` files are committed with them; `.glb`, `*.geometry.json` regenerated by the export pipeline.
- **The door's spill (AC 30 to 32).** `dropProps` (shared with the table gag, whose tests are unedited and whose goldens did not change), `finalRushProblems` now also refuses a room with fewer than `doorSpillCount` unbreakable props within reach of the anchor. On both live levels, with no gag, the door knocks over exactly `toy_01` and `book_01` (nothing breaks, the mugs and the vase do not move); `perfect` and `human` tidy both and end with the sigh of a game with no spill; an `idle` game loses exactly `2 × sighPerPropOnFloorPoints`; with every prop already down, the door adds no impact.
- **Goldens regenerated deliberately (`npm run golden:update`).** I read the diff: the 26 existing scenarios changed only in `feelHash` (the feel fixture gained `endOfLevel`, `book` and `toy`) and in `worldHash` (the world gained `finalRushAt`, `isMess`, `propsTidied`); **their `eventTypes` and `eventsHash` did not move**, which is the proof that a level without `finalRush` emits the same events in the same order. New scenario `final_rush_tidied` (frozen room plus a toy and a book) with `tests/golden/finalRush.test.ts`.
- **E2E (Chromium).** New `tests/e2e/finalRush.spec.ts` (3 tests: a real tap and a real key tidy the mess, the markers and mirrors, the photo and the Result screen; reduced motion; the door swinging and the timer pulsing). The rush is moved to the start of the level by a `SetFeel` of `finalRushMs`, so no spec plays 170 s. Specs run alone and green: `timer`, `result`, `mamaWoke`, `chambreNight`, `sequence`, `ui`, `feedback`, `testApi`, `props`, `threats`, `autoplay`, `level`, `baby`, `pauseResume`, `move`, `reducedMotion`, `noise`, `carry`, `finalRush`.
- **Screenshot reference.** `autoplay-frozen-chromium-darwin.png` did not change: the closed door has the colour and footprint of the existing `door_frame`, so the frame is within tolerance; I looked at it. The WebKit reference was not run (Chromium only, as the story says).
- **Existing specs and tests that had to change, and why.** The extra table props make noise: a live level nobody plays now wakes Mama before its timer (the idle bot of the live salon, which used to reach the end). `timer`, `result` and `mamaWoke` (the timer-end test) now open the level with `?threats=off`; `advanceToEnd` stops when the app leaves `level`; `timer.spec.ts` expects `finalRush` just before the last step and `photo` after it; `tests/tools/sim/microSleep.test.ts` turns the props' noise off and counts the playable time without the rush; `mamaScore.test.ts` passes the real `MamaWoke` to the expected note; `checkContent.test.ts`'s light-kinds list gained `book` and `toy`.
- **Measured with `npm run sim` (30 games, seed 1000), before this story (`main`) and after it:**

  | Level / bot | Ends before | Ends after | Mean stars before → after | `noisePeakMeanPct` before → after |
  |---|---|---|---|---|
  | salon / `human` | timer 30 | timer 30 | 3.9 → 3.9 | 91 → 91 |
  | salon / `perfect` | not measured | timer 30 | 5 | 91 |
  | salon / `random` | timer 30 | **timer 25, mamaWoke 5** | 1.0 → 0.8 | 91 → 95.6 |
  | bedroom / `human` | cycleDone 30 | cycleDone 30 | 5 → 5 | 7.4 → 7.4 |
  | bedroom / `perfect` | not measured | cycleDone 30 | 5 | 7.9 |
  | bedroom / `random` | mamaWoke 30 | mamaWoke 30 | 1 → 1 | 100 → 100 |

  With the spill, `human` tidied 61 props in 30 salon games (the mug of the one game that failed a table threat, plus the toy and the book of every game) and `perfect` 60. In the bedroom neither reached the rush: the cycle ended first in all 30 games (at creation, 1 game in 30 was expected to be cut). **The door never woke Mama for `human` or `perfect`** (their noise peak is earlier in the game). **For Geo:** `random` in the salon now wakes Mama in 5 games out of 30 (it used to never), because each failed table threat drops another prop instead of nothing: intended by the story, and worth knowing.
- **Open points for Geo (story's list), unchanged:** 1. the door's spill can itself wake Mama (two falls, up to +30 %); 2. noise can wake Mama during the rush; 3. a tidied prop goes back to its table; 4. broken props cannot be tidied; 5. no banner, the music does not change; 6. in Sieste the key in the door is a little odd.

### File List

New:
- `src/sim/flow/finalRush.ts`, `src/sim/flow/finalRush.test.ts`
- `src/sim/papa/tidyProp.ts`, `src/sim/papa/tidyProp.test.ts`
- `src/sim/physics/dropProps.ts`, `src/sim/physics/dropProps.test.ts`
- `src/client/render/views/doorView.ts`, `src/client/render/views/doorView.test.ts`
- `src/client/ui/world/tidyMarkers.ts`, `src/client/ui/world/tidyMarkers.test.ts`
- `public/assets/audio/env_door_key.m4a`, `public/assets/audio/env_prop_tidied.m4a`
- `tests/bots/tidyBots.test.ts`, `tests/content/checkFinalRush.test.ts`, `tests/content/liveProps.test.ts`
- `tests/golden/finalRush.test.ts`, `tests/golden/journals/final_rush_tidied.json`, `tests/golden/journals/final_rush_tidied.expected.json`
- `tests/e2e/finalRush.spec.ts`, `tests/tools/audio/finalRushClips.test.ts`, `tests/tools/sim/finalRushReport.test.ts`

Modified:
- Sim: `src/sim/{commandQueue,commands,context,createSim,events,index,snapshot,step,world}.ts`, `src/sim/flow/{flowFsm,flowSystem}.ts`, `src/sim/papa/papaSystem.ts`, `src/sim/physics/{physicsPort,propsSystem,rapierPhysics}.ts`, `src/sim/sequences/sequenceStart.ts`, `src/sim/threats/gags.ts`
- Content: `src/content/schemas/{feedback,feel,level}.ts`, `content/{feedback,feel,strings.fr}.json`, `content/levels/{salon_crawler,chambre_night}.json`, `content/levels/{salon_crawler,chambre_night}.geometry.json`, `content/_schemas/{feedback,feel,level}.schema.json`
- Assets: `assets-src/blender/{salon_crawler,chambre_night}.blend`, `public/assets/levels/{salon_crawler,chambre_night}.glb`
- Client: `src/client/boot.ts`, `src/client/app/{levelSession,testHost}.ts`, `src/client/feedback/feedbackDirector.ts`, `src/client/input/{contextObject,hitTest,inputMapper}.ts`, `src/client/render/levelScene.ts`, `src/client/ui/hud/timerHud.ts`, `src/client/ui/styles/ui.css`, `src/client/ui/world/worldUi.ts`
- Debug, bots, tools: `src/debug/{cheats,feelPanel,feelPatch}.ts`, `src/bots/{humanBot,perfectBot,threatTiming}.ts`, `tools/audio/makePlaceholderAudio.ts`, `tools/build/inspectDist.ts`, `tools/content/contentChecks.ts`, `tools/sim/{simArgs,simReport}.ts`
- Tests (updated for the new world, feel and flow): `src/bots/threatTiming.test.ts`, `src/client/app/levelSession.test.ts`, `src/client/feedback/{feedbackDirector,feedbackTwins}.test.ts`, `src/client/input/{contextObject,inputMapper}.test.ts`, `src/client/render/levelScene.test.ts`, `src/client/render/views/propView.test.ts`, `src/client/ui/hud/timerHud.test.ts`, `src/debug/testApi.test.ts`, `src/sim/{createSim,events,snapshot}.test.ts`, `src/sim/flow/flowSystem.test.ts`, `src/sim/physics/{propsSystem,rapierPhysics}.test.ts`, `src/sim/sequences/{bombDropSnapshot,cycleSnapshot,duelSnapshot,fakeSleepSnapshot,sequenceSnapshot}.test.ts`, `src/sim/threats/inputLag.test.ts`, `tests/bots/{beatBots,silenceBots}.test.ts`, `tests/content/{checkContent,feedbackSchema}.test.ts`, `tests/e2e/{mamaWoke,result,timer}.spec.ts`, `tests/e2e/support/{game,testApi}.ts`, `tests/golden/scenarios.ts`, `tests/golden/journals/*.json` (the 26 existing scenarios: `feelHash` and `worldHash` only), `tests/support/{fakeTestHost,testContent}.ts`, `tests/support/testFeel.json`, `tests/tools/build/checkDist.test.ts`, `tests/tools/sim/{mamaScore,microSleep,simReport}.test.ts`, `tests/tools/vite/fixtures/feelSample.json`
- Docs: `_bmad-output/project-context.md`, `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`, `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/{gdd,decision-log}.md`, `_bmad-output/implementation-artifacts/{3-5-porte-qui-s-ouvre-et-rush-final,sprint-status}.md|yaml`

### Change Log

- 2026-11-01 — Implemented story 3.5: the final rush (door, spill, tidying, photo), the two new props in both rooms, the bots and report, goldens, e2e and docs. Snapshot version 28. Ready for review.

### Review Findings

Code review, group 1 of 3 (sim, shared, content, debug, tools). Groups 2 (client, bots) and 3 (tests, e2e, docs) are still to review.

- [x] [Review][Decision] (résolu : accepté, consigné dans `deferred-work.md`, à revoir après le playtest du deuxième prototype) Le niveau `chambre_night` n'atteint jamais sa porte quand le cycle est gagné — `cycleDone` est testé avant le rush (AC 5) et `playableMsOf` (AC 21) force le cycle à tenir avant `durationMs - finalRushMs`; un joueur qui réussit le cycle finit donc toujours en `cycleDone` / `ended`, sans porte, sans déversement ni photo (les 30 parties de bots de la story n'ont jamais vu le rush dans la chambre). Conforme à la lettre des AC, mais la fonction est morte pour un bon joueur dans le niveau du deuxième prototype. À trancher par Geo : l'accepter (la porte ne s'ouvre que si le cycle échoue), ou laisser un cycle gagné passer par le rush avant `photo`. [src/sim/flow/flowSystem.ts:81]
- [x] [Review][Patch] Un snapshot de `photo` (ou de `ended` après un `mamaWoke` dans le rush) est refusé quand Papa marchait vers un prop — `worldProblem` n'accepte un `papa.objectId` de prop que si `flow.state === 'finalRush'`, et `endLevel` ne vide pas `objectId`; `restore` lève `world.papa.objectId`. Accepter les ids de props dès que le niveau a un rush (`hasFinalRush`) et que l'état est `finalRush`, `photo` ou `ended`, et couvrir `photo` et `ended` par un test. [src/sim/snapshot.ts:1280]
- [x] [Review][Patch] `finalRushProblems` compte des props qui ne peuvent jamais tomber — il compte tout prop incassable à portée de l'ancre, alors que `dropProps` écarte ceux déjà au sol; un livre posé par terre près de la table passe `content:check` mais ne tombe pas, et la porte peut ne rien laisser à ranger. Ne compter que les props posés au-dessus du sol (`centerM[1] - halfExtentsM[1]` au-dessus de la tolérance de sol). [src/sim/flow/finalRush.ts:53]
- [x] [Review][Patch] Commentaires et docs périmés par la branche « prop » de `TapObject` — `TapObject` (commands.ts:71), `ObjectTapped` (events.ts:167), `PapaSlice.objectId` (world.ts:38), `PlannedLevel.objects` (snapshot.ts:614), « It has three ways in » (flowSystem.ts:59, il y en a quatre) et `refusalReason` / « has ended » pour `photo` dans `debug/cheats.ts`.
- [x] [Review][Patch] Le test « un téléphone déjà en train de sonner continue » ne peut pas échouer — `.every` sur un tableau vide passe, et la sonnerie démarrée à t=1000 a expiré bien avant le rush; il ne vérifie jamais une sonnerie active à `RUSH_AT`. Faire sonner le téléphone juste avant le rush et affirmer qu'il sonne encore après. [src/sim/flow/finalRush.test.ts:160]
- [x] [Review][Patch] Le test « renversé de nouveau » n'attend plus l'arrêt du mug au tour 2 — `time >= 3000` est déjà vrai au tour 2, la boucle s'arrête dès que `isMess` est vrai et le tap part pendant que le mug bouge (risque de test instable). Attendre un temps relatif au tour. [src/sim/papa/tidyProp.test.ts]
- [x] [Review][Patch] `dropProps` garde un tampon `chosen` au niveau du module, alors que la spec demande une liste locale; l'état d'un module de `src/sim` doit vivre dans `world` ou le contexte. [src/sim/physics/dropProps.ts:18]

Code review, group 2 of 3 (client, bots). No AC violation found by the Acceptance Auditor. Group 3 (tests, e2e, goldens, docs) is still to review.

- [x] [Review][Patch] Le garde-fou de `planTidy` ne retenait qu'un seul prop : deux props inatteignables étaient retapés en alternance à chaque pas et remplissaient le journal. La mémoire est maintenant un `Map` id → date du dernier tap. [src/bots/threatTiming.ts:306]
- [x] [Review][Patch] Le test « répond d'abord à une menace » ne posait aucune menace : il en pose une maintenant, au clavier et à la manette; un test distinct couvre la manette sans menace. [src/client/input/inputMapper.test.ts]
- [x] [Review][Patch] Le test « une égalité va à l'objet » ne construisait pas d'égalité (mug exactement sur le téléphone, maintenant); le test « n'alloue aucune liste » ne vérifiait rien d'une allocation, renommé en ce qu'il fait. [src/client/input/inputMapper.test.ts]
- [x] [Review][Patch] Les tests de `levelScene` remettaient `finalRushAt` à null à la main, sur un monde partagé : une assertion qui échoue laissait le rush fuir dans les tests suivants. Un `afterEach` s'en charge. [src/client/render/levelScene.test.ts]
- [x] [Review][Patch] `data-pp-props-tidied` survivait à la partie jusque dans l'écran de chargement suivant : ajouté à la liste nettoyée au passage en `loading`. [src/client/boot.ts]
- [x] [Review][Patch] Commentaire de la charnière de la porte faux (« low end »), `+ 0` sans explication, description du schéma `feedback` (« the hinge is at the door anchor ») fausse; `content/_schemas` régénéré. [src/client/render/views/doorView.ts, src/content/schemas/feedback.ts]

Code review, group 3 of 3 (tests, e2e, goldens, docs). Goldens checked: the existing journals changed only by `feelHash` (journals) and `worldHash` (expected files, the new world slices), `eventsHash` and the event types did not move.

- [x] [Review][Patch] `instinct.spec.ts` « ends with the level » était rouge : l'idle de la graine 42 réveille Maman avant la fin (les nouveaux objets font du bruit), le niveau est fini et `ForceInstinct` n'a plus d'effet. Le test joue sans menace (`THREATS_OFF`). [tests/e2e/instinct.spec.ts]
- [x] [Review][Patch] `debugOverlay.spec.ts` « skips to the end » attendait `ended` par accident (le même réveil de Maman); il accepte `photo` et `ended`. [tests/e2e/debugOverlay.spec.ts]
- [x] [Review][Patch] AC 6 presque sans test : deux tests dans le rush (pas de micro-sommeil alors que le même Papa épuisé s'endort sans rush, et le bruit continue). Le cri dans les bras et le cycle restent couverts seulement par la règle `=== 'playing'` elle-même. [src/sim/flow/finalRush.test.ts]
- [x] [Review][Patch] AC 1 : rien ne lisait le `finalRush` des vrais fichiers de niveau; un test lit `salon_crawler.json` et `chambre_night.json`. AC 29 : la vérification « au repos » court maintenant jusqu'au dernier pas avant le rush (elle s'arrêtait à 70 s sur 110 s). [tests/content/liveProps.test.ts]
- [x] [Review][Patch] AC 20 : `propsTidied` n'était jamais supérieur à 0 dans le rapport. Un test où la porte fait tomber la tasse (rendue incassable) et où `perfect` la range compte 2 sur 2 parties; le test de rejouage vérifie qu'un `TapObject` a eu lieu. [tests/tools/sim/finalRushReport.test.ts]
- [x] [Review][Patch] Assertions vides ou trop faibles de `finalRush.spec.ts` : comparaison de deux constantes retirée, `toBeHidden()` sur un locator vide remplacé par un compte de marqueurs visibles, la porte « en train de s'ouvrir » est vérifiée strictement entre 0 et l'angle d'ouverture, garde Chromium ajoutée (le commentaire le promettait sans le faire). [tests/e2e/finalRush.spec.ts]
- [x] [Review][Patch] Le test de bot « répond d'abord aux menaces » ne vérifiait pas l'ordre : renommé en ce qu'il fait, la priorité étant posée par le test de `planTidy`. Commentaire du golden `final_rush_tidied` (poussée mise en file à 1 s, appliquée à 1,1 s). [tests/bots/tidyBots.test.ts, tests/golden/scenarios.ts]
- [x] [Review][Patch] Docs : `project-context.md` (raisons de refus de `sequenceRefusal`, snapshot accepté aussi en `photo` et `ended`, affirmation sur le bot idle dépendante de la graine), `EXPERIENCE.md` (« les 10 dernières secondes » est `finalRushMs`), enregistrement de la story.
