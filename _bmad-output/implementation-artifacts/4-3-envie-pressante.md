---
baseline_commit: 14ab9e2808c9b3a88c611578508ef8fe8ba7cc5d
---

# Story 4.3: The pressing need

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.3 « Envie pressante » (L1861-1882). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want Papa to have to go to the toilet at some point,
so that I have to choose the moment I leave the baby alone.

**Requirements covered:**
- **FR17 `[P2]`:** need from 0 to 100, +0.4/s; at 100, Papa's moves are 30 % slower; toilet = 5 s out of the room, back to 0 (epics L50, GDD L178).
- **UX-DR4:** the gauge goes last in the pill, Bruit · Fatigue · Envie, 10 segments, same fill and idle rules (epics L218, `DESIGN.md` L168, L522-526, `EXPERIENCE.md` L124, L164, L207).

**What this story is not:**
- **No bot goes to the toilet** (the cycle bot is 4.10). No bot walks at 100 either: on `salon_crawler` the gauge ends at 72 (D7).
- **No noise from the flush, no score cost for the absence.** The cost is what happens in the room meanwhile: threats nobody answers. GDD L178 lists nothing else.
- **No sequence framework, no `chambre_night`** (4.4, 4.10). **No final door art** (E7: a greybox door). **No new dependency, no new folder.**
- **No change** to judgement, windows, the combo's rules, `TapBaby` or the glide's speed.

