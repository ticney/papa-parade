---
baseline_commit: 8b340486fdebd59e70d4b1b1061561c0b116c1b0
---

# Story 3.14: Joueur simulé humain réaliste

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Geo,
I want the `human` bot to get notes close to mine,
so that the simulated indicators tell the truth before a playtest.

Requirements: FR66 (bots), the GDD v2.3 indicator « Le joueur simulé humain joue comme un humain » (`gdd.md` L631: « son score moyen reste à moins d'une étoile de la médiane des testeurs, et il ne réussit pas plus de parfaites qu'eux »). Architecture: Automatisation (`game-architecture.md` L283-285, L988). Sixth story of the v2.3 catch-up (`sprint-change-proposal-2026-11-03.md` §3: 3.12, 2.11, 3.13, 2.12, 2.13, **3.14**, 3.15, 3.16, then a playtest, then E9). It comes after 2.11 « car l'anneau change ce qu'un humain peut faire ». 2.13 (coffee and phone poses, client only) is still `backlog`: nothing here depends on it.

**The playtest finding.** On 2026-11-03 the `human` bot made 84 points / 4★ with 75 % perfects on the salon, while Geo stayed at 20 points / 1★ with **no perfect at all** (no chrono-ring then). Measured at this story's creation on the live salon with the five-row note of 3.12 and the director of 3.13 (`npm run sim -- --bot human --runs 20 --seed 1000`, normal tier): **79.2 points, 4★ in all 20 games, 61.2 % perfects (995 responses), 99.8 % success**, Calme 15 / 20 in every game. The bot today is a precise, attentive player who never misses a threat, with a 60 ms Gaussian spread around the centre and a fixed 250 ms reaction floor (`src/bots/humanBot.ts`).

