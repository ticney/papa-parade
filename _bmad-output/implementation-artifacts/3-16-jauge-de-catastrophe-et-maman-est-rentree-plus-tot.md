---
baseline_commit: 52669ba8d6452222cbc3f62cf428f9e24ee52ac9
---

# Story 3.16: Jauge de catastrophe et « Maman est rentrée plus tôt ! »

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to feel the catastrophe building up and to be able to lose a level in one last gag,
so that every threat has a real stake.

Requirements: FR73 (catastrophe gauge), NFR9 (revised: no *hard* game over, the early end is a gag), FR33 (revised: the only early end of a Retour level is the full catastrophe gauge; Retour itself is 3.10, not built), FR34 (« Catastrophe : 0 étoile »). UX: UX-DR29 (catastrophe-face), UX-DR13 (the early-end header). Architecture: `CatastropheChanged`, `LevelEnded{mamaHome}`, `src/sim/gauges/catastrophe.ts` (`game-architecture.md` L232-233, L265, L409-410, L425-426, L511, L607, L990).

Eighth and last story of the v2.3 catch-up (`sprint-change-proposal-2026-11-03.md` §3: 3.12, 2.11, 3.13, 2.12, 2.13, 3.14, 3.15, **3.16**, then a playtest, then E9). One of the two « deep sim » stories (§ Effort): it touches the end of the level and moves every golden. It builds on 3.15 (séquelles, merged in `3634a51`), which left the gag-to-category mapping to this story (3.15 › Out of scope).

