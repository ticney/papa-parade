---
baseline_commit: 231d5deb280c82adfe34cc7c0d67f1c71ad0a7b7
---

# Story 3.12: Note de Maman sur cinq lignes

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want my note to move with what I do,
so that I want to do better in the next game.

Requirement: FR34 (revised in GDD v2.3), UX-DR13 (revised). First story of the v2.3 catch-up (`sprint-change-proposal-2026-11-03.md`, order: 3.12, 2.11, 3.13, 2.12, 2.13, 3.14, 3.15, 3.16, then a playtest, then E9). It replaces the four-row note of story 1.22: in Geo's playtest of 2026-11-03, every game ended at 20 points / 1 star whatever he did (Rire at 0 with no perfect, « État du bébé » fixed at 20, Soupir and Hurlement saturated after 3 props on the floor or 5 near misses). E9 (story 9.4) fills « Maison »; E5 (story 5.2) replaces the computation of « Calme du bébé ».

## Acceptance Criteria

### The formula (sim, `feel.json › mama`)

1. **Given** `feel.json › mama`, **when** the note is computed, **then** Score = Rire + Calme du bébé + Maison + `baseScorePoints` (30) − Soupir − Hurlement, each row held to `[0, its max]` and rounded to a whole number, the sum held to `[0, 100]`, with the maxima Rire 35, Calme 20, Maison 15, Soupir 15, Hurlement 15.
2. **Given** the slopes of FR34, **when** the rows are computed, **then** Rire = 1 per perfect + 0.5 per success + the combo points cashed in (story 4.2); Soupir = 2.5 per prop on the floor + 4 per broken prop + 1.5 per surprise mischief; Hurlement = 1.5 per near miss (frozen ones of story 3.6 included). Every slope, maximum and threshold is a key of `feel.json › mama`; nothing is written in code.
3. **Given** `MamaSchema`, **when** `feel.json` is validated, **then** it refuses a file where `laughMaxPoints + calmMaxPoints + homeMaxPoints + baseScorePoints ≠ 100`, or where `baseScorePoints ≠ sighMaxPoints + screamMaxPoints`; the maxima are whole numbers; `babyStateMaxPoints` and `babyStateFixedPoints` no longer exist (a file that still has them is refused: `strictObject`).
4. **Given** the five rows, **when** they are read off the note, **then** `laughPoints + calmPoints + homePoints + (sighMax − sighPoints) + (screamMax − screamPoints) = scorePoints` for every note (tested over a grid of tallies, including clamped ones).
5. **Given** the stars, **when** the score is known, **then** they are unchanged: thresholds 20 / 40 / 60 / 75 / 90 (`starThresholdPoints`), and a woken Mama still takes off `earlyWakePenaltyStars` (story 3.2) without changing a row.

### Calme du bébé

6. **Given** a level with a noise gauge (`ctx.level.hasNoise`, both current levels), **when** it ends, **then** Calme du bébé = round(share of the played sim time where `gauges.noisePct < feel.mama.calmNoiseThresholdPct` (50) × `calmMaxPoints`).
7. **Given** a level without a noise gauge, **when** it ends, **then** Calme du bébé = round(share of the played sim time where the baby is not crying (`baby.cryEndsAt === null`) × `calmMaxPoints`). No current level has no noise gauge: a unit test with a level built without `gauges.noise` pins it.
8. **Given** the calm tracker, **when** the sim steps, **then** it counts whole steps (`STEP_MS`) in `world.score.calmMs`, reads the gauge after `runGauges` of the same step, counts the step that ends the level and nothing after it (the world is frozen from `LevelEnded` on), and the played time is `world.time.sim` at the step that ends the level. A level ended on Mama waking, on the cycle (`cycleDone`) or on the timer (final rush included) uses the time actually played.

### Maison

9. **Given** a level without a house chore (every level until E9), **when** it ends, **then** Maison = 0, and the Result screen shows its row as « 0 » « /15 » (the row is never hidden).

### The Result screen

