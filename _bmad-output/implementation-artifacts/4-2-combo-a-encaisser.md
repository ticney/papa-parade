---
baseline_commit: 0c45b43552d4a3bccac2e764cb514257bd285301
---

# Story 4.2: The combo to cash in

Status: done

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

- [x] **T1. Content** (AC 1, 2)
  - [x] T1.1 `feel.combo` in the schema and three JSON files, refine, `content:schemas`, debug panel test.
  - [x] T1.2 Cue, event routing, `comboBadge` feedback section, strings, the placeholder clip (commit only the new `.m4a`).
- [x] **T2. Sim** (AC 3-9)
  - [x] T2.1 `ComboSlice`, `comboPoints`, slow-mo source, the two events and `COMBO_CHANGE_REASONS`; `createWorld`.
  - [x] T2.2 `scoring/combo.ts`, `runScoring` in `SYSTEMS`, the hooks in `resolveThreat` and `gagThreat`.
  - [x] T2.3 `takeBaby` / `putDownBaby` hooks and `cashInCombo`; `computeMamaScore`.
  - [x] T2.4 Snapshot v16; the unit tests of AC 14 for the sim; the fuzz test.
- [x] **T3. Client** (AC 10-12)
  - [x] T3.1 `comboBadge.ts`, CSS, `worldUi` and `boot` wiring, aside class, cash-in hold; its unit tests.
  - [x] T3.2 Mirrors; check the music and the cue routing with no new code.
- [x] **T4. Tools and tests** (AC 13, 15, 16)
  - [x] T4.1 Report and its test; the bot comparison with `main`.
  - [x] T4.2 Goldens (regenerate, diff, add `combo_cash_in`).
  - [x] T4.3 `tests/e2e/combo.spec.ts`; `carry.spec.ts`, `testApi.spec.ts` still green.
- [x] **T5. Docs and CI** (AC 17, 18)

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

Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Code, in the story's worktree `story/4-2-combo-a-encaisser`.

### Implementation Plan

- **Sim (D1).** `src/sim/scoring/combo.ts` holds every writer of `world.combo`: `addResponseToCombo`, `addCarryTickToCombo`, `resetCombo`, `cashInCombo`, `startCarryTick`, `stopCarryTick` and `runScoring` (the carry tick, inserted between `runGauges` and `runFlow`). `resolveThreat` and `gagThreat` call the first and `resetCombo`; `takeBaby` / `putDownBaby` start and stop the tick and `putDownBaby` ends with `cashInCombo` (the `safe` value is lifted to a local, shared with the `BabyPutDown` event). Everything is a no-op without `ctx.level.hasCarry` (D3), and nothing draws from `world.rng`.
- **Rire.** `ScoreTally.comboPoints`, `laughPoints = row(perfects × laughPerPerfectPoints + comboPoints, laughMaxPoints)`: one rounding, at the end.
- **Snapshot v16.** `comboProblem` (whole multiplier ≥ 1, finite non-negative base points, `carryTickAt` non-null exactly while carried) and `score.comboPoints`; not checked against `feel.combo` (a `SetFeel` may move the bounds).
- **Client (D6).** The badge reads `world.combo` each frame (`worldUi.updateCombo`, real time passed in, no timer); `ComboCashedIn` calls `comboBadge.showCashIn`. `pp-combo-badge--aside` is set while a threat that follows Papa is up (the micro-sleep, the cry in the arms), with the CSS `translate` property, because the `CSS2DRenderer` owns the outer element's `transform`.
- **Content.** `feel.combo`, `feedback.json › comboBadge` and the cue `combo_cashed_in` (clip `ui_combo_cash_in`, `SEED + 10`).

### Debug Log References

- `npm run typecheck`, `npm run ci:fast` (4978 tests), `combo.spec.ts` (chromium and webkit, 7 tests each), then the neighbouring specs on Chromium: `carry`, `testApi`, `ui`, `feedback`, `threat`, `autoplay`, `adaptiveMusic` (64 tests, all green, no screenshot reference moved). The full `npm run ci` result is in the last Completion Note.
- The first cut of the carry-tick tests used a level with the cry in the arms: an unanswered cry is a gag, which reset the combo under test. The combo tests use `carry: {}` (no cry) and say so; `CARRY` is used only where the cry is the point.
- `carryFuzz.test.ts` found no violation of its three new invariants over 200 seeds × 3000 steps, but with the live 10 s tick random play never cashed in; the fuzz now runs with `combo.carryTickMs = 1500` so that cash-ins happen (it asserts at least one).

