---
baseline_commit: 714d3c000d4834d0845d9d8149262cebc85d499a
---

# Story 4.6: The bedtime duel (the Wait response)

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.6 « Duel du coucher (réponse Attendre) » (L1932-1956). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to stand still before the bed and leave at the exact instant the baby closes his eyes,
so that I live a duel of patience in the style of Ghost of Tsushima.

**Requirements covered:**
- **FR5 (`Attendre`):** no action until the signal, then a tap; 300 ms after the signal; a press before it is always a gag (GDD L135, architecture L743-744).
- **FR40 `[P2]` (third step of the bedtime cycle):** « Immobile face au lit, papa doit partir à l'instant où le bébé ferme les yeux. Trop tôt, il les rouvre » (GDD L305).

**What this story is not:**
- **No feint and no false signal.** That is 4.7 (`fake_sleep.json`). Do not add a feint key or a « half-open eye » state.
- **No sequence in normal play.** As in 4.4 and 4.5, it starts from the debug overlay, `__PP__.send` or the sim CLI; 4.10 chains the cycle and brings the bed.
- **Papa does not walk away.** 4.4's D3 stands until 4.9: « papa part » is a cue on the spot (D9, open point 2).
- **No asleep state on the baby.** Eyes open and closed are read from the threat's state, not from `baby.state` (D8).
- **No `nothing` response** (4.9), no `HoldAnywhere`, no new command. **No new dependency, no new top-level folder.**

**Sources:**
- Epics `epics.md` L1807-1809, L1932-1956, L1958-1978 (4.7 builds on this), L1994-1996 (4.8 also « recule »), L2041-2045 (4.10).
- GDD `gdd.md` L135, L149-151, L198 (no ring on Attendre), L216, L297-308.
- Architecture `game-architecture.md` L222, L497 (`bedtimeDuel.ts`), L738-744 (P2), L967.
- UX `DESIGN.md` L527-528; `EXPERIENCE.md` L124, L208-209.
- Previous stories: `4-5-les-100-pas-en-rythme.md` and `4-4-…md` (read both, including the reviews), `1-23` (a response added to the threat FSM, the bots' finger), `4-1` (a threat spawned on Papa).

## Acceptance Criteria

Numbers in `content/` are live starting values for Geo to tune. Tests use frozen `tests/support/` files, never the live ones.

### The generic `wait` response (usable by any threat, on an anchor too)

1. **Schema** (`src/content/schemas/threat.ts`, every key with a `.describe()`, then `npm run content:schemas`). `THREAT_RESPONSES` gains `wait`; its comment and the one above the `iconShape` rule are updated. New keys, **required on a `wait` def and refused elsewhere**, with the `holdUntilMs` pattern in the `superRefine` (one message per path):
   - `minDelayMs`, `maxDelayMs`: `.int().positive()`, `minDelayMs <= maxDelayMs`. From the end of `telegraphDelayMs` to the signal, in sim ms.
   - `signalVerbKey`: a `verb.` key, shown from the signal on. `signalIcon`: a `ThreatIcon`, the glyph from the signal on.
   - `feedback.signal`: a cue id, the signal's cue. Optional in `FeedbackCuesSchema`, then required on `wait` and refused elsewhere.

   `THREAT_ICONS` gains `eyes` (an open eye, with its path in `THREAT_ICON_PATHS`, a compile error otherwise). `tests/content/threatSchema.test.ts` L66 uses `wait` as « a response the sim cannot judge yet »: move it to `nothing`.

2. **The signal** (`threatFsm.ts`, D1). No new state. `telegraphThreat`, for a `wait` def only, draws **exactly one `nextFloat`** and sets `windowOpenAt = Math.round(now + telegraphDelay + minDelayMs + draw × (maxDelayMs − minDelayMs))`. **Any other def draws nothing**, so no existing journal moves. `openWindow`, for a `wait` def, pushes `WaitSignalGiven{t, threatId}` **then** `WindowOpened`, at the same `t`. Add it to `SIM_EVENT_TYPES` (sorted). The window is the usual one: `def.windowMs ?? feel.timing.windowMs` (300 ms) through `effectiveWindow`, frozen at the telegraph.

3. **`isJudgeableBeforeEnd`** adds `def.maxDelayMs ?? 0` to its sum. A `wait` threat never telegraphs if its latest signal could not be judged before the end.

4. **Judgement** (`threatSystem.ts`, D2, D3):
   - **Before the signal.** In `pressThreat`, for a `wait` def, `t < threat.windowOpenAt` is `gagThreat(…, 'early', judgement.offsetMs)`, checked **before** the existing `judgement.quality` branches. **Whatever `feel.input.earlyPress` says, with no buffer and no tolerance before the signal.** The judgement is on the press's own `t`: a press stamped before the signal that reaches the sim after it is still early.
   - **From the signal on:** `judgePress` as usual, centred on the window (`perfect`, `success`, `late` after the window plus the tolerance).
   - **The trap at L126:** `kind === def.response` compares `'parry' | 'firm'` with `'wait'`, typechecks, and would make every tap a `wrongResponse`. Add `pressKindOf(response)` next to `classifyPress` (`wait` → `parry`, the others themselves), and compare with it. A press held `holdMinMs` on a `wait` threat is `wrongResponse`, the same rule as a Parry (ADR-010).
   - `ResponseResolved.response` stays `wait`. The expiry (`late`, `offsetMs: null`) is unchanged and follows `lagMs`.

5. **Client: nothing shows the time left** (GDD L198, pillar 1). There is no chrono ring in the code today: do not add one, and draw nothing from `windowOpenAt` before the signal. `threatMarkers.ts`:
   - `ThreatMarkerDef` and `ThreatMarkerEntry` gain optional `signalVerb` (translated at build) and `signalIcon`.
   - `update` swaps the verb text and the glyph's `d`, and toggles a `pp-threat--signal` class, on `threat.state === 'windowOpen'`, written only when it changes, with a `refit` as for `carriedVerb`. The marker keeps a ref to the glyph's path. Reduced motion keeps the swap (it is the information) and drops any animation of the class.
   - Shape, colour and text all change or stay as a set: the signal is the **glyph and the verb**, never the colour alone (NFR8). Tokens only.
   - A unit test: before the signal, two instances whose `windowOpenAt` differ write the same DOM.

6. **Feedback.**
   - `threatFeedback.ts`: `threatCueOf` gains `WaitSignalGiven` → `feedback.signal`.
   - `strings.fr.json`: `"verb.wait": "ATTENDS…"`, `"verb.go": "FILE !"`.
   - `tools/content/contentChecks.ts`: `feedback.signal` must be a cue of `feedback.json`, with `audio`, `visual` and `haptic`, one failing test each.

### The duel

7. **Content.** New `content/threats/bedtime_eyes.json`:

   ```json
   {
     "$schema": "../_schemas/threat.schema.json",
     "id": "bedtime_eyes",
     "target": "papa",
     "response": "wait",
     "telegraphDelayMs": 800,
     "minDelayMs": 2000,
     "maxDelayMs": 6000,
     "windowMs": null,
     "gag": "baby_eyes_reopened",
     "verbKey": "verb.wait",
     "signalVerbKey": "verb.go",
     "icon": "eyes",
     "signalIcon": "eyelids",
     "iconShape": "circle",
     "color": "parry",
     "feedback": {
       "telegraph": "tel_bedtime_eyes",
       "signal": "bedtime_eyes_closed",
       "success": "resp_wait",
       "perfect": "resp_wait_perfect",
       "gag": "gag_baby_eyes_reopened"
     },
     "cooldownMs": 600
   }
   ```

   New `content/sequences/bedtime_duel.json`:

   ```json
   {
     "$schema": "../_schemas/sequence.schema.json",
     "id": "bedtime_duel",
     "babyCarried": true,
     "steps": [
       { "kind": "duel", "durationMs": 9000, "threatDef": "bedtime_eyes", "restMs": 1200 },
       { "kind": "duel", "durationMs": 9000, "threatDef": "bedtime_eyes", "restMs": 1200 },
       { "kind": "duel", "durationMs": 9000, "threatDef": "bedtime_eyes", "restMs": 1200 }
     ],
     "success": { "kind": "stepsDone" },
     "failure": { "kind": "retreats", "maxRetreats": 3 },
     "framing": {
       "camera": { "zoomPct": 28, "focusPct": 70, "inMs": 1200, "outMs": 700 },
       "musicLoop": "bedtime_duel",
       "bar": null
     },
     "feedback": { "started": "sequence_started", "succeeded": "sequence_succeeded", "failed": "sequence_failed" }
   }
   ```

   `content/levels/salon_crawler.json`: `"sequences": ["stay_awake", "lullaby_walk", "bedtime_duel"]`.

8. **Sequence schema** (`src/content/schemas/sequence.ts`). `SEQUENCE_STEP_KINDS` gains `duel`; `SEQUENCE_FAILURE_KINDS` gains `retreats` with `maxRetreats` (`.int().positive()`). In the `superRefine`, in the style of the beats rules:
   - a def with a `duel` step has `failure.kind === 'retreats'`, and a `retreats` def has a `duel` step;
   - **every step of a `retreats` def is a `duel`** (a step back into a timed step has no meaning yet; 4.8 lifts this for its own kind);
   - a `timeLeft` bar on a `retreats` def is refused: its `endsAt` is only an estimate (AC 10). `null` is the shipped choice (D7).

   `durationMs` on a `duel` step is described as « the longest a round of this step can take », and AC 13 proves it.

9. **`feedback.json`:** cues `tel_bedtime_eyes` (a `tel_*` clip no other telegraph shares, haptic `light`), `bedtime_eyes_closed` (clip `baby_eyes_close`, a `soundWave` on `threat`, haptic `medium`), `resp_wait` and `resp_wait_perfect` (clip `resp_wait`, the laugh layer, `flash` and haptic `heavy` on the perfect, following `resp_parry_perfect`; `content:check` pins these), `gag_baby_eyes_reopened` (haptic `heavy`, `fx: "gag"`). `loops.sequenceMusic.bedtime_duel`: `music_bedtime_hush`, a very quiet drone **with no pulse** (a pulse would suggest a rhythm to read). Placeholder clips `tel_bedtime_eyes`, `resp_wait`, `baby_eyes_close`, `gag_baby_eyes_reopened`, `music_bedtime_hush` in `PLACEHOLDER_CLIPS`, each with its own free seed (**read `cultSounds.ts` and every `SEED +` first**; 26 is the highest in `makePlaceholderAudio.ts`). `npm run assets:audio -- --only …` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB). `tests/tools/audio/makePlaceholderAudio.test.ts` lists the new clip names, as it does the lullaby's.