10. **Given** the Result screen, **when** the rows count up, **then** there are five, in this order: « Rires » /35, « Calme du bébé » /20, « Maison » /15, « Sans soupir » /15, « Sans hurlement » /15, each showing points earned over its maximum (read from `feel.mama`), and their values add up to the total shown.
11. **Given** the five rows, **when** they are drawn, **then** each has its chip and accent from `DESIGN.md › score-row`: Rires `mama-laugh`, Calme du bébé `mama-calm` (#D6609A), Maison `mama-home` (#9A6A3F), Sans soupir `mama-sigh`, Sans hurlement `mama-scream`; `tokens.css` gains `--pp-color-mama-calm` and `--pp-color-mama-home`, which turns `tests/architecture/designTokens.test.ts` green again (it is red on `main` since the correct-course added the two tokens to `DESIGN.md`).
12. **Given** a landscape phone (844 × 390 and 750 × 340), **when** the Result screen shows the photo and the five rows, **then** everything still fits in two columns with no scroll, the buttons keep their 44 × 44 pt targets and text stays ≥ the minimum size of `tokens.css`, the « Copier le journal » button of a playtest build included.

### Journals, report, goldens

13. **Given** `LevelScored` and `MamaScore`, **when** they are emitted or stored, **then** they carry `laughPoints`, `calmPoints`, `homePoints`, `sighPoints`, `screamPoints`, `scorePoints`, `stars`, `lostStars` (`babyStatePoints` is gone), and the exported journal's `summary.score` has that shape.
14. **Given** a journal exported before this story (`summary.score` with `babyStatePoints`), **when** it is parsed (`JournalSchema`, `npm run sim:replay`, `npm run playtest:metrics`), **then** it is still a valid journal file: the legacy four-row score is accepted beside the new one. (Replaying it still fails on the feel hash, as after every feel change: AC 16 is the way to rescore it.)
15. **Given** `npm run sim -- --bot <id>` on the salon, **when** the report is written, **then** it keeps every existing field (3.14 and `playtest:metrics` read them) and adds the mean of each of the five rows over the runs that ended.
16. **Given** journals exported from a playtest build before this story and the `feel.json` they were played with, **when** `npm run sim:rescore -- --recorded-feel <feel.json> <journal files or folder>` runs, **then** each journal is replayed with the current content, after checking that the recorded feel hashes to the journal's `feelHash` and differs from the current feel in `mama` only, and that the replay gives the same end reason and the same response counts by quality as the journal's summary; the tool prints, per journal, the old note and the new five rows, score and stars, plus the median score, and refuses (listed, exit 1) a journal that fails a check.
17. **Given** `npm run sim -- --bot human` on the salon and Geo's journals of 2026-11-03 rescored (AC 16), **when** the note is recomputed, **then** a game of Geo's no longer lands mechanically on 20 points; the goldens are regenerated deliberately (`npm run golden:update`), and the Completion Notes say what moved.

### Docs

18. **Given** the docs, **when** the story is done, **then** `_bmad-output/project-context.md › Mama's note` describes the five rows, `calmMs` and `successes`; nothing else in the planning docs needs to change (the GDD, `DESIGN.md`, `EXPERIENCE.md`, the architecture and `epics.md` were updated by the correct-course of 2026-11-03) unless the dev finds a contradiction, which is then fixed and listed.

## Tasks / Subtasks

- [ ] Task 1: The feel and its schema (AC: 1, 2, 3)
  - [ ] `MamaSchema` in `src/content/schemas/feel.ts`: drop `babyStateMaxPoints` and `babyStateFixedPoints` and their refine; add `calmMaxPoints`, `homeMaxPoints` (`wholePoints`), `laughPerSuccessPoints` (`points`), `calmNoiseThresholdPct` (`pct`); the 100-sum refine becomes `laughMaxPoints + calmMaxPoints + homeMaxPoints + sighMaxPoints + screamMaxPoints === MAMA_SCORE_MAX_POINTS` (with the base refine, that is AC 3's « Rire + Calme + Maison + base = 100 »); fix the `wholePoints` comment (« the five rows »)
  - [ ] `content/feel.json › mama` with the values of D2; `npm run content:schemas`
  - [ ] The same keys in `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `tests/content/feelSchema.test.ts`: each refine refused, each old key refused
- [ ] Task 2: The note in the sim (AC: 1, 2, 4, 5, 6, 7, 8, 9, 13)
  - [ ] `world.ts`: `ScoreSlice` gains `successes` and `calmMs`; `MamaScore` renames `babyStatePoints` → `calmPoints` and gains `homePoints`; doc comments say five rows
  - [ ] `threatFsm.ts` (`resolveThreat`): `if (quality === 'success') world.score.successes += 1;` beside the perfect counter
  - [ ] New `src/sim/scoring/calmTracker.ts` (`tickCalm(world, ctx)` and the pure `calmShareOf`), called from `runScoring` (D4); test file beside it
  - [ ] `mamaScore.ts`: `ScoreTally` gains `successes`, `calmMs`, `playedMs`, `homePoints`; `computeMamaScore` computes the five rows; `scoreLevel` passes `homePoints: 0` (D5) and `playedMs: world.time.sim`
  - [ ] `events.ts` (`LevelScored`), `snapshot.ts` (`MAMA_SCORE_KEYS`, `scoreProblem` checks `successes` and `calmMs`, `version` 28 → 29 with its history line), `index.ts` exports if needed
  - [ ] Unit tests: `mamaScore.test.ts` (each slope, each clamp, the rows add up over a grid, the woken Mama, the « Geo » tally of D7), `calmTracker.test.ts` (AC 6, 7, 8: threshold strict, the ending step, `mamaWoke` share, a level without noise), snapshot round trip with the new fields
- [ ] Task 3: The Result screen (AC: 10, 11, 12)
  - [ ] `resultScreen.ts`: `RowKind` `'laugh' | 'calm' | 'home' | 'sigh' | 'scream'`, five rows, `ResultMaxima` with `calmMaxPoints` and `homeMaxPoints`; two new chip icons (D6); comments say five rows
  - [ ] `tokens.css`: `--pp-color-mama-calm: #d6609a;` `--pp-color-mama-home: #9a6a3f;`; `ui.css`: `.pp-score-chip-calm`, `.pp-score-chip-home` (drop `.pp-score-chip-baby`)
  - [ ] `strings.fr.json`: `result.score_calm` « Calme du bébé », `result.score_home` « Maison »; drop `result.score_baby_state`
  - [ ] `boot.ts`: `NO_SCORE` with the new keys (`maxima: mama` keeps working by structure)
  - [ ] `resultScreen.test.ts`: five rows, order, labels, maxima, sum, the `0 /15` Maison row
  - [ ] Look at it: screenshots of the Result screen on both levels at 844 × 390 and 750 × 340, with a photo, and in a playtest-like build with « Copier le journal »; tighten the row spacing only if it overflows (Traps)
- [ ] Task 4: Journal, summary and report (AC: 13, 14, 15)
  - [ ] `src/content/schemas/journal.ts`: `ScoreSchema` (five rows) and `LegacyScoreSchema` (the four rows before v2.3), `summary.score: z.union([...])`; `JOURNAL_FILE_VERSION` stays 1 (precedent: the optional fields of 4.10); tests in `journal.test.ts` (a legacy score parses; a mix of both is refused)
  - [ ] `src/client/telemetry/gameSummary.ts` writes the new shape; its test
  - [ ] `tools/sim/simReport.ts`: per-run rows and `meanRows` (D8); `tests/tools/sim/simReport.test.ts` whole-report pins; `tests/tools/sim/mamaScore.test.ts` builds the new tally
- [ ] Task 5: Rescoring Geo's journals (AC: 16, 17)
  - [ ] New `tools/sim/rescoreJournals.ts` and the `sim:rescore` script in `package.json` (D9); add it to the Commands table of `CLAUDE.md` (one row, like `sim:replay`)
  - [ ] Tests in `tests/tools/sim/rescoreJournals.test.ts` on journals made in the test (play a short game with `createSim`, export it with the client's journal builder or by hand, change `mama`): a match, a recorded feel with another hash, a feel that differs outside `mama`, a journal whose replay diverges (forged counts)
  - [ ] Run it on Geo's journals (Open point 1), with the feel of commit `231d5de` (`git show 231d5de:content/feel.json` into the scratchpad); paste the table in the Completion Notes
- [ ] Task 6: Goldens, e2e, measures (AC: 17 and all)
  - [ ] `npm run golden:update`, deliberately; read the diff (Traps) and say in the Completion Notes what moved
  - [ ] E2E (Chromium): `result.spec.ts` (five labels, values, maxima, sum), `combo.spec.ts` (the Rire formula gains the successes), and every spec that names `babyStatePoints` / `babyStateMaxPoints` (`grep -rn babyState tests src tools`): `tests/e2e/support/game.ts`, `timer`, `journal`, `mamaWoke`, `finalRush`, `photo`, `tests/e2e-dist/dist.spec.ts`
  - [ ] `npm run sim` on the salon with `human`, `random`, `perfect`, `idle`, 20 runs from seed 1000: `meanScore`, `meanStars`, the new `meanRows`, before (D10) and after, in the Completion Notes
- [ ] Task 7: Docs (AC: 18)
  - [ ] `project-context.md › Mama's note` and every « four rows » left in code comments (`grep -rn "four rows\|4 rows\|État du bébé\|baby state" src tools tests`)
  - [ ] `npm run ci:fast` after each task, plus the touched specs on Chromium: `result`, `combo`, `photo`, `mamaWoke`, `finalRush`, `timer`, `journal`, `chambreNight`, `debugOverlay` (its Result tests)

## Dev Notes

### Decisions

- **D1. Rename, do not alias.** « État du bébé » becomes « Calme du bébé » in every layer: `calmPoints`, `calmMaxPoints`, `result.score_calm`, `pp-score-chip-calm`. There is no compatibility key in `feel.json` or the sim: old journals are only read (AC 14) or rescored (AC 16), never replayed as they are. E5 (story 5.2) will change how `calmPoints` is computed, not its name.
- **D2. Values in `feel.json › mama`** (keep the file's key order, new keys beside their row):
  `laughMaxPoints` 35, `laughPerPerfectPoints` 1, `laughPerSuccessPoints` 0.5, `calmMaxPoints` 20, `calmNoiseThresholdPct` 50, `homeMaxPoints` 15, `baseScorePoints` 30, `sighMaxPoints` 15, `screamMaxPoints` 15, `starThresholdPoints` [20, 40, 60, 75, 90], `earlyWakePenaltyStars` 1, `sighPerPropOnFloorPoints` 2.5, `sighPerBrokenPropPoints` 4, `sighPerMischiefPoints` 1.5, `screamPerNearMissPoints` 1.5. They are the GDD's « pentes de départ » (open question 13): Geo tunes them in the feel panel, which builds its fields from the schema.
- **D3. What counts as a success.** Every `ResponseResolved{quality: 'success'}` from `resolveThreat`, exactly where perfects are counted (`threatFsm.ts:237`): the micro-sleep's, a sequence's and a `nothing` response's included, as for perfects since 1.22. A fail counts nothing. Counters are written at their source; no system reads `ctx.events` (project rule).
- **D4. The calm tracker lives in `scoring/calmTracker.ts`** (the architecture names it, L510, L606) and runs inside `runScoring`, which keeps its slot between `runGauges` and `runFlow`: so it reads this step's `noisePct`, and the step that ends the level is counted before `runFlow` calls `scoreLevel`. `SYSTEMS` does not change. `runScoring`'s comment becomes « the combo's carry tick and the calm tracker ». Allocation-free, no draw. The calm rule is « strictly below » the threshold (« sous 50 % »). The share is `calmMs / playedMs`, with `playedMs = world.time.sim` read in `scoreLevel` (the sim starts every level at 0, and `ENDED_SYSTEMS` keep the clock going after the end, so read it in the ending step, never later); `playedMs === 0` gives a share of 1.
- **D5. Maison is an input of the note, 0 for now.** `ScoreTally.homePoints` exists and is held to `homeMaxPoints`; `scoreLevel` passes `0` with a comment « no chore before E9 (story 9.4 writes it) ». No `world.chores` and no counter in `World` yet: E9 adds them. `computeMamaScore` tests cover a non-zero and a clamped `homePoints`.
- **D6. Two chips.** Same 16 × 16 viewBox and `currentColor` drawing as the four existing ones: Calme du bébé is a sleeping face (two closed-eye arcs and a small smile, `pp-score-chip-line` strokes), Maison is a little house (roof and door). The chip background is the accent (`mama-calm`, `mama-home`); `DESIGN.md` says no text sits on them and the ink icon is graphics only (contrast ≈ 3.5 / 3.2:1, fine for non-text). The old `baby` chip had a `paper` background; it goes.
- **D7. The « Geo » tally.** From the change proposal: Geo's games had 0 perfect, Sigh and Scream saturated (≥ 3 props on the floor, ≥ 5 near misses). A unit test pins that, with the new feel, a tally of 0 perfect, 20 successes, 3 props on the floor, 5 near misses and half the time calm gives Rire 10, Calme 10, Maison 0, Soupir 8, Hurlement 8 (7.5 rounded up by `Math.round`), score 34 (1 star), and that the old feel would have given 20. Name it in the test as the playtest finding; it is the evidence of AC 17 if Geo's journals are not available.
- **D8. Report rows.** Each run of the report gains its five rows (`null` for a run cut before the end, like `scorePoints`), and the report gains, beside `meanScore` (top level), `meanRows: { laughPoints, calmPoints, homePoints, sighPoints, screamPoints } | null` (one decimal, over the runs that ended, like `meanScore`). No existing field moves or changes name: 3.14 compares bots and Geo on these files.
- **D9. The rescore tool.** `tools/sim/rescoreJournals.ts`, Node only, reusing `parseJournalFile`, `journalFileToRunFile`, `loadSimLevel` and `replayJournal` of `tools/sim/replaySim.ts` / `src/sim/replay.ts`. For each journal: (1) parse (legacy score accepted); (2) `hashJson(JSON.parse(recordedFeel)) === journal.replay.journal.feelHash` (`canonicalJson` sorts keys, so the raw file and the Zod-parsed feel hash alike), else refuse « played on another feel »; (3) the recorded feel and the current one are equal once `mama` is removed from both (compare `canonicalJson`), else refuse « the feel changed outside mama: the game would not replay »; (4) replay with the current content, the envelope's `feelHash` set to `hashJson(current feel)` (a copy, in the tool only: `replayJournal` and `createSim` keep their gate) and `strictInvariants` as recorded, until `endSimMs`; (5) check the replay's `LevelEnded.reason` equals `summary.endReason` and its response counts by quality, counted from the replayed events exactly as `client/telemetry/gameSummary.ts` counts them (reuse its recorder if it runs in Node, else read which events it counts), equal `summary.responses.byQuality`, else refuse « the replay diverged »; (6) print a Markdown table: file, end reason, old score and stars (`summary.score`), the five new rows, new score and stars; then the median of old and new scores. `--out <md>` writes it (use `tools/outputFile.ts`). Exit 1 if any journal was refused, after printing the others. **No guardrail of the sim is relaxed:** the hash is rewritten on a copy of a journal whose gameplay feel was proven equal. This only works while nothing but `mama` has changed since the journals were recorded, which is why it runs in this story (3.13 changes the director): keep the table in the story, 3.14 reads it.
- **D10. Baseline before the change** (this story's creation, `npm run sim -- --level salon_crawler --runs 20 --seed 1000`, current four-row note):

  | Bot | `meanScore` | `meanStars` | `starCounts` (0★…5★) | `meanSuccessPct` | `endsByReason` |
  |---|---|---|---|---|---|
  | `perfect` | 90 | 5 | 0,0,0,0,0,20 | 100 | timer 20 |
  | `human` | 80.8 | 4 | 0,0,0,1,19,0 | 99.8 | timer 20 |
  | `random` | 20.2 | 0.8 | 4,16,0,0,0,0 | 1.1 | timer 16, mamaWoke 4 |

  `perfect` sits exactly on 90 (Rire capped at 40 + 20 fixed + 30): with Rire capped at 35 and Calme up to 20 it should stay about 5★; check it. `random` lands on 20 like Geo, because the fixed 20 and the saturated penalties cancel: it is the best stand-in for Geo's games. Run `idle` too (not measured here). Re-run the same commands after the change and put both tables in the Completion Notes.

### The current code this story changes

- **`src/sim/scoring/mamaScore.ts`.** `computeMamaScore(tally, mama, isMamaWoke)` is pure: `row(value, max)` clamps then rounds; `babyStatePoints = row(babyStateFixedPoints, babyStateMaxPoints)` is the constant Geo saw. `scoreLevel(world, ctx, reason)` reads `world.score` and `world.mess`, writes `world.score.final`, emits `LevelScored`. It is called by `endLevel` in `flow/flowSystem.ts`, after `LevelEnded` and `recordFrozenNearMisses` (3.6): keep that order.
- **`src/sim/world.ts`.** `ScoreSlice { perfects, nearMisses, comboPoints, propsTidied, final }`, created at L766; `MamaScore` L246; `MessSlice` is recounted every step by `runPhysics` (`propsOnFloor`, `propsBroken`) except `mischiefs` (cumulative).
- **`src/sim/scoring/combo.ts › runScoring`** (L98): the combo's carry tick only, in the `SYSTEMS` slot before `runFlow`.
- **`src/sim/snapshot.ts`.** `version: 28`, with the history in the doc comment at L36; `MAMA_SCORE_KEYS` L1076; `scoreProblem` L1096 checks every counter with `isCount` and the note's keys exactly.
- **`src/content/schemas/feel.ts › MamaSchema`** (L469-532), and `wholePoints` / `points` / `pct` helpers at the top.
- **`src/client/ui/screens/resultScreen.ts`.** `ResultMaxima` (L50), `CHIP_ICONS` (L104), `RowKind` (L126), the `rows` array built in `createResultScreen` (L151). The count-up, the stagger and the stars read `rows.length`, so a fifth row lengthens the sequence by one `rowStaggerMs` on its own: say so in the notes, do not retune `feedback.json` unless Geo asks.
- **`src/client/ui/styles/ui.css`** L1080-1160 (score card, rows, chips); `tokens.css` has the three `--pp-color-mama-*` today.
- **`src/content/schemas/journal.ts`.** `ScoreSchema` is strict, `summary.score: ScoreSchema`; `GameSummary` (`client/telemetry/gameSummary.ts`) is `JournalFile['summary']`, so a union reaches its type: the recorder writes the new branch.
- **`tools/sim/simReport.ts`** reads `LevelScored` for `scorePoints`, `stars`, `lostStars` (L379); summary `meanScore` / `meanStars` at L855.
- **`tools/sim/replaySim.ts`.** `replayJournalFile` refuses a journal whose `feelHash` is not the current feel's (inside `replayJournal`, `src/sim/replay.ts:38`, and again in `createSim.ts:779`).

### What must keep working

- Every way to end a level gives one `LevelScored` at the `t` of `LevelEnded` (timer with or without rush, `mamaWoke`, `cycleDone`), after the frozen near misses.
- The stars, the lost star of a woken Mama, the headers (« Maman s'est réveillée ! », « Il dort enfin ! »), the photo phase, the skip, the input grace, the rebuild on a portrait flip, « Copier le journal ».
- `npm run playtest:metrics` on old and new journals (it reads `responses`, not `score`).
- Determinism: the calm tracker reads only `world` and `ctx`; `determinism.test.ts` and `replay.test.ts` stay green.
- The `autoplay.spec.ts` screenshot is taken in play, not on the Result screen: it must not move.

### Traps

- **The goldens all move.** New `mama` keys change `feelHash` in every journal and `worldHash` in every `.expected`; the new `ScoreSlice` fields change `worldHash`; `eventsHash` moves for every scenario that reaches `LevelScored` (its payload changed); `eventTypes` must **not** move (no event is added or removed). Read the diff and name what moved; anything else is a bug.
- **Five rows in 340 px.** A row is `min-height: 28px` in a card under the photo's two-column layout; the fifth adds about 28 px. `photo.spec.ts` pins « 844 × 390 and 750 × 340 in two columns without a scroll ». If it overflows, tighten the card's padding or the row height in `ui.css` (never under the 16 px text minimum, never shrink buttons), and look at it with the playtest-only « Copier le journal » present.
- **Exact numbers in tests.** `tests/tools/sim/mamaScore.test.ts`, `result.spec.ts` and `combo.spec.ts` compute bounds from the live feel: update the formula (successes, five rows), never loosen an assertion. Tests that pin a score on a fixed seed: move the fixture with a reason.
- **`Math.round(7.5)` is 8 and `Math.round(2.5)` is 3** in JS (half up), and a row is rounded after clamping: half-point slopes make that visible. Rows are rounded one by one, so the score is the sum of rounded rows, never a rounded sum (AC 4).
- **The calm share is per step, not per event.** Do not integrate on noise events; one comparison per step. A `SetNoise` command (tests, the `__PP__` API) moves the gauge between steps: the tick of that step sees the new value.
- **`ENDED_SYSTEMS` keeps the clock going** after `LevelEnded`: anything that reads `world.time.sim` after the ending step (the client, a test advancing more steps) sees a larger number. `playedMs` is read in `scoreLevel` only.
- **The journal union.** `z.union` of two `strictObject`s gives an error listing both branches on a bad file: keep `parseJournalFile`'s message readable (a test reads it). The legacy branch is named for what it is (`LegacyScoreSchema`, « the four rows before v2.3 »).
- **`content:check` cross-checks strings.** Dropping `result.score_baby_state` must leave no reference (`grep -rn score_baby_state`).
- **Every new feel key** goes to `testFeel.json` and `feelSample.json` (4.10, 3.6), or `content:check` and the Vite fixture tests fail far from the change.
- **`VITE_DEBUG_ALLOWED`:** it was not exported at this story's creation; run `env | grep VITE_` anyway, and `(unset VITE_DEBUG_ALLOWED; …)` if it is set.
- **The worktree guard** refuses compound shell commands naming `git`, shell loops with a computed program and commands with a variable in an option position: use plain commands, the edit tools, or one script file in the scratchpad.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`.

### Out of scope

- House chores, `world.chores` and the points that fill Maison: E9 (9.4 to 9.6).
- Propre / nourri / reposé replacing the calm share: E5 (5.2).
- The catastrophe gauge and « Maman est rentrée plus tôt ! » (0 star): 3.16. The ending reason `mamaHome` does not exist yet.
- Mama's lines and `mum-bubble` (3.7), the replay (3.9), the unlock buttons (3.11).
- Tuning the bot `human` toward Geo: 3.14 (it reads this story's rescored table).
- A gag also resetting the multiplier and costing noise (FR34's last sentence): already true (story 4.2 and 3.1).

### Architecture compliance

- `src/sim` stays pure: no `Math.random`, no real time, no log; the tracker uses `STEP_MS` from `@shared/constants`.
- `World` stays serialisable: two numbers in `score`; `SimSnapshot.version` 29.
- Tunables in `feel.json`; the schema holds only bounds; no `.default()` / `.optional()` in `feel.ts`.
- `tools/sim/rescoreJournals.ts` is Node only, imports `@sim`, `@content`, `@shared` and `tools/sim/*`; nothing in `src/` imports it. I/O returns `Result`, every fallback logs a `warn`, `log.<level>` only (no `console.*`).
- Client: the Result screen reads `MamaScore` and `feel.mama`; colours are tokens (`designTokens.test.ts` checks both ways).

### Library and framework notes

Stack pinned, nothing added: TypeScript 7 (`tsc --noEmit`), Zod 4 (`z.strictObject`, `z.int`, `z.union`, `.refine` with `{ path, error }` as in `MamaSchema`), Vitest, Playwright. No version research was needed.

### File structure

- **New:** `src/sim/scoring/calmTracker.ts` and its test; `tools/sim/rescoreJournals.ts`; `tests/tools/sim/rescoreJournals.test.ts`.
- **Updated:** `src/sim/{world,events,snapshot}.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/scoring/{mamaScore,combo}.ts` and tests, `src/content/schemas/{feel,journal}.ts` and tests, `content/{feel,strings.fr}.json`, `content/_schemas/feel.schema.json`, `src/client/ui/screens/resultScreen.ts` and test, `src/client/ui/styles/{tokens,ui}.css`, `src/client/boot.ts`, `src/client/telemetry/gameSummary.ts` and test, `src/client/app/levelSession.test.ts`, `src/debug/{cheats,playtestJournal}.test.ts`, `tools/sim/simReport.ts`, `package.json` (`sim:rescore`), `CLAUDE.md` (one Commands row), `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tests/content/feelSchema.test.ts`, `tests/tools/sim/{mamaScore,simReport}.test.ts`, `tests/tools/playtest/support.ts`, `tests/golden/*` (regenerated), the e2e specs of Task 6, `_bmad-output/project-context.md`.
- The full list of files naming the old fields today: `grep -rln "babyStatePoints\|babyStateFixedPoints\|babyStateMaxPoints" src tools tests content`.

### Testing

- **Sim:** real `createSim` with typed commands, time in `STEP_MS`, values read from the feel. Drive the noise with `SetNoise` (journaled), never by writing `sim.world`. For AC 7, build a level without `gauges.noise` the way `noiseSystem.test.ts` does for « a level with no noise gauge ».
- **Pure:** `computeMamaScore` over a grid (perfects × successes × props × near misses, clamped and not), so AC 4 cannot pass by accident; assert exact rows, not just the sum.
- **Client unit:** `resultScreen.test.ts` with its fake scheduler and `photo: null`; five rows, order, labels, `/max` from the maxima passed in.
- **E2E (Chromium):** `result.spec.ts` asserts the five labels, values from `LevelScored` and maxima from the live feel, and that they add up; the Maison row reads `0` and `/15`.
- **Tools:** the rescore tool on journals built in the test; `simReport.test.ts` whole-report pins with the new fields.
- **Look at it:** screenshots of the five rows on both levels, both landscape sizes; say in the notes what Geo should judge (the two new accents are `[ASSUMPTION]` in `DESIGN.md`).
- **Checks:** `npm run ci:fast` per task; `ci:story` belongs to the review, not to dev-story.

### Previous story intelligence

- **3.6:** tests that could not fail were the main review finding (an assertion on the same function twice, `toBeTruthy` on any value, a colour count that a blank canvas passes). Assert on exact values that exist. Stale comments after a change were the second finding: grep for « four rows » / « État du bébé ».
- **3.6 Traps kept:** e2e specs that read the Result screen wait for `rows` first; a spec that needs a timer end uses `?threats=off` (an idle salon can wake Mama).
- **3.6 and 3.5:** a feel key change moves every golden's `feelHash` and `worldHash`; regenerate deliberately and read the diff.
- **4.10:** a new feel key must reach `testFeel.json` and `feelSample.json`; every whole-report test needs the new field.
- **3.3:** the journal export must stay valid for old files (optional fields there; a union here); the Result screen's two columns must fit « Copier le journal » at +30 % text.

### Git intelligence

Recent commits: `231d5de` (correct-course: GDD v2.3 split into stories), `ff2d0b7` (GDD v2.3), the 3.6 and 7.3 merges. The correct-course already updated the GDD, `DESIGN.md` (tokens `mama-calm`, `mama-home`, `score-row` × 5), `EXPERIENCE.md` (labels, Result pattern), the architecture (L232, L510, L606, L986) and `epics.md`, but no code: `designTokens.test.ts` is the one red test on `main` (`npx vitest run` at this story's creation: 1 failed, 8 010 passed), and this story makes it green.

### Project Structure Notes

Follows the layers and aliases; `scoring/calmTracker.ts` is where the architecture puts it. No variance. The rescore tool sits beside `replaySim.ts` in `tools/sim/`.

### Project Context Rules

- Anything Geo might tune is data: slopes, maxima, threshold in `feel.json › mama`; labels in `strings.fr.json`; colours as tokens.
- Units are suffixes (`calmMs`, `playedMs`, `calmNoiseThresholdPct`, `…Points`); `…At` is sim time; events past tense; no `enum`; FSM states and row kinds are string-literal unions.
- The sim never logs and reads no real time or randomness; counters are written at their source; no system reads `ctx.events`.
- UI text is French and never names failure; text ≥ 16 px; buttons ≥ 44 × 44 pt.
- No `console.*`; I/O returns `Result`; every fallback logs a `warn`.
- Regenerating goldens is deliberate and said in the story; never weaken a guardrail.
- No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **Your journals of 2026-11-03.** They are not in the repo and were not found on this Mac. AC 16-17 rescore them. Put them in `docs/playtest/geo/` (3.14 expects them there too; they hold no personal data). The rescore works only while the feel has changed in `mama` alone, so **before 3.13 is merged**. Without them, the dev proves AC 17 with the « Geo » tally of D7 and the `human` bot, and says so.
2. **Half points round up.** With 2.5 per prop, one prop costs 3 points and two cost 5 (7.5 → 8 for three). That is `Math.round`; if you would rather floor the penalties, it is one line, but say so before the goldens are regenerated.
3. **Calme du bébé is « strictly below 50 % » of the noise**, measured on every step of the level, the final rush included. The two levels start quiet, so a calm player gets close to 20.
4. **The two new accents** (`mama-calm` rose, `mama-home` brown) are `[ASSUMPTION]` in `DESIGN.md`: judge them on the screenshots.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.12], FR34 (L73), UX-DR13 (L247-252)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md] §1 (constats), §4 (FR34, UX-DR13, story 3.12), §5 (architecture, DESIGN)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Note de Maman] (L484-500), open question 13 (L682)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L232-233 (World, system order), L510, L606, L986
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L33-37 (tokens), L360-369 (score-row), L466-503 (palette, contrast), L593
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L179, L236, L335, L585
- [Source: _bmad-output/project-context.md] « Mama's note (story 1.22) » (L42)
- [Source: _bmad-output/implementation-artifacts/1-22-note-de-maman-et-ecran-de-fin.md], [3-6-photo-de-fin-figee.md] (Traps, Review Findings)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-11-03 — Story created (create-story): ultimate context engine analysis completed, comprehensive developer guide created.