**The design (GDD v2.3, mechanic 14, `gdd.md` L222-234; « Conditions de victoire et d'échec » L105-117).** A 0-100 % gauge, shown in play as Mama's worried face beside the timer. Every gag raises it by its category; it falls by 0.5 %/s and by 5 % per perfect; the rises are multiplied by the tier (×0.5 / ×1 / ×1.25, `gdd.md` L415-419). Above 70 % Mama's face is alarmed, the music tightens, a sound and a vibration fire. At 100 % Mama comes home early: the level ends at once with no final rush, the photo freezes the chaos, the result shows « Maman est rentrée plus tôt ! » and 0 stars whatever the score. During the final rush the gauge is frozen (the door is already open). If noise and catastrophe are full in the same step, the catastrophe wins. « Niveau perdu » is a design term: the player never reads « perdu », « échec » or « game over » (`EXPERIENCE.md` L140).

**Where the game is today (main `3634a51`, salon, normal tier, 200 runs from seed 1000, measured by 3.15):** `idle` 199 `timer` / 1 `mamaWoke`, 46.5 gags per run, 0★; `human` (ring on, the default) 164 `timer` / 36 `mamaWoke`, 3.2★, **2.9 gags per run**; `perfect` no gag at all. With so few gags, `human` may well lose far less than the GDD's 10-30 % with the GDD's starting values: see AC 20 and D13 (measure, then Geo decides).

## Acceptance Criteria

### The gauge in the sim (`src/sim/gauges/catastrophe.ts`, `feel.json › catastrophe`)

1. **Given** `content/feel.json › catastrophe`, **when** the feel is loaded, **then** it holds `risePct` `{ nearMiss: 35, mess: 20, microSleep: 15, choreBeat: 10 }`, `decayPerSec` 0.5, `perfectDropPct` 5, `alertPct` 70 and `faceStepsPct` `[25, 50]` (the frowning and worried thresholds of the face, D8), and each `feel.difficulty` tier gains `catastropheMultiplier` (`assistance` 0.5, `normal` 1, `experienced` 1.25). The schema is strict (camelCase, unit suffixes, no `.default()` / `.optional()`), refuses a `faceStepsPct` that is not strictly ascending or not below `alertPct`, and `content/_schemas/feel.schema.json` is regenerated (`npm run content:schemas`).
2. **Given** a threat def, **when** content is checked, **then** it declares `catastrophe: 'nearMiss' | 'mess' | 'microSleep' | 'none'` (required, D1): `outlet` and `stairs` → `nearMiss`; `coffee_table_object` and `silence_mischief` → `mess`; `papa_microsleep` → `microSleep`; the six E4 defs (`arms_cry`, `bedtime_eyes`, `bomb_drop_lay`, `fake_sleep`, `false_alarm_sigh`, `real_wake`) → `none`. `createSim` and `npm run content:check` refuse a def whose category does not match the category of each gag it can end in (`CATASTROPHE_OF_GAG` in `gags.ts`, its `gag` and every `surpriseGags` entry), with the same sentence (the `afterEffectProblem` pattern of 3.15).
3. **Given** a gag (`GagTriggered`) in any level and any live flow state but `finalRush`, **when** the step's gauges run, **then** `world.gauges.catastrophePct` rises by `risePct[category] × difficulty[tier].catastropheMultiplier`, held to `[0, 100]`, and `CatastropheChanged{t, source: <category>, catastrophePct, deltaPct}` is emitted with the change after the clamp (none when the change is 0, e.g. a `none` category or already at 100). A gag in a special sequence counts like any other (the micro-sleep of `stay_awake` is `microSleep`).
4. **Given** a perfect response (`ResponseResolved{quality: 'perfect'}`), **when** the step's gauges run, **then** the gauge falls by `perfectDropPct` (not multiplied by the tier), with `CatastropheChanged{source: 'perfect'}` when it really moved; a success or a beat (`BeatHit`) does nothing.
5. **Given** any live step outside `finalRush`, **then** the gauge decays by `decayPerSec` per second of sim time, silently (no event: the `decayNoise` rule of 3.1 D5), before the step's rises and drops are applied.
6. **Given** the flow in `finalRush`, **when** gags, perfects, steps or a `SetCatastrophe` happen, **then** the gauge does not move at all (no rise, no drop, no decay, no event): it is frozen at its value at the rush's start.
7. **Given** the debug command `SetCatastrophe{t, pct}` (journaled like `SetNoise`, validated as a finite number), **when** it is applied, **then** it sets the gauge to `pct` held to `[0, 100]` through the gauge's own writer, source `debug`, last in `runGauges` (so `SetCatastrophe{pct: 100}` ends the level in the same step); it is ignored in `finalRush`.

### Mama comes home early (`runFlow`, `endLevel`)

8. **Given** the gauge at 100 % at the end of `runGauges` in a live level, **when** `runFlow` runs, **then** the level ends on `LevelEnded{reason: 'mamaHome'}`: no `MamaWoke`, no `FinalRushStarted`, no door spill, the flow goes to `ended` (not `photo`), and everything `endLevel` closes today is closed the same way (sequence, phone, silence, instinct, séquelles), then the frozen near misses (GDD L494: « quelle que soit la façon dont il finit ») and `LevelScored` in the same step.
9. **Given** the gauge and the noise both at 100 % in the same step (Sieste), or the gauge at 100 % in the step the bedtime cycle is completed or the timer runs out, **then** the reason is `mamaHome` (order in `runFlow`: catastrophe, noise, cycle, timer, rush).
10. **Given** a `mamaHome` end, **when** the note is computed, **then** the five rows and the score are those of the room as it is (unchanged rules), `stars` is 0 and `lostStars` is 0 whatever the score (`EXPERIENCE.md` L118: every slot a dashed empty star, no chip); `mamaWoke` and `timer` / `cycleDone` notes are unchanged.
11. **Given** the world after any end, **then** `world.flow.endReason` holds the `LevelEndReason` (null while the level is live), the snapshot checks it, and the snapshot version goes 30 → 31.

### The client (HUD face, alert, music, door, result)

12. **Given** any level (catastrophe-face is « in every level », `EXPERIENCE.md` L214), **when** it is played, **then** Mama's face sits in the timer zone, attached to the `hud-timer` beside its variant icon (`DESIGN.md` L282-295, L606): a round paper chip with an ink outline, 44 px (36 px when the timer is compact), drawn in ink in 4 states from the gauge each frame: `serene` below `faceStepsPct[0]`, `frowning` from it, `worried` from `faceStepsPct[1]`, `alarmed` strictly above `alertPct`. It never shows a number or the score; its `aria-label` names Mama's worry in words from `strings.fr.json`. Under 50 % and not changing it is at 70 % opacity, like the gauges. It is not a fourth gauge in the gauge pill, and the HUD stays within its node budget (`ui.spec.ts`).
13. **Given** the face `alarmed`, **then** it wears a 3 px `gauge-warn` ring that pulses under 3 Hz (1 Hz or slower under reduced motion); the expression, not the hue, carries the state.
14. **Given** a `CatastropheChanged` that crosses `alertPct` upwards (`catastrophePct − deltaPct ≤ alertPct < catastrophePct`, the rule of `isNoiseAlertCrossing`), **then** the client feedback event `CatastropheAlertReached` plays the cue `catastrophe_alert`: a sound, a visual (`uiElement`) and a vibration (ADR-006: no audio without its two twins). It fires again on the next upward crossing.
15. **Given** the gauge strictly above `alertPct` in a live level, **then** the music is tense (`setMusicMood`'s first argument is « a threat is up, or Mama is alarmed »), from the world's state each frame, so a pause, a restart or the end never leaves it tense.
16. **Given** a `mamaHome` end in a level that has a door, **when** the photo is taken (`LevelScored`, same step), **then** the door is drawn fully open (it bursts open: no swing, no key sound, no spill), and the photo shows the room frozen at that step.
17. **Given** the Result screen after `mamaHome`, **then** after the photo the header « Maman est rentrée plus tôt ! » (`result.mama_home`) comes up in the place and style of « Maman s'est réveillée ! », with the door-slam slam and its cue (`ResultMamaHomeShown` → `mama_home`: the door-slam sound, a visual, a heavy vibration), the rows count up, the five star slots are dashed empty stars with no chip, « Rejouer » is primary. No string the player can see after a `mamaHome` end contains « perdu », « échec », « game over » or « mort » (a test scans the new strings).
18. **Given** a dev or playtest build (`isMirrored`), **then** `data-pp-catastrophe` (whole %) and `data-pp-catastrophe-face` (the state) mirror the gauge, and `data-pp-end-reason` reads `mamaHome` after such an end.

### Bots, report, journals

19. **Given** `npm run sim`, **when** the report is written, **then** `endsByReason` has a `mamaHome` key (every key present), each run has `mamaHomeAtMs` and `catastrophePeakPct`, and the report gains `mamaHomeMeanAtMs` and `meanCatastrophePeakPct`; every existing field stays (no rupture of `playtest:metrics`).
20. **Given** the normal tier and 200 games of the salon (`salon_crawler`, seed 1000), **when** the bots play, **then** `human` (ring on) ends on `mamaHome` in 10 to 30 % of the games, `perfect` never, `idle` in all 200 (« niveau perdu » means `mamaHome` only: a `mamaWoke` is not a lost level). If the GDD's starting values miss the band, the dev does not tune silently: see D13.
21. **Given** a game that ended on `mamaHome` (a `npm run sim --journals` run file, and a journal exported from the Result screen), **when** `npm run sim:replay` replays it, **then** it ends in the same state with the same reason (exit 0); the exported journal's `summary.endReason` is `mamaHome`.

### Regressions and docs

22. **Given** the whole suite, **then** the goldens are regenerated deliberately (`npm run golden:update`, said in the Completion Notes) after checking that every existing golden ends on the same reason as before (or, if one now ends on `mamaHome`, that it is intended and said); two new goldens pin `catastrophe_mama_home` (a gag cascade that ends the level) and `catastrophe_rush_frozen` (gags in the rush move nothing).
23. **Given** `npm run sim -- --bot human --seed 1` (ring on), **then** it still ends on `timer` (the autoplay specs need a whole level), or Geo picks another seed (Traps).
24. **Given** the docs, **then** `CLAUDE.md` (the `npm run sim` line: `mamaHome`), `_bmad-output/project-context.md` (the gauge, the command, the end reason) and `deferred-work.md` (D1's E4 categories, 3.7 / 7.4 hand-offs, the replay « cascade ») are updated.

## Tasks / Subtasks

- [x] **Task 1: Content and schemas** (AC 1, 2)
  - [x] `src/content/schemas/feel.ts`: `CatastropheSchema` (D2), `catastropheMultiplier` in `difficultyTier`; refines for `faceStepsPct`. `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`.
  - [x] `src/content/schemas/threat.ts`: `catastrophe` in `baseShape` (export `THREAT_CATASTROPHE_CATEGORIES` / type). All 11 `content/threats/*.json`, the `tests/support/test*.threat.json` copies and `tests/threats/fixtures/test_{firm,wait}.json`.
  - [x] `src/sim/threats/gags.ts`: `CATASTROPHE_OF_GAG: Readonly<Record<GagId, ThreatCatastrophe>>` and `catastropheProblem(defId, gags, category)`, exported from `@sim`; called in `createSim › simLevelOf` and `tools/content/contentChecks.ts` beside `afterEffectProblem`.
  - [x] `npm run content:schemas`; `npm run content:check`; schema tests (each refine able to fail).
- [x] **Task 2: The gauge** (AC 3-7)
  - [x] `world.gauges.catastrophePct` (0 at start; `snapshot.ts › gaugesProblem` checks a finite value in `[0, 100]`), `src/sim/gauges/catastrophe.ts`: `addCatastrophe(world, ctx, deltaPct, source)` (the only writer with `decayCatastrophe`), `runCatastrophe(world, ctx)` (D3). Called from `runGauges` after `runBladder`; `SetCatastrophe` applied after `SetNoise` / `SetBladder`.
  - [x] `CatastropheChanged` and `CatastropheSource` in `events.ts`, in `SIM_EVENT_TYPES` (alphabetical). `SetCatastrophe` in `commands.ts` (union, list, validation). Exports in `src/sim/index.ts`.
  - [x] Unit tests: each category × each tier, the clamp, perfect drop (not multiplied), success and beat do nothing, silent decay, frozen rush, debug command, a gag in a sequence, no event on a 0 change.
- [x] **Task 3: The end** (AC 8-11)
  - [x] `LevelEndReason` gains `'mamaHome'` (and `LEVEL_END_REASONS`). `runFlow`: catastrophe check first (D5). `endLevel` writes `flow.endReason`; no `MamaWoke` for `mamaHome`.
  - [x] `computeMamaScore(tally, mama, reason)` (D6); `scoreLevel` passes the reason.
  - [x] `world.flow.endReason`, snapshot 30 → 31 (the version comment says what 31 adds) and its check (null iff live).
  - [x] Tests: ties with noise, cycle and timer; a sequence under way is closed; frozen near misses still counted; stars 0 / lostStars 0; snapshot round trip.
- [x] **Task 4: Tests that are not about the catastrophe, and the goldens** (AC 22)
  - [x] `npm run ci:fast`; any test whose gags now end the level early gets the `NO_CATASTROPHE` feel patch (D14), never a weaker live value. List them in the Completion Notes.
  - [x] Check the end reason of every golden before regenerating; add `catastrophe_mama_home` and `catastrophe_rush_frozen` to `tests/golden/scenarios.ts` with a test file; `npm run golden:update` and say so.
- [x] **Task 5: The client** (AC 12-18)
  - [x] `src/client/ui/hud/catastropheFace.ts` (+ test): `createCatastropheFace(doc, {t})`, `setPercent`, `setCompact`, `frame`; the four SVG faces (D8); CSS in `ui.css` (ring, pulse ≤ 3 Hz, reduced motion ≤ 1 Hz, idle opacity). Mounted by `timerHud` (beside the variant icon) or in the timer zone by `hudLayer`, fed through `hudBatch` like the gauges.
  - [x] `src/client/feedback/catastropheAlert.ts` (`isCatastropheAlertCrossing`, + test); `CatastropheAlertReached` and `ResultMamaHomeShown` in `FEEDBACK_CLIENT_EVENTS`; cues `catastrophe_alert`, `mama_home` and their event rows in `content/feedback.json` (D9).
  - [x] `boot.ts`: face values, alert, music mood, mirrors, `resultEndReason`; `doorView.ts` open on `mamaHome` (D7); `resultScreen.ts`: `mamaHome` header, `pp-result-panel-home`, `onMamaHome`, dashed empty stars.
  - [x] `strings.fr.json`: `result.mama_home` « Maman est rentrée plus tôt ! », the face's four `hud.catastrophe_*` labels (D8); the forbidden-words test.
- [x] **Task 6: Report, replay, measurements** (AC 19-21, 23)
  - [x] `tools/sim/simReport.ts` (+ `simArgs` help text): fields of AC 19; `tests/tools/sim/*` whole-report fixtures gain them.
  - [x] Replay tests: a run file and a client journal ending on `mamaHome` replay to the same state.
  - [x] 200-run measurements (D13) for `human`, `perfect`, `idle`, plus `human --seed 1`. **Halt for Geo if AC 20 or AC 23 is not met.**
- [x] **Task 7: e2e and docs** (AC 12-18, 24)
  - [x] `tests/e2e/catastrophe.spec.ts` (Testing). Then the specs the change touches, Chromium, in the background: `npm run e2e -- tests/e2e/catastrophe.spec.ts tests/e2e/mamaWoke.spec.ts tests/e2e/photo.spec.ts tests/e2e/finalRush.spec.ts tests/e2e/result.spec.ts tests/e2e/journal.spec.ts tests/e2e/adaptiveMusic.spec.ts tests/e2e/ui.spec.ts tests/e2e/timer.spec.ts tests/e2e/feedback.spec.ts tests/e2e/testApi.spec.ts tests/e2e/chambreNight.spec.ts tests/e2e/autoplay.spec.ts --project=chromium` (all exist at the story's creation).
  - [x] `CLAUDE.md`, `project-context.md`, `deferred-work.md` (AC 24). `npm run ci:fast` green. `ci:story` is the review's.

## Dev Notes

### Decisions

- **D1. The category is data on the threat def, checked against the gag.** The GDD says each threat « doit déclarer sa séquelle et sa hausse de catastrophe » (L220): `catastrophe` is a required field of the def, the values per category are in `feel.catastrophe.risePct`. `CATASTROPHE_OF_GAG` (typed on `GagId`, like `NEAR_MISS_GAGS` and `AFTER_EFFECT_OF_GAG`) pins which category each gag belongs to, so two defs sharing a gag cannot disagree. **The outlet is a `nearMiss` for the catastrophe (GDD L226, L317) but is NOT a `NearMiss` for Mama's Hurlement** (`NEAR_MISS_GAGS.outlet_hair` stays `false`, story 1.16 D3 / 3.6 D2): do not touch `NEAR_MISS_GAGS`, `isNearMissGag` or the scream. The six E4 gags are `none` (GDD L220: « les gags des séquences spéciales sont à chiffrer avec E4 »): deferred-work. `choreBeat` is in `risePct` only (FR73, 9.4 / 9.5 will emit it); it is not a threat category.
- **D2. `feel.catastrophe` and the tier.** Shape of AC 1. Names follow `feel.noise` (`decayPerSec`, `alertPct`). The multiplier sits in `feel.difficulty.<tier>` beside `windowMultiplier`, read through `activeDifficulty(world, ctx)` (the one reader of `feel.difficulty`). It multiplies the rises only: the GDD column is « Hausse de la jauge » (L415) and the perfect drop and the decay are not rises.
- **D3. Event-driven, like the noise.** `runCatastrophe` scans this step's events (`t === now`, from the end, then in emission order, the `runNoise` loop) for `GagTriggered` and `ResponseResolved{perfect}`. The category comes from the def: `world.threats` is index-aligned with `ctx.level.threats` (find the index by `threatId`, then `ctx.level.threats[i].def.catastrophe`). The threats never call the gauge (architecture L233: the gauge is a gauge, it runs with the gauges, before the score and the flow, which read it in the same step). `CatastropheChanged` is pushed past `end` and never rescanned. Field names follow `NoiseChanged` (`catastrophePct`, `deltaPct`, `source`), not the architecture's sketch `value` / `delta` (unit suffixes are mandatory): a deliberate variance, say it in the Completion Notes. `CatastropheSource = ThreatCatastrophe-without-none | 'choreBeat' | 'perfect' | 'debug'`.
- **D4. Frozen in the rush, live everywhere else.** `isFlowLive && state !== 'finalRush'`: the `sequence` state is live (a sequence's gags count). No level flag: every level has the gauge (`EXPERIENCE.md` L214, GDD L479).
- **D5. `runFlow`'s order.** catastrophe (`>= GAUGE_MAX_POINTS`), noise, cycle, timer, then the rush start. The rush cannot start in a step where the gauge is full: the check comes first.
- **D6. 0 stars, no lost stars.** `computeMamaScore(tally, mama, reason: LevelEndReason)` replaces the `isMamaWoke` boolean: `mamaWoke` keeps its penalty, `mamaHome` gives `stars: 0, lostStars: 0`, the rows and `scorePoints` unchanged (`EXPERIENCE.md` L340: « the rows still count up, but the result is 0 stars, whatever the score »). `LevelScored`'s shape does not change.
- **D7. The door bursts open.** `doorOpenAngleDegAt` takes the end reason (or the view reads `world.flow.endReason`): `mamaHome` → `openAngleDeg` at once, no smoothstep (the photo is taken in the same step, a swing would never show). No spill (GDD L116 ties it to the rush), no key cue. A level with no door draws nothing.
- **D8. The face.** Four inline SVGs in ink on paper, built with `svgElement` like `napIcon` (`timerHud.ts`): serene (soft smile), frowning (one brow, flat mouth), worried (both brows up, wavy mouth), alarmed (wide eyes, open mouth). The state comes from the world each frame (state, not events, like the music and the instinct vignette). `faceStepsPct` and `alertPct` from `levelFeel()`. Labels: `hud.catastrophe_serene` « Maman sereine », `hud.catastrophe_frowning` « Maman fronce les sourcils », `hud.catastrophe_worried` « Maman s'inquiète », `hud.catastrophe_alarmed` « Maman va rentrer ! » (French, no number; adjust the wording if a test or Geo asks). The 2D Mama of 3.7 (result screen, not built) is a separate drawing: do not wait for it.
- **D9. Cues.** `catastrophe_alert`: audio `env_door_key` (a key in the lock: Mama is on her way; existing clip, E7 replaces it) on `sfx`, visual `uiElement`, haptic `medium`. `mama_home`: the `mama_woke` cue's door slam (`env_door_slam`), visual `uiElement`, haptic `heavy`. No new `HAPTIC_KINDS` entry. The face's alarmed ring is the alert's visual twin (as the gauge shake is the noise alert's).
- **D10. Mirrors and the test API.** `ppSend({type: 'SetCatastrophe', pct})` works through the existing command path; mirror `ppCatastrophe` when a `CatastropheChanged` comes and at level load (`mirrorNoise` pattern); `ppCatastropheFace` from the face's state.
- **D11. Report.** `mamaHomeAtMs` (the `LevelEnded{mamaHome}` time) and `catastrophePeakPct` (max `catastrophePct` over the run's `CatastropheChanged`; decay is silent, so the peak is exact) per run; means over the runs where they apply (null when none). `endsByReason` gets the key from `LEVEL_END_REASONS` automatically.
- **D12. Journal.** `summary.endReason` is already `z.string()`: no journal version change. The run-file format is unchanged.
- **D13. The loss rate: measure, then Geo decides.** First measure AC 20 with the GDD's values. If `human` is outside 10-30 % (likely below: 2.9 gags per run), do not change `feel.json` on your own. Measure 2-3 options for the run only (value changed, run, value put back, as 3.14 did for the Calme): e.g. a smaller `perfectDropPct`, a smaller `decayPerSec`, larger rises; give each option's `human` / `idle` / `perfect` `endsByReason`, mean stars and `human --seed 1` end, and stop for Geo (the GDD L629: « le rythme des menaces se règle pour tenir ces cibles », L677: values to tune with the bots). The rest of the story can be finished and reviewed meanwhile.
- **D14. Tests that are not about the catastrophe.** The live values stay in `tests/support/testFeel.json` (it mirrors `feel.json`). A unit test, bot test or golden that now ends early on `mamaHome` and is not about it gets an explicit patch (`NO_CATASTROPHE`, all `risePct` 0, in `tests/support/`), applied through the test's own feel (or `SetFeel`), with a one-line comment. Never lower the live values to keep a test green.

### What Geo does

Nothing during the dev, except answering D13's halt if it comes (pick an option in chat). After the merge, the playtest of the catch-up checks the feel of the gauge (« aucun ne juge la défaite injuste », GDD L628).

### The current code this story changes

- `src/sim/gauges/gaugesSystem.ts › runGauges` (L18-41): debug `SetFatigue`, `runFatigue`, `runNoise`, `runBladder`, debug `SetNoise`, debug `SetBladder`. Add `runCatastrophe` after `runBladder` and `SetCatastrophe` last. The doc comment lists the order: update it.
- `src/sim/gauges/noise.ts` / `noiseSystem.ts`: the model for `catastrophe.ts` (writer with clamp, silent decay, event scan of the step). Do not refactor them into a shared helper.
- `src/sim/flow/flowSystem.ts › endLevel` / `runFlow`: `endLevel` closes sequence, phones, silence, instinct, séquelles (`endAfterEffects`, 3.15), sets `ended` or `photo`, emits `MamaWoke` (mamaWoke only), `LevelEnded`, frozen near misses, `scoreLevel`. `runFlow` checks noise, cycle, timer, rush.
- `src/sim/events.ts`: `LevelEndReason` / `LEVEL_END_REASONS` / completeness proof; `SIM_EVENT_TYPES` sorted (`events.test.ts` checks it).
- `src/sim/scoring/mamaScore.ts`: `computeMamaScore(tally, mama, isMamaWoke)`; tests pin D7 of 3.12 (« Geo » tally) and the woken penalty: keep them.
- `src/sim/world.ts`: `GaugesSlice`, `FlowSlice`, `createWorld`. `src/sim/snapshot.ts`: `gaugesProblem`, the flow check, version 30 (3.15) → 31.
- `src/sim/threats/gags.ts`: `GAG_IDS`, `GAG_CONSEQUENCES`, `NEAR_MISS_GAGS`, `AFTER_EFFECT_OF_GAG` / `afterEffectProblem` (3.15).
- `src/sim/threats/threatFsm.ts › resolveThreat / gagThreat`: **not changed** (D3). 3.7 will add `changePapaLook` right after `applyGag`: no conflict if this story stays out.
- `src/client/ui/hud/timerHud.ts`, `hudLayer.ts` (zones `gauges`, `timer`, `pause`), `gaugesHud.ts` (idle / warn rules to mirror), `hudBatch`.
- `src/client/boot.ts`: music mood (~L1210, `audio.setMusicMood(isTension, isSlowMo)`), HUD writes (~L1230-1260), noise alert (~L1460), mirrors (`mirrorNoise` ~L673, `LevelEnded` ~L1480), `resultEndReason` (~L963, L1547), `LevelScored` → `finish()` → photo → `result` (~L1550-1568). Lines move: search.
- `src/client/ui/screens/resultScreen.ts`: `endReason` options, `pp-result-panel-woken`, header (`result.mama_woke`, slam), `onMamaWoke`, stars (`lostCount`). `src/client/render/views/doorView.ts › doorOpenAngleDegAt`.
- `src/client/feedback/feedbackEvents.ts`, `noiseAlert.ts`, `content/feedback.json` (`cues.mama_woke`, `cues.noise_alert`, `events`).
- `tools/sim/simReport.ts` (`RunSummary`, `SimReport`, `emptyEndsByReason`, mamaWoke fields as the model).

### What must keep working

- Every existing end: `timer` (with or without a rush, `photo`), `mamaWoke` (penalty, header, door slam), `cycleDone` (`chambreNight.spec.ts`).
- The noise gauge, its alert and the « Calme » row (3.12): untouched.
- The séquelles of 3.15 and `endAfterEffects` at the end.
- `perfect` has 0 gags on the salon (3.13, 3.15): it must end 200 / 200 on `timer`.
- `sim:replay` of every existing golden and of older journals (a `mamaHome` reason is new data, old files never have it).
- The autoplay specs (`characters`, `juice`, `autoplay`, `perf.spec.ts` in `e2e:dist`) with `?autoplay=human&seed=1`: they need a whole level (AC 23).
- `idle` autoplay specs (`autoplay.spec.ts` « bad seed », `chambreNight.spec.ts` « the idle bot never gets there », the copy-log spec): they now end earlier, on `mamaHome`; their assertions (`data-pp-app=result`, not `cycleDone`) still hold. Check them.

### Traps

- **Gags pile up fast in tests.** Three near misses within ~10 s end the level at Normal. Fatherly Instinct tests (3 misses quickly), director / fairness / threat-system tests with failing presses, the `idle` bot tests and several goldens fail many threats on purpose. Run `ci:fast` right after Task 2-3 and apply D14 where the test is not about the catastrophe.
- **Draw order.** The gauge draws nothing from `world.rng`; the director's baseline traces must not move except for the new events. If a hash of the rng moves, something else changed.
- **Snapshot version.** 3.15 made it 30. Make it 31 and extend the comment; 9.2 (camera) and 3.7 / 7.4 are stale ready-for-dev stories that predate it and will conflict on it, not your problem.
- **Clamp and the tie.** `runFlow` reads `>= GAUGE_MAX_POINTS` (100). Rounding: rises are 35 × 1.25 = 43.75 etc.: keep floats, do not round in the sim.
- **`SIM_EVENT_TYPES` is sorted** and the feedback table's event names are checked against it and `FEEDBACK_CLIENT_EVENTS`.
- **Whole-report tests** (`simReport.test.ts`, `runSim`, `cli`): add the new fields, drop none (3.12-3.15 trap).
- **The empty star is not dashed today** (`.pp-star-empty .pp-star-shape`: filled at 0.2 opacity, solid ink-soft stroke, `ui.css` ~L1201). Add the dash for the `mamaHome` panel only (`.pp-result-panel-home .pp-star-empty .pp-star-shape { stroke-dasharray: … }`), so other results do not change (screenshots of `autoplay.spec.ts` are macOS references).
- **HUD node budget.** `ui.spec.ts` « keeps its zones, the free bottom third, the band and the node budget » counts nodes: the face adds an `svg` with a few paths; keep the four faces as one `svg` whose paths are swapped, or as four groups toggled by class, whichever stays in budget.
- **`VITE_DEBUG_ALLOWED`.** Not exported in this shell at the story's creation; check `env | grep VITE_` before `dev` or `e2e`, and run them as `(unset VITE_DEBUG_ALLOWED; …)` if set.
- **Heavy checks queue** (`tools/ci/heavyLock.sh`): `npm run e2e -- …` in the background, never `npx playwright test`. 200-run sims take minutes each (~17 s per 200 for human in 3.14, more with séquelles): background, under `caffeinate -i -s`.
- **The worktree guard** refuses compound shell commands with variables in an option position or computed paths (`for b in …; npm run sim -- --bot $b`): write one plain command per bot, or one script file in the scratchpad.

### Out of scope

- Mama's reaction (scream) on the result after `mamaHome` (GDD L114, `EXPERIENCE.md` L340): story 3.7 (mum-bubble, `mamaReactionsOf`); add to deferred-work that 3.7 must give `mamaHome` its scream.
- The replay « cascade » of gags that brought Mama home (GDD L537): story 3.9.
- The Retour variant (FR33, story 3.10) and a variant-specific header (in Sieste the GDD says Mama « débarque, réveillée par un mauvais pressentiment »; the only string is « Maman est rentrée plus tôt ! », AC as written: open point).
- Chore beats (`choreBeat` category exists in `feel.json` only; E9 9.4 / 9.5 emit it) and the E4 gag categories (D1).
- `failStreak` / progress with 0 stars (3.11); the « finale » of 7.4 must not fire after `mamaHome` (deferred-work note for 7.4).
- Changing the director, the threat rhythm, the bots' behaviour or the note's formula (D13 measures; Geo decides).

### Architecture compliance

- Layers: the gauge in `src/sim/gauges/catastrophe.ts` (architecture L507, L602), relative imports inside `src/sim`; the client reads `World` and `SimEvent`s through `@sim`; content schemas import only `shared` and `zod`; constants in `src/shared/constants.ts` (`GAUGE_MAX_POINTS` already exists).
- The sim never logs, never reads real time or `Math.random`; it emits `CatastropheChanged` and `LevelEnded{mamaHome}`.
- System order unchanged (`step.ts`): `runCatastrophe` is called from `runGauges`, not added to `SYSTEMS` (pinned-order test stays).
- ADR-006 / story 2.4: every cue with audio has a visual and a haptic (`feedback.json` test). Reduced motion is the client's; nothing flashes faster than 3 Hz.
- Every number Geo might tune is in `feel.json` (rises, decay, drop, alert, face steps, tier multipliers); the face's sizes and pulse are CSS (looks, not feel, like the gauge shake).
- No `console.*`; I/O returns `Result`; every fallback logs a `warn`.

### Library and framework notes

Stack pinned, nothing added: TypeScript 7 (`erasableSyntaxOnly`: string-literal unions, no `enum`), Zod 4 (`z.strictObject`, `.refine`), Three.js 0.186.1 (only the door's yaw changes), Vitest 5, Playwright 1.64, Biome 2.6. No web research needed: the story uses no API the codebase does not already use.

### File structure

- **New:** `src/sim/gauges/catastrophe.ts` (+ `catastrophe.test.ts`, `catastropheSystem.test.ts` or one file); `src/client/ui/hud/catastropheFace.ts` (+ test); `src/client/feedback/catastropheAlert.ts` (+ test); `tests/golden/catastrophe.test.ts` and its journals; `tests/e2e/catastrophe.spec.ts`; `tests/support/noCatastrophe.ts` (or a constant in an existing support file).
- **Updated:** `src/content/schemas/{feel,threat}.ts`; `content/feel.json`, `content/threats/*.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/{feel,threat}.schema.json` (generated); `src/sim/{events,commands,world,snapshot,index}.ts`, `src/sim/gauges/gaugesSystem.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/scoring/mamaScore.ts`, `src/sim/threats/gags.ts`, `src/sim/createSim.ts`; `tools/content/contentChecks.ts`; `src/client/{boot}.ts`, `src/client/ui/hud/{timerHud,hudLayer}.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/styles/ui.css`, `src/client/render/views/doorView.ts`, `src/client/feedback/feedbackEvents.ts`; `tools/sim/{simReport,simArgs}.ts`; test fixtures under `tests/support/`, `tests/threats/fixtures/`, `tests/tools/`; `tests/golden/scenarios.ts` and every golden journal (regenerated); `CLAUDE.md`; `_bmad-output/project-context.md`; `_bmad-output/implementation-artifacts/deferred-work.md`.

### Testing

- **Sim unit (`src/sim/gauges/catastrophe*.test.ts`, `flowSystem.test.ts`, `mamaScore.test.ts`, `snapshot.test.ts`, `commands.test.ts`, `events.test.ts`):** one test per AC 3-11 rule, each able to fail (the 3.13 lesson: compare two settings on the same seed rather than « some value »). Tier: same cascade at assistance / normal / experienced gives 0.5 / 1 / 1.25 × the rise. Tie: `SetNoise 100` and `SetCatastrophe 100` in the same step → `mamaHome`. Rush: a level with `finalRush`, `SetCatastrophe 60` before the rush, gags in the rush → still 60, no event.
- **Content (`tests/content/`, `contentChecks`):** a def with the wrong category is refused with the shared sentence; the feel refines.
- **Goldens:** AC 22.
- **Client unit:** `catastropheFace.test.ts` (states at the step boundaries, `alarmed` strictly above 70, idle opacity, DOM writes only on change, no allocation per frame), `catastropheAlert.test.ts` (the crossing rule, `debug` counts), `resultScreen.test.ts` (header, slam, `onMamaHome` once, 5 empty dashed slots, no chip), `doorView.test.ts` (open on `mamaHome`), the forbidden-words test over `result.mama_home` and the `hud.catastrophe_*` strings.
- **Tools:** `simReport.test.ts` (new fields, a run ending on `mamaHome`), replay tests (AC 21).
- **E2E (`tests/e2e/catastrophe.spec.ts`, Chromium + WebKit DOM-only for vibrations, frozen level via the test API like `mamaWoke.spec.ts`):** `SetCatastrophe 60` → face `worried`, no alert; `75` → `alarmed`, one `catastrophe_alert` cue, one vibration (Chromium), music tense mirror (`ppMusicTenseCount` moves); `100` → `LevelEnded{mamaHome}`, no `MamaWoke`, `data-pp-end-reason=mamaHome`, photo `taken`, header text, 0 earned and 0 lost stars, no forbidden word in the panel; rush: advance into the rush, `SetCatastrophe 100` → still playing to `photo`; reduced motion: alarmed face stays, pulse class slowed.
- **Checks:** `npm run ci:fast` per task; the touched specs on Chromium (Task 7); `ci:story` is the review's.

### Previous story intelligence

- **3.15 (séquelles, merged `3634a51`):** built the `afterEffect` def field + `AFTER_EFFECT_OF_GAG` + `afterEffectProblem` pattern this story copies (D1); added `endAfterEffects` to `endLevel` (keep its place); bumped the snapshot to 30; regenerated every golden. Its numbers are this story's « before »: `idle` 199 / 1, 46.5 gags per run; `human` ring on 164 / 36, 3.2★, 2.9 gags per run; `perfect` 0 séquelle. It noted « idle always loses will have to come from the catastrophe gauge, not from the noise ». Its review deferred `simReport.afterEffects.meanPerRun` double counts: unrelated, leave it. Open point 5 (the stairs' cost may feel light) is for the playtest after 3.16.
- **3.14 (human bot):** `human` now misses realistically; its Traps on `--seed 1` and the perf spec apply here (AC 23). The `endsByReason` it noted « for 3.16 » (ring on 175 / 25 before séquelles) is superseded by 3.15's 164 / 36. Lesson: when the reference cannot be met as written, stop and let Geo choose (D13), do not fake a measurement.
- **3.12 (five-row note):** `computeMamaScore` is pure and pinned; change its signature (D6) without moving any existing expectation.
- **3.5 / 3.6 (rush, photo):** `endLevel` and `flow.finalRushAt`; the door is a function of world state (`doorOpenAngleDegAt`); the photo is a snapshot at `LevelScored`. `mamaWoke` in the rush ends on `ended`: `mamaHome` cannot happen in the rush (frozen).
- **3.2 (mamaWoke):** the whole template for an early end: `MamaWoke`/`LevelEnded`, `runFlow`'s tie rule, the report's `endsByReason` / `mamaWokeMeanAtMs`, the result header and its slam cue, `mamaWoke.spec.ts`.
- **3.1 (noise):** writer with clamp, silent decay, event scan, the 80 % alert crossing (`isNoiseAlertCrossing`), `SetNoise` applied last.

### Git intelligence

`main` at `3634a51` (merge of 3.15 séquelles: `afterEffects.ts`, snapshot 30, every golden moved, `feel.json` gained `noise.sources.debrisStep`, `gags.debrisStepRadiusM`, `fx.dim`). Before it, `c14ff68` (9.1, Blender salon_kitchen) and `fce389d` (2.13, poses). The 3.16 branch was fast-forwarded to `3634a51` before this file was written. Ready-for-dev stories on other branches, cut from older bases: 3.7 (Mama reactions, result screen, `gagThreat`), 7.4 (finale, `boot.ts` `LevelScored` block, music mute), 9.2 (camera, `feel.json`): whichever merges second regenerates goldens and schemas.

### Project Structure Notes

Follows the layers and aliases: the gauge in `src/sim/gauges`, the category table beside the other gag tables in `src/sim/threats/gags.ts`, the face in `src/client/ui/hud`, the alert rule in `src/client/feedback`. One variance (D3): `CatastropheChanged{catastrophePct, deltaPct, source}` instead of the architecture sketch's `{value, delta}`, for the unit-suffix rule and the `NoiseChanged` model.

### Project Context Rules

- Golden rule: the AI writes and tests the gauge; Geo plays and tunes. Every number is in `feel.json`; D13 stops for Geo rather than tuning silently.
- Units are suffixes (`catastrophePct`, `deltaPct`, `decayPerSec`, `perfectDropPct`, `mamaHomeAtMs`); `…At` is sim time.
- No `enum` (string-literal unions + `as const` lists + completeness proofs, the `LEVEL_END_REASONS` pattern); factories `create<Name>`; files camelCase.
- Events PascalCase past tense (`CatastropheChanged`, `CatastropheAlertReached`, `ResultMamaHomeShown`); commands imperative (`SetCatastrophe`).
- Strings in `content/strings.fr.json`; ids `lower_snake_case`; JSON keys camelCase; generated JSON Schemas committed, never hand-edited.
- No `console.*`; I/O returns `Result`; never weaken a guardrail (Biome, `tests/architecture/`, the main-commit hook, the HUD budget, the perf budget).
- No merge without the review, a green `ci:story` and Geo's OK. This story completes the catch-up, not an epic: `ci:story`, not `ci` (epic 3 still has 3.7-3.11).

### Open points for Geo

1. **The loss rate (D13).** With the GDD's values the realistic `human` probably loses well under 10 %. The dev will measure and stop with 2-3 options; you pick.
2. **Sieste wording.** In a Sieste level Mama is next door, yet the header says « Maman est rentrée plus tôt ! » (the AC and the UX). The GDD's Sieste line is « Maman débarque, réveillée par un mauvais pressentiment ». Keep one string for now, or a variant string later (3.10)?
3. **The E4 gags** (cry in the arms, the bedtime duel, the fake sleep, the drop, the stealth exit) raise no catastrophe yet (GDD: « à chiffrer avec E4 »): `chambre_night` can only end on `mamaHome` through its outlet, table object and micro-sleeps.

### References

- [Source: _bmad-output/planning-artifacts/epics.md › Story 3.16 (L2034-2060), FR33 (L72), FR34 (L73), FR73 (L140), NFR9 (L157), UX-DR13 (L246-252), UX-DR29 (L274), sequence (L399), Epic 3 note (L1650)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md › L75, L103, L105-117 (Conditions de victoire et d'échec), L220-234 (mechanic 14), L247 (chore beat), L300 (haptic), L315-322 (threat catalogue, column Catastrophe), L413-419 (tiers), L479, L494, L499-500, L537, L547, L628-629 (indicators), L677]
- [Source: _bmad-output/planning-artifacts/game-architecture.md › L232-233 (World, order), L265 (feel), L409-410, L425-426 (events), L507, L511, L602, L607, L990]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md › L282-295 (catastrophe-face tokens), L464, L538, L591 (dashed empty stars), L594 (banner), L604-606, L642]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md › L68, L118, L128, L131, L140, L177, L214, L313-315, L340-342, L437, L460, L508 (HUD node budget), L596, L632]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md › §3 order (L79-91), Effort / risks (L75-76), §4.8 architecture (L588-590), §4.9 UX (L598-599)]
- [Source: _bmad-output/implementation-artifacts/3-15-sequelles-des-gags.md › Out of scope (L209), D11, Completion Notes (numbers for 3.16), Review (deferred `meanPerRun`)]
- [Source: _bmad-output/implementation-artifacts/3-14-joueur-simule-humain-realiste.md › Traps (seed 1, perf spec), Completion Notes (`endsByReason` for 3.16)]
- [Source: _bmad-output/implementation-artifacts/3-2-variante-sieste-et-reveil-de-maman.md, 3-5-porte-qui-s-ouvre-et-rush-final.md, 3-6-photo-de-fin-figee.md (the early-end, rush and photo templates)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md › L673 (tier multiplier deferred to this gauge), L528 / L538 (the 70 % alert)]
- [Source: src/sim/gauges/{gaugesSystem,noise,noiseSystem}.ts, src/sim/flow/{flowSystem,flowFsm}.ts, src/sim/events.ts, src/sim/scoring/mamaScore.ts, src/sim/threats/{gags,threatFsm,afterEffects}.ts, src/sim/world.ts, src/sim/snapshot.ts, src/sim/commands.ts, src/sim/timing/difficulty.ts, src/content/schemas/{feel,threat}.ts, src/client/boot.ts, src/client/ui/hud/{timerHud,hudLayer,gaugesHud}.ts, src/client/ui/screens/resultScreen.ts, src/client/render/views/doorView.ts, src/client/feedback/{noiseAlert,feedbackEvents}.ts, src/client/audio/adaptiveMusic.ts, tools/sim/simReport.ts, tests/e2e/mamaWoke.spec.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (claude-sonnet-5-5), via the `gds-dev-story` workflow, in the worktree `story/3-16-jauge-de-catastrophe-et-maman-est-rentree-plus-tot`.

### Debug Log References

- `npm run ci:fast` green at the end (typecheck, lint with the two pre-existing `ui.css` warnings, content:check, 411 test files / 8800+ tests).
- `npm run e2e -- tests/e2e/catastrophe.spec.ts --project=chromium`: 9 passed. The twelve touched specs (mamaWoke, photo, finalRush, result, journal, adaptiveMusic, ui, timer, feedback, testApi, chambreNight, autoplay) on Chromium: 110 passed, 1 failed (the macOS screenshot `autoplay-frozen`, which now shows Mama's face in the timer).
- Measurements (D13) are in the table below; the scripts and raw reports were in the session scratchpad (not committed).

### Implementation Plan

- **Sim.** `feel.catastrophe` + `difficulty.<tier>.catastropheMultiplier` (strict schema, `faceStepsPct` a fixed-length array so the feel panel keeps one control per leaf); `catastrophe` on every threat def with `CATASTROPHE_OF_GAG` / `catastropheProblem` (the `afterEffectProblem` pattern, called by `createSim` and `content:check`); `src/sim/gauges/catastrophe.ts` (`addCatastrophe` and `decayCatastrophe` the only writers, `runCatastrophe` called by `runGauges` after `runBladder`, frozen in `finalRush`); `SetCatastrophe` applied last in `runGauges`; `LevelEndReason` gains `mamaHome`, checked first in `runFlow`; `world.flow.endReason` (snapshot 30 → 31, with its checks); `computeMamaScore(tally, mama, reason)`.
- **Client.** `catastropheFace.ts` (one `svg`, one swapped `path`: three nodes), mounted in the timer pill by `timerHud.mountFace`, fed through `hudBatch` in hundredths of a percent; `isCatastropheAlertCrossing` and the client events `CatastropheAlertReached` / `ResultMamaHomeShown` with cues `catastrophe_alert` / `mama_home`; music tense above `alertPct` from the world each frame; door bursts open on a `mamaHome` (`doorOpenAngleDegAt(…, isBurstOpen)`); Result screen header, slam, `pp-result-panel-home`, dashed empty stars; mirrors `data-pp-catastrophe`, `data-pp-catastrophe-face`.
- **Tools.** `endsByReason.mamaHome`, `mamaHomeMeanAtMs`, `meanCatastrophePeakPct`, per run `mamaHomeAtMs` and `catastrophePeakPct`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (story creation, 2026-11-04).
- **Deliberate variances / decisions to know.**
  - `CatastropheChanged{t, source, catastrophePct, deltaPct}` instead of the architecture sketch's `{value, delta}` (unit suffixes, `NoiseChanged` model), as D3 said.
  - The gauge reads the category from the threat **def** (`ctx.level.threats[i].def.catastrophe`, index-aligned with `world.threats`), not from the gag; the two are proved equal at `createSim` / `content:check`.
  - The unit-suffix guard (`tests/content/feelSchema.test.ts`) gained the four exact keys of `catastrophe.risePct` (`nearMiss`, `mess`, `microSleep`, `choreBeat`) as documented exceptions, like `fatigue.perSec`: AC 1 fixes those names and the group name `risePct` carries the unit.
  - A gag that lifts the gauge to exactly 100 ends the step at 100 after the clamp; one that only reaches it from below ends at `100 − one decay step` (the decay runs first, D3): `runFlow` reads `>= 100`, so a gauge at 99.995 does not end the level. Nothing rounds in the sim.
  - The face is fed through `hudBatch` in **hundredths** of a percent: « alarmed » is strictly above `alertPct`, which a whole percent cannot tell.
- **Tests that are not about the catastrophe (D14), listed.** `tests/support/noCatastrophe.ts` (`withoutCatastrophe`, `createTestContentWithoutCatastrophe`, `silenceCatastrophe`, `NO_CATASTROPHE_PATCH`: every `risePct` at 0, the live values untouched in `testFeel.json`): `src/sim/director/baselineTrace.test.ts`, `src/sim/director/directorSystem.test.ts`, `src/sim/assist/paternalInstinct.test.ts`, `src/sim/baby/carryFuzz.test.ts`, `src/sim/papa/tidyProp.test.ts`, `src/sim/sequences/sequenceSystem.test.ts`, `src/sim/threats/inputLag.test.ts`, `src/sim/scoring/frozenNearMiss.test.ts`, `tests/bots/bedtimeCycleFuzz.test.ts`, `tests/bots/instinct.test.ts`, `tests/content/liveProps.test.ts`, `tests/tools/sim/{phone,silence,microSleep}.test.ts` and `runSim.test.ts` (« plays each idle game to LevelEnded »), and the goldens `threat_trio` and `instinct` (a `SetFeel` at step 0). `tests/tools/sim/cycleLevel.test.ts` accepts `mamaHome` for the idle bot. `tests/bots/botContract.test.ts` replays up to where the game stopped (a bot's game ends with the level). `tests/bots/humanBotRegression.test.ts`: the whole-journal hashes were re-pinned (the feel and the defs changed; `PINNED_COMMANDS` still hold: the human bot plays the same game).
- **Goldens regenerated deliberately** (`npm run golden:update`) after checking each scenario's end: all existing goldens end on the same reason as before (`mama_woke` → `mamaWoke`, `combo_cash_in` and `final_rush_tidied` → `timer`, `bedtime_cycle_won` → `cycleDone`, the others never end); `threat_trio` and `instinct` would have ended on `mamaHome` and got the `NO_CATASTROPHE` patch to keep their original ends. New: `catastrophe_mama_home` and `catastrophe_rush_frozen` (+ `tests/golden/catastrophe.test.ts`). The gags of the other goldens now carry `CatastropheChanged` events.
- **AC 23 met**: `npm run sim -- --bot human --seed 1` ends on `timer` with the GDD values (and with every option below).
- **AC 21 met**: a recorded `idle` run ending on `mamaHome` replays with exit 0 (`sim:replay`), and an exported journal's `summary.endReason` is `mamaHome` and replays to the same world (`tests/tools/sim/journalReplay.test.ts`, `runSim.test.ts`).
- **AC 20 is NOT met as written, and it is Geo's call (D13).** Normal tier, 200 salon games from seed 1000, ring on:

  | values | `human` (timer / mamaWoke / **mamaHome**) | `human` stars | `idle` mamaHome (mean time) | `perfect` mamaHome | `human --seed 1` |
  |---|---|---|---|---|---|
  | **GDD values (what is in `feel.json`)**: rises 35 / 20 / 15, decay 0.5, drop 5 | 147 / 34 / **19 (9.5 %)** | 2.9 | 200 / 200 (22.2 s) | 0 | timer |
  | A: `perfectDropPct` 3 | 143 / 34 / 23 (11.5 %) | 2.9 | 200 (22.2 s) | 0 | timer |
  | B: `decayPerSec` 0.3 | 142 / 34 / 24 (12 %) | 2.8 | 200 (17.9 s) | 0 | timer |
  | C: rises 40 / 25 / 20 | 132 / 33 / 35 (17.5 %) | 2.7 | 200 (17.9 s) | 0 | timer |
  | D: `perfectDropPct` 2 and `decayPerSec` 0.4 | 136 / 34 / 30 (15 %) | 2.7 | 200 (18.5 s) | 0 | timer |

  With the GDD's own numbers `human` loses 9.5 % of the games, just under the 10-30 % band (the 200-game sampling noise is about ±2 points, so this is a hair outside, not far). `perfect` never loses and `idle` always does, as asked. Nothing in `feel.json` was changed for the options (each was a temporary patch, restored): the file holds the GDD values. **Geo picked D (2026-11-04)**: `feel.json` now holds `catastrophe.perfectDropPct` 2 and `decayPerSec` 0.4 (the GDD's 5 and 0.5 are Geo's tuning to depart from, said here). `tests/support/testFeel.json` keeps the GDD values on purpose: no test depends on a tuned value. AC 20 is met with D: `human` 30 / 200 = 15 % on `mamaHome`, `perfect` 0, `idle` 200 / 200, `human --seed 1` on `timer`.
- **Screenshot references regenerated deliberately** (`npm run e2e -- tests/e2e/autoplay.spec.ts --update-snapshots`): `autoplay-frozen-{chromium,webkit}-darwin.png` now show the serene face beside the timer's icon (looked at: the pill, the gauges and the threat are unchanged). `autoplay.spec.ts` passes on both engines.
- **E2E.** `tests/e2e/catastrophe.spec.ts` (9 tests on Chromium; WebKit checks the DOM and the cues only). The face's alarmed pulse is 700 ms (about 1.4 Hz) and 1000 ms (1 Hz) under reduced motion, both asserted from computed styles.
- Open points for Geo (story): the Sieste wording of the header, the loss rate above, the six E4 gags raising no catastrophe: all three are in `deferred-work.md`.

### File List

**New**
- `src/sim/gauges/catastrophe.ts`, `src/sim/gauges/catastrophe.test.ts`
- `src/sim/flow/mamaHome.test.ts`
- `src/client/ui/hud/catastropheFace.ts`, `src/client/ui/hud/catastropheFace.test.ts`
- `src/client/feedback/catastropheAlert.ts`, `src/client/feedback/catastropheAlert.test.ts`
- `tests/support/noCatastrophe.ts`
- `tests/golden/catastrophe.test.ts`, `tests/golden/journals/catastrophe_mama_home{,.expected}.json`, `tests/golden/journals/catastrophe_rush_frozen{,.expected}.json`
- `tests/e2e/catastrophe.spec.ts`

**Modified**
- Docs: `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file
- Content: `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/threats/*.json` (all 11), `content/_schemas/{feel,threat}.schema.json` (generated)
- Schemas and sim: `src/content/schemas/{feel,threat}.ts`, `src/sim/{events,commands,world,snapshot,index,createSim}.ts`, `src/sim/gauges/gaugesSystem.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/scoring/mamaScore.ts`, `src/sim/threats/gags.ts`
- Client: `src/client/boot.ts`, `src/client/feedback/feedbackEvents.ts`, `src/client/render/levelScene.ts`, `src/client/render/views/doorView.ts`, `src/client/ui/hud/timerHud.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/styles/ui.css`
- Tools: `tools/content/contentChecks.ts`, `tools/sim/{simReport,simArgs}.ts`
- Tests and fixtures: `src/sim/**` tests listed in the D14 note and the snapshot / flow / events / commands / score / gags tests; `src/client/render/views/doorView.test.ts`, `src/client/ui/hud/timerHud.test.ts`, `src/client/ui/screens/resultScreen.test.ts`; `tests/bots/*`, `tests/content/*`, `tests/tools/sim/*`, `tests/e2e/support/game.ts`, `tests/golden/{scenarios,stayAwake.test}.ts`, `tests/support/testFeel.json`, `tests/support/test*.threat.json`, `tests/threats/fixtures/test_{firm,wait}.json`, `tests/tools/vite/fixtures/feelSample.json`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-{chromium,webkit}-darwin.png` (regenerated)
- All the other golden journals and references under `tests/golden/journals/` (regenerated)

### Change Log

- 2026-11-04: Story 3.16 implemented: the catastrophe gauge (`feel.catastrophe`, `CatastropheChanged`, `SetCatastrophe`), Mama come home early (`LevelEnded{mamaHome}`, 0 stars, `world.flow.endReason`, snapshot 31), Mama's face, alert, tense music, burst-open door and the Result header on the client, the report fields, two new goldens and the e2e spec. Geo picked option D for the loss rate (AC 20): `perfectDropPct` 2, `decayPerSec` 0.4.
