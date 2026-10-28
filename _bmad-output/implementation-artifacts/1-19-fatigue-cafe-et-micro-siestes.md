---
baseline_commit: 4edc4304bead2ee48984f1aca7f4b647784258ee
---

# Story 1.19: Fatigue, Coffee and Micro-Sleeps

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.19 « Fatigue, café et micro-siestes » (L1033-1064). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see Papa wear himself out until he nods off, and to perk him up with a coffee,
so that I manage my own pace in the middle of the chaos.

**Requirements covered:**
- FR16: fatigue from 0 to 100, +0.5/s (×2 when carrying the baby, from E4). Above 70, windows shrink by 20 % and telegraphed micro-sleeps come every 8 to 12 s (drooping eyelids, a muffled sound). The player parries them to wake up. Coffee: −40, at the cost of 3 s of action.
- FR12, the coffee part: a contextual interaction, by a tap on the object or by Space / A. The phone is story 1.20, and the baby tap is story 1.21.
- UX-DR4: the gauge pill in the top-left HUD zone, with the order Bruit · Fatigue · Envie, 10 segments, 70 % opacity when idle, and `gauge-warn` plus a pulsing icon from 70 %.

**Sources:**
- GDD (`gdds/gdd-papa-parade-2026-10-26/gdd.md`):
  - L92, the needs « dérèglent ses réponses s'il les ignore ».
  - L171, the Fatigue row: « +0,5/s (×2 en portant le bébé) | Au-dessus de 70 : fenêtres réduites de 20 %, micro-siestes télégraphiées toutes les 8 à 12 s (paupières qui tombent, son cotonneux), à parer pour se réveiller | Café : −40, 3 s d'action ».
  - L196 (« micro-siestes en gag »), L213 (tap on the object, Space, contextual A), L381 and L496 (the prototype includes the fatigue gauge).
  - L258: the snore, the woken baby and +15 % noise belong to the `stay_awake` sequence only (E4). They are **not** in this story.
- Architecture (`game-architecture.md`):
  - L223: the window is `base × tier × fatigue × instinct`.
  - L229-230: `World` has `gauges`. The order is `… physique → jauges → instinct → score → flux`.
  - L489 and L492: `papa/coffee.ts` and `gauges/fatigue.ts`.
  - L520: `hud/gaugesHud.ts`.
  - L736: a system-spawned threat, `papa_microsleep.json` (`target: "papa"`, `response: "parry"`), « suit la même FSM et le même jugement ».
  - L906-911: `runFatigue`, the rate times `carriedMultiplier` when carrying.
  - L944: the E1 row.
- UX:
  - `DESIGN.md` L157-171 (the `hud-gauge` frontmatter), L395-397, L408, L462 and L521-525.
  - `EXPERIENCE.md` L124, L164 (« Fatigue »), L207 (the full gauge rule), L377 (the drooping eyelids are **diegetic**: 3D, no DOM), L379, L393 (use an object), L420 and L480-484 (budgets).
  - Mockup `mockups/key-hud-level.html`: L54-62 (`.gauges`, `.gauge`, `.bar`, `.fill`, the mask), L157 (`#i-fatigue`), L178-181 (the markup and the aria labels) and L206.
- `deferred-work.md`:
  - L67, the gauge pill and its e2e;
  - L303, the touch tap on an object;
  - L304, no consumer yet for `ObjectTapped`;
  - L319, two derivations of the object positions;
  - L326, `maxSimultaneous` must not count the micro-sleep.

**Downstream consumers. Design for them; none of them may need to change this story's code beyond adding their own case:**
- **1.20 (phone):**
  - A second object kind (`phone`) with its own arrival action: Papa is busy 5000 ms and fatigue goes up by 10.
  - It reuses the object hit test, the `OBJECT_KINDS` switch, the busy state (D6) and `addFatigue` (D5).
  - It adds `disruptions` to the wave schema (1.18 D10).
- **1.21 (silence):** the baby tap joins the hit-test chain (threat > baby > object > floor). Leave a slot for it in `handlePointerDown`.
- **1.22 (Mama's score):** may read `world.gauges`. A micro-sleep gag is not a `NearMiss`.
- **2.x (sound, legibility):** a distinct `tel_*` and `gag_*` for the micro-sleep (epics L1281-1292). This story ships placeholders.
- **3.1 (noise):** the Bruit gauge goes **first** in the pill, Sieste only. `GAUGE_IDS` and `gaugesHud` take a new id with no change to the pill.
- **E4 (baby in arms):**
  - `carriedMultiplier` applies once `isBabyCarried` (D5) reads a real state.
  - Envie goes **last** in the pill.
  - The `stay_awake` sequence has its own micro-sleep cadence and failure (snore, +15 % noise), and reuses the papa-target threat machinery.

## Precondition (check first, stop if it fails)

1. Story 1.18 is `done`, with its review fixes committed.
   - When this story was written, 1.18 was `review` (implementation commit `6ff5ffb`) and the tree was clean.
   - If `sprint-status.yaml` says anything but `done` for 1.18, or `git status` shows anything outside `_bmad-output/`, stop and tell Geo. The review may have moved files this story edits.
2. Re-read the files that 1.18 and its review changed before you edit them: `world.ts`, `context.ts`, `createSim.ts`, `directorSystem.ts`, `waveState.ts`, `threatFsm.ts`, `snapshot.ts`, `step.ts`, `boot.ts`, `inputMapper.ts`, `hudLayer.ts`, `simReport.ts` and `testContent.ts`. The excerpts in the Dev Notes are from commit `6ff5ffb`.
3. Run `env | grep VITE_`. The agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap).
4. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note the unit and e2e counts in the Debug Log. If the baseline is red, stop and say so. 1.18 saw 5 s vitest timeouts under heavy load; if that happens, use `--maxWorkers=5` as 1.18 did and say so.

## Acceptance Criteria

1. **The fatigue gauge in the sim.**
   - `world.gauges.fatigue` starts at `feel.fatigue.startPoints` (new key, 0).
   - In a level whose `gauges.fatigue` is set (D1), it rises by `perSec × STEP_MS / 1000` each step (×`carriedMultiplier` only when `isBabyCarried(world)`, which is `false` until E4).
   - It is held in `[0, 100]`. It rises in every Papa state and stops once the level has `ended` (1.18 `ENDED_SYSTEMS`).
   - In a level without `gauges.fatigue`, the fatigue system does nothing: it draws nothing, emits nothing and the value stays at its start.
   - `runGauges` sits between `runPhysics` and `runFlow` in `SYSTEMS`.
2. **The threshold.**
   - The sim's rules apply strictly **above** `thresholdPoints` (GDD « au-dessus de 70 »).
   - `FatigueThresholdCrossed{t, isAbove}` is emitted once per crossing, in each direction.
   - At exactly 70 the HUD is already orange (AC 9: « dès 70 ») but the sim has not changed. Say so in a code comment.
3. **Shrunk windows.** A threat telegraphed while fatigue > threshold freezes a window of `base × tier × (1 − windowPenaltyPct / 100) × instinct`. The modifier comes from `fatigueWindowModifier(world, ctx)` in `gauges/fatigue.ts`, passed to `effectiveWindow` (whose order is unchanged). Otherwise the modifier is 1. A window already frozen does not move when fatigue crosses (1.10 D8).
4. **Micro-sleeps.**
   - While fatigue > threshold, the fatigue system telegraphs the level's micro-sleep instance (`papa_microsleep`, `target: "papa"`, D2-D4).
   - The first is due `microSleepMinMs + nextFloat · (max − min)` after the upward crossing. Each next one is due the same draw after the previous **telegraph**. One `nextFloat` per draw.
   - It is telegraphed at the first step at or after it is due where all of these hold:
     - the instance is `idle`;
     - Papa is not busy (`drink` or `asleep`);
     - the flow is `playing`.
   - A downward crossing (coffee) cancels the pending one (`microSleepAt = null`).
   - `ThreatTelegraphed` has `waveIndex: -1` and `anchorId: "papa"`. The instance stands on Papa: its `xM` / `zM` follow Papa at every step.
   - It is judged like any threat (same FSM, same `judgePress`). It never counts against a wave's `maxSimultaneous`, the director never draws it, the baby never locks on it, and it is never a wave's last threat.
