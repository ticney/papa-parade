# Story 4.4: The special-sequence frame and « Stay awake »

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.4 « Cadre des séquences spéciales et « Rester éveillé » » (L1884-1908). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want the game to switch to a short sequence with its own rules, starting with fighting off sleep, baby in my arms,
so that the gameplay varies beyond the parry.

**Requirements covered:**
- **FR40 `[P2]` (first step of the bedtime cycle):** Stay awake: parry your own micro-sleeps; falling asleep makes Papa snore, wakes the baby and adds +15 % noise (epics L83, GDD L303).
- **UX-DR23:** the `sequence-bar` sits under the timer, which turns compact; an opponent's « health » fills in `gauge-warn`, a player resource in `gauge-calm` (epics L255, `DESIGN.md` L182-190, L465, L527-528, `EXPERIENCE.md` L208-209).

**What this story is not:**
- **No sequence in normal play.** Nothing plans one until `chambre_night` (4.10). Before that a sequence starts from the debug overlay, `__PP__.send`, or the sim CLI. **A level does not schedule sequences here** (no `atMs`).
- **No other sequence, step kind or response** (`lullaby_walk` 4.5, `wait` 4.6, `bomb_drop` 4.8, `nothing` / `HoldAnywhere` 4.9). **No going back a step** (4.6, 4.8: the steps list is what they will need).
- **No per-sequence playtest metrics** (4.10). **No parodic grammar** (7.4). **No new art** (E7: placeholders, as 4.3).
- **No snore outside a sequence** (D2). A missed micro-sleep in a normal level stays a 3 s nap, carried or not.
- **No new dependency, no new top-level folder.** `src/sim/sequences/` and `content/sequences/` are the architecture's (L497, L540).