### Completion Notes List

- **All 18 ACs are met.** The deviations and judgement calls are listed here first.
  - **Key names (AC 1).** `basePointsPerResponse` and `basePointsPerCarryTick` are named **`basePerResponsePoints`** and **`basePerCarryTickPoints`**: `tests/content/feelSchema.test.ts › feel unit suffixes` refuses a numeric key that does not end in a unit, and the project already names its weights `laughPerPerfectPoints`, `sighPerMischiefPoints`. The test was not weakened. Values are the story's (0.5 and 0.5).
  - **Scene order in `worldUi.test.ts`.** The combo badge is the third element of the layer's scene (tap marker, glyph chip, badge), so three assertions that indexed the threat icons shifted by one (`children[2]` → `[3]`, the « stay » count 2 → 3, `slice(2, 4)` → `slice(3, 5)`). No behaviour changed.
  - **`ComboChanged` while the level has no `carry`** is never emitted (AC 4); the bots on `salon_crawler` (which declares `carry`) do climb and reset.
- **Bots, `main` against the branch (AC 15), `salon_crawler`, seeds 1-20, `--runs 20`.** For all four bots, the two JSON reports are equal once the hashes, the wall time and the new `combo*` fields are set aside (checked by a script, 0 differences). `main` is the commit this branch was cut from, run from a `git archive` of it. The branch columns were run again by hand in the code review (`npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`) and give the values below:

| bot | `main`: mean score / mean stars / star counts 0-5 / ends / success % / gags | branch: same | branch: `comboCashIns` / `comboPointsCashed` / `comboPeakMultiplier` |
|---|---|---|---|
| `perfect` | 90 / 5 / [0,0,0,0,0,20] / timer 20 / 100 / 0 | 90 / 5 / [0,0,0,0,0,20] / timer 20 / 100 / 0 | 0 / 0 / 8 |
| `human` | 82.1 / 4 / [0,0,0,1,18,1] / timer 20 / 99.9 / 1 (`stairs_slide`) | 82.1 / 4 / [0,0,0,1,18,1] / timer 20 / 99.9 / 1 (`stairs_slide`) | 0 / 0 / 8 |
| `random` | 20.3 / 1 / [0,20,0,0,0,0] / timer 20 / 2.2 / 759 | 20.3 / 1 / [0,20,0,0,0,0] / timer 20 / 2.2 / 759 | 0 / 0 / 2 |
| `idle` | 20 / 1 / [0,20,0,0,0,0] / timer 20 / 0 / 762 | 20 / 1 / [0,20,0,0,0,0] / timer 20 / 0 / 762 | 0 / 0 / 0 |

  No rng is drawn by the combo, nothing cashes in (the bots never put the baby down), and the Rire is unchanged. Only the hashes moved.
