# Story 1.18: Threat Waves and the Level Timer

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.18 « Vagues de menaces et chrono du niveau » (L1001-1031). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want the threats to stack up in waves for 3 minutes,
so that the game goes from calm to chaos.

**Requirements covered:**
- FR8: the ×0.2 / 1500 ms slow-mo on the last threat of a wave. Story 1.14 made it possible; this story triggers it.
- FR31: waves. Wave 1 runs one threat at a time, wave 2 two at once, wave 3 three at once plus a disruption.
- NFR10: a 3 to 5 min level.
- UX-DR4: the fixed HUD zones, with the timer at the top centre. The HUD stays visible during slow-mo.
- The prototype part of FR32: the Sieste variant ends normally on the timer. The early end on noise arrives with story 3.x and its `MamaWoke`.

**Sources:**
- GDD:
  - L91 « Les menaces s'empilent par vagues (escalade) ».
  - L107 and L112: Sieste, « Le prototype dure 3 minutes ».
  - L159: « Ralenti sur la dernière menace d'une vague ×0,2 pendant 1,5 s ».
  - L372: « Vague 1 : une menace à la fois ; vague 2 : deux simultanées ; vague 3 : trois simultanées et une perturbation. [ASSUMPTION: rythme à régler au playtest.] ».
- Architecture:
  - L229-231: `World` holds `director` and `flow`; the system order ends in `… → flux`; the flow is an explicit FSM.
  - L273: « Le `WaveDirector` lit les vagues du niveau (menaces activables, simultanéité maximale, perturbations, délais) et choisit la prochaine cible du bébé avec le PRNG ».
  - L262: `feelOverrides`.
  - L996-1022: `Level.waves[].threats[]` references `ThreatDef.id` and `Anchor.id`, with a level example.
  - L400: `LevelEnded`.
- UX:
  - `DESIGN.md` L172-180 (`hud-timer` frontmatter), L444 (`numeric`), L462 (zones) and L474 (paper pills with an ink outline).
  - `DESIGN.md` L526: « one icon per variant (sleeping Mama for Sieste, a door for Retour) ».
  - `EXPERIENCE.md` L208 (`hud-timer`), L293 (« Slow-mo (perfect, wave end): The HUD stays ») and L481-482 (≤ 40 HUD nodes).
  - Mockup `mockups/key-hud-level.html`: L63-65 (`.timer`: 40 px tall, `gap: var(--s2)`, padding `0 var(--s4) 0 var(--s2)`, 28 px icon), L160 (`#i-mama-sleep`) and L183 (`aria-label="Sieste, 2:47"`, digits `2:47`).

**Downstream consumers. Design for them; none of them may need to change this story's code beyond adding their own case:**
- **1.19 (fatigue):** `fatigue.ts` spawns `papa_microsleep` instances outside the director. That threat belongs to no wave: its `waveIndex` is `-1` (D6). It never counts as a wave's last threat, and the director does not count it against `maxSimultaneous` (D5; 1.19 adds that rule).
- **1.20 (phone):** adds `disruptions: [{ def, atMs }]` to the wave schema and `content/disruptions/phone.json` (D10). The director's wave state (`world.director`, `ctx.level.waves`) is what it reads.
- **1.21 (silence):** adds `silence_mischief` to a wave's `threats` (architecture example: wave 2). Its threat def must not need a change to the director.
- **1.22 (Mama's score, result screen):** reacts to `LevelEnded` and moves the app to `result` (`appFsm` already allows `level → result`). This story only stops the gameplay and leaves the frozen level on screen (D9).
- **3.x (noise, Sieste):** a second end reason. `LevelEnded.reason` is a union that starts with `'timer'`, and `runFlow` is where `MamaWoke` will end the level.
- **E3 v1 (Retour, the door, the final rush):** adds `'return'` to `LEVEL_VARIANTS` and its icon (a door), and adds flow states between `playing` and `ended`.
- **E4 (sequence bar):** the timer's compact form (32 px, `numeric-compact`) is not built here.

## Precondition (check first, stop if it fails)

1. Story 1.17 is `done`, with its review fixes committed.
   - When this story was written, 1.17 was `in-progress` in this same working tree. Its uncommitted edits touched `level.ts` (`objects`), `contentChecks.ts`, `testContent.ts` (`createTestLevel(entries, objects)`, `TEST_OBJECTS`) and `createSim.ts`. This story builds on them.
   - If `sprint-status.yaml` says anything else for 1.17, or `git status` shows anything outside `_bmad-output/`, stop and tell Geo.
2. Re-read the files 1.17 changed before you edit them: `level.ts`, `createSim.ts`, `commands.ts`, `events.ts`, `papaSystem.ts`, `boot.ts`, `inputMapper.ts`, `testContent.ts` and `contentChecks.ts`. The excerpts in the Dev Notes predate 1.17.
3. Run `env | grep VITE_`. The agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap).
4. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note the unit and e2e counts in the Debug Log. If the baseline is red, stop and say so.

## Acceptance Criteria

1. **The level, as data.** `content/levels/salon_crawler.json` validates against the new `LevelSchema`. It holds:
   - `"variant": "nap"` and `"durationMs": 180000`;
   - the three waves of D2, which together plan `outlet` at `outlet_01`, `stairs` at `stairs_top` and `coffee_table_object` at `coffee_table`;
   - the `objects` of 1.17, unchanged;
   - `"feelOverrides": {}`.

   No level-level `threats` key is left. No duration is hard-coded anywhere in `src/` or `tools/`: grep for `180000`, `180_000` and `SIM_CLI_DEFAULT_UNTIL_MS`. The CLI constant is removed or replaced (AC 9).
2. **Schema rules.** `LevelSchema` rejects each of these with a message that names the wave (`waves[1]`):
   - wave `fromMs` that are not strictly increasing;
   - a wave that starts at or after `durationMs`;
   - `gapMinMs > gapMaxMs`;
   - a `lullMs` of at least the wave's span. The span runs from its `fromMs` to the next wave's `fromMs`, or to `durationMs` for the last wave.
   - `maxSimultaneous` that is not an integer ≥ 1;
   - the same anchor planned twice across all waves. A def may appear at several anchors.

   `waves` may be empty: that level plans nothing, like the golden scenarios. The generated JSON Schemas are regenerated with `npm run content:schemas`.
3. **`content:check` refuses bad references, naming them.** It names the level file, the JSON path (`waves[1].threats[0].def`) and the culprit:
   - a wave threat whose `def` has no `content/threats/<def>.json`;
   - an `anchor` that the level's geometry lacks;
   - a def whose `gag` the sim does not know;
   - `feelOverrides` that do not merge into a valid feel through `mergeFeel`.

   Add tests to `tests/content/checkContent.test.ts`. `createSim` refuses the same broken references with `invariant`, in the same wording. It also refuses a planned anchor that the baby cannot reach from its spawn (D12).