5. **Parry, or fall asleep.**
   - Parrying the micro-sleep (`perfect` / `success`) resolves it like any threat: hitstop, and the perfect slow-mo.
   - **A press on it does not glide Papa:** he stays where he is and keeps walking if he was.
   - A fail triggers `GagTriggered{gag: 'papa_asleep'}`. Papa enters `asleep` for `feel.fatigue.asleepMs` (new key, 3000 ms): no movement and no response. He is `idle` afterwards.
   - The gag is never a `NearMiss`.
6. **Coffee.**
   - `TapObject{objectId}` on an object of kind `coffee_machine` (D7) walks Papa to it, as in 1.17.
   - **On arrival** (`PapaArrived` of that walk), Papa enters `drink` and `CoffeeStarted{t, objectId, untilAt}` is emitted.
   - After `coffeeDurationMs`, at the first step where `now ≥ papa.busyUntil`, `addFatigue(world, ctx, −coffeeReductionPoints)` runs, clamped at 0. `CoffeeDrunk{t, fatigue}` is emitted and Papa is `idle`.
   - A `TapFloor`, `Move` or `PressThreat` before arrival cancels the coffee: the walk is no longer « to the object ».
   - Falling asleep during `drink` cancels the coffee: no −40.
   - A walk to a `phone` object only walks, until story 1.20.
7. **Busy means no response (D6).**
   - While Papa is `drink` or `asleep`, `runPapa` ignores `TapFloor`, `TapObject`, `Move`, `MoveStop` and `PressThreat`, and `runThreats` ignores `PressThreat`, so a threat that opens then ends in a gag (`late`).
   - `Release` is still processed.
   - The client sends nothing for those inputs either (AC 11).
8. **Touch tap on an object.**
   - A pointer press that hits no threat but lands within `feel.input.objectTouchRadiusPx` (new key, 64) of an object's icon point, projected like a threat's, sends `TapObject`. It is not a `TapFloor`.
   - The priority is threat > object > floor, with a comment where the baby (1.21) slots in.
   - The tap marker is shown at the object's floor point.
   - The client's object list comes from the sim's public API (`sim.objects`, D8), and `contextObjectsOf` is deleted (deferred L319).
9. **The gauge pill (`hud-gauge`).**
   - `[data-pp-zone="gauges"]` holds one pill (`role="group"`, `aria-label` « Jauges ») when the level has at least one gauge, and nothing visible otherwise. The order comes from `GAUGE_IDS` (Bruit · Fatigue · Envie; only `fatigue` exists).
   - Each gauge is an icon and a 60 × 16 px bar with a `{colors.gauge-track}` track and a 2 px ink outline.
   - The fill is **one** element scaled with `transform: scaleX(value / 100)`, under a mask of **exactly 10** ink-separated segments. No layout property animates.
   - The fill is `{colors.gauge-calm}` below 70 % and `{colors.gauge-warn}` from 70 %. At ≥ 70 % the icon chip also has an ink-and-warn ring and **pulses** at ≤ 1 Hz, so it never relies on hue alone.
   - Opacity:
     - 0.7 when the value is under 50 % and idle;
     - full when the value is ≥ 50 % or « changing ».
     - « Changing » means the value crossed a segment boundary or jumped by ≥ 5 points within the last `GAUGE_CHANGE_HOLD_MS` (1500, real ms; D11).
   - Each gauge has `aria-label` « Fatigue 80 % ».
   - **Writes:**
     - the value goes through `hudBatch`, one slot per gauge, as an integer percent, so at most every 2 s at 0.5/s;
     - the class toggles happen only on a change;
     - nothing is allocated per frame.
   - **Budgets:** the HUD stays ≤ `HUD_MAX_DOM_NODES` (40) and in the 12 % band. The pill is inert, like the timer.
   - **Reduced motion:** no pulse; the ring stays.
10. **Diegetic feedback (provisional, E7 replaces it).**
    - While the micro-sleep is `telegraph` / `windowOpen`, Papa's view shows drooping eyelids: an ink band lowering over the face of the cube, driven by `world` every frame. Its marker (eyelid glyph) is drawn **on Papa** and follows his interpolated pose.
    - During `asleep`, the eyelids are closed and a « Z » floats.
    - During `drink`, a small mug-coloured cube sits at Papa's hand.
    - No vignette, no DOM overlay (EXPERIENCE L377).
11. **Client gates.**
    - The input mapper drops a pointer press, `TapObject`, floor tap or `Move` while `world.papa.state` is `drink` or `asleep`, with a `debug` log. A key held through it walks again on the `PapaStateChanged → idle` (reuse `resumeHeld`).
    - `targetedThreatId()` is null while Papa is busy, so no highlight or glyph chip is shown.
    - `data-pp-papa` mirrors the new states.
12. **Sound and haptics (placeholders).** `content/feedback.json` gains `tel_papa_microsleep` (a muffled swell) and `gag_papa_asleep` (a snore). Each has `audio`, `visual` (`soundWave` on `threat`) and `haptic`, as the project rule asks. The clips come from `npm run assets:audio` (`makePlaceholderAudio.ts`) and are committed. Success and perfect reuse `resp_parry` / `resp_parry_perfect`.
13. **Headless check (epic AC 5).** `tests/tools/sim/microSleep.test.ts` plays the **live** `salon_crawler` with the `idle` bot for the level's duration over 5 seeds. It asserts all of these:
    - no `papa_microsleep` telegraph before the `FatigueThresholdCrossed{isAbove: true}` of that run;
    - the first one is within `[cross + microSleepMinMs, cross + microSleepMaxMs + STEP_MS]`;
    - every gap between two of them is within `[microSleepMinMs, microSleepMaxMs + STEP_MS]`;
    - at least one per run;
    - every one has `waveIndex: -1`.

    Every bound is read from `content/feel.json` and the level, never written as a literal.
14. **CLI report.**
    - The run recorder ignores `waveIndex: -1` telegraphs in the per-wave tallies and in the active count (otherwise a micro-sleep inflates `peakSimultaneous` and flags `overLimitRuns`).
    - The report gains `microSleeps` (telegraphs summed over the runs), `coffees` (`CoffeeDrunk`) and `asleepRuns` (runs with at least one `papa_asleep` gag).
    - 1.18's live idle test (`overLimitRuns === 0`) still passes.
15. **Content checks.** `content:check` names the file, the path and the culprit for each of these:
    - `gauges.fatigue.microSleepDef` that has no threat file;
    - a def whose `target` is not `papa`;
    - a wave threat whose def has `target: "papa"`;
    - an object `kind` the sim has no action for.

    Every `ThreatDef` now has `target`. `createSim` refuses the same, with an `invariant`, in the same wording.
