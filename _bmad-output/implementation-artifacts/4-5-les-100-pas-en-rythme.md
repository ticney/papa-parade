# Story 4.5: The hundred steps, in rhythm

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.5 « Les 100 pas en rythme » (L1910-1930). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to rock the baby by walking to the beat of a lullaby that slows down,
so that I live a rhythm moment in the style of Rhythm Heaven.

**Requirements covered:**
- **FR40 `[P2]` (second step of the bedtime cycle):** the lullaby starts at 90 BPM and slows to 60 as the baby falls asleep; a 180 ms window per step; a trap off-beat (GDD L304, epics L1920). « Rythme » is « Parer en cadence » (GDD L142).

**What this story is not:**
- **No sequence in normal play.** As in 4.4, it starts from the debug overlay, `__PP__.send` or the sim CLI; 4.10 chains the cycle.
- **Papa does not walk across the room.** 4.4's D3 stands: he stays in place during a sequence, and 4.9 moves that guard. The steps are heard and seen on the spot (open point 1).
- **No perfect grade for a step, no score of its own, no combo per step** (D6, open point 3).
- **No bar-long pattern, no melody editor.** The lullaby is one short note per beat from a list of clips. Final music and art are E7.
- **No per-sequence playtest metrics, no cycle bot** (4.10). **No new dependency, no new top-level folder.**

**Sources:**
- Epics `epics.md` L1807-1809, L1910-1930, L2041. GDD `gdd.md` L136-146, L296-306, L381. Architecture `game-architecture.md` L497, L785-805 (P5), L966.
- UX `DESIGN.md` L396-397, L465, L527-528; `EXPERIENCE.md` L124, L208-209.
- Previous stories: `4-4-cadre-des-sequences-speciales-et-rester-eveille.md` (read it, including its review), `2-7` (calibration, `SetInputLag`), `2-6` (adaptive music), `2-8` (tier), `4-1`, `4-2`.

## Acceptance Criteria

Numbers in `content/` are live starting values for Geo to tune. Tests use frozen `tests/support/` files, never the live ones.

### Content

1. **`beats` step kind** (`src/content/schemas/sequence.ts`; add it to `SEQUENCE_STEP_KINDS` and the union, every key with a `.describe()`, then `npm run content:schemas`). New `content/sequences/lullaby_walk.json`:

   ```json
   {
     "$schema": "../_schemas/sequence.schema.json",
     "id": "lullaby_walk",
     "babyCarried": true,
     "steps": [
       {
         "kind": "beats",
         "durationMs": 40000,
         "track": "lullaby",
         "bpmStart": 90,
         "bpmEnd": 60,
         "leadInMs": 1200,
         "countInBeats": 4,
         "windowMs": 180,
         "decoyBeats": [7, 15, 23, 31, 38]
       }
     ],
     "success": { "kind": "stepsDone" },
     "failure": { "kind": "babyAwake", "missWakePct": 12, "decoyWakePct": 20, "strayWakePct": 6 },
     "framing": {
       "camera": { "zoomPct": 18, "focusPct": 60, "inMs": 900, "outMs": 700 },
       "musicLoop": "lullaby_walk",
       "bar": { "labelKey": "hud.sequence_lullaby_walk", "fill": "player", "value": "calmLeft" }
     },
     "feedback": { "started": "sequence_started", "succeeded": "sequence_succeeded", "failed": "sequence_failed" }
   }
   ```

   - `decoyBeats` are judged-beat numbers (0-based, count-in excluded): the decoy sits halfway between that beat and the next. Strictly increasing.
   - `failure` gains the kind `babyAwake`. `SEQUENCE_BAR_VALUES` gains `calmLeft`. A `superRefine` on `SequenceDefSchema`: a def with a `beats` step has `failure.kind === 'babyAwake'`, and a `babyAwake` def has a `beats` step.
   - **`failSequenceOnGag` (`sequenceEnd.ts` L70) reads `failure.hasSnore`, which no longer exists on every kind:** narrow it; a gag ends only a `gag` sequence.

2. **Level.** `content/levels/salon_crawler.json`: `"sequences": ["stay_awake", "lullaby_walk"]`.