**Sources:**
- Epics `epics.md` L82-87, L255, L366, L388-390, L1807-1809, L1884-1908, L1910-2049 (the next sequences this frame must serve), L2157, L2213, L2411. GDD `gdd.md` L96, L216, L303, L387, L464, L480. Architecture `game-architecture.md` L496-497, L520, L540, L966-968, L972.
- UX `DESIGN.md` L180-190, L367, L396-397, L446, L465, L527-528; `EXPERIENCE.md` L124, L208-209, L375.
- Previous stories: `1-19-fatigue-cafe-et-micro-siestes.md` (the micro-sleep), `1-20-le-telephone-qui-sonne.md` (a def's cues, a debug start command, one handler per kind), `1-21-le-silence-suspect.md` (music cut by state), `2-5-effets-de-feeling-a-l-ecran.md` (`cameraFx`), `2-6-musique-adaptative-de-base.md`, `3-1-jauge-de-bruit.md` (noise sources are events), `4-1-porter-le-bebe-bras-bebe.md`, `4-2-combo-a-encaisser.md`, `4-3-envie-pressante.md`.

## Acceptance Criteria

Numbers in `content/feel.json` and `content/sequences/` are live starting values for Geo to tune. Tests use the frozen `tests/support/` files, never the live ones.

### Content

1. **`SequenceDefSchema`** (`src/content/schemas/sequence.ts`, strict, every key has a `.describe()`; `SEQUENCE_DEF_PATTERN` in `contentFiles.ts` and in `CONTENT_PATTERNS`, `content:schemas` emits `content/_schemas/sequence.schema.json`). `content/sequences/stay_awake.json`:

   ```json
   {
     "$schema": "../_schemas/sequence.schema.json",
     "id": "stay_awake",
     "babyCarried": true,
     "steps": [
       { "kind": "microSleeps", "durationMs": 10000, "gapMinMs": 4500, "gapMaxMs": 6000 },
       { "kind": "microSleeps", "durationMs": 10000, "gapMinMs": 3500, "gapMaxMs": 5000 },
       { "kind": "microSleeps", "durationMs": 10000, "gapMinMs": 2800, "gapMaxMs": 4000 }
     ],
     "success": { "kind": "stepsDone" },
     "failure": { "kind": "gag", "hasSnore": true },
     "framing": {
       "camera": { "zoomPct": 18, "focusPct": 60, "inMs": 900, "outMs": 700 },
       "musicLoop": "stay_awake",
       "bar": { "labelKey": "hud.sequence_stay_awake", "fill": "opponent", "value": "timeLeft" }
     },
     "feedback": { "started": "sequence_started", "succeeded": "sequence_succeeded", "failed": "sequence_failed" }
   }
   ```

   - `steps` is non-empty, a discriminated union on `kind` (`microSleeps` only; 4.5+ add theirs), `gapMinMs <= gapMaxMs`. The sequence's **duration is the sum of its steps** (`sequenceDurationMs(def)`, exported by the schema file), not a second key that could disagree.
   - `success` and `failure` are discriminated unions with the one kind each that the sim can judge (the rule of `THREAT_RESPONSES`: « the schema accepts only what the sim can judge »).
   - `framing.camera` in sim ms (it runs on the sim clock, like the perfect's move). `framing.musicLoop` and `framing.bar` are nullable: `null` means no change of music, no bar and no compact timer. `bar.fill`: `opponent` | `player`. `bar.value`: `timeLeft` only (5.7 and 6.2 add theirs).

2. **Level.** `LevelSchema` gains `sequences: string[]` (`idSchema`, default `[]`, no duplicate: `superRefine`): what this level can run. `content/levels/salon_crawler.json`: `"sequences": ["stay_awake"]`. `LevelContent` gains `sequences: Record<string, SequenceDef>`, read by `loadLevelContent` after the disruptions, same pattern and same problem wording (`createTestLevel` follows, with a frozen `tests/support/testStayAwake.sequence.json`).

3. **`content:check`** (`tools/content/contentChecks.ts`), one failing test each in `tests/content/checkContent.test.ts`, and the same refusals as `invariant`s in `simLevelOf` (`createSim.ts`), same wording as the others:
   - a level names a sequence with no file;
   - a `babyCarried` sequence in a level without `carry`;
   - a `microSleeps` step in a level without `gauges.fatigue.microSleepDef`;
   - a `feedback` cue absent from `feedback.json › cues`, or a `musicLoop` absent from `feedback.json › loops.sequenceMusic`;
   - `framing.bar.labelKey` absent from the strings: `findStringKeyReferences` already walks every `…Key` property; check that sequence files are in its scan, do not add a second walker.

4. **`feel`** (`src/content/schemas/feel.ts`, then `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`; `npm run content:schemas`; pinned in `src/debug/feelControls.test.ts`):
   - `noise.sources.snore`: `noisePctSource('Papa snoring (story 4.4): GDD +15 %.')`, `noisePct: 15`; `'snore'` joins `NOISE_SOURCE_IDS`. (`deferred-work.md` L425 announced this row.)
   - `sequences: { resumeGapMs: 2000 }`: after a sequence, the breath before the director, a due micro-sleep or a due cry in the arms can start (D5).

5. **Audio and strings.**
   - `feedback.json › cues` and `events`: `PapaSnored → papa_snored`, `BabyWoke → baby_woke`. Cues `sequence_started`, `sequence_succeeded`, `sequence_failed` are named by the def only, never in `events` (as a threat's and a phone's: AC 18). All five have `audio`, a `soundWave` anchored on `papa`, and a `haptic` (`light` for started, `medium` for succeeded, `heavy` for the other three).
   - `feedback.json › loops.sequenceMusic`: a record `{ stay_awake: { clip: "music_stay_awake", bus: "music", gainPct: 100, fadeMs: 400 } }`. `feedbackClips()` lists them (update `feedbackClips.test.ts`). `feedback.json` gains `sequenceBar: { slideMs: 250 }` (real ms).
   - Placeholder clips in `tools/audio/makePlaceholderAudio.ts`, each with its own free seed (the highest today is `SEED + 14`; `9`, `10`, `11` are in `cultSounds.ts`): `SEED + 15` to `+ 20` for `music_stay_awake` (a short, droning loop, no longer than the level's music), `papa_snore`, `baby_woke`, `env_sequence_started`, `env_sequence_succeeded`, `env_sequence_failed`. Run `npm run assets:audio` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB; today about 0.46 MiB).
   - `strings.fr.json`: `"hud.sequence_stay_awake": "Sommeil"`. Do not name failure (`StringValueSchema` refuses it).

### The sim

6. **The flow** (`flow/flowFsm.ts`). `FlowState` is `'playing' | 'sequence' | 'ended'` and `FLOW_STATES` follows; new `isFlowLive(world)` (`state !== 'ended'`), exported by `src/sim/index.ts`. **Every reader of `flow.state` must be classified; this list is the trap of the story, and its misses are silent** (no input, no phone, a bot that stops):

   | Reader | Today | Becomes |
   |---|---|---|
   | `flow/flowSystem.ts` L36 `runFlow` | `!== 'playing'` return | Only `'ended'` returns: **the timer and the noise still end a level in a sequence** |
   | `disruptions/disruptionsSystem.ts` L34 | `!== 'playing'` return | `isFlowLive`: a ringing phone keeps ticking, and see AC 11 |
   | `bots/playGame.ts` L18 | `=== 'playing'` | `isFlowLive`: else a headless game stops at the first sequence |
   | `debug/autoplay.ts` L60 | `!== 'playing'` | `isFlowLive`: else an autoplay bot stops answering |
   | `client/input/inputMapper.ts` L191 `isLive` | `=== 'playing'` | `isFlowLive`: else **no input at all**, and see AC 20 |
   | `client/boot.ts` L789, L798, L803 (babble, silence, music mood) | `=== 'playing'` | `isFlowLive`: else the babble and the music mood drop for the whole sequence |
   | `gauges/fatigueSystem.ts` L39, `baby/carry.ts` L139 | `!== 'playing'` return | **Keep:** this is what suspends the normal micro-sleeps and the cry in the arms |
   | `step.ts` L54, `commandQueue.ts` L65, `debug/{cheats,feelPanel,feelPatch}.ts` | `'ended'` | Keep |
   | `client/boot.ts` L544, L1010 (`ppFlow`) | `playing` / `ended` | Add `sequence` (AC 22) |

   `grep -rn "flow\.state\|'playing'" src tools` before calling this done: anything new that a merge brought is classified too.

7. **Types.**
   - `World.sequence` (`world.ts`, `createWorld`): `{ id: string | null, lastId: string | null, startedAt: SimMs, endsAt: SimMs, endedAt: SimMs | null, stepIndex: number, stepEndsAt: SimMs, nextMicroSleepAt: SimMs | null }`. `id` is non-null exactly while `flow.state === 'sequence'`. `lastId`, `startedAt` and `endedAt` stay after the end: the client's camera falls back from them (AC 19).
   - `SimLevel.sequences: readonly SimSequence[]` (`{ id, def }`, from `level.sequences` in order).
   - `src/sim/events.ts`, sorted into `SIM_EVENT_TYPES`: `SequenceStarted{t, id}`, `SequenceStepStarted{t, id, stepIndex}`, `SequenceEnded{t, id, outcome}`, `PapaSnored{t}`, `BabyWoke{t}`. `SEQUENCE_OUTCOMES = ['succeeded', 'failed', 'levelEnded']` with its completeness proof, as `LEVEL_END_REASONS`. `THREAT_CANCEL_REASONS` gains `'sequence'`.
   - `commands.ts` (L28, L92, L147): `StartSequence{t, sequenceId}`, journaled, shape-checked (non-empty string), the debug twin of `StartDisruption`. `COMMAND_TYPES` only gains it, so old journals still replay. `src/sim/index.ts` exports what the client and the debug layer need.

8. **`runSequence`** (`src/sim/sequences/sequenceSystem.ts`): a **new system, right after `advanceTime` and before `runDirector`**, so that on the step a sequence starts the director already sees it. Edit `SYSTEMS`, the comment above it and the pinned order in `step.test.ts`. In this order:
   - this step's `StartSequence` commands, through `startSequence` (AC 9);
   - if a sequence runs: the step's handler, then the end test (AC 10).

   One handler per step kind at module scope (`Record<SequenceStepKind, …>`, the pattern of `HANDLERS` in `disruptionsSystem.ts` L18), so that a kind with no handler does not compile. Allocation-free once started. Pure: no real time, no log, randomness only through `world.rng`.

9. **Starting** (`startSequence`, in `sequences/`).
   - **Refused with no event** (as `ForceThreat`) for an id the level does not plan, or when `sequenceRefusal(world)` is not null. It is a pure exported reader the debug overlay also calls: `'running'` (a sequence is under way), `'ended'`, `'papaBusy'` (`isPapaBusy`), `'silence'` (`isSilenceUnderway`: the baby is hiding and `takeBaby` has no rule for it).
   - Otherwise, in order: `enterFlowState('sequence')`; Papa stops (`stopPapa`, exported from `baby/carry.ts`: no path, glide, direction, object or intent, idle); every threat in `telegraph` or `windowOpen` is cancelled, **those on Papa too** (`cancelThreat(…, 'sequence')`: no gag, no result, and a clean slate for the sequence's own cadence); if `babyCarried` and the baby is not carried, `takeBaby` (whatever the distance: the sequence puts him there, D6; one `nextFloat` in a level with a cry in the arms, as always); the slice is written; `SequenceStarted`, `SequenceStepStarted{0}`; the first step's handler entry.
   - Events therefore follow the helpers' order: pin the sequence in a test.

10. **The `microSleeps` step and the end.**
    - On entering the sequence: `nextMicroSleepAt = now + gap` (`gapMinMs + nextFloat × (gapMaxMs − gapMinMs)`, **exactly one `nextFloat`, whatever the tuning**, the rule of `drawMicroSleepMs`).
    - Each step: `stepEndsAt` passed → `stepIndex + 1`, `SequenceStepStarted`, and no draw. The gap in force is the current step's, read when a micro-sleep is telegraphed.
    - When `now >= nextMicroSleepAt`, the instance at `ctx.level.microSleepIndex` is `idle`, Papa is not busy, and it could be judged before **both** the sequence's `endsAt` and the level's end: `telegraphThreat(world, ctx, threat, planned.def, -1)` and one new draw. `isJudgeableBeforeEnd` (`threats/judgeable.ts`) gains the limit as a parameter; its two callers pass `ctx.level.durationMs`. The instance's position is already kept on Papa by `runFatigue` (it runs before the `flow` test at `fatigueSystem.ts` L39).
    - The cadence is **independent of the gauge**: it does not need `isFatigueAbove`, does not read or touch `gauges.microSleepAt`. The gauge keeps rising (×2 carried), and past `thresholdPoints` the windows shrink as usual: it is the same micro-sleep.
    - **Success:** `now >= endsAt` and the instance is not active (`isThreatActive`). The second half covers `lagMs`, which can move a close a little past the check: a sequence never succeeds over an open window. `SequenceEnded{succeeded}`.

11. **What is suspended and what is not.**
    - **Director** (`runDirector`, `directorSystem.ts` L25): during a sequence the waves still enter on time (the `while` at L31: `WaveStarted` and its one draw, so the rng and the wave clock do not depend on sequences); then it returns, **before** the `ForceThreat` commands (ignored, no event: nothing but the sequence's own threats). No draw, no telegraph.
    - **Normal micro-sleep and cry in the arms:** suspended by the existing `flow` tests. No code; pin with tests.
    - **Phone:** a `pending` one due during a sequence waits for its end, and `StartDisruption` is ignored meanwhile; one already `ringing` keeps ticking and timing out (Papa cannot walk to it). The gauge reads its `PhoneRinging` as usual.
    - **Fatigue, noise decay, need, physics, combo's carry tick, slow-mos, hitstop, scoring:** unchanged.
    - **Papa stands still** (D3, `runPapa`, L413): during a sequence the command loop ignores `TapFloor`, `TapObject`, `TapBaby`, `Move`, `MoveStop`. `PressThreat` passes (a threat on Papa does not glide him, L372). `Release` is not `runPapa`'s. A put-down is therefore impossible, as is a trip to the toilet.

12. **Failure** (`failSequenceOnGag(world, ctx)`, `sequences/sequenceEnd.ts`, which does not import `threatFsm`: `threatFsm` imports it, and `sequenceSystem.ts` imports both). `gagThreat` calls it last, after `resetCombo`. No-op outside a sequence, so every existing path keeps its events. In a sequence with `failure.kind === 'gag'`:
    - `hasSnore`: `PapaSnored`, then `BabyWoke`;
    - `SequenceEnded{failed}`, flow back to `playing`, and the resume of AC 14.
    - So a miss reads: `ResponseResolved{fail}`, `GagTriggered{papa_asleep}`, `PapaStateChanged{asleep}`, `ComboChanged`, `PapaSnored`, `BabyWoke`, `SequenceEnded{failed}`. **Every way to fail a micro-sleep ends the sequence:** `late`, `early`, `wrongResponse` (a hold on a parry). Each has its test.
    - **The gag is still `papa_asleep`** (`gags.ts` L91, `putPapaToSleep`, 3 s); its comment « no snore noise yet » goes. Papa sleeps with the baby in his arms; when he wakes, he has the room back.
    - **The noise** (`noiseSystem.ts`): `PapaSnored` joins the events `runNoise` reads, `addNoise(world, ctx, sources.snore.noisePct, 'snore')`, in the same step, so exactly +15 (clamped) and a `NoiseChanged{snore}`. No noise gauge: nothing. 100 % wakes Mama in that same step: `SequenceEnded{failed}` then `MamaWoke`, `LevelEnded`.
    - **No `gagCryMs`:** `BabyWoke` is an event with a cue, and the baby's state and cry timers do not change (D4).

13. **The level ending during a sequence.** `endLevel` (`flowSystem.ts` L16) first closes it: `SequenceEnded{levelEnded}`, `id` null, `lastId` and `endedAt` written (the snapshot's check of AC 16 holds in `ended` too), before `PhoneRingEnded` and `SilenceEnded`, then `→ ended` as today (`enterFlowState` from `sequence`). `levelEnded` plays no cue, and no clock is pushed: nothing runs after it.

14. **The resume** (`resumeAfterSequence`, called by both the success and the failure, not by `levelEnded`): `flow` back to `playing`; `slice.id = null`, `lastId` and `endedAt` written; with `gapMs = feel.sequences.resumeGapMs`, each of `director.nextAt`, `gauges.microSleepAt` (if non-null) and `carry.armsCryAt` (if non-null) becomes `max(value, now + gapMs)`. **No draw.** The baby stays carried, and so **the director still draws nothing until he is put down** (story 4.1 rule): « it resumes » is tested with a put-down (AC 25), or the test proves nothing. On the step the sequence ends, commands are accepted again: `runSequence` runs before `runPapa`.

15. **The score.** No row, no star and no event of its own (GDD L216 leaves sequence gags « to be priced with E4 », and the epic names none). What a sequence earns comes through existing paths, pinned: a response climbs the combo, a perfect counts in `score.perfects`, a gag resets the combo. A `SequenceEnded{failed}` adds nothing to `mess`. Open point 2.

16. **Snapshot v19** (`snapshot.ts` L33 history comment, L40, L59; the live code is at 18, because stories 2.7 and 4.3 both bumped it). New `sequenceProblem`: `id` / `lastId` are null or a planned sequence's id; times finite and non-negative; `stepIndex` in range of that def's steps; `endedAt` null while `id` is non-null; `nextMicroSleepAt` null or finite. Cross-checks: `flow.state === 'sequence'` exactly when `id !== null` (`flowProblem` L472 or `worldProblem`). `flowProblem`'s `ended` rule is unchanged. `PlannedLevel` carries what it needs. Fixtures and a round trip of a sequence mid-step.

### The client

17. **HUD: timer and bar.**
    - `timerHud.setCompact(isCompact)`: class `pp-hud-timer--compact` (32 px tall) and `pp-type-numeric-compact` on the digits in place of `pp-type-numeric`; writes the DOM only on a change. Tokens only (`--pp-font-numeric-compact-*` are already in `tokens.css`).
    - New `src/client/ui/hud/sequenceBar.ts`, `createSequenceBar(doc, { t, slideMs })`, mounted in the HUD's `timer` zone (`hudLayer.ts`, absolutely positioned **directly under the timer**, not a new grid row, so the gauges and pause do not move): a paper container with an ink outline, `{typography.label}`, a segmented `gauge-track` (the `repeating-linear-gradient` of `.pp-hud-gauge-bar::after`, `ui.css` L425), a fill in `gauge-warn` (`opponent`) or `gauge-calm` (`player`). `role="progressbar"`, `aria-label` from the def's `labelKey`, `aria-valuenow` in whole percent.
    - Driven **by state every frame, never by events**: a pause, a restart or a level end cannot leave it up. `update(world, def | null)`: `value: 'timeLeft'` is `(endsAt − now) / (endsAt − startedAt)`, clamped to `[0, 100]`, written through `hudBatch` (whole percent, a new slot). The timer's compact state follows the same condition, so they cannot disagree. A sequence with `bar: null` touches neither.
    - **Slides in at the start and out at the end.** The element is mounted while shown, plus `feedback.sequenceBar.slideMs` of real time after the end, then removed, through a `frame(nowAtReal)` call beside `gaugesHud.frame`. **Do not rely on `transitionend`:** under `prefers-reduced-motion` there is no transition and it never fires (`ui.css` has the media query pattern, L480). `reset()` on a level start removes it at once.
    - **Budget:** the HUD's `HUD_MAX_DOM_NODES` is 40 and a static count of today's HUD gives about 38-40: **the bar's 4 nodes may not fit.** Measure first, with the bar up (`document.querySelectorAll('#pp-hud *').length`, pin it in `sequence.spec.ts`). If it goes over, **stop and ask Geo**; do not raise the limit or drop nodes on your own (4.3's rule). Also look at it at 667 × 375, with the timer moved aside by the three gauges (4.3's `minmax` column): the bar must stay under the timer and not touch the pill.

18. **Cues** (`client/feedback/`). New `sequenceFeedback.ts`, `sequenceCueOf(event, sequences)`, the twin of `disruptionFeedback.ts`: `SequenceStarted → feedback.started`, `SequenceEnded{succeeded|failed} → feedback.succeeded|failed`, `SequenceEnded{levelEnded} → null`. `playSimEventFeedback` calls it, and `FeedbackSource.level` picks `sequences`. `SequenceStepStarted` plays nothing. Add the events to whatever exhaustive routing tests name them (`feedbackTwins.test.ts`, `feedbackEquivalence`).

19. **Camera.** `cameraFx.ts` stays the **only writer** of the pose. `update` gets the framing as an argument (`{ blend, zoomPct, focusPct, xM, zM }`, reusing one object, no allocation) and composes it with the perfect's move: zoom adds, pan adds; both blends 0 is today's bit-for-bit `restore()` and no write. New pure `sequenceFramingBlendAt(startedAt, endedAt, clockMs, inMs, outMs)` next to `perfectCameraBlendAt`: a linear rise over `inMs`, held, and from `endedAt` the value it had then going to 0 along `1 − smoothstep` over `outMs`. **Inputs are the world's `sequence` slice and the sim clock, with no client state**, so a pause holds it, the hitstop holds it back and a restart clears it. The focus is Papa's point (he stands still). Reduced motion: zoom and pan capped by `REDUCED_MOTION_ZOOM_CAP_PCT`, as the perfect's. `boot.ts` `beforeRender` looks up `sequences[world.sequence.lastId]`. `__PP__.fx().zoom` reads above 1 during the framing.

20. **Input** (`inputMapper.ts`). `isLive` as in AC 6. New `isHeldInPlace(active)`: a sequence is under way (`active.sim.world.flow.state === 'sequence'`).
    - **Pointer and keys:** presses on a threat go through. A floor, object or baby tap sends nothing and draws **no tap marker** (L507 and the `handlePointerDown` branches). `Move` and `MoveStop` send nothing (L211, L383-390).
    - **`act`** (L257): the threat branch stays; with no threat up, the context action sends nothing (no `TapBaby`, no `TapObject`).
    - **A key held through a sequence** walks again at its end: `boot.ts` L1037-1046 calls `inputMapper.resumeHeld()` on `SequenceEnded` too (a failure then waits for the nap, through the existing `PapaStateChanged` call).
    - The sim refuses all of this anyway (AC 11): the client's rule is so that a marker never lies.

21. **Music** (`audioEngine.ts`). State, every frame, like `setMusicMuted`: `audio.setSequenceMusic(loopId | null)`, edge-triggered, a boolean-compare common case. While a loop is on, the level stems are stopped through the existing path: `setMusicMuted(isSilent || isSequenceMusicOn)` in `boot.ts` L800. `stopLevelLoops` stops it and clears the wanted id. A clip not decoded: skipped once with a `warn`, as `startLoop` does for its own. It goes on the `music` bus, so the mute settings apply. `setMusicMood` keeps being called and its wanted mood applies at the stems' restart. Pause already suspends the context. A sequence with `musicLoop: null` leaves the level music alone. **Test on the fake context:** on, off, restart mid-sequence, a level end mid-sequence.

22. **Mirrors** (dev and `?debug=1`, on events, never per frame, in the clearing list at level start): `data-pp-flow` follows `sequence` and back; `data-pp-sequence` = the id (removed at the end); `data-pp-sequence-outcome` = the last outcome. Names go through the `mirror` union (`boot.ts` L265); a prod build must not hold them (`dist:check`).

23. **Debug overlay** (`src/debug/`). `launchableSequences(level)` in `cheats.ts` (ids of `level.sequences`) and a row like the threat launcher (`debugOverlay.ts` L238): a `select` (`data-debug="sequenceSelect"`) and a « Start » button (`data-debug="startSequence"`). The status line tells the refusal: `refusalReason(host)`, then `sequenceRefusal(world)` in plain English. It sends `StartSequence` through `context.send`, journaled. Hidden with no sequence in the level. Fix the comment at `cheats.ts` L27. `stateInspector.ts`: `sequence` in the slices listed at L30.

### Tools and tests

24. **Headless play: the golden rule.** `npm run sim` gains `--sequence <id>` and `--sequence-at-ms <n>` (default 1000; `simArgs.ts`, `--help`, its test): it wraps the bot so that the same `StartSequence` is enqueued at that time (journaled, so `sim:replay` agrees). `simReport.ts`: `sequencesStarted`, `sequencesSucceeded`, `sequencesFailed`, per run and in the aggregate, plus `snore` wherever noise per source is reported (`NOISE_SOURCE_IDS`).

25. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `sequences/sequenceSystem.test.ts`: the event order at the start; each refusal; takes a distant baby and leaves a carried one (no second draw); active threats on anchors **and on Papa** cancelled with `reason: 'sequence'`; `babyCarried: false` leaves a free baby; the steps' `SequenceStepStarted` at exact times; the cadence inside each step's gap; the exact count of `nextFloat` over a sequence (draw count independent of the tuning: min = max); no telegraph that cannot be judged before `endsAt` or before the level's end; success at `endsAt`; never over an open window (with `SetInputLag`); gag `late` / `early` / `wrongResponse` each fail it, with the full event order; +15 exact, clamped at 100, none without a noise gauge; Mama wakes in the same step; a level end cuts it (`levelEnded`, no resume).
    - Suspension: no wave telegraph, no normal micro-sleep (even at fatigue 100 with `microSleepAt` due), no cry in the arms, `ForceThreat` and `StartDisruption` ignored; a phone due during it rings right after, a ringing one times out; `WaveStarted` still on time.
    - Papa: each ignored command, in the sequence and in its first step; `PressThreat` passes.
    - Resume: all three clocks pushed to `now + resumeGapMs`, none pulled earlier, no draw; **after a put-down the director telegraphs** at the pushed time; none while he is still carried.
    - `flowSystem.test.ts`, `flowFsm` (`isFlowLive`), `step.test.ts`, `events.test.ts`, `commands.test.ts`, `snapshot.test.ts` (v19, each rejected field), `directorSystem` / `disruptionsSystem` / `noiseSystem` tests, `carryFuzz.test.ts` (with sequences: `id` and `flow` agree, a carried baby never moves away from Papa), `threats/threatFsm.test.ts` (`failSequenceOnGag` a no-op outside).
    - Content: `tests/content/` schema tests (empty steps, `gapMinMs` above `gapMaxMs`, an unknown kind; `feelSchema.test.ts › feel unit suffixes` passes unchanged), `levelSchema` (duplicate id), `checkContent` (AC 3), `loadLevelContent` (a missing file names the level's JSON path).
    - Client: `sequenceBar.test.ts` (shown, value, removed after `slideMs` of real time, `reset`, no write when unchanged), `timerHud.test.ts`, `cameraFx.test.ts` (the blend's shape, composition with a perfect, restore bit-for-bit, reduced motion), `audioEngine.test.ts`, `inputMapper.test.ts` (AC 20), `sequenceFeedback.test.ts`, `simEventFeedback.test.ts`, `cheats.test.ts`, `playGame`, `autoplay.test.ts`.
    - `src/sim` coverage stays at or above 90 %.

26. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: for **all four bots**, stars, end reasons, success rate, score and gags are identical (no sequence runs, no new draw). Only hashes move. **Paste both summaries in a table**, as 4.2's and 4.3's reviews required. `sequencesStarted` is 0.
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20 --sequence stay_awake --sequence-at-ms 5000`: `perfect` succeeds 20 of 20; `idle` fails 20 of 20; `human` and `random`, say what they do. **Paste the table.** A test pins `perfect` and `idle` over a few seeds.
    - `npm run golden:update`, then diff, then `biome format` the JSON: every existing journal moves only in its hashes (`levelHash` because `LevelContent` gains a key, `feelHash`, `worldHash`). Anything else is a bug, stop.
    - New scenarios `stay_awake_held` and `stay_awake_dozed` (`tests/golden/scenarios.ts`, a test file like `toiletVisit.test.ts` that pins what each exercises): a short frozen def (`tests/support`), a success ending in a put-down and the director's return; a miss with the snore, the wake and the noise. Use `STEP_MS` from `@shared/constants`.

27. **End to end** (`tests/e2e/sequence.spec.ts`, chromium + webkit, `ppSend` / `ppAdvance` like `carry.spec.ts` and `toilet.spec.ts`, values read from the live content, audio running before taps: `openFrozen` waits for `data-pp-audio="running"`, 4.3's review):
    - The overlay's « Start »: `data-pp-flow="sequence"`, `data-pp-sequence="stay_awake"`, the baby in the arms, `sequence_started` in `__PP__.cueLog()`.
    - The HUD: the bar is under the timer (bounding boxes), timer 32 px tall, `--pp-font-numeric-compact-size`; the value falls; the node budget (AC 17); after the end, the bar gone after `slideMs` and the timer back at 40 px. **Screenshot at 667 × 375, looked at.**
    - The framing: `__PP__.fx().zoom` above 1, back to exactly 1 after `outMs`. Reduced motion: capped. The music: stems off, loop on (a mirror or the audio test hook 2.6 used), back at the end.
    - A real tap on the micro-sleep's icon parries it, and the sequence goes on; a tap on the floor walks nowhere, and no tap marker.
    - Keyboard: Space with no threat up does not put him down; Space on a threat answers it. Gamepad if the spec's helper offers it.
    - A miss: `papa_snored`, `baby_woke`, `sequence_failed`, the Bruit gauge up by `noisePct`, `data-pp-sequence-outcome="failed"`, the baby still carried, Papa asleep then idle. In Chromium the vibrations hold the pattern (WebKit has no `navigator.vibrate`).
    - The whole sequence survived through a bot: `?autoplay=perfect`, started by `__PP__.send`, `outcome` `succeeded`, the director's next threat after a put-down.
    - A pause mid-sequence: bar, camera and timer hold; the resume is exact.
    - **No screenshot reference should move** (a sequence never runs in `autoplay.spec.ts`, the salon's look is unchanged). If one does, find out why before regenerating anything.

28. **Docs.**
    - `project-context.md`: a « Special sequences (story 4.4) » paragraph in the Engine rules (flow states and `isFlowLive`, the order of `runSequence`, what is suspended, Papa stands still, failure and the resume, the client's state-driven bar, camera and music), `SYSTEMS`' order in the first bullets (« commands → time → sequence → director… »), `snapshot version 19`, `snore` in the noise paragraph.
    - `deferred-work.md`: this story's open points; mark L343 and L580 and the snore of L425 resolved (the sequence's snore; D2 for the rest), and the `flow/` comment at `flowFsm.ts` L4-7.
    - Do not edit the architecture or the GDD. Their `levelFlow.ts` is `flow/flowSystem.ts` + `flow/flowFsm.ts` in the code: leave the code's names.

29. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [ ] **T1. Content** (AC 1-5)
  - [ ] T1.1 `SequenceDefSchema`, the pattern, `stay_awake.json`, `content:schemas`.
  - [ ] T1.2 `sequences` in the level, `LevelContent`, `loadLevelContent`, test helpers and frozen def.
  - [ ] T1.3 `content:check` rules with their tests; `feel` keys; strings.
  - [ ] T1.4 Cues, `loops.sequenceMusic`, `sequenceBar`, six placeholder clips (commit only the new `.m4a`).
- [ ] **T2. Sim** (AC 6-16)
  - [ ] T2.1 `FlowState`, `isFlowLive`, **the classification of AC 6**; types, events, `StartSequence`, `SimLevel.sequences`, `createSim` invariants.
  - [ ] T2.2 `runSequence`, start and refusal, the `microSleeps` step, success; `SYSTEMS`.
  - [ ] T2.3 Suspensions: director, phone, Papa standing still.
  - [ ] T2.4 `failSequenceOnGag`, `PapaSnored` in `runNoise`, the level-end close, `resumeAfterSequence`.
  - [ ] T2.5 Snapshot v19; the sim tests of AC 25; the fuzz test.
- [ ] **T3. Client** (AC 17-23)
  - [ ] T3.1 Measure the HUD budget with a stub bar **first**; `timerHud.setCompact`, `sequenceBar.ts`, screenshot at 667 × 375.
  - [ ] T3.2 `sequenceFeedback.ts`, `cameraFx` composition, `setSequenceMusic`.
  - [ ] T3.3 `inputMapper` rules, `resumeHeld`, mirrors, the overlay row.
- [ ] **T4. Tools and tests** (AC 24, 26, 27)
  - [ ] T4.1 `--sequence`, the report; both comparison tables pasted.
  - [ ] T4.2 Goldens (regenerate, diff, add the two scenarios).
  - [ ] T4.3 `tests/e2e/sequence.spec.ts`; touched specs.
- [ ] **T5. Docs and CI** (AC 28, 29)

## Dev Notes

### Decisions (D1-D8)

- **D1. `stay_awake` reuses the level's micro-sleep instance and def** (`ctx.level.microSleepIndex`, `papa_microsleep`), rather than a second threat. Same verb, window, marker and sounds, no change to the threat list, no moved id, so the bots' equality in AC 26 is easy to get. The sequence adds a cadence and consequences. The cost: a level with this sequence needs `gauges.fatigue` (AC 3).
- **D2. The snore belongs to the sequence.** `deferred-work.md` L580 said « waking him with a snore and +15 % noise is story 4.4 » about any carried micro-sleep, but the GDD (L303) and the epic put it in Rester éveillé, and doing it everywhere would change the bots' salon. So the normal nap is untouched. Open point 1.
- **D3. Papa stands still in a sequence.** Stay awake is « bébé dans les bras, papa pare ». If he could walk, a tap in the playpen or on the baby would put him down and the sequence's premise would be gone. Rule for every sequence for now: the schema has no key for it (nothing would read `false`). **4.9 (walking stealth) adds it** and moves the guard.
- **D4. « Wakes the baby » is an event and a cue, not a state or a cry.** There is no asleep baby in the sim before 4.6, and `gagCryMs` would feed the gauge (+2 %/s, `sources.babyCrying`), so the epic's « bruit +15 % » would be false. Open point 3.
- **D5. A breath after the sequence, with no draw.** Without `resumeGapMs` a threat already due fires on the very next step, on top of the end's cue and a nap. Clocks are only pushed, never redrawn: the rng is the same whatever the tuning. A `WaveStarted` during a sequence keeps its schedule and its draw, so the rest of the level's clock does not depend on sequences.
- **D6. A start puts the baby in the arms from anywhere.** The epic's « immédiatement ». A visible pop until the bedtime flow of 4.10 can walk there first (`chambre_night` will have Papa holding him already). A hidden baby or a busy Papa refuses instead (`sequenceRefusal`): takes and naps have no rule for those. **A refusal has no event**, as `ForceThreat`; the overlay reads the same pure function and says why.
- **D7. Sequences are a system, not a helper** (unlike the need and the combo's tick). It must run before the director, on every step, and later stories hang their step kinds there; the architecture names the folder. `SYSTEMS` changes, deliberately, with its pinned test.
- **D8. Client presentation is read from state, each frame** (bar, compact timer, camera, music): the established rule of `setMusicMuted`, `silenceBubble` and the combo badge. Only cues come from events. That is what makes a restart or a pause mid-sequence correct with no cleanup code.

### Current state of the files this story changes (read before editing)

- **`src/sim/step.ts`:** `SYSTEMS` L36; `step.test.ts` pins the order. **`flow/flowFsm.ts`, `flow/flowSystem.ts`:** `endLevel` L16 is where a sequence is closed; `runFlow` L36 is a trap (AC 6).
- **`src/sim/threats/threatFsm.ts`:** `gagThreat` L192-222, `cancelThreat` L239. Its imports already go to `scoring/combo.ts` and `gags.ts`: hence `sequenceEnd.ts` with no import of `threatFsm`, or a cycle.
- **`src/sim/threats/judgeable.ts`:** two callers (`fatigueSystem.ts` L41, `baby/carry.ts` L140).
- **`src/sim/gauges/fatigueSystem.ts`:** reads as is; it keeps the instance on Papa and stops telegraphing on the flow test. **`noiseSystem.ts`:** event loop L42-58. `events` of this step only: `PapaSnored` is pushed by `runThreats`, earlier in the same step.
- **`src/sim/baby/carry.ts`:** `stopPapa` L41 is private: export it. `takeBaby` L69 cancels the anchored threats itself with reason `carried`: **`startSequence` cancels first**, so no threat reads `carried` during a start. `runCarry` L139: suspended by the flow test.
- **`src/sim/director/directorSystem.ts`:** the early return goes after the wave-entering `while` (L31-44) and before the `ForceThreat` loop (L46).
- **`src/sim/papa/papaSystem.ts`:** command loop L413-425.
- **`src/sim/createSim.ts`:** `simLevelOf` L579 (invariants and wording), `createWorld` call L908. **`world.ts`, `context.ts`, `snapshot.ts`:** as in AC 7, 16.
- **`src/client/boot.ts`:** L265 mirror union, L544 and L1010 `ppFlow`, L785-808 per-frame state, L772 `cameraFx.update`, L1037-1046 `resumeHeld`. **`client/ui/hud/hudLayer.ts`:** `ZONES`, timer zone. **`client/render/cameraFx.ts`:** `update` L157, `restore` L94, the dirty test: every new input joins it. **`client/audio/audioEngine.ts`:** `setMusicMuted` L462, `startLoop` L170 (its `ClipLoopName` is a closed set: the sequence's loop needs its own handle and id, not a new name).
- **`src/client/assets/browserContentSource.ts` L6:** the browser's content comes from one `import.meta.glob` of `content/**/*.json` (geometries and `_schemas` excluded), so `content/sequences/` is served with no change: `sequence.spec.ts` proves it in a real page, and `build:playtest` in a built one.
- **`src/content/feedbackClips.ts`:** the preload list, read by the client, `content:check` and the audio-assets test.
- **`src/debug/cheats.ts`, `debugOverlay.ts`, `stateInspector.ts`.**
- **Must not change:** judgement, windows, `papa_microsleep.json`, the normal micro-sleep cadence, the combo's rules, `TapBaby`'s rules outside a sequence, rng draw counts when no sequence runs, the nav grid, the note's four rows, `tokens.css`.

### Architecture compliance

- Pure sim, serialisable `World`; state through `enter…State`; no real time, no log; events past tense with `t`; `id` from content, no generated id.
- Units: `durationMs`, `gapMinMs`, `gapMaxMs`, `inMs`, `outMs`, `resumeGapMs`, `slideMs` (real, client only), `zoomPct`, `focusPct`, `noisePct`, `endsAt`, `stepEndsAt`, `nextMicroSleepAt`. Booleans `is…` / `has…`; the def's `babyCarried` is the epic's phrase and is a state, not an action. Every number is in JSON. No literal UI text.
- Client imports `@sim` only: add `isFlowLive`, `sequenceRefusal`, `SEQUENCE_OUTCOMES` to `src/sim/index.ts`. Bots go through `@sim` too (`playGame`). Debug and bots stay out of the client's static imports.
- Every cue with `audio` has `visual` and `haptic` (pillar 3, `feedbackEquivalence`). Zero allocation per frame in the bar, camera and music calls, and in `runSequence` once started.
- Architecture variance: `flow/levelFlow.ts` is `flowSystem.ts` + `flowFsm.ts` in the code since 1.18. The epic's « flux `sequence` dans `levelFlow` » is `FlowState`.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned (Three r186, Zod 4, Vitest 5, Playwright 1.64), so no web research was needed. `OrthographicCamera.zoom` and Web Audio are used as `cameraFx.ts` and `audioEngine.ts` already use them.

### File structure

New: `src/content/schemas/sequence.ts`; `content/sequences/stay_awake.json`, `content/_schemas/sequence.schema.json` (generated); `src/sim/sequences/{sequenceSystem,sequenceEnd}.ts` and tests; `src/client/ui/hud/sequenceBar.ts`, `src/client/feedback/sequenceFeedback.ts` and tests; six `public/assets/audio/*.m4a`; `tests/support/testStayAwake.sequence.json`; `tests/e2e/sequence.spec.ts`; `tests/golden/stayAwake.test.ts` with `tests/golden/journals/stay_awake_{held,dozed}*.json`.

Updated: `src/content/{contentBundle,contentFiles,loadLevelContent,feedbackClips}.ts`, `schemas/{level,feel,feedback}.ts`, `content/{feel,feedback,strings.fr}.json`, `content/levels/salon_crawler.json`, `content/_schemas/*`; `src/sim/{step,world,events,commands,context,createSim,snapshot,index}.ts`, `flow/{flowFsm,flowSystem}.ts`, `director/directorSystem.ts`, `disruptions/disruptionsSystem.ts`, `gauges/noiseSystem.ts`, `papa/papaSystem.ts`, `baby/carry.ts`, `threats/{threatFsm,gags,judgeable}.ts`, `gauges/fatigueSystem.ts` (the call); `src/bots/playGame.ts`; `src/client/boot.ts`, `input/inputMapper.ts`, `audio/audioEngine.ts`, `render/cameraFx.ts`, `feedback/simEventFeedback.ts`, `ui/hud/{timerHud,hudLayer}.ts`, `ui/styles/ui.css`; `src/debug/{autoplay,cheats,debugOverlay,stateInspector}.ts`; `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/sim/{simArgs,simReport,runSim}.ts`; tests next to each, `tests/support/{testFeel.json,testContent.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/golden/*`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ gauges: { fatigue: {...}, noise: {} }, carry: CARRY, sequences: ['stay_awake'] })` and `stepN`. `createTestLevel` gains `sequences`, empty by default, so no other test level moves. Express time in steps; `STEP_MS` from `@shared/constants`, never a literal.
- Run `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/sequence.spec.ts tests/e2e/carry.spec.ts tests/e2e/fatigue.spec.ts tests/e2e/toilet.spec.ts tests/e2e/ui.spec.ts tests/e2e/timer.spec.ts tests/e2e/debugOverlay.spec.ts tests/e2e/testApi.spec.ts tests/e2e/feedback.spec.ts --project=chromium`.
- **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.
- The worktree was created with `--skip-install`: **run `npm ci` in it first.**

### Previous story intelligence (4.1-4.3)

- **4.3's review:** a client rule narrower than its AC; a comment or test title claiming more than it checks; `SEED + n` collisions (read `cultSounds.ts` too); a full-CI failure came from `startWalking` in `tests/e2e/support/game.ts` tapping 6 px from an icon, and another from WebKit's audio context: `openFrozen` waits for `data-pp-audio="running"`. Taps in `sequence.spec.ts` are real taps with those lessons in mind. `papaHint`'s retarget and a transient cancelled when replaced are the model for the bar's re-entry: a sequence starting during the previous bar's slide-out re-shows it, and does not remove it `slideMs` later.
- **4.2's review:** both main-vs-branch summaries pasted; every path the AC names pinned; no stale comments on events and systems. `worldUi.test.ts` indices shift when an element joins a scene (the bar is DOM, in the HUD: it should not).
- **4.1:** the carried baby's keyboard rule in `inputMapper` L275 is commented: read it before adding the guard above it.
- **Merges:** 2.7 and 4.3 both bumped the snapshot, so it is at 18 with a history comment; a parallel story could do it again. Goldens and `content/_schemas` conflict on a second merge (`CLAUDE.md`).
- Golden regeneration: diff every `*.expected.json`, then `biome format` the JSON. A 5 s test timeout under load is known: rerun with `VITEST_MAX_WORKERS=5` and say so.

### Git intelligence

Recent commits are stories 4.3 and its review fixes, merged into `main` (`61f690f`). Commit convention: « Story 4.4 : <titre> », « Story 4.4 : corrections de la revue de code ». `main` only receives the merge after Geo's OK. This branch is `story/4-4-cadre-des-sequences-speciales-et-rester-eveille`, in its worktree.

### Project Structure Notes

Paths follow the epic and the architecture (`src/sim/sequences/`, `content/sequences/`, `client/ui/hud/sequenceBar.ts`). Variances: `levelFlow.ts` (above), and the sequence's duration is the sum of its steps rather than a key of its own.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 24).
- Layer rules; the sim never logs; no `Math.random`, `Date`, `performance`, `setTimeout` in `src/sim`.
- Systems never call each other, helpers are fine. Reordering `SYSTEMS` means updating the goldens and justifying it (D7).
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes; reduced motion is client-only and never changes sim timing.
- The player never reads that they failed: « Sommeil », no « échec » (`FORBIDDEN_FAILURE_WORDS`); the outcome word `failed` lives in code only.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **A missed micro-sleep outside a sequence, baby in the arms,** stays a nap with no snore (D2). `deferred-work.md` had pencilled it in for this story. Say if you want it everywhere; it would make carrying riskier in the salon and change no bot (the bots never carry).
2. **A sequence earns nothing of its own.** Winning `stay_awake` pays through the combo (each parry +1, unbanked until a safe put-down) and the perfects. A bonus at the end, or a Mama penalty on a failure, is your call; the GDD says only that sequence gags are still « to be priced » (L216).
3. **« Wakes the baby » is a sound for now (D4).** A real cry would add about +8 % over 4 s on top of the +15. Say if the failure feels too cheap.
4. **`stay_awake` is 30 s with a cadence tightening from about 5 s to about 3.4 s,** all guesses in the JSON. Micro-sleeps every few seconds may feel like a metronome rather than a fight against sleep; `papa_microsleep`'s 1.2 s telegraph is shared with the salon.
5. **The bar « Sommeil » counts the time left, not the sleep.** It reads as a boss's life draining, which is the DESIGN's boss-bar parody, but it is a clock under a clock. Say if you prefer no bar here (`"bar": null`: the first real user would then be 5.7).
6. **The framing is a light zoom on Papa** (18 %, not a cinematic), since 7.4 owns the parody. Tune `zoomPct` and `focusPct` first.
7. **The baby pops into the arms** on a debug start (D6); only 4.10 removes that for players.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L82-87, L255, L366, L388-390, L1807-1809, L1884-1908, L1910-2049, L2157, L2213, L2411]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L96, L216, L303, L387, L464, L480]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L496-497, L520, L540, L966-968, L972]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L180-190, L367, L396-397, L446, L465, L527-528; EXPERIENCE.md L124, L208-209, L375]
- [Source: _bmad-output/project-context.md (Engine rules: Busy Papa, Disruptions, Carrying the baby, The combo, The noise gauge, Two ways to end a level; Feedback; Testing)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md L343, L425, L580, L583]
- [Source: _bmad-output/implementation-artifacts/1-19-fatigue-cafe-et-micro-siestes.md; 1-20-le-telephone-qui-sonne.md; 1-21-le-silence-suspect.md; 2-5-effets-de-feeling-a-l-ecran.md; 2-6-musique-adaptative-de-base.md; 3-1-jauge-de-bruit.md; 4-1-porter-le-bebe-bras-bebe.md; 4-2-combo-a-encaisser.md; 4-3-envie-pressante.md]
- [Source: src/sim/step.ts, flow/{flowFsm,flowSystem}.ts, director/directorSystem.ts, disruptions/disruptionsSystem.ts, gauges/{fatigue,fatigueSystem,noise,noiseSystem}.ts, papa/{papaSystem,sleep}.ts, baby/{carry,silence}.ts, threats/{threatFsm,threatSystem,gags,judgeable}.ts, createSim.ts, world.ts, snapshot.ts, commands.ts; src/client/boot.ts, input/inputMapper.ts, audio/{audioEngine,adaptiveMusic}.ts, render/{cameraFx,isoCamera}.ts, ui/hud/{timerHud,hudLayer,gaugesHud,hudBatch}.ts, feedback/{simEventFeedback,disruptionFeedback}.ts; src/debug/{cheats,debugOverlay,autoplay}.ts; src/bots/playGame.ts; tools/content/contentChecks.ts, tools/sim/simArgs.ts; content/threats/papa_microsleep.json, content/levels/salon_crawler.json]

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