- **Goldens (AC 15), regenerated deliberately with `npm run golden:update`, then `biome format` on the JSON.** Every existing journal moves only in its `feelHash` (`*.json`, the feel gained `combo`) and its `worldHash` (`*.expected.json`, the world gained `combo` and `score.comboPoints`). **`baby_carry` is the one exception**: its level has `carry`, and it gains exactly one `ComboChanged` in `eventTypes` (the perfect Parry at the end), so its `eventsHash` changes too; no existing event, `t` or score differs. `mama_woke.expected.json` also changed layout only (biome). New scenario **`combo_cash_in`** (seed 21, 16 s, `STEP_MS`-based, no wave, with the cry in the arms): take at 1010, the carry tick at 11010 (x2), a perfect Parry of the cry at 11340 (x3, 1 base point), the walk to the playpen, the cash-in at 11920 (3 × 1 = 3 points) and its slow-mo running out, the level's end at 16000 with `laughPoints` 4 (1 perfect + 3 combo points). `tests/golden/comboCashIn.test.ts` pins what it covers.
- **Full CI (AC 18).** `npm run ci` ran once on the branch, with `ci:fast` and the touched specs already green, and exited 0: `test:coverage` 261 files / 4978 tests, coverage 98.3 % lines overall (the `src/sim` ≥ 90 % thresholds pass), `e2e` chromium + webkit 454 passed, `build:playtest` and `dist:check` (playtest), `e2e:dist` (10 passed; `perf.spec.ts` p95 16.8 ms, 42 draw calls max, 1526 triangles max), `build` and `dist:check` (prod). No load timeout, no rerun. `dist/` holds the prod build afterwards.
- **Screenshots (AC 16).** No darwin reference moved: `autoplay.spec.ts` (the screenshot assertion) is green on Chromium with the badge hidden at x1. I looked at the badge in three screenshots (a multiplier, the aside state beside the verb « BERCE ! » with no overlap, and the « +N » over the playpen), taken with a throw-away spec that is not kept.
- **Music (AC 11).** Checked, nothing written: `adaptiveMusic` reads `world.time.scale < feel.music.slowMo.belowScale` (1), so the `comboCashIn` slow-mo at 0.25 triggers the low-pass and the lower rate like any other.
- **Placeholder clip.** `ui_combo_cash_in.m4a` (`SEED + 10`, 520 ms, an arpeggio and a sparkle, 8.5 KB) is the only audio file committed; `npm run assets:audio` rewrote the other 27 clips and they were restored from git.
- **Not done, on purpose:** nothing in the HUD (AC « no live score »), no bot that cashes in (4.10), no change to `TapBaby`, `safe`, `COMMAND_TYPES` or the journal format, no new dependency or folder. The architecture and the GDD are not edited.
- **Open points for Geo** are in `deferred-work.md` (« Story 4-2-combo-a-encaisser »): the base points (D2) are this story's invention; a strong player gains little; the safe drop can be farmed in small bites; the bare-floor put-down keeps the combo; the bots do not cash in; the cash-in slow-mo also ducks the music.

### File List

**New**
- `src/sim/scoring/combo.ts`, `src/sim/scoring/combo.test.ts`
- `src/client/ui/world/comboBadge.ts`, `src/client/ui/world/comboBadge.test.ts`
- `public/assets/audio/ui_combo_cash_in.m4a`
- `tests/e2e/combo.spec.ts`
- `tests/golden/comboCashIn.test.ts`, `tests/golden/journals/combo_cash_in.json`, `tests/golden/journals/combo_cash_in.expected.json`