3. **`feedback.json`** (schema `src/content/schemas/feedback.ts`; `feedbackClips()` and its test follow):
   - `beatTracks: { lullaby: { notes: ["music_lullaby_note_1", "music_lullaby_note_2", "music_lullaby_note_3", "music_lullaby_note_4"], countIn: "music_lullaby_tick", decoy: "baby_lullaby_coo", bus: "music", gainPct: 100 } }`. The note of a judged beat is `notes[judgedIndex % notes.length]`.
   - `beatScheduler: { scheduleAheadMs: 150, replanToleranceMs: 5 }` (real ms) and `beatRing: { approachMs: 500 }` (sim ms).
   - `loops.sequenceMusic.lullaby_walk`: `music_lullaby_pad`, a quiet droning loop **with no pulse**. It is there so that the level stems give way through 4.4's existing path; the notes carry the tempo.
   - `events`: `BeatHit → beat_hit` (audio `papa_lullaby_step`, a `soundWave` on `papa`, haptic `light`), `BabyStirred → baby_stirred` (audio `baby_stir`, a `soundWave` on `papa`, haptic `medium`), `BeatCued → beat_cued` and `DecoyCued → decoy_cued` (haptic `light` only, no audio: AC 16).
   - Placeholder clips in `tools/audio/makePlaceholderAudio.ts`, each with its own free seed (**read `cultSounds.ts` and every `SEED +` first**: 4.3's review found a collision). `npm run assets:audio` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB).
   - `strings.fr.json`: `"hud.sequence_lullaby_walk": "Calme"`. No word of failure (`StringValueSchema`).

4. **`content:check`** (`tools/content/contentChecks.ts`), one failing test each in `tests/content/`, and the same refusals as `invariant`s in `simLevelOf` (`createSim.ts`), same wording:
   - `track` absent from `feedback.json › beatTracks`;
   - a `decoyBeats` entry with no next judged beat (out of the timeline, computed with `beatTimelineOf`);
   - `windowMs` not below the shortest beat interval;
   - no judged beat at all;
   - `calmLeft` on a def without `babyAwake`.

### The sim

5. **The beat timeline** (`src/sim/sequences/beatClock.ts`, pure, exported by `src/sim/index.ts`, **no zod and no `@content` runtime import**, the review fix of 4.4). `beatTimelineOf(step)` returns `readonly BeatEntry[]`, `{ offsetMs, kind: 'countIn' | 'beat' | 'decoy', judgedIndex }`, sorted by `offsetMs`, from the step's start:
   - the first entry is at `leadInMs`;
   - the next beat is `prev + Math.round(MS_PER_MINUTE / bpmAt(prev))`, where `bpmAt` is linear from `bpmStart` to `bpmEnd` over `durationMs`. **Whole ms**, so the journals and the tests read clean numbers;
   - a beat exists only if `offsetMs + windowMs <= durationMs`;
   - the first `countInBeats` are `countIn`, the rest `beat`. A decoy's offset is `Math.round` of the middle of its two beats.

   `SimSequence` gains `beatTimelines: readonly (readonly BeatEntry[] | null)[]`, one per step, built by `simLevelOf`. It is derived from content, **not in the snapshot**. The client and the bots use the same function: a test pins that they agree.

6. **The slice** (`world.ts`, `createWorld`). `SequenceSlice` gains `beat`:
   - `isRunning: boolean` (the current step is a `beats` step), `cueIndex` (next timeline entry to announce), `judgeIndex` (next `beat` entry to settle, or `timeline.length` when none is left), `nextBeatAt: SimMs | null` (the absolute time of `judgeIndex`, for the bots and the client), `isDecoySpent: boolean`, `wakePct`, and `responseWindow: EffectiveWindow`, computed when `judgeIndex` advances (a window already announced keeps its length, the tier rule).
   - Cleared by `closeSequence` and on every step change, before the new step's `enter`.
   - Export `isBeatStepRunning(world)` from `@sim`.

7. **Commands and events.**
   - `commands.ts`: `TapBeat{t}`, journaled, shape-checked. `COMMAND_TYPES` only gains it, so old journals still replay.
   - `events.ts`, sorted into `SIM_EVENT_TYPES`: `BeatCued{t, entryIndex, judgedIndex | null}`, `DecoyCued{t, entryIndex}`, `BeatHit{t, judgedIndex, offsetMs}`, `BeatMissed{t, judgedIndex}`, `DecoyTapped{t, entryIndex}`, `BeatStrayTapped{t}`, `BabyStirred{t, wakePct, deltaPct, reason}` with `reason` in `BABY_STIR_REASONS = ['missed', 'decoy', 'stray']` and its completeness proof, as `LEVEL_END_REASONS`.

8. **The handler** (`src/sim/sequences/lullabyWalk.ts`, the architecture's file, plugged into `HANDLERS` in `sequenceSteps.ts`). `StepHandler` gains `isSettled(world, ctx, step)`. The end test in `sequenceSystem.ts` L48-50, which names the micro-sleep, becomes the handler's: `microSleeps` keeps exactly today's condition, `beats` is true when no judged beat is left. No `nextFloat`: **a `beats` step draws nothing from `world.rng`.**

   `tick`, in this order, allocation-free apart from the one `EffectiveWindow` per beat:
   1. **Commands.** Each `TapBeat` of `ctx.commands`, in order, judged on **its own `t`** (never `world.time.sim`, ADR-003) through `classifyTap` (AC 9).
   2. **Misses.** While `now >= beatAt + windowMs / 2 + toleranceMs + world.input.lagMs` for the entry at `judgeIndex`: `BeatMissed`, the stir of AC 10, advance.
   3. **Cues.** While the entry at `cueIndex` is due: `BeatCued` or `DecoyCued`. This cursor is separate on purpose: **a beat hit early has not been announced yet, and it still must be.**

9. **`classifyTap`** (pure, in `beatClock.ts`, unit-tested on its own):
   - **The window goes through `effectiveWindow`** (tier × fatigue, neutral instinct: read `threatFsm.ts` L66-70) **with `bufferMs` forced to 0** in the stored copy: the buffer keeps a press that is early, which in rhythm would swallow the off-beat. The judgement is `judgePress(t, beatAt - windowMs / 2, window)`.
   - A tap before the first judged beat's window (the lead-in and the count-in): **free**, no event (tapping along is what a player does).
   - The candidates are the beat at `judgeIndex` and the decoy just before it, if not spent. **Nearest centre wins, a tie goes to the beat** (at a wide tier the two windows can overlap).
   - On the beat, `perfect` or `success`: `BeatHit`, advance (`isDecoySpent` back to false).
   - On the beat, `late`: settles it as a miss (`BeatMissed`, stir `missed`): one tap never pays twice.
   - On the decoy: `DecoyTapped`, `isDecoySpent = true`, stir `decoy`.
   - Anything else (a second tap in a window already hit, a tap between windows): `BeatStrayTapped`, stir `stray`. **This is what stops a player mashing through a 180 ms window.**

10. **Waking** (`stirBaby`, in `lullabyWalk.ts`). `wakePct` is clamped to `[0, 100]`, `BabyStirred`. At 100: `BabyWoke`, `SequenceEnded{failed}`, flow back to `playing`, the resume of 4.4. Factor the shared end out of `failSequenceOnGag` rather than copying it. No snore, **no noise** (D5), no change of baby state, `BabyWoke`'s cue plays as in 4.4. The commands left in that step are not judged: the slice is cleared.

11. **Success.** `now >= endsAt` and settled: `SequenceEnded{succeeded}`, the same resume. The baby stays carried.

12. **Snapshot v21** (`snapshot.ts` L41, L60, L1000 and its history comment; a parallel story may bump it too, look before merging). `sequenceProblem` gains: `beat` all clear when `id` is null; indices in range of the timeline; `wakePct` finite in `[0, 100]`; `nextBeatAt` null exactly when no judged beat is left; `responseWindow` finite. Fixtures, each rejected field, a round trip in a count-in, in an open window and just after a decoy, each continued to the end on both copies with the hashes compared (4.4's review).

### The client

13. **The beat scheduler: the heart of the story** (`src/client/audio/beatScheduler.ts`, `createBeatScheduler`). Once per frame, called from `boot.ts` beside `audio.setSequenceMusic`, it looks at the timeline ahead of the world's `cueIndex` and plans on the audio clock with `audio.playOneShotAt`, whose handle has `cancel` (written for the calibration: `audioEngine.ts` L79).
    - **The mapping** is one pure function, `audioAtS(beatAt, clockMs, simPerRealMs, audioNowS, leadMs)` = `audioNowS + (beatAt - clockMs) / simPerRealMs / 1000 - leadMs / 1000`. `clockMs` and `simPerRealMs` are what `loop.ts` L259 records in the time map: expose them as read-only getters on `GameLoop`. **Never `world.time.sim`, which moves in 10 ms stairs.**
    - **Plans** whatever is within `scheduleAheadMs` of real time, from a fixed pool (no growing array).
    - **Re-plans:** each frame, a planned note that has not sounded is recomputed; off by more than `replanToleranceMs`, it is cancelled and planned again. **This one rule is what covers a slow-mo, a hitstop and a debug `SetTimeScale`.**
    - **`simPerRealMs === 0`** (hitstop, pause, debug freeze): every note that has not sounded is cancelled, and is planned again when the clock moves. Dividing by it is a bug the test must catch.
    - **`playOneShotAt` returning `null`** (a suspended context) is retried next frame; it is **not** a played note. A note whose time has passed by more than `scheduleAheadMs` is dropped, with a `log.debug`.
    - **Nothing stays planned** after a sequence end, a restart or a level end: state-driven, as 4.4's D8. A test restarts mid-sequence.
    - The pause needs no code of its own: `PauseRequested` suspends the context and `GameResumed` resumes it (`boot.ts` L457-458), and the sim's clock and the audio clock freeze together.

14. **`audioOffsetMs`: one correction, not two. This is the trap of the story (D1).** The inputs stay in `inputMapper.toSim` (`visualOffsetMs`, L184-185), untouched, and `SetInputLag` too. The scheduler plays each note `leadMs = audioOffsetMs - visualOffsetMs` earlier, read from `saveStore.current().calibration` (0 with none, so a skipped audio phase, where the two are equal, gives 0 by itself). **Do not also subtract `audioOffsetMs` from the taps.** A unit test with both offsets set proves the arithmetic: a player whose calibrated reaction lands `audioOffsetMs` after the sound they hear, and whose stamp is corrected by `visualOffsetMs`, reads exactly `beatAt` in the sim.

15. **Input** (`inputMapper.ts`). In the `isHeldInPlace` branches of `act` (L285) and `handlePointerDown` (L428), after the threat check, which stays first: when `isBeatStepRunning(world)`, enqueue `TapBeat{t}` with the same `toSim` stamp. Anywhere on the screen, Space or A, no tap marker, no `press.pressed` (a release ends nothing). The HUD's pause button must still pause, not tap: pin it in the e2e. A `Release` is never sent for a beat.

16. **Seeing and feeling the beat: pillar 3.** The notes do not go through the cue table, so `feedbackEquivalence` does not cover them, and this AC does.
    - New `src/client/ui/world/beatRing.ts`, one pooled `CSS2DObject` anchored on Papa, built like `papaHint.ts`, `aria-hidden`: a ring closing on Papa over `beatRing.approachMs`, driven **each frame by the timeline and the loop's `clockMs`, never by events**, so a pause holds it. A decoy's ring is dashed and carries a `✕` from CSS: **shape and colour, never colour alone** (NFR8). Reduced motion: it keeps an opacity pop and drops its scale (the calibration ring's rule). Tokens only.
    - `BeatCued` and `DecoyCued` vibrate `light` (AC 3), so a muted phone can still follow the tempo.
    - With the `music` bus at 0, the whole sequence stays playable: an e2e pins that the ring and the vibrations are all still there.

17. **The bar.** `sequenceBar.update` reads `calmLeft` as `100 - wakePct` through a `switch` that does not compile without a case. On a failure the bar keeps its last value during the slide-out (4.4's review). The HUD stays within `HUD_MAX_DOM_NODES` (the bar is already two nodes).

18. **Mirrors and test API** (dev and `?debug=1`, on events, in the clearing list at level start, and added to `PROD_FORBIDDEN_MARKERS` in `tools/build/inspectDist.ts`, the review fix of 4.4): `data-pp-beat-hits`, `data-pp-beat-misses`, `data-pp-baby-wake`. `__PP__.beatLog()`: for each note, `{ entryIndex, beatAt, plannedAtS, replans }`, and a sample of the pairs `(audioNowS, clockMs)` for AC 22.

### Tools and tests

19. **Bots: the golden rule.** Bots read `world.sequence.beat` through `@sim`, never `@content`.
    - `perfect`: `TapBeat` at `Math.round(nextBeatAt)`, once per `judgeIndex`.
    - `human`: `nextBeatAt + aimOffsetMs + jitterSdMs × N(0, 1)`, one plan per beat, no `reactionMs` floor (a rhythm is anticipated: say so in a comment). The plan is dropped when the beat is settled.
    - `random`: in a `beats` step, taps at `actionsPerSec`. **Outside a beat step its draws must not change**, or the salon's report moves.
    - `idle`: nothing, so the misses wake the baby.
    - `simReport.ts`: `beatsHit`, `beatsMissed`, `decoysTapped`, `beatsStray`, per run and in the aggregate.

20. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `beatClock.test.ts`: the first interval is 667 ms (90 BPM) and the intervals grow towards 1000 ms (60 BPM, reached only at `durationMs`), whole offsets, sorted, decoys halfway, the `offsetMs + windowMs <= durationMs` limit, every branch of `classifyTap` (the nearest-centre tie, a spent decoy, the free count-in).
    - `lullabyWalk.test.ts`: event order; a hit early, then its `BeatCued` still comes at its time; a hit with `t` in the past, judged on `t`; a miss at the exact step, and later with `SetInputLag`; the window through the tier and through fatigue; `bufferMs` is 0; **exactly no `nextFloat`** (the rng state before and after); `wakePct` per reason; failure at 100 with the full event order and the clear; no noise; success only when settled; a level end cuts it (`levelEnded`); a slow-mo during it stretches nothing but the clock; a `gag` no longer narrows wrongly (`stay_awake` still fails on one).
    - `sequenceSystem.test.ts`, `snapshot`, `events`, `commands`, `carryFuzz` (random `TapBeat`s, `wakePct` in range), `sequenceSchema`, `checkSequences`, `feedbackClips`.
    - Client: `beatScheduler.test.ts` (AC 22, on the fake context of `audioEngine.test.ts`), `beatRing.test.ts`, `inputMapper.test.ts` (tap, Space, A; a threat still comes first), `sequenceBar.test.ts`, `loop.test.ts` (the getters). `worldUi.test.ts` indices shift when an element joins a scene (4.2's review).
    - `src/sim` coverage stays at or above 90 %.

21. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: for **all four bots**, stars, end reasons, success rate, score and gags are identical. Only hashes move. **Paste both summaries in a table.**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20 --sequence lullaby_walk --sequence-at-ms 5000`: `perfect` wins 20 of 20 with no miss, no decoy and no stray; `idle` loses 20 of 20; `human` and `random`, say what they do. **Paste the table.** `tests/tools/sim/sequence.test.ts` pins `perfect` and `idle` over seeds 1 to 5. If `human` loses, that is a finding for Geo, not something to tune away silently.
    - `npm run golden:update`, then diff, then `biome format` the JSON: every existing journal moves **only** in its hashes. Anything else is a bug, stop.
    - New scenarios `lullaby_walk_kept` and `lullaby_walk_woken` (`tests/golden/scenarios.ts`, a frozen short def in `tests/support`, a test file like `stayAwake.test.ts`).

22. **Synchronisation: the epic's test (at most 10 ms between the game clock and the audio position).** The measure, in sim and in browser alike: for each note that sounded, the gap between `plannedAtS` (minus `leadMs`) and the audio time at which the continuous game clock reached `beatAt`.
    - **`beatScheduler.test.ts`, deterministic:** a fake real clock and fake frames at 16.67 ms, for each of: no change; a `timeScale` of 0.3 starting and ending mid-sequence; a pause of 10 s then a resume; a hitstop; frames at 33 ms; both offsets set. Every gap ≤ 10 ms.
    - **The one honest exception, say it in the test:** a change of rate in the frame just before a note has sounded cannot be undone, because the note is already out. It is at most one frame times `1 - scale`. The assertion excludes **only** a note within one frame after a change of rate, and pins that bound for it.
    - **`tests/e2e/lullaby.spec.ts`, real Web Audio, Chromium:** plays through a slow-mo (`SetTimeScale`) and a real pause, then computes the same gap from `__PP__.beatLog()`. A context that does not reach `running` fails the test; it does not skip it.

23. **End to end** (`tests/e2e/lullaby.spec.ts`, chromium + webkit, like `sequence.spec.ts`: `openFrozen` waits for `data-pp-audio="running"`, values read from the live content, real taps not 6 px from an icon):
    - The overlay's « Start »: `data-pp-sequence="lullaby_walk"`, the bar reads « Calme », the level stems off, the pad on.
    - A real tap in a window: `data-pp-beat-hits` climbs, `beat_hit` in `__PP__.cueLog()`. Space and a tap each work. A tap on the pause button pauses and costs nothing.
    - A tap on a decoy and a stray tap: `baby_stirred`, the bar falls, `data-pp-baby-wake` matches the JSON. In Chromium, the vibration patterns (WebKit has no `navigator.vibrate`).
    - Doing nothing: `baby_woke`, `sequence_failed`, `data-pp-sequence-outcome="failed"`, the baby still carried.
    - `?autoplay=perfect`, started by `__PP__.send`: `outcome` `succeeded`.
    - The `music` volume at 0: the ring and the vibrations still come.
    - The ring and the decoy's ring, **screenshot at 667 × 375, looked at**, and under reduced motion. No screenshot reference should move: if one does, find out why before regenerating anything.

24. **Docs.**
    - `project-context.md`: a « The lullaby walk (story 4.5) » paragraph (the timeline, the two cursors, `classifyTap`, the wake, the scheduler's re-plan rule, **the one correction of D1**), `snapshot version 21`.
    - `deferred-work.md`: this story's open points.
    - Do not edit the architecture or the GDD. The architecture's L798 « Les séquences rythmiques (E4) utilisent `audioOffsetMs` » is met by D1; say so in the Completion Notes.

25. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [ ] **T1. Content** (AC 1-4)
  - [ ] T1.1 The `beats` kind, `babyAwake`, `calmLeft`, the pairing refine, the `failSequenceOnGag` narrowing, `lullaby_walk.json`, `content:schemas`.
  - [ ] T1.2 `feedback.json` keys, cues, strings; placeholder clips (commit only the new `.m4a`).
  - [ ] T1.3 `content:check` rules and `simLevelOf` invariants, with tests.
- [ ] **T2. Sim** (AC 5-12)
  - [ ] T2.1 `beatClock.ts` with its tests, `SimSequence.beatTimelines`.
  - [ ] T2.2 The slice, `TapBeat`, the events, `isSettled`, `lullabyWalk.ts`.
  - [ ] T2.3 `classifyTap`, the stir, the failure and the success.
  - [ ] T2.4 Snapshot v21; the sim tests of AC 20; the fuzz test.
- [ ] **T3. Client** (AC 13-18)
  - [ ] T3.1 Loop getters, `beatScheduler.ts`, its deterministic sync tests **before any wiring**, D1's arithmetic test.
  - [ ] T3.2 `inputMapper`, `beatRing.ts`, the bar, mirrors, `beatLog`.
- [ ] **T4. Tools and tests** (AC 19, 21-23)
  - [ ] T4.1 The bots and the report; both tables pasted.
  - [ ] T4.2 Goldens (regenerate, diff, add the two scenarios).
  - [ ] T4.3 `tests/e2e/lullaby.spec.ts`; touched specs.
- [ ] **T5. Docs and CI** (AC 24, 25)

## Dev Notes

### Decisions (D1-D7)

- **D1. `audioOffsetMs` is one correction: the notes lead by `audioOffsetMs - visualOffsetMs`, and the taps keep `visualOffsetMs`.** The documents pull two ways: the epic corrects the **planning** by `audioOffsetMs` (L1922), the architecture the **judgement** (L798). Doing both counts the latency twice, and every player above 0 ms would read late or early by a whole offset, which in a 180 ms window is the game. Calibration measures `tap - beep` (`computePhaseOffset`, `input/calibration.ts`): a player taps `audioOffsetMs` after the sound they are told to follow, and that stamp is then corrected by `visualOffsetMs` in the mapper. So a note at `beatAt - (audio - visual)` is tapped at `beatAt + visual`, and reads as `beatAt`. Why this and not « notes on time, taps minus `audioOffsetMs` »: the mapper keeps its single rule (story 2.7), `SetInputLag` stays right, the ring and the sound stay together on screen, and a skipped audio phase is 0 with no special case. Geo may overrule; open point 2.
- **D2. A beat is not a threat.** The architecture's « P1 généralisé : un temps = une fenêtre » is the judgement (`effectiveWindow`, `judgePress`), not the instance: a threat per beat would mean a marker, a verb, a glide, a gag and a rearm for each of 46 notes. So a new command, `TapBeat`, with no `threatId`: the sim decides the beat from `t` alone. The rule « every command targets one explicit `threatId` » is about threats, and here there is nothing to choose between.
- **D3. The notes are planned one by one, not a track at a tempo.** A looped stem cannot slow down from 90 to 60 and stay on the sim's instants, and `playbackRate` would bend the pitch. The planned notes also make a slow-mo and a pause one rule (AC 13).
- **D4. A stray tap costs something** (`strayWakePct`). The epic names only the decoy and the miss, but with both free a player could mash at 6 taps a second and hit every window. A second tap in a window is a stray for the same reason. The count-in is free. Set it to 0 to feel the difference.
- **D5. Waking the baby costs no noise and no cry.** The epic says « réveille un peu le bébé, selon la tolérance » and asks for no noise, and a real cry would feed the gauge (4.4's D4). The failure is `BabyWoke`, the sequence ends, the note goes on.
- **D6. A step earns nothing.** One combo point per note would max x8 in eight notes and pile 46 base points: 4.2's « response » means a parry of a threat. The carry tick keeps running, as in `stay_awake`. A miss is not a gag and does not reset the combo.
- **D7. The decoys are a fixed list, not a draw** (`decoyBeats`). Rhythm games teach by pattern; and with no rng, the sequence is the same for every seed and a bot's run is easy to read. Geo moves them in the JSON.

### Current state of the files this story changes (read before editing)

- **`src/sim/sequences/sequenceSteps.ts`:** `StepHandler` L11, `MICRO_SLEEPS` L35, `HANDLERS` L60. A kind added to the union does not compile without its entry. **Keep:** `enter` and `tick`.
- **`sequenceSystem.ts`:** the step change L31-43, the end test L47-50 (**it names the micro-sleep; it moves into the handler**). **`sequenceStart.ts`:** the slice reset L70-77 gains `beat`. **`sequenceEnd.ts`:** `closeSequence` L26, `failSequenceOnGag` L67, which imports no threat code (`threatFsm` imports it): `stirBaby` must call the shared end without importing `threatFsm`, or a cycle comes back.
- **`src/content/schemas/sequence.ts`:** kinds L15, failure L60, bar values L89. **`sequenceDurationMs` stays in content:** the sim has its own `stepsDurationMs` (`sequenceStart.ts` L38), because the sim may not pull `zod`.
- **`src/client/audio/audioEngine.ts`:** `playOneShotAt` L79 with `cancel`, `playClip` L370: **returns null while the context is not running** (L378). `setSequenceMusic` L576 needs no change, and neither do `setMusicMuted` and `isSequenceMusicOn` in `boot.ts` L344, L903.
- **`src/client/loop.ts`:** `clockMs` and `simPerRealMs` are local at L249-259. **`simPerRealMs` is 0 while frozen or paused.** **`src/client/timeMap.ts`:** no change. **`boot.ts`:** the per-frame block L892-903, `visualOffsetMs` L339, mirrors L265-282, L617, `events.on('PauseRequested')` L457.
- **`src/client/input/inputMapper.ts`:** `toSim` L184, `isHeldInPlace` L199, `act` L250-333, `handlePointerDown` L393-431.
- **`src/bots/`:** `perfectBot.ts`, `humanBot.ts`, `randomBot.ts`, `threatTiming.ts` (memories). `random` draws `nextInt(rng, 0, 4)` for each action: the beat tap must branch **before** that draw, only in a beat step.
- **Must not change:** `stay_awake` and its behaviour, judgement of threats, `effectiveWindow`, `judgePress`, `toSim`, `SetInputLag`, the calibration, rng draws when no `beats` step runs, `tokens.css`, `HUD_MAX_DOM_NODES`.

### Architecture compliance

- Pure sim, serialisable `World`; no real time, no log; no `Math.random`; events past tense with `t`; **`Math.round` is fine, it is deterministic.**
- Units: `bpmStart`, `bpmEnd` (BPM is its own unit), `leadInMs`, `windowMs`, `offsetMs`, `wakePct`, `missWakePct`, `decoyWakePct`, `strayWakePct`, `nextBeatAt`, `plannedAtS`, `audioNowS`, `scheduleAheadMs`, `replanToleranceMs`, `approachMs`. `countInBeats` and `decoyBeats` count beats. Booleans `is…`. `MS_PER_MINUTE` moves to `@shared/constants` (today a local copy in `input/calibration.ts` L13 and `ui/screens/calibrationScreen.ts` L80: both import it from there). No literal UI text.
- Client imports `@sim` only: `beatTimelineOf`, `isBeatStepRunning`, `BABY_STIR_REASONS`. Debug and bots stay out of the client's static imports.
- Every cue with `audio` has `visual` and `haptic`; the notes' twins are AC 16. Windows are in sim time: a slow-mo widens them, on purpose. Reduced motion never changes sim timing.
- Variance: `levelFlow.ts` as in 4.4. The architecture's file `src/sim/sequences/lullabyWalk.ts` is used as named.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned, so no web research was needed. `AudioBufferSourceNode.start(when)` and `suspend()` freezing `currentTime` are already relied on by the calibration and the pause. The calibrated offsets already contain the device's output latency: **do not add `baseLatency` or `outputLatency` on top.**

### File structure

New: `content/sequences/lullaby_walk.json`; `src/sim/sequences/{beatClock,lullabyWalk}.ts` and tests; `src/client/audio/beatScheduler.ts`, `src/client/ui/world/beatRing.ts` and tests; the new `public/assets/audio/*.m4a`; `tests/support/testLullaby.sequence.json`; `tests/e2e/lullaby.spec.ts`; `tests/golden/lullabyWalk.test.ts` and journals.

Updated: `src/content/schemas/{sequence,feedback}.ts`, `src/content/feedbackClips.ts`, `content/{feedback,strings.fr}.json`, `content/levels/salon_crawler.json`, `content/_schemas/*`; `src/sim/{world,events,commands,context,createSim,snapshot,index}.ts`, `sequences/{sequenceSystem,sequenceSteps,sequenceStart,sequenceEnd}.ts`; `src/bots/{perfectBot,humanBot,randomBot,threatTiming}.ts`; `src/client/{boot,loop}.ts`, `input/inputMapper.ts`, `ui/hud/sequenceBar.ts`, `ui/world/worldUi.ts`, `ui/styles/ui.css`, `app/testHost.ts`; `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/build/inspectDist.ts`, `tools/sim/simReport.ts`; tests next to each, `tests/golden/*`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ carry: CARRY, sequences: [...], sequenceDefs })` and `stepN`. `STEP_MS` from `@shared/constants`, never a literal.
- `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/lullaby.spec.ts tests/e2e/sequence.spec.ts tests/e2e/calibration.spec.ts tests/e2e/ui.spec.ts tests/e2e/feedback.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.

### Previous story intelligence (4.4)

- **Its review found, and this story must not repeat:** `@content` runtime in the sim (`zod`); step dispatch outside `HANDLERS`; `skippedSequenceMusic` not cleared; `setSequenceMusic` re-latching between levels; the bar emptying on slide-out; a `content:check` hole that lets a sequence be won trivially (hence AC 4's « no judged beat at all »); tests whose title claims more than they check; markers missing from `PROD_FORBIDDEN_MARKERS`; snapshot round trips with nothing in flight.
- **The HUD was at 38 of 40 nodes before the bar:** the ring goes in the world layer, not the HUD.
- **A 5 s test timeout under load** on `botContract` is known: rerun with `VITEST_MAX_WORKERS=5` and say so.
- **`__PP__.fx()`'s zoom key is `cameraZoom`**, not `zoom`.
- **The bots never put the baby down after a sequence** (4.10): the `perfect` bot's stars fall after any sequence on `salon_crawler`, as in 4.4's table. This is expected, not a finding.

### Git intelligence

Recent commits are 4.4, merged into `main` (`d8c93f3`). Commit convention: « Story 4.5 : <titre> », « Story 4.5 : corrections de la revue de code ». `main` only receives the merge after Geo's OK. This branch is `story/4-5-les-100-pas-en-rythme`, in its worktree, with its `npm ci` already done.

### Project Structure Notes

Paths follow the epic and the architecture. No conflict. Variance: the bar's `calmLeft` is a new value next to 4.4's `timeLeft`, which the DESIGN's « player resources (calme…) » calls for.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 19, 21).
- Layer rules; the sim never logs; I/O returns `Result`; no silent `catch`, every fallback logs a `warn`.
- Systems never call each other, helpers are fine. Zero allocation in hot paths: the scheduler runs every frame.
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes. Bind keys by `code`. Every action works by touch, keyboard and gamepad.
- The player never reads that they failed: « Calme », no « échec »; `failed` lives in code only.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **Papa does not walk.** « Les 100 pas » happen on the spot, with a sound and a ring at each step, because 4.4's D3 holds Papa still until 4.9. If it feels wrong, a small sway on each hit is cheap, and real pacing needs that guard moved earlier.
2. **D1 chooses between two documents** (epic L1922, architecture L798): the sound leads, and the taps keep their usual correction. The felt result is the same for the judgement, but tell me if you would rather keep the sound on the game's clock.
3. **A step earns nothing** (D6), and a won `lullaby_walk` pays only through the carry tick. A bonus at the end is your call.
4. **The tolerance is a guess:** about 46 judged beats, 9 misses or 5 decoys or 17 stray taps to wake him, and no recovery on a hit. Tune `missWakePct`, `decoyWakePct`, `strayWakePct`.
5. **40 s and about 50 beats, not 100.** The GDD caps a sequence at 60 s, which at this tempo is about 75. Tune `durationMs`.
6. **The windows follow the tier and the fatigue**, the usual rule. After `stay_awake`, fatigue may have shrunk 180 ms noticeably. Say if a rhythm window should ignore fatigue.
7. **A stray tap costs** (D4). Rhythm Heaven forgives more. `strayWakePct: 0` is one edit.
8. **A decoy is a baby's coo on the off-beat, a dashed ring and a vibration** identical to a beat's. If the vibration makes it unfair on a muted phone, it can go.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L1807-1809, L1910-1930, L2041]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L136-146, L296-306, L381]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L497, L785-805, L966]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L396-397, L465, L527-528; EXPERIENCE.md L124, L208-209]
- [Source: _bmad-output/project-context.md (Engine rules: Special sequences, Carrying the baby, The combo; Time & input judgement; Feedback; Testing)]
- [Source: _bmad-output/implementation-artifacts/4-4-cadre-des-sequences-speciales-et-rester-eveille.md (Decisions, Review Findings); 2-7 (calibration, `SetInputLag`); 2-6; 2-8]
- [Source: src/sim/sequences/*, timing/{effectiveWindow,judge,difficulty}.ts, threats/threatFsm.ts; src/client/audio/audioEngine.ts, loop.ts, timeMap.ts, input/{inputMapper,calibration}.ts, app/calibrationFlow.ts, ui/world/papaHint.ts, boot.ts; src/bots/*; content/sequences/stay_awake.json]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
