---
baseline_commit: acc51534b71b04c6695a6debaa9e1b88c8625047
---

# Story 4.5: The hundred steps, in rhythm

Status: review

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
         "decoyBeats": [20, 25, 30, 35, 40]
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
   - a decoy whose hit zone (`windowMs × the widest tier + 2 × toleranceMs`) is wider than its distance to the nearest beat (review fix: the zones would overlap);
   - no judged beat at all;
   - `calmLeft` on a def without `babyAwake`;
   - a `beats` step beside any other step (it is the only step of its sequence), and a `babyAwake` failure whose three costs are all 0 (review fixes).

### The sim

5. **The beat timeline** (`src/sim/sequences/beatClock.ts`, pure, exported by `src/sim/index.ts`, **no zod and no `@content` runtime import**, the review fix of 4.4). `beatTimelineOf(step)` returns `readonly BeatEntry[]`, `{ offsetMs, kind: 'countIn' | 'beat' | 'decoy', judgedIndex }`, sorted by `offsetMs`, from the step's start:
   - the first entry is at `leadInMs`;
   - the next beat is `prev + Math.round(MS_PER_MINUTE / bpmAt(prev))`, where `bpmAt` is linear from `bpmStart` at the first beat (`leadInMs`) to `bpmEnd` at `durationMs` (so the first gap is 667 ms; `bpmEnd` itself is never played), and the gap is at least 1 ms (review fix: a huge tempo cannot hang the loop; the schema also caps both tempos at 300 BPM). **Whole ms**, so the journals and the tests read clean numbers;
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
   2. **Misses.** While `now >= beatAt + windowMs / 2 + toleranceMs + world.input.lagMs + LATE_TAP_GRACE_MS` (two sim steps: a tap stamped just after the window reaches the sim a frame later and must still find its beat open, review fix) for the entry at `judgeIndex`: `BeatMissed`, the stir of AC 10 (nothing if its cost is 0), advance.
   3. **Cues.** While the entry at `cueIndex` is due: `BeatCued` or `DecoyCued`. This cursor is separate on purpose: **a beat hit early has not been announced yet, and it still must be.**

9. **`classifyTap`** (pure, in `beatClock.ts`, unit-tested on its own):
   - **The window goes through `effectiveWindow`** (tier × fatigue, neutral instinct: read `threatFsm.ts` L66-70) **with `bufferMs` forced to 0** in the stored copy: the buffer keeps a press that is early, which in rhythm would swallow the off-beat. The judgement is `judgePress(t, beatAt - windowMs / 2, window)`.
   - A tap before the first judged beat's window (the lead-in and the count-in): **free**, no event (tapping along is what a player does).
   - The candidates are the beat at `judgeIndex` and the decoy just before it, if not spent. **Nearest centre wins, a tie goes to the beat** (at a wide tier the two windows can overlap).
   - On the beat, `perfect` or `success`: `BeatHit`, advance (`isDecoySpent` back to false).
   - On the beat, `late`: settles it as a miss (`BeatMissed`, stir `missed`): one tap never pays twice (the grace of AC 8 keeps the beat open long enough for that to hold at `lagMs` 0).
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
    - **The one honest exception, say it in the test:** a change of rate in the frame just before a note has sounded cannot be undone, because the note is already out. For a rate change from `old` to `new` one frame before a note that was already out, the gap is at most one frame times `|old − new| / new` (about 39 ms entering a ×0.3 slow-mo at 60 fps, 12 ms leaving it; review fix: the first wording, « one frame times `1 − scale` », was the wrong bound, the code and the test always used this one). The assertion excludes **only** a note within one frame after a change of rate, and pins that bound for it.
    - **`tests/e2e/lullaby.spec.ts`, real Web Audio, Chromium:** plays through a slow-mo (`SetTimeScale`) and a real pause, then computes the same gap from `__PP__.beatLog()`. A context that does not reach `running` fails the test; it does not skip it. **Its exception is wider than the deterministic one, on purpose** (review fix): a real browser's frames are not 16.67 ms and its audio clock moves in quanta, so a note within 250 game-ms of a change of rate is bounded at a flat 45 ms there, every other note at 10 ms, none is dropped from the check, and at least 12 are held to 10 ms; the exact `|old − new| / new` bound is the deterministic test's.

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

- [x] **T1. Content** (AC 1-4)
  - [x] T1.1 The `beats` kind, `babyAwake`, `calmLeft`, the pairing refine, the `failSequenceOnGag` narrowing, `lullaby_walk.json`, `content:schemas`.
  - [x] T1.2 `feedback.json` keys, cues, strings; placeholder clips (commit only the new `.m4a`).
  - [x] T1.3 `content:check` rules and `simLevelOf` invariants, with tests.
- [x] **T2. Sim** (AC 5-12)
  - [x] T2.1 `beatClock.ts` with its tests, `SimSequence.beatTimelines`.
  - [x] T2.2 The slice, `TapBeat`, the events, `isSettled`, `lullabyWalk.ts`.
  - [x] T2.3 `classifyTap`, the stir, the failure and the success.
  - [x] T2.4 Snapshot v21; the sim tests of AC 20; the fuzz test.
- [x] **T3. Client** (AC 13-18)
  - [x] T3.1 Loop getters, `beatScheduler.ts`, its deterministic sync tests **before any wiring**, D1's arithmetic test.
  - [x] T3.2 `inputMapper`, `beatRing.ts`, the bar, mirrors, `beatLog`.
- [x] **T4. Tools and tests** (AC 19, 21-23)
  - [x] T4.1 The bots and the report; both tables pasted.
  - [x] T4.2 Goldens (regenerate, diff, add the two scenarios).
  - [x] T4.3 `tests/e2e/lullaby.spec.ts`; touched specs.
- [x] **T5. Docs and CI** (AC 24, 25)

### Review Findings

