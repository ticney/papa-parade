---
baseline_commit: 2001aba8c9e5d9bfef7bda410fb403904c3c5dc
---

# Story 2.9: Fatherly Instinct

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR20 (and the `hasInstinct` half of FR55) · **UX:** UX-DR15, `EXPERIENCE.md` L220, L301, L427-439; `DESIGN.md` L21, L258-260, L388, L543, L554 · **Architecture:** L209, L223, L230, L494, L587, L840, L956 · **GDD:** L184, L209, L214, L362-374

## Story

As an overwhelmed player,
I want a discreet helping hand when everything falls apart,
so that the chaos stays funny and never frustrating.

## Acceptance Criteria

### The rule, in the sim

1. **New system `runInstinct`**, in `src/sim/assist/paternalInstinct.ts` (architecture L494: this file name, not a `create` factory), slotted between `runGauges` and `runScoring` in `SYSTEMS` (`step.ts`). Update the doc comment of `step.ts` and the pinned order in `step.test.ts`. No other system moves.
2. **`World.instinct`** (`InstinctSlice`, `world.ts`): `state: 'ready' | 'active' | 'cooldown'`, `enteredAt`, `untilAt` (the instant the current state ends, `asSimMs(0)` in `ready`), `missAts: SimMs[]`. Export `INSTINCT_STATES` with its compile-time proof, like `THREAT_STATES`. State changes only through one `enterInstinctState`. Initial value in `createWorld` (`world.ts` ~L513): `ready`, empty list. Plain data, in the snapshot: **version 20** (`snapshot.ts` L33-40, L59: update the version comment), with an `instinctProblem` validator (known state, finite `enteredAt`/`untilAt`, `missAts` finite and ascending).
3. **A miss** is every `ResponseResolved{fail}`: `gagThreat` (`threatFsm.ts` L192) calls `recordMiss(world, ctx)`, beside `resetCombo` (L221), so it covers every gag: a timed-out silence and a failed micro-sleep included. `cancelThreat` records nothing. Written at the source like `world.score.perfects`; `runInstinct` does not scan `ctx.events`. `recordMiss` keeps at most `feel.instinct.missesCount` entries (push, then `shift` while too long: no allocation beyond the array's own slots), in every state and at every tier.
4. **Trigger.** At each step, in state `ready`, all of:
   - `activeDifficulty(world, ctx).hasInstinct` (`timing/difficulty.ts`, the one reader; **never** `feel.difficulty.normal`, see `deferred-work.md` L672);
   - at least `feel.instinct.minActiveThreatsCount` threats pass `isThreatActive` (`director/waveState.ts` L8, no second definition): a hidden silence and a threat on Papa count, a threat in `gag` or `resolved` does not;
   - `missAts.length >= missesCount` and `now − missAts[length − missesCount] < missesWithinMs` (**strictly**: « en moins de 10 s »; 9990 ms triggers, 10 000 ms does not).

   The condition is read every step, not only on a miss: two misses, then a third threat telegraphed 5 s later, triggers at that step.
5. **On trigger:** `missAts` is emptied; `state = 'active'`, `untilAt = now + durationMs`; event `InstinctTriggered { t, untilAt }`; then `startSlowMo(world, ctx, 'instinct', ctx.feel.instinct)`. Add `'instinct'` to `SlowMoSource` and `SLOW_MO_SOURCES` (`world.ts` L305-312; fix the comment at L304).
6. **`feel.instinct.returnMs`** (decision D1): new key in `InstinctSchema` (`feel.ts` L387, with `delayMs`), value **300** in `content/feel.json` like the other slow-mos, so that `feel.instinct` is a valid `SlowMoFeel` argument. Add it to `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `npm run content:schemas`. **No other value of `feel.instinct` changes.**
7. **Window bonus.** New helper `instinctWindowModifier(world, ctx)` in `paternalInstinct.ts`: `1 + windowBonusPct / 100` while `active`, else `NEUTRAL_WINDOW_MODIFIER`. `telegraphThreat` uses it (`threatFsm.ts` L69; drop the comment L66). `effectiveWindow` and `judgedWindow` are **not** touched. Fix the comment of `NEUTRAL_WINDOW_MODIFIER` (`constants.ts` L267). The perfect zone stays `perfectMs`; tolerance and buffer stay unscaled.
8. **Frozen windows (decision D2).** A window already telegraphed keeps its length when the instinct starts or ends; a window telegraphed during the instinct keeps its +30 % after it. Threats already on screen get the slow-mo only.
9. **`isJudgeableBeforeEnd` (`judgeable.ts` L19-24) multiplies by `instinctWindowModifier`** too. **Trap:** otherwise a micro-sleep or a cry in the arms spawned during the instinct, near the end of the level, passes the check with a window too short and shows a telegraph that never resolves. Test it at the boundary.
10. **End.** At the first step with `t >= untilAt` in `active`: `InstinctEnded { t, reason: 'timer' }`, then `state = 'cooldown'`, `untilAt = now + cooldownMs`. In `cooldown`, at `t >= untilAt`: `ready`, with no event. So the recharge runs **from the end** (AC 2 of the epic and the schema's « Recharge time after the instinct ends »): 34 s from trigger to trigger at the default values, and FR20's « at most once every 30 s » holds. `durationMs` and `cooldownMs` are read once and frozen in `untilAt`, like the slow-mo's `holdUntil`, so a live `SetFeel` cannot split the instinct from its slow-mo.
11. **The level ends during the instinct.** `endLevel` (`flow/flowSystem.ts` L16) closes it after `endSilence`, through an exported `endInstinct(world, ctx)`: `InstinctEnded { reason: 'levelEnded' }`, state `cooldown`. Every `InstinctTriggered` has exactly one end, even in the same step. The slow-mo winds down by itself (`ENDED_SYSTEMS` still runs `advanceTime`).
12. **Events.** `InstinctEndReason = 'timer' | 'levelEnded'`; both events in the `SimEvent` union and `SIM_EVENT_TYPES` (`events.ts`, alphabetical, after `GagTriggered`). No `world.rng` draw, ever (a test compares the rng state).
13. **The tier.** At `experienced` no trigger, even with the conditions met, misses still recorded. At `assistance`, base 300 gives 585 during the instinct (300 × 1.5 × 1.3); at `normal`, 390; with a fatigue penalty of 20 % at `normal`, 312. `hasInstinct` is read at the trigger only: a running instinct ends normally.
14. **Debug command `ForceInstinct { t }`** (decision D3), journaled, built like `ForceThreat` (`commands.ts` L46, L105, L194): `runInstinct` reads it from `ctx.commands` like `SetFatigue` in `runGauges`. In `ready` or `cooldown`, with `hasInstinct` true, it starts the instinct now, ignoring the threats, the misses and the recharge. Ignored with no event when `active` or when `hasInstinct` is false. Plus `forceInstinct(context)` in `debug/cheats.ts` and a « Instinct » button beside « Launch » (`debugOverlay.ts` L240, same `refusalReason` guard).

### Tests of the sim (epic AC 4)

15. `src/sim/assist/paternalInstinct.test.ts`, in sim steps, on real `gagThreat` paths where possible:
    - **Trigger:** each condition missing alone (2 active; 1 miss; misses 10 000 ms apart, 9990 ms apart triggers); the late third threat; `ThreatCancelled` is no miss; a silence timeout and a failed micro-sleep are misses; `InstinctTriggered` and `TimeScaleChanged{to: 0.8}` in order.
    - **Length:** `world.time.scale` is exactly 0.8 for the steps up to `untilAt`, then the smoothstep over `returnMs`, then 1. `InstinctEnded{timer}` at exactly trigger + 4000.
    - **Recharge:** conditions met again at end + 29 990: nothing; at end + 30 000: triggers (with two fresh misses, since a trigger empties the list).
    - **Windows:** 390 / 585 / 312 / experienced 225; `perfectMs`, tolerance and buffer unchanged; a window telegraphed before the trigger and one telegraphed before the end keep their lengths (AC 8).
    - **Overlap (rule D5 of story 1.14, built on `slowMo.test.ts`):** instinct then perfect, and perfect then instinct: scale 0.3 while the perfect holds, back up to 0.8 and not to 1 while the instinct holds, then 1; each source keeps its own timer; the same with `lastThreat` (0.2) and `comboCashIn` (0.25). `InstinctEnded` does not move with the perfect (sim time).
    - **Others:** level end during the instinct (`timer` and `mamaWoke`), trigger and end in one step; `SetFeel` during the instinct changes neither `untilAt` nor the slow-mo's end, and a new `windowBonusPct` applies to the next telegraph; `ForceInstinct` in each state; the rng unchanged; snapshot round trip mid-instinct and mid-recharge (same hash at the end as without a restore), a bad slice refused. `SLOW_MO_SOURCES` and `snapshot.test.ts` follow.
16. **Golden scenario `instinct`** in `tests/golden/scenarios.ts`: a test level with at least 4 threats, reaching the rule by real misses, covering the trigger and the end. `tests/golden/journals/instinct.json` + `.expected.json`.

### Feedback (epic AC 3)

17. **The route (decision D4).** `tools/content/contentChecks.ts` L180 refuses a `uiElement` visual on a cue played by a sim event, and that guard stays. So, as for `NoiseAlertReached` (`boot.ts` ~L1034): on `InstinctTriggered`, boot calls `director.handle('InstinctVignetteShown', null)`, a new client event in `FEEDBACK_CLIENT_EVENTS` (`feedbackEvents.ts`). `content/feedback.json`: `events.InstinctVignetteShown = 'instinct_triggered'`, and the cue:
    ```json
    "instinct_triggered": {
      "audio": { "clip": "papa_heartbeat", "bus": "sfx", "gainPct": 90 },
      "visual": { "kind": "uiElement" },
      "haptic": "heartbeat"
    }
    ```
18. **Haptic.** New kind `heartbeat` in `HAPTIC_KINDS` (`feedback.ts` L12) and `HapticsSchema` (L54), `{ "patternMs": [30, 90, 30] }` in the table (lub-dub). It goes through `createGatedHaptics`, so the Vibrations setting applies. `npm run content:schemas`.
19. **Sound.** `synthHeartbeat` in `tools/audio/makePlaceholderAudio.ts`, entry `{ clip: 'papa_heartbeat', synth: synthHeartbeat }` in `PLACEHOLDER_CLIPS` (category `papa`): about 3 s of low lub-dub (around 50-70 Hz plus a little harmonic so a phone speaker renders it), fading out; deterministic, silent at both ends (the existing test loop pins that). Generate only this clip: `npm run assets:audio -- --only papa_heartbeat`, and commit `public/assets/audio/papa_heartbeat.m4a`. A one-shot, no loop: `feedbackClips.ts` preloads it from the table. It does not stop early at a level end. Update the header comment of the tool.
20. **`instinct-vignette`.** `src/client/ui/hud/instinctVignette.ts` (`createInstinctVignette(doc)`, unit-tested): `element` and `update(isActive)`, writing the DOM only on a change (`pp-instinct-vignette-on`), allocation-free. `aria-hidden`, no focus, no input. CSS in `ui.css`:
    - `position: fixed; inset: 0; pointer-events: none`, `background: radial-gradient(ellipse at center, transparent 55%, var(--pp-color-vignette) 100%)`; the token already exists (`tokens.css` L23). **Never red, no other colour literal.**
    - A plain opacity fade of about 200 ms. It does not pulse: a steady darkening, nothing to clamp under the 3 Hz rule (`EXPERIENCE.md` L439), nothing to change for reduced motion.
    - **Layering:** z-index **4**, inserted right before `#pp-world` (`index.html` L26, z-index 5, `ui.css` L248), so it darkens the room only. In `#pp-hud` it would dim the verbs and the icons near the edges. Update the layers comment (`ui.css` L243).
21. **It follows state, per frame, never events** (as the silence, `boot.ts` L829-845): `instinctVignette.update(world !== undefined && world.instinct.state === 'active' && pause.state === 'running')`, beside `silenceBubble.update`. A pause, a restart or the end of the level can thus never leave it on.
22. **Mirror `data-pp-instinct`** (`isMirrored`, on events only, union L283, reset list L590): `on` at `InstinctTriggered`, then the `reason` of `InstinctEnded`.
23. **The music.** `feel.music.slowMo.belowScale` stays 1 (decision D5). No code change; close `deferred-work.md` L601.

### Headless and tools

24. **Report.** `instinctTriggers` per run and in the totals of `tools/sim/simReport.ts` (beside `comboCashIns`, L90, L257, L331, L443, L581, L666), a line in `SIM_HELP` (`simArgs.ts` L52), `tests/tools/sim/simReport.test.ts` follows. `debug/stateInspector.ts` L12 gains the instinct's state.
25. **On the real content** (`tests/bots/instinct.test.ts`): over seeds 1 to 20 of `salon_crawler`, `idle` triggers at least once and every `InstinctTriggered` has one end; `perfect` never triggers; at `experienced`, `idle` never triggers.

### e2e, goldens, docs

26. **`tests/e2e/instinct.spec.ts`** (Chromium and WebKit), through mirrors, `window.__PP__` and DOM attributes, no fixed sleep; the instinct comes from `__PP__.send({ type: 'ForceInstinct' })`:
    - `ppInstinct === 'on'`; the vignette has its class and a computed opacity above 0, its computed `background-image` holds `rgba(42, 33, 64, 0.35)` and not the dodge red `rgb(240, 53, 61)`; `state().time.scale` is 0.8.
    - `__PP__.cueLog()` holds `instinct_triggered` with the clip and the visual `uiElement`; the haptic pattern via `hapticPatternOfCue` where `navigator.vibrate` exists (WebKit has none).
    - A threat telegraphed during the instinct has a window of 390; `advance` past the end: `ppInstinct === 'timer'`, the vignette off, the scale back at 1.
    - Pause during the instinct: vignette off; resume: on again, the end unchanged in sim time.
    - The markers and the verbs stay above the vignette (`z-index` read from computed styles).
    - A seeded `experienced` save: `ForceInstinct` does nothing, no vignette.
    - The level ending during the instinct: `ppInstinct === 'levelEnded'`, no vignette on the Result screen.
    - `collectProblems` empty.
27. **Goldens.** `World.instinct` and `feel.instinct.returnMs` move `worldHash` and `feelHash`: `npm run golden:update`, deliberately. A scenario with several misses may now really trigger the instinct: **look at the diff of `eventTypes` per file** and say in the Completion Notes which ones gained `InstinctTriggered` and why (`threat_trio` is the likely one). All others: hash lines only. An existing sim or e2e test that now sees the instinct is fixed by understanding it (an assertion on `time.scale` during a chain of gags, say), **never by turning the instinct off in `testFeel.json`**.
28. **Bots, once:** `npm run sim -- --bot idle --runs 20`, `--bot random --runs 20`, `--bot human --runs 20` at `normal` and at `assistance`: report `instinctTriggers` in the Completion Notes beside the table of the open point 1.
29. **Docs.** `project-context.md`: a « Fatherly Instinct (story 2.9) » bullet with the rule, the frozen windows, the recharge from the end; snapshot version 20; `SetDifficultyTier` line (« must read » becomes « reads »). `deferred-work.md`, dated section: close L245, L601, L672, and add AC 30. `difficulty.ts` L8 comment stays true.
30. **Deferred, to record:**
    - The instinct is not in the journal's `summary`, so `playtest:metrics` does not count it (`client/telemetry/gameSummary.ts`). No indicator asks for it yet.
    - A real heartbeat recording replaces the placeholder (story 7.5).
    - The clip does not follow the slow-mo or stop at the level's end.
31. **Checks:** `env | grep VITE_` first. `ci:fast` after each task. Touched specs on Chromium: `instinct`, `feedback`, `timeEffects`, `juice`, `adaptiveMusic`, `timer`, `threat`, `testApi`, `debugOverlay`, `settings`, `calibration`, `combo`. `(unset VITE_DEBUG_ALLOWED; npm run ci)` once, green, before the review. Report `perf.spec.ts` beside 2.8's (p95 16.8 ms, 42 draw calls, 1526 triangles): the vignette is one full-screen DOM layer with a gradient, so look for a p95 regression.

## Tasks / Subtasks

- [x] **T1. Sim rule** (AC 1-5, 7-13): slice, snapshot 20, `recordMiss`, `runInstinct`, slow-mo source, window modifier, `judgeable`, `endInstinct`; tests first (AC 15).
- [x] **T2. Feel** (AC 6): `returnMs`, schemas, fixtures.
- [x] **T3. Debug and headless** (AC 14, 24, 25): `ForceInstinct`, cheat, inspector, report, real-content test.
- [x] **T4. Feedback** (AC 17-19): client event, cue, `heartbeat` haptic, clip.
- [x] **T5. Vignette and mirror** (AC 20-22).
- [x] **T6. e2e** (AC 26).
- [x] **T7. Goldens and docs** (AC 16, 27-30).
- [x] **T8. CI** (AC 31).

## Dev Notes

### Decisions

- **D1. `feel.instinct.returnMs` is added (300).** The epic and the GDD give no return, but `startSlowMo` takes one and the other three slow-mos all have 300. A snap from 0.8 to 1 would be heard in the music. `returnMs: 0` works if Geo prefers it (`slowMoFactorAt` handles it). The 4000 ms of the epic are the hold, and the bonus ends with the hold.
- **D2. The +30 % applies to windows telegraphed during the instinct, not to those already up.** The window is frozen at telegraph (the doc comment of `telegraphThreat`, `threatFsm.ts` L53-56: a window that moves while the player reads it would be unfair; pinned again by 2.8). `perfectMs` is centred, so growing an open window moves the notch the player is aiming at, and a press in flight changes meaning. Threats already on screen benefit from the ×0.8 alone. Rejected: re-freezing them at the trigger. See open point 2.
- **D3. `ForceInstinct` exists, though the epic does not ask for it.** On the live level the condition is rare and late (open point 1), and the golden rule says Geo tunes the feel: without it he could wait minutes to feel one instinct, and an e2e would need a full level. It costs one command, one cheat and one button. It respects `hasInstinct`, so the tier's promise stays visible in debug too.
- **D4. The cue goes through a client event.** The vignette is a UI element drawn from state, and the `contentChecks` guard says a sim event's cue cannot claim a `uiElement` twin. `NoiseAlertReached` set the pattern (story 3.1 D10). Weakening the guard or adding a visual kind are both refused. The epic's « `FeedbackDirector` handles `InstinctTriggered` » holds in effect: the routing is one line in boot's event loop, in the call that drains the event.
- **D5. The music keeps its slow-mo effect during the instinct.** `belowScale` 1 means low-pass and 80 % playback rate for the whole instinct. That matches what 2.6 D3 accepted, it clears room for the heartbeat, and it is one number for Geo to change live (open point 4). No code.
- **D6. Durations are sim ms** (ADR-002, the schema's slow-mo description): 4000 sim ms last 5 s of real time at ×0.8, longer with a perfect on top. The recharge is sim time too.
- **D7. A trigger empties `missAts`,** so a short `cooldownMs` tuned by Geo cannot fire twice on the same two misses.

### Current state of the files this story changes

- **`src/sim/threats/threatFsm.ts`**: `telegraphThreat` L57 freezes the window, with `instinct: NEUTRAL_WINDOW_MODIFIER` L69; `judgedWindow` L123 stays neutral (a timed-out silence was never telegraphed); `gagThreat` L192 is the single exit for every failure. Imports from `assist/` must not create a cycle: `paternalInstinct.ts` may import `time/slowMo.ts`, `timing/difficulty.ts`, `director/waveState.ts`, never `threatFsm.ts`.
- **`src/sim/time/slowMo.ts`**: `startSlowMo` and `updateTimeScale` already implement the overlap rule. Do not change them.
- **`src/sim/timing/effectiveWindow.ts`**: already has the `instinct` factor in its place. Do not change it.
- **`src/sim/flow/flowSystem.ts`** L16-23: `endLevel` closes the phone, then the silence; the instinct comes next, before `enterFlowState`.
- **`src/client/boot.ts`** (1678 lines): mirrors union L283, reset list L590, `mirrorSilenceEvent` L603 as the model, per-frame world reads L829-845, `NoiseAlertReached` L1034, `hudRoot.append(silenceBubble.element)` L1161.
- **`src/content/schemas/feedback.ts`**: `HapticsSchema` L54 is strict, so `heartbeat` is a required key; `feedback.json` must get it in the same commit.
- **`tests/e2e/calibration.spec.ts`** L279-281 and `support/game.ts` L52 already read `feel.instinct.timeScale`: a real instinct can already be accounted for in these bounds.

### Must not change

- `effectiveWindow`, `judgePress`, `startSlowMo`, `updateTimeScale`, the order of the existing systems.
- The values of FR20 in `feel.instinct` (0.8, 30, 4000, 30000, 3, 2, 10000).
- The `contentChecks` guard, `feedbackEquivalence.test.ts`, the CSP (no inline style: a class toggle), the save (no new setting), the stack.
- No hitstop, no combo change, no score change: the instinct does not touch Mama's note.

### Architecture compliance

- The sim never reads real time, never logs, never uses `Math.random`. `World` stays plain JSON. Zero allocation in `runInstinct` and `update(isActive)`: a counting loop over `world.threats`, no `filter`.
- Layers: `assist` is in `sim`; the client reads `world.instinct` through the `@sim` types only; `debug/cheats.ts` sends a command, never mutates the world. Units as suffixes (`untilAt`, `missAts`, `returnMs`). Event names in the past tense, command in the imperative, as asked.
- Only `sim/timing` holds the window order. CSS through tokens; `pp-` classes.

### Previous story intelligence

- **2.8:** `activeDifficulty` is the one reader, and its unit test pins the gate; a `World` field moves only hash lines unless behaviour changes; e2e specs seed through `calibratedSave(overrides, settings)`; `isSettingsDetour`: the vignette reads `pause.state`, so nothing more is needed there; a 2.8-style window is non-integer at some tiers (a centre on a half ms).
- **2.7:** Its CI flake came from assuming no slow-mo: bounds in specs are in sim ms and read `liveFeel.instinct.timeScale`.
- **4.2 / 4.3:** The models for a helper written at the source and a slice with one writer; both were merged after a snapshot bump by another story: **if another story merges first, take the next free version and add one comment line** (2.8 had to).
- **2.6:** State-driven client effects survive a pause or a restart; events are only for the mirror.
- **2.4:** `feedbackTwins.test.ts` and the `content:check` twin rules cover the new cue; `uiElement` is reported by the director with `played.visuals`.
- **1.14 D5:** The overlap rule; re-triggering a running source keeps `startedAt`, the slower scale and the later end.
- **1.21:** `isThreatActive` counts `hidden`, so with a silence not yet found the player may see only 2 threats on screen when the instinct fires. Accepted: the silence is one more thing going wrong.

### Git

Branch `story/2-9-instinct-paternel` in `.claude/worktrees/2-9-instinct-paternel`. Commit « Story 2.9 : instinct paternel », then « Story 2.9 : corrections de la revue de code ». Never on `main`. Recent commits (2.8 merged at 54222d9, snapshot at 19) touched `threatFsm`, `judgeable` and `snapshot`: expect no conflict from those unless 2.10 or an epic 3 / 4 story merges first.

### Web research

None needed: no new library, the stack is pinned, and `navigator.vibrate` with a pattern array is what `platform/web` already calls.

### Open points for Geo

1. **The instinct will be rare on the current level, if the numbers stay.** A one-off probe over 20 seeds of `salon_crawler` at the FR20 values, measured on 2026-10-30 before the instinct existed (it applied the rule from outside the sim, so no slow-mo or bonus feeds back; AC 28 gives the real numbers):

   | Bot | Instincts per game | Games with one | First trigger | Gags per game |
   |---|---|---|---|---|
   | `idle` (misses everything) | 0.30 | 6 / 20 | 123-175 s | 38 |
   | `random` | 0.30 | 5 / 20 | 122-170 s | 38 |
   | `human`, normal and assistance | 0 | 0 / 20 | none | 0.1 and 0 |
   | `perfect` | 0 | 0 / 20 | none | 0 |

   Cause: a miss takes the threat out of the active count, 3 active threats only exist in the last wave (`maxSimultaneous` 1, 2, 3), and the level has 4 threat defs. So even a player who misses everything usually gets no help. Built as FR20 says; `minActiveThreatsCount` and `missesWithinMs` are in the feel panel, and `feel.instinct` is the place to change them. Trying `minActiveThreatsCount: 2` while playing is the first thing to do. The `human` bot makes too few mistakes to say anything about a real player.
2. **Threats already on screen get the slow-mo, not the +30 %** (D2). Since the instinct fires when 3 are up, the wider windows reach only the next ones. To feel in play, with `ForceInstinct`.
3. **Trigger to trigger is 34 s** (recharge from the end, as the epic's second criterion and the schema say; FR20's « once every 30 s » read from the start would be 30). Change `cooldownMs` to 26000 if you meant 30 s between starts.
4. **The music dips during the whole instinct** (D5): about 5 s of low-pass at 80 % speed. « Discreet » may call for less: set `feel.music.slowMo.belowScale` to 0.7 to keep it for the big slow-mos only.
5. **`returnMs` 300 and `ForceInstinct`** are additions to the epic (D1, D3). Say if you would rather not have them.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.9], L53 (FR20), L119 (FR55), L244 (UX-DR15), #Story 2.8 (AC 4), #Story 2.10
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] L184, L209, L214, L362-374
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L209, L223, L230, L494, L587, L840, L956
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L21, L258-260, L388, L543, L554; [EXPERIENCE.md] L220, L301, L427-439
- [Source: _bmad-output/project-context.md] › Simulation core, › Time & input judgement, › Feedback, › Testing Rules
- [Source: _bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md] D5, L237; [2-6-musique-adaptative-de-base.md] D3, open point 3; [2-8-paliers-de-difficulte-et-reglages.md] AC 5, AC 34
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L245, L601, L672

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Debug Log References