4. **The wave director.** `runDirector` (D3-D5) does three things:
   - It enters each wave at its `fromMs` and emits `WaveStarted{t, waveIndex}`.
   - It telegraphs at most one threat per step. It does so only when all of these hold:
     - the wave is open (`now < closesAtMs`);
     - `now ≥ director.nextAt`;
     - the baby is not in `act`;
     - fewer than the wave's `maxSimultaneous` threats are in `telegraph` or `windowOpen`.
   - It picks the threat with `world.rng`, uniformly among the idle instances of the waves started so far. It draws one `nextFloat` per pick and one per gap. Then `nextAt = now + gapMinMs + nextFloat · (gapMaxMs − gapMinMs)`.

   The same seed gives the same game. Two seeds of the live level differ in their first telegraph (a test checks this).
5. **Simultaneity.** In a headless test level built for it, these hold:
   - two threats are active at the same time in a wave with `maxSimultaneous: 2`;
   - three are active at once in a wave with `maxSimultaneous: 3`;
   - the count never goes above the wave's limit;
   - a wave with `maxSimultaneous: 1` never has two active.

   `ThreatTelegraphed` carries `waveIndex`.
6. **Last threat of a wave.** At the step that resolves a threat with `perfect` or `success`, the sim starts `startSlowMo(world, ctx, 'lastThreat', feel.timing.slowMoLastThreat)`, which gives `timeScale` 0.2 for 1500 ms of sim time, when both of these hold:
   - its wave is closed to new telegraphs (D7);
   - no other threat of that wave is still `telegraph` or `windowOpen`.

   A perfect last threat also gets the perfect slow-mo. The two follow 1.14's overlap rule: the slowest scale wins and each source keeps its own timer. A gag on the last threat starts no slow-mo. A threat with `waveIndex: -1` is never a last threat.
7. **The timer ends the level.** `runFlow` is the last system of `SYSTEMS`. At the first step where `world.time.sim ≥ ctx.level.durationMs`, it does two things:
   - sets `world.flow.state = 'ended'`;
   - emits `LevelEnded{t, reason: 'timer'}`, exactly once.

   After that, a `step()` runs only `applyCommands` and `advanceTime` (D8). The clock keeps going, so every `while (time < until)` loop still ends. No baby, threat, Papa or physics change happens, and no further event comes except `TimeScaleChanged` from a slow-mo that winds down.
8. **The HUD timer.** In a level, `[data-pp-zone="timer"]` holds one `hud-timer`.
   - **Look.** It is a `{colors.paper}` pill with an ink outline, `{rounded.full}` and `{spacing.2}` padding. The digits are `{typography.numeric}` in `{colors.ink}` with tabular figures. The sleeping-Mama icon for `nap` comes before them (mockup L63-65, L160, L183).
   - **Value.** It shows the remaining sim time as `m:ss`, rounded **up** to the second, from the level's `durationMs`. It reads `3:00` at the start, `2:59` from the first step, and `0:00` exactly when `LevelEnded` comes.
   - **Writes.** The digits go through `hudBatch` (one slot), so the DOM is written only when the second changes. The pill has `role="timer"` and `aria-label` « Sieste, 2:47 » (`t('hud.timer_variant_nap')` + `, ` + the digits).
   - **Freezes.** It freezes during pause and the countdown. It slows with the sim during slow-mo (sim time, ADR-002), and the HUD stays visible then.
   - **Budgets.** The HUD stays within `HUD_MAX_DOM_NODES` (40) and the 12 % band.
9. **The sim CLI follows the level.**
   - `npm run sim -- --bot idle` plays each run until `LevelEnded`. `--until-ms` becomes an optional cap; with no cap, the run lasts the level's `durationMs`.
   - The report gains:
     - `waves[]`, with per wave its `fromMs`, `maxSimultaneous`, `telegraphs` (summed over the runs), `peakSimultaneous` (the max over the runs) and `overLimitRuns`;
     - `endedRuns`, the runs that saw `LevelEnded`.
   - A test on the live content (`tests/tools/sim/runSim.test.ts`, idle bot, 5 runs) checks that every wave has `telegraphs > 0`, every wave has `overLimitRuns === 0` and `peakSimultaneous ≤ maxSimultaneous`, and `endedRuns === runs`.
10. **The client stops at the end.** On `LevelEnded`:
    - the client mirrors `data-pp-flow="ended"` (`playing` from each level start);
    - its `isLive()` gate turns false, so no pointer, key or pad input enqueues a command;
    - it logs one `info`;
    - the frozen level stays on screen with the timer at `0:00`.

    `?threats=off` (`withoutThreats`) empties `waves` and keeps the duration.
