---
baseline_commit: e5179e8c0d3f33daaf1812435ac6390afc428f55
---

# Story 3.13: Équité de trajet du directeur

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want every situation to have a right answer,
so that I never lose a threat because two of them landed at the same time in two places.

Requirements: FR75 (new in GDD v2.3), FR31 (revised: « simultaneous » means active together, with windows staggered by this rule). Architecture: ADR-011 (`game-architecture.md` L316), L277, L1060. GDD: mechanic 17 (`gdd.md` L253-260), open question 11 (margin 0.3 s). Third story of the v2.3 catch-up (`sprint-change-proposal-2026-11-03.md`, order 3.12, 2.11, 3.13, 2.12, 2.13, 3.14, 3.15, 3.16, then a playtest, then E9). 2.11 (the timer ring) is still `backlog`: this story does not depend on it, and the ring will show a stretched telegraph for free if it reads `windowOpenAt − enteredAt`, as `levelScene.ts:188` already does.

**The playtest finding.** In Geo's playtest of 2026-11-03 the baby behind the sofa (suspicious silence) and another threat came at the same time, and Papa could save only one. Measured at this story's creation on the live salon (`perfect`, seeds 1-200, normal tier): **2 739 pairs of window openings less than 900 ms apart, in every one of the 200 games, 665 of them under 300 ms; 1 815 of them are a found silence followed by another threat** (the director draws the moment the silence stops being `hidden`). Yet `perfect` already has **0 fails** on those 200 games (`npm run sim -- --bot perfect --runs 200`: `meanSuccessPct` 100, `gags` 0): it knows every window and presses at its centre, and the sim judges a press on its own stamp with the glide cosmetic (ADR-003). **So « 0 fail for `perfect` » (AC 12) is true before the change and proves nothing on its own: the proof of this story is a fairness check over the event stream (AC 10, 11), which must count those pairs before the change and 0 after.**

## Acceptance Criteria

### The spacing rule (sim, `WaveDirector`)

1. **Given** `feel.json › director.fairnessMarginMs` (300, a new section of `FeelSchema`) and `feel.movement.glideMaxMs` (600 in both levels; a level can override either through `feelOverrides`), **when** the director telegraphs a threat it drew, **then** its window opens at least `S = glideMaxMs + fairnessMarginMs` (900 ms) from the opening of every other threat whose window is frozen (state `telegraph`, `windowOpen`, `resolved` or `gag`, with a `responseWindow`): never strictly less than `S` before or after it.
2. **Given** a draw whose natural opening (`now + telegraphDelayMs`) breaks AC 1, **when** the director telegraphs it, **then** the telegraph is emitted now and the window is postponed (« son délai est allongé ») to the earliest instant that satisfies AC 1 and AC 5 against every other frozen window, rounded up to the step grid (`STEP_MS`); its feint, if any, moves by the same amount. The draws are unchanged: one `nextFloat` per pick and one per gap, exactly as before.
3. **Given** a postponed window that could no longer be judged before the level's `durationMs` (`isJudgeableBeforeEnd` with the telegraph instant moved by the postponement), **when** the director would telegraph it, **then** it does not (« elle attend »): no `ThreatTelegraphed`, the threat stays `idle`, and the gap is drawn and set as after a telegraph (`director.nextAt = now + gap`), so the number of draws per attempt does not change.
4. **Given** the rule, **when** it is tuned (`SetFeel` on `director.fairnessMarginMs` or `movement.glideMaxMs`), **then** the next draw uses the new values; a window already frozen never moves (story 1.10 D8: a window that moves while the player reads it is unfair).

### The suspicious silence

5. **Given** a silence that has been found (its threat `telegraph`, then `windowOpen`, `resolved` or `gag`, with a `responseWindow`), **when** the director telegraphs another threat, **then** that threat's window opens no sooner than the end of the silence's parry plus the glide plus the margin: `silence.windowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs + S` (D3), and not within `S` before the silence's opening either.
6. **Given** a silence under way (`hidden`, the baby sneaking, hiding, the silence announced, not yet found or timed out), **when** the director runs, **then** it draws nothing else (unchanged since story 1.21, `isSilenceUnderway`), and a silence is a candidate only when **no other wave-planned threat is active** (`telegraph`, `windowOpen`, `hidden`): an already announced threat would otherwise open its window while Papa searches. The micro-sleep (no wave plans it) does not stop a silence from being drawn: it is not protected (D5).
7. **Given** `maxSimultaneous`, **when** the director counts the active threats of the wave, **then** an active silence (`hidden`, `telegraph` or `windowOpen`) counts for **two**, any other wave-planned threat for one, the micro-sleep for none (unchanged, story 1.19); a silence is drawn only when two more fit (`activeCount + 2 ≤ maxSimultaneous`), any other threat when one more fits. In the salon (waves 1 / 2 / 3 at 1 / 2 / 3) a silence never appears in wave 1, nothing else comes while it is active in wave 2, and one more threat can come in wave 3, spaced by AC 5.
8. **Given** a level whose wave adds a `hiddenZone` threat while its `maxSimultaneous` is below 2, **when** it is loaded (`createSim`) or checked (`npm run content:check`), **then** it is refused with the same sentence in both, naming the wave, the threat and the limit (the silence counts for two: it could never be drawn there). Both current levels pass.

### Not protected