16. **Tests, goldens, CI.**
    - The tests of § Testing pass.
    - Golden levels plan no gauge, so `eventTypes` and `eventsHash` of all six scenarios stay **identical**. Only `worldHash` moves (new slices). Regenerate them with `npm run golden:update` and say so.
    - The screenshot references (the pill now shows) are regenerated, darwin and linux, and looked at.
    - Coverage of `src/sim` stays ≥ 90 %.
    - `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T0 — Precondition** (§ Precondition). Record the baseline CI and the counts in the Debug Log.
- [x] **T1 — Content** (AC 4, 6, 9, 12, 15)
  - [x] `src/content/schemas/threat.ts`:
    - `THREAT_TARGETS = ['anchor', 'papa'] as const`, and a required `target` field described « where the threat stands: a planned anchor, or on Papa (system-spawned, story 1.19) ».
    - `THREAT_ICONS` gains `'eyelids'`.
    - Add `"target": "anchor"` to the three existing threat files.
  - [x] `content/threats/papa_microsleep.json`:
    - `target: "papa"`, `response: "parry"`, `telegraphDelayMs: 1200`, `windowMs: null`, `gag: "papa_asleep"`, `icon: "eyelids"`, `cooldownMs: 1000`;
    - feedback `tel_papa_microsleep` / `resp_parry` / `resp_parry_perfect` / `gag_papa_asleep`.
    - The cooldown must stay below `microSleepMinMs − telegraphDelay − window − asleepMs`, or the gap test of AC 13 breaks. Note that in the Dev Notes; nothing enforces it.
  - [x] `src/content/schemas/level.ts`:
    - `GAUGE_IDS = ['noise', 'fatigue', 'need'] as const` (the pill order; only `fatigue` has a schema entry now), `GaugeId`.
    - `LevelSchema.gauges: z.strictObject({ fatigue: z.strictObject({ microSleepDef: idSchema(…) }).optional() }).default({})`. Absent means the level has no fatigue (D1).
    - `OBJECT_KINDS = ['coffee_machine', 'phone'] as const`. `LevelObjectSchema` gains a required `kind: z.enum(OBJECT_KINDS)` (D7).
    - Update the header comment (1.19 added `gauges` and the object `kind`).
  - [x] `content/levels/salon_crawler.json`: `"gauges": { "fatigue": { "microSleepDef": "papa_microsleep" } }`, and a `kind` on both objects.
  - [x] `src/content/schemas/feel.ts` and `content/feel.json`:
    - `fatigue.startPoints` (0, `points`);
    - `fatigue.asleepMs` (3000, `durationMs`, « how long Papa sleeps after a missed micro-sleep »);
    - `input.objectTouchRadiusPx` (64).
    - Keep the existing `.refine`.
  - [x] `src/content/loadLevelContent.ts`: also load `gauges.fatigue.microSleepDef` into `LevelContent.threats`, after the wave defs. A missing file names `gauges.fatigue.microSleepDef`. Then the bots' `botResponsesOf` and the client's `threatCueOf` see it with no change.
  - [x] `tools/content/contentChecks.ts` (AC 15) and tests in `tests/content/checkContent.test.ts`, `levelSchema.test.ts`, `threatSchema` (wherever its cases live) and `loadLevelContent.test.ts`.
  - [x] `npm run content:schemas`; commit `content/_schemas/{threat,level,feel}.schema.json`.
  - [x] `content/strings.fr.json`: `"hud.gauges": "Jauges"`, `"hud.gauge_fatigue": "Fatigue"` (EXPERIENCE L164). Pass the keys as literals.
- [x] **T2 — World, level plan and snapshot** (AC 1, 4, 6)
  - [x] `src/sim/world.ts`:
    - `GaugesSlice = { fatigue: number; isFatigueAbove: boolean; microSleepAt: SimMs | null }` and `World.gauges` (architecture L229). The initial `fatigue` is `startPoints`, so `createWorld` takes `fatiguePoints` in its options. `isFatigueAbove` starts `false`: the first `runGauges` step emits the crossing if `startPoints` is already above.
    - `PapaSlice` gains:
      - `objectId: string | null`, the object the current walk goes to;
      - `busyUntil: SimMs`, 0 unless `drink` / `asleep`.
    - Update the `ThreatInstance` doc: a papa-target instance's `xM` / `zM` follow Papa.
  - [x] `src/sim/papa/papaFsm.ts`: `PapaState` adds `'drink' | 'asleep'`. Export `PAPA_STATES` with an `…_ARE_COMPLETE` proof (the `THREAT_STATES` pattern) and `isPapaBusy(papa)`. Snapshot's local `PAPA_STATES` goes away in favour of the export.
  - [x] `src/sim/context.ts`:
    - `SimPlannedThreat.firstWaveIndex` is `-1` for a system-spawned threat. Doc it.
    - `SimLevel` gains `microSleepIndex: number`, the index in `threats` / `world.threats` of the micro-sleep, or `-1` when the level has no fatigue.
    - `SimLevel.objects` entries gain `kind` and `yM`.
  - [x] `src/sim/createSim.ts` › `simLevelOf`:
    - with `gauges.fatigue`, append one planned threat `{ def, anchorId: 'papa', firstWaveIndex: -1 }` after the wave ones;
    - check the def is loaded and `target === 'papa'`, check no wave def has `target: 'papa'`, and check each object kind;
    - the instance's `xM` / `zM` start at Papa's spawn;
    - skip it in `checkReachable` (it is not an anchor).
    - `PAPA_TARGET_ANCHOR_ID = 'papa'` goes in `shared/constants.ts`.
  - [x] `Sim.objects: readonly SimObjectSpec[]` (D8), and export the type from `@sim`.
  - [x] `src/sim/snapshot.ts`:
    - `version: 7`, with a comment;
    - check `gauges` (fatigue finite in `[0, 100]`, the boolean, `microSleepAt` null or finite ≥ 0);
    - check `papa.objectId` (null or a string) and `papa.busyUntil` (finite ≥ 0, and > 0 exactly when busy);
    - busy states have no path and no glide;
    - add tests.
- [x] **T3 — Fatigue system** (AC 1-4)
  - [x] `src/sim/gauges/fatigue.ts`:
    - `addFatigue(world, ctx, points)`: the only writer of `gauges.fatigue`. It clamps with `Math.min` / `Math.max`: saturation is a rule, not an `InvariantViolated`. Then it updates `isFatigueAbove` and emits `FatigueThresholdCrossed` on a change, and sets or clears `microSleepAt` (one draw on the way up).
    - `fatigueWindowModifier(world, ctx)`.
    - `isBabyCarried(world)` returns `false` with a comment: « E4 reads `world.papa.carrying` ».
    - `runFatigue(world, ctx)`: a no-op when `ctx.level.microSleepIndex < 0`. Otherwise:
      - `addFatigue` of the step's gain;
      - put the micro-sleep instance on Papa;
      - the spawn rule of AC 4, calling `telegraphThreat(…, waveIndex -1)` and then drawing the next.
    - Allocation-free.
  - [x] `src/sim/gauges/gaugesSystem.ts` › `runGauges(world, ctx)` calls `runFatigue`. It is one system, so that 3.1's noise joins it. Add it to `SYSTEMS` before `runFlow`, and update the header comment and the pinned order test.
  - [x] `threatFsm.ts` › `telegraphThreat`: `fatigue: fatigueWindowModifier(world, ctx)` (it is a pure reader). Remove the « fatigue does not exist yet » comment.
  - [x] Tests: `fatigue.test.ts` and `gaugesSystem.test.ts`. See § Testing.
- [x] **T4 — Papa: coffee, sleep, busy** (AC 5-7)
  - [x] `src/sim/papa/coffee.ts`:
    - `startCoffee(world, ctx, objectId)`: `drink`, `busyUntil`, `CoffeeStarted`.
    - `finishCoffee(world, ctx)`: `addFatigue(−coffeeReductionPoints)`, `CoffeeDrunk{fatigue}`, `idle`.
  - [x] `src/sim/papa/sleep.ts` › `putPapaToSleep(world, ctx)`: it drops the path, the glide, `dir` and `objectId`, then sets `asleep` and `busyUntil = now + asleepMs`. It cancels a coffee: no `CoffeeDrunk`.
  - [x] `papaSystem.ts`:
    - `tapObject` records `papa.objectId` after a successful plan;
    - `tapFloor`, `move` and the glide clear it;
    - on `PapaArrived` of a `walkPath` with `objectId` set, run the object action. It is a `Record<ObjectKind, …>` like `GAG_CONSEQUENCES`: `coffee_machine → startCoffee`, `phone → nothing (story 1.20)`.
    - While `isPapaBusy`, the command loop skips the movement commands and `PressThreat`.
    - `drink` / `asleep` end at `now ≥ busyUntil`.
    - `pressThreat` does not glide for a threat whose planned def has `target: 'papa'`.
    - Update the doc comments.
  - [x] `threatSystem.ts`: `PressThreat` is ignored while `isPapaBusy(world.papa)`, with a comment (AC 7). `Release` is unchanged.
  - [x] `gags.ts`:
    - `GAG_IDS` gains `'papa_asleep'`; its consequence calls `putPapaToSleep`.
    - Update the header: a gag consequence writes through helpers (`pushProp`, `putPapaToSleep`), never a slice directly.
  - [x] `directorSystem.ts`:
    - `isInPool` requires `firstWaveIndex >= 0`;
    - the active count skips instances whose planned `firstWaveIndex < 0`. This resolves deferred L326.
  - [x] `babySystem.ts` › `lockOnThreat`: skip papa-target threats (index-aligned `ctx.level.threats[i].def.target`).
  - [x] `events.ts`:
    - `FatigueThresholdCrossed{t, isAbove}`, `CoffeeStarted{t, objectId, untilAt}` and `CoffeeDrunk{t, fatigue}`, with doc comments;
    - `SIM_EVENT_TYPES` stays sorted.
  - [x] `commands.ts`: `SetFatigue{t, points}`, a debug / test command, journaled like `SetTimeScale`. `applyCommands`, or `runGauges`, applies it through `addFatigue(points − current)`, so the crossing logic runs. `commandProblem` requires a finite number. e2e and Geo use it.
  - [x] `src/sim/index.ts`: export `PAPA_STATES` (if the client needs it), `GaugesSlice`, `SimObjectSpec` and `isPapaBusy` (a pure helper; or duplicate the two-state test in the client, your call, and say so).
  - [x] Tests: `coffee.test.ts`, `sleep.test.ts`, `papaSystem.test.ts`, `threatSystem.test.ts`, `directorSystem.test.ts`, `babySystem.test.ts`, `gags.test.ts`, `events.test.ts` and `commands.test.ts`.
- [x] **T5 — Client input** (AC 8, 11)
  - [x] `hitTest.ts` › `pickObject(clientX, clientY, rect, objects, radiusPx)`: the same projection as `pickThreat`, at `(xM, yM, zM)` of each object, nearest within the radius, `null` otherwise. Allocation-free. Update the `pickFloor` comment.
  - [x] `inputMapper.ts`:
    - `handlePointerDown`: threat, then **(baby: story 1.21)**, then object (`TapObject`, `showTapMarker` at its floor point), then floor;
    - the busy gate (AC 11);
    - `getObjects()` returns `sim.objects`.
  - [x] `boot.ts`:
    - drop `contextObjectsOf` and `levelObjects` and read `levelSession.active.sim.objects`;
    - `objectTouchRadiusPx` from `levelFeel()`;
    - on `PapaStateChanged` to `idle` from a busy state, `inputMapper.resumeHeld()`.
  - [x] Delete `contextObject.ts`'s `contextObjectsOf` and keep `pickContextObject`. Migrate its test and `levelSession` (`onLevelReady` no longer passes objects).
- [x] **T6 — Client HUD gauge** (AC 9)
  - [x] `src/client/ui/hud/gaugesHud.ts` › `createGaugesHud(doc, { t, nowAtReal })` → `{ element, setGauges(ids: readonly GaugeId[]), setValue(id, percent), frame(nowAtReal) }`. `frame` ends the « changing » hold without allocating.
    - The icons are a `Readonly<Record<GaugeId, (doc) => SVGSVGElement>>`, from the mockup's `#i-bruit`, `#i-fatigue` and `#i-envie` (L156-159), with fills from CSS classes using tokens (no hex). The labels are a `Record<GaugeId, string>` of literal keys. Only `fatigue` is shown in 1.19, but all three icons exist so 3.1 / E4 only add their system.
    - Structure per gauge: `div.pp-hud-gauge` > `svg` + `div.pp-hud-gauge-bar` > `div.pp-hud-gauge-fill`. The pill is `div.pp-hud-gauges[role=group]`. Count the nodes; the e2e checks the total.
  - [x] `ui.css`:
    - `.pp-hud-gauges`: mockup L54, with tokens (`--pp-outline`, `--pp-lift`, `--pp-rounded-full`, `--pp-spacing-3` gap, `--pp-spacing-2` padding, 40 px tall).
    - `.pp-hud-gauge`, `.is-idle` (`opacity: .7`), `.is-warn` (fill `--pp-color-gauge-warn`, and an icon ring `box-shadow: 0 0 0 3px var(--pp-color-gauge-warn)` plus the pulse keyframe at ≤ 1 Hz).
    - The bar is 60 × 16, `border: 2px solid var(--pp-color-ink)`, track `--pp-color-gauge-track`.
    - The fill has `transform-origin: left`.
    - The mask is `repeating-linear-gradient(90deg, transparent 0 3.6px, var(--pp-color-ink) 3.6px 5.6px)`: **5.6 px per segment over the 56 px inner width = 10 segments**. The mockup's 5.8 px gives 9.7; DESIGN wins, epics L213.
    - `@media (prefers-reduced-motion: reduce)`: no animation.
    - No transition on layout properties.
  - [x] `hudLayer.ts`: accept `gauges: HTMLElement` and append it to the `gauges` zone. Update the doc comment.
  - [x] `boot.ts`:
    - the batch gets one slot per `GaugeId` (`GAUGE_SLOTS`, a `Record<GaugeId, number>` after `TIMER_SLOT`);
    - at level start, `gaugesHud.setGauges(ids present in the level)`;
    - in `onLevelFrame`, `hudBatch.set(slot, Math.round(world.gauges.fatigue))` and `gaugesHud.frame(now)`.
  - [x] Unit tests: `gaugesHud.test.ts` (structure, order, aria, the idle / warn / changing classes at 49 / 50 / 69 / 70, the hold ending, no fatigue → hidden) and `hudLayer.test.ts`.