**Sources:**
- Epics `epics.md` L50, L218, L389, L1861-1882, L2039 (`chambre_night` will also have toilets). GDD `gdd.md` L92, L178. Architecture `game-architecture.md` L70, L492, L585.
- UX `DESIGN.md` L158-168, L396-397, L409, L522-526; `EXPERIENCE.md` L124, L164, L207, L375-380.
- Previous stories: `1-19-fatigue-cafe-et-micro-siestes.md` (the model: busy state, level opt-in, HUD slot, the coffee), `1-20-le-telephone-qui-sonne.md` (object action, busy state), `3-1-jauge-de-bruit.md` (debug command, third gauge's neighbour), `4-1-porter-le-bebe-bras-bebe.md` (Blender pipeline for a node, keyboard rule for a carried baby), `4-2-combo-a-encaisser.md` (badge above Papa, feel key names, review lessons).

## Acceptance Criteria

Numbers in `content/feel.json` are live starting values for Geo to tune. Tests use the frozen `tests/support/testFeel.json`, never the live file.

### Content

1. **`feel.bladder`** (`src/content/schemas/feel.ts`, beside `FatigueSchema`, then `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`; run `npm run content:schemas`). Every key has a `.describe()`:
   - `startPct` (0), `perSec` (0.4), `slowFromPct` (100), `slowdownPct` (30, strictly below 100: Papa must always arrive), `urgentFromPct` (70: the door's marker turns warm, D6), `toiletDurationMs` (5000).
   - Pin the section in `src/debug/feelControls.test.ts`, as 4.1 and 4.2 did. `tests/content/feelSchema.test.ts › feel unit suffixes` must pass unchanged.

2. **Level.** `src/content/schemas/level.ts`: `LevelGaugesSchema` gains `need: z.strictObject({})` (the key is `need` because `boot.ts` L701 filters `GAUGE_IDS` with `id in gauges`), `OBJECT_KINDS` gains `'toilet'`; update the two header comments. `content/levels/salon_crawler.json`: `"need": {}` in `gauges`, `{ "id": "toilet", "kind": "toilet", "anchor": "toilet" }` in `objects`. `content:check` (`tools/content/contentChecks.ts` L820) refuses, with a failing test each:
   - a `toilet` object in a level without `gauges.need` (same message shape as the coffee machine's);
   - a `toilet` object whose anchor's floor point is inside a `hidden` zone of the geometry: Papa stands there while out of the room, and `silence.ts` L119 would « find » the baby from there.

3. **The room.** In `assets-src/blender/salon_crawler.blend`, through the pipeline of stories 1.6 / 1.15 / 4.1 (Blender MCP if connected, else `/Applications/Blender.app -b … -P` with a throw-away script; **never edit a generated JSON by hand**; if Blender cannot run, stop and tell Geo):
   - `ANCHOR_toilet` at about game `[-2.2, 1.0, -2.85]`, on the back wall between the counter and `behind_sofa`. The `y` is where the marker and the touch hit test aim; Papa walks to its floor point. Move it if a screenshot shows the door hidden or the walk ending somewhere odd; it stays outside `behind_sofa`.
   - An unprefixed `toilet_door` mesh on the wall (a flat greybox door): **no `COL_*`, no `NAV_block_*`, so the nav grid does not change.** The bots' equality in AC 15 depends on it.
   - Then `npm run assets:export`, `assets:extract`, `assets:optimize`. The diff of `salon_crawler.geometry.json` is **one new anchor and nothing else**. Copy it to `tests/support/testLevel.geometry.json` byte for byte (`cmp`).
   - `toilet` is **not** added to `REQUIRED_ANCHOR_IDS` (a level has toilets only if it declares them, like the playpen's zone), so `levelNodeNames.test.ts` keeps its 8 and `export_level.py` its tuple.

4. **Cues, clips, strings.**
   - `content/feedback.json` `cues` and `events`: `BladderFilled → bladder_full`, `ToiletStarted → toilet_entered`, `ToiletFinished → toilet_flushed`, `ToiletRefused → toilet_refused`. Each has `audio`, a `soundWave` anchored on `papa` (never `object`, which `contentChecks` refuses on an `events` cue) and a `haptic`: `light` for `toilet_entered` and `toilet_refused`, `medium` for the other two. `toilet_refused` reuses the clip `papa_bump`.
   - `feedback.json` gains `papaHint: { holdMs: 1200 }` (real ms; schema next to `comboBadge`).
   - Three placeholder clips in `tools/audio/makePlaceholderAudio.ts`, each with its own next free `SEED + n`: `papa_bladder_full`, `papa_toilet_door`, `env_toilet_flush`. Run `npm run assets:audio` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB).
   - **No new string:** `gauge.urge` (« Envie ») and `verb.put_down_first` (« POSE-LE D'ABORD ! ») exist.

### The sim

5. **Types.**
   - `GaugesSlice` (`world.ts` L276): `bladderPct: number`, `isBladderFull: boolean`. `createWorld` gets the start value as `fatiguePoints` does (`createSim.ts` L503: `feel.bladder.startPct`, or 0 in a level without the gauge).
   - `SimLevel.hasBladder` (`context.ts`, `createSim.ts` L338, `gauges.need !== undefined`).
   - `PapaState` and `PAPA_STATES` gain `'onToilet'`; `isPapaBusy` returns true for it. That one line gives the rest of the busy rule: `runPapa` and `runThreats` ignore his commands, no micro-sleep or arms cry is telegraphed, `isBabyTapped` is false, and `inputMapper` sends nothing (L182).
   - Commands (`commands.ts` L28, L81, L155): `SetBladder{t, pct}`, the debug twin of `SetNoise`, with the same validation.
   - Events (`events.ts`, sorted into `SIM_EVENT_TYPES`): `BladderFilled{t}`, `ToiletStarted{t, objectId, untilAt}`, `ToiletFinished{t}`, `ToiletRefused{t, objectId}`.

6. **`src/sim/gauges/bladder.ts`** (allocation-free, no `nextFloat`, the only writer of `world.gauges.bladderPct`):
   - `addBladder(world, ctx, pct)`: no-op without `ctx.level.hasBladder` (nothing written, no event). Clamps silently to `[0, 100]`. `isBladderFull` is `bladderPct >= slowFromPct`; a change of it is recorded, and only the upward one emits `BladderFilled` (once per crossing).
   - `runBladder(world, ctx)`, called by `runGauges` after `runNoise`: adds `(perSec × STEP_MS) / MS_PER_S`, **except while Papa is `onToilet`** (the gauge is frozen until the end). It keeps rising during a coffee, a nap or a call. `SetBladder` is applied last in `runGauges`, beside `SetNoise` (the commanded value is the step's final one).
   - `bladderSpeedFactor(world, ctx)`: `1 - slowdownPct / 100` while `isBladderFull`, else 1. A pure reader.

7. **The slowdown.** `runPapa` (L270): `budgetM` is multiplied by `bladderSpeedFactor`, for `walkPath` and `walkDir` only. **The glide keeps its speed** (D3). It reads the value of the previous step's `runGauges`, as the fatigue's window does. A level without the gauge has a factor of exactly 1, so every existing walk stays bit-identical.

8. **The toilet** (`src/sim/papa/toilet.ts`, modelled on `coffee.ts`):
   - `startToilet(world, ctx, objectId)`: `objectId` and `intent` cleared, `busyUntil = now + toiletDurationMs`, `enterPapaState('onToilet')`, `ToiletStarted`.
   - `finishToilet(world, ctx)`: `addBladder(world, ctx, -world.gauges.bladderPct)`, `busyUntil = 0`, `ToiletFinished`, then idle. The gauge drops **at the end**, like the coffee (D2). `runBladder` runs later in that step, so the value at the end of the step is one step's gain: tests use `toBeCloseTo` or read it on the event's step, and say so.
   - `OBJECT_ACTIONS.toilet` (`papaSystem.ts` L59) calls `startToilet` and returns true. `runPapa` L248 calls `finishToilet` for `onToilet`, next to `finishCoffee`.
   - `putPapaToSleep` (`sleep.ts` L17): a toilet whose time is up this very step is finished first, exactly as the coffee. Otherwise a nap replaces `onToilet`: no `ToiletFinished`, no reset, Papa is back in the room, asleep (D5).
   - Papa's point stays at the end of the walk: he comes back where he left.

9. **Carrying** (`tapObject`, `papaSystem.ts`). A `TapObject` on a `toilet` with the baby carried: **Papa does nothing** (no path, his current walk goes on, `objectId` and `intent` unchanged) and the sim emits `ToiletRefused{objectId}`; no `ObjectTapped`. A baby cannot be taken during a walk to the toilet without cancelling it (`takeBaby` → `stopPapa`), so arriving carried cannot happen: `carryFuzz.test.ts` asserts `onToilet` never coexists with `carried`, and the snapshot refuses it. A `TapBaby` in the same step keeps its command order.

10. **While Papa is away, the room goes on.** No new rule, pinned by tests: the director keeps drawing; a threat that opens ends in its `late` gag, which resets the combo; the baby wanders; a silence can start and time out; a ringing phone times out; fatigue and noise keep moving. A `TapBaby` finds no baby and takes no baby.

11. **Snapshot v17** (`snapshot.ts` L40, L59, L880, history comment). `gaugesProblem` L331: `bladderPct` finite in `[0, 100]` and exactly 0 without the gauge; `isBladderFull` a boolean, false without the gauge; **not** checked against `feel.bladder` (a `SetFeel` can move the threshold). `busyUntil` needs nothing (`isPapaBusy`). New: `onToilet` with the baby `carried` is a problem. Fixtures and a round-trip of a Papa mid-toilet with a full gauge.

### The client

12. **The HUD.** `boot.ts`: `gaugesHud.setValue('need', …)` at level start (L703-707) and through `hudBatch` per frame (L782-785, `gaugeSlotOf('need')`). The pill, the icon `#i-envie` and the string already exist: `gaugesHud.ts` needs **no change**. Check on a 667 × 375 screenshot that three gauges do not touch the timer, and that `tests/e2e/fatigue.spec.ts` L132 still holds `HUD_MAX_DOM_NODES` (40). If either fails, stop and tell Geo: do not raise the limit or shrink the bars on your own.

13. **The door's marker** (`ui/world/objectMarkers.ts`, `worldUi.ts`, `boot.ts`).
    - `OBJECT_ICON_PATHS.toilet`: a provisional door glyph (24 × 24).
    - **Trap:** `update(isUrgent)` L122 today writes the same class on every marker, driven by the fatigue (`boot.ts` L808). With a second glyph the door would pulse for a tired Papa. It becomes `update(isCoffeeUrgent, isToiletUrgent, isToiletOccupied)`, one state per marker by its kind, no allocation, DOM written only on change; `worldUi.updateObjects` follows. Coffee: `isFatigueAbove`, as today. Door: `bladderPct >= feel.bladder.urgentFromPct`.
    - While Papa is `onToilet`, the door has the class `pp-object-occupied` (no pulse, tokens only).

14. **Papa out of the room.**
    - `papaView.setAway(isAway)`, called in `levelScene.update` beside `setOnPhone` (L360): the whole of Papa, **blob shadow included**, is hidden while `onToilet`, and shown again on the next frame after it.
    - `boot.ts`: `updateCombo` gets a null pose while `onToilet`; check that `comboBadge` then hides, or add the guard: a badge floating at an empty door is a bug. A restart shows Papa.
    - A threat on Papa that is already up (a micro-sleep) keeps its marker at his point.

15. **« POSE-LE D'ABORD ! ».**
    - New `src/client/ui/world/papaHint.ts`, `createPapaHint(scene, doc)`, built like `tapMarker.ts` and `comboBadge.ts`: one pooled `CSS2DObject`, `.pp-threat-verb` look, tokens only, `aria-hidden`, `pointer-events: none`. On `ToiletRefused` it shows `t('verb.put_down_first')` above Papa for `feedback.papaHint.holdMs` of real time. A second refusal restarts it. Text from `t`, written once.
    - **It must clear the combo badge:** carrying climbs the combo, so the badge is usually up in that very spot. Give the hint its own offset above the badge, and look at it in a screenshot with x3 up.
    - Wired in `worldUi` and counted in the « anything visible? » test of `render`, or it never draws alone. Its scene position shifts the indices in `worldUi.test.ts` (4.2 hit this).
    - `inputMapper.handlePointerDown` (about L424): no tap marker for a `toilet` while the baby is carried (Papa is not going anywhere). The command is still sent: the refusal is the sim's.

16. **Keyboard and gamepad** (`inputMapper.act`, L275). Today an object in reach beats a carried baby, so Space beside the door would refuse forever and the player could not put the baby down there (a dead end). So: **a `toilet` does not count as an object in reach while the baby is carried**: Space / A puts him down, a second press goes to the toilet. Coffee and phone keep today's rule. `ObjectTarget` (`client/input/hitTest.ts` L32) has no `kind` today: add it (`Sim.objects` already holds it), and use it here and in AC 15. The baby lands `putDownOffsetM` ahead of Papa, possibly nearer than the door, and today's « nearer wins » would make the second press take him back, forever. So **a `toilet` in reach also beats a free baby**, whatever the distances: put down, then in, always in two presses. To take a baby beside the door, the player taps him or steps away. Unit tests for each case. A pointer tap is what shows the verb (D4).

17. **Mirrors** (dev and `?debug=1`, on events, never per frame, in the clearing list at level start): `data-pp-bladder` = rounded `bladderPct` at level start, on `BladderFilled`, `ToiletStarted`, `ToiletFinished`, removed in a level without the gauge (like `mirrorNoise`). `data-pp-papa-state` already follows the state.

### Tools and tests

18. **Report** (`tools/sim/simReport.ts` L61, L275, `simArgs.ts` `--help`, `tests/tools/sim/simReport.test.ts`): `toiletVisits` (`ToiletFinished`) and `bladderPeakPct`, per run and in the aggregate.

19. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `gauges/bladder.test.ts`: +0.4/s exact over a known span; clamp at 100 with one `BladderFilled` and no second; no-op and no event without `gauges.need`; frozen while `onToilet`, rising during a coffee; `slowFromPct` lowered by `SetFeel`; `SetBladder` wins the step; no rng consumed anywhere.
    - `papa/toilet.test.ts`: walk, arrive, `ToiletStarted`, exactly `toiletDurationMs` later `ToiletFinished` and 0; every command ignored meanwhile; a threat opening meanwhile gags `late` and resets the combo; a press at `busyUntil` is judged (same step rule as the coffee); nap replaces it with no reset; nap in the very step it ends finishes it first; refused while carried (no path, walk unchanged, event); put down, then accepted.
    - `papa/papaSystem.test.ts` or `walk.test.ts`: at 100 a `walkPath` and a `walkDir` cover 70 % of the distance; a glide's duration is unchanged; below 100 the distance is unchanged.
    - `snapshot.test.ts` (v17 and each rejected field), `events.test.ts`, `commands.test.ts`, `gaugesSystem.test.ts`, `carryFuzz.test.ts` (with toilet visits), `feelSchema.test.ts`, `levelSchema` / `checkContent` tests of AC 2.
    - Client: `objectMarkers.test.ts` (door not urgent while tired, coffee not urgent while bursting, occupied, no write when unchanged), `papaHint.test.ts`, `papaView.test.ts` (shadow too), `inputMapper.test.ts` (AC 15, 16), `simEventFeedback` routing, `worldUi.test.ts`.
    - `src/sim` coverage stays at or above 90 %.

20. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: for **all four bots**, stars, end reasons, success rate, score and gags are identical (no rng, no nav change, the gauge never reaches 100, D7). Only hashes move. **Paste both summaries in a table**, as 4.2's review required. `toiletVisits` is 0 and `bladderPeakPct` about 72.
    - `npm run golden:update`, then diff, then `biome format` the JSON: every existing journal moves only in its hashes. Anything else is a bug, stop.
    - New scenario `toilet_visit` (`tests/golden/scenarios.ts`, a test file like `comboCashIn.test.ts`), with a short `toiletDurationMs` allowed by feel: `SetBladder{100}`, a slowed walk to the door, the visit, a threat missed meanwhile, the return at 0. Use `STEP_MS` from `@shared/constants`.

21. **End to end** (`tests/e2e/toilet.spec.ts`, chromium + webkit, `ppSend` / `ppAdvance` like `carry.spec.ts`, values read from the live content, `objectIconPoint` from `support/game.ts`):
    - The pill holds three gauges in the order Bruit, Fatigue, Envie; Envie rises.
    - `SetBladder{100}`: `pp-hud-gauge-warn` on Envie, the `bladder_full` cue, and a walk takes longer than at 0.
    - A real tap on the door's icon: walk, `data-pp-papa-state` = `onToilet`, Papa's mesh hidden (through the view's flag or a screenshot), the door occupied, taps do nothing; after `toiletDurationMs`, back to 0, visible, idle.
    - Carrying: a tap on the door shows « POSE-LE D'ABORD ! », no walk, `toilet_refused` in `__PP__.cueLog()`, the verb gone after `holdMs`; after a put-down, the same tap works. In Chromium the vibrations hold the pattern (WebKit has no `navigator.vibrate`).
    - Keyboard: Space beside the door while carrying puts the baby down; again goes in.
    - **Screenshots:** the door and the third gauge move the darwin references of `autoplay.spec.ts`. Regenerate them (`npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`), look at each one, say so in the Completion Notes. Specs pinning the pill or the objects (`fatigue`, `noise`, `autoTarget`, `ui`, `phone`, `silence`, `mamaWoke`, `result`, `timer`) may assert two gauges or a nearest object: update only what the third gauge or the door truly changes.

22. **Docs.**
    - `project-context.md`: add a « The pressing need (story 4.3) » paragraph to the Engine rules (writer, level opt-in, frozen while away, refusal, slowdown not on the glide), add `onToilet` to « Busy Papa », bump « snapshot version 16 » to 17, and add `need` to the `runGauges` sentence.
    - `deferred-work.md`: this story's Open points. In `level.ts`, the comment announcing that epic 4 adds `need` goes.
    - Do not edit the architecture or the GDD.

23. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [x] **T1. Content and room** (AC 1-4)
  - [x] T1.1 `feel.bladder` in the schema and three JSON files, `content:schemas`, debug panel test.
  - [x] T1.2 `need` and `toilet` in the level schema and `salon_crawler.json`; the two `content:check` rules and their tests.
  - [x] T1.3 Blender: `ANCHOR_toilet`, `toilet_door`; export, extract, optimize; check the one-anchor diff; copy and `cmp` the test geometry.
  - [x] T1.4 Cues, `papaHint` feedback section, three placeholder clips (commit only the new `.m4a`).
- [x] **T2. Sim** (AC 5-11)
  - [x] T2.1 Types, `SetBladder`, the events, `hasBladder`, `createWorld`.
  - [x] T2.2 `gauges/bladder.ts`, `runGauges`, the slowdown in `runPapa`.
  - [x] T2.3 `papa/toilet.ts`, the object action, `runPapa` and `sleep.ts`, the refusal.
  - [x] T2.4 Snapshot v17; the sim tests of AC 19; the fuzz test.
- [x] **T3. Client** (AC 12-17)
  - [x] T3.1 HUD slot, screenshot at 667 × 375.
  - [x] T3.2 Per-kind marker state, door glyph, occupied class.
  - [x] T3.3 `setAway`, combo badge while away.
  - [x] T3.4 `papaHint.ts`, `inputMapper` tap marker and keyboard rule, mirrors.
- [x] **T4. Tools and tests** (AC 18, 20, 21)
  - [x] T4.1 Report; the bot comparison with `main`, both summaries pasted.
  - [x] T4.2 Goldens (regenerate, diff, add `toilet_visit`).
  - [x] T4.3 `tests/e2e/toilet.spec.ts`; touched specs; screenshot references.
- [x] **T5. Docs and CI** (AC 22, 23)

## Dev Notes

### Decisions (D1-D7)

- **D1. Three names, one gauge.** `need` is the HUD and level id (`GAUGE_IDS`, already there), `gauge.urge` the existing string, `bladder` the sim (the epic names `src/sim/gauges/bladder.ts`). Do not rename the first two: the HUD, its test and the strings already use them.
- **D2. The gauge falls at the end of the 5 s, and is frozen meanwhile.** Same as the coffee (« the fatigue only drops at the end »). So a visit that is cut short relieves nothing, and the return is the visible moment. The epic's sentence fits either order.
- **D3. The glide is not slowed.** « Déplacements » means walking. The glide is choreography, capped by `glideMaxMs`, and the result is known at the press (P3, D11 of 1.11): slowing it would add no difficulty, only a late animation. The cost of 100 is crossing the room on foot to the door, and to the coffee.
- **D4. Refused at the tap, by the sim.** Walking all the way to be told no would be a pointless trip with a heavy baby. The sim decides because it owns the truth (a tap in flight, a journal, a replay); the client only shows it. Keyboard and gamepad take the put-down instead (AC 16), because for them the same key does both.
- **D5. A nap beats the toilet,** as it beats the coffee and the call (`putPapaToSleep`). It only happens with a micro-sleep already up when he went in. It is harsh, and consistent. Open point 2.
- **D6. The door warms at `urgentFromPct` (70),** the same point the HUD turns orange, so that the player learns where the remedy is before it costs anything. That is the only hint in the room; no pop-up, no verb.
- **D7. The GDD's value leaves the living room below the slowdown.** 0.4/s over `salon_crawler`'s 180 s is **72 points**: the gauge turns orange at about 175 s and the slowdown never happens in a normal game. The value is kept (`perSec` 0.4, `startPct` 0): changing it is Geo's call, and `feelOverrides` can do it per level without code. This story's slowdown is therefore tested through `SetBladder`, and is first felt in `chambre_night` (4.10), unless Geo tunes the salon. Open point 1.

### Current state of the files this story changes (read before editing)

- **`src/sim/papa/papaSystem.ts`.** `OBJECT_ACTIONS` L59 is a `Record<ObjectKind, …>`: the new kind does not compile until it has its action, and `OBJECT_ACTION_KINDS` feeds `content:check`. `tapObject` plans a walk, sets `objectId`, emits `ObjectTapped`: the refusal goes before the plan. `arrive` runs the action. L247-254 ends a busy state: only `drink` has something to finish today. L270: one `budgetM` for `walkPath` and `walkDir`; the glide has its own speed (L274).
- **`src/sim/papa/{coffee,phoneCall,sleep}.ts`, `papaFsm.ts`.** The three models. `sleep.ts` L17 is the « finished this very step » rule to mirror.
- **`src/sim/gauges/gaugesSystem.ts`.** Order: `SetFatigue`, `runFatigue`, `runNoise`, `SetNoise`. Becomes: `SetFatigue`, `runFatigue`, `runNoise`, `runBladder`, `SetNoise`, `SetBladder`. Do not add a system: `SYSTEMS` and `step.test.ts` stay as they are.
- **`src/sim/threats/threatSystem.ts` L75, `baby/silence.ts` L30, `baby/carry.ts` L139, `gauges/fatigueSystem.ts` L39, `client/input/inputMapper.ts` L182, `client/boot.ts` L979** all go through `isPapaBusy`: they need no edit. Their comments list the states; fix those that become untrue. `silence.ts` L119 and `directorSystem.ts` L100, L128 read Papa's point, hence the content rule of AC 2.
- **`src/sim/world.ts`** L276, L450; **`snapshot.ts`** L33-40, L59, L128 (busy check, automatic), L331, L440 (`onPhoneProblem`, the model for the carried check), L880.
- **`src/client/ui/hud/gaugesHud.ts`:** complete for `need`, leave it. **`objectMarkers.ts`:** AC 13. **`worldUi.ts`** L58. **`comboBadge.ts`, `tapMarker.ts`:** the patterns for the hint. **`threatMarkers.ts`** L132: where `verb.put_down_first` is used today; do not touch it.
- **`src/client/render/views/papaView.ts`** L88-90, L232-236; **`levelScene.ts`** L359-360.
- **`tools/content/contentChecks.ts`** L820. **`tools/audio/makePlaceholderAudio.ts`:** the highest seed today is `SEED + 10`; take the next free ones.
- **Must not change:** `SYSTEMS`, judgement, windows, the combo's rules, `TapBaby`'s rules, rng draw counts, the nav grid, the four rows of the note. `COMMAND_TYPES` only gains `SetBladder`, so old journals still replay.

### Architecture compliance

- Pure sim, serialisable `World`; no rng in this story; state through `enterPapaState`; no real time, no log; events past tense with `t`.
- Units: `bladderPct`, `perSec`, `slowFromPct`, `slowdownPct`, `urgentFromPct`, `toiletDurationMs`, `holdMs` (real, client only), `untilAt`. Booleans `is…`/`has…`. Numbers in `feel.json`, the hold in `feedback.json`. No literal UI text.
- Client imports `@sim` only: `isPapaBusy` and `PAPA_STATES` are exported; add what is missing to `src/sim/index.ts`. `tokens.css` is not changed. Every cue with `audio` has `visual` and `haptic`. Zero allocation per frame in markers, hint, view and `runBladder`.
- `src/sim/gauges/` and `src/sim/papa/` are the architecture's folders (L492, L585); `ui/world/papaHint.ts` is new in an existing folder.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned (Three r186 `CSS2DObject`, Zod 4, Vitest 5, Playwright 1.64, Blender 5.2), so no web research was needed.

### File structure

New: `src/sim/gauges/bladder.ts`, `bladder.test.ts`; `src/sim/papa/toilet.ts`, `toilet.test.ts`; `src/client/ui/world/papaHint.ts`, `papaHint.test.ts`; `public/assets/audio/{papa_bladder_full,papa_toilet_door,env_toilet_flush}.m4a`; `tests/e2e/toilet.spec.ts`; `tests/golden/toiletVisit.test.ts` with `tests/golden/journals/toilet_visit*.json`.

Updated: `assets-src/blender/salon_crawler.blend`, `public/assets/levels/salon_crawler.glb`; `src/content/schemas/{feel,feedback,level}.ts`, `content/{feel,feedback}.json`, `content/levels/salon_crawler{,.geometry}.json`, `content/_schemas/*` (generated); `src/sim/{world,events,commands,snapshot,context,createSim,index}.ts`, `gauges/gaugesSystem.ts`, `papa/{papaFsm,papaSystem,sleep}.ts`; `src/client/boot.ts`, `input/inputMapper.ts`, `render/levelScene.ts`, `render/views/papaView.ts`, `ui/world/{objectMarkers,worldUi}.ts`, `ui/styles/ui.css`; `tools/{audio/makePlaceholderAudio.ts,content/contentChecks.ts,sim/{simReport,simArgs}.ts}`; tests next to each, `tests/support/{testFeel.json,testLevel.geometry.json,testContent.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/golden/*`, darwin screenshots; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ gauges: { need: {} }, objects: … })` and `stepN`. Add a toilet to the test helpers as an option: `TEST_OBJECTS` stays as it is, or every test level gains a door.
- Run `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/toilet.spec.ts tests/e2e/fatigue.spec.ts tests/e2e/carry.spec.ts tests/e2e/ui.spec.ts tests/e2e/autoTarget.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.

### Previous story intelligence (4.1, 4.2)

- 4.2 renamed feel keys that lacked a unit suffix: use the names of AC 1, which pass the test. Its `worldUi.test.ts` indices shifted with a new element in the scene: expect the same.
- 4.2's review asked for: both main-vs-branch summaries pasted (not « 0 differences »), every `gagThreat` path pinned where the AC names it, no stale comments on events and systems, a transient animation cancelled when replaced (the hint restarting). 4.1's review: stale sentences in `project-context.md`.
- 4.1: a node added to the `.blend` goes through the pipeline, and the test geometry is re-copied byte for byte. Keyboard rule for the carried baby is at `inputMapper` L275-276: read its comment before changing it.
- 3.x reviews: one `SEED + n` per placeholder clip, no hard-coded `STEP_MS` in tests, no comment claiming more than the test asserts.
- Golden regeneration: diff every `*.expected.json`, then `biome format` the JSON. A 5 s test timeout under load is known: rerun with `VITEST_MAX_WORKERS=5` and say so.

### Git intelligence

Recent commits are stories 4.1 and 4.2, both merged into `main`; this branch is cut from `97ffa0a`. Commit convention: « Story 4.3 : <titre> », « Story 4.3 : corrections de la revue de code ». `main` only receives the merge after Geo's OK.

### Project Structure Notes

Paths follow the epic and the architecture. Variances: the id `need` against the file `bladder.ts` (D1), and no new system (`runBladder` is a helper called by `runGauges`, like `runFatigue` and `runNoise`).

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes: every number is data.
- Layer rules; the sim never logs; no `Math.random`, `Date`, `performance`, `setTimeout` in `src/sim`.
- Systems never call each other; helpers are fine. `SYSTEMS` does not change.
- UI: `t(key)` only, tokens only, `pp-` classes; reduced motion is client-only and never changes sim timing.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **In the salon, the slowdown never comes (D7).** 72 points at the end of 180 s. If you want to feel it there, a `feelOverrides` with `bladder.startPct` around 40 does it with no code, but it changes the `random` bot's walks.
2. **A nap in the toilet cuts the visit with no relief (D5).** Say if you prefer the gauge to fall anyway.
3. **Nothing shows the 5 s running out** except the occupied door. A ring on the door is cheap if the wait feels blind.
4. **Fatigue keeps rising in the toilet, and the flush makes no noise.** Both are simply what the GDD leaves unsaid. A flush that feeds the Bruit gauge in a Sieste level would be a good gag.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L50, L218, L389, L1861-1882, L2039]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L92, L178]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L70, L492, L585]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L158-168, L396-397, L409, L522-526; EXPERIENCE.md L124, L164, L207, L375-380]
- [Source: _bmad-output/project-context.md (Engine rules: Busy Papa, Carrying the baby, The combo; Feedback; Testing)]
- [Source: _bmad-output/implementation-artifacts/1-19-fatigue-cafe-et-micro-siestes.md; 1-20-le-telephone-qui-sonne.md; 3-1-jauge-de-bruit.md; 4-1-porter-le-bebe-bras-bebe.md; 4-2-combo-a-encaisser.md]
- [Source: src/sim/papa/{papaSystem,papaFsm,coffee,phoneCall,sleep}.ts, gauges/{gaugesSystem,fatigue,fatigueSystem}.ts, baby/{carry,silence}.ts, threats/threatSystem.ts, world.ts, snapshot.ts; src/client/boot.ts, input/inputMapper.ts, ui/hud/gaugesHud.ts, ui/world/{objectMarkers,comboBadge,tapMarker}.ts, render/{levelScene.ts,views/papaView.ts}; tools/content/contentChecks.ts; content/levels/salon_crawler{,.geometry}.json]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Debug Log References