Code review, **group 1 of 3** (`src/sim`, `src/content`, `content`, `src/shared`; 34 files). Groups 2 (`src/client`, `src/bots`, `src/debug`) and 3 (`tests`, `tools`) are still to review. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Dismissed as noise: 2 (`carryFuzz.test.ts` not extended, the 30-seed random-taps test in `lullabyWalk.test.ts` covers the invariant; one small allocation per tap in `classifyTap`).

- [x] [Review][Patch] **Decided by Geo: option (a).** A tap stamped within one step after a window closes counts as late for that beat (one cost, `miss`), never `miss` + `stray`; pin it with a test at `lagMs` 0, and a decoy tap under a large `SetInputLag`. Original finding: a late tap pays twice at `lagMs` 0, against « one tap never pays twice » (AC 8) — `tick` judges the taps, then closes the beats. A tap stamped just after a window closes reaches the sim on a later step, after the clock has already missed the beat and moved the cursor: it is then judged against the next beat as early, hence `miss` (12) plus `stray` (6). The `classifyTap` `late → miss` branch is only reached with `lagMs` > 0 or when tap and close fall in the same step (the only test forces `lagMs: 400`). Related: with a `SetInputLag` larger than the real tap delay, the cursor stays on beat n until `n + 150 + lagMs`, so a tap meant for the decoy (zone opening at about `n + 183`) is judged `miss` against n. Options: (a) a tap stamped within one step of a close counts as late for that beat (the tick holds the close one step back, or `judgeTap` looks at the beat that just closed); (b) keep the behaviour, correct AC 8 / the doc and pin « late tap = miss + stray » in a test. Sources: blind+edge. [`src/sim/sequences/lullabyWalk.ts:146`, `:205-209`, `beatClock.ts` `classifyTap`]
- [x] [Review][Patch] **Decided by Geo: option (a), harden the validator.** On steps with decoys, `sequenceBeatProblems` checks `windowMs × maxTierMultiplier + 2 × toleranceMs` against half the shortest beat gap; if `lullaby_walk.json` fails it, retune it (and say so); tests for the refusal and for the shipped content. Original finding: the `windowMs` validator ignores the decoy, the tier and the tolerance — `sequenceBeatProblems` only checks `windowMs < shortest beat gap`. A beat's real zone is `windowMs × tier × fatigue + 2 × toleranceMs`; a decoy sits at half a gap. With the shipped values (180 ms, ×1.5 at the assistance tier, 60 ms tolerance) the zones are ±195 ms and the decoy's zone overlaps the previous beat's from 138 ms after it, so a double-tap about 150 ms after a hit is billed as a decoy (20) instead of a stray (6). Nothing is reported. Options: (a) validate against `windowMs × maxTierMultiplier + 2 × toleranceMs` versus half the shortest gap on steps with decoys (may refuse `lullaby_walk.json`: then retune it); (b) document it as tuning for Geo and leave the validator. Sources: blind+edge. [`src/sim/sequences/beatClock.ts` `sequenceBeatProblems`]
- [x] [Review][Patch] **Decided by Geo: option (a), silent.** `stirBaby` emits `BabyStirred` only when `deltaPct > 0` (a free stray still emits `BeatStrayTapped`); fix the `BabyStirred` doc, a test at `strayWakePct: 0`, check the goldens and the client / bots that count `BabyStirred`. Original finding: a zero-cost stir still plays the stir sound and haptic — `stirBaby` always pushes `BabyStirred` (`deltaPct` may be 0) and the event maps to the `baby_stir` cue. With `strayWakePct: 0`, which open point 7 advertises as « one edit » to forgive strays, a stray still sounds and vibrates as if the baby stirred. Options: (a) emit `BabyStirred` only when `deltaPct > 0` (then a stray with no cost is silent, the `BeatStrayTapped` event still exists); (b) keep it, a stray is audible feedback by design, and say so in open point 7. Source: auditor. [`src/sim/sequences/lullabyWalk.ts:73-93`]
- [x] [Review][Patch] `beatTimelineOf` never ends on a BPM of 120000 or more: `Math.round(60000 / bpm)` is 0, the offset does not move and the array grows until out of memory. `content:check` and `simLevelOf` both call it before any check, so a typo hangs the validator instead of producing the AC 4 refusal. Clamp the gap (`Math.max(1, …)`), add a `.max()` on `bpmStart` / `bpmEnd` (300), `npm run content:schemas`, and a test. Sources: blind+edge+auditor. [`src/sim/sequences/beatClock.ts:58-60`, `src/content/schemas/sequence.ts:56-60`]
- [x] [Review][Patch] A `beats` step that is not the last one loses its open beat silently: `clearBeatSlice` runs on every step change, so the last open window and the remaining cues vanish with no `BeatMissed`, and `wakePct` resets at the next `beats` step. The schema also accepts a `microSleeps` step beside a `beats` step, and its gags are then inert (`failSequenceOnGag` returns for a `babyAwake` failure). No content uses either. Refuse both in `sequenceBeatProblems` (a `beats` step must be the last and the only step kind with `babyAwake`), with tests; 4.9 / 4.10 can lift it. Sources: blind+edge+auditor. [`src/sim/sequences/sequenceSystem.ts:42`, `sequenceEnd.ts:84-86`, `sequenceBeatProblems`]
- [x] [Review][Patch] Fractional wake costs may never reach 100 (33.3 three times is 99.9…) and a step with the three costs at 0 can never be lost. Make `missWakePct`, `decoyWakePct`, `strayWakePct` integers (`.int().nonnegative()`), refuse the all-zero trio in `sequenceBeatProblems`, regenerate the schemas, test. Source: edge. [`src/content/schemas/sequence.ts`, `src/sim/sequences/lullabyWalk.ts:81`]
- [x] [Review][Patch] Docs that say what the code does not: AC 5 and the `bpmEnd` / `durationMs` descriptions say the tempo is linear from `bpmStart` to `bpmEnd` « over the step » and « reached at the end », but `bpmAt` runs from `leadInMs` to `durationMs`, `bpmEnd` is never reached (last gap 979 ms, not 1000) and the tempo is the one at the previous beat (deliberate, Completion Notes, to satisfy « first interval 667 ms »). Align the `.describe()` strings, the `beatClock.ts` header, the AC 5 text and regenerate the schemas. Also: the `BabyStirred` doc says `deltaPct` is 0 « when it was already at 100 » (impossible, the sequence ends at 100), and the random-taps test comment says « some in the past of the sim » (none is). Sources: blind+auditor. [`src/sim/sequences/beatClock.ts` header, `src/content/schemas/sequence.ts:51`, `src/sim/events.ts`, `lullabyWalk.test.ts`]
- [x] [Review][Patch] Test « holds wakePct at 100 and does not judge the commands left in the step that woke him » never wakes the baby: it taps four times early and asserts `wakePct` 0 with no `BabyStirred`. The early return after `judgeTap` once the baby wakes has no test. Rewrite it so that a wake mid-queue leaves the following `TapBeat`s unjudged; drop the pointless `def: { ...DEF, failure: { ...DEF.failure } }`. Source: blind. [`src/sim/sequences/lullabyWalk.test.ts`]
- [x] [Review][Patch] The snapshot round-trip tests never carry a non-zero state: `playing()` taps every beat dead on and never the decoy, so `wakePct` is 0 and `isDecoySpent` false in every restored snapshot, while the file header quotes 4.4's « a round trip with nothing in flight proves nothing ». Add a round trip with a stirred baby (`wakePct` in 1-99) and a spent decoy. Source: blind. [`src/sim/sequences/lullabySnapshot.test.ts`]
- [x] [Review][Patch] Stale test titles after the snapshot bump to v21: « is version 20 and carries the gauge and the flag » and « is the current version (19), … » in `snapshot.test.ts` assert 21. Rename. Sources: blind+auditor. [`src/sim/snapshot.test.ts`]
- [x] [Review][Patch] The schema and `sequenceBeatProblems` duplicate rules and have drifted: « beats needs babyAwake » / « babyAwake needs beats » is worded twice, `calmLeft` needs `babyAwake` is only in the validator, and the step's `track` pattern `^[a-z][a-z0-9_]*$` is looser than the `beatTracks` key pattern (an id like `a__b` passes one layer and never resolves). Say each rule in one place (the schema when it is a pure shape rule) and align the patterns. Source: blind. [`src/content/schemas/sequence.ts`, `beatClock.ts` `sequenceBeatProblems`]