- Gag timing of the test threats: an unanswered outlet gags 1570 ms after its telegraph (1200 delay + 300 window + 60 tolerance, judged at the next step); the frozen stairs gag 1570 ms after theirs too but its delay is 1000 ms, so in the `instinct` golden the stairs (forced at 200) gag at 1570 and the outlet (forced at 100) at 1670.
- First draft of the `instinct` golden used the director (6 threats, gap 450 ms): the baby's lock-on made the draws irregular and the instinct only triggered at 8930 with no window drawn during it. Replaced by `ForceThreat` actions on a far-away wave (the misses are still real gags): trigger at 1670, end at 5670, threat 6 judged against 390.
- `console.log` is silenced in the Vitest run; timelines were dumped to a scratch file instead (temporary test removed).

### Completion Notes List

- **The rule** (`src/sim/assist/paternalInstinct.ts`): `runInstinct` between `runGauges` and `runScoring`; `enterInstinctState` is the only writer; `recordMiss` is called by `gagThreat` beside `resetCombo`; `instinctWindowModifier` feeds `telegraphThreat` and `isJudgeableBeforeEnd`; `endInstinct` is called by `endLevel` after `endSilence`. `World.instinct`, `INSTINCT_STATES`, slow-mo source `instinct`, events `InstinctTriggered` / `InstinctEnded`, command `ForceInstinct`, snapshot **version 20** with an `instinctProblem` validator. No `world.rng` draw (a test compares the rng state).
- **Feel**: `feel.instinct.returnMs` = 300 (D1) in `content/feel.json`, the test fixtures and the schema; `npm run content:schemas` run. No other value of `feel.instinct` moved.
- **Feedback**: client event `InstinctVignetteShown` (boot sends it on `InstinctTriggered`), cue `instinct_triggered` (clip `papa_heartbeat`, `uiElement`, haptic `heartbeat`), new haptic kind `heartbeat` `[30, 90, 30]` (`HAPTIC_KINDS`, `HapticsSchema`, `platform.ts`, `webHaptics.ts`, boot's pattern table), `synthHeartbeat` + `papa_heartbeat.m4a` generated alone with `--only papa_heartbeat`.
- **Vignette**: `createInstinctVignette`, class toggle only, z-index 4 right before `#pp-world`, the `--pp-color-vignette` token, 200 ms fade; driven per frame from `world.instinct.state` and `pause.state`. Mirror `data-pp-instinct` (`on`, then the end reason). `feel.music.slowMo.belowScale` left at 1 (D5).
- **Debug and headless**: `forceInstinct` cheat + « Instinct » button beside « Launch »; `summarizeWorld` gets an `instinct <state> … · misses <n>` line (the 4th line, so the per-threat lines moved to index 4) and the inspector a `instinct` slice block; `instinctTriggers` in the sim report (per run, totals, `SIM_HELP`).
- **Tests added**: `paternalInstinct.test.ts` (66 tests: misses, trigger conditions strict at 9990/10000, late third threat, length, recharge 29 990 / 30 000, windows 390 / 585 / 312 / 225, frozen windows, `isJudgeableBeforeEnd` boundary, overlap with `perfect` / `lastThreat` / `comboCashIn`, level end, `SetFeel`, `ForceInstinct`, snapshot round trips and refusals), `instinctVignette.test.ts`, `tests/bots/instinct.test.ts` (seeds 1-20 of the real `salon_crawler`), `tests/golden/instinct.test.ts` + scenario `instinct`, `tests/e2e/instinct.spec.ts` (7 tests, Chromium and WebKit), a debug overlay e2e for the button, synth tests, report tests; the pinned system order, command list and snapshot version tests follow.
- **Goldens (AC 27), regenerated deliberately with `npm run golden:update`**: `World.instinct` and `feel.instinct.returnMs` moved `worldHash` / `feelHash` in every file. **No existing scenario gained an `InstinctTriggered`** (`threat_trio` included: `eventTypes` and `eventsHash` are unchanged in all of them; the diff of the 12 existing files is hash lines only). The only new golden is `instinct`.
- **AC 28, 20 games of `salon_crawler` per row** (seeds 1-20, FR20 values), `instinctTriggers` over the 20 games / gags per game:

  | Bot | Tier | Instincts in 20 games | Per game | Gags per game |
  |---|---|---|---|---|
  | `idle` | normal | 6 | 0.30 | 38.1 |
  | `idle` | assistance | 8 | 0.40 | 37.75 |
  | `random` | normal | 6 | 0.30 | 37.95 |
  | `random` | assistance | 7 | 0.35 | 38 |
  | `human` | normal | 0 | 0 | 0.05 |
  | `human` | assistance | 0 | 0 | 0 |

  It matches the probe of open point 1 (0.30 per game for `idle` and `random`, none for `human`): the instinct is rare on the current level, as built from FR20. The report does not list a trigger per game in `runList`, so « games with one » is not given.
- **Checks**: `npm run ci:fast` green after each task; touched specs on Chromium (`debugOverlay`, `feedback`, `timeEffects`, `juice`, `adaptiveMusic`, `timer`, `threat`, `testApi`, `settings`, `calibration`, `combo`) green; `(unset VITE_DEBUG_ALLOWED; npm run ci)` green once (543 e2e on both browsers, 10 e2e:dist, `perf.spec.ts`). **Perf of the built playtest, a whole level at speed 1: p95 frame 16.7 ms, max 43 draw calls, max 1538 triangles** (2.8: 16.8 ms, 42, 1526): no regression from the full-screen vignette layer.
- **Not done / left to Geo**: how the instinct feels (rarity, the music dip, the 34 s trigger-to-trigger, windows not widened for threats already up) is the open points 1-5 of the Dev Notes; `ForceInstinct` and `returnMs` are the additions of D1 and D3. The `ppInstinct` mirror is behind `isMirrored` and is not in `PROD_FORBIDDEN_MARKERS` (the AC did not ask).
- Deferred items recorded in `deferred-work.md` (« Story 2-9-instinct-paternel » section) and L245, L601, L672 closed.

### Change Log

- 2026-10-30: Story 2.9 implemented: Fatherly Instinct (sim rule, snapshot 20, `ForceInstinct`, heartbeat cue and haptic, vignette, mirror, report, tests, goldens, docs). Status set to review.

### File List

New:

- `src/sim/assist/paternalInstinct.ts`, `src/sim/assist/paternalInstinct.test.ts`
- `src/client/ui/hud/instinctVignette.ts`, `src/client/ui/hud/instinctVignette.test.ts`
- `tests/bots/instinct.test.ts`, `tests/e2e/instinct.spec.ts`, `tests/golden/instinct.test.ts`
- `tests/golden/journals/instinct.json`, `tests/golden/journals/instinct.expected.json`
- `public/assets/audio/papa_heartbeat.m4a`

Modified:

- Sim: `src/sim/world.ts`, `src/sim/events.ts`, `src/sim/commands.ts`, `src/sim/step.ts`, `src/sim/snapshot.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/threats/judgeable.ts`, `src/shared/constants.ts`
- Sim tests: `src/sim/commands.test.ts`, `src/sim/step.test.ts`, `src/sim/snapshot.test.ts`, `src/sim/gauges/gaugesSystem.test.ts`, `src/sim/threats/inputLag.test.ts`
- Content: `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`, `content/feel.json`, `content/feedback.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`
- Client and platform: `src/client/boot.ts`, `src/client/feedback/feedbackEvents.ts`, `src/client/ui/styles/ui.css`, `src/platform/platform.ts`, `src/platform/web/webHaptics.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/platform/createPlatform.test.ts`, `src/platform/web/webHaptics.test.ts`
- Debug: `src/debug/cheats.ts`, `src/debug/debugOverlay.ts`, `src/debug/stateInspector.ts`, `src/debug/cheats.test.ts`, `src/debug/debugViews.test.ts`
- Tools: `tools/audio/makePlaceholderAudio.ts`, `tools/sim/simReport.ts`, `tools/sim/simArgs.ts`
- Tests and fixtures: `tests/support/testFeel.json`, `tests/support/testContent.ts`, `tests/tools/vite/fixtures/feelSample.json`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/e2e/support/game.ts`, `tests/e2e/debugOverlay.spec.ts`, `tests/golden/scenarios.ts`, `tests/golden/journals/*.json` (hash lines only, except the new `instinct`)
- Docs: `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file