11. **Feel overrides.** `LevelSchema.feelOverrides` (default `{}`) is merged into `content.feel` with `mergeFeel` before `createSim`. The merge happens in the client (`levelSession.ts`) and in `tools/sim/loadSimLevel.ts`. A merge error shows the content error screen (client) or fails the CLI with the problems (tools). The sim, the bots and `feelHash` see the merged feel.
12. **Tests, goldens, CI.**
    - The unit, e2e and golden tests of § Testing pass.
    - The goldens are regenerated on purpose (`npm run golden:update`). Say so in the Completion Notes. For `core_basic`, `baby_wander`, `papa_walk` and `prop_fall`, `eventTypes` and `eventsHash` stay **identical**: only `worldHash` and the journals' `levelHash` move.
    - The screenshot references are regenerated on purpose (darwin and linux, see `CLAUDE.md`). Look at them.
    - Coverage of `src/sim` stays ≥ 90 %.
    - `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [ ] **T0 — Precondition** (§ Precondition). Record the baseline CI and the counts in the Debug Log.
- [ ] **T1 — Content schema** (AC 1, 2, 11)
  - [ ] `src/content/schemas/level.ts`:
    - `LEVEL_VARIANTS = ['nap'] as const` and `LevelVariant`.
    - `LevelWaveThreatSchema = strictObject({ def, anchor })` (the old entry without `fromMs`).
    - `LevelWaveSchema = strictObject({ fromMs, maxSimultaneous, gapMinMs, gapMaxMs, lullMs, threats: z.array(LevelWaveThreatSchema).default([]) })`. Write a `.describe()` text for every field, in sim ms, with units (D2).
    - `LevelSchema` gains `variant: z.enum(LEVEL_VARIANTS)`, `durationMs: z.number().int().positive()`, `waves: z.array(LevelWaveSchema)` and `feelOverrides: z.record(z.string(), z.unknown()).default({})`, and loses `threats`. Keep 1.17's `objects`.
    - Add a `superRefine` for AC 2. Each issue's `path` points at the wave, field or entry, so that `jsonPath` names `waves[1].gapMinMs`.
    - Rewrite the header comment: 1.18 replaced `threats` with waves, and 1.20 adds `disruptions`.
    - Export `Level`, `LevelWave`, `LevelWaveThreat`, `LevelVariant` and `LevelObject`. Remove `LevelThreatEntry`, and fix every importer.
  - [ ] `content/levels/salon_crawler.json`: the values of D2.
  - [ ] `npm run content:schemas`; commit `content/_schemas/level.schema.json`.
  - [ ] `tests/content/levelSchema.test.ts`: one case per rule of AC 2, plus empty `waves` accepted, `feelOverrides` defaulting to `{}`, an unknown variant rejected and a non-integer `maxSimultaneous` rejected.
  - [ ] Check the unit-suffix architecture test for the new keys (`fromMs`, `gapMinMs`, `gapMaxMs`, `lullMs`, `durationMs`). `maxSimultaneous` is a count. If the test asks for a suffix there, the test has an allow list for counts: use it, and do not weaken the rule.
- [ ] **T2 — Loading and checks** (AC 3, 11)
  - [ ] `src/content/loadLevelContent.ts`: read the defs from `level.waves[w].threats[i]`, in order of first reference. A def file that cannot be read names `waves[w].threats[i].def`. Update the doc comment.
  - [ ] `tools/content/contentChecks.ts`: the level reference checks walk the waves (def file, anchor in the geometry, known gag). They add `mergeFeel(feel, level.feelOverrides, 'content/levels/<id>.json')`, and map its problems to `feelOverrides.<path>`. Keep 1.17's object checks. Add tests.
  - [ ] `tests/content/loadLevelContent.test.ts`: migrate it to waves, and add a missing def in wave 2 (its JSON path).
  - [ ] `src/client/app/threatsSwitch.ts`: `withoutThreats` returns `waves: []` and keeps everything else (`durationMs` included). Migrate its test.
- [ ] **T3 — Sim level plan and world slices** (AC 4, 6, 7)
  - [ ] `src/sim/context.ts` › `SimLevel`:
    - `threats: readonly { def: ThreatDef; firstWaveIndex: number }[]`, index-aligned with `world.threats`. One instance per planned `(def, anchor)`, in order of first appearance across the waves. In the salon, that is outlet, stairs, coffee table: the same order as today, which `threats.spec.ts` relies on.
    - `waves: readonly SimWave[]`, where `SimWave = { fromMs, endMs, closesAtMs, maxSimultaneous, gapMinMs, gapMaxMs }`. `endMs` is the next `fromMs`, or `durationMs` for the last wave. `closesAtMs = endMs − lullMs`.
    - `durationMs: number`.
    - Write doc comments in the style of the file.
  - [ ] `src/sim/world.ts`:
    - `ThreatInstance.waveIndex: number`: the wave that telegraphed it; `-1` while `idle` or when no wave planned it (1.19).
    - `DirectorSlice = { waveIndex: number; nextAt: SimMs }`, starting at `{ waveIndex: -1, nextAt: 0 }`.
    - `FlowSlice = { state: FlowState; enteredAt: SimMs }`, starting at `{ state: 'playing', enteredAt: 0 }`.
    - `World` gains `director` and `flow`. Update the `World` doc comment.
  - [ ] `src/sim/flow/flowFsm.ts`: `FlowState = 'playing' | 'ended'`, `FLOW_STATES` with its `…_ARE_COMPLETE` proof (copy the `THREAT_STATES` pattern), and `enterFlowState(world, next)`, the only writer of `flow.state` and `enteredAt`.
  - [ ] `src/sim/createSim.ts` › `simLevelOf`:
    - build `threats` and `waves` from `level.level.waves`;
    - check, with an `invariant` each and the `content:check` wording: the def is loaded, the anchor exists, the gag is known, no anchor is planned twice (a test level bypasses the schema), and every planned anchor is reachable by the baby (D12);
    - create the instances from `simLevel.threats` with `waveIndex: -1`.
  - [ ] `src/sim/snapshot.ts`:
    - `version: 6`, with a comment that 6 adds `director`, `flow` and `ThreatInstance.waveIndex`.
    - `worldProblem` checks `director.waveIndex` (an integer in `[-1, waves.length − 1]`) and `director.nextAt` (finite, ≥ 0).
    - It checks `flow.state ∈ FLOW_STATES` and `flow.enteredAt`.
    - It checks each threat's `waveIndex`: an integer in `[-1, waves.length − 1]`, and `-1` when `idle` (D6).
    - `PlannedLevel` gains `waves: readonly unknown[]` (only the count is needed).
    - Add tests: a snapshot of each kind is refused with the field's name.
  - [ ] Journal: no version bump. `levelHash` already refuses a journal of the old level shape. Check that `replay.test.ts` says so.
- [ ] **T4 — The wave director** (AC 4, 5)
  - [ ] Rewrite `src/sim/director/directorSystem.ts` › `runDirector`, following D3-D5. Keep the file name and the export, and call it « the wave director » in its doc comment.
  - [ ] It allocates nothing per step: count the active threats and the candidates in a loop. Pick the `k`-th candidate in a second loop, with `k = Math.min(n − 1, Math.floor(nextFloat(world.rng) · n))`. Use no array.
  - [ ] `src/sim/threats/threatFsm.ts`:
    - `telegraphThreat(world, ctx, threat, def, waveIndex)` sets `threat.waveIndex`, and `ThreatTelegraphed` gains `waveIndex`.
    - `rearmThreat` resets `waveIndex` to `-1`.
    - `resolveThreat` calls `isLastOfWave(world, ctx, threat)` (D7). If it is true, it calls `startSlowMo(world, ctx, 'lastThreat', ctx.feel.timing.slowMoLastThreat)` after the perfect one.
    - Put `isLastOfWave` in `src/sim/director/waveState.ts`. It is a pure reader of `World` and `ctx.level`, with no event and no write; a system calling a pure reader is fine, a system calling a system is not.
  - [ ] `src/sim/events.ts`:
    - `WaveStarted{t, waveIndex}` and `LevelEnded{t, reason: LevelEndReason}`, with `LevelEndReason = 'timer'` exported and doc comments.
    - `ThreatTelegraphed.waveIndex`.
    - `SIM_EVENT_TYPES` stays **sorted**: `LevelEnded` goes after `InvariantViolated`, and `WaveStarted` after `TimeScaleChanged` and before `WindowOpened`.
    - Neither event gets a `feedback.json` entry. 2.x may add a wave jingle.
  - [ ] `src/sim/index.ts`: export `FlowState`, `LevelEndReason`, `DirectorSlice` and `FlowSlice`.
  - [ ] Tests in `directorSystem.test.ts` (rewrite the old policy's tests): see § Testing.
- [ ] **T5 — Flow and the ended step** (AC 7)
  - [ ] `src/sim/flow/flowSystem.ts` › `runFlow`: the `playing → ended` transition of AC 7.
  - [ ] `src/sim/step.ts`:
    - `SYSTEMS` gains `runFlow` last.
    - Export `ENDED_SYSTEMS = [applyCommands, advanceTime]`. `step()` runs `ENDED_SYSTEMS` instead of `systems` when `world.flow.state === 'ended'`, injected systems included.
    - Update the header comment: the order and the ended rule.
    - Update the pinned-order test.
  - [ ] `src/bots/playGame.ts`: it stops at `untilSimMs` **or** at `flow.state === 'ended'`, whichever comes first. Update its doc comment. `replay.ts` keeps its loop, which ends because the clock still runs.
  - [ ] Tests: `flowSystem.test.ts`, `step.test.ts` (after the end, a `TapFloor` does not move Papa and the baby does not move, `time.sim` still advances, and no second `LevelEnded` comes), and `playGame` (stops at the end).
- [ ] **T6 — Feel overrides at the two call sites** (AC 11)
  - [ ] `src/client/app/levelSession.ts`: after the level loads, `mergeFeel(content.feel, levelPlan.level.feelOverrides, 'content/levels/<id>.json › feelOverrides')`.
    - Pass `{ ...content, feel: merged }` to `createSim`, and to everything that reads the feel for this level: the bots' `holdMinMs` in autoplay, and the client's `feel.input`. Find these readers (`grep -n "content.feel\|\.feel\b" src/client src/debug`) and list them in the Debug Log.
    - An `err` goes to the content error screen, through the path a broken level already takes.
  - [ ] `tools/sim/loadSimLevel.ts`: the same merge. An `err` fails with the formatted problems. `SimLevel.content.feel` is the merged feel.
  - [ ] Tests for both. Write a client unit test with an override of `timing.windowMs`, and check that the sim's `ctx.feel` (through a threat's `responseWindow`) uses it.
- [ ] **T7 — CLI and report** (AC 9)
  - [ ] `tools/sim/simArgs.ts`: `untilSimMs: number | null` (null = the level's duration), and update `SIM_HELP`. Remove `SIM_CLI_DEFAULT_UNTIL_MS` from `shared/constants.ts`, or keep it only if something else needs it (it should not). Keep `SIM_CLI_MAX_UNTIL_MS` as the cap's upper bound.
  - [ ] `tools/sim/runSim.ts`: `const untilSimMs = args.untilSimMs ?? level.level.durationMs`. Record it in the report and in each `RunFile`, so that `sim:replay` replays to the same time.
  - [ ] `tools/sim/simReport.ts`:
    - The recorder tracks waves from `WaveStarted` and `ThreatTelegraphed.waveIndex`.
    - It keeps an active counter: +1 on `ThreatTelegraphed`, −1 on `ResponseResolved` (each telegraph ends in exactly one).
    - At each telegraph of wave `w`, it updates the wave's `peakSimultaneous` and flags the run if the count exceeds the wave's `maxSimultaneous`. It reads the limits from the level, passed to `createRunRecorder`.
    - `summarizeRuns` folds them into `waves[]` and counts `endedRuns`.
    - `renderReport` prints one line per wave.
    - Update `SimReport`'s type and its tests.
  - [ ] `tests/tools/sim/runSim.test.ts`: the live-content idle test of AC 9, and a `perfect` run that shows a `lastThreat` slow-mo in some run, through a recorder hook or the events. Assert `≥ 1` over 5 runs. If this proves flaky on the live tuning, move it to the crafted test level and say so.
- [ ] **T8 — HUD timer** (AC 8)
  - [ ] `src/client/ui/hud/timerHud.ts` › `createTimerHud(doc, { t })` → `{ element, setVariant(variant: LevelVariant), setRemainingS(seconds: number) }`:
    - `<div class="pp-hud-timer" role="timer">` holding the icon `<svg aria-hidden="true" focusable="false">` and `<span class="pp-hud-timer-digits pp-type-numeric">`.
    - `setRemainingS` writes `textContent` (`formatClock(s)` = `m:ss`) and the `aria-label`. `boot` calls it only through `hudBatch`, so once per second.
    - Export `formatClock(seconds)` and test it (0 → `0:00`, 59 → `0:59`, 60 → `1:00`, 180 → `3:00`, 600 → `10:00`).
    - The icons are a `Readonly<Record<LevelVariant, (doc) => SVGSVGElement>>`, so that adding `'return'` without its icon is a type error.
    - The sleeping-Mama icon is built with `svgElement`, from the mockup's `#i-mama-sleep` (L160): a head, a hair bun, two closed eyes and a « Z ». Fill and stroke come from CSS classes that use the tokens: the face in `--pp-color-paper` and the lines in `--pp-color-ink`. No hex in TS or CSS. The mockup's `#F3C9A6` has no token; do not add one (DESIGN.md owns the tokens, and `designTokens.test.ts` checks the mirror).
  - [ ] `ui.css` › `.pp-hud-timer`:
    - background `--pp-color-paper`, ink outline (use the same outline width as `.pp-button-icon` or the HUD pills), `--pp-rounded-full`, padding `0 var(--pp-spacing-4, …) 0 var(--pp-spacing-2)` (mockup L63; use the existing spacing tokens), `gap: var(--pp-spacing-2)`, height 40 px (inside the 44 px row), the sticker lift if `.pp-button-icon` has one;
    - icon 28 px;
    - digits in `--pp-color-ink` with `font-variant-numeric: tabular-nums` (already in `.pp-type-numeric`);
    - no layout transitions.
  - [ ] `src/client/ui/hud/hudLayer.ts`: accept `timer: HTMLElement` in its options and append it to the `timer` zone. Update the doc comment (« timer top-centre (story 1.18) » is now built).
  - [ ] `content/strings.fr.json`: `"hud.timer_variant_nap": "Sieste"`. Pass the key as a literal, as `countdown.ts` does: the architecture test checks every key.
  - [ ] `src/client/boot.ts`:
    - `createHudBatch([(s) => timerHud.setRemainingS(s)])` and a local `const TIMER_SLOT = 0`.
    - At level start: `timerHud.setVariant(levelPlan.level.variant)`.
    - In `onLevelFrame`, before `shell.frame()`, when a level is active: `hudBatch.set(TIMER_SLOT, Math.ceil(Math.max(0, durationMs − world.time.sim) / MS_PER_S))`. Read `durationMs` from the active level plan; never write it as a literal.
    - It allocates nothing per frame. The string write happens only when the second changes.
  - [ ] Unit tests: `timerHud.test.ts` (structure, aria-label, the variant icon present, `formatClock`) and `hudLayer` (the timer is in the zone).
