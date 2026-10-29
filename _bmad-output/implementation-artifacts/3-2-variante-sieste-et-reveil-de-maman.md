---
baseline_commit: b6a2693e57d2fd61a903f3f9863131c7243f9cea
---

# Story 3.2: Sieste variant and Mama waking up

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 3.2 « Variante Sieste et réveil de Maman » (L1563-1588). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want Mama to wake up if I make too much noise,
so that the noise is a real stake up to the last second.

**Requirements covered:**
- **FR32 `[P]`, the Sieste variant:** the normal end comes with the timer (3 min in the prototype). The level ends early when the noise reaches 100 %: Mama is woken and the note loses one star (epics L71, GDD L107).
- **FR18, last sentence:** « À 100 %, Maman se réveille. » (epics L51, GDD L174). Story 3.1 stops the gauge at 100. This story makes that 100 mean something.
- **UX-DR13, the Result screen, state B** (`mockups/key-result.html` L204-240): it shows the header « Maman s'est réveillée ! » with its cue (door-slam sound, visual, vibration). The lost star is a dashed `ink-soft` empty star with a « −1 » chip in `mama-scream` (`DESIGN.md` L515, `EXPERIENCE.md` L114, L224, L326, L558-560).

**What this story is not:**
- **No photo, no polaroid, no Mama line, no `mum-bubble`.** State B of the mockup shows them, but they are stories 3.6, 3.7 and 3.8. This story adds only the header, the lost star and the cue to the 1.22 Result screen.
- **No result actions table.** « Âge suivant », « Frigo », the locked button and the « 2 étoiles pour débloquer » hint are story 3.11. « Rejouer » stays the only primary action, plus « Copier le journal » in debug builds.
- **No door, no final rush.** The door opening (`ANCHOR_door`, `FinalRushStarted`) is 3.5 and the `return` variant is 3.10. The `FlowState` stays `'playing' | 'ended'`.
- **No content tuning in this story's own commit.** With the content of story 3.1 the noise peaks at about 16 % for every bot, so no game ends on `mamaWoke`. Tuning `feel.noise` or adding a live `gagCryMs` is Geo's call (Open point 1). *Review 2026-10-29:* Geo then asked for a first tuning, commit `2566148`: `feel.noise.sources.phoneRinging.perSec` 2 → 7, so a ringing phone left alone now fills the gauge (an ignored ring peaks at about 91 %, `deferred-work.md`). The mechanism is proven on frozen tests and with the debug command `SetNoise`.
- **No change to the noise gauge.** `addNoise`, `runNoise`, `NoiseChanged`, the 80 % alert and the HUD gauge of story 3.1 stay as they are. This story only reads `world.gauges.noisePct`.