10. **Steps that advance on a result, not on time** (`sequenceSteps.ts`, `sequenceSystem.ts`, `sequenceEnd.ts`). This is the engine change 4.8 reuses: keep it generic.
    - `StepHandler` gains `readonly isTimed: boolean`; `microSleeps` and `beats` are `true`, `duel` `false`. The `while` in `runSequence` only runs while the **current** step `isTimed` (export `isSequenceStepTimed(step)`). Today's two kinds behave exactly as before.
    - `SequenceSlice` gains `duel: { isRunning: boolean; nextRoundAt: SimMs | null; retreats: number }`, with `createDuelSlice` and `clearDuelSlice` beside the beat's. Cleared by `startSequence` and `closeSequence`. **Not** cleared on a step change: `retreats` runs for the whole sequence. Export `isDuelStepRunning(world)` from `@sim`.
    - New helper in `sequenceEnd.ts`, which still imports no threat code and **not `sequenceSteps.ts`** (a cycle: `sequenceSteps` → `threatFsm` → `sequenceEnd`): `goToSequenceStep(world, ctx, def, index)` writes `stepIndex`, `stepEndsAt = now + step.durationMs`, `endsAt = stepEndsAt + the durations of the later steps`, `duel.nextRoundAt = now + step.restMs`, and pushes `SequenceStepStarted`. So `startedAt ≤ stepEndsAt ≤ endsAt` holds for the snapshot, and `endsAt` is an estimate that nothing but those checks reads.
    - The end test still reads `isSettled`, and `duel`'s is always `false`: **the existing rule « at `endsAt` and settled, the sequence is won » must never win a duel by waiting.** Only AC 12 wins it.

