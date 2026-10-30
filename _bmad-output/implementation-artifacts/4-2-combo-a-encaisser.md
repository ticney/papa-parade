# Story 4.2: The combo to cash in

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.2 « Combo à encaisser » (L1838-1859). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to raise a multiplier that I only cash in by putting the baby down somewhere safe,
so that I take risks for a big score.

**Requirements covered:**
- **FR23 `[P2]`:** combo from x1 to x8; +1 per successful response and +1 every 10 s Papa carries the baby without incident; cashed only at a safe drop, in slow motion; a missed threat before the drop resets it to x1 (epics L56, GDD L169).
- **FR34, the cost of a gag:** « un multiplicateur remis à x1 » (GDD L445).
- **UX-DR22:** `combo-badge` above Papa, hidden at x1 (epics L254, `EXPERIENCE.md` L210, `DESIGN.md` L191-196, L537).
- **GDD L437:** « combos encaissés » feed Mama's Rire (0 to 40).

**What this story is not:**
- **No bot that carries.** The cycle bot is 4.10. No bot cashes in, so the live report's stars and scores do not move (AC 15).
- **No live score in the HUD.** The player sees the badge and the cash-in cue; the points appear in the Rire of the Result screen. The rows of the note stay four.
- **No dégaine, no catastrophe gauge** (other costs of a gag in GDD L445, later epics). **No crib or transat:** any `ZONE_safe_*` cashes in, only the playpen exists today.
- **No change to what `TapBaby` does**, nor to the `safe` rule (D5 of story 4.1, confirmed by D5 below). **No new command**, so no journal becomes invalid. **No new dependency, no new folder.**

**Sources:**
- Epics `epics.md` L56, L254, L1838-1859. GDD `gdd.md` L95, L169, L425, L437, L445. Architecture `game-architecture.md` L521 (`comboBadge.ts` in `ui/world/`), L969 (`src/sim/scoring/combo.ts`, `ZONE_safe_*`).
- UX `DESIGN.md` L57-61 (`typography.combo`), L191-196, L474 (world-anchored text), L537; `EXPERIENCE.md` L125, L210, L376. `tokens.css` L56-59 and `.pp-type-combo` (`ui.css` L85) already exist.
- Previous stories: `4-1-porter-le-bebe-bras-bebe.md` (read its Review Findings and Open points), `1-14-hitstop-et-ralentis.md` (slow-mo sources), `1-22-note-de-maman-et-ecran-de-fin.md` (the note), `3-1-jauge-de-bruit.md` (level opt-in, how a sim story is cut).
- Deferred work `deferred-work.md`: the 4.1 entries « `BabyPutDown.safe` is judged at Papa's point… revisit when 4.2 scores the drop » and Open point 2 « Carrying is almost free until 4.2-4.4 ».

## Acceptance Criteria

Numbers in `content/feel.json` are live starting values for Geo to tune. Tests use the frozen `tests/support/testFeel.json`, never the live file.

### Content

1. **`feel.combo`** (`src/content/schemas/feel.ts`, then `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`; run `npm run content:schemas`). Every key has a `.describe()`:
   - `minMultiplier` (1), `maxMultiplier` (8): whole numbers, `1 <= min < max` (a refine).
   - `carryTickMs` (10000): positive; one more multiplier step per this much time carried without incident.
   - `basePointsPerResponse` (0.5), `basePointsPerCarryTick` (0.5): both strictly positive (D2).
   - `slowMoCashIn`: through the existing `slowMo(…)` helper of the schema (`timeScale` 0.25, `durationMs` 1000, `returnMs` 300).
   - The debug feel panel is generated from `FeelSchema`: pin the section in `src/debug/feelControls.test.ts` as 4.1 did for `carry`.