**Sources:**
- Epics `epics.md` L51 (FR18), L71 (FR32), L241 (UX-DR13: « Maman réveillée : en-tête dédié et étoile perdue en pointillé avec « −1 » »), L383-386 (Epic 3), L1534-1561 (3.1, previous), L1563-1588 (this story), L1638-1658 (3.5, the door: not this story), L1746-1763 (3.10, `return`: no noise end).
- GDD `gdds/gdd-papa-parade-2026-10-26/gdd.md` L44 (« les bruits de papa menacent (ils réveillent Maman) »), L107 (Sieste row: « La jauge de bruit atteint 100 % : Maman est réveillée par le bruit, la note perd une étoile »), L174 (rule 7), L559 (every number is a starting value).
- Architecture `game-architecture.md` L252 and L400 (`MamaWoke` is a domain event, PascalCase past tense, carries `t`), L958 (E3 prototype row: `src/sim/gauges/noise.ts`, `level.variant = 'nap'`, `src/sim/flow/`, event `MamaWoke`).
- UX `DESIGN.md` L438 (`heading` type: Baloo 2 700 28px, « Maman s'est réveillée ! »), L512, L515 (lost star). `EXPERIENCE.md` L114 (Result actions table, the « Mama woke » row), L172 and L175 (the strings « Maman s'est réveillée ! » and « −1 », both `[ASSUMPTION]`), L224 (« A lost star (Mama woke) stamps last »), L318-330 (State Patterns › Result), L558-560 (journey steps 6-8: « The lost star reads as a gag, not a failure »). Mockup `mockups/key-result.html` L20, L78-80 (`.lost-wrap`, `.minus`), L102 (`#star-lost`), L204-240 (state B).
- Previous stories: `3-1-jauge-de-bruit.md` (D1, D5, D7, Open point 2, Completion Notes table), `1-22-note-de-maman-et-ecran-de-fin.md` (Mama's note, `scoreLevel`, the Result screen sequence, client feedback events `ResultStarStamped`, placeholder clips), `1-18-vagues-de-menaces-et-chrono-du-niveau.md` (`runFlow`, `ENDED_SYSTEMS`), `1-20-le-telephone-qui-sonne.md` and `1-21-le-silence-suspect.md` (`endRingingPhones`, `endSilence` before `LevelEnded`).
- Deferred work `deferred-work.md` L25 (« `earlyWakePenaltyStars` has no max of 5 … tighten when the sim reads these values »: this story reads it), L427 (3.1 Open point 2: « will 3.2 end games? »).

## Acceptance Criteria

Numbers in `content/feel.json` are live starting values for Geo to tune. Tests use the frozen `tests/support/testFeel.json`, never the live file.

### The early end (sim)

1. **Mama wakes at 100 %.** In a level with the noise gauge (`ctx.level.hasNoise`), `runFlow` ends the level at the first step where `world.gauges.noisePct >= GAUGE_MAX_POINTS` (100) after `runGauges` (D1). In that step, in this order:
   1. `endRingingPhones(world, ctx)` and `endSilence(world, ctx)`, exactly as for the timer end (a ringing phone gets `PhoneRingEnded{levelEnded}`, an open silence `SilenceEnded{levelEnded}`).
   2. `enterFlowState(world, 'ended')`.
   3. `MamaWoke{t}`, then `LevelEnded{t, reason: 'mamaWoke'}`, then `LevelScored{…}`, all at the same `t`.
   - From then on `step()` runs `ENDED_SYSTEMS` only, as after the timer: nothing else moves, and the `ended` world is frozen.
   - Every source counts, `debug` too: `SetNoise{pct: 100}` wakes Mama at the next step. The e2e tests and the golden use this.
   - A level without noise can never end this way (its `noisePct` is always 0, which the snapshot checks).

2. **The normal end is unchanged.** When the clock reaches `durationMs` and the noise is below 100, `runFlow` emits `LevelEnded{reason: 'timer'}` with no `MamaWoke` and no penalty. Every existing test, golden and e2e of the timer end passes unchanged.

3. **Both at once: Mama wins** (D2). If, in one step, the clock reaches `durationMs` **and** the noise reaches 100, the end is `mamaWoke`: the noise is checked first. A unit test pins this.

4. **Event and reason types** (`src/sim/events.ts`):
   - `LevelEndReason` becomes `'timer' | 'mamaWoke'`, with a `LEVEL_END_REASONS` constant (`['timer', 'mamaWoke'] as const`). A compile-time completeness proof is written like `FLOW_STATES_ARE_COMPLETE`, and the const is exported from `@sim`. The report and the client type their per-reason records from it.
   - The new event is `MamaWoke{t: SimMs}`, documented: « Mama was woken by the noise (story 3.2): the noise reached 100 % in a Sieste level. Right before `LevelEnded{mamaWoke}`, at the same `t`. »
   - `SIM_EVENT_TYPES` gains `'MamaWoke'`, stays sorted, and its completeness proof passes.
   - The `LevelEndReason` doc and the `runFlow` doc lose their « story 3.x » placeholders.

### The lost star (sim)

5. **The penalty.** `computeMamaScore(tally, mama, isMamaWoke)` (`src/sim/scoring/mamaScore.ts`) gains a third parameter (D3):
   - `baseStars = starsForScore(scorePoints, mama.starThresholdPoints)`. The points do not change: Mama's four rows and the score are those of a timer end.
   - `lostStars = isMamaWoke ? Math.min(mama.earlyWakePenaltyStars, baseStars) : 0`: the note never goes below 0 stars.
   - `stars = baseStars − lostStars`.
   - `MamaScore` (`world.ts`) gains `lostStars: number`, documented: « Stars Mama took off because she was woken early (story 3.2), already subtracted from `stars`; 0 for a timer end. »
   - `LevelScored` gains `lostStars` too, as it spreads `MamaScore`.
   - `scoreLevel(world, ctx, reason)` passes `reason === 'mamaWoke'`.

6. **The feel bound** (deferred-work L25). In `MamaSchema`, `earlyWakePenaltyStars` gets `.max(STAR_COUNT_MAX)`, and its description becomes « Stars taken off Mama's note when the noise wakes her early (Sieste), 0 to 5, in stars. » Run `npm run content:schemas`. Its value stays 1 in `content/feel.json` and `testFeel.json`, so the goldens' `feelHash` does not move. Add one schema rejection test (6 is refused). Close L25's `earlyWakePenaltyStars` clause in `deferred-work.md`.

7. **Snapshot v14.** `world.score.final` now has seven keys. In `src/sim/snapshot.ts`:
   - `MAMA_SCORE_KEYS` gains `'lostStars'`.
   - `scoreProblem` also refuses `stars + lostStars > STAR_COUNT_MAX`.
   - The version becomes 13 (the type, the literal, the `invariant`, and the version history comment: « 13 since story 3.2: `score.final.lostStars` »).
   - Update the snapshot tests and the `version` fixtures.
   - A round-trip test covers an `ended` world after `mamaWoke`.

### The Result screen (client)

8. **The header.** When the level ended on `mamaWoke`, the Result panel opens with a header « Maman s'est réveillée ! » (`result.mama_woke`, already in `strings.fr.json`), above the score card.
   - It is an `h2` with class `pp-result-reason pp-type-heading` (`DESIGN.md` L438: the `heading` type; check that the `pp-type-heading` class exists in `ui.css`, and add it from the tokens if not).
   - After a timer end there is no header element at all.
   - `createResultScreen` takes a new option, `endReason: LevelEndReason`. `boot.ts` stores it from the drained `LevelEnded` (next to `resultScore`), resets it on each level start, and passes it.

9. **The cue of the header** (D4). When a `mamaWoke` Result screen is built and its sequence starts (not on an `isDone` rebuild), it calls a new option `onMamaWoke()` once. `boot.ts` maps it to `director.handle('ResultMamaWokeShown', null)`.
   - `'ResultMamaWokeShown'` joins `FEEDBACK_CLIENT_EVENTS`.
   - `content/feedback.json` › `events.ResultMamaWokeShown` is `"mama_woke"`.
   - The cue `mama_woke` is `{ "audio": { "clip": "env_door_slam", "bus": "sfx", "gainPct": 100 }, "visual": { "kind": "uiElement" }, "haptic": "heavy" }`.
   - The visual twin: the header has `pp-result-reason-slam` for one run of a short slam animation (about 300 ms; a CSS `transform` only, scale and rotate, tokens only). Under `prefers-reduced-motion` there is no movement: the header shows its final state at once, with a static `mama-scream` underline (a `border-bottom` or a `box-shadow`, tokens only) that is always there, reduced motion or not. So the visual twin never relies on motion alone.
   - `feedbackEquivalence.test.ts` passes with no change to the test (the cue has audio, a visual and a haptic).

10. **The lost star stamps last** (`EXPERIENCE.md` L224):
    - The star row keeps its five slots. The `lostStars` slots that follow the earned ones (indices `stars … stars + lostStars − 1`) become lost slots: class `pp-star-lost`, a dashed `--pp-color-ink-soft` outline, no fill, no shadow (mockup L102: stroke-width 2.6, dasharray 3.2 2.4). Each lost slot carries a « −1 » chip (`result.star_lost`), in `--pp-color-mama-scream` with an ink outline, as in the mockup's `.minus`.
    - Order of the sequence: rows, then the earned stars stamp as in 1.22 (the last earned one stays `ResultLastStarStamped`, heavy), then after `starIntervalMs` each lost star stamps (the `pp-star-stamped` animation, which works with the tilt) and calls `onStarLost()`. Then, after `actionsDelayMs`, come the actions.
    - With 0 earned stars and 1 lost star, the lost star stamps right after `starsDelayMs`.
    - `onStarLost()` maps to `director.handle('ResultStarLost', null)`: a new client event, a cue `result_star_lost` with `{ "audio": { "clip": "ui_star_lost", "bus": "ui", "gainPct": 90 }, "visual": { "kind": "uiElement" }, "haptic": "light" }`.
    - A skip (tap, Enter, Space, pad A) or an `isDone` rebuild places the lost star(s) silently, like the earned ones.
    - The chip must not break the `nth-child` tilt rules of `.pp-star` (`ui.css` L746-763): keep the five slots as the only `svg` children, and position the chip either inside a wrapper used for **every** slot or as an absolutely positioned sibling **after** the five slots (then switch the tilt rules to `:nth-of-type` if needed). Do not change how earned stars look.
    - The stars' `aria-label`: with `lostStars > 0` it is `result.stars_lost_label` (new string, « {count} sur {max} étoiles, {lost} en moins ») filled by `formatString`, otherwise the existing `result.stars_label`.

11. **Mirrors.** In mirrored builds (dev, `?debug=1`):
    - `data-pp-end-reason` is set from `LevelEnded.reason` and removed at the next level start.
    - `data-pp-stars` stays the stars after the penalty.
    - New: `data-pp-lost-stars`, from `LevelScored.lostStars`.

12. **Audio placeholders.** `tools/audio/makePlaceholderAudio.ts` gains `env_door_slam` (a short, loud, low burst: a noise thump with a fast decay, about 400 ms) and `ui_star_lost` (a dull, falling blip, lower than `ui_star_stamp`). Run `npm run assets:audio` (macOS), commit only the two new `.m4a` files and restore the others from git (1.22 T6). `makePlaceholderAudio.test.ts` is updated if it counts clips. Check that `npm run dist:check` still passes: the level's `.glb` + audio stays at or under 3 MiB.

### Bots, CLI and tests

13. **Report** (`tools/sim/simReport.ts`):
    - Per run: `endReason: LevelEndReason | null` (null for a run cut before the end) and `lostStars: number | null`.
    - The aggregate: `endsByReason: Record<LevelEndReason, number>`, built from `LEVEL_END_REASONS` with every key present (0 when none), summing to `endedRuns`; `mamaWokeMeanAtMs: number | null`, the mean sim time of `MamaWoke` over the runs it happened in, null if none.
    - `--help` (`tools/sim/simArgs.ts`) mentions them, and `tests/tools/sim/simReport.test.ts` covers a mix of the two ends. Use a frozen level with noise where Mama does wake: for example `createTestLevel({ gauges: { noise: {} } })` with a phone and a `feel.noise.sources.phoneRinging.perSec` raised in the test feel, or `SetNoise` sent by the test.
    - Epics AC 4: run `npm run sim -- --bot random --runs 100` on `salon_crawler`, and `--bot idle` / `--bot perfect`, and put `endsByReason` in the Completion Notes. With today's content `mamaWoke` will be 0. Say so; do not tune the content (Open point 1).

14. **Unit tests** (next to the code, `vitest`), at least:
    - `flowSystem.test.ts`: `SetNoise` 100 gives `MamaWoke` → `LevelEnded{mamaWoke}` → `LevelScored` at the same `t`, in that order, and nothing after (step 100 more times: no new gameplay event); a phone ringing and an open silence are closed before; noise at 99.9 does not end; a level without noise is never ended by noise (force `noisePct` through a hand-built world only if needed; never with `SetNoise`, which `addNoise` ignores there); the tie at `durationMs` gives `mamaWoke` (AC 3); the timer end still has no `MamaWoke`.
    - `mamaScore.test.ts`: `lostStars` 0 for a timer end; 1 for a woken Mama with ≥ 1 base star; 0 with 0 base stars (never below 0); a penalty of 2 with 1 base star gives `lostStars` 1, `stars` 0; the points are equal across the two reasons.
    - `events.test.ts` (sorted, complete), `LEVEL_END_REASONS` completeness, snapshot v14 refusals (`lostStars` not a count, `stars + lostStars > 5`).
    - `resultScreen.test.ts`: the header is there only for `mamaWoke`; `onMamaWoke` is called once at the start, never on `isDone`; the lost slot gets `pp-star-lost` and the chip, after the earned ones; `onStarLost` is called after the last `onStar(true)` and before `onPhase('actions')`; a skip places it silently (no `onStarLost`); 0 earned + 1 lost; the `aria-label`s.
    - Schema test for the `earlyWakePenaltyStars` bound. `content:check` passes with the new events and cues.
    - Coverage of `src/sim` stays at or above 90 % (`npm run test:coverage`).

15. **Goldens.**
    - No existing golden reaches the level end (`grep LevelScored tests/golden/journals` is empty) and no feel value changes, so **no existing journal or hash may move**. If one does, stop and explain why.
    - Add one scenario, `mama_woke`: `createTestLevel({ gauges: { noise: {} } })`, a journal that sends `SetNoise{pct: 100}` at a fixed `t`, run until a little after. It pins `MamaWoke`, `LevelEnded{mamaWoke}` and `LevelScored{lostStars: 1}` (choose a moment where the base note has ≥ 1 star, which a quiet start has). Generate it with `npm run golden:update` and say so in the Completion Notes.

16. **End to end** (chromium + webkit, frozen level, `ppSend` / `ppAdvance` as `noise.spec.ts` and `result.spec.ts` do). Add the tests to `tests/e2e/result.spec.ts` (or a new `mamaWoke.spec.ts`):
    - On `salon_crawler`, `SetNoise` 100 then one step: `data-pp-end-reason` is `mamaWoke`, the app reaches `result`, the header « Maman s'est réveillée ! » is visible, `data-pp-stars` is the base stars minus 1 (read the base from `LevelScored` through `ppEvents`; no hard-coded score), and one `.pp-star-lost` with its « −1 » is there after the earned stars once `data-pp-result` is `actions`.
    - In Chromium, the vibrations include the `heavy` pattern of `ResultMamaWokeShown` (the `hapticPatternOf` helper) and the lost star's `light`. WebKit has no `navigator.vibrate`, so it checks the DOM only.
    - `cueCount` (the total of cues played, `data-pp-cue-count`) rises by exactly the expected number between the result screen opening and `actions`: the earned stars + `mama_woke` + `result_star_lost`. A skip test asserts the opposite: after a skip, no `result_star_lost`.
    - The 1.22 tests that count `.pp-star-stamped` / `.pp-star-earned` on a timer end still hold: a lost slot is never `pp-star-earned`.
    - A timer end (`advanceToEnd`) has no header and no `.pp-star-lost`: this is the existing 1.22 test, extended with these two assertions.
    - The Result screen at 844 × 390 still fits the safe area with the header (the 1.22 layout check covers the new header). If it overflows, tighten the spacing of the panel rather than shrinking the text below `pp-type-heading`.
    - Nothing in the existing e2e suite regresses. No screenshot reference shows the Result screen, so none should move; if one does, refresh the darwin references and say so (the Linux ones are stale since 3.1, deferred-work L435).

17. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch.

## Tasks / Subtasks

- [x] **T1. Content** (AC 6, 9, 10)
  - [x] `src/content/schemas/feel.ts`: `earlyWakePenaltyStars` `.max(STAR_COUNT_MAX)` with its new description; a rejection test in `tests/content/feelSchema.test.ts`; `npm run content:schemas`.
  - [x] `content/feedback.json`: cues `mama_woke` and `result_star_lost`, events `ResultMamaWokeShown` and `ResultStarLost`.
  - [x] `content/strings.fr.json`: `result.stars_lost_label`. `result.mama_woke` and `result.star_lost` already exist.
  - [x] `npm run content:check`.
- [x] **T2. Sim: events and flow** (AC 1-4)
  - [x] `src/sim/events.ts`: `LevelEndReason`, `LEVEL_END_REASONS` (+ proof), `MamaWoke`, `SIM_EVENT_TYPES`. Export the const from `src/sim/index.ts`.
  - [x] `src/sim/flow/flowSystem.ts`: one private `endLevel(world, ctx, reason)` that does the shared part (phones, silence, `enterFlowState`, `LevelEnded`, `scoreLevel`), with the `MamaWoke` push before it for the noise end. The noise test goes first (D2). Update the file's doc.
  - [x] `src/sim/flow/flowFsm.ts`: its doc (the Retour states are 3.5 / 3.10, unchanged).
- [x] **T3. Sim: score and snapshot** (AC 5, 7)
  - [x] `src/sim/world.ts` (`MamaScore.lostStars`), `src/sim/scoring/mamaScore.ts` (`computeMamaScore` third parameter, `scoreLevel` reason), `src/sim/events.ts` (`LevelScored.lostStars`).
  - [x] `src/sim/snapshot.ts`: v14, `MAMA_SCORE_KEYS`, the stars + lost check.
  - [x] `boot.ts` › `NO_SCORE` gains `lostStars: 0`.
- [x] **T4. Client** (AC 8-11)
  - [x] `src/client/ui/screens/resultScreen.ts`: options `endReason`, `onMamaWoke`, `onStarLost`; the header, the lost slots and the chip, the sequence step after the earned stars, the skip and `isDone` paths, the `aria-label`. Update the screen's doc comment.
  - [x] `src/client/ui/styles/ui.css`: `.pp-result-reason`, `.pp-result-reason-slam` (+ keyframes, reduced motion), `.pp-star-lost`, the chip. Tokens only, no hex; keep the `.pp-star` tilt rules right.
  - [x] `src/client/feedback/feedbackEvents.ts`: `'ResultMamaWokeShown'`, `'ResultStarLost'`.
  - [x] `src/client/boot.ts`: store `resultEndReason` from `LevelEnded` (reset on level start), pass it and the two callbacks, mirrors `ppEndReason` / `ppLostStars`. `logSimEvent` already logs the reason.
- [x] **T5. Audio** (AC 12): the two placeholder clips; `npm run assets:audio`; keep only the two new files.
- [x] **T6. Report** (AC 13): `simReport.ts`, `simArgs.ts` help, `simReport.test.ts`; run the three bots and note `endsByReason`.
- [x] **T7. Tests and goldens** (AC 14, 15): the unit tests; the `mama_woke` scenario in `tests/golden/scenarios.ts` (+ its test file, like `propFall.test.ts`); `npm run golden:update`; check that the diff of the existing journals is empty.
- [x] **T8. End to end** (AC 16).
- [x] **T9. Docs**
  - [x] `_bmad-output/project-context.md`: where `runFlow` is described, say that it has two ways in. The timer gives `LevelEnded{timer}`. Noise at 100 in a level with noise gives `MamaWoke`, then `LevelEnded{mamaWoke}`, and the note loses `earlyWakePenaltyStars` (never below 0, `MamaScore.lostStars`).
  - [x] `deferred-work.md`: close the `earlyWakePenaltyStars` clause of L25. Update the 3.1 Open point 2 entry (L427) with the bots' `endsByReason`. Add a « Deferred from: story 3.2 » section with Open points 1-3.
- [x] **T10. CI** (AC 17): `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Review Findings

Code review of 2026-10-29 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; no layer failed). 1 `decision_needed`, 5 `patch`, 3 `defer`, 9 dismissed as noise.

- [x] [Review][Decision] *Accepted by Geo 2026-10-29 (option 1: keep the change, recorded in the Completion Notes).* `SetNoise` now lands after the decay: a change to story 3.1's debug command, against « Must not change: the noise gauge ». Needed for `SetNoise{100}` to wake Mama (the story assumed the decay came first), disclosed in the Debug Log and `deferred-work.md`, and the 3.1 test pinning `90 − decay` was changed to `90`. Two points to settle: accept the deviation as it stands (then record it in D-notes), or revert and wake Mama another way. Side effect: `SetFatigue` is still applied before `runFatigue` (opposite order for a sibling command), and a `--journals` file recorded before this story that contains a `SetNoise` replays to another hash (journal `version` is still 3; the only committed journal with `SetNoise` is the new `mama_woke`).
- [x] [Review][Patch] The story file contradicts the commits: `content/feel.json` `phoneRinging.perSec` 2 → 7 (commit `2566148`, asked for by Geo) while D6, « What this story is not » and the Completion Notes still say « no content tuning » and « noise peaks at 16 %, Mama never wakes »; AC 9 / AC 12 / the file list still say `mama_door_slam` and « perdue » where the code has `env_door_slam` and « en moins ». Reconcile D6, Open point 1, Completion Notes and the two literals [3-2-variante-sieste-et-reveil-de-maman.md:26, 291, 332, 336]
- [x] [Review][Patch] `synthDoorSlam` reuses `createRng(SEED + 3)`, the seed of `synthTelegraphStairs`: two clips share a noise stream. Use the next free seed, `SEED + 8` [tools/audio/makePlaceholderAudio.ts:737]
- [x] [Review][Patch] Dead `seen` array (pushed, never read) in the « closes a ringing phone before it » test [src/sim/flow/flowSystem.test.ts:253-257]
- [x] [Review][Patch] The comment says « Versions 11 and 12 » but only 12 is asserted (version 11 is refused by the same check): assert both or fix the comment [src/sim/snapshot.test.ts:416]
- [x] [Review][Patch] The golden test hard-codes `STEP_MS` as `COMMAND_AT_MS + 10`: import `STEP_MS` from `@shared/constants` like `babyWander.test.ts` [tests/golden/mamaWoke.test.ts:22]
- [x] [Review][Defer] The snapshot validator does not cross-check the end against `lostStars` (a timer end with `lostStars > 0`, a woken end with 0, `lostStars` above `earlyWakePenaltyStars`), nor that an early `ended` was a `mamaWoke`; the Result screen shows lost slots from `lostStars` alone, not `endReason`. The sim cannot produce these states: corrupt input only [src/sim/snapshot.ts:433-450, 690; src/client/ui/screens/resultScreen.ts:553] — deferred, not reachable in play
- [x] [Review][Defer] The sim report has `lostStars` per run but no mean or total, and `starCounts` / `meanStars` mix both end reasons; a balance read must recompute the penalty [tools/sim/simReport.ts:~440-455] — deferred, no wrong number
- [x] [Review][Defer] Live-content e2e: `mamaWoke.spec.ts` builds `Array.from({ length: scored.stars - 1 })`, which is empty (fine) but expects the `heavy` entry even with 0 earned stars, and `ResultStarStamped` / `ResultStarLost` are both `light` so the vibration sequence cannot tell them apart. Breaks only if `earlyWakePenaltyStars` is tuned to 5 [tests/e2e/mamaWoke.spec.ts:150-162] — deferred, depends on a future tuning

## Dev Notes

### Decisions (D1-D6)

| # | Decision | Why |
|---|---|---|
| D1 | **The early end is in `runFlow`, read from `world.gauges.noisePct`.** No new system, no new world field, no flag set by the noise code. | `runFlow` is « the level's flow » and its doc already names « a second way in » for `MamaWoke`. The architecture row (L958) puts it in `src/sim/flow/`. `runGauges` runs right before `runFlow`, and `runNoise` applies the decay **before** the sources (3.1 D5/D10), so after `runGauges` the value is the step's final one. `addNoise` clamps to exactly `GAUGE_MAX_POINTS`, so `>=` is exact, with no float drift. The gate is `ctx.level.hasNoise`, not `variant`: `SimLevel` has no variant, `LEVEL_VARIANTS` is `['nap']`, and story 3.10 refuses `gauges.noise` outside `nap`. That keeps « noise ends only Sieste levels » true by content. |
| D2 | **A tie goes to Mama.** The noise check runs before the timer check. | The story says « un vrai enjeu jusqu'à la dernière seconde ». The noise did reach 100 inside the level's last step. It is also the simplest order to explain and test. |
| D3 | **The points stay, the stars drop: `lostStars` is in `MamaScore`.** The penalty is `min(earlyWakePenaltyStars, baseStars)` on the stars, never on the rows. | GDD L107: « la note perd une étoile ». The mockup's state B shows it: 44 points earn 2 stars, minus 1 leaves 1, and the rows still add up to the total. Storing `lostStars` (and not working it out again in the client) keeps the Result screen a pure reader of `LevelScored`. It also lets the report and the journal (3.3) see it. `earlyWakePenaltyStars` already exists in `feel.mama` (story 1.2), with no reader until now. |
| D4 | **The door-slam cue is a client event played by the Result header** (`ResultMamaWokeShown`). `MamaWoke` itself is not mapped in `feedback.json`. | `LevelScored` comes in the same drain as `MamaWoke`, and `boot.ts` then stops the loop and enters `result` (L827-837): a world visual on `MamaWoke` would never be drawn. A sim cue plus a header cue would play the slam twice. The epics put the cue with the header (« l'en-tête … s'affiche avec un indice dédié »). This is the 1.22 pattern (`ResultStarStamped`): a `uiElement` visual, legal only on a client event (`contentChecks.ts` L159-180). The sfx bus (not ui) because a door is a sound of the house. |
| D5 | **The lost star stamps after the earned ones, with its own light cue** (`ResultStarLost`). The heavy « last star » stays on the last earned star. | `EXPERIENCE.md` L224: « A lost star (Mama woke) stamps last ». The heavy vibration means « that is your result », and the lost star is a gag on top of it (L560, « reads as a gag, not a failure »). A distinct, duller clip keeps it from sounding like a win. |
| D6 | **No content tuning in this story's own implementation.** (Review: Geo's first tuning of `phoneRinging.perSec` came after, in `2566148`.) | Story 3.1 measured a peak of about 16 % for every bot. Whether the prototype should end games on noise, and how often, is a feel decision: Geo plays and tunes (golden rule). The AC « le rapport distingue les fins » holds with 0 `mamaWoke` on live content and a real count on the frozen test. |

### Current state of the files this story changes (read before editing)

- **`src/sim/flow/flowSystem.ts`** (24 lines). `runFlow` returns unless `playing`, returns unless `world.time.sim >= ctx.level.durationMs`, then calls `endRingingPhones`, `endSilence` and `enterFlowState('ended')`, pushes `LevelEnded{timer}` and calls `scoreLevel`. Keep that order for both ends. `endRingingPhones` (`disruptions/phone.ts` L97) and `endSilence` (`baby/silence.ts` L143) are written to be called « in the step it ends the level, before `LevelEnded` ». Do not change them.
- **`src/sim/flow/flowFsm.ts`.** `FlowState = 'playing' | 'ended'`, `FLOW_STATES`, and `enterFlowState`, the only writer. No new state.
- **`src/sim/step.ts`.** `runGauges` comes before `runFlow` in `SYSTEMS`, and `ENDED_SYSTEMS` is `[applyCommands, advanceTime]`. No change. Update the header comment only if it describes the end.
- **`src/sim/events.ts`.**
  - L37: `LevelEndReason = 'timer'`, with a doc that says « story 3.x adds one ».
  - L174: `LevelEnded`.
  - L176-190: `LevelScored`, which spreads the `MamaScore` fields by hand. Add `lostStars` there.
  - L195+: `SIM_EVENT_TYPES`, sorted, with a completeness proof.
- **`src/sim/scoring/mamaScore.ts`.** `computeMamaScore(tally, mama)` is pure. `scoreLevel(world, ctx)` writes `world.score.final` and pushes `LevelScored` with `...score`. Only `flowSystem.ts` and `mamaScore.test.ts` call these functions.
- **`src/sim/scoring/stars.ts`.** `starsForScore`: unchanged.
- **`src/sim/world.ts`.** `MamaScore` (L199-215): six fields today. `ScoreSlice.final`.
- **`src/sim/snapshot.ts`.** Version 12 (L31 history, L38, L57, L777). `MAMA_SCORE_KEYS` (L647-654). `scoreProblem` (L661-677) checks the key count, each key as a count, the score ≤ 100 and the stars ≤ 5.
- **`src/content/schemas/feel.ts`.** `MamaSchema` (L326+), where `earlyWakePenaltyStars: count(…)` is `z.int().min(0)`.
- **`src/client/ui/screens/resultScreen.ts`** (≈ 390 lines). It builds the panel (card, total with 5 star slots, actions), then runs the sequence through `scheduler`: `countUp` per row, `startStars`, `stamp(index)` (it calls `onStar(isLast)`, and after the last star `showActions` follows after `actionsDelayMs`), `complete()` for a skip, and `isDone` for a rebuild.
  - Earned slots go from `pp-star-empty` to `pp-star-earned` (+ `pp-star-stamped`).
  - With 0 stars, `startStars` goes straight to `showActions`.
  - The lost-star step goes between the last `stamp` and `showActions`, and in the 0-star branch.
  - `complete()` and `isDone` must place the lost slots too.
- **`src/client/boot.ts`.**
  - L70-77: `NO_SCORE`.
  - L84-87: `logSimEvent` logs `LevelEnded` with its reason.
  - L797-799: the `ppFlow` mirror on `LevelEnded`.
  - L827-837: `LevelScored` stores `resultScore`, finishes the session and enters `result`.
  - L907-935: `result: () => createResultScreen({…})`, with `onStar` → `director.handle(…)`.
  - Find where a level start resets `resultScore` / `hasResultStarted` and the mirrors, and reset `resultEndReason` and `data-pp-end-reason` there.
- **`src/client/feedback/feedbackEvents.ts`.** `FEEDBACK_CLIENT_EVENTS`: `CountdownTicked`, `NoiseAlertReached`, `ResultStarStamped`, `ResultLastStarStamped`.
- **`content/feedback.json`.** Buses are `music`, `sfx`, `voice` and `ui`. `result_star` / `result_star_last` are the model for the cues. `resultScreen` timings are `{rowCountUpMs 600, rowStaggerMs 200, starsDelayMs 300, starIntervalMs 450, actionsDelayMs 400, inputGraceMs 350}`. Reuse `starIntervalMs` for the lost star, and add no new timing unless one is needed.
- **`src/client/ui/styles/ui.css`.** `.pp-stars` (L704), `.pp-star*` (L710-780), the `nth-child` tilt (L746-763), `.pp-star-stamped` and `@keyframes pp-star-stamp`. `tokens.css` has `--pp-color-ink-soft` and `--pp-color-mama-scream`.
- **`content/strings.fr.json`.** It already has `result.mama_woke` « Maman s'est réveillée ! » and `result.star_lost` « −1 » (both `[ASSUMPTION]` in `EXPERIENCE.md`).
- **`tools/sim/simReport.ts`.** `RunSummary` (`isEnded`, `scorePoints`, `stars`, L60-81) and the recorder's `LevelEnded` / `LevelScored` branches (L179-182). The `SimReport` aggregate has `endedRuns`, `meanStars` and `starCounts` (L270+).
- **`tests/e2e/result.spec.ts`** has `openResult(page, patch)` (`ppFreeze`, `ppLoadLevel`, `ppSetFeel`, `advanceToEnd`) and reads every bound from the live content. Follow it, and write the « woken » helper next to it (`ppSend` `SetNoise` 100, then `ppAdvance` one step).

### Must not change

- The noise gauge (3.1): `gauges/noise.ts`, `noiseSystem.ts`, `NoiseChanged`, `SetNoise`, the HUD gauge and the 80 % alert. This story only reads `noisePct`.
- The four rows and `scorePoints` of Mama's note: a woken Mama changes the stars only.
- The 1.22 sequence for a timer end, its timings and its cues. A timer end looks exactly as before: no header, no lost slot.
- The `ENDED_SYSTEMS` freeze, and the order phones → silence → `LevelEnded` → `LevelScored`.
- The existing golden journals and hashes (AC 15).

### Architecture compliance

- Sim purity: no `Math.random`, `Date`, `performance` or `console`. No `world.rng` draw is added.
- `World` stays plain JSON (`lostStars` is an integer).
- The client imports `@sim` only: `LevelEndReason`, `LEVEL_END_REASONS`, `MamaScore` and `SimEvent` come from `src/sim/index.ts`.
- Every tunable number is in `feel.json` (`earlyWakePenaltyStars`) or `feedback.json` (cues, timings). The 300 ms slam is CSS animation timing, like the 600 ms noise shake (3.1) and the 200 ms star stamp.
- Events: `MamaWoke` is the architecture's name (L252, L400), past tense, with `t`.
- Haptics go through the feedback director (`Platform.haptics`), never through `navigator.vibrate` directly.

### Library and framework notes

- No new dependency. Zod 4 (`z.int().min(0).max(…)`), Vitest, Playwright as configured. The audio placeholders use the existing `makePlaceholderAudio.ts` pipeline (macOS `afconvert`, AAC 64 kbps).

### File structure

New:
- `public/assets/audio/env_door_slam.m4a`, `public/assets/audio/ui_star_lost.m4a`
- `tests/golden/journals/mama_woke.json`, `mama_woke.expected.json`, and its test (e.g. `tests/golden/mamaWoke.test.ts`, like `propFall.test.ts`)
- optionally `tests/e2e/mamaWoke.spec.ts`

Updated:
- `src/content/schemas/feel.ts`, `content/_schemas/feel.schema.json` (generated)
- `content/feedback.json`, `content/strings.fr.json`
- `src/sim/{events,world,snapshot,index}.ts`, `flow/flowSystem.ts`, `flow/flowFsm.ts` (doc), `scoring/mamaScore.ts`
- `src/client/boot.ts`, `feedback/feedbackEvents.ts`, `ui/screens/resultScreen.ts`, `ui/styles/ui.css`
- `tools/audio/makePlaceholderAudio.ts`, `tools/sim/simReport.ts`, `tools/sim/simArgs.ts`
- tests: `flowSystem.test.ts`, `mamaScore.test.ts`, `events.test.ts`, `snapshot.test.ts`, `resultScreen.test.ts`, `tests/content/feelSchema.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tests/golden/scenarios.ts`, `tests/e2e/result.spec.ts`
- `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`

### Testing

- Unit first: `flowSystem.test.ts` and `mamaScore.test.ts`, with `createSim` + `createTestLevel({ gauges: { noise: {} } })` and `SetNoise` for the flow, and pure calls for the score. For the phone-and-silence order, reuse the setups of `flowSystem.test.ts` (it already tests `PhoneRingEnded{levelEnded}` / `SilenceEnded{levelEnded}` for the timer).
- Determinism: same seed, same journal → same `worldHash` with a `mamaWoke` end (the golden pins it). A snapshot taken after the end restores to the same state.
- Run `npm run test:coverage`, not just `npm test`: CI enforces the `src/sim` ≥ 90 % thresholds.
- e2e under load: if two worktrees run CI at once, rerun with `--workers=4` and say so.

### Previous story intelligence (3.1, 1.22, 1.18-1.21)

- **3.1** (last merged, `b650f3d`). `noisePct` is clamped to `[0, 100]` by `addNoise`, the only event-making writer; `decayNoise` is the silent twin. `SetNoise` is applied first in `runGauges`. In a level without noise, `addNoise` does nothing (so `SetNoise` cannot reach 100 there). The CLI report already has `noisePeakPct` etc.; put the end fields beside `isEnded`. The review caught: vacuous tests (assert the state before and after), missing upper bounds in « at least » tests (assert exact counts and order), and unit-suffix exceptions (none here: `lostStars` and `earlyWakePenaltyStars` follow the `…Stars` style of `stars`).
- **1.22.** `scoreLevel` is a helper called by `runFlow`, not a system. The Result screen reads only the `LevelScored` payload and the feel maxima. Client feedback events with `uiElement` visuals are its pattern (`content:check` enforces the client-only rule). Placeholder clips: run `assets:audio`, keep only the new files. The input grace and the « a skip never presses Rejouer » rules must still hold with the extra step.
- **1.18.** `runFlow` is last in `SYSTEMS`, and once ended `step()` runs only `ENDED_SYSTEMS`, so `LevelEnded` comes exactly once.
- **1.20 / 1.21.** Every `PhoneRingStarted` gets exactly one `PhoneRingEnded`, and every `SilenceStarted` one `SilenceEnded`. The early end must keep this (call the same two helpers).
- Reviews keep catching: tests that read the live `feel.json`, golden moves not disclosed, e2e locators that change meaning when the DOM grows (the star row gains a chip: check the `.pp-star` locators in `result.spec.ts` still count five slots), and missing reduced-motion variants.

### Git intelligence

- Recent history: `30d5e6d` (3.1 implementation), `ac9ac88` and `569d609` (3.1 review fixes), `084547c` (merge of 1.24 into the 3.1 branch), `b650f3d` (3.1 merged to `main`). This story is on `story/3-2-variante-sieste-et-reveil-de-maman`, in its worktree.
- 1.22 (`659150d`) is the closest in shape on the client side (result screen, cues, clips). 3.1 is the closest on the sim side (events, snapshot bump, report, golden).

### Project Structure Notes

- The early end lives in `src/sim/flow/`, as the architecture names it (L958). The penalty lives in `src/sim/scoring/`, beside the note. The header and the lost star live in the existing Result screen. No new module is needed outside the tests.
- **Variance with the architecture (by design):** the epics' « la note perd une étoile » is stored as `MamaScore.lostStars`, a field the architecture does not list. `MamaWoke` carries only `t`.

### Project context rules (from `_bmad-output/project-context.md`)

- Layers: the sim imports `shared` and `content` types only. The client imports `@sim`, never sim internals. Inside `src/sim`, imports are relative.
- The sim never logs and never reads real time or randomness except `world.rng`. It emits `SimEvent`s in PascalCase past tense (`MamaWoke`).
- `World` is serializable: no `Map`, `Set`, classes or non-finite numbers.
- No GDD number is hard-coded: the −1 star is `feel.mama.earlyWakePenaltyStars`, and the 100 % is `GAUGE_MAX_POINTS` (the gauge's top, a constant).
- Units are suffixes (`lostStars`, `mamaWokeMeanAtMs`). `…At` / `…AtMs` is sim time.
- Unit tests sit next to the code and import `describe`, `it` and `expect` from `vitest`.
- Strings live in `content/strings.fr.json`. JSON keys are `camelCase`. `content/_schemas` is generated, never edited by hand.
- No `console.*`. Every fallback logs a `warn`. Never weaken a guardrail (Biome rules, architecture tests, `feedbackEquivalence`, `content:check`, the coverage thresholds) to make code pass.
- Shell trap: run `env | grep VITE_` before `dev`, `e2e` or `ci`. If `VITE_DEBUG_ALLOWED` is set, run `(unset VITE_DEBUG_ALLOWED; …)`.

### Open points for Geo (tune or decide after playing)

1. **Should the prototype actually wake Mama?** With the content of story 3.1, no game reached 100 % (peak about 16 %); since `2566148` (`phoneRinging.perSec` 7) an ignored ring can. If the Sieste stake should be felt in the playtest, pick one or more: lower `noise.decayPerSec`, raise `phoneRinging.perSec` or the `propImpact` range, give a live gag a `gagCryMs`, or add a second phone. Use `npm run sim -- --bot human --runs 100` and look at `endsByReason` before and after.
2. **The look and sound of « Maman s'est réveillée ! »**: the slam animation, the static `mama-scream` underline, the placeholder door slam on `sfx` at 100 % and the `heavy` vibration are `[ASSUMPTION]`s to judge in play (story 2.3 replaces the clips).
3. **The lost star's own cue** (a dull blip, `light`) is an addition to the epics' wording, from `EXPERIENCE.md` L224 (« stamps last »). Drop it if it is too much (remove the event from `feedback.json`: the stamp animation stays as the visual).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2 : Variante Sieste et réveil de Maman (L1563-1588)]
- [Source: _bmad-output/planning-artifacts/epics.md (L51, L71, L241, L1638-1658, L1746-1763)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md (L44, L107, L174)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md (L252, L400, L958)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md (L438, L512, L515)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md (L114, L172, L175, L224, L318-330, L558-560)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/mockups/key-result.html (L20, L78-80, L102, L204-240)]
- [Source: _bmad-output/implementation-artifacts/3-1-jauge-de-bruit.md (D1, D5, D7, Open point 2, Completion Notes)]
- [Source: _bmad-output/implementation-artifacts/1-22-note-de-maman-et-ecran-de-fin.md (scoreLevel, Result screen, T6 audio)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L25, L427, L435)]
- [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- **`SetNoise{pct: 100}` could not wake Mama (found while writing the first snapshot test).** The story (D1, AC 1) assumes `runNoise` decays *before* the sources, so that after `runGauges` the value is the step's final one. That holds for event sources (decay, then add, then clamp to exactly 100) but not for `SetNoise`: `runGauges` applied it first and `runNoise` then decayed it, so the step ended at 99.99 and `noisePct >= 100` never held. `SetNoise` is the command AC 1, the golden and the e2e tests rely on. Fix: `runGauges` now applies `SetNoise` after `runNoise` (commanded value = the step's final value). Two expectations of the 3.1 test `noiseSystem.test.ts` (`90 − decay` → `90`, `100 − decay` → `100`) moved; the clamp-to-250 case now ends the level, so the `-40` case runs first. No golden moved (none sends `SetNoise` before this story).
- **Snapshot refused an `ended` world before `durationMs`.** `flowProblem` refused `ended` when `nowMs < durationMs`, true until now. It now accepts it only for a level with the noise gauge whose `noisePct` is exactly 100 (a woken Mama); other cases still name `world.flow.state`.
- **`content:check` refused two literals of the story** (AC 9, AC 12 and the file list now carry the final names). `mama_door_slam`: `mama` is not an audio category (`tel, resp, gag, baby, papa, env, ui, music`), so the clip is `env_door_slam`. « {count} sur {max} étoiles, {lost} en moins »: failure words are banned from player strings, so it reads « …, {lost} en moins ». The guardrails stayed as they are.
- **Chip placement.** The first version placed the `−1` chip from the slot's left edge; on the fifth slot it ran 1 px past the panel in WebKit. It is now placed from the row's right edge (`--pp-lost-from-end`, set by the screen from `STAR_COUNT_MAX`).
- **750 × 340.** The header costs about 40 px the 1.22 layout does not have. A woken Mama's panel (`pp-result-panel-woken`) tightens its padding and gaps under `@media (max-height: 360px)`; the text keeps its size and the timer end is untouched.
- **Lint:** the import order of `mamaScore.ts` (caught by `npm run ci` on the first run, fixed with `biome check --write`).

### Completion Notes List

- **Sim.** `runFlow` has two ways in, through one private `endLevel(world, ctx, reason)`: noise at `GAUGE_MAX_POINTS` in a level with `gauges.noise` (checked first, so a tie at `durationMs` goes to Mama) gives `MamaWoke` → `LevelEnded{mamaWoke}` → `LevelScored`, same `t`, after the phone and the silence are closed; the timer is unchanged. `LEVEL_END_REASONS` (+ compile-time proof) is exported from `@sim`. `computeMamaScore(tally, mama, isMamaWoke)` takes `min(earlyWakePenaltyStars, baseStars)` off the stars only; `MamaScore.lostStars` and `LevelScored.lostStars` carry it. `earlyWakePenaltyStars` is capped at 5 in `MamaSchema` (deferred-work L25 clause closed). Snapshot v13.
- **Client.** The Result screen takes `endReason`, `onMamaWoke`, `onStarLost`. After a woken Mama: header `h2.pp-result-reason.pp-type-heading` (slam once, static `mama-scream` underline, reduced motion = no movement), the lost slots (`pp-star-lost`, dashed `ink-soft`, no fill) stamp after the earned ones with a `−1` chip placed as a sibling after the five slots (so the `.pp-star` tilt rules are untouched). Cues: `mama_woke` (`env_door_slam`, sfx, `heavy`) on the client event `ResultMamaWokeShown` and `result_star_lost` (`ui_star_lost`, ui, `light`) on `ResultStarLost`. A skip and an `isDone` rebuild place the lost star silently. Mirrors `data-pp-end-reason` and `data-pp-lost-stars`; both cleared at each level start.
- **Audio.** `synthDoorSlam` (400 ms) and `synthStarLost` (180 ms) in `makePlaceholderAudio.ts`; `npm run assets:audio`, only the two new `.m4a` files kept (the other 19 restored from git).
- **Report.** `endReason` and `lostStars` per run, `endsByReason` (every `LEVEL_END_REASONS` key, summing to `endedRuns`) and `mamaWokeMeanAtMs` in the aggregate, `--help` updated.
- **`endsByReason` on `salon_crawler` (100 runs each, `npm run sim -- --bot <b> --runs 100`):** `random` `{ timer: 100, mamaWoke: 0 }`, `idle` `{ timer: 100, mamaWoke: 0 }`, `perfect` `{ timer: 100, mamaWoke: 0 }`; the noise peaks at 16 % in every run. **With the content as it was then, Mama never woke**; no content was tuned by this story (Open point 1, Geo's call). Commit `2566148` (`phoneRinging.perSec` 2 → 7) came after these runs, so the 16 % peak no longer describes the live content.
- **Goldens.** One scenario added, `mama_woke` (`createTestLevel({ gauges: NOISE_GAUGES })`, `SetNoise{pct: 100}` at 1000 ms, 2000 ms in all), generated with `npm run golden:update`. Its test (`tests/golden/mamaWoke.test.ts`) pins `MamaWoke`, `LevelEnded{mamaWoke}` and `LevelScored{lostStars: 1}`. **No existing journal or hash moved** (`git status` shows only the two new files in `tests/golden/journals`).
- **Tests.** Unit: `flowSystem.test.ts` (end order, freeze after, 99.9 %, a real source reaching 100, phone and silence closed first, no gauge, tie, timer end unchanged, lost star), `mamaScore.test.ts` (0 for a timer end, 1 woken, never below 0, penalty 2 with 1 star, penalty 0, same points, `scoreLevel` reason), `events.test.ts`, `snapshot.test.ts` (v14, `lostStars` refusals, an ended-early world round-trips and is refused without a full gauge), `resultScreen.test.ts` (13 tests for the woken screen), `feelSchema.test.ts`, `simReport.test.ts`, `simArgs.test.ts`, `makePlaceholderAudio.test.ts`. E2E (`tests/e2e/mamaWoke.spec.ts`, chromium + webkit, 9 tests each; `result.spec.ts` extended): the end, the header, the lost slot after the earned ones, the cue count, the vibrations in order (chromium), a skip, reduced motion, the dashed star, 844 × 390 and 750 × 340, a timer end without header, the mirrors cleared by « Rejouer ».
- **Deviations from the story, all flagged above:** `SetNoise` ordering in `runGauges` (a 3.1 file), `env_door_slam`, « en moins », the right-anchored chip, the woken panel's tightening on short screens, the snapshot's `flowProblem` relaxation.
- **Open points for Geo** are in `deferred-work.md › Deferred from: story 3-2` (Mama never wakes with today's content; the look and sound of the header; the lost star's own cue).

### File List

New:
- `public/assets/audio/env_door_slam.m4a`, `public/assets/audio/ui_star_lost.m4a`
- `tests/golden/journals/mama_woke.json`, `tests/golden/journals/mama_woke.expected.json`, `tests/golden/mamaWoke.test.ts`
- `tests/e2e/mamaWoke.spec.ts`

Modified:
- `_bmad-output/implementation-artifacts/3-2-variante-sieste-et-reveil-de-maman.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`
- `content/_schemas/feel.schema.json` (generated), `content/feedback.json`, `content/strings.fr.json`
- `src/content/schemas/feel.ts`
- `src/sim/events.ts`, `src/sim/index.ts`, `src/sim/world.ts`, `src/sim/snapshot.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/flow/flowFsm.ts`, `src/sim/gauges/gaugesSystem.ts`, `src/sim/scoring/mamaScore.ts`
- `src/client/boot.ts`, `src/client/feedback/feedbackEvents.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/styles/ui.css`
- `tools/audio/makePlaceholderAudio.ts`, `tools/sim/simReport.ts`, `tools/sim/simArgs.ts`
- Tests: `src/sim/events.test.ts`, `src/sim/flow/flowSystem.test.ts`, `src/sim/gauges/noiseSystem.test.ts`, `src/sim/scoring/mamaScore.test.ts`, `src/sim/snapshot.test.ts`, `src/client/ui/screens/resultScreen.test.ts`, `tests/content/feelSchema.test.ts`, `tests/golden/scenarios.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tests/tools/sim/mamaScore.test.ts`, `tests/tools/sim/simArgs.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/e2e/result.spec.ts`, `tests/e2e/support/game.ts`

### Change Log

- 2026-10-29: Story 3.2 implemented. Sieste end on noise (`MamaWoke`, `LevelEnded{mamaWoke}`), the lost star in Mama's note (`lostStars`, snapshot v14), the Result header and lost-star stamp with their cues, two placeholder clips, the report's `endsByReason`, the `mama_woke` golden, e2e coverage. `SetNoise` now lands after the step's decay (a 3.1 change, see the Debug Log).
- 2026-10-29: Code review. D1 accepted (`SetNoise` after the decay stays). Patches: story text reconciled with commit `2566148` and the final literals (`env_door_slam`, « en moins »); `synthDoorSlam` on its own seed (`SEED + 8`, clip regenerated, other clips untouched); dead `seen`, a wrong comment and a hard-coded step in three tests. `tests/e2e-dist/dist.spec.ts` now allows Chromium's « Blocked call to navigator.vibrate » line: since `phoneRinging.perSec` 7 the `perfect` bot (it never answers the phone) reaches the 80 % alert, and an autoplay run has no tap. `perf.spec.ts` failed twice under a machine load of 12-20 and passed alone (p95 16.8 ms); the final `npm run ci` is green.
- 2026-10-29: `main` merged into the branch (stories 2.1 and 2.2 landed first). Story 2.1 had taken snapshot version 13 for `feel`, so this story's `lostStars` is **snapshot version 14** (the spec and the Debug Log say v13: read 14). Conflicts: `snapshot.ts` / `snapshot.test.ts` (version, doc comment, a refusal test for version 13), `boot.ts` (imports), `tests/golden/scenarios.ts` (both helpers kept), `deferred-work.md` (both sections kept).