- [ ] **T9 — Client end of level** (AC 10)
  - [ ] `boot.ts` › `onSimEvent`:
    - `LevelEnded` → `mirror('ppFlow', 'ended')` and `log.info('level', 'level ended', { reason, t })`.
    - At each level start, `mirror('ppFlow', 'playing')`.
  - [ ] The `isLive()` gate, shared by the pointer, keyboard and pad paths since 1.17, also requires `active.sim.world.flow.state === 'playing'`. Check that the 1.17 auto-target highlight and glyph chip go away at the end: the target is `null` when not live.
  - [ ] `logSimEvent` handles the two new events at the level its siblings use.
  - [ ] Nothing enters `result`. Leave a one-line comment at the `LevelEnded` case: « story 1.22 shows the result screen ».
- [ ] **T10 — Tests to migrate** (AC 12). `createTestLevel` changes shape (D11). Migrate every caller (§ Testing lists them) and keep each test's intent. Never delete a test to make the suite pass; if a test's premise no longer holds (for example « the director waits for a free baby »), rewrite it to the new rule and say so in the Debug Log.
- [ ] **T11 — e2e** (AC 8, 10, 12)
  - [ ] `tests/e2e/support/game.ts`:
    - Remove `FIRST_TELEGRAPH_MS`, which assumed a fixed first telegraph.
    - Add `stepToFirstTelegraph(page)`: frozen, advance in chunks until `__PP__.events()` holds a `ThreatTelegraphed`, and return it (`t`, `threatId`, `kind`).
    - Add a bound from the data: `FIRST_TELEGRAPH_MAX_MS = waves[0].fromMs + waves[0].gapMaxMs` (+ one step) for timeouts.
    - Update `liveLevel`'s type to the wave shape.
  - [ ] Migrate:
    - `autoplay.spec.ts`: `SHOT_STEPS` comes from the first telegraph found plus half of **its** def's `telegraphDelayMs`.
    - `threat.spec.ts`, `tapLatency.spec.ts` and `timeEffects.spec.ts`: use the threat that was telegraphed first, not `threats[0]`.
    - `threats.spec.ts`: the coffee table first appears from 60 s (wave 2). Advance past `waves[1].fromMs` and read the bound from the level; do not hard-code 60000.
  - [ ] New `tests/e2e/timer.spec.ts` (chromium + webkit):
    - After `ppLoadLevel('salon_crawler', 42)` frozen, the timer reads `3:00` and its `aria-label` starts with « Sieste ».
    - After `ppAdvance` of 1 step it reads `2:59`. After `1000 / STEP_MS` more, `2:58`.
    - It sits in `[data-pp-zone="timer"]`, centred (the existing zone test still passes), and the HUD stays within the node budget.
    - Advancing to `durationMs` gives `0:00`, one `LevelEnded` in the events and `data-pp-flow="ended"`. A tap on the floor after that adds no command to the journal (`__PP__` or the events: no `PapaPathPlanned`).
    - To advance 18 000 steps, use `ppAdvance` in chunks (see how `threats.spec.ts` chunks) and keep the test under the default timeout. If it is too slow on WebKit, say so in the Debug Log rather than raising timeouts blindly.
  - [ ] Screenshots: the timer pill is now in `autoplay-frozen.png`. Regenerate the darwin references (`npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`) and the linux ones (Docker command, `CLAUDE.md` and memory « story-1-13-screenshot-refs »). Look at each PNG: the pill is top-centre, the digits read the time of `SHOT_STEPS`, and the scene is otherwise as before. Say so in the Completion Notes.