- **HALT on AC 12 (T3.1), 2026-10-30 (resolved the same day: Geo chose to move the timer aside, see the Completion Notes).** Measured with Playwright on the live level, Chromium, surface `compact`: the gauges pill is `left 12 → right 316` at every width (three gauges of 60 px + icons), the timer is centred. At 667 × 375 the timer's left edge is at 278: **the pill overlaps the timer by 38 px** (Envie's bar runs under the clock icon); at 740 × 360 by 2 px; at 812 × 375 there is a 34 px gap and at 844 × 390 (the e2e viewport, iPhone 12) 50 px. `HUD_MAX_DOM_NODES` (40) holds (`toilet.spec.ts` asserts it). The story forbids raising the limit or shrinking the bars on my own: stopped and asked Geo. Everything else was done and green at that point; T3.1's screenshot, the darwin screenshot references (`autoplay.spec.ts`), the specs pinning the pill, the docs (T5) and the full `npm run ci` waited for that decision, because the layout changes the screenshots.
- Screenshot look at 667 × 375 with a cry in the arms up: « POSE-LE D'ABORD ! » clears the combo badge (it sits 0.85 m above his head, the badge 0.3 m, and the badge steps aside while a threat on Papa is up) but it overlaps the verb « BERCE ! » and the cry's icon in that one case. Seen in `toilet.spec.ts`: not asserted (open point).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **HUD pill (AC 12), decided by Geo.** At 667 × 375 three gauges ran 38 px under the timer (2 px at 740 × 360; none from 812). Geo chose to move the timer: the HUD row's left column is `minmax(max-content, 1fr)` (+ an 8 px column gap), so the timer stays centred when it fits and sits right of the pill otherwise. Bars and `HUD_MAX_DOM_NODES` untouched; `toilet.spec.ts` pins four viewports and the node budget. Seen in a 667 × 375 screenshot after the fix.
- **Blender.** `ANCHOR_toilet` at Blender (-2.2, 2.85, 1.0) = game `[-2.2, 1, -2.85]` and a flat `toilet_door` slab (0.9 × 0.06 × 2.0, material of `door_frame`) on the back wall, added with a throw-away headless script (`/Applications/Blender.app -b … -P`); no `COL_`/`NAV_`, the nav grid is unchanged. `assets:export/extract/optimize`: the geometry diff is one anchor. The walk ends at (-2.125, -2.625), outside `behind_sofa`.
- **Sim and client as specified.** `bladder.ts` (writer, rise, factor), `toilet.ts`, `OBJECT_ACTIONS.toilet`, `sleep.ts`, snapshot v17, `SetBladder`, four events, report fields, `data-pp-bladder`. Client: per-kind object states (`update(isCoffeeUrgent, isToiletUrgent, isToiletOccupied)`), `papaView.setAway`, `comboBadge` hides without a pose, `papaHint.ts` (own offset `PAPA_HINT_OFFSET_M`), `ObjectTarget.kind`, the Space / A rules (a toilet is no object in reach while carrying, and beats a free baby). Tests: `bladder`, `toilet`, slowdown in `papaSystem.test.ts`, snapshot, fuzz with visits (200 seeds), report, content checks, client unit tests, `toilet.spec.ts` (7 tests, Chromium + WebKit), the golden `toilet_visit`.
- **Screenshots (deliberate).** `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`: the two darwin references (chromium, webkit) now hold the third gauge and the door's marker; looked at both (the first threat's verb « SOULÈVE ! » over the coffee icon was already there). `fatigue.spec.ts` and `noise.spec.ts` assert three gauges and two object icons now; nothing else needed a change (`autoTarget`, `ui`, `phone`, `silence`, `mamaWoke`, `result`, `timer`, `testApi`, `carry`, `feedback` pass unchanged).
- **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` was green at the second run. The first run failed only on `makePlaceholderAudio.test.ts › is deterministic` (5 s timeout under coverage and load; 1.5 s alone), so the second ran with `VITEST_MAX_WORKERS=5`, as the story's notes say. Coverage thresholds, `dist:check` (both flavours) and `e2e:dist` (incl. `perf.spec.ts`) passed.
- No new dependency. No `SYSTEMS` change. Open points are in `deferred-work.md`.
- **Bots, `main` against the branch** (`npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`). Stars, end reasons, success rate, score and gags are identical for the four bots, run by run (every field of `runList` but `worldHash`); only the world hashes move (the world holds two new fields, and the geometry and feel hashes changed). Deliberate.

  | bot | tree | mean stars | star counts (0-5) | ends | success % | mean score | gags | micro-sleeps | toilet visits | need peak % |
  |---|---|---|---|---|---|---|---|---|---|---|
  | perfect | main | 5 | 0,0,0,0,0,20 | timer 20 | 100 | 90 | 0 | 65 | n/a | n/a |
  | perfect | branch | 5 | 0,0,0,0,0,20 | timer 20 | 100 | 90 | 0 | 65 | 0 | 72 |
  | human | main | 4 | 0,0,0,1,18,1 | timer 20 | 99.9 | 82.1 | 1 | 62 | n/a | n/a |
  | human | branch | 4 | 0,0,0,1,18,1 | timer 20 | 99.9 | 82.1 | 1 | 62 | 0 | 72 |
  | random | main | 1 | 0,20,0,0,0,0 | timer 20 | 2.2 | 20.3 | 759 | 64 | n/a | n/a |
  | random | branch | 1 | 0,20,0,0,0,0 | timer 20 | 2.2 | 20.3 | 759 | 64 | 0 | 72 |
  | idle | main | 1 | 0,20,0,0,0,0 | timer 20 | 0 | 20 | 762 | 64 | n/a | n/a |
  | idle | branch | 1 | 0,20,0,0,0,0 | timer 20 | 0 | 20 | 762 | 64 | 0 | 72 |

- **Goldens (deliberate).** `npm run golden:update`: each of the 11 existing journals moves only in `geometryHash`, `feelHash` (both of the fixtures) and `worldHash`; no event moved (`*.expected.json` differ by one line, the world hash). New scenario `toilet_visit` (+ `toiletVisit.test.ts`).

### File List

New:
- `src/sim/gauges/bladder.ts`, `bladder.test.ts`; `src/sim/papa/toilet.ts`, `toilet.test.ts`
- `src/client/ui/world/papaHint.ts`, `papaHint.test.ts`
- `public/assets/audio/papa_bladder_full.m4a`, `papa_toilet_door.m4a`, `env_toilet_flush.m4a`
- `tests/e2e/toilet.spec.ts`; `tests/golden/toiletVisit.test.ts`; `tests/golden/journals/toilet_visit.json`, `toilet_visit.expected.json`

Updated:
- Room: `assets-src/blender/salon_crawler.blend`, `public/assets/levels/salon_crawler.glb`, `content/levels/salon_crawler.geometry.json` (one anchor), `tests/support/testLevel.geometry.json` (byte copy)
- Content: `src/content/schemas/{feel,feedback,level}.ts`, `content/{feel,feedback}.json`, `content/levels/salon_crawler.json`, `content/_schemas/{feel,feedback,level}.schema.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tools/content/contentChecks.ts`
- Sim: `src/sim/{world,events,commands,snapshot,context,createSim}.ts`, `gauges/{gaugesSystem,fatigueSystem}.ts`, `papa/{papaFsm,papaSystem,sleep}.ts`, `threats/threatSystem.ts` (comment), `src/shared/constants.ts` (`PAPA_HINT_OFFSET_M`)
- Client: `src/client/boot.ts`, `input/{inputMapper,hitTest,contextObject}.ts`, `render/levelScene.ts`, `render/views/papaView.ts`, `ui/world/{objectMarkers,worldUi,comboBadge}.ts`, `ui/styles/ui.css` (door states, hint, the HUD row's left column)
- Tools: `tools/audio/makePlaceholderAudio.ts`, `tools/sim/{simReport,simArgs}.ts`
- Tests: `src/sim/{commands,createSim,events,snapshot}.test.ts`, `gauges/gaugesSystem.test.ts`, `papa/{papaSystem,sleep}.test.ts`, `baby/carryFuzz.test.ts`, `src/client/{feedback/feedbackDirector,feedback/simEventFeedback,input/inputMapper,input/hitTest,input/contextObject,render/views/papaView,ui/world/objectMarkers,ui/world/worldUi,ui/world/comboBadge}.test.ts`, `src/debug/feelControls.test.ts`, `tests/content/{checkContent,levelSchema}.test.ts`, `tests/support/testContent.ts`, `tests/tools/sim/simReport.test.ts`, `tests/golden/scenarios.ts`, the 11 existing journals and their `.expected.json`, `tests/e2e/{fatigue,noise}.spec.ts`, `tests/e2e/support/game.ts`, the two darwin references of `autoplay.spec.ts`
- Docs: `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, this file