9. **Given** an occupation Papa chose or a sequel of a miss — a coffee (`drink`), the phone (`onPhone`), the toilet (`onToilet`), a missed micro-sleep (`asleep`), and later the sequels of story 3.15 and the chores of E9 — **when** the director draws and telegraphs a threat, **then** the rule does not move it: the director reads no Papa state, no Papa position and no Papa occupation to space windows (it reads only the other threats' frozen windows and the silence). A unit test pins that a threat drawn while Papa drinks, is on the phone or asleep opens exactly `telegraphDelayMs` after its telegraph when no other window is near.

### The proof (tools)

10. **Given** a run of `npm run sim`, **when** its events are recorded, **then** a fairness check counts, per run and over the runs, `fairnessViolations`: every window of a director-drawn threat (D6) that opens strictly less than `S` from the opening of a threat that was already announced when it was drawn, or inside a found silence's guard (AC 5), or that was drawn while a silence was under way (AC 6). The check lives in `tools/sim` and reads only events and the level's effective feel: it never calls the director's code.
11. **Given** the fairness check, **when** it is run on the code before this story (the measurement above), **then** it counts violations (a test proves it can fail: two threats forced with `ForceThreat` 100 ms apart, or a synthetic event stream, give at least one); **and given** the new director, **when** `perfect` and `human` play the salon, **then** it counts **0**.
12. **Given** the bot `perfect` on 200 seeds of the salon (`npm run sim -- --bot perfect --level salon_crawler --runs 200`), **when** the games are simulated, **then** no response fails (0 fail, `gags.total` 0) **and** `fairnessViolations` is 0, the silence behind the sofa included; `human` on the same 200 seeds also has `fairnessViolations` 0. The before / after tables are in the Completion Notes.
13. **Given** the sim report, **when** it is written, **then** it keeps every existing field (3.14 and `playtest:metrics` read them) and adds `fairnessViolations` per run and in the aggregate, plus `stretchedTelegraphs` and `meanStretchMs` (D7) so that Geo sees how often and how much the director waits; `waves[].peakSimultaneous` / `overLimitRuns` count a silence for two, as the director does.

### What must not move

14. **Given** `ForceThreat` (debug, `window.__PP__`, e2e), **when** it starts a threat, **then** it still ignores the gaps, `maxSimultaneous`, the lull **and this rule** (no postponement): `threats.spec.ts` forces two threats at once on purpose (overlapping verbs).
15. **Given** the threats no wave plans (the micro-sleep, the cry in the arms, the threats of a special sequence), **when** the sim spawns them, **then** this story does not move them; the director spaces its own draws from their frozen windows (AC 1), but never the other way round.
16. **Given** the goldens, **when** they are regenerated (`npm run golden:update`, said in the Completion Notes), **then** only what this story explains moved: `feelHash` in every journal and `worldHash` in every `.expected` (the new `director` section is part of the world's effective feel), `eventsHash` only in the scenarios where the director now waits; `eventTypes` does not move in any file (no event is added, removed or changed).

## Tasks / Subtasks

- [x] Task 1: The feel (AC 1, 4)
  - [x] `src/content/schemas/feel.ts`: `DirectorSchema = z.strictObject({ fairnessMarginMs: delayMs('…') }).describe('…')` (`delayMs` allows 0: the glide alone), added to `FeelSchema` right after `movement` (D1); the description says « added to `movement.glideMaxMs`: two windows of the director never open closer than their sum (FR75, ADR-011) »
  - [x] `content/feel.json`: `"director": { "fairnessMarginMs": 300 }` at the same place; `npm run content:schemas` (commit `content/_schemas/feel.schema.json`, never edit it by hand)
  - [x] The same section in `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `tests/content/feelSchema.test.ts`: a negative margin and an unknown key are refused
- [x] Task 2: The spacing in the director (AC 1-5, 9, 14, 15)
  - [x] New `src/sim/director/fairness.ts` (D2): `fairWindowOpenAt(world, ctx, threatIndex, openAt)` — pure, allocation-free, the earliest instant ≥ `openAt` on the step grid outside every guard of AC 1 and AC 5; `simultaneousWeightOf(ctx, index)` (2 for a `hiddenZone` def, 1 for another wave-planned def, 0 for one no wave plans); doc comments name FR75 / ADR-011
  - [x] `src/sim/threats/threatFsm.ts › telegraphThreat`: a last parameter `postponeMs = 0` added to `windowOpenAt` and to `feintAt` (not to the signal's draw); every other caller passes nothing (silence, fatigue, carry, sequences); its doc says who postpones and why
  - [x] `directorSystem.ts › runDirector`: after the pick, a non-silence threat gets `postponeMs = fairWindowOpenAt(...) − (now + delay)`; when the postponed window is not judgeable before the end (AC 3), no telegraph, the gap is drawn as usual; `startThreat` takes the postponement, `forceThreat` passes 0 (AC 14)
  - [x] Update the doc comment of `runDirector` (the rule, the silence weight, ForceThreat's bypass)
  - [x] Unit tests in `src/sim/director/fairness.test.ts` and `directorSystem.test.ts` (see Testing)
- [x] Task 3: The silence (AC 6, 7, 8)
  - [x] `runDirector`: `activeCount` sums `simultaneousWeightOf`; `isCandidate` refuses a silence when `activeCount + 2 > maxSimultaneous` or when any other wave-planned threat is active; a non-silence candidate when `activeCount + 1 > maxSimultaneous` (the early `return` on `activeCount >= maxSimultaneous` stays right for the non-silence case; write it so the silence's own test is explicit)
  - [x] `createSim.ts` (`simLevelOf`, beside the `hiddenZone` checks around L211): an invariant refusing a wave that adds a `hiddenZone` threat with `maxSimultaneous < 2`; the same sentence in `tools/content/contentChecks.ts` through one shared pure function (precedent: `finalRushProblems`, `sequenceDuelProblems`); a `tests/content/` test for the refusal and one for `createSim`
  - [x] Move every test level that plans a silence in a wave of `maxSimultaneous: 1` to 2 (Traps), with the reason in the test
- [x] Task 4: The fairness check and the report (AC 10, 11, 12, 13)
  - [x] New `tools/sim/fairnessCheck.ts` (D6): fed event by event by the run recorder, returns `fairnessViolations`, `stretchedTelegraphs`, `stretchSumMs`; created with `S` (the level's effective `glideMaxMs + fairnessMarginMs`) and the telegraph delay of each def (`def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs`)
  - [x] `tools/sim/simReport.ts`: the recorder feeds it (a trailing optional argument or an options object: existing calls and tests keep working); `RunSummary` and the aggregate gain `fairnessViolations`, `stretchedTelegraphs`, `meanStretchMs` (one decimal, `null` when nothing stretched); the wave tally counts a silence for two (`hiddenThreatIds` already knows which threats are silences); `--help` (`SIM_HELP` in `simArgs.ts`) gets a paragraph like the other stories'
  - [x] `runSim.ts` passes `S` and the delays from the loaded level (its feel is already the merged one)
  - [x] Tests: `tests/tools/sim/fairnessCheck.test.ts` on synthetic event streams (each clause of AC 10, the micro-sleep never flagged as B, a forced overlap flagged); whole-report pins in `tests/tools/sim/simReport.test.ts` gain the new fields; one live test (`tests/tools/sim/`, like the existing live-content ones) plays `perfect` and `human` on a few seeds of the salon and asserts 0 fail for `perfect` and `fairnessViolations === 0` for both
- [x] Task 5: Goldens, measurements, docs (AC 12, 13, 16)
  - [x] `npm run golden:update`, then `npm run format`; read the diff and name what moved (AC 16)
  - [x] `npm run sim -- --bot <id> --level salon_crawler --runs 200` for `perfect` and `human`, and `--runs 20 --seed 1000` for `random` and `idle` (3.12's baseline): before / after tables in the Completion Notes (D8)
  - [x] Run the e2e specs the director touches, on Chromium (Testing)
  - [x] `_bmad-output/project-context.md`: the director paragraph (L60) gains the spacing rule, `feel.director`, ForceThreat's bypass and the fairness check; the silence paragraph (L45) says it counts for two and is drawn only with no other wave threat active
- [x] Task 6: `npm run ci:fast` after each task; `ci:story` is the review's, not dev-story's

## Dev Notes

### Decisions

- **D1. One new feel section, one key.** `feel.director.fairnessMarginMs` (300), the architecture's name (L265, L277). The glide stays in `movement.glideMaxMs` (the grand salon of E9 overrides it to 900 through `feelOverrides`, which gives the GDD's 1.2 s). The tier does not scale either (the GDD gives a distance in time, not a window). Hot-tunable from the feel panel, which builds its folders from the schema (`src/debug/feelControls.ts`): nothing to add there.
- **D2. Postpone at the telegraph, not wait before the pick.** The director picks as today (one `nextFloat`), then telegraphs **now** with the window postponed. Reasons: the draws per attempt do not change (the « never on the tuning » rule of `runDirector`'s doc), the threat is announced at its usual moment and simply lasts longer (the baby already adapts: `approachSpeedMps` reads `windowOpenAt`, `babySystem.ts:30`; the client draws the telegraph's progress from `windowOpenAt − enteredAt`, `levelScene.ts:188`; the bots read `windowOpenAt`), and no new state is needed in `World` (no snapshot version bump). The algorithm, allocation-free (a fixed-point loop over `world.threats`, at most N passes): start from `o = now + telegraphDelay`; for every other threat with a frozen window, the guard is the open interval `(open − S, guardEnd)` with `guardEnd = open + S` (AC 1) or, for a found silence, `open + windowMs + toleranceMs + S` (AC 5); while `o` lies strictly inside a guard, set `o = guardEnd`, round up to `STEP_MS`, and start the pass again. `o` only grows, so it ends. Exactly `S` apart is allowed (« à moins de » forbids less).
- **D3. « Fin de la parade du silence »** is the latest the silence's parry can end, `windowOpenAt + windowMs + toleranceMs` of its frozen `responseWindow`, known the moment the baby is found, and the same whatever Papa does: deterministic, no dependency on the press, no need to recompute at the result. « Temps de glissade vers la menace » is `glideMaxMs`, the upper bound of every glide (`glide.ts:22`, `min(glideMaxMs, pathLength / walkSpeedMps)`): no path search in the director. **This departs on purpose from the letter of ADR-011**, whose consequences say the director reads « la position de papa et ses occupations »: the bound is never less fair than the real glide (it can only wait a little longer), it needs no A* per draw (the director is allocation-free), and the one occupation the rule protects, the silence search, is read from the silence itself (`isSilenceUnderway`, the silence threat's state), not from Papa. Say so in `fairness.ts`'s doc and in the Completion Notes; the architecture text needs no change (it says what the director may read, and E9's larger room is covered by its `glideMaxMs` of 900).
- **D4. What counts as « another window ».** Every threat whose window is frozen: `responseWindow !== null` and state `telegraph`, `windowOpen`, `resolved` or `gag`. `resolved` and `gag` keep their `windowOpenAt` until `rearmThreat` (they are not reset by `resolveThreat` / `gagThreat`): a window that has just been answered still counts, because Papa is gliding to it. A silence that timed out never had a window (`hideThreat` sets `responseWindow` to null) and counts nothing. Whoever spawned the other threat (director, silence, fatigue, carry, sequence) does not matter: the director spaces its draw from all of them (AC 15).
- **D5. The micro-sleep.** It is a window like any other, so the director spaces its own draws from it (D4); but the fatigue system spawns it whenever the gauge says, so a micro-sleep can still land close to a director window, and that is not a violation (it is Papa's need, answered by the coffee: the GDD's « occupations choisies » are not protected). It keeps not counting against `maxSimultaneous` (story 1.19, deferred L326) and it does not stop a silence from being drawn. Open point 1 for Geo.
- **D6. The fairness check is a black box.** `tools/sim/fairnessCheck.ts` rebuilds each threat cycle from the events (`ThreatHidden`, `ThreatTelegraphed`, `WindowOpened`, `ResponseResolved`, `SilenceEnded`, `ThreatRearmed`, `ThreatCancelled`), keyed by threat id and cycle. A cycle **B** is director-drawn when its `ThreatTelegraphed` has `waveIndex ≥ 0` and no `ThreatHidden` came before it in the cycle (a found silence is telegraphed by `runSilence`, not drawn). A violation is counted once per B, at the end of the run, when any of these holds, with A any other cycle (whatever spawned it) announced before B's telegraph (same `t`: earlier in the event order) and with a `WindowOpened`:
  1. `|B.openT − A.openT| < S`;
  2. A is a found silence and `A.openT − S < B.openT < A.openT + A.windowMs + A.toleranceMs + S` (from A's `ResponseResolved.responseWindow`; a found silence always resolves or the level ends first — a level end before A resolves leaves B unchecked against A's tail, say so in its doc);
  3. B's `ThreatTelegraphed` falls between a silence's `ThreatHidden` and its `SilenceEnded` (drawn while a silence was under way).
  `ForceThreat` telegraphs carry `world.director.waveIndex`, so a forced overlap is flagged: that is how a test proves the check can fail (AC 11). The check reads the run's effective `S` once at creation; a run that `SetFeel`s the margin is out of its scope (no bot does).
- **D7. Stretch stats.** For each director-drawn B, `stretchMs = B.openT − B.telegraphT − delayOf(B.def)`; `stretchedTelegraphs` counts B with `stretchMs > 0`, `meanStretchMs` is their mean. A `wait` def (its signal is a random delay on top) is left out: no wave plans one today. Geo reads these to tune the margin: a high mean means the director holds threats back a lot.
- **D8. Baseline before the change** (this story's creation, live salon, normal tier, `npm run sim -- --bot perfect --runs 200`): `meanScore` 79.9, `meanStars` 4, `meanSuccessPct` 100, `gags.total` 0, silences 1 908, all found; the throwaway measurement script (not in the repo) counted 2 739 pairs of `WindowOpened` of two different threats less than 900 ms apart (665 under 300 ms), at least one in each of the 200 games; by pair (earlier > later): silence > outlet 629, silence > coffee table 627, silence > stairs 529, coffee table > stairs 272, coffee table > outlet 205, outlet > stairs 151, micro-sleep pairs about 250 in all. It counted pairs by opening order and the micro-sleep both ways, so it is a ceiling for D6's check, not its exact number: run the real check on the old code (stash nothing; a temporary branch of `runDirector` returning before the postponement, or a test with the rule off) and put both numbers in the Completion Notes. Re-measure `human` too. `perfect` should keep 0 fail and about 80 points; expect fewer telegraphs in wave 2 (nothing comes while a silence is active), which caps nothing since Rire is already at its 35 maximum for `perfect`.
- **D9. No new event, no new world field.** The postponement is visible in `windowOpenAt` (world) and in the gap between `ThreatTelegraphed` and `WindowOpened` (events). Adding a `postponedMs` to `ThreatTelegraphed` would move `eventsHash` in every golden with a threat and the `__PP__` contract for nothing the client needs today; if the debug timeline (`src/debug/timingTimeline.ts`) wants it later, it can compute it the same way. `SimSnapshot.version` does not change.

### The current code this story changes

- **`src/sim/director/directorSystem.ts`** (157 lines). `runDirector` enters the waves (`WaveStarted`, first gap), returns during a special sequence, runs `ForceThreat` commands (`forceThreat` → `startThreat`, no draw), then: returns if the wave is closed (`closesAtMs`), the gap is not over (`director.nextAt`) or the baby is in `act`; counts `activeCount` (wave-planned active threats, `firstWaveIndex ≥ 0`) and `candidateCount` (`isCandidate`); returns if `activeCount >= maxSimultaneous`; picks with one `nextFloat`, `startThreat`, draws the gap with one `nextFloat`. `isCandidate`: idle, in the pool, the baby not carried; a non-silence only while no silence is under way; a silence only while the baby is free and Papa is outside its zone. `startThreat`: `hideThreat` for a silence, `telegraphThreat` otherwise.
- **`src/sim/threats/threatFsm.ts › telegraphThreat`** (L88). Freezes the window (`effectiveWindow` with tier, fatigue, instinct), draws a `wait` signal and a feint (one `nextFloat` each, only for those defs), sets `windowOpenAt = now + telegraphDelay + signal`, `feintAt`, `waveIndex`, enters `telegraph`, emits `ThreatTelegraphed` (no `windowOpenAt` in it). Callers: the director, `runSilence` (found), `fatigueSystem` (micro-sleep), `carry.ts` (cry in the arms), `sequenceSteps.ts`, `bedtimeDuel.ts`, `stealthExit.ts` (all with `waveIndex` -1 but the silence).
- **`src/sim/director/waveState.ts`.** `isThreatActive` (`hidden | telegraph | windowOpen`) is used by the baby (`babySystem.ts` `releaseTarget`, `lockOnThreat`) and by `isLastOfWave`: do not change its meaning; the weight of a silence is the director's business only.
- **`src/sim/baby/silence.ts › runSilence`.** On the find: `SilenceEnded{found}`, `clearSilence` (so `isSilenceUnderway` turns false), the baby `targetLocked`, then `telegraphThreat(..., threat.waveIndex)` with the def's `telegraphDelayMs` (800). In the step order (`step.ts`) the director runs before the baby, so it sees the found silence from the next step on. Not changed by this story.
- **`src/sim/threats/judgeable.ts › isJudgeableBeforeEnd`** (pure): `now + delay + maxDelayMs + window (tier, instinct) + tolerance ≤ endMs`. Reused for AC 3 with `now + postponeMs`.
- **`src/sim/createSim.ts`** around L205-240: the per-entry checks of planned threats (`hiddenZone` must name a hidden zone, no `papa` target in a wave…), « the wording of these is the one `content:check` and the schema use »; `waves` → `SimWave { fromMs, endMs, closesAtMs, maxSimultaneous, gapMinMs, gapMaxMs }` at L519.
- **`tools/sim/simReport.ts › createRunRecorder`** (L240): positional arguments `(sim, seed, waves, armsCryDef, sequenceDefs)`; the wave tally (L297-345) counts a hidden silence once, from `ThreatHidden`, and does not count its later `ThreatTelegraphed` again (`hiddenThreatIds`); `systemThreatIds` keeps the micro-sleep out of the count.
- **`content/levels/salon_crawler.json`.** Waves at 0 / 60 000 / 120 000 ms, `maxSimultaneous` 1 / 2 / 3, gaps 4-7 s / 1-3 s / 0.5-2 s, lull 3 s; the silence (`silence_mischief`, `behind_sofa`) is added by wave 2. Telegraph delays: outlet 1 200, stairs 1 000, coffee table 1 500, silence 800, micro-sleep 1 200; `windowMs` 300, `toleranceMs` 60. `chambre_night.json` has no silence (waves 1 / 2 at 1 / 2).

### What must keep working

- The draws: one `nextFloat` per pick and one per gap, a silence's surprise gag one more; `directorSystem.test.ts › the PRNG` stays green as written.
- Every rule of story 1.18 (waves cumulative, the lull, `WaveStarted` once per wave, gaps counted from the last telegraph), 1.19 (micro-sleep outside the waves), 1.21 (silence candidacy: baby free, Papa outside the zone; nothing else drawn while it is under way), 4.1 (nothing drawn while carried), 4.4 (nothing drawn during a sequence; `resumeGapMs`).
- `isWaveClosed` / `isLastOfWave` and the `lastThreat` slow-mo: they read `director.nextAt` and the active threats, which keep their meaning.
- The baby: locked on a stretched telegraph, it stares `lockMs` then crawls at the speed that brings it on time for the later opening (`approachSpeedMps`): no change needed, check it in a test or a run.
- `ForceThreat` and every e2e spec that forces threats (`threats.spec.ts`, `silence.spec.ts`, `testApi.spec.ts`).
- `npm run sim:replay` of journals recorded after this story; old journals are refused on the feel hash, as after every feel change (3.12 D9).
- `playtest:metrics` (reads `responses`, not the new fields).

### Traps

- **« 0 fail for `perfect` » is already true** (see the measurement): do not stop at AC 12's first half. The story is done when D6's check counts violations on the old code and 0 on the new one.
- **The baby shares `world.rng`.** A later window changes when the baby acts and babbles, so its wander draws move, and every later pick of the director moves with them. A test that pins a trace (`directorSystem.test.ts:430` « keeps the draws of a level with no silence exactly as before ») may move even in a level where nothing is postponed if a micro-sleep is near; when one moves, find the postponement that moved it, re-pin with that reason in the test, never loosen it.
- **Test levels with a silence in a wave of one.** `directorSystem.test.ts`, `silence.test.ts`, `threatFsm.test.ts`, `gags.test.ts`, `createSim.test.ts`, `carryFuzz.test.ts`, `bedtimeCycle.test.ts` build levels with `silence_mischief` (grep `hiddenZone\|silence_mischief`): AC 8 refuses `maxSimultaneous: 1` for them, and `testWave`'s default **is** 1 (`tests/support/testContent.ts:487`), so every `testWave([SILENCE, …])` without an override (`directorSystem.test.ts`'s `silenceLevel()` among them) fails at `createSim`. Move each to 2 (or to a second wave) and keep what the test proves; `directorSystem.test.ts:420` « counts a hidden silence against maxSimultaneous » becomes « counts a silence for two ».
- **The step grid.** `WindowOpened` is emitted at the first step at or after `windowOpenAt`. Every opening on the grid today is a multiple of `STEP_MS` (delays 800 / 1 000 / 1 200 / 1 500, `S` 900); a margin of 305 from the feel panel would not be. Round the postponed opening up to the grid (D2) so that the check of D6 can compare `WindowOpened.t` exactly.
- **The end of the level.** The last wave closes `lullMs` (3 s) before the end; a postponed window can pass it (two others ahead of it: up to about `2 × S` more). AC 3 refuses such a telegraph; without it, a telegraph would hang over the photo, never judged.
- **`wait` and `release` defs.** The postponement adds to `windowOpenAt` and `feintAt`, not to the signal's draw. No wave plans a `wait` (`bedtime_eyes`), `nothing` (`false_alarm_sigh`, `real_wake`) or `release` (`bomb_drop_lay`) def: they are sequence-only, and sequences stop the director. Do not build for them; the doc of `telegraphThreat`'s new parameter says the director's guarantee is for defs without a signal, and D6's check would flag one if a level ever planned it.
- **`activeCount` and the silence.** Today a hidden silence counts once; a found silence counts once too (its telegraph is wave-planned). Both become two. The wave tally of the report must follow (AC 13), or its `overLimitRuns` would disagree with the director.
- **Goldens.** The new feel section moves `feelHash` in all 27 journals and `worldHash` in all 27 `.expected`; `eventsHash` only where the director now postpones or waits (likely `threat_trio`, `core_basic` and any scenario that reaches wave 2 with a silence, plus any with a micro-sleep near a draw). `eventTypes` must not move. Run `npm run format` after `golden:update` (3.12: the writer's arrays are reformatted by Biome, otherwise `eventTypes` looks moved when it is not). Read the diff and list what moved.
- **Every new feel key** goes to `testFeel.json` and `feelSample.json`, or `content:check` and the Vite fixture tests fail far from the change (4.10, 3.6, 3.12).
- **`VITE_DEBUG_ALLOWED`.** Not exported in this shell at the story's creation (`env | grep VITE_` printed nothing); check again, and run e2e as `(unset VITE_DEBUG_ALLOWED; npm run e2e -- …)` if it is set.
- **Heavy checks queue** (`tools/ci/heavyLock.sh`): run `npm run e2e -- …` in the background, never `npx playwright test`.
- **The worktree guard** refuses compound shell commands that name `git`, loops with a computed program, and variables in an option position: plain commands, the edit tools, or one script file in the scratchpad. A throwaway `tsx` script needs the `.mts` extension (top-level `await`) and `npx tsx --tsconfig ./tsconfig.json <script>` run from the worktree for the aliases.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`.

### Out of scope

- The timer ring (2.11), the activity bubble and the visible refused tap (2.12), the coffee and phone poses (2.13).
- A realistic `human` bot (reaction time, attention, missing a threat while busy elsewhere): 3.14. This story only checks that `human` meets no unfair pair.
- The sequels of a miss (3.15) and the catastrophe gauge (3.16); the chores (E9). AC 9 says they will not be protected; nothing to build for them now.
- Spacing the micro-sleep, the cry in the arms or a sequence's threats from the director's windows (D5, AC 15).
- A path-length glide time in the director (D3 uses `glideMaxMs`), and moving a window once frozen.
- The grand salon's values (`glideMaxMs` 900 by `feelOverrides`): E9 (9.8).

### Architecture compliance

- ADR-011: the rule lives in the director, at scheduling time; the judgement is untouched (ADR-003): no change to `judgePress`, `classifyPress`, `runThreats`. The glide is bounded by `glideMaxMs` instead of read from Papa's position (D3, a deliberate and conservative reading of ADR-011).
- `src/sim` stays pure: no `Math.random`, no real time, no log, no `three`; the director reads `ctx.feel`, `ctx.level` and `world.threats` only; inside `src/sim` imports are relative (`../director/fairness.ts`).
- Allocation-free per step in the director (counting loops, as its doc says); the fairness check in `tools/` may allocate (Node, per run).
- Tunables in `feel.json`, bounds only in the schema, no `.default()` / `.optional()` in `feel.ts`.
- `World` unchanged (D9); `SimSnapshot.version` stays.

### Library and framework notes

Stack pinned, nothing added: TypeScript 7 (`tsc --noEmit`), Zod 4 (`z.strictObject`, `delayMs` helper of `feel.ts`), Vitest, Playwright, `tsx` for `tools/`. No web research was needed: the story uses no library API that the codebase does not already use.

### File structure

- **New:** `src/sim/director/fairness.ts` and `fairness.test.ts`; `tools/sim/fairnessCheck.ts`; `tests/tools/sim/fairnessCheck.test.ts`; the live test of Task 4 (in `tests/tools/sim/`).
- **Updated:** `src/sim/director/directorSystem.ts` and its test; `src/sim/threats/threatFsm.ts` (and `threatFsm.test.ts` for the new parameter); `src/sim/createSim.ts` and its test; `src/content/schemas/feel.ts`; `content/feel.json`; `content/_schemas/feel.schema.json` (generated); `tools/content/contentChecks.ts` and a `tests/content/` test; `tools/sim/{simReport,runSim,simArgs}.ts`; `tests/tools/sim/simReport.test.ts`; `tests/support/testFeel.json`; `tests/tools/vite/fixtures/feelSample.json`; `tests/content/feelSchema.test.ts`; the sim tests that plan a silence in a wave of one (Traps); `tests/golden/*` (regenerated); `_bmad-output/project-context.md`.
- Where the shared « silence in a wave of one » function lives: next to the code that owns the rule (`src/sim/director/`, pure, no zod, no `@content` runtime import), like `finalRushProblems` in `src/sim/flow/finalRush.ts`.

### Testing

- **Pure (`fairness.test.ts`).** Build a world with threats in given states and windows (through the real FSM helpers or a world from `createSim` with `ForceThreat`, never by hand-writing invalid states): no other window → `openAt` unchanged; one window 300 ms ahead → postponed to `open + S`; a window `S` exactly apart → unchanged; two windows that chain → the fixed point lands after both; a found silence → `open + windowMs + toleranceMs + S`; a window before the candidate within `S` → postponed after it (never before); a margin that is not a multiple of `STEP_MS` → the result is on the grid; a resolved and a gag threat still count, a rearmed one does not, a timed-out silence does not.
- **Director (`directorSystem.test.ts`, real `createSim`, typed commands, time in `STEP_MS`, values read from the feel).** A postponed telegraph: `ThreatTelegraphed` at the drawn instant, `WindowOpened` at the fair instant, the gap and the draws unchanged; AC 3 near the end of a short test level: no telegraph, the threat idle, `nextAt` moved by a drawn gap; AC 4 a `SetFeel` of the margin applies to the next draw and leaves a frozen window where it is; AC 6 no silence drawn while another wave threat is announced, drawn once it is over; AC 7 the silence counts for two (wave of 2: nothing else while it is hidden or telegraphed; wave of 3: one more, spaced by AC 5); AC 9 a draw while Papa drinks, is on the phone or asleep opens at exactly `telegraphDelayMs`; AC 14 two `ForceThreat` 100 ms apart are not postponed.
- **Tools.** `fairnessCheck.test.ts` on synthetic event streams for each clause of D6 and for « the micro-sleep is never B »; a live run proving the check fires (two `ForceThreat`s 100 ms apart in a scripted sim, or the old behaviour): AC 11 must be able to fail. The live test of Task 4 on a few seeds; the 200-seed numbers by the CLI, in the Completion Notes.
- **E2E (Chromium only, by the touched specs):** `threats.spec.ts`, `silence.spec.ts`, `testApi.spec.ts`, `fatigue.spec.ts`, `autoplay.spec.ts` (its macOS screenshot is taken in play: if it moves, look at it, regenerate it deliberately and say so), and `level.spec.ts` / `timer.spec.ts` if they read the waves. `npm run e2e -- <files> --project=chromium`, in the background.
- **Checks:** `npm run ci:fast` per task; `ci:story` belongs to the review.

### Previous story intelligence

- **3.12 (the five-row note):** tests that could not fail were the main review finding in 3.6 and stayed a theme: here, AC 11 exists because the obvious test (0 fail for `perfect`) cannot fail. Assert exact instants (`windowOpenAt`, `WindowOpened.t`), not « later than ». Stale comments after a change were the second finding: `runDirector`'s doc, `isCandidate`'s, `telegraphThreat`'s, the report's `--help`.
- **3.12 Traps kept:** every new feel key in `testFeel.json` and `feelSample.json`; `golden:update` then `format`; whole-report tests need the new fields; the report keeps every field for 3.14; the Mac sleeps; the worktree guard.
- **3.12 Calme du bébé:** the phone holds the noise above 50 % for about a quarter of the salon; this story does not touch it, but a run that delays threats changes nothing there (the phone rings at 125 s whatever the director does).
- **1.21 / 1.18:** the silence's candidacy rules and the « draws never depend on the tuning » rule come from there; read their tests before changing `isCandidate`.

### Git intelligence

Recent commits on `main`: `fc3e982` (merge of 3.12), `e755622` / `b2c99ce` (the heavy-check lock, `tools/ci/heavyLock.sh`), `21ff4f1` / `a771c14` (3.12 and its review). 3.12 touched the score, the report (`meanRows`) and the goldens' `feelHash` / `worldHash`; nothing in the director. The director was last changed by 4.1 (carried baby), 4.4 (sequences) and 1.21 (silence).

### Project Structure Notes

Follows the layers and aliases. `sim/director/fairness.ts` is where the architecture puts the rule (L597, L987: `src/sim/director/waveDirector.ts` in the architecture is `directorSystem.ts` in the code; no rename). The check is a tool (`tools/sim`), never imported by `src/`. No variance.

### Project Context Rules

- Anything Geo might tune is data: `feel.director.fairnessMarginMs`, the glide in `feel.movement`; no number in code but `2` (the silence's weight, a rule of the GDD: name it as a constant in `shared/constants.ts`, e.g. `SILENCE_SIMULTANEOUS_WEIGHT`).
- Units are suffixes (`fairnessMarginMs`, `postponeMs`, `stretchMs`, `meanStretchMs`); `…At` is sim time; events past tense, commands imperative; no `enum`, string-literal unions.
- The sim never logs and reads no real time or randomness but `world.rng`; it emits events, it does not read `ctx.events` in a system.
- Cross-layer imports through the aliases; `@sim` is `src/sim/index.ts` only (export what the tools need from there, nothing deeper).
- No `console.*` (use `log` in tools); I/O returns `Result`; every fallback logs a `warn`.
- Regenerating goldens is deliberate and said in the story; never weaken a guardrail (Biome, `tests/architecture/`, the main-commit hook).
- No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **The micro-sleep is not protected** (D5): the director spaces its own threats from a micro-sleep's window, but a micro-sleep can still land next to a threat (fatigue does not ask the director). The GDD calls the coffee an occupation Papa chooses; the micro-sleep is its price. Say if you want the fatigue system to wait for a free slot too (a small story of its own).
2. **The director postpones the window, it does not wait to announce** (D2): a threat may stay announced up to about 2 s longer than its usual telegraph in wave 3. With the timer ring of 2.11 the longer wait is visible; without it, judge at the playtest whether a long telegraph reads well, or whether you prefer the threat to be announced later instead (the other reading of « ou elle attend »; it costs a « pending pick » in the world).
3. **The silence's guard uses the worst case** (D3): the next window waits for the end of the silence's window plus the full glide, even when you lifted the baby at once. In the salon that is 0.8 s + 0.36 s + 0.9 s ≈ 2 s after the find before anything else can open.
4. **The margin is 300 ms** (GDD open question 11, `[ASSUMPTION]`): tune it in the feel panel; the report's `stretchedTelegraphs` / `meanStretchMs` show how much the director holds threats back.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.13] (L1957-1982), FR31 (L67), FR75 (L142), E3 summary (L413-414)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md] §4 (FR31, FR75, story 3.13 at L277), §5 (ADR-011 at L587), success criteria (L618)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] mechanic 17 (L253-260), traceability (L279), open question 11 (L680)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md] L53, L60 (c)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L195, L265, L273-277, ADR-003 (L308), ADR-011 (L316), L597, L753 (busy Papa vs occupation), L795 (`glideMaxMs` 600 / 900), L987, L1060
- [Source: _bmad-output/project-context.md] the silence (L45), the wave director (L60)
- [Source: _bmad-output/implementation-artifacts/3-12-note-de-maman-sur-cinq-lignes.md] (Traps, Review Findings, Completion Notes: goldens, report fields)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L165 (one baby, several threats), L326 (micro-sleep outside `maxSimultaneous`), L337 (live-content tests pin tuning values)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Code, 2026-11-03.

### Debug Log References

- The first full run after the director change failed 290 tests in 22 files: nearly all of them were levels that plan a silence in a wave of one (`testWave`'s default), refused by the new AC 8 invariant.
- `simPurity` refused a local named `window` in `director/fairness.ts` (the sim may not name that global): renamed `frozen`.
- `mamaScore.test.ts` (seed 3, `perfect`): `screamPoints` went from 0 to 2 because the baby now ends the level near the stairs (`NearMissFrozen`, story 3.6). Nothing failed: the trajectory moved with the postponed windows (the baby shares `world.rng`). The test now reads the frozen near misses instead of assuming none.

### Implementation Plan

1. `feel.director.fairnessMarginMs` (300), in `FeelSchema`, `feel.json`, `testFeel.json`, `feelSample.json`, the JSON Schema regenerated.
2. `src/sim/director/fairness.ts`: `fairWindowOpenAt` (fixed-point loop over `world.threats`, allocation-free), `simultaneousWeightOf`, `silenceLimitProblem`, `fairnessSpacingMs`. `telegraphThreat` takes a trailing `postponeMs = 0` that moves `windowOpenAt` and `feintAt` and nothing else. `runDirector`: weights, silence candidacy (two places, no other wave threat active), `postponementOf` (null when the postponed window could no longer be judged: no telegraph, the gap is still drawn). `ForceThreat` passes 0.
3. `createSim` and `content:check` refuse a silence in a wave with `maxSimultaneous < 2` with the same sentence (`silenceLimitProblem`, exported from `@sim`).
4. `tools/sim/fairnessCheck.ts`: a black box over the events (D6), fed by `createRunRecorder` through a trailing `FairnessSetup` argument that `runSim` builds from the loaded level (`fairnessSetupOf`); the report gains `fairnessViolations` (per run and total), `stretchedTelegraphs`, `meanStretchMs`; the wave tally weighs a silence for two.
5. Test levels that plan a silence: `testWave` now defaults to `maxSimultaneous: 2` when its threats include the silence (one place, the reason in its doc); the two levels that build their waves by hand (`threatCatalog`, `bedtimeCycle`, the content-check `wave()`) got 2 with the reason beside them.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (story creation, 2026-11-03).
- **Implemented as specified**, decisions D1-D9 kept. One departure from ADR-011's letter, as D3 says: the glide is bounded by `glideMaxMs` instead of read from Papa's position, so the director reads no Papa state (AC 9) and needs no path search; it can only wait a little longer than the real glide. The architecture text needs no change.
- **The proof is the check, not the 0 fail** (the story's trap). On the same 200 seeds of the salon (`--runs 200`, seed 1, normal tier), the check run on the old director and on the new one:

  | bot | director | meanScore | meanSuccessPct | gags | fairnessViolations | stretchedTelegraphs | meanStretchMs |
  |---|---|---|---|---|---|---|---|
  | `perfect` | before | 79.9 | 100 | 0 | **2 521** | 0 | - |
  | `perfect` | after | 79.8 | 100 | 0 | **0** | 2 506 | 518.7 |
  | `human` | before | 79.9 | 99.9 | 6 | **2 440** | 0 | - |
  | `human` | after | 79.8 | 99.9 | 7 | **0** | 2 361 | 556.1 |

  `--runs 20 --seed 1000` (3.12's baseline):

  | bot | director | meanScore | meanSuccessPct | gags | fairnessViolations | stretchedTelegraphs | meanStretchMs | silences found / timed out | Mama woke |
  |---|---|---|---|---|---|---|---|---|---|
  | `random` | before | 16.4 | 1.1 | 720 | 41 | 0 | - | 15 / 94 | 4 |
  | `random` | after | 16.4 | 0.8 | 721 | 0 | 49 | 440.4 | 20 / 92 | 4 |
  | `idle` | before | 16.0 | 0 | 711 | 43 | 0 | - | 0 / 113 | 4 |
  | `idle` | after | 16.4 | 0 | 694 | 0 | 45 | 378.4 | 0 / 111 | 5 |

  The "before" numbers come from `git checkout`-ing the director of the commit before this story for the run only (the new check, the new report and `createSim` stay), then putting the new one back. They are a floor for the old behaviour: the old director also let a silence and another threat coexist, which the report now counts for two (`waves[].overLimitRuns` 200 / 170 for `perfect` before, 0 / 0 after; the per-wave peak is 3 / 4 before, 2 / 3 after). `perfect` keeps its score (79.8 against 79.9) and 0 fail; `human` has one more gag (7 against 6) in 200 games, within what a different baby trajectory gives: the baby shares `world.rng`, so every later draw moved. The director waits on about a quarter of its draws (2 506 of 9 746 `perfect` telegraphs, 519 ms on average), a telegraph at most about 2 s longer.
- **Goldens regenerated deliberately** (`npm run golden:update`, then `npm run format`): what moved is `feelHash` and `worldHash` in all 27 journals and their `.expected` (the new `director` section is part of the effective feel). `eventsHash` and `eventTypes` did not move in any file: no golden scenario draws two windows close enough to be postponed, and no event was added, removed or changed (AC 16).
- **Tests that had to move, and why.** `testWave` defaults to 2 places for a silence (AC 8); `directorSystem.test.ts` "counts a silence for two" replaces "counts a hidden silence against maxSimultaneous" (the baseline trace test, seed 7, kept its byte-for-byte hash: no postponement there); `threatSystem.test.ts` "two threats active at once" taps each threat in its own window (the second one now opens later); `mamaScore.test.ts` reads the frozen near misses (above); `simReport.test.ts` pins the new fields and the silence's weight of two. Nothing was loosened.
- **E2E (Chromium, the touched specs):** `threats`, `silence`, `testApi`, `fatigue`, `autoplay`, `level` and `timer` specs: 56 passed (the autoplay screenshot did not move). `ci:story` is the review's.
- **Open points for Geo** (unchanged from the story): the micro-sleep is not protected (D5); a threat can stay announced up to about 2 s longer in wave 3 (no timer ring yet, 2.11); the guard after a found silence uses the worst case (≈ 2 s after the find); tune `director.fairnessMarginMs` in the feel panel and read `stretchedTelegraphs` / `meanStretchMs`.

### File List

**New:** `src/sim/director/fairness.ts`, `src/sim/director/fairness.test.ts`, `tools/sim/fairnessCheck.ts`, `tests/tools/sim/fairnessCheck.test.ts`.

**Updated:** `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json` (generated), `src/shared/constants.ts`, `src/sim/director/directorSystem.ts`, `src/sim/director/directorSystem.test.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/threats/threatFsm.test.ts`, `src/sim/threats/threatSystem.test.ts`, `src/sim/createSim.ts`, `src/sim/createSim.test.ts`, `src/sim/index.ts`, `src/sim/sequences/bedtimeCycle.test.ts`, `tools/content/contentChecks.ts`, `tools/sim/simReport.ts`, `tools/sim/runSim.ts`, `tools/sim/simArgs.ts`, `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tests/content/feelSchema.test.ts`, `tests/content/checkContent.test.ts`, `tests/threats/threatCatalog.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/tools/sim/mamaScore.test.ts`, `tests/golden/journals/*.json` (27 journals and 27 `.expected`, `feelHash` / `worldHash` only), `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file.

### Change Log

- 2026-11-03: Story 3.13 implemented (director fairness rule, silence weight, fairness check and report fields, goldens regenerated). `npm run ci:fast` green (389 files, 8 107 tests).