**Group 1 fixes applied (all 11 patches), things to know:**
- **The late-tap grace is two sim steps (`LATE_TAP_GRACE_MS` = 20 ms), not one.** A tap reaches the sim at the first step of the next frame, up to a 60 fps frame (about 17 ms) after its stamp; one step would not have held it. `BeatMissed` and its stir therefore come 20 ms later than before. The mutation check (grace 0) fails the new `lagMs` 0 test.
- **`content/sequences/lullaby_walk.json` is retuned: `decoyBeats` goes from `[7, 15, 23, 31, 38]` to `[20, 25, 30, 35, 40]`.** The hardened validator refused decoys 7 and 15: at the assistance tier a hit zone is 180 × 1.5 + 2 × 60 = 390 ms wide, and a decoy sits 356 ms and 376 ms from its beats there; from beat 20 on the gaps are 782 ms or more. `windowMs` stays 180 (FR40). Geo may prefer a narrower window or fewer early decoys: the rule says what it takes.
- **The frozen test def moves its decoy from beat 3 to beat 4** for the same reason (`tests/support/testLullaby.sequence.json`), and `lullaby_walk_woken` is rewritten around it. `npm run golden:update` was run on purpose: only the two lullaby journals and their references moved (the formatting-only change to `mama_woke.expected.json` was reverted).
- Schema: both tempos capped at 300 BPM, wake costs whole percents, the track id uses the feedback cue pattern (now exported), and the shape rules say the same words as `sequenceBeatProblems` (which takes the widest tier and the tolerance, `beatWindowLimitsOf(feel)`). `npm run content:schemas` regenerated `sequence.schema.json`.
- `ci:fast` is green and `lullaby.spec.ts`, `sequence.spec.ts`, `testApi.spec.ts` pass on Chromium. Groups 2 and 3 are not reviewed yet; the full `npm run ci` is for the end.

#### Group 2 of 3 (`src/client`, `src/bots`, `src/debug`, the audio assets)