**Modified**
- Content: `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`, `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`
- Sim: `src/sim/world.ts`, `src/sim/events.ts`, `src/sim/index.ts`, `src/sim/snapshot.ts`, `src/sim/step.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/baby/carry.ts`, `src/sim/scoring/mamaScore.ts`
- Client: `src/client/boot.ts`, `src/client/ui/world/worldUi.ts`, `src/client/ui/styles/ui.css`, `src/shared/constants.ts`
- Tools: `tools/sim/simReport.ts`, `tools/sim/simArgs.ts`, `tools/audio/makePlaceholderAudio.ts`
- Tests: `src/sim/snapshot.test.ts`, `src/sim/step.test.ts`, `src/sim/events.test.ts`, `src/sim/baby/carry.test.ts`, `src/sim/baby/carryFuzz.test.ts`, `src/sim/scoring/mamaScore.test.ts`, `src/sim/flow/flowSystem.test.ts`, `src/sim/gauges/gaugesSystem.test.ts`, `src/sim/threats/threatFsm.test.ts`, `src/sim/time/slowMo.test.ts`, `src/debug/feelControls.test.ts`, `src/client/ui/world/worldUi.test.ts`, `src/client/feedback/simEventFeedback.test.ts`, `src/client/feedback/feedbackDirector.test.ts`, `tests/content/feelSchema.test.ts`, `tests/content/feedbackSchema.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/tools/sim/mamaScore.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tests/golden/scenarios.ts`
- Goldens (hashes only, except `baby_carry`): `tests/golden/journals/{baby_carry,baby_wander,core_basic,feel_change,mama_woke,outlet_parry,papa_walk,prop_fall,prop_fall_noise,threat_trio}{,.expected}.json`
- Docs: `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file

### Review Findings

Code review of 2026-10-30 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 1 decision_needed, 4 patch, 3 defer, 18 dismissed. The sim ordering (gag then safe drop, response then drop in one tick, reset while carried, `SetFeel` lowering the maximum), the snapshot v16 validation and the goldens held up; the auditor found no functional AC violation.

- [x] [Review][Decision] (decided by Geo, who left the call to the reviewer: option 1, a distinct style; `.pp-combo-badge--cash-in .pp-combo-badge-text` now takes `--pp-color-star` for its fill, the stroke and shadow unchanged) The `pp-combo-badge--cash-in` class is toggled by `setCashIn` but no CSS rule or code uses it, so « +6 » looks exactly like « x6 » (same paper fill, stroke, size). DESIGN.md › combo-badge only describes the multiplier. Options: (1) keep it as a styling hook and add a rule (colour or size) so a banked « +N » reads differently from an « x N » at risk; (2) keep the look and remove the class and `setCashIn`; (3) keep the class as a hook for a later art pass and say so in a comment. [src/client/ui/world/comboBadge.ts:105-109, src/client/ui/styles/ui.css:1126-1141]
- [x] [Review][Patch] Stale and garbled comments: `BabyPutDown`'s doc still says « Nothing scores it yet (story 4.2) » although a safe put-down now cashes the combo (`ComboCashedIn`, `ComboChanged{cashIn}`); the `runScoring` sentence in `step.ts` reads « `runScoring` stays holds the combo's carry tick only » (AC 3, AC 6) [src/sim/events.ts:114-117, src/sim/step.ts:29-30]
- [x] [Review][Patch] `showCashIn` does not cancel a running rise `pop`: a rise followed within 220 ms by a safe put-down leaves the 1.5 to 1 scale pop playing on the « +N » text; add `pop?.cancel(); pop = null;` and a test (rise, then immediate `showCashIn`, no active animation) [src/client/ui/world/comboBadge.ts:149-155]
- [x] [Review][Patch] (done: a new `describe` in `combo.test.ts` covers the early press, the wrong kind of response, the silence timeout, an early press under `earlyPress: 'guard'`, a phone that rings out and the arms cry cancelled by the put-down; `released` and the firm-while-carried gag have no frozen test def and the falling prop needs the physics, so they stay unpinned: they go through the same `gagThreat` call) AC 14 gaps: `combo.test.ts` resets only on the outlet late miss, the missed arms cry and the missed micro-sleep. Unpinned `gagThreat` paths: the silence timeout (named in AC 5), an early press (`earlyPress: 'guard'`), `wrongResponse`, `released`, the phone timeout, a falling prop; and the cancel by `putDown` (only covered through `carry.test.ts`) [src/sim/scoring/combo.test.ts, src/sim/baby/silence.ts:133, src/sim/threats/threatSystem.ts]
- [x] [Review][Patch] (done: the four bots were run again on the branch and the table now holds both summaries) AC 15 literally: the Completion Notes say « 0 differences » for the four bots (`salon_crawler`, seeds 1-20, `--runs 20`) but paste only the `main` values; paste both summaries (`main` and the branch), as 4.1's review asked [_bmad-output/implementation-artifacts/4-2-combo-a-encaisser.md:269]
- [x] [Review][Defer] `SetFeel` validates only the shape of the patch, so the cross-field rule `minMultiplier < maxMultiplier` of the schema is bypassed, and a patch can raise `minMultiplier` above a running multiplier or lower `maxMultiplier` to the multiplier: base points then pile up invisibly at the floor and the first cash-in pays them — deferred, pre-existing (the debug panel's `SetFeel` never re-runs the schema refines) [src/sim/commandQueue.ts:68-80, src/sim/scoring/combo.ts:28-45]
- [x] [Review][Defer] The « +N » hold (`cashInHoldMs`, 900 ms) runs on `performance.now()`: a pause or a hidden tab during it makes it elapse unseen — deferred, same real-time clock as the other real-time effects (`screenFlash`, `gaugesHud`); revisit with the device pass
- [x] [Review][Defer] The `aside` shift is a fixed 64 px, whatever the verb's width or Papa's screen position (near the right edge on a phone it can leave the screen) — deferred to the device pass; the e2e pins the non-overlap in one layout only

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
| 2026-10-30 | Implemented (`gds-dev-story`): `feel.combo`, the sim combo and its cash-in, snapshot v16, the combo badge and the « +N », report fields, goldens regenerated and `combo_cash_in` added, e2e `combo.spec.ts`, docs. Full CI green; status `review`. |
| 2026-10-30 | Code review (`gds-code-review`): 1 decision, 4 patches applied (distinct style for the banked « +N », `showCashIn` cancels the rise pop, stale comments, AC 14 gag tests, AC 15 summaries), 3 deferred, 18 dismissed; status `done`. |