### Review Findings

Code review of 2026-10-30 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision_needed, 10 patch (8 from the review, 2 from the full CI), 4 defer, 16 dismissed. The sim (gauge, slowdown on walks only, toilet visit, refusal, nap rule, snapshot v17), the content rules, the geometry diff (one anchor) and the 23 ACs' wiring held up; the findings are one client rule that is narrower than its AC, one invisible glyph detail, a few promises in comments and tests that exceed what the code or the tests do.

- [x] [Review][Patch] The door glyph's knob is invisible: both subpaths of `'M7 3h10v18H7z M13.6 11h1.8v2h-1.8z'` run clockwise, so under the default nonzero fill the knob is swallowed by the door. Reverse the knob (`M13.6 11v2h1.8v-2z`, a hole in the slab) and pin the path string in `objectMarkers.test.ts` [src/client/ui/world/objectMarkers.ts:43]
- [x] [Review][Patch] AC 16 « a `toilet` in reach also beats a free baby, whatever the distances » holds only when the toilet is the nearest object: `isToiletNearest = object?.kind === 'toilet'` looks at the nearest object alone, so with a coffee machine nearer than the door and both in reach, a free baby just put down can win the distance test and be taken back. Test « is a toilet in reach » over all the objects (`ObjectTarget.kind`), and add the unit test (toilet and coffee in reach, coffee nearer, baby free: no `TapBaby`) [src/client/input/inputMapper.ts:266-295]
- [x] [Review][Patch] « POSE-LE D'ABORD ! » stays up for its whole `holdMs` after the baby is put down (the very action it asks for) or Papa goes in: hide the hint on `BabyPutDown` and `ToiletStarted` in the event routing, with a test [src/client/boot.ts:994-1000, src/client/ui/world/papaHint.ts]
- [x] [Review][Patch] The `urgentFromPct` description promises « the HUD turns orange at the same point », but `gaugesHud.ts` uses its own fixed `WARN_FROM_PCT = 70` (DESIGN: « from 70 % »); tuning the key de-syncs the door and the pill. Correct the description (« 70 by default, where the HUD pill also turns orange; the pill's own threshold is fixed »), run `npm run content:schemas`, and the same wording in D6's echo if any [src/content/schemas/feel.ts:377-379]
- [x] [Review][Patch] The snapshot accepts `papa.state === 'onToilet'` in a level without the gauge (it already refuses a non-zero `bladderPct` there): add the check to `papaProblem`/`gaugesProblem` and a rejected-field test [src/sim/snapshot.ts:128-130]
- [x] [Review][Patch] AC 4 « each with its own next free `SEED + n` »: `synthToiletDoor` uses `SEED + 11`, already taken by `synthParry` (`tools/audio/cultSounds.ts:33`). Move it to the next free offset (`SEED + 14`), regenerate (`npm run assets:audio`, commit only the changed `papa_toilet_door.m4a`), fix the numbers recorded in the Completion Notes and `deferred-work.md`, and put the « Combo cash-in (story 4.2) » comment back above `CASH_IN_*` with its own « Pressing need (story 4.3) » header over the new constants [tools/audio/makePlaceholderAudio.ts:92, 954-1000]
- [x] [Review][Patch] Tests that claim more than they check: (a) AC 10 is pinned for the late gag, the wandering baby and fatigue only; add the director keeping drawing, a silence starting and timing out, a ringing phone timing out and noise moving while Papa is `onToilet`, in `toilet.test.ts` (or trim the `project-context.md` paragraph to what is pinned); (b) AC 9 « a `TapBaby` in the same step keeps its command order » has no test; (c) AC 1 `slowdownPct: 100` is not refused by any test (`feelSchema.test.ts`); (d) `toiletVisit.test.ts` is titled « … with the need back at 0 » but never reads `bladderPct`, and `scenarios.ts` types a literal `asSimMs(10)` where AC 20 says `STEP_MS` [src/sim/papa/toilet.test.ts, tests/content/feelSchema.test.ts, tests/golden/toiletVisit.test.ts, tests/golden/scenarios.ts]
- [x] [Review][Patch] Stale text: `inputMapper.ts` L179 still reads « Papa drinks, sleeps or is on the phone » (the Dev Notes asked to fix the comments that list the busy states); the Debug Log still says « HALT on AC 12 … waits for that decision » while the Completion Notes record Geo's decision; `project-context.md` says « A level of kind `toilet` » for « An object of kind `toilet` » [src/client/input/inputMapper.ts:179, this file › Debug Log, _bmad-output/project-context.md]
- [x] [Review][Patch] Found by the full CI after the patches: `startWalking` (`tests/e2e/support/game.ts`) tapped the canvas at 50 % / 25 %, **6 px from the toilet door's icon** (`objectTouchRadiusPx` is 64), so for `pauseResume` and `ui` specs the « walk » was a trip into the toilet; `pauseResume` then waited for `idle` through the 5 s visit and failed once on a slow run (Chromium, 1 of 470). The tap moved to 65 % / 30 % (about 120 px from the door) [tests/e2e/support/game.ts:588-598]
- [x] [Review][Patch] Found by the second full CI: `toilet.spec.ts › a real tap on its icon…` failed once on WebKit with the game's own « audio is still suspended in play… resuming on this gesture » warning (`collectProblems` counts it): `openFrozen` waited for the babble (`data-pp-babble`), which starts before WebKit's context is running. It now waits for `data-pp-audio="running"` too; 24 runs of the spec on WebKit under 4 workers were green [tests/e2e/toilet.spec.ts:50-58]
- [x] [Review][Defer] Every `TapObject` on the door while the baby is carried emits `ToiletRefused` (papa_bump, haptic, hint restart); a finger drumming on the door repeats the sound and the vibration with no limit — deferred, a feel call for Geo's device pass (a cooldown would be a new `feel.bladder` key)
- [x] [Review][Defer] The sim does not refuse a level that lists a `toilet` object without `gauges.need` (`createSim` validates the objects' anchors only): the visit would run with no gauge. Only `content:check` catches it, as it does for the coffee machine — deferred, same trust level as the coffee; harden both together if a hand-built level ever skips `content:check`
- [x] [Review][Defer] A cash-in « +N » (900 ms of real time) or a rise that happens while Papa has no pose (`onToilet`) elapses unseen, the badge being hidden — deferred, narrow (a cash-in needs a safe put-down, then the walk in); same clock as the existing cash-in deferred entry
- [x] [Review][Defer] `toilet.spec.ts › Papa is drawn again, so the clip changed` compares two full-frame screenshots by inequality, which any pixel change satisfies (the baby, the dimmed door): it would not catch Papa staying visible while away — deferred, assert the `setAway` state through the debug API when `__PP__` gets a view probe

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
| 2026-10-30 | Implemented (`gds-dev-story`): the pressing need, the toilet, the door and hint UI, snapshot v17, goldens regenerated (hashes only) and `toilet_visit` added, darwin references regenerated, HUD timer moves aside on narrow screens (Geo's choice). Status `review`. |