2. **Cue, clip, strings.**
   - `content/feedback.json`: cue `combo_cashed_in` (audio clip `ui_combo_cash_in` on `sfx`, `layers` with `baby_laugh_perfect` on `voice`, a `soundWave` anchored on `papa`, larger than `baby_put_down`'s, `flash` and `haptic: "heavy"`), and `events: { "ComboCashedIn": "combo_cashed_in" }`. The « only the perfect flashes » rule of `contentChecks.ts` is about threat cues; check it does not catch this one. `feedbackEquivalence.test.ts` passes unchanged.
   - `feedback.json` gains `comboBadge: { cashInHoldMs: 900 }` (real ms; schema next to `ResultScreenSchema`): how long the badge shows the points.
   - New placeholder clip `ui_combo_cash_in` in `tools/audio/makePlaceholderAudio.ts` (the next free `SEED + n`). Run `npm run assets:audio` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB).
   - `strings.fr.json`: `combo.multiplier` = « x{count} », `combo.cash_in` = « +{points} » (filled by the placeholder helper of `client/ui/strings.ts`). No literal UI text in code.

### The sim

3. **Types.**
   - `World.combo: ComboSlice` (`world.ts`): `multiplier: number` (starts at `feel.combo.minMultiplier`), `basePoints: number` (0), `carryTickAt: SimMs | null` (null unless the baby is carried in a level with `carry`).
   - `ScoreSlice.comboPoints: number` (0): the sum of what was cashed in, not rounded.
   - `SlowMoSource` and `SLOW_MO_SOURCES` gain `'comboCashIn'`.
   - Events (`events.ts`, sorted into `SIM_EVENT_TYPES`, completeness proof passing):
     - `ComboChanged{t, multiplier, reason: ComboChangeReason}` with `ComboChangeReason = 'response' | 'carryTick' | 'gag' | 'cashIn'` (a `COMBO_CHANGE_REASONS` const with its proof, exported from `@sim` like `THREAT_CANCEL_REASONS`). Emitted only on a real change of the multiplier.
     - `ComboCashedIn{t, multiplier, basePoints, points}`, where `points = multiplier × basePoints`.

4. **`src/sim/scoring/combo.ts`** holds every writer of `world.combo` (D1), allocation-free, no `nextFloat`:
   - `addResponseToCombo(world, ctx)`: +1 multiplier and +`basePointsPerResponse`.
   - `addCarryTickToCombo(world, ctx)`: +1 multiplier and +`basePointsPerCarryTick`.
   - Both: at or above `maxMultiplier` the multiplier does not move and no event is emitted, **but the base points still grow** (x8 stays worth holding). A `SetFeel` that lowers `maxMultiplier` never lowers a running multiplier (`if (multiplier >= max) return` before writing, never a `min`).
   - `resetCombo(world, ctx, reason)`: back to `minMultiplier` and `basePoints = 0`, `ComboChanged` if the multiplier changed. On a gag with the baby carried, `carryTickAt = now + carryTickMs`: the 10 s are « sans incident ».
   - `cashInCombo(world, ctx)`: see AC 7.
   - `startCarryTick` / `stopCarryTick`: `carryTickAt = now + carryTickMs` / `null`.
   - **Everything is a no-op in a level without `carry`** (`ctx.level.hasCarry` false): no event, nothing written. That is what keeps every golden without carrying identical except for its hashes (D3).

5. **Where the combo climbs and falls** (written at the source, as `world.score.perfects` is):
   - `resolveThreat` (`threats/threatFsm.ts`): every `perfect` or `success`, including the micro-sleep's and the cry in the arms': `addResponseToCombo`. It climbs whether or not the baby is in the arms (GDD L169).
   - `gagThreat`: every failed threat, including the silence's timeout, the micro-sleep's and the cry in the arms': `resetCombo(…, 'gag')`, nothing cashed.
   - `cancelThreat` changes nothing (never answered, never missed). A phone that times out, a falling prop, an early press under `earlyPress: 'guard'`: nothing, they are not a missed threat.

6. **The carry tick: `runScoring`, the system reserved for it.** New `runScoring` in `scoring/combo.ts`, inserted in `SYSTEMS` between `runGauges` and `runFlow` (the slot `step.ts` documents; `runInstinct` does not exist yet). Update the pinned order test in `step.test.ts` and the comment in `step.ts` and `mamaScore.ts`. It does: if `carryTickAt !== null && now >= carryTickAt`, `addCarryTickToCombo` and `carryTickAt = carryTickAt + carryTickMs` (no drift). `takeBaby` calls `startCarryTick`; `putDownBaby` calls `stopCarryTick`. The tick runs on while Papa is busy (a missed micro-sleep has already reset it). It needs no draw.