- [x] **T7 — Client world feedback** (AC 10, 12)
  - [x] `threatMarkers.ts`:
    - `ThreatMarkerEntry` gains `followsPapa: boolean`, and its `xM` / `yM` / `zM` become writable for those entries only. Document that `hitTest` reads them.
    - `threatMarkerEntries` builds a papa-target entry with no anchor lookup and no warn.
    - `update(…)` takes Papa's interpolated pose and moves the following markers (object position and entry), at a height of `PAPA_HEIGHT_M` + the icon offset.
    - `THREAT_ICON_PATHS.eyelids` is a closed eye with lashes (24 × 24, provisional).
  - [x] `papaView.ts`:
    - `setEyelids(amount)`: an ink box over the top of the front face, scaled down from 0 to 1;
    - `setAsleep(isAsleep)`: eyelids 1 and a floating « Z » sprite or mesh;
    - `setDrinking(isDrinking)`: a small mug cube.
    - Each is driven from `world` every frame in `levelScene` / `viewRegistry`, with no allocation. The eyelid amount is the telegraph progress `(now − enteredAt) / (windowOpenAt − enteredAt)`, clamped, while the micro-sleep is active.
  - [x] `render/gags.ts`: `GAG_PRESENTATIONS.papa_asleep` (a new flag if needed). The `Record` forces it.
  - [x] `content/feedback.json`: the two cues of AC 12. `tools/audio/makePlaceholderAudio.ts` gains `tel_papa_microsleep` (lowpassed noise swelling over about 600 ms) and `gag_papa_asleep` (two snore cycles, a low saw with a slow tremolo, about 1.2 s). Run `npm run assets:audio` (macOS) and commit the `.m4a`. Update the tool's header and its test.
  - [x] `boot.ts` mirrors: `data-pp-papa` already mirrors the state; check that the new states pass. Add `mirror('ppFatigue', …)`, rounded and written on `FatigueThresholdCrossed` and `CoffeeDrunk` only, never per frame.
- [x] **T8 — Bots and CLI** (AC 13, 14)
  - [x] Bots need no code: the micro-sleep def is in `LevelContent.threats`, so `botResponsesOf` gives it `parry`. Prove it with one `perfectBot` test: on a level with `startPoints` above the threshold, every micro-sleep is resolved and no `papa_asleep` gag happens.
  - [x] `tools/sim/simReport.ts` (AC 14) and its tests.
  - [x] `tests/tools/sim/microSleep.test.ts` (AC 13).
- [x] **T9 — Tests to migrate**
  - [x] `TEST_OBJECTS` gains `kind`.
  - [x] `createTestLevel` gains `gauges` (default `{}`) and resolves `gauges.fatigue.microSleepDef` from the frozen threats. `createTestThreats` gains `createTestMicroSleep()`.
  - [x] Frozen threats gain `target: 'anchor'`.
  - [x] `createTestContent().feel` gains the three new keys.
  - [x] `threatCatalog.test.ts`: a papa-target def gets its four cases through a level with `gauges.fatigue`, `feelOverrides` `{ fatigue: { startPoints: 100, microSleepMinMs: 0, microSleepMaxMs: 0 } }` (or the frozen feel patched the same way), and no waves. It must stay name-free: branch on `def.target`, never on the id.
  - [x] Never delete a test to go green. Rewrite one whose premise changed and say so.