- [ ] **T12 — Goldens** (AC 12)
  - [ ] Migrate `tests/golden/scenarios.ts` to `createTestLevel` (D11).
    - `outlet_parry`: one wave, `gapMinMs = gapMaxMs = 2000` (its old `fromMs`).
    - `threat_trio`: one wave with the three threats, `maxSimultaneous: 1`, gap 0. Update its comment: picks are now by PRNG. Fix `threatTrio.test.ts` to the new order: assert on defs and events, not on array order.
  - [ ] `npm run golden:update`, then `git diff tests/golden/journals`. For the four no-threat scenarios, `eventTypes` and `eventsHash` must not move (AC 12). If they move, the director or the flow emits or draws when it should not: fix that, never the references.
- [ ] **T13 — Docs and deferred work**
  - [ ] `_bmad-output/implementation-artifacts/deferred-work.md`: mark these resolved, with « (story 1.18) »:
    - `feelOverrides`;
    - the CLI duration;
    - `slowMoLastThreat` never triggered;
    - several threats and one baby (D5);
    - the director in array order with no gap;
    - two entries sharing an anchor (AC 2);
    - spawn region and reachability (D12).
  - [ ] Re-defer, with the new target and the reason:
    - multi-touch and `Release` naming no threat (D13: playtest 1.24);
    - `responseChoreography`'s single queue (D13);
    - the coffee-table threat with no object left (story 2.x or 1.22, when a dud threat shows in the score);
    - the per-level audio manifest (story 2.3).
  - [ ] Add a « Deferred from: implementation of story 1-18 » section for anything new.
  - [ ] `CLAUDE.md` › Commands: the `npm run sim` line says that a run lasts the level's duration unless `--until-ms` caps it.

## Dev Notes

### Decisions (D1-D13)