7. **The cash-in** (`cashInCombo`, called at the end of `putDownBaby` in `baby/carry.ts`, after the cry in the arms was cancelled):
   - Only when `safe` (Papa's point in a safe zone, D5) and `multiplier > minMultiplier`. **A put-down on bare floor neither cashes in nor resets**: the combo stays at risk and the carry tick stops until the next take. A safe drop at x1 is the plain 4.1 put-down.
   - `points = multiplier × basePoints`; `world.score.comboPoints += points`; `ComboCashedIn`; then `resetCombo(…, 'cashIn')`; then `startSlowMo(world, ctx, 'comboCashIn', feel.combo.slowMoCashIn)`. No hitstop.
   - Event order in the step: `BabyStateChanged`, `BabyPutDown`, `ThreatCancelled` if any, `ComboCashedIn`, `ComboChanged{cashIn}`. Pin it with a test.
   - A gag and a safe put-down in one step: `runThreats` runs first, so the gag wins and nothing is cashed. Pin it.

8. **Mama's note** (`scoring/mamaScore.ts`): `ScoreTally` gains `comboPoints`; `laughPoints = row(perfects × laughPerPerfectPoints + comboPoints, laughMaxPoints)`. No new row, no new field in `MamaScore` or `LevelScored`. Points not cashed when the level ends are lost, with no event.

9. **Snapshot v16** (`snapshot.ts`: type, literal, history comment « 16 since story 4.2: `world.combo`, `score.comboPoints`, the `comboCashIn` slow-mo »). Validate: `multiplier` a whole number ≥ 1; `basePoints` and `comboPoints` finite and ≥ 0 (they are not whole, so not `isCount`); `carryTickAt` null or finite, **non-null exactly while the baby is `carried`**. Do not validate against `feel.combo`: a `SetFeel` can move the bounds under a running combo. Update the fixtures and add a round-trip for a carried world mid-combo.

### The client

10. **`combo-badge`** (new `src/client/ui/world/comboBadge.ts`, `createComboBadge(scene, doc)`, built like `tapMarker.ts`: one pooled element, the outer one placed by `CSS2DRenderer`, a child for animations). Wired in `worldUi.ts` (`updateCombo`, and counted in the « anything visible? » test of `render`, or the badge never draws while nothing else is up) and `boot.ts`, next to `updateThreats`.
    - Reads the world each frame (`world.combo.multiplier`, Papa's drawn pose, as the icons that follow Papa do): anchored above Papa's head, visible iff `multiplier > feel.combo.minMultiplier`, text `t('combo.multiplier')` filled in. **The text and the class are written only when they change**: no per-frame DOM write, no allocation (cache the strings of x2 to x8 at build).
    - Class `pp-combo-badge` with `pp-type-combo`, tokens only: `{colors.paper}` fill, 5 px `{colors.ink}` stroke, `paint-order: stroke`, the hard shadow (`DESIGN.md` L474, same as `.pp-threat-verb`). `aria-hidden`, `pointer-events: none`; it never catches a tap (the hit test ignores it).
    - **Overlap with the verbs on Papa:** while a `target: "papa"` threat is up (micro-sleep, cry in the arms), its verb stack stands in the same spot. The badge then moves aside with a class (`pp-combo-badge--aside`, a fixed CSS offset to the side), so that the verb stays readable and the badge stays visible. Look at it in a screenshot.
    - A small « pop » on a rise (Web Animations API, real time), none under reduced motion (`isMotionReduced`).
    - A restart clears it. It adds nothing to the HUD (`#pp-world`, not `#pp-hud`): `HUD_MAX_DOM_NODES` is unchanged.

11. **The cash-in on screen.** The `combo_cashed_in` cue goes through the normal routing (`simEventFeedback.ts`, from `feedback.json › events`), so it adds nothing there; it is **in addition to** `baby_put_down`, which still fires. On `ComboCashedIn`, `comboBadge.showCashIn(points)` shows « +N » (`combo.cash_in`, `points` rounded for display) for `feedback.comboBadge.cashInHoldMs`, in real time, even though the multiplier is already back to x1; then it hides. A new rise during the hold replaces it. Under reduced motion it shows with no animation. The slow-mo is the sim's and is untouched by that setting. The music follows `world.time.scale` on its own (story 2.6): check it, write nothing.

12. **Mirrors** (dev and `?debug=1` only, on events, never per frame, in `boot.ts` beside `ppPutDown`, and in its clearing list at level start): `data-pp-combo` = the multiplier on `ComboChanged` (and reset at level start), `data-pp-combo-cashed` = `points` on `ComboCashedIn`.

### Tools and tests

13. **Report** (`tools/sim/simReport.ts`, `simArgs.ts` `--help`, `tests/tools/sim/simReport.test.ts`): per run and in the aggregate `comboCashIns`, `comboPointsCashed`; `comboPeakMultiplier` per run and max in the aggregate.

14. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `scoring/combo.test.ts`: +1 per success and per perfect (papa-target threats too), x8 stays x8 with no event while base points grow, reset on each kind of gag and `basePoints = 0`, a cancelled threat changes nothing, tick at exactly `carryTickMs` with no drift over several ticks, tick rescheduled by a gag while carried, no tick after a put-down, no tick while not carried, a `SetFeel` lowering the max does not lower a running multiplier, **a level without `carry` emits no combo event and keeps `world.combo` at rest**, no rng consumed anywhere.
    - `baby/carry.test.ts`: cash-in in the playpen (exact `points`, `comboPoints`, event order, multiplier back to min, `slowMos` holds `comboCashIn`, `world.time.scale` falls to its scale); safe drop at x1 has no cash-in and no slow-mo; bare-floor drop keeps the multiplier and the base points and then a later safe drop cashes them in; a gag in the put-down step cashes nothing.
    - `mamaScore.test.ts`: the Rire adds `comboPoints`, is capped at `laughMaxPoints`, the rows still add up; `flowSystem`/`LevelScored` carries it.
    - `slowMo.test.ts`, `snapshot.test.ts` (v16 and each rejected field), `events.test.ts`, `step.test.ts`, `feelSchema.test.ts` (bounds, `min < max`), `checkContent`/feedback schema tests.
    - `carryFuzz.test.ts`: after every step also assert `minMultiplier <= multiplier <= maxMultiplier`, `comboPoints` never falls, and `carryTickAt !== null` iff carried.
    - Client: `comboBadge.test.ts` (hidden at x1, x2 to x8, no write when unchanged, aside class, cash-in hold), `worldUi.test.ts` (a visible badge alone still renders), `simEventFeedback` routing.
    - `src/sim` coverage stays at or above 90 %.

15. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --runs 20` on `salon_crawler`, seeds 1-20, `main` against the branch: for **all four bots**, stars, end reasons, success rate, score and gags are identical (no rng drawn, no cash-in, the Rire unchanged). Only hashes move. Paste both summaries. `comboPeakMultiplier` is non-zero for bots that answer, `comboCashIns` is 0.
    - `npm run golden:update`, then diff: every existing journal moves only in its hashes (feel section, world slice), **except `baby_carry`**, whose level has `carry`: it gains only `ComboChanged` events, and no existing event, `t` or score differs. Anything else is a bug, stop.
    - New scenario `combo_cash_in` (`tests/golden/scenarios.ts`, a test file like `babyCarry.test.ts`): take, success on a forced threat or the cry in the arms, a carry tick, a walk to the playpen, cash-in, the slow-mo running out, the level's end with the Rire in `LevelScored`. Use `STEP_MS` from `@shared/constants`.

16. **End to end** (`tests/e2e/combo.spec.ts`, chromium + webkit, `ppSend` / `ppAdvance` like `carry.spec.ts`, bounds read from the live content, `ppSetFeel` to shorten `carryTickMs`):
    - Badge hidden at the start; after a success `data-pp-combo` = 2 and `.pp-combo-badge` is visible and reads « x2 »; capped at the max.
    - A missed threat: back to 1, badge hidden, `data-pp-combo-cashed` absent.
    - Carry into the playpen and cash in: `data-pp-combo-cashed` set, « +N » shown then gone, `__PP__.cueLog()` holds `combo_cashed_in` and `baby_put_down`, `world.time.scale` below 1 (via `__PP__.state`), and in Chromium the vibrations hold the `heavy` pattern (WebKit has no `navigator.vibrate`).
    - A bare-floor put-down leaves `data-pp-combo` unchanged.
    - The Result screen's Rire is higher than a same-seed run without the cash-in, or assert `LevelScored.laughPoints` by a forced level end.
    - No screenshot reference should move at x1 (the badge is hidden). If one does, refresh the darwin references and say so.

17. **Docs.**
    - `deferred-work.md`: close the `BabyPutDown.safe` entry (D5) and update 4.1's Open point 2; add this story's Open points.
    - `project-context.md`: add a « The combo (story 4.2) » paragraph to the Engine rules (writers, level opt-in, `runScoring`, cash-in order, the Rire), bump « snapshot version 15 » to 16, and change the sentence « `runScoring` stays reserved for live scoring (E4) ».
    - Do not edit the architecture or the GDD.

18. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [ ] **T1. Content** (AC 1, 2)
  - [ ] T1.1 `feel.combo` in the schema and three JSON files, refine, `content:schemas`, debug panel test.
  - [ ] T1.2 Cue, event routing, `comboBadge` feedback section, strings, the placeholder clip (commit only the new `.m4a`).
- [ ] **T2. Sim** (AC 3-9)
  - [ ] T2.1 `ComboSlice`, `comboPoints`, slow-mo source, the two events and `COMBO_CHANGE_REASONS`; `createWorld`.
  - [ ] T2.2 `scoring/combo.ts`, `runScoring` in `SYSTEMS`, the hooks in `resolveThreat` and `gagThreat`.
  - [ ] T2.3 `takeBaby` / `putDownBaby` hooks and `cashInCombo`; `computeMamaScore`.
  - [ ] T2.4 Snapshot v16; the unit tests of AC 14 for the sim; the fuzz test.
- [ ] **T3. Client** (AC 10-12)
  - [ ] T3.1 `comboBadge.ts`, CSS, `worldUi` and `boot` wiring, aside class, cash-in hold; its unit tests.
  - [ ] T3.2 Mirrors; check the music and the cue routing with no new code.
- [ ] **T4. Tools and tests** (AC 13, 15, 16)
  - [ ] T4.1 Report and its test; the bot comparison with `main`.
  - [ ] T4.2 Goldens (regenerate, diff, add `combo_cash_in`).
  - [ ] T4.3 `tests/e2e/combo.spec.ts`; `carry.spec.ts`, `testApi.spec.ts` still green.
- [ ] **T5. Docs and CI** (AC 17, 18)

## Dev Notes

### Decisions (D1-D6)

- **D1. Written at the source, in one file.** Same rule as `world.score.perfects`: no system scans `ctx.events`. `threatFsm.ts` and `carry.ts` call helpers of `scoring/combo.ts`; only the tick is a system, because nothing else fires on a clock.
- **D2. « Points de base accumulés » is not defined by the epics or the GDD; this story defines it.** Each response and each carry tick add base points (`basePointsPer*`), and they reset with the multiplier. A tick has to give some: otherwise a player who only carries reaches x3 with 0 base and cashes a slow motion worth nothing. With both values positive, `multiplier > min` always implies `basePoints > 0`, so a cash-in is never « +0 ». Scale check, with the starting values: 3 responses give x4 × 1.5 = 6 points; 7 responses give x8 × 3.5 = 28, against a Rire of 40 and 1 point per perfect. Open point 1.
- **D3. The combo runs only in a level with `carry`.** Without somewhere to cash in, it would only be noise in the events. This keeps the goldens' event sequences. `salon_crawler` declares `carry`, so its bots climb and reset, but never cash in.
- **D4. Climbing is not tied to carrying.** GDD L169: « à chaque réponse réussie ». So a player can climb on the floor, then take the baby to cash in. A bare-floor put-down does not reset either: the epics' only reset is a missed threat.
- **D5. `safe` stays at Papa's point** (4.1 D5, whose review deferred it to here). The player's act is walking onto the mat; the baby landing `putDownOffsetM` ahead, even off the mat, is not punished. Since `BabyPutDown.safe` is judged the same way, the player cannot see one thing and get another.
- **D6. The badge reads state, the cash-in reads an event.** The multiplier is `World` state (a snapshot restore or a restart must show the truth, and it is never out of sync). The « +N » is a moment, so it comes from `ComboCashedIn`, in real time and client only.

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatFsm.ts`.** `resolveThreat` (L139) increments `world.score.perfects`, then hitstop and slow-mos; `gagThreat` (L188) emits `ResponseResolved`, `GagTriggered`, `applyGag`, then the cry; `cancelThreat` (L233) stays silent. Preserve the order of the existing events; append the combo call after `applyGag` / the cry, and after the slow-mos.
- **`src/sim/baby/carry.ts`.** `takeBaby` L68 (the arms-cry draw is the last line: keep the one draw), `putDownBaby` L95 (computes `safe` inside the event literal: lift it to a local so that `cashInCombo` uses the same value).
- **`src/sim/step.ts`.** `SYSTEMS` L38-49; its comment announces `runScoring`. **`step.test.ts`** L19 pins the names.
- **`src/sim/scoring/mamaScore.ts`.** `ScoreTally`, `computeMamaScore`, `scoreLevel` (reads `world.score`).
- **`src/sim/time/slowMo.ts`** needs no change except the source list in `world.ts`. A cash-in during a perfect's slow-mo: min scale wins, each keeps its timer (already handled).
- **`src/sim/world.ts`.** `ScoreSlice` L240, `SLOW_MO_SOURCES` L287, `CarrySlice`, `createWorld` L373 (it gets `feel`, so `feel.combo.minMultiplier` is at hand). **`snapshot.ts`:** `version` L40/L59, `scoreProblem` L722, `carryProblem` L657 (the model for the new `comboProblem`).
- **`src/client/ui/world/worldUi.ts`.** `render` returns early while nothing is visible: add the badge to that test. **`tapMarker.ts`** is the pattern. **`threatMarkers.ts`:** the icons that follow Papa, `.pp-threat-verb` style. **`client/boot.ts`:** `updateThreats` L787 (`currentLevel?.papaPose`), mirrors L245, L466, L523, the event loop L945.
- **`tools/sim/simReport.ts`** L80-88, L222-229 (counters). **`tools/audio/makePlaceholderAudio.ts`**.
- **Must not change:** judgement, windows, `TapBaby`'s rules, the arms-cry and silence rules, the rng draw counts, `COMMAND_TYPES`, the journal format, the four rows of the note.

### Architecture compliance

- Pure sim, serialisable `World`; **no rng anywhere in the combo**; state through helpers; no real time, no log, events past tense with `t`.
- Units: `carryTickMs`, `basePoints`, `comboPoints`, `cashInHoldMs` (real time, client only), `carryTickAt` (sim instant). Booleans `is…`/`has…`. Numbers in `feel.json`, the hold in `feedback.json`, strings in `strings.fr.json`.
- Client imports `@sim` only: export `ComboChangeReason`, `COMBO_CHANGE_REASONS` and the `ComboSlice` type from `src/sim/index.ts`. The badge is vanilla DOM with `pp-` classes and tokens; `tokens.css` is not changed (the tokens exist, and a test enforces 1:1 with `DESIGN.md`).
- Zero allocation in `runScoring`, the helpers (except the event) and the badge's update.
- Every cue with `audio` has `visual` and `haptic`.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned (Three r186 `CSS2DObject`, Zod 4, Vitest 5, Playwright 1.64), so no web research was needed.

### File structure

New: `src/sim/scoring/combo.ts`, `combo.test.ts`; `src/client/ui/world/comboBadge.ts`, `comboBadge.test.ts`; `public/assets/audio/ui_combo_cash_in.m4a`; `tests/e2e/combo.spec.ts`; `tests/golden/comboCashIn.test.ts` with `tests/golden/journals/combo_cash_in*.json`.

Updated: `src/content/schemas/{feel,feedback}.ts`, `content/{feel,feedback,strings.fr}.json`, `content/_schemas/*` (generated); `src/sim/{world,events,snapshot,step,index}.ts`, `threats/threatFsm.ts`, `baby/carry.ts`, `scoring/mamaScore.ts`; `src/client/{boot.ts,ui/world/worldUi.ts,ui/styles/ui.css}`; `tools/{audio/makePlaceholderAudio.ts,sim/{simReport,simArgs}.ts}`; tests next to each, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tests/golden/*`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ carry: … })` and `stepN`. Run `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/combo.spec.ts tests/e2e/carry.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.

### Previous story intelligence (4.1)

- `random` draws its target among `world.threats`: this story adds no instance and no draw, so **all four bots** must be identical this time, with no exception.
- A review caught a second `TapBaby` in one step, and the walk ending outside the tap's zone: both are handled in `runPapa`, and the cash-in inherits them because it sits in `putDownBaby`.
- 4.1's review also caught stale sentences in `project-context.md`, and prose instead of the two main-vs-branch summaries: do AC 15 and AC 17 literally. Keep the Completion Notes honest about anything not done.
- Golden regeneration: diff every `*.expected.json`, then `biome format` the JSON. A 5 s test timeout under load is known: rerun with `VITEST_MAX_WORKERS=5` and say so.
- Reviews of 3.x: one `SEED + n` per placeholder clip, no hard-coded `STEP_MS` in tests, no comment claiming more than the test asserts.

### Git intelligence

Recent commits are the 4.1 and 2.6 stories. 4.1 is merged into `main`, this branch is cut from it. Commit convention: « Story 4.2 : <titre> », « Story 4.2 : corrections de la revue de code ». `main` only receives the merge after Geo's OK.

### Project Structure Notes

`scoring/combo.ts` and `ui/world/comboBadge.ts` are the paths the architecture names (L969, L521). Variances: a `runScoring` that holds only the tick (D1), and the level opt-in (D3).

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes: every number is data.
- Layer rules; the sim never logs; no `Math.random`, `Date`, `performance`, `setTimeout` in `src/sim`.
- Systems never call each other (helpers are fine); inserting a system means editing the pinned order test and saying so.
- UI: `t(key)` only, tokens only, `pp-` classes; reduced motion is client-only and never changes sim timing.
- Goldens are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **Base points (D2) are this story's invention.** The epics say « points de base accumulés » without a value. Tune `basePointsPer*`, or say if a perfect should weigh more than a success.
2. **A strong player gains little.** The Rire is capped at 40, and the `perfect` bot already reaches it with perfects alone; `human` is close. The combo mostly helps average players unless the perfects are retuned.
3. **A safe drop can be farmed in small bites**, and x8 with few base points is worth less than a long run. Watch how players bank it.
4. **The bare-floor put-down keeps the combo (D4).** Say if you prefer it lost.
5. **The bots still do not cash in,** until the cycle bot of 4.10.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L56, L254, L1838-1859]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L95, L169, L425, L437, L445]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L521, L969]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L57-61, L191-196, L474, L537; EXPERIENCE.md L125, L210, L376]
- [Source: _bmad-output/project-context.md (Engine rules: Carrying the baby, Mama's note; Feedback; Testing)]
- [Source: _bmad-output/implementation-artifacts/4-1-porter-le-bebe-bras-bebe.md; deferred-work.md]
- [Source: src/sim/{step,world,snapshot}.ts, threats/threatFsm.ts, baby/carry.ts, scoring/mamaScore.ts, time/slowMo.ts; src/client/ui/world/{worldUi,tapMarker,threatMarkers}.ts, client/boot.ts; tools/sim/simReport.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