- [x] **T10 — e2e** (AC 8-11, 16)
  - [x] New `tests/e2e/fatigue.spec.ts` (chromium + webkit, frozen with `ppLoadLevel('salon_crawler', 42)`):
    - The pill is in `[data-pp-zone="gauges"]` with one gauge, `aria-label` « Fatigue 0 % », class idle. The fill's computed transform is a `scaleX` matrix, and no other style animates.
    - After `SetFatigue{points: 80}` and a few steps, it has the warn class, full opacity and an `aria-label` starting « Fatigue 8 ».
    - The HUD node count stays ≤ `HUD_MAX_DOM_NODES`.
    - **Coffee by tap:**
      - project the coffee machine's anchor (`anchorMirror('coffee_machine')`; add a helper that clicks its screen point, like `threatIconPoint`);
      - advance until `CoffeeStarted`, then `coffeeDurationMs / STEP_MS` steps;
      - expect `CoffeeDrunk` with `fatigue === 80 − coffeeReductionPoints` (± one step's gain, from the live feel) and `data-pp-papa` back to `idle`.
      - During `drink`, a floor tap adds no `PapaPathPlanned`.
    - **Micro-sleep:** `SetFatigue{points: 90}`, then advance until a `ThreatTelegraphed` of kind `papa_microsleep`, with a timeout from `microSleepMaxMs`. Its marker is visible near Papa's screen point. Clicking it resolves it, and Papa's position is unchanged by the press (no glide).
  - [x] `threats.spec.ts`, `timer.spec.ts` and the other long runs: micro-sleeps now appear after about 140 s. Check that no assertion counts every `ThreatTelegraphed` as a wave threat (filter on `waveIndex >= 0` where needed).
  - [x] Screenshots: regenerate darwin and linux (`CLAUDE.md`; memory « story-1-13-screenshot-refs »). Look at each PNG: the pill is top-left with one idle gauge, the timer and pause button are unchanged. Say so.
- [x] **T11 — Goldens** (AC 16): `npm run golden:update`, then `git diff tests/golden/journals`. Only `worldHash` may move. If `eventTypes` or `eventsHash` move, a system emits or draws on a level without gauges: fix that, never the references.
- [x] **T12 — Docs and deferred work**
  - [x] `deferred-work.md`: mark resolved with « (story 1.19) »: L67 (gauge pill), L303 (touch tap on objects), L304 (`ObjectTapped` consumer, for the coffee), L319 (object positions) and L326 (`maxSimultaneous`).
  - [x] Add a « Deferred from: implementation of story 1-19 » section with:
    - the busy feedback and the coffee cue (no UX spec);
    - the snore, +15 % noise and the woken baby (E3 / E4);
    - the gauge pulse rate (an assumption);
    - the « changing » hold (D11);
    - L25's loose `windowPenaltyPct`, now read by the sim (tighten to < 100?).
  - [x] `_bmad-output/project-context.md`: the system order now includes `runGauges`. Add the busy rule and the papa-target threat rule.

## Dev Notes

### Decisions (D1-D12)

| # | Decision | Why |
|---|---|---|
| D1 | **A level opts into fatigue**: `"gauges": { "fatigue": { "microSleepDef": "papa_microsleep" } }`. Absent means no fatigue system, no gauge in the pill and no micro-sleep. | « Chacune n'apparaît que si son système existe dans le niveau » (epic). The def id is data, not a constant in the sim. Golden and test levels plan no gauge, so their events do not move (AC 16). |
| D2 | **`ThreatDef.target: 'anchor' \| 'papa'`**, required, with no default (the schema's rule: keys always written). | Architecture L736 names `target: "papa"`. One field lets the sim, the client and the catalogue branch on the def, never on an id. |
| D3 | **The micro-sleep is one pre-created instance**, appended after the wave instances, with `anchorId: 'papa'` and planned `firstWaveIndex: -1`, index-aligned as before. The fatigue system keeps its `xM` / `zM` on Papa each step. | `world.threats` stays fixed-size and index-aligned with `ctx.level.threats` (1.10 D5, `threatMarkers`, `hitTest`, the bots, the snapshot). Since only one exists, two micro-sleeps can never overlap. The feedback's `threat` anchor and the auto-target cone (« a threat on Papa counts in every cone ») then just work. |
| D4 | **Spawn cadence.** One draw on the upward crossing, one after each telegraph. The spawn waits while the instance is not idle or Papa is busy, and goes at the first step after that. A downward crossing clears it. | « Toutes les 8 à 12 s (PRNG) ». The gap is counted from the last telegraph, like the director (1.18 D3). With `cooldownMs` 1000 and `asleepMs` 3000 the wait never triggers on the live tuning, so AC 13's bounds hold exactly. |
| D5 | **`addFatigue` is the only writer of `gauges.fatigue`.** The coffee, 1.20's phone and `SetFatigue` call it, so every change runs the crossing logic. It clamps silently. | One writer, as for the FSMs. `clampInvariant` reports bugs; reaching 100 is gameplay. |
| D6 | **Busy = `drink` or `asleep`.** Papa ignores the movement commands and presses. `runThreats` ignores `PressThreat`. `Release` passes, so a finger down before the coffee still ends. The spawn waits. | « Aucune réponse possible pendant ce temps » (epic). A threat that opens meanwhile gags `late`: that is the coffee's cost. 1.20 reuses the state for the phone (5000 ms). |
| D7 | **Objects gain a `kind`** (`coffee_machine`, `phone`). The arrival action is a `Record<ObjectKind, …>`, so a kind with no action does not compile. The 3000 ms counts from **arrival**. | Epic: « papa y va, est occupé 3000 ms … puis ». A kind keeps content ids out of the sim. 1.20 fills `phone`. |
| D8 | **`Sim.objects`** exposes the planned objects (with `kind` and `yM`) and the client's copy goes away. | Deferred L319. The touch hit test needs the anchor height to project the icon point. |
| D9 | **A press on a papa-target threat does not glide.** | A glide « to himself » would cancel his walk for nothing. The response is still judged on the press's `t` (P3). |
| D10 | **The failure is a 3 s nap** (`feel.fatigue.asleepMs`). There is no snore noise, no woken baby, no `NearMiss`. Falling asleep cancels a coffee. | Story: « gag de papa endormi quelques secondes ». The snore, the woken baby and +15 % noise are the E4 `stay_awake` rules (GDD L258); noise does not exist yet. |
| D11 | **Gauge opacity.** Full at ≥ 50 %, or while « changing ». « Changing » means crossing a 10-point segment boundary or a jump of ≥ 5 points, held for `GAUGE_CHANGE_HOLD_MS` = 1500 real ms (a client constant, in `shared/constants.ts`, with a comment saying Geo tunes it). | A gauge that rises 0.5/s continuously would otherwise never be idle. EXPERIENCE L207 is `[ASSUMPTION]`. The DESIGN « idle 0.7 » vs EXPERIENCE « under 50 % and idle » conflict is settled for EXPERIENCE (the epic quotes it). Open point 2. |
| D12 | **Threshold: the sim uses `>`, the HUD uses `≥`.** | The GDD and the epic say « au-dessus de 70 » for the rules, and DESIGN / epic « dès 70 » for the display. Both are kept literally; the one-point difference is invisible. |

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatFsm.ts`**: `telegraphThreat(world, ctx, threat, def, waveIndex)`.
  - Today: `effectiveWindow(timing, base, { tier: difficulty.normal.windowMultiplier, fatigue: NEUTRAL_WINDOW_MODIFIER, instinct: NEUTRAL_WINDOW_MODIFIER })`.
  - **Change:** only the fatigue argument.
  - **Keep:** the event order, the hitstop and slow-mo rules, and `isLastOfWave` (`waveIndex < 0` is already never last).
- **`src/sim/threats/threatSystem.ts`**:
  - Today: commands first (`PressThreat` → `pressThreat`, `Release` → `releasePresses`), then each instance.
  - **Change:** the busy gate on `PressThreat`.
- **`src/sim/papa/papaSystem.ts`**:
  - Today: `tapObject` loops `ctx.level.objects`, calls `tapFloor` and emits `ObjectTapped`. `pressThreat` calls `startGlide` for any non-idle threat. Arrival emits `PapaArrived` and enters `idle`.
  - **Changes:** `objectId`, the arrival action, the busy states and the no-glide rule for papa targets.
- **`src/sim/director/directorSystem.ts`**:
  - Today: `isInPool` is `firstWaveIndex <= waveIndex` (a `-1` would wrongly pass), and `activeCount` counts every active instance.
  - **Fix both** (D3, deferred L326).
- **`src/sim/baby/babySystem.ts`** › `lockOnThreat`: today it locks on the first active instance of any kind. Skip papa targets, or the baby crawls to Papa.
- **`src/sim/createSim.ts`**:
  - `plannedEntriesOf` and `checkReachable` walk the waves only; keep it so.
  - `simLevelOf` builds `objects` as `{ id, xM, zM }`.
  - The instances are pushed after `checkReachable`.
- **`src/sim/snapshot.ts`**:
  - `version: 6` and a local `PAPA_STATES`.
  - `papaProblem` ties `glide` to its state, and `worldProblem` destructures the slices. Add `gauges`.
- **`src/client/ui/world/threatMarkers.ts`**: the entries are built once per level at the anchor positions. An unknown anchor warns and falls back to `threat.xM` / `zM`. `update(threats, highlightedId, targetedId)` is per frame and allocation-free.
- **`src/client/input/inputMapper.ts`**: `handlePointerDown` is threat, then floor. `act('down')` is the auto-target, then `pickContextObject` → `TapObject`. `isLive()` includes `flow.state === 'playing'`.
- **`src/client/boot.ts`**:
  - `TIMER_SLOT = 0` and `createHudBatch([timer])` (about L610).
  - `onLevelFrame` sets the timer slot before `shell.frame()` (about L478-490).
  - `onLevelReady(level, threatEntries, objects)` (about L466).
- **`tools/sim/simReport.ts`** (about L95-110): `activeCount++` on every `ThreatTelegraphed`. This is the micro-sleep bug of AC 14.
- **`tools/content/contentChecks.ts`**: it already checks the gag ids against `GAG_IDS` and the objects' ids and anchors. Extend it.

### Architecture compliance

- **Sim purity.** All randomness comes from `world.rng` through `nextFloat`, and the draws do not depend on tuning. No `Math.random`, `Date` or `performance`.
- **Systems never call systems.** `runGauges` calls helpers: `addFatigue` and `telegraphThreat` are FSM / slice helpers, the same pattern as the director. The papa system calls `startCoffee` / `finishCoffee` / `addFatigue` (helpers), and a gag calls `putPapaToSleep` (a helper), like `pushProp`.
- **The order** is `applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa, runPhysics, runGauges, runFlow`.
- **Units and names.** `startPoints`, `asleepMs`, `objectTouchRadiusPx`, `busyUntil` (an instant), `microSleepAt` (an instant). Events are past tense; commands are imperative (`SetFatigue`).
- **The client** imports only `@sim`, `@content`, `@shared` and `three`. The HUD is DOM + CSS with the `pp-` prefix, uses tokens only, stays ≤ 40 nodes, animates only `scaleX`, and writes through `hudBatch`.
- **Zero allocation** in `step()`, every system, the rAF loop and the markers' update.
- **Content.** A new JSON is not done until `content:check` passes, and `content/_schemas` is regenerated, never hand-edited.

### Library and framework notes

- Zod 4 (pinned): `z.enum`, `.optional()`, `.default({})`, `z.strictObject`. A `superRefine` does not show in the generated JSON Schema.
- Three.js: the eyelids, the « Z » and the mug are toon-material boxes from `toonMaterial.get(color)`, using a `PALETTE` colour (no new hex in TS). Dispose them with the view.
- No new dependency. The audio tool needs macOS `afconvert`; CI never runs it.

### File structure

| File | New / Update |
|---|---|
| `content/threats/papa_microsleep.json` | New |
| `content/threats/{outlet,stairs,coffee_table_object}.json`, `content/levels/salon_crawler.json`, `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/*` | Update |
| `src/content/schemas/{threat,level,feel}.ts`, `src/content/loadLevelContent.ts`, `tools/content/contentChecks.ts` | Update |
| `src/sim/gauges/fatigue.ts`, `src/sim/gauges/gaugesSystem.ts`, `src/sim/papa/coffee.ts`, `src/sim/papa/sleep.ts` (+ tests) | New |
| `src/sim/{world,context,createSim,snapshot,step,events,commands,commandQueue,index}.ts`, `papa/{papaFsm,papaSystem}.ts`, `threats/{threatFsm,threatSystem,gags}.ts`, `director/directorSystem.ts`, `baby/babySystem.ts` | Update |
| `src/shared/constants.ts` (`PAPA_TARGET_ANCHOR_ID`, `GAUGE_CHANGE_HOLD_MS`) | Update |
| `src/client/ui/hud/gaugesHud.ts` (+ test) | New |
| `src/client/ui/hud/hudLayer.ts`, `ui/styles/ui.css`, `ui/world/threatMarkers.ts`, `input/{hitTest,inputMapper,contextObject}.ts`, `render/views/papaView.ts`, `render/gags.ts`, `app/levelSession.ts`, `boot.ts` | Update |
| `tools/audio/makePlaceholderAudio.ts`, `public/assets/audio/{tel_papa_microsleep,gag_papa_asleep}.m4a` | Update / New |
| `tools/sim/simReport.ts`, `tests/tools/sim/microSleep.test.ts` (new), `tests/support/testContent.ts`, `tests/threats/threatCatalog.test.ts`, `tests/e2e/fatigue.spec.ts` (new), `tests/golden/journals/*`, `tests/e2e/__screenshots__/autoplay.spec.ts/*.png` | Update |

The architecture's `runFatigue` (L906) stays as the fatigue function; `runGauges` is the system in `SYSTEMS` (architecture L840 and the `step.ts` header already name it). Note it in the Completion Notes.

### Testing

**Unit (Node, Vitest; time in steps):**
- **`fatigue.test.ts`:**
  - the gain per step, and the clamp at 100 and at 0;
  - no change without `gauges.fatigue`;
  - the crossing up emits once and draws once, and the crossing down clears `microSleepAt` and emits once;
  - exactly 70 is not above;
  - `startPoints` above the threshold crosses at the first step;
  - `fatigueWindowModifier` at 70 and at 70.01;
  - `isBabyCarried` is false.
- **Spawn:**
  - the first micro-sleep lands in `[cross + min, cross + max]`, and the next ones are spaced in `[min, max]`;
  - it waits while Papa is `drink` / `asleep` or the instance is in cooldown, then goes at the first step after;
  - it stops after `ended`;
  - same seed → same instants;
  - zero draws in a level without fatigue (compare `world.rng` after 1000 steps).
- **Judgement:**
  - a telegraph while above freezes `windowMs = base × 0.8`;
  - one frozen before the crossing keeps its window;
  - the micro-sleep's own window is shrunk too.
- **Coffee:**
  - `TapObject` → walk → `CoffeeStarted` on arrival → exactly `coffeeDurationMs` later `CoffeeDrunk` with fatigue −40 (clamped at 0) → `idle`;
  - a `TapFloor` before arrival cancels;
  - commands during `drink` are ignored;
  - a threat that opens during `drink` gags `late`;
  - the `phone` object only walks.
- **Sleep:**
  - a micro-sleep with no press → `papa_asleep` gag → `asleep` for `asleepMs`, no movement, a `PressThreat` on another threat ignored → `idle`;
  - asleep during `drink` gives no `CoffeeDrunk`.
- **Parry:** a press on the micro-sleep resolves it and does not glide (no `PapaGlideStarted`; Papa's path unchanged).
- **Director and baby:**
  - with the micro-sleep active, a `maxSimultaneous: 1` wave still telegraphs its own threat;
  - the director never picks the micro-sleep;
  - the baby does not lock on it;
  - `isLastOfWave` is unaffected.
- **Snapshot v7** fields, `createSim` refusals (AC 15), `SetFatigue`, `SIM_EVENT_TYPES` sorted, and the pinned `SYSTEMS` order.
- **Client:**
  - `gaugesHud.test.ts`;
  - `hitTest` `pickObject` (inside and outside the radius, a threat wins over an object);
  - `inputMapper` (object tap, the busy gate);
  - `threatMarkers` (a following entry moves with Papa; no warn for `papa`);
  - `threatFeedback` (the micro-sleep's cues come from its def).
- **Bots / CLI:** the perfect-bot micro-sleep test (T8), `simReport` (`waveIndex -1` ignored; `microSleeps`, `coffees`, `asleepRuns`), and `microSleep.test.ts` (AC 13).

**e2e:** T10. **Golden:** T11.

### Previous story intelligence (1.14-1.18)

- **1.18:**
  - `World.director` / `flow`, `SimLevel.waves`, `ENDED_SYSTEMS` (a level that ended runs only `applyCommands` and `advanceTime`, so fatigue freezes then for free), `isLastOfWave` already treats `waveIndex -1`, `hudBatch` with `TIMER_SLOT`, `isLive()` includes the flow, and `feelOverrides` are merged in `levelSession.ts` / `loadSimLevel.ts`. A test can therefore use a level's `feelOverrides` for `startPoints`.
  - Its Debug Log: the timer rounds **up**, and `LogChannel` has no `level` (use `sim`).
  - Load flakes: use `--maxWorkers=5`.
- **1.17:**
  - `TapObject` / `ObjectTapped`, `level.objects`, `pickContextObject` (Space / A with no active threat), `isLive()` gating, `lastDevice`, and the glyph chip.
  - With a micro-sleep active, Space / A targets it (it is « on Papa », so it is in every cone), so the coffee's context action is unavailable while it is up. That is intended.
- **1.14:** time effects are decided in `threatFsm` from `feel.json`, never in the `FeedbackDirector`. Nothing here adds a time effect.
- **1.15 / 1.16 reviews** punished:
  - e2e tests tied to live timings or ids;
  - tautological assertions;
  - story records that overstate what was verified.

  Derive every bound from the content and `STEP_MS`. Tick only what you ran; otherwise write « (deviation: see Debug Log) ».
- **Environment:** unset `VITE_DEBUG_ALLOWED` for `dev` / `e2e` / `ci`. The linux screenshots come from Docker with the `pp-node-modules` volume (memory « story-1-13-screenshot-refs »).

### Git intelligence

- The commits follow « Story X : création de la story », « Story X : <titre> » and « Story X : corrections de la revue de code », in French with a space before the colon. The implementation commit is `Story 1.19 : fatigue, café et micro-siestes`.
- Goldens, screenshots, schemas and generated audio go in the same commit as the code that changes them, and the story says so.

### Project context rules (from `_bmad-output/project-context.md`)

- L40: the system order, with `gauges` after `physics`; systems never call each other.
- L43: FSM changes only through `enter…State()`; durations as `world.time.sim − enteredAt` or an instant (`busyUntil`).
- L50-51: `TapObject` for objects; the effective window lives only in `sim/timing/effectiveWindow.ts`.
- L54 / L133: the hit-test priority, threat > (baby) > object > floor.
- L57 / L149: no hard-coded GDD number. Every value here is in `feel.json`, the level or the threat JSON, except the client art and UX constants (named, with a unit, Geo-tunable).
- L65: every feedback entry with `audio` also has `visual` and `haptic`.
- L75: zero allocation in hot paths.
- L112: `clampInvariant` is for bugs, not for saturation (D5).
- L121: goldens are regenerated deliberately.
- L161: system-spawned threats follow the same FSM and judgement.
- No `enum`, no constructor parameter properties, no new library.

### Open points for Geo (do not block on them; implement the decisions above)

1. **The failed micro-sleep** is a 3 s nap (D10; `feel.fatigue.asleepMs`). The snore, the woken baby and +15 % noise come with E3 / E4. Do you want something more visible in the meantime?
2. **Gauge opacity** (D11): 0.7 under 50 % when idle, and full for 1.5 s after each segment crossed. Tune `GAUGE_CHANGE_HOLD_MS`, or say if you prefer the DESIGN rule (idle 0.7 whatever the value).
3. **The first micro-sleep comes at about 148-152 s** (fatigue 0 → 70 at 140 s, with a 180 s level), so the player sees 3 or 4 of them, in wave 3. To feel them earlier, raise `feel.fatigue.startPoints` or `perSec`, or set them in the level's `feelOverrides`.
4. **Coffee and busy feedback** (a sound, a progress ring) have no UX spec: the provisional mug cube only. 2.x or E7.
5. **A micro-sleep up blocks the coffee by Space / A** (it is the auto-target). A tap on the machine still works.

### References

- `_bmad-output/planning-artifacts/epics.md`: Story 1.19 (L1033-1064); 1.20 (L1066-1086); FR12 (L42), FR16 (L49) and FR22 (L55); UX-DR4 (L218-220); feel values (L474); E2 sound (L1281-1292); 3.1 (L1557); E4 (L1832, L1874, L1903-1904).
- GDD L92, L165, L171-172, L196, L213, L238, L258, L381 and L496.
- Architecture L70, L98, L105, L220-223, L229-230, L348-349, L411, L489, L492, L520, L582, L585, L613, L629, L735-736, L840, L906-911, L944 and L965.
- `DESIGN.md` L29-31, L157-171, L395-397, L408, L425-426, L462 and L521-525. `EXPERIENCE.md` L32, L124, L164, L207, L375-380, L393, L420, L428-438 and L480-484. `mockups/key-hud-level.html` L19, L25-32, L53-62, L156-159, L178-181 and L206.
- `deferred-work.md` L25, L67, L115, L303-304, L319 and L326.
- `_bmad-output/implementation-artifacts/1-18-vagues-de-menaces-et-chrono-du-niveau.md` (downstream notes, D3, D6, D8, Debug Log) and `1-17-…md`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`).

### Debug Log References

- **Baseline (T0).** `env | grep VITE_` showed `VITE_DEBUG_ALLOWED=false`; every `dev` / `e2e` / `ci` ran under `(unset VITE_DEBUG_ALLOWED; …)`. 1.18 was `done`, the tree was clean at `4edc430`.
  - The first `npm run ci` baseline was **contaminated by me**: I started editing `content/` while its e2e phase ran, and 6 specs failed while the level was invalid. I did not count it. Unit part of that run: 174 files, 2730 tests, coverage green.
  - Clean baseline: e2e re-run alone on a `git worktree` of `HEAD` (no edits possible): **210 passed**.
  - No `--maxWorkers` was needed for the baseline; the final coverage run used `--maxWorkers=5` once, while Docker was running.
- **Final state.** Unit: 180 files, 2884 tests (2730 before), `src/sim` coverage above 90 %. e2e: 222 passed (210 before: `fatigue.spec.ts` adds 6 specs × 2 browsers). Goldens: `eventTypes` and `eventsHash` of all six scenarios identical, only `worldHash`, `feelHash` and `levelHash` moved (the new slices, the new feel keys and the level's `gauges` / object `kind`).
- **Deviations from the task text** (each also in the story's code comments):
  1. **`runFatigue` lives in `gauges/fatigueSystem.ts`, not `fatigue.ts`.** `threatFsm.ts` reads `fatigueWindowModifier`, and `runFatigue` calls `telegraphThreat`: both in `fatigue.ts` made an import cycle. `fatigue.ts` keeps `addFatigue`, `fatigueWindowModifier`, `isBabyCarried` and `drawMicroSleepMs`; `fatigueSystem.ts` has the system; `gaugesSystem.ts` calls it. The architecture's `runFatigue` name is kept.
  2. **Strings.** `content/strings.fr.json` already had `gauge.fatigue`, `gauge.noise` and `gauge.urge` (« Fatigue », « Bruit », « Envie »): the pill reuses them (`noise → gauge.noise`, `fatigue → gauge.fatigue`, `need → gauge.urge`) and only `hud.gauges` is new. No `hud.gauge_fatigue`.
  3. **State classes.** The architecture test (`designTokens`) requires every CSS selector to start with `pp-`: the idle and warn classes are `pp-hud-gauge-idle` and `pp-hud-gauge-warn`, not `.is-idle` / `.is-warn`.
  4. **`SetFatigue` is applied by `runGauges`**, not by `applyCommands` (so a level that has ended ignores it, and a level with no fatigue gauge too).
  5. **A press that does not glide cancels nothing.** AC 6 says a `PressThreat` before arrival cancels the coffee. It is the **glide** that clears `papa.objectId` (`startGlide`): a press on the micro-sleep (D9, no glide) keeps Papa walking to the machine (tested: `coffee.test.ts`).
  6. **`pickObject` tie rule** (the story left it open): the strictly nearer object wins, the earlier one wins an exact tie.
  7. **`withoutThreats` (`?threats=off`) now keeps the micro-sleep def**: with the level's `gauges` kept and the def dropped, `createSim` refuses the level (invariant). A quiet room stays quiet: the first micro-sleep comes at about 148 s.
  8. **New debug mirrors:** `data-pp-fatigue` (rounded, written on `FatigueThresholdCrossed`, `CoffeeDrunk` and at level start) and `data-pp-object-px` (`coffee_machine:x,y;phone:x,y`, once per level), so that a spec can tap an object like it taps a threat icon. `data-pp-papa-state` already carried the new states.
  9. **`threats.spec.ts` premise changed**: the planned instances are now `outlet, stairs, coffee_table_object, papa_microsleep`; the assertion lists the micro-sleep last. `threatCatalog.test.ts` and `papaSystem.test.ts` (the `TapObject` equivalence now uses the `phone`, which only walks) were rewritten for the same reason. No test was deleted.
- **Cooldown rule (T1).** `papa_microsleep.cooldownMs` (1000) must stay below `microSleepMinMs − telegraphDelay − window − asleepMs`, or the gap test of AC 13 breaks. Nothing enforces it.
- **Audio.** `npm run assets:audio` rewrites *every* `.m4a` (AAC encoding is not byte-stable). Only the two new clips were kept (`tel_papa_microsleep.m4a`, `gag_papa_asleep.m4a`); the other eleven were restored from git.
- **Screenshots.** `autoplay-frozen-{chromium,webkit}-{darwin,linux}.png` regenerated (darwin: `--update-snapshots`; linux: the story 1.13 Docker command with the `pp-node-modules` volume). I looked at all four: the pill is top-left with one dimmed fatigue gauge (an eye icon and an empty ten-segment bar), the timer is top-centre and the pause button top-right, unchanged.
- **Architecture note.** The architecture's `runFatigue` (L906) is the fatigue function; `runGauges` is the system in `SYSTEMS`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- ✅ **Fatigue in the sim.** `world.gauges` (`fatigue`, `isFatigueAbove`, `microSleepAt`); `addFatigue` is the only writer (clamps silently, emits `FatigueThresholdCrossed` once per crossing, draws the first micro-sleep on the way up and clears it on the way down); the rules apply strictly above `thresholdPoints`; a level opts in through `gauges.fatigue.microSleepDef`, with no draw and no event otherwise.
- ✅ **Micro-sleeps.** One pre-created instance, planned last with `anchorId: 'papa'` and `firstWaveIndex: -1`, standing on Papa at every step; due `microSleepMinMs…MaxMs` after the crossing and after each telegraph; waits while the instance is not idle, Papa is busy or the flow is not `playing`. Never counts against `maxSimultaneous`, never drawn by the director, never locked on by the baby. A press does not glide Papa; a miss is the `papa_asleep` gag (a 3 s nap, no `NearMiss`).
- ✅ **Coffee and busy.** `TapObject` on a `coffee_machine` walks Papa there; on arrival `drink` for `coffeeDurationMs`, then `−coffeeReductionPoints` (held at 0) and `CoffeeDrunk`. `drink` and `asleep` ignore every move and press (`Release` passes); falling asleep cancels a coffee. The arrival action is a `Record<ObjectKind, …>`.
- ✅ **Content and checks.** `target` on every threat def, `gauges` and object `kind` on the level, three feel keys, `papa_microsleep.json`; `content:check` and `createSim` refuse, in the same words, a micro-sleep def with no file or with another target, a wave threat with `target: "papa"` and an object kind without an action. `Sim.objects` replaces the client's copy (`contextObjectsOf` is gone).
- ✅ **Client.** `pickObject` and the touch tap on an object (threat > object > floor, with a slot noted for the baby); the busy gate; the `hud-gauge` pill (`gaugesHud.ts`: ten-segment mask, one scaled fill, idle / warn / changing classes, pulse at 1 Hz, reduced motion), written through `hudBatch`; the micro-sleep marker follows Papa's drawn pose; Papa's eyelids, « Z » and mug are drawn from the world every frame (no overlay).
- ✅ **Bots and CLI.** No bot code: the micro-sleep def is in `LevelContent.threats`. `tests/tools/sim/microSleep.test.ts` plays the live `salon_crawler` with the idle bot over 5 seeds (every bound read from the live feel) and the perfect bot on an exhausted Papa. `simReport` ignores `waveIndex: -1` in the wave tallies and the active count, and gains `microSleeps`, `coffees` and `asleepRuns`.
- ✅ **Goldens, schemas, audio, screenshots** regenerated deliberately (see the Debug Log) and committed with the code.
- **Not verified here:** nothing on a real phone (the pulse rate, the dimming and the 1.5 s « changing » hold are assumptions; see Open points 2 and 4 and `deferred-work.md`).

### File List

**Content and schemas**
- `content/threats/papa_microsleep.json` (new); `content/threats/{outlet,stairs,coffee_table_object}.json`; `content/levels/salon_crawler.json`; `content/feel.json`; `content/feedback.json`; `content/strings.fr.json`; `content/_schemas/{feel,level,threat}.schema.json`
- `src/content/schemas/{threat,level,feel}.ts`; `src/content/loadLevelContent.ts`; `tools/content/contentChecks.ts`

**Sim**
- New: `src/sim/gauges/{fatigue,fatigueSystem,gaugesSystem}.ts` (+ `fatigue.test.ts`, `gaugesSystem.test.ts`); `src/sim/papa/{coffee,sleep}.ts` (+ tests)
- Updated: `src/sim/{world,context,createSim,snapshot,step,events,commands,index}.ts`; `src/sim/papa/{papaFsm,papaSystem,glide}.ts`; `src/sim/threats/{threatFsm,threatSystem,gags}.ts`; `src/sim/director/directorSystem.ts`; `src/sim/baby/babySystem.ts`; `src/shared/constants.ts`
- Tests updated: `src/sim/{createSim,snapshot,step,commands,events}.test.ts`; `src/sim/papa/{papaSystem,glide,walk}.test.ts`; `src/sim/threats/{threatFsm,threatSystem,gags}.test.ts`; `src/sim/director/directorSystem.test.ts`; `src/sim/baby/babySystem.test.ts`

**Client**
- New: `src/client/ui/hud/gaugesHud.ts` (+ test)
- Updated: `src/client/boot.ts`; `src/client/app/{levelSession,threatsSwitch}.ts`; `src/client/input/{hitTest,inputMapper,contextObject}.ts`; `src/client/render/{levelScene,gags}.ts`; `src/client/render/views/papaView.ts`; `src/client/ui/hud/hudLayer.ts`; `src/client/ui/world/{threatMarkers,worldUi}.ts`; `src/client/ui/styles/ui.css`
- Tests updated: `src/client/app/{levelSession,threatsSwitch}.test.ts`; `src/client/feedback/threatFeedback.test.ts`; `src/client/input/{hitTest,inputMapper,contextObject}.test.ts`; `src/client/loop.test.ts`; `src/client/render/levelScene.test.ts`; `src/client/render/views/papaView.test.ts`; `src/client/ui/hud/hudLayer.test.ts`; `src/client/ui/world/{threatMarkers,glyphChip,worldUi}.test.ts`

**Audio, bots, CLI, tests, e2e**
- `tools/audio/makePlaceholderAudio.ts`; `public/assets/audio/{tel_papa_microsleep,gag_papa_asleep}.m4a` (new); `tests/tools/audio/makePlaceholderAudio.test.ts`
- `tools/sim/simReport.ts`; `tests/tools/sim/{simReport,microSleep}.test.ts` (`microSleep.test.ts` is new)
- `tests/support/{testContent.ts,testFeel.json,testOutlet.threat.json,testStairs.threat.json,testCoffeeTableObject.threat.json,testMicroSleep.threat.json}` (the last is new)
- `tests/threats/threatCatalog.test.ts`; `tests/content/{checkContent,levelSchema,loadLevelContent,threatSchema}.test.ts`
- `tests/e2e/fatigue.spec.ts` (new); `tests/e2e/threats.spec.ts`; `tests/e2e/support/game.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-{chromium,webkit}-{darwin,linux}.png`
- `tests/golden/journals/*.json` (12 files; `worldHash`, `feelHash`, `levelHash` only)

**Docs and status**
- `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml,1-19-fatigue-cafe-et-micro-siestes.md}`; `_bmad-output/project-context.md`

### Change Log

- 2026-10-28: Story 1.19 implemented. Fatigue (0.5/s, strict threshold at 70, windows × 0.8), telegraphed micro-sleeps on Papa with the `papa_asleep` nap, the coffee on a machine tap, the busy state, the touch tap on an object, the gauge pill, Papa's eyelids / « Z » / mug, two placeholder sounds, `SetFatigue`, snapshot version 7, CLI report counts, content checks. Goldens (`worldHash`, `feelHash`, `levelHash` only), JSON Schemas, audio and screenshot references regenerated. Status → review.