**The reference (Geo's decision, 2026-11-04).** Geo kept no journal of the 2026-11-03 playtest (story 3.12, Open point 1), so the AC that compares `human` with « the median of those journals » cannot be met as written. Geo chose:
- **With the chrono-ring** (what the game shows today): Geo plays **at least 5 new games of the salon** at the normal tier and exports them (« Copier le journal »). The bot with the ring is compared with their median.
- **Without the chrono-ring** (the 2026-11-03 conditions): the reference is Geo's tally of that playtest as story 3.12 fixed it (D7 of 3.12): **0 perfect**, and with today's note **34 points, 1★**.
- **Calme du bébé** (deferred from the 3.12 review to this story): measured with the new bot, and 2 or 3 numbered settings proposed; **Geo picks at the review, nothing in `feel.json` moves without his OK**.

## Acceptance Criteria

### The model (`content/bots.json › human`, `src/bots/humanBot.ts`)

1. **Reaction time.** Given `bots.json › human`, when the bot plans a response that waits for a sight or a signal (a parry, a Firmness, the bomb drop's press, a `wait` signal, a held breath, finding the baby of a silence, the final rush's first tidy), then its reaction floor is a draw `max(reactionMinMs, reactionMeanMs + reactionSdMs × N(0, 1))`, one draw per response planned, in whole ms (D2). With `reactionSdMs` 0 no draw is taken and the reaction is `max(reactionMinMs, reactionMeanMs)`.
2. **Read error by what is shown.** Given a threat whose response has a chrono-ring (D1: `parry` and `firm`, the bomb drop's release included), when the bot aims its press (or its release, for the drop), then the aim is `centre + readError.<mode>.offsetMs + readError.<mode>.sdMs × N(0, 1)`, where `<mode>` is `withChronoRing` if the setup says the ring is shown and `withoutChronoRing` otherwise (D1). A response without a ring (`wait`, `nothing`, the lullaby's beats) keeps today's `aimOffsetMs` / `jitterSdMs` and does not depend on the mode.
3. **Not seeing a threat while busy.** Given a threat the bot sees for the first time in its cycle while it is **busy elsewhere** (D3: its finger is down or a press of another threat is planned and not yet sent, a silence's find is pending, or Papa is `asleep`, `drink`, `onPhone` or `onToilet`), when it decides, then with probability `missWhileBusyPct` % it never answers that cycle (the threat ends in its gag, `late`), one draw per such decision; with `missWhileBusyPct` 0 no draw is taken. A threat first seen while the bot is free is always answered. The decision is taken once per cycle, including for a threat that appears while a Firmness is held (it is decided then and answered once the finger is free, as today).
4. **All tunable, all checked.** Every number above is a key of `bots.json › human` in `BotsSchema` (strict, units in the names, bounds: `reactionMinMs` ≥ 0, `reactionSdMs` ≥ 0, `sdMs` ≥ 0, `missWhileBusyPct` in [0, 100], no `.default()`), mirrored in `BotOptions` (`src/bots/bot.ts`, the compile-time check of `botContract.test.ts` still holds) and refused by `createBot`'s `setupProblem` when out of range, with a message naming the key. `content/_schemas/bots.schema.json` is regenerated (`npm run content:schemas`), `npm run content:check` passes.
5. **Determinism and the contract.** The `botContract.test.ts` suite passes for all four bots (never mutates the world, `t` in the coming step, same game twice for a seed, its journal replays to the same world). The bot draws only from its own RNG (`botSeed`), never from `world.rng`.
6. **Nothing moves with the frozen settings.** Given `createTestBots()` set so that the new model reduces to today's (D4: `reactionSdMs` 0, `reactionMinMs` ≤ `reactionMeanMs` = 250, `withChronoRing` = `{ offsetMs: 0, sdMs: 60 }`, `missWhileBusyPct` 0) and the ring shown, when every bot test plays, then the `human` games are **byte-identical to before this story**: a new test pins `hashJson(sim.journal())` of `human` on `botTestLevel()` and `botTrioLevel()` for 3 seeds, the hashes computed on the code **before** the change (write the test first, run it on the old code, keep the values). The existing bot tests (`humanBot`, `firmBots`, `dropBots`, `waitBots`, `beatBots`, `silenceBots`, `stealthBots`, `tidyBots`, `instinct`, `bedtimeCycleFuzz`) pass without loosening.

### Ring shown or not (the comparison setting)

7. **The setup says it.** `BotSetup` gains a required `isChronoRingShown: boolean` (required like `releaseDefIds`, D1). The browser autoplay (`src/debug/autoplay.ts`) passes `true` (the game always draws the ring since 2.11). `perfect`, `random` and `idle` ignore it.
8. **The CLI says it.** `npm run sim -- --chrono-ring on|off` (default `on`) sets it; an unknown value is an error naming the choices; `--help` documents it. The report gains a top-level `chronoRing: 'on' | 'off'` and the run file is unchanged (a replay reads commands, not the bot).

### The comparison with Geo's games

9. **Geo's journals.** Given at least 5 games of the salon exported by Geo from a dev or playtest build at the normal tier, saved as `docs/playtest/journals/geo/<n>.json` (the `<dir>/<testerId>/*.json` layout of `playtest:metrics`, D5), when the story is done, then they are committed; `npm run playtest:metrics -- docs/playtest/journals` reads them with no input error. **If they are not there when the dev reaches Task 5, the dev stops and asks Geo for them** (everything else can be built and tested first).
10. **`npm run sim -- --compare <dir>`.** Given `--compare docs/playtest/journals`, when the report is written, then it holds a `comparison` block (D6): the games kept (same level as `--level`, same tier as `--tier`, five-row score) and the ones skipped with their reason (another level, another tier, a four-row score, and whatever `loadJournals` skips); the journals' median of `stars`, `scorePoints` and per-game perfect rate; the bot's `meanStars`, `meanScore` and `perfectPct`; the two gaps; and a status per indicator, `OK` when `|meanStars − medianStars| < humanBot.maxStarGap` (1) and `perfectPct − medianPerfectPct ≤ humanBot.maxPerfectExcessPct` (10), `n/a` when no game is kept. The two thresholds live in `content/playtest.json › humanBot` (schema, JSON Schema, `content:check`). Without `--compare` the block is `null`. A KO is not an error (exit 0, as `playtest:metrics`); an unreadable folder is (exit 1).
11. **With the ring, against Geo's new games.** Given `npm run sim -- --bot human --runs 200 --compare docs/playtest/journals` (salon, normal tier, ring on), when it runs, then both statuses are `OK`. The dev tunes `bots.json › human` to get there (D7), and the before / after numbers are in the Completion Notes.
12. **Without the ring, against the 2026-11-03 tally.** Given `npm run sim -- --bot human --runs 200 --chrono-ring off` (salon, normal tier), when it runs, then `meanStars` is within one star of 1★ (`meanStars < 2`) and `perfectPct ≤ 10` (0 perfect + 10 points), with the same `bots.json` as AC 11 (one set of values serves both modes: only `readError` differs by mode). Numbers in the Completion Notes.

### The report and what must not break

13. **The report keeps its fields.** Given `npm run sim`, when the report is written, then every field it had keeps its name, type and meaning (`playtest:metrics`, the 3.12 / 3.13 notes and the fairness check read them); it only gains `chronoRing`, `perfectPct` (pooled over every response of every run, one decimal, `null` when there is none), each run's `perfectPct`, and `comparison`. `simReport.test.ts`'s whole-report tests gain the new fields and nothing else. `playtest:metrics` keeps its behaviour and its tests stay green; the only change is that it exports `loadThresholds` and returns the whole `playtest.json` (its test file gains one `isChronoRingShown` line).
14. **The other bots and levels.** `perfect` plays exactly as before (`fairnessCheck.test.ts` › « perfect fails nothing » and the 3.13 numbers). On `chambre_night`, `npm run sim -- --bot human --level chambre_night --runs 20` still completes the bedtime cycle in most games (before / after in the Completion Notes; a drop is reported, not hidden).
15. **The browser.** `?autoplay=human` still plays a whole salon level to the Result screen at seed 1 (the perf spec of `npm run e2e:dist` and `characters.spec.ts` / `juice.spec.ts` need it). If the tuned bot wakes Mama before the timer at seed 1, say so and see Traps; never loosen a perf budget.

### Calme du bébé (deferred from 3.12)

16. **Measured and proposed, not changed.** Given the tuned bot, when the story is done, then the Completion Notes hold `meanRows.calmPoints` (and its spread over the runs) for `perfect`, `human` ring on, `human` ring off and `idle` on the salon (`--runs 50`), and 2 or 3 options with their numbers (for example `mama.calmNoiseThresholdPct` 40 / 60, `noise.sources.phoneRinging.perSec` lower, the share of a `mamaWoke` game taken over `durationMs`), measured by changing the value for the run only. `content/feel.json` is unchanged at the end of the story unless Geo has said which option in chat; the open point is listed for him.

### Docs

17. `_bmad-output/project-context.md` (the Bots bullet, L156) describes the human model, `isChronoRingShown`, `--chrono-ring` and `--compare`; `CLAUDE.md`'s `npm run sim` row names the two flags; `game-architecture.md` L285 already matches (check it); `deferred-work.md`'s « Calme du bébé » item points to this story's open point.

## Tasks / Subtasks

- [x] **Task 1: Pin today's games first** (AC 6)
  - [x] In `tests/bots/humanBot.test.ts` (or a new `humanBotRegression.test.ts`), a test that plays `human` on `botTestLevel()` and `botTrioLevel()` for seeds 1, 2, 3 (`BOT_TEST_UNTIL_MS`) and pins `hashJson(sim.journal())`. Run it on the **unchanged** code, write the six hashes in, commit nothing yet. It is the proof that the frozen settings reduce to today's bot.
- [x] **Task 2: Settings, schema, contract** (AC 4, 5, 7)
  - [x] `src/content/schemas/bots.ts`: the new `human` keys (D2), `.describe()` on each, strict; `npm run content:schemas`.
  - [x] `content/bots.json`: starting values (D7) before tuning.
  - [x] `src/bots/bot.ts`: `BotOptions.human` mirrors the schema; `BotSetup.isChronoRingShown`.
  - [x] `src/bots/createBot.ts`: `setupProblem` checks every new key; `tests/bots/createBot.test.ts` one case per key.
  - [x] `tests/support/testContent.ts › createTestBots()` with the D4 values; `tests/support/botSupport.ts › botSetup()` passes `isChronoRingShown: true`; every other `BotSetup` literal (`grep -rn "releaseDefIds" src tools tests`) gains it: `tools/sim/runSim.ts`, `src/debug/autoplay.ts` and its test, the bot tests.
  - [x] `tests/content/botsSchema.test.ts` and `tests/content/loadContent.test.ts`: the new shape, a value out of range refused.
- [x] **Task 3: The model** (AC 1, 2, 3, 5, 6)
  - [x] `src/bots/threatTiming.ts`: `HAS_CHRONO_RING: Readonly<Record<BotResponse, boolean>>` (`parry`, `firm` true; `wait`, `nothing` false), exhaustive like `fingerPlanFor`; a test in `tests/architecture/` or `tests/bots/` asserts it equals the client's `hasChronoRing` for every response (D1).
  - [x] `src/bots/humanBot.ts`: `drawReaction()` (AC 1), the aim by mode (AC 2), the attention memory and the busy test (AC 3, D3). Keep one draw per decision, no draw when an sd or a percentage is 0 (D4). Update the class doc comment (it lists every path: keep it true).
  - [x] Unit tests (`tests/bots/humanModel.test.ts`; fake worlds for the busy rules, since the frozen levels never overlap two threats): a large `withoutChronoRing.sdMs` with the ring hidden gives fewer perfects than with it shown on the same seeds; `missWhileBusyPct` 100 misses a threat first seen while a Firmness is held or while a press is planned and 0 never does; a threat first seen while free is answered whatever the percentage; `reactionSdMs` > 0 spreads the press instants of a late-aimed threat; `reactionMinMs` is a floor; the bomb drop's release uses the mode; a `wait` and a beat do not change with the mode.
  - [x] Task 1's test green with the new code.
- [x] **Task 4: CLI and report** (AC 8, 10, 13)
  - [x] `tools/sim/simArgs.ts`: `--chrono-ring on|off` and `--compare <dir>`, `SIM_HELP`; `tests/tools/sim/simArgs.test.ts`.
  - [x] `tools/sim/simReport.ts`: `perfectPct` per run and pooled, `chronoRing`, `comparison: HumanComparison | null`; `renderReport` unchanged in form.
  - [x] `tools/sim/humanComparison.ts` (new, D6): reads the panel with `loadJournals` (`tools/playtest/loadJournals.ts`), filters by level, tier and score shape, computes medians and statuses; pure computation split from the I/O for tests. `content/playtest.json › humanBot { maxStarGap, maxPerfectExcessPct }` with schema (`src/content/schemas/playtest.ts`), JSON Schema, `content:check`.
  - [x] `tools/sim/runSim.ts`: passes the mode to the setup, loads the comparison in `main()` (I/O stays out of `runSim`), logs a `warn` per skipped journal.
  - [x] Tests: `tests/tools/sim/humanComparison.test.ts` (median of an even and an odd count, a level / tier / legacy-score skip, `n/a` with no game, both statuses at and around their thresholds, using journals built by `makeJournal` of `tests/tools/playtest/support.ts`), `simReport.test.ts` (new fields), `runSim.test.ts` (`--chrono-ring off` changes a `human` game, not a `perfect` one), `cli.test.ts` (`--compare` on a fixture panel, exit 0 on KO, exit 1 on a missing folder).
- [x] **Task 5: Geo's games and the tuning** (AC 9, 11, 12, 14, 15)
  - [x] (waived by Geo in chat, 2026-11-04: « je ne vais pas pouvoir te fournir les journaux, on avance sans »; AC 9 and AC 11 stay unmet) Check `docs/playtest/journals/geo/`: **if it holds fewer than 5 salon journals, stop and ask Geo** (« What Geo does » below); finish everything else first.
  - [x] (waived with the journals) Run `npm run playtest:metrics -- docs/playtest/journals` (no input error) and note the median stars, score, perfect rate.
  - [x] Tune `bots.json › human` (D7) until AC 12 holds (AC 11 is waived with the journals: the ring-on values are a judgement, not a measurement against Geo's games), with `--runs 200`; keep the steps and the final numbers for the Completion Notes. Run under `caffeinate -i -s`.
  - [x] Check `perfect` (unchanged), `human` on `chambre_night` (AC 14) and the end reason of seed 1 on the salon with the ring on (AC 15: `npm run sim -- --bot human --seed 1`).
- [x] **Task 6: Calme du bébé** (AC 16)
  - [x] `--runs 50` for `perfect`, `human` on and off, `idle`; then each option, the value changed for the run only and put back. Table in the Completion Notes; open point for Geo.
- [x] **Task 7: Docs and checks** (AC 17)
  - [x] `project-context.md`, `CLAUDE.md`, `deferred-work.md`; check `game-architecture.md` L285.
  - [x] `npm run ci:fast` after each task; e2e on Chromium for the specs that autoplay `human`: `npm run e2e -- tests/e2e/characters.spec.ts tests/e2e/juice.spec.ts tests/e2e/autoplay.spec.ts --project=chromium`, in the background. `ci:story` is the review's.

### Review Findings

Code review of 2026-11-04 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; the whole diff `main...story/3-14-…`).

- [x] [Review][Patch] Decided by Geo (2026-11-04): the story closes `done` with AC 9 and AC 11 recorded as waived, not met. Annotate the Task 5 line « Tune … until AC 11 and AC 12 hold » so it no longer reads as if AC 11 held (the ring-on values `withChronoRing.sdMs` 90 and `missWhileBusyPct` 10 are a judgement, not a measurement against Geo's games) [this file, Task 5]
- [x] [Review][Patch] Decided by Geo (2026-11-04): keep a missed false alarm as is (a distracted bot does not hold its breath, so it never gasps). Say so in the `missWhileBusyPct` description and in the Completion Notes; no code change [src/content/schemas/bots.ts, this file]
- [x] [Review][Patch] `--compare` status uses rounded values, not the stated inequality: medians and gaps go through `round1` before `< maxStarGap` / `<= maxPerfectExcessPct`, so a true gap of 0.96 reads `KO` and a true excess of 10.04 reads `OK` (AC 10). Compare the unrounded values and round for display only [tools/sim/humanComparison.ts:121-148]
- [x] [Review][Patch] `--compare` guards: reject `--compare` with `--until-ms` or `--sequence` (truncated or altered games against full tester games), warn when `--compare` or `--chrono-ring` is given with a bot that ignores it (the report would claim `chronoRing: 'off'`), and log a `warn` when no game is kept (`n/a`, exit 0) [tools/sim/simArgs.ts, tools/sim/runSim.ts, tools/sim/humanComparison.ts]
- [x] [Review][Patch] Reaction and error fields have no upper bound: only `readError.*.sdMs` is capped, so `reactionMeanMs`, `reactionSdMs`, `reactionMinMs`, `jitterSdMs` and `readError.*.offsetMs` accept 25000 and send a press into another cycle (Traps section). Cap them in the schema and in `setupProblem`, with a test per key [src/content/schemas/bots.ts, src/bots/createBot.ts]
- [x] [Review][Patch] `BUSY_PAPA_STATES` is a `ReadonlySet<string>`: renaming a Papa state still typechecks and turns the rule off silently. Type it on `World['papa']['state']` [src/bots/humanBot.ts:28]
- [x] [Review][Patch] Two D3 busy conditions are not pinned: removing `firmHold.tapUntil > now` or `find !== null` from `isBusy` passes every test. Add one case each [tests/bots/humanModel.test.ts]
- [x] [Review][Patch] `reactionsOf` pairs presses with telegraphs by array index, so one missed or gagged threat shifts every later pair and the lag checks stay green. Match by `threatId` [tests/bots/humanModel.test.ts]
- [x] [Review][Patch] Story text contradicts the diff: AC 13 says `playtest:metrics` and its tests are untouched, but `loadThresholds` is now exported (`tools/playtest/playtestMetrics.ts`) and its test gains a line; the Completion Notes say « no `playtest:metrics` test moved » and the File structure omits the file. Also remove the stale « Previously: `docs/playtest/journals/geo/` does not exist yet … wait for at least 5 salon games » sentence in the « Tasks 5-7 done as far as possible » note [this file]
- [x] [Review][Defer] The comparison cannot tell which conditions the testers' games were played in: journals do not record the chrono-ring, `--chrono-ring` defaults to `on`, and `isChronoRingShown: true` is hard-coded in autoplay — deferred, needs a panel and a journal field; revisit with the post-catch-up playtest [tools/sim/runSim.ts, src/debug/autoplay.ts]
- [x] [Review][Defer] The bot's `perfectPct` is pooled over all runs and responses while the testers' figure is a median of per-game rates, and the verdict ignores `panelMinTesters` (5), so a panel of one tester gives `OK` or `KO` — deferred, matches AC 10 as written; a panel of Geo alone would be `n/a` under that rule [tools/sim/humanComparison.ts]
- [x] [Review][Defer] `isBusy` reads `scheduler.size`, which the bot's own plans of the same tick change: the second of two simultaneous threats is « busy » by array order, and a held breath makes every real threat in its window miss-eligible — deferred, it is D3's wording and the Completion Notes disclose it; the director of 3.13 keeps simultaneous threats rare [src/bots/humanBot.ts:115-120]

Dismissed as noise: 12 (handled elsewhere, matches the spec, or no effect: `readError` undefined is excluded by the types, `aimOf` always draws as before so the frozen hashes hold, the `missed` map is keyed by cycle like `cycles` and `attention`, `runSim` importing `loadThresholds` is safe behind `playtestMetrics`' entry guard, the one-sided perfect check is the GDD's wording, the `legacyHuman()` test rewrites keep the same assertions, …).

## Dev Notes

### Decisions

- **D1. The ring is the bot's knowledge, not the sim's.** The sim knows nothing of the ring (it is client UI, 2.11 AC 19). Whether a response has one is the client's `HAS_CHRONO_RING` (`src/client/ui/world/chronoRing.ts:28`, typed on `ThreatResponse`): `parry` and `firm` yes (the bomb drop, a `firm` with `release`, too: 2.11 D1), `wait` and `nothing` no. `src/bots` may not import `client`, so it keeps its own table typed on `BotResponse` (exhaustive: a new response fails to typecheck, as `fingerPlanFor` does), and a test that imports both pins them equal. Whether the ring is shown is a run setting (`BotSetup.isChronoRingShown`), not content: the game always shows it; `--chrono-ring off` exists to replay the conditions of 2026-11-03.
- **D2. The new `human` shape.**
  ```json
  "human": {
    "reactionMeanMs": 250, "reactionSdMs": 50, "reactionMinMs": 150,
    "readError": {
      "withChronoRing":    { "offsetMs": 0, "sdMs": 60 },
      "withoutChronoRing": { "offsetMs": 0, "sdMs": 200 }
    },
    "aimOffsetMs": 0, "jitterSdMs": 60,
    "missWhileBusyPct": 20
  }
  ```
  `reactionMs` becomes `reactionMeanMs` / `reactionSdMs` / `reactionMinMs` (a rename: no alias, `bots.json` is not part of any journal, D8). `readError` is the timing error on a response with a ring; `aimOffsetMs` / `jitterSdMs` stay the error on a rhythm or a signal (beats, `wait`, breath), so the sequence paths keep their meaning. The values above are starting points, not targets (D7).
- **D3. « Busy elsewhere ».** Decided when a threat is first seen in its cycle (the first `act` where it is pressable and new to the bot's attention memory, which is keyed like `createCycleMemory`: threat id and cycle). Busy means any of: `firmHold.isHolding`; a tap's finger still down (`firmHold.tapUntil > now`); a press of another threat planned and not yet sent; a silence find pending (`find !== null`); Papa's state is `asleep`, `drink`, `onPhone` or `onToilet` (walking or gliding is not busy: it is how Papa gets there). A missed threat is remembered as missed for that cycle, so it is never planned later in the cycle; it is seen afresh when it rearms. Today's loop `break`s while a Firmness is held, before any threat is looked at: the attention decision must run for new threats **before** that `break`, and the plan still waits for the finger. Only threats (`world.threats`) can be missed; the silence's find, beats and the rush are not (the silence is noticed by its quiet, a beat is counted).
- **D4. The frozen settings reduce to today's bot.** Draws are taken only when they can matter: no reaction draw when `reactionSdMs` is 0, no attention draw when `missWhileBusyPct` is 0 (or when the bot is free). With `createTestBots()` at `reactionSdMs` 0, `reactionMeanMs` 250, `reactionMinMs` ≤ 250, `withChronoRing` `{ 0, 60 }` and `missWhileBusyPct` 0, the ring shown, the order and number of draws are exactly today's, so the frozen tests play the same games (AC 6, Task 1). Today's aim draw happens after `cycles.isNew`; keep that order.
- **D5. Where Geo's games go.** `docs/playtest/journals/geo/` rather than the epic's `docs/playtest/geo/`: `loadJournals` reads a panel `<dir>/<testerId>/*.json` and refuses a journal directly in `<dir>`, so `docs/playtest/journals` is the panel and `geo` the tester. The post-catch-up playtest can put its testers beside it and the same `--compare` measures the GDD indicator against the testers (the success criterion of the change proposal). The journals hold no personal data (NFR14), so they are committed.
- **D6. The comparison.** `HumanComparison`: `{ dir, games, skipped: { file, reason }[], medianStars, medianScorePoints, medianPerfectPct, botMeanStars, botMeanScore, botPerfectPct, starGap, perfectExcessPct, starStatus, perfectStatus }` (`Status` of `tools/playtest/computeMetrics.ts`: `'OK' | 'KO' | 'n/a'`). A game's perfect rate is `byQuality.perfect / (perfect + success + fail)` of `summary.responses`; a game with no response is skipped. Medians: middle value, mean of the two middle ones for an even count. A game's tier is the `tier` of the last `SetDifficultyTier` in `replay.journal.entries` (the default tier when there is none: the tier is not in the summary, deferred-work 2.8); a game of another tier than `--tier` is skipped. A four-row score (`babyStatePoints`, before v2.3) is skipped: it is another note. The bot side reads the report's own `meanStars`, `meanScore` and `perfectPct`, so the comparison is a pure function of the report and the panel.
- **D7. Tuning.** Tune `readError.withChronoRing` against Geo's games (AC 11) and `readError.withoutChronoRing` against the tally (AC 12), with `reactionMeanMs` / `reactionSdMs` / `missWhileBusyPct` shared by both modes. Look at Geo's journals before choosing: their `timeline[].offsetMs` gives his real read error with the ring (mean and spread of the offsets of his judged presses) and `failReasons`-like data (`reason: early | late`) says whether he is early or late; start from those numbers rather than guessing. The no-ring target (≤ 10 % perfects) needs a wide spread: P(|N| < 50 / sd) ≤ 0.10 means `sdMs` ≥ about 400 ms if centred, or a bias (`offsetMs`); expect many fails and more noise. Say which values were tried. This is the bot's tuning, not a feel change: `bots.json` is Geo's to retune later like `feel.json`.
- **D8. No golden moves.** No golden scenario plays a bot (`tests/golden/*` are scripted journals), `bots.json` is not in `feelHash` (`src/content/schemas/bots.ts` header) and the sim is untouched: `npm test` must pass with **no golden regenerated**. If one moves, it is a bug.

### What Geo does (Task 5)

Play at least 5 games of the salon at the normal tier, as you would at a playtest, then export each one:
1. `(unset VITE_DEBUG_ALLOWED; npm run dev)` in the main checkout, open the printed URL (the salon is the default level), or a playtest build (`npm run build:playtest`, then `npm run serve:dist`).
2. On the Result screen, « Copier le journal », then paste it into a new file `docs/playtest/journals/geo/1.json` (then `2.json`, …). If the clipboard refuses, « Télécharger le journal » saves the file: move it there.
3. Tell the dev agent they are there (in the story's worktree, or anywhere: the agent copies them in).

### The current code this story changes

- **`src/bots/humanBot.ts` (156 lines).** One RNG (`createRng(botSeed(seed))`), `nextGaussian` (Box–Muller, two `nextFloat` per draw: `src/bots/gaussian.ts`). Paths, in `act` order: the lullaby beat tap (`nextBeatAt + aimOffsetMs + jitter`, no reaction floor); the silence find (`startedAt + reactionMs`, no draw); `firmHold.update`; then for each threat: `if (firmHold.isHolding) break` (one finger), `isPressable`, `responseOf`; `nothing` → breath hold at `enteredAt + reactionMs`, release at window end `+ aimOffsetMs + jitter` (one draw, own `breaths` cycle memory); `wait` → skipped until `windowOpen`, then `windowOpenAt + reactionMs + aimOffsetMs + jitter`; a release def (bomb drop) → press at `enteredAt + reactionMs`, release at `centre + aimOffsetMs + jitter`; parry / firm → `max(enteredAt + reactionMs, centre + aimOffsetMs + jitter)`, never before `now`. Then `scheduler.flush`, `planStealthWalk`, `planCycleDrop`, `planTidy(…, reactionMs)`.
- **`src/bots/threatTiming.ts`.** `centreOf`, `isPressable`, `fingerPlanFor` (exhaustive on `BotResponse`), `createFirmHold` (`isHolding`, `tapUntil`, `noteTap`, `begin`, `update`), `schedulePress`, `scheduleDrop`, the cycle / silence / tidy / stealth / cycle-drop memories, `planTidy`. Shared with `perfectBot.ts`: change nothing `perfect` uses.
- **`src/bots/bot.ts`.** `BotOptions` (the bots' copy of `content/bots.json`, checked at compile time by `botContract.test.ts`), `BotSetup` (`seed`, `holdMinMs`, `responses`, `releaseDefIds`, `safeSpot`, `settings`), `Bot.act` contract.
- **`src/bots/createBot.ts`.** `setupProblem` validates the setup (a CLI input) and returns a message, never throws.
- **`src/content/schemas/bots.ts`.** `BotsSchema` (strict, `.describe()` on every key); not part of the feel on purpose.
- **`tools/sim/runSim.ts` / `simArgs.ts` / `simReport.ts`.** `runSim` builds one `BotSetup` per run from `content.bots`; `parseSimArgs` is pure (`node:util` `parseArgs`, strict); `SimReport` has `meanScore`, `meanStars`, `meanRows`, `starCounts`, `meanSuccessPct`, `threats[id].perfectPct` (per threat only: no pooled perfect rate yet), `hashes.bots`, `runList`.
- **`tools/playtest/loadJournals.ts`.** `loadJournals(dir)` returns `{ testers, skipped, warnings, levels, contentHashes, filesRead }` or a list of input errors; it already skips bot run files, autoplay games, duplicates and invalid files. Reuse it; do not re-read journals by hand.
- **`src/debug/autoplay.ts:60-66`.** Builds the browser bot's `BotSetup` from `host.content.bots`.

### What must keep working

- `perfect`, `random`, `idle`: same games as before (they ignore the new fields).
- Every bot path on the frozen settings (AC 6): the beat, wait, feint (never falls for it), drop, stealth, tidy, cycle and instinct tests.
- `npm run sim:replay` of any run file and journal (it replays commands; the bot is not involved).
- `npm run playtest:metrics` (it reads journals; `loadJournals` is only reused).
- The browser autoplay to the Result screen (`characters.spec.ts`, `juice.spec.ts` « succeed without a perfect at least once », `autoplay.spec.ts`, `perf.spec.ts` in `e2e:dist`).
- The fairness numbers of 3.13 for `perfect` (`fairnessCheck.test.ts` › « counts none for perfect and human … and perfect fails nothing »: `human` must still meet no unfair pair; its fails are not asserted).

### Traps

- **A worse `human` makes more noise.** More fails mean more props on the floor and more near misses; with the phone (7 %/s, peaks near 91 % when ignored) the realistic bot may wake Mama. `perf.spec.ts` (`npm run e2e:dist`, only in `npm run ci`) needs a whole level of `?autoplay=human&seed=1` to count enough frames, and `characters.spec.ts` / `juice.spec.ts` autoplay `human` too. Check `npm run sim -- --bot human --seed 1` (ring on) ends on `timer`. If it ends on `mamaWoke`, do not detune the bot and do not loosen the budget: say so, and propose to Geo either another seed for those specs (a seed the report shows ending on `timer`) or the perfect bot for the perf spec; he decides.
- **The press must stay in its cycle.** A wide no-ring spread plus a drawn reaction can plan a press far after the window (deferred-work 1.12: « A late human press is not capped at the end of its cycle »). The rearm cooldown is seconds long, so this only bites with absurd values; still, clamp nothing silently: if a planned press would fall after `windowOpenAt + windowMs + toleranceMs`, it is a `late` fail either way. Keep `setupProblem` bounds sane (say, an `sdMs` above 2000 is refused) so a tuning typo cannot send presses into the next cycle.
- **The draw order is the regression proof.** Task 1's hashes break if a draw is added, removed or moved on the frozen path. Draw the attention only when busy and the percentage is above 0; draw the reaction only when its sd is above 0; keep the aim draw where it is.
- **`reactionMs` is read in five places** (`humanBot.ts`: find, breath, drop, wait, parry; `planTidy`): each becomes a drawn reaction (one draw per response planned), except where D4 says no draw.
- **Whole-report tests.** `simReport.test.ts` builds whole reports: add the new fields there, do not drop old ones (3.12 / 3.13 trap).
- **`content/playtest.json` gains a block**: its schema, `content/_schemas/playtest.schema.json` (`npm run content:schemas`, never by hand) and `computeMetrics`' typed thresholds (`PlaytestThresholds`) must still compile; `playtest:metrics` does not read the new block.
- **`VITE_DEBUG_ALLOWED`.** Not exported in this shell at the story's creation (`env | grep VITE_` printed nothing); check again before `dev` or `e2e`, and run them as `(unset VITE_DEBUG_ALLOWED; …)` if it is set.
- **Heavy checks queue** (`tools/ci/heavyLock.sh`): `npm run e2e -- …` in the background, never `npx playwright test`. 200-run sims take minutes: run them in the background under `caffeinate -i -s` (the Mac sleeps).
- **The worktree guard** refuses compound shell commands that name `git`, `cd` into computed paths, subshells in complex constructs and variables in an option position: plain commands, the edit tools, or one script file in the scratchpad. In zsh, an argument starting with `=` (an `echo ===` separator) is expanded and fails: quote it. A throwaway `tsx` script needs `.mts` and `npx tsx --tsconfig ./tsconfig.json <script>` from the worktree.

### Out of scope

- The visibility model of the follow camera (E9, architecture L285): the bot reacts to an off-screen threat only once its bubble shows. Keep the attention code open to it (a « can it see this threat » test beside the busy test), build nothing for it.
- A bot that answers the phone or drinks coffee (deferred since 1.20); a bot that lifts a Firmness early (deferred from 1.23, moved to 3.4): the loss-rate indicator (10-30 % for `human`) is 3.16's AC, not this one's. Note in the Completion Notes what the new bot's `endsByReason` is, for 3.16.
- Changing the note, the director, the sim or the client (no file under `src/sim` or `src/client` changes; `src/debug/autoplay.ts` gains one field).
- A client setting to hide the ring (Geo chose new games with the ring instead).
- Applying a Calme option (AC 16: proposed only).

### Architecture compliance

- Layers: `src/bots` imports `@sim` (public API) and `@shared` only; the ring table is its own (D1). `tools/sim` may import `tools/playtest` and `@content`. No `console.*` (`log` in tools), I/O returns `Result`, every skipped journal logs a `warn`.
- The bot never mutates `world`, never touches `world.rng`, plans commands with `t` in `[now, now + STEP_MS)` (the contract test).
- Automatisation (L283-285): the parameters named by the architecture (reaction mean and sd, read error by ring, inattention) are data in `content/bots.json › human`.
- Content rules: strict schema, camelCase keys with unit suffixes, no `.default()` / `.optional()` / `.transform()`, generated JSON Schema committed.

### Library and framework notes

Stack pinned, nothing added: TypeScript 7, Zod 4 (`z.strictObject`), Vitest 5, Playwright 1.64, `tsx` for `tools/`, `node:util` `parseArgs`. No web research needed: the story uses no API the codebase does not already use.

### File structure

- **New:** `tools/sim/humanComparison.ts`; `tests/tools/sim/humanComparison.test.ts`; the regression test of Task 1 (in `tests/bots/`); `docs/playtest/journals/geo/*.json` (Geo's games).
- **Updated:** `src/bots/{bot,createBot,humanBot,threatTiming}.ts`; `src/content/schemas/{bots,playtest}.ts`; `content/{bots,playtest}.json`; `content/_schemas/{bots,playtest}.schema.json` (generated); `src/debug/autoplay.ts` and its test; `tools/sim/{simArgs,simReport,runSim}.ts`; `tests/support/{testContent,botSupport}.ts`; `tests/bots/*` that build a `BotSetup` or a `human` setting; `tests/content/{botsSchema,loadContent}.test.ts` and the playtest schema test; `tests/tools/sim/{simArgs,simReport,runSim,cli}.test.ts`; `_bmad-output/project-context.md`; `CLAUDE.md`; `_bmad-output/implementation-artifacts/deferred-work.md`.

### Testing

- **Bots (frozen levels and settings, `tests/support/botSupport.ts`):** AC 6's hashes; one test per model rule (Task 3), each able to fail (the 3.5 / 3.12 lesson: assert on things that exist, compare two settings on the same seeds rather than « some fail »).
- **Tools:** the comparison as a pure function on hand-built journals (`makeJournal` in `tests/tools/playtest/support.ts` builds valid journal files), then one CLI test on a fixture panel; `runSim` with each ring mode.
- **Measurements (CLI, not tests):** the 200-run numbers of AC 11, 12, 14, 16 in the Completion Notes. A test does not read `content/bots.json`'s live values: Geo retunes it.
- **E2E (Chromium, background):** `characters.spec.ts`, `juice.spec.ts`, `autoplay.spec.ts` (its macOS screenshot is a frozen frame: it should not move; if it does, look before regenerating and say so).
- **Checks:** `npm run ci:fast` per task; `ci:story` is the review's.

### Previous story intelligence

- **3.13 (director fairness):** « the obvious test cannot fail » was the lesson: here, « `human` gets fewer perfects » is easy to make pass; AC 6 (byte-identical games on the frozen settings) and the paired-seed tests are the real proof. 3.13 added `fairnessViolations`, `stretchedTelegraphs`, `meanStretchMs` to the report: keep them. The 3.13 numbers for `human` (200 seeds: 79.8 points, 99.9 % success, 7 gags) are the « before » of this story.
- **3.12 (five-row note):** `meanRows` exists; D7's « Geo » tally (0 perfect, 20 successes, 3 props on the floor, 5 near misses, half the time calm → 34 points, 1★) is pinned in `mamaScore` tests and is AC 12's reference. Its review deferred the Calme tuning here (Geo: « tune it in 3.14: threshold, the phone, the bots »).
- **2.11 (chrono-ring):** the ring is drawn on `parry` and `firm` (the drop included), never on `wait` / `nothing`; `HAS_CHRONO_RING` is the table to mirror. It said « The `human` bot's read error with and without the ring (3.14) ».
- **2.12 (activity bubble):** a busy Papa's taps are refused (`TapRefused`); the bot's busy test reads Papa's state, the same states the bubble shows.
- **1.12 / 1.23 / 4.x:** `human`'s doc comment lists every path; each later story extended it. Keep it exact.

### Git intelligence

Recent `main`: `e720fd9` merge of 2.12 (activity bubble, `TapRefused`), `a71429c` merge of 3.13 (director fairness, `tools/sim/fairnessCheck.ts`, new report fields), 3.12 before them (five-row note, `meanRows`). No recent change to `src/bots` beyond 4.10 (the cycle bot) and 3.5 (`planTidy`).

### Project Structure Notes

Follows the layers and aliases: the model in `src/bots`, the comparison in `tools/sim` (Node only, never imported by `src/`), settings in `content/bots.json` and thresholds in `content/playtest.json`. One variance, D5: Geo's games in `docs/playtest/journals/geo/` instead of `docs/playtest/geo/`, for `loadJournals`' layout.

### Project Context Rules

- Golden rule: the AI writes and tests the bot, Geo plays and tunes; every number Geo might tweak is data (`bots.json`, `playtest.json`), none in code.
- Units are suffixes (`reactionMeanMs`, `sdMs`, `missWhileBusyPct`, `perfectPct`, `maxPerfectExcessPct`); `…At` is sim time.
- No `enum` (string-literal unions: `'on' | 'off'`); factories `create<Name>`; files camelCase.
- Bots produce `SimCommand`s like the client; `src/bots` never imports `client`, `three`, `platform` or sim internals.
- No `console.*`; I/O returns `Result`; every fallback logs a `warn`.
- Never weaken a guardrail (Biome, `tests/architecture/`, the main-commit hook, a perf budget).
- No merge without the review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **Your games (Task 5).** At least 5 salon games at the normal tier, exported to `docs/playtest/journals/geo/` (« What Geo does »). The dev stops at Task 5 until they are there.
2. **The no-ring reference is a tally, not journals.** AC 12 compares with your 2026-11-03 numbers as 3.12 fixed them (0 perfect, 34 points, 1★); it is the best evidence there is.
3. **Calme du bébé (AC 16).** The dev proposes 2-3 options with numbers; you pick one in chat or keep it as is.
4. **If the realistic bot wakes Mama at seed 1** (Traps), you choose another seed for the autoplay specs or the perfect bot for the perf spec.

### References

- [Source: _bmad-output/planning-artifacts/epics.md › Story 3.14 (L1984-2005), Epic 3 summary (L410-414), sequence (L399)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md › §1 constats (bot `human` 84 / 4★, 75 % perfects), §3 order, §4.8 Automatisation, success criteria]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md › L215 (no perfect without the ring), L629-631 (bot indicators)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md › Automatisation L283-285, L988, layer table L672-675]
- [Source: _bmad-output/implementation-artifacts/3-12-note-de-maman-sur-cinq-lignes.md › D7, Review « Calme du bébé », Open point 1]
- [Source: _bmad-output/implementation-artifacts/2-11-anneau-chrono-autour-des-menaces.md › AC 1, D1, Out of scope]
- [Source: _bmad-output/implementation-artifacts/3-13-equite-de-trajet-du-directeur.md › Completion Notes (the 200-seed numbers), Traps]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md › 1.12 « A late human press… », 3.12 « Calme du bébé… », 1.20 « No bot answers the phone »]
- [Source: src/bots/humanBot.ts, src/bots/threatTiming.ts, src/bots/bot.ts, src/bots/createBot.ts, src/content/schemas/bots.ts, src/client/ui/world/chronoRing.ts:28-45, tools/sim/{runSim,simArgs,simReport}.ts, tools/playtest/loadJournals.ts, src/content/schemas/journal.ts, src/debug/autoplay.ts]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- Task 1: the six hashes of `humanBotRegression.test.ts` were taken on the unchanged `humanBot.ts` (baseline `8b34048`) and are green with the new code (frozen settings = old bot, byte for byte).
- 200-run measurements (salon, normal tier, `--seed 1000`, ~17 s each), with the model as built:
  - starting values of D2 (ring off sd 200): ring on 3.2★ / 73.6 pts / 56 % perfects / 40 of 200 games end on `mamaWoke`; ring off 1.8★ / 52.9 pts / 18.3 % perfects (AC 12 not met: perfects).
  - ring off `sdMs` 400 (offset 0): **0.9★ / 34.8 pts / 9.3 % perfects**, 60 of 200 `mamaWoke`: AC 12 holds (and 34.8 pts is the 34 pts / 1★ of Geo's tally).
- `npm run sim -- --bot human --seed 1` (ring on) ends on `timer` (3★, 74 pts), AC 15 holds with the current values.

### Completion Notes List

- **Code review (2026-11-04), Geo's calls:** the story closes `done` with AC 9 and AC 11 waived, not met; a false alarm the bot misses is not braced for (no held breath, no gasp), as `missWhileBusyPct` now says. `isBusy`'s `firmHold.tapUntil > now` is always shadowed by `scheduler.size > 0` (the planned `Release` is still pending while it holds), so no test can pin it separately; the `find` condition is pinned.
- **Tasks 1-4 done** (`ci:fast` green: 398 files, 8397 tests): the pin, the settings / schema / contract, the model (reaction draw, read error by mode, attention while busy), `--chrono-ring` / `--compare`, `perfectPct`, `chronoRing`, `comparison`, `content/playtest.json › humanBot`.
- **Design calls worth knowing:** (a) `PlaytestThresholds` stays what `playtest:metrics` reads (the file minus `humanBot`), the new `PlaytestFile` is the whole file, so no `playtest:metrics` expectation moved (its test file only gained one `isChronoRingShown` line); (b) the busy test counts any command the bot has planned and not sent (`scheduler.size`), which includes a held breath's release; (c) the attention of a `wait` is decided at its telegraph (first pressable sight), the press still waits for the signal; (d) the busy rules are tested on fake worlds (`tests/bots/humanModel.test.ts`), because the frozen levels never overlap two threats; (e) `READ_ERROR_SD_MAX_MS` 2000 caps `readError.*.sdMs`, and `HUMAN_TIMING_MAX_MS` 10 000 caps `reactionMeanMs`, `reactionSdMs`, `reactionMinMs`, `jitterSdMs`, `aimOffsetMs` and `readError.*.offsetMs` (review), in the schema and in `setupProblem`.
- **Geo's journals will not come (his call, 2026-11-04: « on avance sans »).** AC 9 (journals committed) and AC 11 (ring on, both statuses `OK` against his games) are therefore **not met and not verifiable**; nothing was invented in their place. `--compare` is built and tested on hand-made journals, so it measures the GDD indicator as soon as any panel exists in `docs/playtest/journals/<testerId>/` (the post-catch-up playtest). The ring-on values are a judgement call, listed for Geo below.
- **Final `bots.json › human`** (`reactionMeanMs` 250, `reactionSdMs` 50, `reactionMinMs` 150, `readError.withChronoRing` {0, 90}, `readError.withoutChronoRing` {0, 400}, `aimOffsetMs` 0, `jitterSdMs` 60, `missWhileBusyPct` 10). Steps (salon, normal, 200 runs from seed 1000): before the story (the old bot = the frozen settings) 79.2 pts / 4★ / 61.2 % perfects / 99.8 % success; D2 starting values (ring sd 60, no-ring sd 200, miss 20 %): ring on 3.2★ / 73.6 pts / 56 % perfects / 40 `mamaWoke`, ring off 1.8★ / 52.9 pts / 18.3 % perfects (AC 12 missed on perfects); no-ring sd 400: ring off 0.9★ / 34.8 pts / 9.3 % perfects (AC 12 met); ring sd 90 and miss 10 %: **ring on 3.4★ / 73.6 pts / 41.2 % perfects / 95.1 % success / 25 `mamaWoke`; ring off 0.9★ / 34.9 pts / 9.4 % perfects / 44.4 % success / 61 `mamaWoke`** (AC 12 holds: `meanStars` < 2, `perfectPct` ≤ 10).
- **AC 14, `chambre_night`, 20 runs from seed 1000, human:** before 20 / 20 bedtime cycles done, 4★, 85 pts, 48.1 % perfects; after 20 / 20 done, 4★, 84.2 pts, 29.8 % perfects. No drop.
- **AC 15:** `npm run sim -- --bot human --seed 1` (ring on) ends on `timer` (3★, 74 pts, 3 gags). The perf spec of `e2e:dist` was not run (only in `npm run ci`).
- **For 3.16 (`endsByReason` of the new `human`, salon, 200 runs):** ring on 175 `timer` / 25 `mamaWoke`; ring off 139 / 61. The old bot never woke Mama.
- **Calme du bébé (AC 16), salon, 50 runs from seed 1000, `calmPoints` mean (sd over the runs):** current feel (`calmNoiseThresholdPct` 50, `phoneRinging.perSec` 7): perfect 15 (0), human ring on 15.9 (1.7), human ring off 16.1 (1.8), idle 15.6 (1.5). The row does not follow the quality of play: a game cut short by `mamaWoke` raises it (share over the time played, AC 8). Options measured by changing the value for the run only (`content/feel.json` unchanged, checked):
  - A. `mama.calmNoiseThresholdPct` 40 / 60 / 25: no real effect (perfect 15 / 15 / 14; human ring on 15.9 / 15.9 / 15.1; idle 15.6 / 16 / 14.7). The phone keeps the noise above any of these.
  - B. `noise.sources.phoneRinging.perSec` 5: perfect 19, human on 17.8 (1.4), human off 17.8 (1.0), idle 18 (0.7); Mama never wakes (0 / 50 for all). `perSec` 3: everyone 20 (the maximum), Mama never wakes, human on 3.9★ / idle 1★.
  - C. (not measured, a sim change) take the share over the level's `durationMs` instead of the time played, so waking Mama early stops raising the row. Out of scope here (no `src/sim` change).
  - None of A / B makes the row tell a good game from a bad one; B changes how often Mama wakes (11 / 50 for human on today, 0 at `perSec` 5) and the whole score by ±4 pts. **Decided by Geo in chat, 2026-11-04: keep as is** (`feel.json` unchanged; C stays unrequested).
- **Tasks 5-7 done as far as possible:** AC 9 and AC 11 are open (see above); the tuning, AC 12, 14, 15, 16, 17 are done; the Chromium specs `characters`, `juice`, `autoplay` pass (17 / 17). The ring-on values (`readError.withChronoRing`, `reactionMeanMs`, `reactionSdMs`, `missWhileBusyPct`) are a judgement, to be measured with `--compare` against the first real panel.

- Ultimate context engine analysis completed - comprehensive developer guide created (story creation, 2026-11-04). Geo chose the reference (new games with the ring, the 2026-11-03 tally without it) and « measure and propose » for Calme du bébé.

### File List

- New: `tools/sim/humanComparison.ts`; `tests/bots/{hasChronoRing,humanBotRegression,humanModel}.test.ts`; `tests/tools/sim/humanComparison.test.ts`.
- Updated: `src/bots/{bot,createBot,humanBot,threatTiming}.ts`; `src/content/{contentFiles}.ts`, `src/content/schemas/{bots,playtest,playtest.test}.ts`; `content/{bots,playtest}.json`; `content/_schemas/{bots,playtest}.schema.json`; `src/debug/autoplay.ts`; `tools/sim/{runSim,simArgs,simReport}.ts`; `tools/playtest/playtestMetrics.ts` (exports `loadThresholds`, returns the whole file); `tests/support/{botSupport,simSupport,testContent}.ts`; `tests/bots/*` and `tests/tools/sim/*` that build a `BotSetup`, a `human` setting or a `SimArgs`; `tests/content/botsSchema.test.ts`; `tests/golden/scenarios.ts` and `tests/tools/playtest/playtestMetrics.test.ts` (one `isChronoRingShown` line in a `BotSetup` literal); `CLAUDE.md`; `_bmad-output/project-context.md`; the story and `sprint-status.yaml`.
- Also: `_bmad-output/implementation-artifacts/deferred-work.md` (pointer for « Calme du bébé »).

### Change Log

- 2026-11-04: the human bot gets a drawn reaction, a read error by what is shown, and inattention while busy; `--chrono-ring` and `--compare`; `perfectPct`, `chronoRing`, `comparison` in the report; `playtest.json › humanBot`. Ring-off tuned against the 2026-11-03 tally; ring-on tuned by judgement (Geo's journals not provided). Calme du bébé measured, nothing changed in `feel.json`.