11. **The handler** (`src/sim/sequences/bedtimeDuel.ts`, the architecture's file; `DUEL_HANDLER`, plugged into `HANDLERS`). `enter`: `isRunning = true`, `nextRoundAt = now + step.restMs`. `tick`, allocation-free: return unless `nextRoundAt` is due, the instance is `idle` (it may still be in its cooldown) and `isJudgeableBeforeEnd(world, ctx, def, now)` holds **for the level's end**, then `telegraphThreat(world, ctx, threat, def, -1)` and `nextRoundAt = null`. No check against the sequence's `endsAt`. No other draw than the telegraph's.

12. **Results** (D5). Two hooks, both last in their function, both no-ops outside a `retreats` sequence and for any threat other than the current step's:
    - `resolveThreat` calls `advanceSequenceOnResolve(world, ctx, threat)`. Not the last step: `goToSequenceStep(next)`. The last step: `succeedSequence`. The baby stays carried.
    - `gagThreat` passes its `threat` and its `reason` to `failSequenceOnGag` (its only caller), which for a `retreats` failure: `retreats += 1`. Below `maxRetreats`: `SequenceStepRetreated{t, id, fromStepIndex, stepIndex, retreats, reason}`, then `goToSequenceStep(max(0, stepIndex − 1))`. At `maxRetreats`: `SequenceStepRetreated` is **not** emitted, `BabyWoke`, then `failSequence`. The `gag` kind (`stay_awake`) and `babyAwake` (`lullaby_walk`) are unchanged.
    - A retreat at step 0 stays at step 0 and still counts.
    - **Every gag retreats:** `early`, `late` and `wrongResponse` alike (D4).
    - No noise and no cry (`gagCryMs` absent, D6). The usual costs of a gag apply: combo reset, `recordMiss`. A success counts as a response for the combo and the perfects, as a micro-sleep does. Its hitstop and perfect slow-mo apply.

13. **New gag and validation.**
    - `GAG_IDS` gains `baby_eyes_reopened` (an empty consequence in `GAG_CONSEQUENCES`), all flags false in `GAG_PRESENTATIONS`.
    - `sequenceDuelProblems(def, threatDefs, limits)`, pure, in `bedtimeDuel.ts`, **no zod and no `@content` runtime import**, shared by `content:check` and `simLevelOf` with the same words, as `sequenceBeatProblems` is. It refuses: a `threatDef` that is not loaded; one whose `response` is not `wait`; one whose `target` is not `papa`; a `durationMs` below `restMs + telegraphDelay + maxDelayMs + window × the widest tier + toleranceMs`; a `papa_asleep` gag. One failing test each in `tests/content/` and in `sequenceLevel.test.ts`.
    - The wave rule's wording « only the sim spawns it (gauges.fatigue.microSleepDef or carry.armsCryDef) » gains « or a sequence's duel step », in `createSim.ts` and `contentChecks.ts` L855 alike, and in any test that matches it.

14. **Loading and the level** (two traps).
    - **`loadLevelContent.ts` reads the threats before the sequences**, so a duel's `threatDef` is never loaded. After the sequences are parsed, load each distinct `threatDef` through the same code path (factor it out rather than copying it), reporting a missing file at the sequence's `steps[j].threatDef`. Update the function's doc. `tests/content/loadLevelContent.test.ts` covers it. `createTestLevel` (`tests/support/testContent.ts`) does the same for `sequenceDefs`.
    - **`simLevelOf` computes `armsCryIndex` as `threats.length - 1` in its `return`** (`createSim.ts`). Pushing duel threats after the cry would silently point it at the wrong instance. Capture it right after the cry's push, and push the duel threats after that (`anchorId: PAPA_TARGET_ANCHOR_ID`, `firstWaveIndex: -1`, `zone: null`), one instance per distinct def. `SimSequence` gains `duelThreatIndexes: readonly (number | null)[]`, index-aligned with `def.steps`, derived and **not in the snapshot**. A test pins `microSleepIndex` and `armsCryIndex` on a level that has all three.

15. **Snapshot v23** (`snapshot.ts` L43, L62, L1122 and the history comment; a parallel story may bump it too, look before merging). `sequenceProblem` gains: `duel` all clear when `id` is null; `isRunning` true exactly when the current step is a `duel`; `nextRoundAt` null or finite and ≥ 0; `retreats` a whole number in `[0, maxRetreats)`, 0 outside a `retreats` def. Fixtures, each rejected field, and a round trip **with something in flight**: in a rest, before a signal (the drawn `windowOpenAt` must survive), in an open window and after a retreat with `retreats` above 0, each continued to the end on both copies with the hashes compared (4.4's and 4.5's reviews).

### The client

16. **Input** (`inputMapper.ts`, D10). In `handlePointerDown`'s `isHeldInPlace` branch, after the existing threat pick, which stays first: when `isDuelStepRunning(world)` and `targetNow(active)` is not null, send the same press as a pick does (`heldPressAt`, `PressThreat`, `press.pressed`, `onThreatPressed`), so that its `Release` follows. **A finger anywhere on the screen is the press.** With no threat up (a rest, between rounds), it is dropped and free. Space and A already reach the threat through `act`. `isBeatStepRunning`'s branch is unchanged. The HUD's pause button must still pause: pin it in the e2e.

17. **Sound** (`boot.ts` L1000). `audio.setBabbling` also requires `!isDuelStepRunning(world)`: `takeBaby` sets `baby.babbling = true`, and a baby babbling through the duel covers the signal and contradicts it. State, every frame, so a restart or a level end needs no code. The sequence music comes through the existing `setSequenceMusic` path with no change.

18. **Mirrors** (dev and `?debug=1`, on events, in the clearing list at level start and at `SequenceStarted`, added to `PROD_FORBIDDEN_MARKERS` in `tools/build/inspectDist.ts`): `data-pp-sequence-step`, `data-pp-sequence-retreats`.

### Tools and tests

19. **Bots: the golden rule.** Bots read through `@sim`, never `@content`.
    - `threatTiming.ts`: `fingerPlanFor` gains `case 'wait'` (a tap, `tapMs`); the `never` makes this a compile error until done.
    - `perfect`: unchanged code, it presses at `centreOf(threat)`, reading the drawn `windowOpenAt`. It is a bot that knows the answer: say so in a comment. **Offset 0, so `perfect`.**
    - `human`: **cannot plan before it sees the signal.** For a `wait` threat, `continue` while `threat.state !== 'windowOpen'`, **before** `cycles.isNew` (or the telegraph uses up the cycle). It presses at `max(now, round(windowOpenAt + reactionMs + aimOffsetMs + jitterSdMs × N(0, 1)))`: a reaction, not an aim at the centre, so the jitter is on the reaction and it can be late. Other responses keep exactly their draws and formula, or the salon's report moves.
    - `random`: nothing to add; it presses threats. `idle`: nothing, so every round is late and it loses.
    - `simReport.ts`: `sequenceRetreats` per run and in the aggregate, counting `SequenceStepRetreated` (so the failure that ends the sequence is not one: `outcome` says it).

20. **The generated tests** (`tests/threats/threatCatalog.test.ts`, the epic's last AC). `bedtime_eyes` and a new anchored fixture `tests/threats/fixtures/test_wait.json` both run the set at each tier:
    - `answerOf` gains `case 'wait'` (a tap, as `parry`); « proves both responses » becomes parry, firm and wait.
    - A def named by a live sequence's `duel` step counts as planned (`spawnedOnPapa`). `telegraphed` reaches it by `StartSequence` on a level whose `sequences` holds a one-step def with a `carry`; the fixture goes through the wave path at `door`.
    - **For a `wait` def:** « a success as the window opens » presses at exactly `openAt`, not `openAt − tolerance`; « too early » presses at `openAt − 1`, and again at `openAt − tolerance − buffer − 1`; and with `earlyPress: 'guard'`, both are still `early` gags. « Too late » and « perfect » run as they are.
    - The `parry` block's « held `holdMinMs` is a wrongResponse » also runs for `wait`, and `WaitSignalGiven` comes once, right before `WindowOpened`.

21. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `threatFsm` / `threatSystem`: exactly one `nextFloat` per `wait` telegraph and none for a `parry` (the rng state before and after); `windowOpenAt` inside its range at both ends of the draw, and whole; a press stamped before the signal reaching the sim after it is `early`; a window through the tier and through fatigue; `isJudgeableBeforeEnd` with `maxDelayMs`.
    - `bedtimeDuel.test.ts`, on a frozen def (`tests/support/testBedtimeDuel.sequence.json`, `testBedtimeEyes.threat.json`): the full event order of a won duel; an early press, a late press and a hold each retreat; a retreat at step 0 stays there and counts; the last allowed failure ends it (`BabyWoke`, `SequenceEnded{failed}`, flow back to `playing`, baby carried, the resume gap); **waiting past `endsAt` never wins**; a retreat restarts the rest and a new draw; `retreats` is not reset by a step change; no noise; a level end mid-round closes it (`levelEnded`); no round is telegraphed if it could not be judged before the level's end; a press during a rest changes nothing; `stay_awake` and `lullaby_walk` are untouched (their tests stay green unedited).
    - `sequenceSystem.test.ts`, `snapshot`, `events`, `carryFuzz` or a 30-seed fuzz of random presses (`retreats` in range, no invariant fires), `sequenceSchema`, `threatSchema`, `checkSequences`, `feedbackClips`, `threatFeedback`.
    - Client: `threatMarkers.test.ts` (the swap, once per change; AC 5's no-leak test), `inputMapper.test.ts` (tap anywhere, Space, A, the `Release`, free in a rest, a threat pick still first). `worldUi.test.ts` indices shift only if an element joins a scene.
    - Bots: `human` never presses before the signal over many seeds, and `tests/bots/` pins that its draws on a `parry` are unchanged.
    - `src/sim` coverage stays at or above 90 %.

22. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: `perfect`, `human` and `idle` have identical stars, end reasons, success rate, score and gags; only hashes move. **`random` will move, and that is expected:** the level has one more threat instance and it draws `nextInt(rng, 0, world.threats.length)`. **Prove the cause:** on the branch, take `bedtime_duel` out of the level's `sequences` temporarily, rerun `random`, and show it matches `main`; then restore it. **Paste both tables.**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20 --sequence bedtime_duel --sequence-at-ms 5000`: `perfect` wins 20 of 20 with no retreat and every response `perfect`; `idle` loses 20 of 20 on its third round; `human` and `random`, say what they do. **Paste the table.** `tests/tools/sim/sequence.test.ts` pins `perfect` and `idle` over seeds 1 to 5. If `human` loses often, that is a finding for Geo, not something to tune away silently.
    - `npm run golden:update`, then diff, then `biome format` the JSON: every existing journal moves **only** in its hashes. Anything else is a bug, stop.
    - New scenarios `bedtime_duel_won` and `bedtime_duel_retreated` (`tests/golden/scenarios.ts`, the frozen def, a test file like `lullabyWalk.test.ts`). Whole-ms stamps only.

23. **End to end** (`tests/e2e/bedtimeDuel.spec.ts`, chromium + webkit, like `lullaby.spec.ts`: `openFrozen`, real taps, values from the live content and from `windowOpenAt` read through `__PP__`):
    - The overlay's « Start »: `data-pp-sequence="bedtime_duel"`, no bar and no compact timer, the level stems off, the hush on, the babble off (`data-pp-…` mirrors already exist for these).
    - A real tap before the signal: `gag_baby_eyes_reopened` in `__PP__.cueLog()`, `data-pp-sequence-retreats="1"`, step unchanged at 0.
    - A real tap after the signal, far from the marker: `resp_wait`, `data-pp-sequence-step="1"`. Then a retreat from step 1 goes to 0. Space works too.
    - The signal's cue in `cueLog`, and in Chromium its vibration pattern (WebKit has no `navigator.vibrate`).
    - A tap on the pause button pauses and costs nothing, and the wait resumes on the same `windowOpenAt`.
    - Doing nothing: `baby_woke`, `sequence_failed`, `data-pp-sequence-outcome="failed"`, the baby still carried.
    - `?autoplay=perfect`, started by `__PP__.send`, waiting first for `data-pp-sequence="bedtime_duel"` (4.5's review): `outcome` `succeeded`.
    - The marker before and after the signal, **screenshot at 667 × 375, looked at**, and under reduced motion. With the `sfx` volume at 0, the marker swap and the vibration still come. No screenshot reference should move: if one does, find out why before regenerating anything.

24. **Docs.**
    - `project-context.md`: a « The Wait response and the bedtime duel (story 4.6) » paragraph (the one draw at the telegraph, `WaitSignalGiven`, the strict early rule, `pressKindOf`, untimed steps and `goToSequenceStep`, the two hooks, `retreats`), `snapshot version 23`, and the three places that say « snapshot version 22 ».
    - `deferred-work.md`: this story's open points; mark L204 (bots and `wait`) and L514 (`resp_wait`) as resolved for `wait`.
    - Do not edit the architecture or the GDD.

25. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [x] **T1. The `wait` response** (AC 1-4, 6, 20, part of 21)
  - [x] T1.1 Schema, icon, `pressKindOf`, strings, `content:schemas`, the `threatSchema` test.
  - [x] T1.2 The draw, `WaitSignalGiven`, `isJudgeableBeforeEnd`, the strict early rule, `threatCueOf`.
  - [x] T1.3 `fingerPlanFor`; the catalogue's `wait` set on the anchored fixture **before any duel code**.
- [x] **T2. The duel in the sim** (AC 7-15)
  - [x] T2.1 Sequence schema, `bedtime_eyes.json`, `bedtime_duel.json`, the gag, the level, `feedback.json`, the clips.
  - [x] T2.2 `loadLevelContent`, `simLevelOf` (`armsCryIndex`, `duelThreatIndexes`), `sequenceDuelProblems`, `content:check`.
  - [x] T2.3 `isTimed`, the slice, `goToSequenceStep`, `bedtimeDuel.ts`, the two hooks.
  - [x] T2.4 Snapshot v23; the sim tests of AC 21; the fuzz test.
- [x] **T3. Client** (AC 5, 16-18)
  - [x] T3.1 The marker swap and its no-leak test.
  - [x] T3.2 `inputMapper`, the babble, mirrors.
- [x] **T4. Tools and tests** (AC 19, 22, 23)
  - [x] T4.1 The bots and the report; the tables pasted.
  - [x] T4.2 Goldens (regenerate, diff, add the two scenarios).
  - [x] T4.3 `tests/e2e/bedtimeDuel.spec.ts`; touched specs.
- [x] **T5. Docs and CI** (AC 24, 25)

### Review Findings

Code review of 2026-10-31, group 1 only (sim, content, schemas: `src/sim`, `src/content`, `content/`). Groups 2 and 3 follow below.

- [x] [Review][Decision] (resolved: option 1, `SequenceEnded{failed}` at once, no `BabyWoke`; delegated to the agent by Geo) A duel round that no longer fits before the level's end freezes the sequence until the level ends — `DUEL_HANDLER.tick` returns forever when `isJudgeableBeforeEnd` is false and `nextRoundAt` stays set; `isSettled()` is always false and a `duel` step is not timed, so nothing ends the sequence. Trigger: `StartSequence bedtime_duel` with less than about 8.5 s of level left, or a late win/retreat that schedules the next round. Outcome: `flow.state` stays `sequence`, the director is off, Papa is held and the baby carried, with no threat, until `levelEnded`. Options: (a) end the sequence when no round can fit (as a success or as a failure?); (b) refuse `StartSequence` when the first round cannot fit; (c) leave it, 4.10 sizes the level. [src/sim/sequences/bedtimeDuel.ts:38-43]
- [x] [Review][Patch] `goToSequenceStep` returns silently on a non-duel step or a null id, and the `duel` ↔ `retreats` pairing is checked only by the zod schema — a hand-built def (tests, a programmatic bundle) with a `duel` step and a `gag` failure never advances; a `retreats` failure with a non-duel step emits `SequenceStepRetreated`, then deadlocks. Make `sequenceDuelProblems` refuse both pairings (so `createSim` and `content:check` agree) and turn the silent `return` into an `invariant`; replace the `as { durationMs: number }` cast. [src/sim/sequences/sequenceEnd.ts:107]
- [x] [Review][Patch] Papa's eyelids read the telegraph progress of the first Papa-anchored threat, so a duel on a level with no micro-sleep and no arms cry shows the time left before the signal (AC 5 / D1: nothing visible may read `windowOpenAt` before the signal). `simLevelOf` now puts the duel instance on the Papa anchor. Limit the eyelids to the micro-sleep, and add a unit test next to the one in `threatMarkers.test.ts`. [src/client/render/levelScene.ts:125]
- [x] [Review][Patch] The snapshot history comment has no entry for version 23 (`world.sequence.duel`, story 4.6); it still opens with « 22 since story 4.5 » (AC 15). [src/sim/snapshot.ts:43]
- [x] [Review][Patch] `PAPA_ASLEEP` duplicates `PAPA_ASLEEP_GAG_ID` and its comment (« no cycle ») is wrong: `gags.ts` does not import `bedtimeDuel`. Import the constant. [src/sim/sequences/bedtimeDuel.ts:106]
- [x] [Review][Patch] `neededMs` ignores the threat's `cooldownMs`: the real rest is `max(restMs, cooldownMs)` (the round waits for `rearmThreat`), so a `cooldownMs` above `restMs` pushes a round past `durationMs` with no error. Add `cooldownMs` to `DuelThreatShape` and use the larger of the two. [src/sim/sequences/bedtimeDuel.ts:146]
- [x] [Review][Defer] `response: "wait"` is accepted in roles the story does not run (a wave-planned anchor, a `hiddenZone` threat, `microSleepDef`, `armsCryDef`); the behaviour (`earlyPress` bypassed, `maxDelayMs` in `isJudgeableBeforeEnd`) is untested and unspecified [src/sim/createSim.ts:208-286] — deferred, not caused by a defect of this story
- [x] [Review][Defer] `duelProblem` of the snapshot does not cross-check `nextRoundAt === null` with the duel threat's state: an imported snapshot with a running duel, no round pending and an idle threat passes and stalls like the Decision above [src/sim/snapshot.ts] — deferred, to settle together with the Decision

Group 2 (client, bots, tools), same day. No finding above low severity survived verification.

- [x] [Review][Patch] `humanBot` named an instant `reaction`; it is `reactionAt` now [src/bots/humanBot.ts:86]
- [x] [Review][Patch] The `fingerPlanFor` doc still listed `wait` among the responses that fail to typecheck until taught [src/bots/threatTiming.ts:25]
- [x] [Review][Patch] `sim --help` did not document `sequenceRetreats` nor that `microSleeps` excludes the duel's threat [tools/sim/simArgs.ts:70]
- [x] [Review][Patch] The test « Space and the pad's A… » drove the keyboard only; its title says what it checks now [src/client/input/inputMapper.test.ts:1523]
- [x] [Review][Defer] A `wait` threat's marker stack order (`threatCloseAt` = `windowOpenAt + windowMs`) and the auto-target of Space/A depend on the unrevealed signal time when another marker is up at the same time; the duel has one threat up, so nothing leaks there, and `waitMarker.test.ts` builds instances with `responseWindow: null`, so it does not see it [src/client/input/urgency.ts:11, src/client/ui/world/threatMarkers.ts] — deferred, only reachable once `wait` runs outside the duel (see the first deferral of group 1)
- [x] [Review][Defer] A thumb resting on the canvas makes the real tap non-primary (`!sample.isPrimary` returns before any press): with « a finger anywhere is the press » (D10) it decides a duel for the first time. A design call to settle by playing, with open point 4 [src/client/input/inputMapper.ts:407] — deferred to the playtest, Geo's call

Group 3 (tests, goldens, docs), same day. The 17 older goldens move only in `worldHash`, and the two new journals hold what they are named for (checked).

- [x] [Review][Patch] The e2e checks of the missing bar, the full-size timer and the babble `off` held in the initial state too: `waitFrames(page, 3)` before them [tests/e2e/bedtimeDuel.spec.ts:144]
- [x] [Review][Patch] Two snapshot validator rules had no rejection test (a running duel in a step that is not a duel; retreats in a sequence whose failure is not `retreats`) [src/sim/sequences/duelSnapshot.test.ts]
- [x] [Review][Patch] The fuzz asserted nothing happened: an aggregate test over the seeds now needs a retreat, a result and an end [src/sim/sequences/bedtimeDuelFuzz.test.ts]
- [x] [Review][Patch] The relaxed verb rule (« ATTENDS… ») had no test [tests/content/stringsSchema.test.ts]
- [x] [Review][Patch] `project-context.md` and the duel's error text were stale after the review fixes (cooldown, pairing, a round that no longer fits); `deferred-work.md` pointed at a decision now settled
- [x] [Review][Patch] `checkDuel.test.ts` `NEEDED_MS` ignored `cooldownMs`; the hooks test did not assert its injected system ran; a title promised `recordMiss` it did not assert; a `toBeDefined` that could not fail
- [x] [Review][Patch] The File List omitted `levelScene.ts`, `levelSession.ts` (and their tests), `bedtimeDuel` fixes and `simArgs.ts`
- [x] [Review][Defer] The mirrors `data-pp-sequence-step` / `-retreats` reset at `SequenceStarted` and at level start has no e2e test (a second sequence, a restart) [tests/e2e/bedtimeDuel.spec.ts] — deferred, low; the clear is a single block in `boot.ts`

## Dev Notes

### Decisions (D1-D10)

- **D1. The signal is drawn at the telegraph, and `windowOpen` still means « the window is open ».** The epic says « quand une menace `wait` entre en `windowOpen`, un signal est tiré… et la fenêtre ne s'ouvre qu'à ce signal », which read literally opens the state before the window. The architecture (L743) says what it means: the window opens at the signal. A `waiting` state would add a member to `THREAT_STATES`, to every reader of `telegraph | windowOpen`, to the snapshot and to the bots, for nothing: `telegraph` already means « announced, not yet open », `windowOpenAt` is already frozen there, the auto-target and the hit test already work. One draw at a fixed moment also keeps the rng count independent of the tuning. **The price: `windowOpenAt` sits in the world before the signal, so the client must not read it for anything visible** (AC 5). 4.7's false signal is an event before the real one and needs no state either.
- **D2. Before the signal is early, strictly: no buffer, no tolerance.** `judgePress` would forgive `tolerance + buffer` (160 ms) before the opening. For a parry that forgives an anticipation of a known instant; here, a press before the signal cannot be a reaction to it, and forgiving it would pay guessing, which is what the duel punishes. After the signal, the tolerance still applies on the late side.
- **D3. The response is a tap; a hold is a `wrongResponse`.** GDD L135 « puis tap », ADR-010's single threshold. The catch is that the verdict comes at the release. Open point 4.
- **D4. Every gag retreats, a late one too.** The epic only names « avant », but a late press must cost something or waiting forever is safe, and two different costs for the same eyes would be two rules to read. The baby's eyes reopen either way.
- **D5. The hooks are in `resolveThreat` and `gagThreat`, not a poll.** `failSequenceOnGag` is already that hook for a gag. Polling `threat.state` from `runSequence` would see the result one step late and would need a « handled » flag in the snapshot. Both hooks stay in `sequenceEnd.ts`, which imports no threat code.
- **D6. No noise and no cry on a retreat.** As 4.5's D5. The def's `gagCryMs` is one edit away, and 4.7 is the story whose epic asks for noise. GDD L216 leaves the pricing of sequence gags to E4: this is that pricing, open point 3.
- **D7. No bar.** A duel is a held breath, and the only honest values are time (an estimate here) and retreats. `"bar": null` also leaves the timer at full size. The price: nothing on screen says how far along the player is. Open point 5.
- **D8. No baby sleep state.** `baby.state` has no reader for it, and a state would have to be undone by every path out of the sequence. The eyes are the threat's state. E7 gives the baby actual eyes; until then, the marker carries them.
- **D9. Papa stays put.** As in 4.4 and 4.5. « Papa part » is the success cue. 4.9 moves the guard.
- **D10. A finger anywhere is the press.** A duel with a target to hit tests aim, not patience: a tap beside a small marker would be ignored at the one moment that matters, and on a keyboard Space already reaches the threat wherever it is. Same choice as the beat's. The rest between rounds is free, so a nervous tap there costs nothing.

### What the epic leaves open, decided here (to confirm with Geo)

The epic gives no way to lose: « recule d'une étape » alone never ends, yet 4.10 needs the `idle` bot to fail. Hence `failure.kind: "retreats"`, `maxRetreats: 3`. It also says nothing of how many « étapes » a duel has: three rounds, from the same def, about 8 s each, so about 25 s against the GDD's 20-60 s. See the open points.

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatFsm.ts`:** `telegraphThreat` L59 freezes the window and `windowOpenAt`; `openWindow` L115; `resolveThreat` L142, the combo call last; `gagThreat` L193, `failSequenceOnGag` last. Imports `nextFloat` already. **Keep:** the order of side effects.
- **`src/sim/threats/threatSystem.ts`:** `pressThreat` L15 (`judgement.quality === 'early'` at L26, the `earlyPress` read at L28); the kind comparison at L126; the expiry at L133-137. **Keep:** commands before the expiry; `lagMs` handling; a threat with a pending press never expires.
- **`src/sim/threats/judgeable.ts`:** the sum at L24-30.
- **`src/sim/sequences/sequenceSystem.ts`:** the `while` at L31 clears the beat slice and calls `enterSequenceStep`; the end test at L48-50. **`sequenceSteps.ts`:** `StepHandler` L13, `HANDLERS` L73. **`sequenceStart.ts`:** the slice reset L69-78. **`sequenceEnd.ts`:** `closeSequence` L31, `failSequenceOnGag` L85, `succeedSequence` L60.
- **`src/sim/createSim.ts`:** the threat pushes L260 and L306; `armsCryIndex` in the `return` L377; the sequences block L342-374; the wave invariant « only the sim spawns it ».
- **`src/content/loadLevelContent.ts`:** the threat loop L85-108 runs before sequences are read. **`src/content/schemas/threat.ts`:** responses L17, icons L25, `baseShape` L71, the `superRefine` L159-197.
- **`src/client/ui/world/threatMarkers.ts`:** the `carriedVerb` swap L677-683 is the pattern to follow; the glyph at L376; `refit` reads `isCarriedShown` at L559, so the signal verb needs the same treatment there.
- **`src/client/input/inputMapper.ts`:** `targetNow` L233, `act` L250, `handlePointerDown` L399, the held-in-place branch L435. **`src/client/boot.ts`:** `setBabbling` L1000, the threat mirrors L757.
- **`src/client/input/urgency.ts`:** `threatCloseAt` reads `windowOpenAt`: fine, it only orders and is never drawn. **Do not** feed it to any visible thing.
- **Must not change:** `judgePress`, `effectiveWindow`, `classifyPress`'s signature, `stay_awake` and `lullaby_walk` behaviour, rng draws of any non-`wait` def, `toSim`, `SetInputLag`, `COMMAND_TYPES` (no new command, so old journals still replay), `tokens.css`, `HUD_MAX_DOM_NODES`.

### Architecture compliance

- Pure sim, serialisable `World`; no real time, no log; `world.rng` only; events past tense with `t`. Systems do not call each other: the handler and the hooks are helpers.
- `src/sim/sequences/bedtimeDuel.ts` is the architecture's file (L497). It may not import `@content` at runtime (types only; 4.4's review): `sequenceDuelProblems` receives plain limits, as `beatWindowLimitsOf` provides.
- Units: `minDelayMs`, `maxDelayMs`, `restMs`, `durationMs`, `nextRoundAt`; `retreats` and `maxRetreats` count. Booleans `is…`. Bots import `@sim` only. Layer rules unchanged.
- Every cue with `audio` has `visual` and `haptic` (`feedbackEquivalence.test.ts`). Windows are in sim time: a slow-mo widens them, on purpose. Reduced motion never changes sim timing.
- The player never reads that they failed: no « échec » in `strings.fr.json`; `failed` lives in code only.
- Variance: the architecture's L222 says Wait is « jugé sur l'absence de commande visant la menace pendant la période requise »; a press **on another threat** still changes nothing (commands target one `threatId`), and in a duel no other threat exists. A finger anywhere in a duel is a press on this threat, by D10, only because nothing else can be meant.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned and this story uses only what is there, so no web research was needed.

### File structure

New: `content/threats/bedtime_eyes.json`; `content/sequences/bedtime_duel.json`; `src/sim/sequences/bedtimeDuel.ts` and test; the new `public/assets/audio/*.m4a`; `tests/threats/fixtures/test_wait.json`; `tests/support/testBedtimeDuel.sequence.json`, `testBedtimeEyes.threat.json`; `tests/e2e/bedtimeDuel.spec.ts`; `tests/golden/bedtimeDuel.test.ts` and journals.

Updated: `src/content/schemas/{threat,sequence}.ts`, `src/content/loadLevelContent.ts`, `content/{feedback,strings.fr}.json`, `content/levels/salon_crawler.json`, `content/_schemas/*`; `src/sim/{world,events,context,createSim,snapshot,index}.ts`, `threats/{threatFsm,threatSystem,judgeable,gags}.ts`, `timing/classifyPress.ts`, `sequences/{sequenceSystem,sequenceSteps,sequenceStart,sequenceEnd}.ts`; `src/bots/{threatTiming,humanBot,perfectBot}.ts`; `src/client/boot.ts`, `input/inputMapper.ts`, `feedback/threatFeedback.ts`, `render/gags.ts`, `ui/world/threatMarkers.ts`, `ui/styles/ui.css`; `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/build/inspectDist.ts`, `tools/sim/simReport.ts`; tests next to each, `tests/threats/threatCatalog.test.ts`, `tests/content/*`, `tests/support/testContent.ts`, `tests/golden/*`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ carry: CARRY, sequences: [...], sequenceDefs })` and `stepN`. `STEP_MS` from `@shared/constants`, never a literal. `createSimWithSystems` **replaces** the system list: use `[...SYSTEMS, spy]` (4.5's hung test).
- `simPurity` refuses the identifier `window`: name a window parameter `response` in `src/sim`.
- `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/bedtimeDuel.spec.ts tests/e2e/sequence.spec.ts tests/e2e/lullaby.spec.ts tests/e2e/threats.spec.ts tests/e2e/feedback.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.
- `botContract.test.ts` can time out at 5 s under load: it passes alone; rerun with `VITEST_MAX_WORKERS=5` and say so.
- On WebKit, wait 3 frames after each `advanceTo` before a real input (4.5): the time map is flat only once a frame has recorded the new clock.

### Previous story intelligence (4.4, 4.5)

- **Their reviews found, and this story must not repeat:** `@content` runtime in the sim (`zod`); step dispatch outside `HANDLERS`; a `content:check` hole that lets a sequence be won trivially (hence « waiting past `endsAt` never wins »); tests whose title claims more than they check, or that pass for the wrong reason (`> 0` counters on a bot that never acts); markers missing from `PROD_FORBIDDEN_MARKERS`; snapshot round trips with nothing in flight; mirrors going stale between two sequences of one level (reset on `SequenceStarted`); e2e specs that silently fall back on `?? 0` when content moves (throw at module load instead); content tests that hard-code live values (derive them); stale snapshot-version titles in `snapshot.test.ts`; an autoplay e2e with a 60 s wait and no check that the sequence started.
- **The bots never put the baby down after a sequence** (4.10): the `perfect` bot's stars fall after any sequence on `salon_crawler`. Expected, not a finding.
- **`__PP__.fx()`'s zoom key is `cameraZoom`**, not `zoom`.

### Git intelligence

Last merged: 4.5 (`714d3c0`), which touched this same machinery. Its story says snapshot v21 and the code is at 22, since another story bumped it in parallel: look at `snapshot.ts` before bumping. Commit convention: « Story 4.6 : <titre> », « Story 4.6 : corrections de la revue de code ». `main` only receives the merge after Geo's OK. This branch is `story/4-6-duel-du-coucher-reponse-attendre`, in its worktree, with its `npm ci` already done.

### Project Structure Notes

Paths follow the epic and the architecture. No conflict. The one addition of note is the `isTimed` field on `StepHandler`, a generalisation 4.8's « la séquence recule » will use.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 19, 22).
- Layer rules; the sim never logs; I/O returns `Result`; no silent `catch`, every fallback logs a `warn`.
- Early press follows `feel.earlyPress`, **except `wait` threats, which always gag** (project-context, Time & input judgement).
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes. Bind keys by `code`. Every action works by touch, keyboard and gamepad.
- A new `GagId` needs its consequence and its presentation (both `Record`s). A threat's success clip is exactly `resp_<response>`, its telegraph a `tel_*` clip no other shares, its gag a `gag_*` clip.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **How to lose is my addition** (`maxRetreats: 3`). The epic only says the sequence steps back. The third failure wakes the baby and ends it.
2. **Papa does not leave.** The success is a sound, a wave and the next step, because 4.4's D3 holds him until 4.9.
3. **A retreat costs no noise**, only the combo and the step (D6). GDD L216 left this to E4. `gagCryMs` on the def adds a cry, hence noise, in one edit.
4. **A hold on the signal is a failure** (D3). If a tense thumb that stays down feels unfair, tell me and the press can resolve as soon as it lands.
5. **Nothing shows the progress** (D7): three steps and no bar. If you feel lost, pips or a bar are cheap, but they cost the duel's emptiness.
6. **`perfect` means pressing 100-200 ms after the signal**, which is at the limit of human reaction on a phone. The human bot reacts at 250 ms and will rarely get one. The GDD's 100 ms centred window is what the epic asks for; `windowMs` on the def moves the centre.
7. **The tuning is a guess:** 800 ms of telegraph, a 2-6 s wait, 1.2 s of rest, three rounds, so about 25 s.
8. **The signal is on the marker**, a closed-eye glyph and « FILE ! », until E7 gives the baby eyes. The words are mine.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L1807-1809, L1932-1978, L1994-1996, L2041-2045]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L135, L149-151, L198, L216, L297-308]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L222, L497, L738-744, L967]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L527-528; EXPERIENCE.md L124, L208-209]
- [Source: _bmad-output/project-context.md (Special sequences, The lullaby walk, Carrying the baby, Time & input judgement, Feedback, Testing)]
- [Source: _bmad-output/implementation-artifacts/4-5-les-100-pas-en-rythme.md, 4-4-cadre-des-sequences-speciales-et-rester-eveille.md (Decisions, Review Findings); deferred-work.md L204, L514, L704]
- [Source: src/sim/threats/*, src/sim/sequences/*, src/sim/createSim.ts, src/content/loadLevelContent.ts, src/content/schemas/{threat,sequence}.ts, src/client/ui/world/threatMarkers.ts, src/client/input/{inputMapper,urgency}.ts, src/client/boot.ts, src/bots/*, tests/threats/threatCatalog.test.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Code.

### Debug Log References

- `?threats=off` stripped the duel's threat def (found by `testApi.spec.ts` and `threats.spec.ts` failing with « threatDef "bedtime_eyes" is not loaded »): `withoutThreats` now keeps the defs the `duel` steps of its kept sequences name, with a unit test.
- The first drafts of `duelSequence.test.ts` counted `gags.total` and `armsCries` as if the game stopped at the end of the sequence: it plays on, the baby stays carried and the cry in the arms goes on (4.10's known limit). They count the eyes' own results now.
- `never wins by waiting past endsAt` first passed with `isSettled` mutated to `true` (a retreat keeps moving the `endsAt` estimate): the test now puts `endsAt` in the past by hand, and fails under the mutation.

### Completion Notes List

- **T1.** `wait` is a schema response with `minDelayMs`, `maxDelayMs`, `signalVerbKey`, `signalIcon` and `feedback.signal` (required on a `wait`, refused elsewhere, one message per path), the `eyes` icon, `pressKindOf` next to `classifyPress`, `WaitSignalGiven` (sorted in `SIM_EVENT_TYPES`). `telegraphThreat` draws exactly one `nextFloat` for a `wait` def and nothing for any other; `openWindow` takes the def and pushes `WaitSignalGiven` then `WindowOpened`; `pressThreat` gags a press stamped before the signal as `early` before the `judgement.quality` branches, whatever `earlyPress` says; `isJudgeableBeforeEnd` counts `maxDelayMs`. Strings: `verb.wait` « ATTENDS… », `verb.go` « FILE ! » (the strings schema now accepts a verb ending with « … » beside « ! »: `ATTENDS…` is the story's own text). `threatCueOf` maps `WaitSignalGiven` to `feedback.signal`; `content:check` requires `audio`, `visual` and `haptic` on it (one failing test each).
- **T2.** `duel` step kind and `retreats` failure with the three cross rules; `bedtime_eyes.json`, `bedtime_duel.json`, `baby_eyes_reopened` gag, the six cues and the hush loop in `feedback.json`, five new placeholder clips (seeds 27 to 31; only the five new `.m4a` are in the diff, the others untouched). `loadLevelContent` loads a duel's threat after the sequences through one shared closure and reports a missing file at `steps[j].threatDef`. `simLevelOf` captures `armsCryIndex` before pushing the duel instances and fills `SimSequence.duelThreatIndexes`. `StepHandler.isTimed`, `DuelSlice` (`createDuelSlice`, `clearDuelSlice`), `goToSequenceStep`, the two hooks (`advanceSequenceOnResolve`, `failSequenceOnGag(world, ctx, threat, reason)`), `DUEL_HANDLER`, `sequenceDuelProblems` (pure, shared by `content:check` and `simLevelOf`). Snapshot v23 with `duelProblem`.
- **T3.** The marker swaps its verb and glyph and toggles `pp-threat--signal` on `windowOpen` (kept while the marker is up, so a quick tap is drawn once more with the signal; back to the open eye at the next telegraph); nothing visible reads `windowOpenAt` before the signal (unit test with two instances, `windowOpenAt` 2000 vs 6000, writing the same DOM). The input mapper makes a finger anywhere the press on the threat that is up while `isDuelStepRunning`; free in a rest. The babble is off during a duel. Mirrors `data-pp-sequence-step` and `data-pp-sequence-retreats`, cleared at level start and at `SequenceStarted`.
- **T4.** Bots: `fingerPlanFor` taps a `wait`; `perfect` is unchanged code with a comment; `human` skips a `wait` threat until it is `windowOpen` (before `cycles.isNew`) and presses at `windowOpenAt + reactionMs + aimOffsetMs + jitterSdMs × N(0, 1)`, one draw; its draws on a parry are pinned unchanged by replaying its own rng stream. `simReport` counts `sequenceRetreats`; the recorder no longer counts the duel's telegraph as a micro-sleep. Goldens regenerated, two scenarios added. `tests/e2e/bedtimeDuel.spec.ts` (12 tests, chromium + webkit).
- **T5.** `project-context.md` paragraph, `snapshot version 23` (the 4.5 paragraph keeps its own version 22), `deferred-work.md` (L204 and L514 closed for `wait`, this story's open points).

**Deliberate golden update (AC 22):** every existing journal moves **only** in `worldHash` (checked: the diff of every other line is empty), because the world now holds `sequence.duel`. Two journals are new: `bedtime_duel_won` (seed 46) and `bedtime_duel_retreated` (seed 47).

**AC 22, `main` (`714d3c0`) against the branch, `salon_crawler`, seed 1, 20 runs, normal tier:**

| bot | tree | meanStars | starCounts | endsByReason | meanSuccessPct | meanScore | gags |
|---|---|---|---|---|---|---|---|
| perfect | main | 5 | [0,0,0,0,0,20] | timer 20 | 100 | 90 | 0 |
| perfect | branch | 5 | [0,0,0,0,0,20] | timer 20 | 100 | 90 | 0 |
| human | main | 4 | [0,0,0,1,18,1] | timer 20 | 99.9 | 82.1 | 1 |
| human | branch | 4 | [0,0,0,1,18,1] | timer 20 | 99.9 | 82.1 | 1 |
| idle | main | 1 | [0,20,0,0,0,0] | timer 20 | 0 | 20 | 762 |
| idle | branch | 1 | [0,20,0,0,0,0] | timer 20 | 0 | 20 | 762 |
| random | main | 1 | [0,20,0,0,0,0] | timer 20 | 2.2 | 20.3 | 759 |
| random | branch | 1 | [0,20,0,0,0,0] | timer 20 | 2.4 | 20.1 | 759 |
| random | branch, `bedtime_duel` taken out of the level's `sequences` | 1 | [0,20,0,0,0,0] | timer 20 | 2.2 | 20.3 | 759 |

`perfect`, `human` and `idle` are identical (stars, end reasons, success rate, score, gags); only the hashes move. `random` moves, as expected (one more threat instance, it draws `nextInt(rng, 0, world.threats.length)`), and **with the duel taken out of the level it matches `main` exactly** (last row; the level file was restored afterwards).

**AC 22, `--sequence bedtime_duel --sequence-at-ms 5000`, same level, seed 1, 20 runs:**

| bot | started | succeeded | failed | retreats | eyes responses | perfect | success | fail | early | late |
|---|---|---|---|---|---|---|---|---|---|---|
| perfect | 20 | 20 | 0 | 0 | 60 | 60 | 0 | 0 | 0 | 0 |
| human | 20 | 20 | 0 | 3 | 66 | 11 | 52 | 3 | 0 | 3 |
| idle | 20 | 0 | 20 | 40 | 60 | 0 | 0 | 60 | 0 | 60 |
| random | 20 | 0 | 20 | 40 | 60 | 0 | 0 | 60 | 13 | 47 |

`perfect` wins 20 of 20 with no retreat and every response `perfect`; `idle` loses 20 of 20 on its third failure (two retreats, then `BabyWoke`). `human` wins 20 of 20 (3 retreats in all, all `late`, never `early`; 11 of 66 responses `perfect`, about 17 %): it is not too hard. `random` loses 20 of 20, mostly late (it presses at random moments, not at the signal). `tests/tools/sim/duelSequence.test.ts` pins `perfect` and `idle` over seeds 1 to 5.

**Findings / deviations to know:**
- `test_wait` is planned at the `phone` anchor, not `door`: `test_firm` already holds `door` and two defs cannot share an anchor.
- `ppSequenceStep` and `ppSequenceRetreats` are not separate `PROD_FORBIDDEN_MARKERS` entries: the existing `ppSequence` entry is their prefix and `inspectDist` would report each chunk twice (the existing comment says the same for the story 4.4 mirrors). Covered by the prod build check in the full CI.
- `failSequenceOnGag` gained the `threat` and `reason` parameters, so `lullabyWalk.test.ts` had to change one call (the only edit of an existing sequence test beyond content counts and the snapshot version).
- Screenshots at 667 × 375 looked at (Chromium and WebKit): the open eye with « ATTENDS… » before the signal, the closed eye with its lashes and « FILE ! » after; no reference screenshot moved.
- `main` gained story 2.10 meanwhile: merged into the branch (one conflict, the reduced-motion block of `ui.css`, now `:where(:root[data-pp-motion="reduced"]) …` with the signal's pop added).
- The 30-seed fuzz is `bedtimeDuelFuzz.test.ts`; `test:coverage` passed with the `src/sim` thresholds (all files 98.1 % statements).
- **CI:** `npm run ci` was run twice on the branch. Both times typecheck, lint, `content:check`, `test:coverage` (6496 tests) were green and `e2e` ended with 649 passed and 1 failure in `instinct.spec.ts`, a different one each time and not in this story's code: the first a `normal` tier read in a Chromium test (21 of 21 pass alone), the second a WebKit crash (« Cannot find parent object browser », 14 of 14 pass alone). The machine was loaded. Because `e2e` stops the script, the rest of the script (`build:playtest`, `dist:check --flavor playtest`, `e2e:dist` with its perf run, `build`, `dist:check --flavor prod`) was then run by hand, in order: all green. So no single `npm run ci` run exited 0.

### File List

**Content and assets:** `content/threats/bedtime_eyes.json` (new), `content/sequences/bedtime_duel.json` (new), `content/levels/salon_crawler.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/{sequence,threat}.schema.json`, `public/assets/audio/{tel_bedtime_eyes,resp_wait,baby_eyes_close,gag_baby_eyes_reopened,music_bedtime_hush}.m4a` (new).

**Sim and content code:** `src/content/schemas/{threat,sequence,strings}.ts`, `src/content/loadLevelContent.ts`, `src/sim/{world,events,context,createSim,snapshot,index}.ts`, `src/sim/sequences/{bedtimeDuel (new),beatClock,lullabyWalk,sequenceEnd,sequenceStart,sequenceSteps,sequenceSystem}.ts`, `src/sim/threats/{threatFsm,threatSystem,judgeable,gags}.ts`, `src/sim/timing/classifyPress.ts`.

**Client, bots, tools:** `src/client/{boot,input/inputMapper,feedback/threatFeedback,render/gags,app/threatsSwitch}.ts`, `src/client/ui/world/threatMarkers.ts`, `src/client/ui/styles/ui.css`, `src/bots/{humanBot,perfectBot,threatTiming}.ts`, `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/build/inspectDist.ts` (comment), `tools/sim/{runSim,simReport}.ts`.

**Tests (new):** `src/sim/sequences/{bedtimeDuel,bedtimeDuelFuzz,duelLevel,duelSnapshot}.test.ts`, `src/sim/threats/waitResponse.test.ts`, `src/client/feedback/waitFeedback.test.ts`, `src/client/ui/world/waitMarker.test.ts`, `tests/bots/waitBots.test.ts`, `tests/content/{checkDuel,duelSequenceSchema,waitThreatSchema}.test.ts`, `tests/tools/audio/bedtimeClips.test.ts`, `tests/tools/sim/duelSequence.test.ts`, `tests/golden/bedtimeDuel.test.ts`, `tests/e2e/bedtimeDuel.spec.ts`, `tests/support/{testBedtimeEyes.threat,testBedtimeDuel.sequence}.json`, `tests/threats/fixtures/test_wait.json`, `tests/golden/journals/bedtime_duel_{won,retreated}{,.expected}.json`.

**Added by the code review:** `src/client/render/levelScene.ts` and `levelScene.test.ts`, `src/client/app/levelSession.ts` and `levelSession.test.ts` (`SceneBodies.microSleepDefId`: Papa's eyelids follow the micro-sleep only), `src/sim/sequences/{bedtimeDuel,sequenceEnd}.ts` and their tests, `src/sim/snapshot.ts` (history comment), `tools/sim/simArgs.ts` (help), `tests/content/stringsSchema.test.ts`, `_bmad-output/project-context.md`.

**Tests (changed):** `tests/support/testContent.ts`, `tests/threats/threatCatalog.test.ts`, `tests/golden/scenarios.ts` and every `tests/golden/journals/*.expected.json` (hashes only), `tests/content/{levelSchema,loadLevelContent,sequenceSchema,threatSchema}.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/e2e/threats.spec.ts`, `src/sim/{createSim,events,snapshot}.test.ts`, `src/sim/sequences/{lullabyWalk,sequenceSnapshot}.test.ts`, `src/sim/threats/{gags,inputLag,threatFsm}.test.ts`, `src/client/input/inputMapper.test.ts`, `src/client/app/threatsSwitch.test.ts`.

**Docs:** `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file.

## Change Log

| Date | Change |
|---|---|
| 2026-10-31 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
| 2026-10-31 | Story implemented (`gds-dev-story`): the `wait` response, the bedtime duel, snapshot v23, the bots, the goldens and the e2e. Status `review`. |
| 2026-10-31 | Code review, group 1 (sim, content, schemas): a duel round that cannot fit before the level's end now fails the sequence at once; `sequenceDuelProblems` checks the `duel` ↔ `retreats` pairing and the cooldown; `goToSequenceStep` asserts; Papa's eyelids follow the micro-sleep only (`SceneBodies.microSleepDefId`); snapshot v23 history comment. Groups 2 and 3 not reviewed yet. |