| # | Decision | Why |
|---|---|---|
| D1 | **Waves are cumulative.** Wave `w`'s pool is the threats listed in waves `0..w`. A wave lists only the threats it **adds**; wave 3 of the salon lists none. | The architecture's level example (L1016-1019) gives wave 3 no `threats`, yet it must run three at once. « Menaces activables » grow with the escalation. |
| D2 | **The salon's waves** (starting values; Geo tunes them):<br>• wave 0: `fromMs: 0`, `maxSimultaneous: 1`, gap 4000-7000, `lullMs: 3000`, threats `outlet@outlet_01` and `stairs@stairs_top`;<br>• wave 1: `fromMs: 60000`, `maxSimultaneous: 2`, gap 1000-3000, `lullMs: 3000`, threat `coffee_table_object@coffee_table`;<br>• wave 2: `fromMs: 120000`, `maxSimultaneous: 3`, gap 500-2000, `lullMs: 3000`, no threats. | An unanswered threat is active for about 1.3 to 1.9 s (delay 1.0-1.5 s, window 300 ms, tolerance). To overlap at all, a wave's gap has to drop below that, hence the short gaps of waves 1 and 2. The first threat lands at 4-7 s, close to today's 4 s. The 3 s lull lets a wave end visibly (and gives its last-threat slow-mo) before the next wave starts, or before the 3:00 timer runs out. |
| D3 | **The director's rhythm.** On entering wave `w`, `nextAt = fromMs + gap(w)`, drawn only if the pool of wave `w` is non-empty. After each telegraph, `nextAt = now + gap(w)`. The gap is counted from the last **telegraph**: when the limit or a lack of idle candidates blocks the director past `nextAt`, the next threat comes as soon as one can. Telegraphs stop at `closesAtMs = endMs − lullMs`. | One rule, two draws. The lull gives the « end of wave » beat. With no waves, nothing is ever drawn, so the no-threat goldens keep their events (AC 12). |
| D4 | **The pick is uniform over idle instances.** Uniform pick among idle instances of the pool, with one `nextFloat` per pick even when there is one candidate. A threat in cooldown (`resolved`, `gag`) is not a candidate. | « Choisit … avec le PRNG » (epic, architecture L273). The draw count depends only on the game, never on the tuning (the rule in `babySystem.ts` › `drawBabbleMs`). The first threat of a game is no longer always the outlet; 1.16's D8 is superseded. The e2e tests find the first threat instead of assuming it (T11). |
| D5 | **One baby, several threats.** The director no longer waits for a free baby. It only waits while the baby is in `act` (playing a gag), so that a mischief plays out before the next threat. The baby keeps 1.10's rule: it locks on one active threat. The others run without its gaze: their icon, halo, sound and haptic still telegraph them. | Otherwise simultaneity can never happen: the baby locks on the first threat the moment it starts. In a `maxSimultaneous: 1` wave, this is today's behaviour except during `act`, which the old gate also blocked. It resolves `deferred-work.md` « Several simultaneous threats and one baby ». Watch it in the playtest. |
| D6 | **`ThreatInstance.waveIndex`** is the wave that telegraphed it. It is kept through `resolved` / `gag`, so that the last-threat check can read it, and reset to `-1` at re-arm. `-1` also means « not planned by the director » (1.19's micro-sleep). | It is the minimum state the last-threat rule needs. The snapshot checks `idle ⇒ -1`. |
| D7 | **A wave is closed to new telegraphs** when `now ≥ closesAtMs(w)`, or `director.waveIndex > w`, or (`director.waveIndex === w` and `director.nextAt ≥ closesAtMs(w)`). Once a wave is closed, the success that leaves no other active threat of that wave is its last threat. If the director was blocked and nothing of the wave is active when it closes, that wave has no last-threat slow-mo. | The third clause recognises the last telegraph as soon as the next draw lands past the close, so a wave whose last threat resolves inside the lull still gets its slow-mo. The fallback case is rare and harmless. Document it in `waveState.ts`. |
| D8 | **After `ended`, only `applyCommands` and `advanceTime` run.** Commands are drained and ignored, so the queue never grows. The clock keeps advancing, so every `while (time < until)` loop (`replay.ts`, `playGame`, about eight tests) ends. | Freezing the clock would hang those loops: `grep -rn "while (sim.world.time.sim"` finds them. Skipping every gameplay system is simpler and safer than gating each one. |
| D9 | **This story does not open the result screen.** The client stops input and keeps the frozen level and `0:00` on screen. Story 1.22 moves to `result`. | Keeps 1.18 small. `appFsm` already allows `level → result`, and 1.22 owns the screen. |
| D10 | **No disruption is built here.** The « plus une perturbation » of wave 3 is story 1.20, whose AC begins « Étant donné `content/disruptions/phone.json` et la vague 3 ». 1.20 adds `disruptions: [{ def, atMs }]` to `LevelWaveSchema`, together with `DisruptionDefSchema` and the folder. | A disruption field with no def, no schema and no system would be dead code that `content:check` cannot validate. Flagged to Geo in Open points. |
| D11 | **Test helpers:**<br>• `createTestLevel({ waves = [], objects = [], durationMs = TEST_LEVEL_DURATION_MS, variant = 'nap', feelOverrides = {} } = {})`;<br>• `testWave(threats, overrides?)`, defaults `{ fromMs: 0, maxSimultaneous: 1, gapMinMs: 0, gapMaxMs: 0, lullMs: 0 }`;<br>• `OUTLET`, `STAIRS` and `COFFEE_TABLE` constants `{ def, anchor }` in place of `outletEntry(fromMs)` and its siblings.<br>`TEST_LEVEL_DURATION_MS` is 600 000, longer than any test. A test that relied on `outletEntry(2000)` uses `testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })`: its first telegraph lands at the first step ≥ 2000, as before. | One helper shape for every test. The long default duration keeps `ended` out of tests that are not about it. |
| D12 | **Reachability.** `createSim` refuses a level where a planned threat anchor's nearest open baby cell (`ctx.nav.baby.nearestOpenCell(x, z, -1)`) is not in the region of the baby's spawn cell (`grid.region`). It names the level, the wave entry and the anchor. | The two items `deferred-work.md` moved to 1.18 (« spawn in a tiny region », « anchors reachable from the baby's spawn region »). The salon passes it; a test with a walled-in anchor proves the refusal. `content:check` does not build nav grids, so the refusal is `createSim`'s (it runs in every test and CLI run). |
| D13 | **Kept as is: `Release` names no threat, only the primary pointer presses, and `responseChoreography` queues one pose.** A tap is press + release within 400 ms, and each press is classified on its own `releasedAt − t`, so two threats tapped one after the other resolve correctly. Two fingers at once is the rare case: the second finger is ignored. The single pose queue follows Papa's single glide. | All three were deferred « to the first story with two threats at once ». The rules still hold for sequential taps, which is how waves are played. Re-defer them to the playtest (1.24) with this reasoning, and add a sim test: two threats active, press A, release, press B, release → both resolved. |

### Current state of the files this story changes (read before editing)

These excerpts predate 1.17; re-read each file first.

- **`src/sim/director/directorSystem.ts`** (minimal, 1.10).
  - Today: when the baby is `wander` / `babble` and no threat is active, it telegraphs the first idle threat whose `fromMs` has passed. It uses no randomness and is pinned by tests.
  - **Changes:** the whole policy (D3-D5).
  - **Keep:** at most one telegraph per step, `telegraphThreat` as the only way in, and no allocation.
- **`src/sim/threats/threatFsm.ts`**:
  - `telegraphThreat` freezes `responseWindow` and sets `windowOpenAt`.
  - `resolveThreat` emits `ResponseResolved`, requests the hitstop and starts `'perfect'`.
  - `rearmThreat` resets the instance.
  - **Changes:** the `waveIndex` parameter and field, and the last-threat slow-mo after the perfect one.
  - **Keep:** event order and fields; the hitstop on every success.
- **`src/sim/world.ts`**:
  - `SlowMoSource` already has `'lastThreat'`.
  - `createWorld` builds `threats: []`; `createSim` pushes the instances.
  - **Changes:** add `director` and `flow`, and `waveIndex` on instances.
- **`src/sim/createSim.ts`** › `simLevelOf`.
  - Today: one instance per `level.level.threats` entry; `invariant`s for the def, the anchor and the gag. 1.17 adds object checks.
  - **Changes:** waves, the wave plan, D12. Keep all the existing checks and their wording style.
- **`src/sim/time/slowMo.ts`** › `startSlowMo(world, ctx, source, feel)`: already implements 1.14's overlap rule (D5 of 1.14). Do not touch it.
- **`src/sim/baby/babySystem.ts`** › `lockOnThreat`: locks on the first active threat in level order when the baby is free. **Unchanged** (D5). Its tests must still pass.
- **`src/client/ui/hud/hudLayer.ts`**:
  - `ZONES = ['gauges', 'timer', 'pause']`; only the pause zone has content.
  - **Changes:** the timer goes in its zone.
  - **Keep:** `setVisible` / `setInteractive`, the zone attributes and the layout that `ui.spec.ts:419-470` measures.
- **`src/client/ui/hud/hudBatch.ts`**:
  - `createHudBatch(writers)`; `set(slot, value)` records, and `flush()` (called by `shell.frame()`) writes only changed values.
  - Values must be finite: never pass `NaN` (`Math.max(0, …)` guards a negative value).
- **`src/client/boot.ts`**:
  - `createHudBatch([])` sits at about L519, `onLevelFrame` at about L408-441 and `onSimEvent` at about L459-507.
  - `mirror(name, value)` writes `data-pp-*` on `<html>` (`mirror('ppApp', …)` at about L214).
  - **Keep:** event order in `onSimEvent`, and the debug listeners last.
- **`tools/sim/*`**:
  - `runSim` plays `args.untilSimMs` (default `SIM_CLI_DEFAULT_UNTIL_MS` = 180 000).
  - `createRunRecorder` freezes the threat → def map at `createSim`. That stays valid: instances are still all created at `createSim`.
- **`tests/e2e/support/game.ts:49-64`**: types the live level with `threats[].fromMs` and derives `FIRST_TELEGRAPH_MS`. It is used by `autoplay`, `threat`, `tapLatency` and `timeEffects`.

### Architecture compliance

- **Sim purity.** No `Math.random`, `Date` or `performance`, and no `window` identifier: `simPurity.test.ts` forbids it, which is why `responseWindow` exists. All randomness comes from `world.rng` through `nextFloat` (`@shared/rng`).
- **Systems.** `runDirector` and `runFlow` are `(world, ctx) => void`. They write only their own slices and the threats, through the FSM helpers, and push events.
  - `isLastOfWave` is a pure reader.
  - `enterFlowState` is the only writer of `flow.state`.
  - The new order is `applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa, runPhysics, runFlow`. `runGauges`, `runInstinct` and `runScoring` slot in before `runFlow` later.
- **No logging in the sim.** A broken level is an `invariant`; a runtime clamp is `clampInvariant`.
- **Units.** `fromMs`, `gapMinMs`, `gapMaxMs`, `lullMs`, `durationMs`, `closesAtMs`, `endMs`. `nextAt` and `enteredAt` are sim-time instants (`…At`). No bare `duration`.
- **Events** are past tense: `WaveStarted`, `LevelEnded`. **Ids** are `lower_snake_case`. **Strings** go in `strings.fr.json` through `t()`.
- **Client.** It imports only `@sim` (types `FlowState` and `LevelEndReason`) and `@content`. Use no `@sim/*` path. The HUD is DOM + CSS with the `pp-` prefix, tokens only, at most 40 nodes, and does no layout work per frame.
- **The time model.** The timer counts sim time, as ADR-002 measures the windows in sim time, so the clock slows down during slow-mo too. If Geo prefers real time for the display, that is a separate tuning question (Open point 2); do not mix the clocks.

### Library and framework notes

- **Zod 4** (pinned in `package.json`):
  - `z.strictObject`, `.superRefine((value, ctx) => ctx.addIssue({ code: 'custom', path: ['waves', i, 'gapMinMs'], message }))`, `z.enum([...])`, `z.record(z.string(), z.unknown())`.
  - `z.toJSONSchema` generates `content/_schemas/` through `npm run content:schemas`. A `superRefine` does not show in JSON Schema; that is expected.
  - Follow the patterns already in `src/content/schemas/feel.ts` (its `.refine` on `perfectMs ≤ windowMs`) and `level.ts`.
- **No new dependency.** Three.js is not involved (the HUD is DOM). Playwright 1.64 with chromium and webkit.

### File structure

| File | New / Update |
|---|---|
| `src/content/schemas/level.ts`, `content/levels/salon_crawler.json`, `content/_schemas/level.schema.json`, `content/strings.fr.json` | Update |
| `src/content/loadLevelContent.ts`, `tools/content/contentChecks.ts`, `src/client/app/threatsSwitch.ts` | Update |
| `src/sim/context.ts`, `world.ts`, `events.ts`, `index.ts`, `createSim.ts`, `snapshot.ts`, `step.ts` | Update |
| `src/sim/director/directorSystem.ts`, `src/sim/threats/threatFsm.ts` | Update |
| `src/sim/director/waveState.ts`, `src/sim/flow/flowFsm.ts`, `src/sim/flow/flowSystem.ts` (+ tests) | New |
| `src/bots/playGame.ts`, `tools/sim/simArgs.ts`, `runSim.ts`, `simReport.ts`, `loadSimLevel.ts`, `src/shared/constants.ts` | Update |
| `src/client/ui/hud/timerHud.ts` (+ test) | New |
| `src/client/ui/hud/hudLayer.ts`, `src/client/ui/styles/ui.css`, `src/client/boot.ts`, `src/client/app/levelSession.ts` | Update |
| `tests/support/testContent.ts`, `tests/golden/scenarios.ts`, `tests/golden/journals/*`, `tests/e2e/support/game.ts`, the e2e specs of T11 | Update |
| `tests/e2e/timer.spec.ts` | New |
| `tests/e2e/__screenshots__/autoplay.spec.ts/*.png` | Regenerate |

Do not create `src/sim/director/waveDirector.ts`. The architecture tree names one, but the code's convention is `<domain>System.ts` exporting `run<Domain>` (`babySystem`, `threatSystem`, `propsSystem`); keep `directorSystem.ts`. Note this in the Completion Notes.

### Testing

**Unit (Node, Vitest):**
- **`directorSystem.test.ts`**:
  - wave entry emits `WaveStarted` once per wave, in order;
  - the first telegraph lands within `[fromMs + gapMinMs, fromMs + gapMaxMs]`;
  - the gap after a telegraph stays inside the wave's bounds;
  - nothing is telegraphed in the lull or while the baby is in `act`;
  - `maxSimultaneous` 1, 2 and 3 are each reached and never exceeded (AC 5);
  - only idle threats of started waves are candidates (a wave-1 threat never appears before `waves[1].fromMs`);
  - same seed → same sequence, and two seeds → different first picks or times (over a few seeds; assert that at least one differs);
  - no draw at all for a level without waves (compare `world.rng` before and after 1000 steps).
- **`waveState.test.ts`**: `isLastOfWave` for each clause of D7, a `-1` threat, and another active threat of the same wave.
- **`threatFsm.test.ts`** / **`timeEffects.test.ts`**:
  - the last success of a closed wave starts `lastThreat` (scale 0.2, `holdUntil = startedAt + 1500`);
  - a perfect last threat has both entries and `scale` is the min;
  - a gag last threat has none;
  - a non-last success has none.
- **Flow:** `flowSystem.test.ts` and `step.test.ts` (AC 7, T5).
- **Snapshots, content and CLI:** `snapshot.test.ts` (v6 fields); `createSim.test.ts` (waves to instances in first-appearance order, the duplicate anchor, an unknown def, the anchor and gag checks, D12); `levelSchema.test.ts`, `checkContent.test.ts`, `loadLevelContent.test.ts` and `feelMerge` usage (T1, T2, T6); `simReport.test.ts` and `runSim.test.ts` (T7).
- **Client:** `timerHud.test.ts`, `hudLayer` / `uiShell` (the timer is visible in a level and hidden outside one), and `threatsSwitch.test.ts`.
- **D13:** two threats active, press A then release, press B then release → two `ResponseResolved` of the right ids.

**Callers of `createTestLevel` / `outletEntry` to migrate** (from `grep -rln "fromMs\|createTestLevel(\[" src tools tests`):
- `levelSession.test.ts`, `threatsSwitch.test.ts`, `responseChoreography.test.ts`, `threatFeedback.test.ts`, `loop.test.ts`;
- `autoplay.test.ts`, `testApi.test.ts`;
- `babySystem.test.ts`, `createSim.test.ts`, `determinism.test.ts`, `directorSystem.test.ts`, `glide.test.ts`, `replay.test.ts`, `snapshot.test.ts`, `gags.test.ts`, `threatFsm.test.ts`, `threatSystem.test.ts`, `timeEffects.test.ts`;
- `checkContent.test.ts`, `levelSchema.test.ts`, `loadLevelContent.test.ts`;
- `tests/support/botSupport.ts`, `tests/threats/threatCatalog.test.ts`, `tests/tools/sim/runSim.test.ts`, `tests/golden/scenarios.ts`.

`threatCatalog.test.ts` (1.16) plans every def at its live anchor, « the def under test from 0 ms, the others after the case's horizon ». With waves:
- the def under test goes in wave 0 with a fixed gap;
- the others go in a later wave whose `fromMs` is past the horizon;
- the anchors are still derived from the live levels' waves.

**e2e:** T11. **Golden:** T12.

### Previous story intelligence (1.14-1.17)

- **1.14:**
  - The last-threat slow-mo was left ready: `SLOW_MO_SOURCES` holds `'lastThreat'` and `feel.timing.slowMoLastThreat` is `{ timeScale: 0.2, durationMs: 1500, returnMs: 300 }`.
  - Its review asks that time effects stay decided in `threatFsm` from `feel.json`, never in the `FeedbackDirector`.
- **1.15 and 1.16:**
  - The reviews punished e2e tests that depend on the live level's timings and on threat ids (`threats.spec.ts`: an unbounded `NearMiss` count, an assumed `index + 1` id, a hard-coded 10 ms step). This story moves those timings, so derive every bound from the content and from `STEP_MS`.
  - The reviews also punished tautological unit assertions and a story record that overstated what was verified. Tick only what you ran, and write « (deviation: see Debug Log) » otherwise.
- **1.16:**
  - D8 (« the first threat stays the outlet ») is superseded by D4. D11 (« one threat at a time; multi-touch, overlapping presses and the choreography queue stay deferred to 1.18 ») is decided by D13.
  - The coffee-table dud stays deferred.
- **1.17:**
  - Adds `TapObject` and `ObjectTapped`, the level's `objects`, `inputMapper.lastDevice` and `targetedThreatId()`, the `glyph-chip`, and `isLive()` gating in `boot.ts`.
  - With several threats active, auto-target picks the window that closes first; the waves are its first real test. Play it once on the keyboard in wave 3 and note it in the Debug Log.
- **Environment:** the e2e suite needs `VITE_DEBUG_ALLOWED` unset (memory « shell-vite-debug-allowed-env »). Screenshot references exist for darwin and linux; the linux ones come from Docker with the `pp-node-modules` volume (memory « story-1-13-screenshot-refs »).

### Git intelligence

- The last commits alternate « Story X : création de la story », « Story X : <titre> » and « Story X : corrections de la revue de code », in French with a space before the colon. Follow that for the implementation commit: `Story 1.18 : vagues de menaces et chrono du niveau`.
- Recent stories regenerate goldens and screenshots in the same commit as the code that changes them, and say so in the story.

### Project context rules (from `_bmad-output/project-context.md`)

- Zero allocation in hot paths: `sim.step()`, every system and the rAF loop. Use counting loops, not `filter`/`map`, in the director and the recorder's hot path. The HUD writes through `hudBatch`.
- Golden tests: regenerate deliberately, never loosen the comparison. Architecture tests are guardrails: never weaken them.
- Every threat keeps its generated perfect / success / too-early / too-late cases (the catalogue).
- Express time in sim steps and sim ms, never timers, in sim tests.
- A new JSON is not done until `content:check` passes.
- The game stays playable end to end with no human: the bots, the headless CLI (to `LevelEnded`) and autoplay (which now reaches `0:00`).
- Do not add a library. Use no `enum` (`as const` arrays and unions) and no constructor parameter properties.

### Open points for Geo (do not block on them; implement the decisions above)

1. **The disruption of wave 3** (D10) arrives with the phone in 1.20, not here. Until then, wave 3 is three threats at once with no phone.
2. **The timer runs on sim time** (ADR-002), so it slows during slow-mo: a 3:00 level lasts a little longer in real time. If you want the display in real time, say so; it would be a client-only display change.
3. **The wave values of D2** are starting points. They are all in `salon_crawler.json`: tune them while you play, then check with `npm run sim -- --bot human --runs 50`.
4. **Picks are now random** (D4): the first threat is not always the outlet. If the first threat of the first wave should be scripted (the tutorial effect of FR52), a small `first` field on wave 0 can do it in a later story.

### References

- `_bmad-output/planning-artifacts/epics.md` › Story 1.18 (L1001-1031); 1.19 (L1033-1064); 1.20 (L1066-1086); 1.21 (L1088-1116); 1.22 (L1118-1151); UX-DR4 (L218-221); FR8, FR31, FR32 (L35, L67, L71).
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` L91, L107-112, L159, L372, L560.
- `_bmad-output/planning-artifacts/game-architecture.md` L193, L229-231, L262, L273, L400, L487, L496, L580, L589, L736, L839-840, L946, L996-1022.
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md` L172-180, L444-445, L462-464, L474, L526; `EXPERIENCE.md` L124, L208, L293-294, L379, L481-482; `mockups/key-hud-level.html` L63-65, L160, L183.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the items quoted in T13.
- `_bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md` (D5, the overlap rule), `1-16-…md` (D8, D11, Review Findings), `1-17-…md` (downstream notes).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
