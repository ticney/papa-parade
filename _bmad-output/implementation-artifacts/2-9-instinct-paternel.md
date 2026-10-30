# Story 2.9: Fatherly Instinct

Status: ready-for-dev

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

- [ ] **T1. Sim rule** (AC 1-5, 7-13): slice, snapshot 20, `recordMiss`, `runInstinct`, slow-mo source, window modifier, `judgeable`, `endInstinct`; tests first (AC 15).
- [ ] **T2. Feel** (AC 6): `returnMs`, schemas, fixtures.
- [ ] **T3. Debug and headless** (AC 14, 24, 25): `ForceInstinct`, cheat, inspector, report, real-content test.
- [ ] **T4. Feedback** (AC 17-19): client event, cue, `heartbeat` haptic, clip.
- [ ] **T5. Vignette and mirror** (AC 20-22).
- [ ] **T6. e2e** (AC 26).
- [ ] **T7. Goldens and docs** (AC 16, 27-30).
- [ ] **T8. CI** (AC 31).

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