Dismissed as noise: 7 (a note dropped by a frame longer than the horizon is the specified « drop when late » and the `log.debug` is its trace; a `null` handle from an undecoded clip is retried only until the note is late by `scheduleAheadMs`, then dropped, so it cannot stall the later notes; `calmLeft` read outside a beats step, now that a beats step is alone in its sequence; `stepStartAt` derived from `stepEndsAt`, which is how the sim derives it; the bots' `lastBeatAt`, one bot per run; the ring update inside the `world !== undefined` block, which still runs when the timeline is null; the per-note `onSounded` object).

- [x] [Review][Patch] **Decided by Geo: option (a).** A failed end drops the calm bar to 0 for its slide-out (`bar.setPercent(0)` on `SequenceEnded{failed}`, or `percentOf` given the outcome); change the test that pins the old value, and keep « a won bar keeps what it showed ». Original finding: the calm bar does not show the stir that wakes the baby — the last stir (say 88 → 100) and `SequenceEnded{failed}` fall in one sim step, `clearBeatSlice` resets `wakePct` to 0 and `id` to null, and from the next frame the bar is « not wanted »: it keeps its last shown value (12 %, a test pins it, « a failed bar must not empty while it is still seen») and slides out. The baby is awake, the bar says he is nearly calm. Options: (a) a failed end drops the calm bar to 0 for its slide-out (`bar.setPercent(0)` on `SequenceEnded{failed}`, or `percentOf` knows the outcome); (b) keep it: the bar shows the last frame the player saw, the red `sequence_failed` / `baby_woke` cues say the rest. Source: edge. [`src/client/ui/hud/sequenceBar.ts:139`]
- [x] [Review][Patch] **Decided by Geo: option (a).** The decoy ring's start is clamped to the previous note's time (`startsAt = max(decoyAt − approachMs, previousNoteAt)`, a shorter approach for the decoy, no jump); test it at 90 and 60 BPM. Original finding: the decoy's ring starts before the previous beat's ring has closed — `startsAt = decoyAt − approachMs`; once the gap is under `2 × approachMs` the decoy ring appears at about 33 % progress while the single pooled ring is still closing on the previous beat, a visible jump (all tempos above 60 BPM). Options: (a) clamp the start to the previous note's time (a shorter approach for the decoy, no jump); (b) leave the code and tune `beatRing.approachMs` in `feedback.json` below half a gap (a data edit for Geo, no code). Source: edge. [`src/client/ui/world/beatRing.ts:119`]
- [x] [Review][Patch] The scheduler's horizon ignores `leadMs`: a note is planned once the beat is within `scheduleAheadMs` (150 ms), then `atS = … − leadMs`. With a lead of 180 ms (audio 220, visual 40: a Bluetooth player) `atS` is already 30 ms in the past and every note starts late by `lead − 150`; from a lead of about 290 ms `atS − nowS` falls under the late limit and every note is dropped, so the lullaby is silent. Plan on `aheadRealMs − max(0, leadMs)` (the cancel test too), and add tests with leads of 150, 200 and 300. Sources: edge+auditor. [`src/client/audio/beatScheduler.ts:225-248`, `boot.ts:863`]
- [x] [Review][Patch] The audio clock and the game clock are not read at the same instant: `clockMs` is the loop's clock at the rAF timestamp `frameAtReal`, `audio.currentTimeS` is read in `onLevelFrame`, after the steps and the draw, so every note is planned late by that gap (2 to 10 ms) and its jitter beyond `replanToleranceMs` makes cancel / re-plan churn; `beatLog()` samples the same skewed pair, so the 10 ms e2e check cannot see it. Pass `audioNowS − (performance.now() − frameAtReal) / 1000` to the scheduler and to the sample, with a scheduler test where the two reads differ by a constant. Sources: blind+edge+auditor. [`src/client/boot.ts:991-997`, `beatScheduler.ts:196`]
- [x] [Review][Patch] The three debug mirrors go stale between two sequences of one level: `data-pp-beat-hits`, `data-pp-beat-misses`, `data-pp-baby-wake` and the counters are cleared at level start only, and `BabyStirred` is no longer emitted for a cost of 0, so a second walk (or a retry) shows the last wake (e.g. 100) until a stir. Zero them on `SequenceStarted`. Sources: edge+auditor. [`src/client/boot.ts:672-686`, `:1703`]
- [x] [Review][Patch] `onSounded` frees the sounded notes by pool slot, not in the order they were planned as its comment and `beatLog().notes` (« oldest first ») say; a slot reused by a later entry fires before an older one. Emit them in `entryIndex` order (no allocation: pick the lowest due slot each time), and pin it with a test that reuses a low slot. Source: blind. [`src/client/audio/beatScheduler.ts:200-212`]
- [x] [Review][Patch] Tests that cannot fail or only check arithmetic: « never holds more notes than its fixed pool » (`maxPending <= 16` is true by construction), « audioOffsetMs is one correction » (rebuilds the formula from `audioAtS` and a hand-written stamp, never `boot.ts`'s `leadMs` or the mapper's `visualOffsetMs`), « drops a note … » (`plans.length < 3`). Assert that notes are not starved at the pool limit, that the lead the frame carries is `audioOffsetMs − visualOffsetMs` (extract the arithmetic from `boot.ts` into a pure function and test it with the mapper's stamp), and the exact notes dropped. Source: blind. [`src/client/audio/beatScheduler.test.ts`, `src/client/boot.ts:863`]
- [x] [Review][Patch] Under reduced motion a count-in ring looks like a judged beat: `.pp-beat-ring--reduced .pp-beat-ring-disc` (opacity `0.2 + 0.8 × progress`) has the same specificity as `.pp-beat-ring--count-in .pp-beat-ring-disc` (`0.2 + 0.4 × progress`) and comes later, so neither shape nor opacity tells them apart, against the file's own « never colour alone ». Give the combined selector its own fainter formula, and make the `prefers-reduced-motion` media block say the same. Source: blind. [`src/client/ui/styles/ui.css`]
- [x] [Review][Patch] `BeatRing.hide()` resets `shownProgress` to 0 without resetting `--pp-beat-progress`, and the write is guarded by `progress !== shownProgress`: a ring that reappears at exactly 0 keeps the last ring's value. Reset the property in `hide()`, and assert the CSS property in the test. Sources: blind+edge. [`src/client/ui/world/beatRing.ts`]
- [x] [Review][Patch] `boot.ts` resets `beatHitCount` / `beatMissCount` before their `let` declarations and `createBeatScheduler` captures `beatSoundedListeners` declared after it: safe today only because the reset runs from callbacks. Declare them before their first use. Source: blind. [`src/client/boot.ts:1121-1131`]
- [x] [Review][Patch] AC 22 says the slow-mo bound is « at most one frame times `1 − scale` », and the test asserts `frame × |old − new| / new + 0.5` (39 ms entering ×0.3), which is the physically right bound (Completion Notes). Correct the AC 22 text to the formula the code and the e2e use, so that the spec stops disagreeing with its test, and fix the `worldUi.ts` comment (« Last, so that the other children keep their places »: the beat ring takes index 4 and the threat icons moved from 4 to 5). Sources: auditor. [AC 22, `src/client/ui/world/worldUi.ts`]
- [x] [Review][Defer] A second simultaneous finger is not a tap (`handlePointerDown` returns on `!isPrimary` before the beat branch): a resting thumb costs a rhythm tap. Every other tap behaves the same today; revisit with the touch controls — deferred, pre-existing. [`src/client/input/inputMapper.ts`]

**Group 2 fixes applied (all 12 patches), things to know:**
- The scheduler takes a new frame field, `clockAgeMs` (real ms between the loop's timestamp and the audio read, from `performance.now() − frameAtReal`, bounded at 100 ms), and pairs the audio time with the game clock of the same instant; `beatLog()` samples the same corrected pair, so the e2e gap check is no longer circular.
- The horizon opens by `max(0, leadMs)`; `beatLeadMs(calibration)` is the one place `audioOffsetMs − visualOffsetMs` is computed (the test of D1 calls it, so it covers the arithmetic `boot.ts` uses). Removing the horizon fix fails the lead 150, 200 and 300 tests.
- `sequenceBar.markFailed()` is the one event the bar is told (on `SequenceEnded{failed}`): a failed `calmLeft` bar slides out at 0, a time bar and a won bar keep what they showed. The old « keeps its last value after the baby woke » test is replaced.
- The ring never starts before the note before it: a decoy's approach is shorter (still 0 to 1), a beat farther than `approachMs` from the previous note is untouched.
- The mirrors reset on `SequenceStarted`. `ci:fast` is green; `lullaby`, `sequence` and `testApi` specs pass on Chromium. Group 3 (tests, tools) is not reviewed yet; the full `npm run ci` is for the end.

#### Group 3 of 3 (`tests`, `tools`)

No `decision_needed`. Dismissed as noise: 3 (the testApi title « twelve methods » is right, the array has twelve entries; `beatLog` in `PROD_FORBIDDEN_MARKERS` is as generic as `copyLog` beside it and the point of the list; the reduced-motion e2e covers the beat ring and the decoy ring is the same element and CSS).

- [x] [Review][Patch] The random-bot CLI test passes for the wrong reason: `beatsHit + beatsMissed + beatsStray + decoysTapped > 0` is true for a bot that never taps (the beats close untapped and count as missed). Assert `beatsHit + beatsStray + decoysTapped > 0` (the random bot cannot aim, strays are the expected effect), and make the idle test derive its miss count from the fixture (`ceil(100 / missWakePct)`, not a literal 4). Sources: blind+edge. [`tests/tools/sim/sequence.test.ts`]
- [x] [Review][Patch] The report's decoy, stray and miss counters and their aggregation are never pinned: swapping `decoysTapped++` and `beatsStray++` in the recorder, or summing the wrong field in `summarizeRuns`, passes every test. Add a recorder test fed `BeatHit`, `BeatMissed`, `DecoyTapped` and `BeatStrayTapped`, and a `summarizeRuns` test with distinct non-zero values for the four fields; and a test that a game cut by `--until-ms` in the middle of the walk keeps partial counters, as the help text says. Sources: edge+blind. [`tests/tools/sim/simReport.test.ts`, `tools/sim/simReport.ts`]
- [x] [Review][Patch] « Acts as it always did outside a beats step » compares two runs of the same code, so it cannot see the random bot's draws move; and « no `reactionMs` floor » uses beats at least 600 ms away, so a 250 ms floor could never bind. Pin the random bot's commands over 20 s with no beat step as a literal digest taken from `main`'s `randomBot` (run it on `main` and on the branch and compare), and give the human bot a beat closer than `reactionMs` to its first sight. Sources: blind+edge+auditor. [`tests/bots/beatBots.test.ts:89-129`]
- [x] [Review][Patch] The beat rules of `content:check` are skipped when `feel.json` is missing or broken (`feel === undefined ? [] : …`), though only the decoy-zone rule needs it. Pass a neutral `{ maxWindowMultiplier: 1, toleranceMs: 0 }` then, so the track, window, pairing, calmLeft and cost rules still report, with a test. Sources: blind+edge. [`tools/content/contentChecks.ts:667-676`]
- [x] [Review][Patch] The autoplay e2e sends `StartSequence` once and waits 60 s for an outcome: a refused start (Papa busy, a silence, a ringing phone, the perfect bot playing at ×4) is a 60 s timeout, not a clear failure. Wait for `data-pp-sequence="lullaby_walk"` (with a short timeout and the refusal's message) before the long wait. Sources: blind. [`tests/e2e/lullaby.spec.ts` autoplay test]
- [x] [Review][Patch] The e2e spec falls back silently on content drift: `DECOY?.judgedIndex ?? 0`, `DECOY?.offsetMs ?? 0`, `BEATS[i]?.offsetMs ?? 0` turn an emptied `decoyBeats` into confusing failures at offset 0. Throw at module load with a message when the live step has no decoy or too few beats for what a test taps. Sources: blind+edge. [`tests/e2e/lullaby.spec.ts:605`]
- [x] [Review][Patch] The real-audio sync e2e (AC 22): a fixed `waitForTimeout(1500)` where `data-pp-state` says paused; the skip keyed on a misnamed `hasVibrate()` (it is « is Chromium »); notes before the first sample dropped without a count; and the exception is wider than the AC (any note within 250 game-ms of a change, bounded at a flat 45 ms, not one frame at `|old − new| / new`). Replace the sleep with the state wait, rename the helper, count and assert the dropped notes, and say in the test and in AC 22 what the e2e excuses and why (every note measured 0.1 to 5.1 ms in the run); the strict bound stays in the deterministic test. Sources: blind+auditor. [`tests/e2e/lullaby.spec.ts:904-984`, AC 22]
- [x] [Review][Patch] The content-check tests hard-code live values: `[20, 500]`, `[20, 60]` (« the very last judged beat » is 44, not 60), `[7]` with `/hit zone is 390 ms wide … 180 × 1.5 + 2 × 60/`, `/6\d\d ms/`. Derive the judged count from the live step with `beatTimelineOf`, and the zone, the window, the multiplier and the tolerance from `lullaby_walk.json` and `feel.json`, so tuning `content/**` does not break them; make the « very last » test use the real last index. Sources: blind+auditor. [`tests/content/checkSequences.test.ts:197-248`]
- [x] [Review][Patch] `simLevelOf` has no test for three of its rules (the decoy hit-zone overlap, a beats step beside another step, all-zero wake costs); `sequenceLevel.test.ts` covers the other five. Add the three, in the words of `sequenceBeatProblems`. Source: auditor. [`src/sim/sequences/sequenceLevel.test.ts`]
- [x] [Review][Patch] Titles that overclaim: `feedbackSchema.test.ts` « names the lullaby track with its notes, count-in tick and decoy sound » asserts only the key and `notes.length > 0` (assert `countIn` and `decoy`, and refuse a track missing `decoy`, `bus` or `gainPct`); « keeps the frozen fixture a valid def of the same shape » compares nothing with the live def (compare the keys of the step, failure and framing); `sequence.spec.ts` says the first sequence « is the one selected » and asserts a count only (assert the select's value). Sources: blind+edge. [`tests/content/feedbackSchema.test.ts`, `tests/content/sequenceSchema.test.ts`, `tests/e2e/sequence.spec.ts`]
- [x] [Review][Patch] The unit-suffix test whitelists `bpmStart`, `bpmEnd` and `decoyBeats` by name in its regex, hiding the convention deviation instead of documenting it (D-notes say « BPM is its own unit »). Keep the exception but state it in the test, and drop `decoyBeats` (an array, never reached). Source: edge. [`tests/content/sequenceSchema.test.ts`]
- [x] [Review][Patch] The golden scenario taps at `(beatOffsetMs(2) + beatOffsetMs(3)) / 2`, which is a half millisecond when the offsets differ by an odd number (whole ms everywhere else). Use `Math.round`, and check the committed journal does not move. Source: blind. [`tests/golden/scenarios.ts`]
- [x] [Review][Patch] Placeholder audio: the pad comment « Whole cycles over the loop: no seam » is false (only 196 Hz is whole over 6 s; `fadeEnds` hides the seam), `noise * LULLABY_STEP_NOISE_GAIN * 4` hides a magic 4 in a named gain, and nothing ties a note's 520 ms to the shortest beat interval or lists the nine new clips. Fix the comment, name the factor, and add to `makePlaceholderAudio.test.ts` a test that each note clip is shorter than the live step's shortest interval and one that the clip names are those `feedback.json` uses. Sources: blind+edge+auditor. [`tools/audio/makePlaceholderAudio.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`]
- [x] [Review][Patch] Docs and notes drifted after the review fixes: the second pasted table of the Completion Notes (random: 78 hit / 97 missed / 6 decoys / 139 strays) is now 80 / 98 / 0 / 150 on the retuned decoys and the grace (re-run the four bots and paste again); `project-context.md` says a miss comes at `beatAt + windowMs / 2 + toleranceMs + input.lagMs` (the grace is missing), its list of `content:check` refusals lacks the decoy zone, the lone beats step and the all-zero costs, and it does not say `BabyStirred` is silent at cost 0; `deferred-work.md` says « 45 judged beats », the step has 45. Source: auditor. [`_bmad-output/project-context.md:50`, `deferred-work.md`, Completion Notes]
- [x] [Review][Defer] Every beat problem of `content:check` reports `jsonPath: 'steps'`, including failure and framing ones (`failure.kind`, `framing.bar`): `sequenceBeatProblems` returns sentences, not paths. A structured result (path + sentence) is the fix; the message already says what is wrong — deferred, low. [`tools/content/contentChecks.ts`]
- [x] [Review][Defer] `SEED + 9` is used by both `synthMusicTense` (`makePlaceholderAudio.ts:381`) and `cultSounds.ts:85`, against the new header's « one clip, one stream »; it predates this story and only the shared sound's timbre depends on it — deferred, pre-existing. [`tools/audio/makePlaceholderAudio.ts`]

**Group 3 fixes applied (all 14 patches), things to know:**
- The random bot's stream outside a beats step is pinned by a digest (`1e7b972f510ba5`) that I took on `main`'s `randomBot.ts` (a copy beside the branch's, removed after) and on this branch: the same.
- `content:check` no longer skips the beat rules when `feel.json` is missing: a neutral `{ maxWindowMultiplier: 1, toleranceMs: 0 }` keeps all but the decoy-zone rule running. The `content:check` tests now read the lullaby and the feel from `content/` and derive every number (judged count, zone, window), so tuning them breaks nothing.
- `tests/golden/journals/lullaby_walk_kept.json` moved on purpose (`npm run golden:update`): a tap was stamped at 4156.5 ms, now whole ms (4157). Only that line.
- `LULLABY_STEP_NOISE_GAIN` is now 1.4 (it was 0.35 with a hidden `× 4`): identical samples, no `.m4a` changed. The lullaby audio has tests that tie the note and tick lengths to the live shortest beat gap and list the nine clip names.
- The pasted CLI table is re-run (random: 80 / 98 / 0 / 150). `project-context.md` says the grace, the new refusals, the silent zero-cost stir, the lead horizon, the clock pairing and the calm bar. `ci:fast` is green, and `lullaby` and `sequence` specs pass on Chromium; the full `npm run ci` is for the end.

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
4. **The tolerance is a guess:** 45 judged beats, 9 misses or 5 decoys or 17 stray taps to wake him, and no recovery on a hit. Tune `missWakePct`, `decoyWakePct`, `strayWakePct`.
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

Claude Sonnet 5.5 (`claude-sonnet-5-5`), in the Claude desktop app (Code tab), on the story worktree `.claude/worktrees/4-5-les-100-pas-en-rythme`.

### Debug Log References

- A first run of `lullabyWalk.test.ts` hung: `createSimWithSystems` **replaces** the system list, so the « gag » test advanced no time. Fixed with `[...SYSTEMS, spy]`.
- The scheduler's deterministic test found a real bug before any wiring: a note planned for its old time, then pushed beyond `scheduleAheadMs` by a slow-mo, was never recomputed (the loop `break`s at the horizon). It is now cancelled (`cancelFrom`) and planned again when it comes back inside.
- `simPurity` refuses the identifier `window`: the beat's window parameter is `response` in `beatClock.ts` and `lullabyWalk.ts`.
- On WebKit a real Space tap was a stray: after `__PP__.advance` the loop's time map is flat only once a frame has recorded the new clock, so an input stamped before that is mapped between the old and the new clock. The spec waits 3 frames after each `advanceTo` (and `GameLoop.advance` now moves `clockMs`, so a frozen screenshot of the ring is right).
- `botContract.test.ts` times out at 5 s on a loaded machine (known, 4.4); it passes alone.

### Completion Notes List

- **Content (T1).** `beats` step kind, `babyAwake` failure, `calmLeft` bar value, a `superRefine` that pairs them, `failSequenceOnGag` narrowed to `gag` defs; `content/sequences/lullaby_walk.json`, the level lists it; `feedback.json` gains `beatTracks`, `beatScheduler`, `beatRing`, the pad loop and the four cues (`beat_hit`, `baby_stirred`, `beat_cued`, `decoy_cued`). Nine placeholder clips (seeds 21-26, none shared; only the new `.m4a` are in the change, the others untouched by `--only`). `sequenceBeatProblems` is the one function behind `content:check` and the `simLevelOf` invariants, so the words are the same; each rule has a failing test in `tests/content/checkSequences.test.ts` and in `sequenceLevel.test.ts`. `content:check` also looks for the track's clip files.
- **Sim (T2).** `beatClock.ts` (`beatTimelineOf`, `classifyTap`, pure, no zod), the `beat` slice with its two cursors, `TapBeat`, seven events (`BABY_STIR_REASONS` with its completeness proof), `lullabyWalk.ts` (commands, misses, cues, in that order; no `nextFloat`), `StepHandler.isSettled` (the end test no longer names a kind), the shared `failSequence`. **Snapshot v21**, with each beat field validated against the step's timeline; round trips in a count-in, an open window and just after a decoy, each continued to the end and hashed. `MS_PER_MINUTE` moved to `@shared/constants`.
- **Tempo, a precision of the spec.** « The first interval is 667 ms (90 BPM) » needs the tempo to be `bpmStart` at the **first note**, so `bpmAt` is linear from `leadInMs` (not from the step's start) to `durationMs`. Said in `beatClock.ts`.
- **Client (T3).** `GameLoop.clockMs` / `simPerRealMs` getters (and `levelSession.loopClock`); `beatScheduler.ts` with the pure `audioAtS`, a fixed pool of 16, the re-plan rule, zero-rate cancellation, retry on `null`, drop when late; `inputMapper` sends `TapBeat` (touch anywhere, Space, A) after the threat check, no marker, no release; `beatRing.ts` (one pooled `CSS2DObject`, driven by the clock) and its CSS; the bar's `calmLeft` through a `switch` without default; mirrors `data-pp-beat-hits`, `data-pp-beat-misses`, `data-pp-baby-wake` (also in `PROD_FORBIDDEN_MARKERS`, with `beatLog`); `__PP__.beatLog()`.
- **D1, `audioOffsetMs` once.** The notes lead by `audioOffsetMs − visualOffsetMs` (`boot.ts`, `updateBeatFrame`); the inputs keep `visualOffsetMs` in `toSim` alone, `SetInputLag` untouched. `beatScheduler.test.ts` proves the arithmetic with both offsets set (the tap reads exactly `beatAt`) and shows what the double correction would give (an error of a whole `audioOffsetMs`). **The architecture's L798 « Les séquences rythmiques (E4) utilisent `audioOffsetMs` » is met by D1**, as the story asked; the architecture and the GDD are untouched.
- **Synchronisation (AC 22).** Deterministic tests (fake audio, fake frames at 16.67 ms and 33 ms): no change, a ×0.3 slow-mo on frame boundaries and inside a frame, a 10 s pause and its resume, a hitstop, both offsets, a ×4 pool check: every gap ≤ 10 ms, bar the one honest exception, which the test excludes and bounds. **Deviation to know:** the bound is `frame × |old − new| / new`, not `frame × (1 − scale)` (a note already out when the clock slows by ×0.3 is up to 39 ms off at 60 fps, 12 ms when it speeds up again); the story's formula is the second case only. In the browser (`lullaby.spec.ts`, real Web Audio on Chromium, through a ×0.3 slow-mo and a real 1.5 s pause): 23 notes, every gap between 0.1 and 5.1 ms; the context must reach `running` or the test fails.
- **Bots and goldens (AC 19, 21), deliberate.** `npm run golden:update` was run and the diff checked: **the 14 existing journals moved in `worldHash` only** (one line each; the world gained the `beat` slice); `lullaby_walk_kept` and `lullaby_walk_woken` are new (frozen 10 s def, `tests/support/testLullaby.sequence.json`), pinned by `tests/golden/lullabyWalk.test.ts`.

  `main` (`d8c93f3`) against the branch, `salon_crawler`, seed 1, 20 runs, the four bots: stars, end reasons, success rate, score and gags identical; only the hashes move.

  | bot | source | stars (mean) | score (mean) | success % | gags | ends (timer/mamaWoke) |
  |---|---|---|---|---|---|---|
  | perfect | main | 5 | 90 | 100 | 0 | 20/0 |
  | perfect | branch | 5 | 90 | 100 | 0 | 20/0 |
  | human | main | 4 | 82.1 | 99.9 | 1 | 20/0 |
  | human | branch | 4 | 82.1 | 99.9 | 1 | 20/0 |
  | random | main | 1 | 20.3 | 2.2 | 759 | 20/0 |
  | random | branch | 1 | 20.3 | 2.2 | 759 | 20/0 |
  | idle | main | 1 | 20 | 0 | 762 | 20/0 |
  | idle | branch | 1 | 20 | 0 | 762 | 20/0 |

  `--sequence lullaby_walk --sequence-at-ms 5000`, same level, seed 1, 20 runs, the live 40 s def:

  | bot | started | won | lost | beats hit | beats missed | decoys tapped | strays |
  |---|---|---|---|---|---|---|---|
  | perfect | 20 | 20 | 0 | 900 | 0 | 0 | 0 |
  | human | 20 | 20 | 0 | 887 | 13 | 0 | 9 |
  | random | 20 | 0 | 20 | 80 | 98 | 0 | 150 |
  | idle | 20 | 0 | 20 | 0 | 180 | 0 | 0 |

  (Pasted again after the code-review fixes: the decoys moved to `[20, 25, 30, 35, 40]` and a miss comes 20 ms later, so the `random` row moved from 78 / 97 / 6 / 139; the other three rows did not.)

  `perfect` wins 20 of 20 with no miss, no decoy, no stray (45 judged beats a run); `idle` loses 20 of 20 on its 9th miss; `random` loses 20 of 20. **`human` wins 20 of 20** (13 misses and 9 strays in 900 beats, never enough to wake him): a finding for Geo, not tuned away (`deferred-work.md`). `tests/tools/sim/sequence.test.ts` pins `perfect` and `idle` over seeds 1 to 5 on the frozen def.
- **Ring, looked at (667 × 375).** The ring around Papa is legible at 40 % progress; the decoy's is dashed red with a ✕ over Papa; under reduced motion it keeps its full size. No screenshot reference moved (none was added or regenerated).
- **Not checked by me:** real audio on a phone and a device pass (`docs/playtest/device-measurements.md` is Geo's).
- **Full CI (T5):** `(unset VITE_DEBUG_ALLOWED; npm run ci)` green once on the branch (e2e:dist perf: 17115 frames, p95 16.7 ms, 43 draw calls max, 1538 triangles max).

### File List

New: `content/sequences/lullaby_walk.json`; `public/assets/audio/{baby_lullaby_coo,baby_stir,music_lullaby_note_1,music_lullaby_note_2,music_lullaby_note_3,music_lullaby_note_4,music_lullaby_pad,music_lullaby_tick,papa_lullaby_step}.m4a`; `src/sim/sequences/{beatClock,lullabyWalk}.ts` and `{beatClock,lullabyWalk,lullabySnapshot}.test.ts`; `src/client/audio/beatScheduler.ts` and its test; `src/client/ui/world/beatRing.ts` and its test; `tests/support/testLullaby.sequence.json`; `tests/bots/beatBots.test.ts`; `tests/e2e/lullaby.spec.ts`; `tests/golden/lullabyWalk.test.ts`; `tests/golden/journals/lullaby_walk_{kept,woken}{,.expected}.json`.

Changed: `content/{feedback,strings.fr}.json`, `content/levels/salon_crawler.json`, `content/_schemas/{feedback,sequence}.schema.json`; `src/content/{feedbackClips,schemas/feedback,schemas/sequence}.ts` (+ `feedbackClips.test.ts`); `src/shared/constants.ts`; `src/sim/{world,events,commands,context,createSim,snapshot,index}.ts`, `src/sim/sequences/{sequenceSystem,sequenceSteps,sequenceStart,sequenceEnd}.ts` (+ the tests next to them: `commands`, `events`, `snapshot`, `inputLag`, `sequenceSystem`, `sequenceLevel`, `sequenceSnapshot`); `src/bots/{perfectBot,humanBot,randomBot,idleBot}.ts`; `src/client/{boot,loop}.ts` (+ `loop.test.ts`), `src/client/app/{levelSession,testHost}.ts`, `src/client/input/{inputMapper,calibration}.ts` (+ `inputMapper.test.ts`), `src/client/ui/hud/sequenceBar.ts` (+ test), `src/client/ui/screens/calibrationScreen.ts`, `src/client/ui/world/worldUi.ts` (+ test), `src/client/ui/styles/ui.css`, `src/client/feedback/feedbackDirector.test.ts`; `src/debug/testApi.ts` (+ test); `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/build/inspectDist.ts`, `tools/sim/{simReport,simArgs}.ts`; `tests/support/{testContent,fakeTestHost}.ts`; `tests/content/{checkSequences,feedbackSchema,levelSchema,loadLevelContent,sequenceSchema}.test.ts`; `tests/bots/silenceBots.test.ts`; `tests/tools/{build/checkDist,sim/sequence,sim/simReport}.test.ts`; `tests/golden/scenarios.ts` and the 14 existing `tests/golden/journals/*.expected.json` (the `worldHash` line); `tests/e2e/{sequence,testApi}.spec.ts`; `_bmad-output/project-context.md`; `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml}`.

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
| 2026-10-30 | Implemented (`gds-dev-story`): content, sim, client, bots, goldens, e2e, docs. Snapshot v21; the 14 existing goldens move in `worldHash` only. `ci:fast`, the touched specs and the full `npm run ci` (typecheck, lint, content:check, coverage, e2e chromium + webkit, playtest build + dist checks + e2e:dist with perf, prod build) green. |
