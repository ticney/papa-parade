---
baseline_commit: ef78496150fabb923b8311fab734aea9e8a3f64f
---

# Story 1.20: The Phone That Rings

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.20 « Le téléphone qui sonne » (L1066-1086). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want a phone to ring at the worst moment and force me to choose,
so that I decide what to deal with in the middle of the chaos.

**Requirements covered:**
- FR29: the phone that rings (a disruption). Answering it costs +10 fatigue and 5 s of diverted attention. Ignoring it means +2 % noise per second while it rings.
  - The noise half is **not** built here. Story 3.1 plugs the noise gauge into `PhoneRinging` without touching this story's code (epics L1549, L1570-1572).
- FR31, the disruption part: wave 3 has « trois simultanées et une perturbation ». Story 1.18 D10 deferred this to here.
- FR12, the phone part: a contextual interaction, by a tap on the object or by Space / A near it. The tap and the context action already exist (1.17, 1.19). This story gives the phone its arrival action.

**Sources:**
- Epics `epics.md`:
  - L1066-1086, the story itself.
  - L65 (FR29), L67 (FR31) and L42 (FR12).
  - L1281-1284: story 2.3 wants a distinct `tel_*` sound for the phone.
  - L1545-1572: story 3.1 counts `PhoneRinging` as +2 % per second of ringing, « aucun code de ces stories n'est modifié ».
- GDD (`gdds/gdd-papa-parade-2026-10-26/gdd.md`):
  - L91 and L200: disruptions exist to make the player « choisir quoi traiter ».
  - L213: « Boire un café, décrocher le téléphone | Tap sur l'objet | Interaction contextuelle (Espace) | A contextuel ».
  - L238: « Téléphone qui sonne (perturbation) | Sonnerie, vibration | — | Décrocher (fatigue +10, attention détournée 5 s) ou ignorer (bruit +2 %/s tant qu'il sonne) ».
  - L366: the attention gauge (−5/s while Papa sees to himself, café, téléphone) is an E6 rule for the later ages. It is **not** in this story.
  - L372, L480 and L495: the prototype has one disruption, the phone, in wave 3.
- Architecture (`game-architecture.md`):
  - L71, L259, L472 (`schemas/disruption.ts`), L493 (`sim/disruptions/phone.ts`) and L538 (`content/disruptions/phone.json`).
  - L229-230: the systems order. L273 and L580: the director plans « menaces et perturbations ».
  - L586: `src/sim/disruptions/`. L941: the E1 row (« P1, commande `TapObject` »).
  - L988 and L1000: `DisruptionDefSchema`, and `DisruptionDef.feedback.*` names keys of `feedback.json`.
  - L1019: the level example `"disruptions": [{ "def": "phone", "atMs": 125000 }]` on wave 3.
- UX:
  - `EXPERIENCE.md` L393: « Use object (coffee, phone) | Tap the object | Space near the object, with no threat active | A near the object ».
  - L295 and L409-425: every audio cue has a visual and a haptic twin; a telegraph is a light haptic.
  - L431-435: nothing flashes faster than 3 Hz.
  - No UX spec exists for the ringing phone beyond the epic's « son, ondes visuelles autour de `ANCHOR_phone`, vibration ».
- Previous stories:
  - 1.18 D10 and L44 of its story file: `disruptions: [{ def, atMs }]` joins `LevelWaveSchema` here, with `DisruptionDefSchema` and the folder.
  - 1.19 « Downstream consumers »: the phone reuses the object hit test, the `OBJECT_ACTIONS` switch, the busy state (D6) and `addFatigue` (D5).
- `deferred-work.md`:
  - L304: what happens on arrival at the phone.
  - L325: the disruption of wave 3.

**Downstream consumers. Design for them; none of them may need to change this story's code beyond adding their own case:**
- **2.3 (sounds):** replaces the placeholder `tel_phone_ring` clip. No code change.
- **2.4 (visual and haptic twins):** may retune the ring's ring and vibration in `feedback.json` only.
- **3.1 (noise):** reads `PhoneRinging` only. One event = one second of ringing (the contract of D5). It must never need to know the phone's state.
- **1.22 (Mama's score):** may count `PhoneAnswered` / `PhoneRingEnded{reason: 'timedOut'}`. Neither is a `NearMiss`.
- **E6 (dog, pot):** a new `DisruptionKind` adds its entry to `DISRUPTION_KINDS` and to the `Record` of handlers. The slice, the schema, the content checks and the wave entry stay as they are.

## Precondition (check first, stop if it fails)

1. Story 1.19 is `done`, with its review fixes committed.
   - When this story was written, 1.19 was `review` (implementation commit `aef1797`) and the tree was clean.
   - If `sprint-status.yaml` says anything but `done` for 1.19, or `git status` shows anything outside `_bmad-output/`, stop and tell Geo. The review may have moved files this story edits.
2. Re-read the files that 1.19 and its review changed before you edit them: `papaSystem.ts`, `papaFsm.ts`, `coffee.ts`, `world.ts`, `context.ts`, `createSim.ts`, `snapshot.ts`, `step.ts`, `events.ts`, `commands.ts`, `level.ts`, `loadLevelContent.ts`, `contentChecks.ts`, `feedback.ts`, `feedbackDirector.ts`, `levelScene.ts`, `papaView.ts`, `boot.ts`, `simReport.ts` and `testContent.ts`. The excerpts in the Dev Notes are from commit `aef1797`.
3. Run `env | grep VITE_`. The agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap).
4. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. **Do not edit anything while it runs** (1.19 contaminated its own baseline that way). Note the unit and e2e counts in the Debug Log. If the baseline is red, stop and say so. Under heavy load, use `--maxWorkers=5` and say so.

## Acceptance Criteria

1. **Content: the disruption def.**
   - `content/disruptions/phone.json` is validated by `DisruptionDefSchema` (`src/content/schemas/disruption.ts`), a new `ContentPattern` (`disruptions/<id>.json`).
   - The fields are:
     - `id`;
     - `kind: "phone"` (`DISRUPTION_KINDS = ['phone']`);
     - `ringMaxMs` (15000), how long it rings if nobody answers;
     - `answerBusyMs` (5000), the « attention détournée »;
     - `answerFatiguePoints` (10);
     - `feedback: { ring, answer }`, two cue ids of `feedback.json`.
   - Every value is in the JSON and none is in the code (D2).
2. **Content: the wave entry.**
   - `LevelWaveSchema` gains `disruptions: z.array({ def, object, atMs }).default([])`.
   - `def` names a `content/disruptions/<def>.json`. `object` is the `id` of an entry of the level's `objects`. `atMs` is absolute sim time (architecture L1019).
   - The level refine refuses:
     - an `atMs` outside `[wave.fromMs, wave end)`, where the wave end is the next wave's `fromMs` or `durationMs`;
     - an `object` that is not in `level.objects`;
     - an object planned by two disruptions.
   - `salon_crawler.json` wave 3 gets `"disruptions": [{ "def": "phone", "object": "phone", "atMs": 125000 }]`.
3. **Content checks.** `content:check` names the file, the JSON path and the culprit for each of these:
   - a `def` with no disruption file;
   - a def whose `kind` differs from the `kind` of the object it rings at;
   - a disruption def `feedback` cue that is not in `feedback.json`.

   `createSim` refuses the same, with an `invariant`, in the same wording.
4. **Ringing.**
   - At the first step where `now ≥ atMs` and the flow is `playing`, the planned disruption goes `pending → ringing` and `PhoneRingStarted{t, objectId, untilAt}` is emitted, with `untilAt = t + ringMaxMs`.
   - While it rings, `PhoneRinging{t, objectId}` is emitted at the first step at or after each `startedAt + k × PHONE_RINGING_EVERY_MS` (k ≥ 1). The ticks never drift: the next one is due from the previous **due** instant, not from the step.
   - At the first step where `now ≥ untilAt` and nobody answered, the disruption goes `timedOut` and `PhoneRingEnded{t, objectId, reason: 'timedOut'}` is emitted. A tick due in that same step is emitted first.
   - So a phone nobody answers gives exactly `floor(ringMaxMs / PHONE_RINGING_EVERY_MS)` `PhoneRinging`.
   - A disruption fires at most once per level. It draws nothing from `world.rng`.
5. **Answering.**
   - `TapObject{objectId}` on the phone walks Papa there, as for any object (1.17, 1.19).
   - **On arrival**, if a disruption rings at that object:
     - it goes `answered` and `PhoneRingEnded{t, objectId, reason: 'answered'}` is emitted;
     - Papa enters `onPhone`, a new busy state, until `busyUntil = t + answerBusyMs`;
     - `addFatigue(world, ctx, +answerFatiguePoints)` runs (clamped at 100; a no-op in a level without fatigue);
     - `PhoneAnswered{t, objectId, untilAt, fatigue}` is emitted.
   - At the first step where `now ≥ busyUntil`, Papa is `idle`. Nothing else is emitted besides `PapaStateChanged`.
   - On arrival at a phone that does **not** ring (not yet, or it timed out during the walk), Papa is simply idle there (today's behaviour).
   - A `TapFloor`, `Move` or a glide before arrival cancels the answer: the walk is no longer « to the object » (1.19).
6. **Busy on the phone (1.19 D6).**
   - `onPhone` is busy: `isPapaBusy` is true. `runPapa` ignores `TapFloor`, `TapObject`, `Move`, `MoveStop` and `PressThreat`, and `runThreats` ignores `PressThreat`. So a threat that opens during the call gags `late`: that is the price of answering.
   - `Release` still passes. A micro-sleep spawn waits while Papa is busy (1.19, already).
   - A micro-sleep already up when Papa arrives can gag during the call. Papa then falls `asleep`, which ends the call. The fatigue added at the answer stays. Say so in a code comment.
   - The client sends nothing while Papa is busy (the 1.19 gate reads `isPapaBusy`, so it covers `onPhone` with no change). A key held through the call walks again on `PapaStateChanged → idle`: extend the `from` test in `boot.ts` to every busy state (use `isPapaBusy({ state: event.from })`).
7. **The wave director is not touched.** The phone is not a threat. It never counts against `maxSimultaneous`, is never drawn, and the baby never locks on it. `isLastOfWave` is unaffected.
8. **Feedback (placeholders; 2.3 and 2.4 replace them).**
   - `PhoneRingStarted` and each `PhoneRinging` play the def's `feedback.ring` cue: `tel_phone_ring`, a ring of < 1000 ms (so two rings never overlap). Its `visual` is a `soundWave` with the **new anchor `object`** (« the object the event names »), and its `haptic` is `light`.
   - `PhoneAnswered` plays `feedback.answer`: `papa_phone_answer` (a pick-up click), `soundWave` on `papa`, `light`.
   - The ring is a one-shot per event, not a loop (D6). It stops by itself when the events stop: on an answer, a timeout or the end of the level.
   - The rings pulse at 1 Hz, under the 3 Hz ceiling.
9. **Diegetic feedback (provisional, E7 replaces it).** During `onPhone`, Papa's view shows a small handset cube at the side of his head (`papaView.setOnPhone`). It is driven from `world` every frame in `levelScene.update`, like the mug, with no allocation. No DOM overlay.
10. **Debug command.** `StartDisruption{t, index}` starts planned disruption `index` now, if it is `pending`. Otherwise it is ignored, with no event. It is journaled like `SetFatigue`, checked by `commandProblem` (a non-negative integer) and applied by `runDisruptions`. The e2e and Geo use it.
11. **Headless check.** `tests/tools/sim/phone.test.ts` plays the **live** `salon_crawler` with the `idle` bot for the level's duration, over 3 seeds. It asserts all of these:
    - exactly one `PhoneRingStarted`, at the first step at or after the planned `atMs`, inside wave 3's span;
    - exactly `floor(ringMaxMs / PHONE_RINGING_EVERY_MS)` `PhoneRinging`, each `PHONE_RINGING_EVERY_MS` after the previous (the first after the start);
    - one `PhoneRingEnded{reason: 'timedOut'}` at `atMs + ringMaxMs` (to the step);
    - no `PhoneAnswered`.

    Every bound is read from the live content and `STEP_MS`, never written as a literal.
12. **CLI report.** The report gains `phoneRings` (`PhoneRingStarted`), `phoneAnswers` (`PhoneAnswered`) and `phoneRingingSeconds` (`PhoneRinging`), summed over the runs. 1.18's and 1.19's live tests still pass.
13. **Tests, goldens, CI.**
    - The tests of § Testing pass.
    - Golden levels plan no disruption, so `eventTypes` and `eventsHash` of all six scenarios stay **identical**. `worldHash` (new slice) and `levelHash` (`LevelContent.disruptions`, the waves' `disruptions: []`) may move. Regenerate with `npm run golden:update` and say so.
    - The screenshot references should not move (nothing new in the HUD, and the phone does not ring in the frozen shot). If they do, find out why before regenerating.
    - Coverage of `src/sim` stays ≥ 90 %.
    - `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T0 — Precondition** (§ Precondition). Record the baseline CI and the counts in the Debug Log.
- [x] **T1 — Content** (AC 1-3, 8)
  - [x] `src/content/schemas/disruption.ts`:
    - `DISRUPTION_KINDS = ['phone'] as const`, `DisruptionKind`;
    - `DisruptionDefSchema` (`z.strictObject`, every field `.describe`d with its unit; `ringMaxMs`, `answerBusyMs` int > 0; `answerFatiguePoints` ≥ 0; `feedback: z.strictObject({ ring, answer })` of cue ids);
    - `DisruptionDef` type.
  - [x] `src/content/contentFiles.ts`: `DISRUPTION_DEF_PATTERN` (`dir: 'disruptions'`, `suffix: '.json'`, `schemaName: 'disruption'`), added to `CONTENT_PATTERNS`.
  - [x] `src/content/schemas/level.ts`:
    - `LevelWaveDisruptionSchema` (`def`, `object`, `atMs` ≥ 0);
    - `disruptions` on `LevelWaveSchema` with `.default([])`;
    - the refine rules of AC 2, in the existing message style (`waves[2].disruptions[0]: …`);
    - export `LevelWaveDisruption`, and update the header comment (it already announces 1.20).
  - [x] `content/disruptions/phone.json` (`$schema: ../_schemas/disruption.schema.json`) and `salon_crawler.json` wave 3 (AC 2).
  - [x] `src/content/contentBundle.ts`: `LevelContent.disruptions: Readonly<Record<string, DisruptionDef>>`.
  - [x] `src/content/loadLevelContent.ts`: after the threat defs, load each distinct wave disruption def through the same source and parser. A missing file names `waves[w].disruptions[i].def`. Update its doc comment.
  - [x] `src/client/app/threatsSwitch.ts` › `withoutThreats`: return `disruptions: {}` (the waves are emptied, so nothing plans one). Update its comment.
  - [x] `tools/content/contentChecks.ts`:
    - parse the `disruptions` family;
    - `checkDisruptionReferences` (each `feedback` cue exists);
    - in `checkLevelReferences`, a missing def file and a kind mismatch (AC 3).
    - Tests in `tests/content/checkContent.test.ts`, `levelSchema.test.ts`, `loadLevelContent.test.ts` and a new `disruptionSchema.test.ts`.
  - [x] `src/content/schemas/feedback.ts`: `SoundWaveSchema.anchor` gains `'object'`, described « the object the event names (`objectId`); only for cues a disruption def points at ». `contentChecks` refuses an `object` anchor on a cue mapped through `events` or named by a threat def, as it does for `threat`.
  - [x] `content/feedback.json`: cues `tel_phone_ring` (audio sfx, `soundWave` `object` about 0.8 m / 900 ms, `light`) and `papa_phone_answer` (audio sfx, `soundWave` `papa`, `light`). Nothing in `events`: the def points at them.
  - [x] `npm run content:schemas`; commit `content/_schemas/{disruption,level,feedback}.schema.json`.
- [x] **T2 — Sim: plan, world, snapshot** (AC 2-4)
  - [x] `src/shared/constants.ts`: `PHONE_RINGING_EVERY_MS = 1000`, with the D5 comment (a contract with 3.1, not feel).
  - [x] `src/sim/context.ts`:
    - `SimPlannedDisruption { def: DisruptionDef; objectId: string; atMs: number; waveIndex: number }`;
    - `SimLevel.disruptions: readonly SimPlannedDisruption[]`, index-aligned with `world.disruptions`, in wave order.
  - [x] `src/sim/createSim.ts` › `simLevelOf`:
    - flatten the waves' `disruptions`;
    - invariants: def loaded, object in `objects`, `def.kind === object.kind`, in the wording of `content:check`.
    - `createWorld` gets one `pending` instance per planned disruption.
  - [x] `src/sim/disruptions/disruptionFsm.ts`:
    - `DisruptionState = 'pending' | 'ringing' | 'answered' | 'timedOut'`;
    - `DISRUPTION_STATES` with its `…_ARE_COMPLETE` proof;
    - `enterDisruptionState(world, instance, next)`: the only writer of `state` / `enteredAt`. It emits nothing: the phone helpers emit, as `enterFlowState` does.
  - [x] `src/sim/world.ts`:
    - `DisruptionInstance { state; enteredAt: SimMs; untilAt: SimMs; nextRingingAt: SimMs }` (both instants 0 unless `ringing`);
    - `World.disruptions: DisruptionInstance[]`;
    - `PapaSlice.busyUntil` doc: « `drink` / `asleep` / `onPhone` ».
  - [x] `src/sim/snapshot.ts`:
    - `version: 8`, with a comment;
    - check `disruptions`: the length equals the plan, a known state, finite instants ≥ 0, and > 0 exactly when `ringing`;
    - the papa busy check uses `isPapaBusy` (today it hard-codes `drink` / `asleep`);
    - tests.
- [x] **T3 — Sim: the phone** (AC 4-7, 10)
  - [x] `src/sim/disruptions/phone.ts`:
    - `startRinging(world, ctx, index)`;
    - `tickRinging(world, ctx, index)`: the ticks, then the timeout, in that order;
    - `ringingDisruptionAt(world, ctx, objectId): number`, the index or -1;
    - `answerPhone(world, ctx, index)`: `answered` and `PhoneRingEnded{answered}`.
    - Allocation-free.
  - [x] `src/sim/disruptions/disruptionsSystem.ts` › `runDisruptions(world, ctx)`:
    - apply `StartDisruption` commands;
    - for each instance, `pending` and `now ≥ atMs` → start, then `ringing` → tick.
    - Dispatch by `def.kind` through a `Readonly<Record<DisruptionKind, …>>` (D3), even with one kind.
    - Add it to `SYSTEMS` right after `runDirector` (D4). Update the `step.ts` header, the pinned order test and `project-context.md` L40.
  - [x] `src/sim/papa/papaFsm.ts`: `PapaState` gains `'onPhone'`, in `PAPA_STATES` too, and `isPapaBusy` includes it. Update the doc.
  - [x] `src/sim/papa/phoneCall.ts` › `startCall(world, ctx, objectId)`: `busyUntil`, `onPhone`, `addFatigue`, then `PhoneAnswered{fatigue}` (the value after the add).
  - [x] `papaSystem.ts`:
    - `OBJECT_ACTIONS.phone`: `ringingDisruptionAt`; if ≥ 0, `answerPhone` then `startCall` and return true; else false.
    - The busy end already goes to `idle` for any state but `drink`: check it and say so in the comment.
  - [x] `events.ts`:
    - `PhoneRingStarted{t, objectId, untilAt}`, `PhoneRinging{t, objectId}`, `PhoneRingEnded{t, objectId, reason: PhoneRingEndReason}` and `PhoneAnswered{t, objectId, untilAt, fatigue}`, with doc comments;
    - `PhoneRingEndReason = 'answered' | 'timedOut'`;
    - `SIM_EVENT_TYPES` stays sorted.
    - `PhoneRinging` is not past tense: the epic and story 3.1 name it. Say so in its doc.
  - [x] `commands.ts`: `StartDisruption{t, index}` (AC 10), in the command list and `commandProblem`.
  - [x] `src/sim/index.ts`: export `DisruptionInstance`, `DisruptionState` and `PhoneRingEndReason` if the client or tools need them.
  - [x] Tests: `phone.test.ts`, `disruptionsSystem.test.ts`, `phoneCall.test.ts`, `papaSystem.test.ts` (rewrite « the phone only walks »: it now walks when quiet, answers when ringing), `threatSystem.test.ts` (press ignored `onPhone`), `snapshot.test.ts`, `step.test.ts`, `commands.test.ts`, `events.test.ts` and `createSim.test.ts`. See § Testing.
- [x] **T4 — Client** (AC 6, 8, 9)
  - [x] `feedbackDirector.ts`:
    - `anchorOf` gains `object`: the position of `sim.objects` entry `objectId`. Pass the objects through the deps (`getObjects()`), or resolve by id on the event.
    - An unknown id warns and skips the ring, like `threat`.
    - `playCue` takes the event's `objectId` (or `null`) beside the `threatId`.
  - [x] `src/client/feedback/disruptionFeedback.ts` › `disruptionCueOf(event, disruptions)`: the def's `feedback.ring` for `PhoneRingStarted` and `PhoneRinging`, `feedback.answer` for `PhoneAnswered`, else `null`. The def is found through the planned disruption of that object (level content). It is the twin of `threatCueOf`; wire it in `boot.ts` › `onSimEvent` next to it. Add a test.
  - [x] `levelScene.ts` / `papaView.ts`: `setOnPhone(isOnPhone)`, a small `PALETTE` toon cube at the side of the head, disposed with the view, and driven in `update` (`world.papa.state === 'onPhone'`).
  - [x] `boot.ts`:
    - the `resumeHeld` busy test (AC 6);
    - mirror `ppPhone` (the last phone event: `ringing` / `answered` / `timedOut`), written on the phone events only, never per frame;
    - delete the mirror at level start.
  - [x] `tools/audio/makePlaceholderAudio.ts`:
    - `tel_phone_ring`: two bursts of about 350 ms of a 440 + 480 Hz pair with a fast tremolo, under 1000 ms in total;
    - `papa_phone_answer`: a short click, about 150 ms;
    - next `SEED + n`; update the header and the test.
    - Run `npm run assets:audio` (macOS) and **keep only the two new `.m4a`**: restore the others from git (1.19 Debug Log: AAC is not byte-stable).
- [x] **T5 — Bots and CLI** (AC 11, 12)
  - [x] Bots need no code: they never send `TapObject`, so the phone always rings out under every bot. Say so in the Completion Notes. A phone-answering bot is not asked.
  - [x] `tools/sim/simReport.ts` (AC 12) and its tests.
  - [x] `tests/tools/sim/phone.test.ts` (AC 11).
- [x] **T6 — Tests to migrate**
  - [x] `tests/support/testContent.ts`:
    - `createTestLevel` gains `disruptions` per wave (default `[]`) and resolves them from a frozen `testPhone.disruption.json`;
    - `LevelContent` fixtures gain `disruptions: {}`.
  - [x] Every `LevelContent` literal in the tests gains `disruptions`: `tsc` lists them.
  - [x] Never delete a test to go green. Rewrite one whose premise changed, and say so.
- [x] **T7 — e2e** (AC 5, 6, 8, 9)
  - [x] New `tests/e2e/phone.spec.ts` (chromium + webkit, frozen with `ppLoadLevel('salon_crawler', 42)`; helpers local to the spec, like `fatigue.spec.ts`).
    - **Ring:**
      - `ppSend StartDisruption{index: 0}`, then advance;
      - expect `PhoneRingStarted`, then `PhoneRinging` every `PHONE_RINGING_EVERY_MS / STEP_MS` steps;
      - `data-pp-phone=ringing`;
      - the cue count grows, a vibration is recorded per ring (`recordVibrations`), and no `[feedback]` warning (`collectProblems`).
    - **Answer by tap:**
      - `objectIconPoint(page, 'phone')`, then `touchscreen.tap`;
      - advance until `PhoneAnswered`;
      - expect `PhoneRingEnded{answered}`, `data-pp-papa-state=onPhone` and the `fatigue` field = previous + `answerFatiguePoints` (from the live def; set a known fatigue with `SetFatigue` first);
      - during the call, a floor tap adds no `PapaPathPlanned`;
      - after `answerBusyMs / STEP_MS` steps, `idle`.
    - **Ring out:** `StartDisruption`, then advance `ringMaxMs / STEP_MS` steps; expect `PhoneRingEnded{timedOut}` and exactly `floor(ringMaxMs / PHONE_RINGING_EVERY_MS)` `PhoneRinging`.
    - Every bound comes from the live content (`content/disruptions/phone.json`, read in `support/game.ts` beside `liveThreat`).
  - [x] Check the long-running specs (`threats`, `timer`, `fatigue`): the phone now rings at 125 s in a live run. No assertion may count every cue or every vibration as a threat's.
- [x] **T8 — Goldens** (AC 13): `npm run golden:update`, then `git diff tests/golden/journals`. Only `worldHash` and `levelHash` may move. If `eventTypes` or `eventsHash` move, a system emits or draws on a level without disruptions: fix that, never the references.
- [x] **T9 — Docs and deferred work**
  - [x] `deferred-work.md`:
    - mark L304 (the phone's arrival action) and L325 (the wave 3 disruption) resolved with « (story 1.20) »;
    - add a « Deferred from: implementation of story 1-20 » section: the noise (3.1), the attention gauge (E6), the ring and vibration placeholders (2.3 / 2.4), no persistent « ringing » marker on the phone, the fixed `atMs`, and the 15 s `ringMaxMs`.
  - [x] `_bmad-output/project-context.md`:
    - the system order gains `runDisruptions` after the director;
    - the busy rule gains `onPhone`;
    - a disruption is planned by a wave (`disruptions: [{ def, object, atMs }]`) and never counts as a threat.
  - [x] `sprint-status.yaml` when done.

## Dev Notes

### Decisions (D1-D10)

| # | Decision | Why |
|---|---|---|
| D1 | **A wave plans a disruption at a fixed absolute `atMs`, on a named object**: `{ "def": "phone", "object": "phone", "atMs": 125000 }`. Architecture L1019 has `def` and `atMs`; `object` is added so that the sim never guesses which object rings (a level may have two phones one day). No PRNG. | « Au pire moment » is the designer's choice of `atMs`, inside wave 3 where three threats run. No draw keeps every existing golden's events and the idle runs identical. Random timing is a later tuning call (Open point 1). |
| D2 | **The phone's numbers live in `phone.json`** (`ringMaxMs`, `answerBusyMs`, `answerFatiguePoints`), not in `feel.json`. | The epic says « la durée maximale du JSON ». A disruption def is to disruptions what a threat def is to threats (`telegraphDelayMs` is in the threat file). It keeps the E6 dog and pot self-contained. |
| D3 | **`DISRUPTION_KINDS` and a `Record<DisruptionKind, handler>`** in `runDisruptions`, even with one kind. The world slice is generic (`pending → ringing → answered / timedOut`). | Same pattern as `OBJECT_ACTIONS` and `GAG_IDS`: E6 adds a kind, and a missing handler does not compile. |
| D4 | **`runDisruptions` is its own system, right after `runDirector`.** Order: `applyCommands, advanceTime, runDirector, runDisruptions, runBaby, runThreats, runPapa, runPhysics, runGauges, runFlow`. | The architecture puts the disruptions with the director's planning (L273, L580), but the director is the threat picker and has its own rules (gaps, `maxSimultaneous`, the baby's `act`). Ticking a ring is neither. Placed before `runPapa`, a ring that times out in the step Papa arrives is over: he finds a silent phone (no special case). Systems still never call each other. |
| D5 | **`PhoneRinging` every `PHONE_RINGING_EVERY_MS` = 1000**, a constant in `shared/constants.ts`, not feel. The ticks are counted from the start, without drift. | It is the unit of a contract: story 3.1 adds « +2 % par seconde de sonnerie » per event, and its +2 lives in `feel.noise`. Making the period tunable would silently change the noise rate. |
| D6 | **The ring sound is a one-shot per `PhoneRingStarted` / `PhoneRinging`**, not a loop. | The audio engine's loops are a closed set (`babble`, `music`) driven by state, and adding a generic loop API is out of scope. One cue per event gives the audio, the wave and the vibration together (triple equivalence for free), at 1 Hz, and it stops by itself on an answer, a timeout, a pause or the end of the level. The clip must stay under 1000 ms. |
| D7 | **Answering is decided on arrival**, like the coffee (1.19 D7). The +10 fatigue is applied **at the answer**, not at the end of the call. | The GDD gives the cost of answering, not of a finished call. Applying it at once makes it visible on the gauge while Papa talks, and a nap that cuts the call (AC 6) cannot cancel it. The coffee is the opposite (−40 at the end) because the GDD says « 3 s d'action » before the remedy. |
| D8 | **`onPhone` is a third busy state.** It reuses all of 1.19 D6: the sim and client gates, the micro-sleep wait, `busyUntil`. | « Attention détournée : aucune réponse possible pendant ce temps » (epic) is exactly the coffee's busy rule. |
| D9 | **A new soundWave anchor `object`**, resolved from `sim.objects` by the event's `objectId`. | The epic wants the waves « autour de `ANCHOR_phone` ». The `soundWave` fx already takes raw x / z. |
| D10 | **The cues come from the def's `feedback`, through `disruptionCueOf`**, not through `feedback.json › events`. | Architecture L1000: `DisruptionDef.feedback.*`. It is the threats' pattern (`threatCueOf`): the E6 dog brings its own cues with no change to the table. |

### Current state of the files this story changes (read before editing)

- **`src/sim/papa/papaSystem.ts`** (`aef1797`):
  - `OBJECT_ACTIONS.phone: () => false`, with the comment « The phone rings and busies Papa in story 1.20 ».
  - `arrive()` emits `PapaArrived`, clears `objectId`, then runs `OBJECT_ACTIONS[kind]`; if that returns false, Papa is `idle`.
  - `runPapa` ends a busy state at `now ≥ busyUntil`: `drink` → `finishCoffee`, any other → `busyUntil = 0` and `idle`. `onPhone` falls in the second branch.
  - The command loop `break`s while `isPapaBusy`.
  - **Keep:** all of that. Only the `phone` entry changes.
- **`src/sim/papa/papaFsm.ts`**: `PapaState` and `PAPA_STATES` hold six states, and `isPapaBusy` = `drink || asleep`.
- **`src/sim/papa/coffee.ts`**: the model for `phoneCall.ts` (`busyUntil`, `enterPapaState`, the event).
- **`src/sim/gauges/fatigue.ts`**: `addFatigue` is a no-op when `ctx.level.microSleepIndex < 0` (no fatigue in the level). The phone calls it anyway.
- **`src/sim/director/directorSystem.ts`**: it is not touched (AC 7).
- **`src/sim/createSim.ts`**:
  - `simLevelOf` builds `threats`, `waves`, `objects` (with `kind`, `xM`, `yM`, `zM`) and `props`, with invariants in the wording of `content:check`.
  - `levelHash = hashJson(level)` (the whole `LevelContent`), so adding `disruptions` moves it.
- **`src/sim/snapshot.ts`**:
  - `version: 7`.
  - `papaProblem` has `const isBusy = slice.state === 'drink' || slice.state === 'asleep'`; replace it with `isPapaBusy`.
  - `worldProblem` destructures the slices; add `disruptions`.
- **`src/sim/step.ts`**: `SYSTEMS` and its header comment, and `ENDED_SYSTEMS` (unchanged: an ended level freezes a ringing phone, and no event comes, so the sound stops).
- **`src/sim/events.ts`**: the union, then the sorted `SIM_EVENT_TYPES`, with its completeness proof.
- **`src/content/schemas/level.ts`**: the header already says « Story 1.20 adds `disruptions` to a wave ». The `superRefine` loops the waves; add the disruption rules there.
- **`src/content/loadLevelContent.ts`**: loads the wave threat defs, then the micro-sleep, collecting every problem. Mirror it for the disruptions.
- **`src/content/contentFiles.ts`**: `CONTENT_PATTERNS = [LEVEL_GEOMETRY_PATTERN, THREAT_DEF_PATTERN, LEVEL_PATTERN]`. `content:check` reports any file under `content/` with no pattern, so `disruptions/phone.json` fails until the pattern exists.
- **`tools/content/contentChecks.ts`**:
  - `checkThreatReferences` checks the threat cues.
  - `checkLevelReferences` checks the wave threats, the micro-sleep and the objects (`OBJECT_ACTION_KINDS`).
  - The feedback checks (about L132-172) refuse a `threat` anchor on an `events`-mapped cue. Extend that to `object`.
- **`src/content/schemas/feedback.ts`**: `SoundWaveSchema.anchor` is `z.enum(['papa', 'baby', 'threat'])`.
- **`src/client/feedback/feedbackDirector.ts`**:
  - `handle(name, world)` and `playCue(cueId, world, threatId)`.
  - `anchorOf` (L80-95) handles `papa` / `baby` / `threat`.
  - The fx is `scene.soundWave(xM, zM, maxRadiusM, durationMs, startAt)`.
- **`src/client/feedback/threatFeedback.ts`**: `threatCueOf(event, world, defs)`, the model for `disruptionCueOf`.
- **`src/client/render/levelScene.ts`**: `update` (L319-332) calls `papa.setEyelids` / `setAsleep` / `setDrinking` every frame. Add `setOnPhone` there.
- **`src/client/render/views/papaView.ts`**: the mug (L150-156, L202) is the model for the handset.
- **`src/client/boot.ts`**:
  - `onSimEvent` (L603-668): `director.handle`, then `threatCueOf` → `playCue`, … `PapaStateChanged` to `idle` from `drink` / `asleep` → `resumeHeld` (L651-657).
  - The mirrors are a typed union of names (about L190-224); add `ppPhone`. `mirrorObjectPoints` already writes `ppObjectPx` with the phone's point.
- **`src/client/input/*`**: no change expected. The busy gate is `isPapaBusy(world.papa)` (inputMapper L158-161); `pickObject` and `pickContextObject` already reach the phone.
- **`src/client/app/threatsSwitch.ts`** › `withoutThreats`: it empties `waves` and keeps the micro-sleep def. Add `disruptions: {}`.
- **`tools/sim/simReport.ts`**: counters `microSleeps`, `coffees` and `asleepRuns` (1.19), per run then summed. Same pattern.
- **`tools/audio/makePlaceholderAudio.ts`**: `PLACEHOLDER_CLIPS` (L546-560), the synth functions with `createRng(SEED + n)` (the micro-sleep uses `SEED + 5`), and `samplesOf` / `normalize`.

### Architecture compliance

- **Sim purity.** No randomness is drawn here (D1). No `Math.random`, `Date` or `performance`.
- **Systems never call systems.**
  - `runDisruptions` calls helpers (`phone.ts`).
  - `runPapa` calls `ringingDisruptionAt`, `answerPhone` and `startCall`, all helpers, as it calls `startCoffee`.
  - `startCall` calls `addFatigue` (a helper).
- **FSMs.** `disruption.state` changes only through `enterDisruptionState`, and `papa.state` through `enterPapaState`. Durations are instants (`untilAt`, `busyUntil`, `nextRingingAt`).
- **Events** are past tense, except `PhoneRinging` (named by the epic, D5). **Commands** are imperative (`StartDisruption`).
- **Units:** `ringMaxMs`, `answerBusyMs`, `answerFatiguePoints`, `atMs`, `untilAt`, `PHONE_RINGING_EVERY_MS`.
- **Zero allocation** in `step()`, `runDisruptions`, the feedback director's per-event path and `levelScene.update`.
- **Client** imports only `@sim`, `@content`, `@shared` and `three`. No DOM overlay for the phone.
- **Content.** A new JSON is not done until `content:check` passes. `content/_schemas` is regenerated, never hand-edited.

### Library and framework notes

- Zod 4 (pinned): `z.strictObject`, `z.enum`, `.default([])`, `superRefine`. A refine does not show in the generated JSON Schema.
- Three.js: the handset is a toon box from `toonMaterial.get(color)` with a `PALETTE` colour (no new hex in TS).
- No new dependency. The audio tool needs macOS `afconvert`; CI never runs it.

### File structure

| File | New / Update |
|---|---|
| `content/disruptions/phone.json`, `content/_schemas/disruption.schema.json` | New |
| `content/levels/salon_crawler.json`, `content/feedback.json`, `content/_schemas/{level,feedback}.schema.json` | Update |
| `src/content/schemas/disruption.ts` (+ test) | New |
| `src/content/schemas/{level,feedback}.ts`, `src/content/{contentFiles,contentBundle,loadLevelContent}.ts`, `tools/content/contentChecks.ts` | Update |
| `src/sim/disruptions/{disruptionFsm,phone,disruptionsSystem}.ts`, `src/sim/papa/phoneCall.ts` (+ tests) | New |
| `src/sim/{world,context,createSim,snapshot,step,events,commands,index}.ts`, `src/sim/papa/{papaFsm,papaSystem}.ts`, `src/shared/constants.ts` | Update |
| `src/client/feedback/disruptionFeedback.ts` (+ test) | New |
| `src/client/feedback/feedbackDirector.ts`, `src/client/render/{levelScene,views/papaView}.ts`, `src/client/app/threatsSwitch.ts`, `src/client/boot.ts` | Update |
| `tools/audio/makePlaceholderAudio.ts`, `public/assets/audio/{tel_phone_ring,papa_phone_answer}.m4a` | Update / New |
| `tools/sim/simReport.ts`, `tests/tools/sim/phone.test.ts` (new), `tests/support/testContent.ts` (+ `testPhone.disruption.json`), `tests/e2e/phone.spec.ts` (new), `tests/e2e/support/game.ts`, `tests/golden/journals/*` | Update |

### Testing

**Unit (Node, Vitest; time in steps):**
- **`phone.test.ts` / `disruptionsSystem.test.ts`:**
  - pending until `atMs`, then ringing at the first step ≥ `atMs`;
  - the ticks at `start + k × 1000`, exactly `floor(ringMaxMs / 1000)` of them;
  - a tick and the timeout in the same step: the tick first;
  - the timeout emits once and the state stays `timedOut`;
  - no second start;
  - `StartDisruption` on a pending one starts it now, and on any other state does nothing;
  - nothing while the flow is `ended`;
  - zero `world.rng` draws (compare the rng state after 20 000 steps with and without the disruption).
- **Answering (`phoneCall.test.ts`, `papaSystem.test.ts`):**
  - a `TapObject` while it rings, walk, then on arrival `PhoneRingEnded{answered}` → `PhoneAnswered` with fatigue +10 (clamped at 100) → `onPhone` for exactly `answerBusyMs` → `idle`;
  - a `TapObject` while quiet only walks;
  - a timeout during the walk means arrival is idle;
  - a `TapFloor` before arrival cancels;
  - commands during `onPhone` are ignored;
  - a threat that opens during the call gags `late`;
  - a micro-sleep gag during the call → `asleep`, and the fatigue stays;
  - a level without fatigue: the fatigue is unchanged and the call still busies.
- **Director:** with the phone ringing, wave 3 still telegraphs up to `maxSimultaneous` threats.
- **Snapshot v8** fields, `createSim` refusals (AC 3), `StartDisruption`, `SIM_EVENT_TYPES` sorted, and the pinned `SYSTEMS` order.
- **Content:** schema and refine cases, `loadLevelContent` (a missing disruption file names the path), `content:check` (AC 3 and the `object` anchor rule).
- **Client:**
  - `disruptionCueOf`;
  - `feedbackDirector` (`object` anchor: ring at the object's x / z; an unknown id warns and skips);
  - `papaView` / `levelScene` (`setOnPhone`);
  - `threatsSwitch` (`disruptions: {}`).
- **Bots / CLI:** `simReport` (the three counters) and `phone.test.ts` (AC 11).

**e2e:** T7. **Golden:** T8.

### Previous story intelligence (1.17-1.19)

- **1.19:**
  - The busy machinery (`isPapaBusy`, `busyUntil`, the client gate, `resumeHeld` on `PapaStateChanged → idle`).
  - The object arrival action is a `Record<ObjectKind, …>`, and `Sim.objects` exposes the objects.
  - `pickObject` and `objectIconPoint` (e2e).
  - `SetFatigue` is the model for `StartDisruption`.
  - Its deviations to remember:
    - `runFatigue` sits in `fatigueSystem.ts` to avoid an import cycle with `threatFsm.ts`. Watch the same cycle risk between `papa/` and `disruptions/`: `phone.ts` must not import `papaSystem.ts`.
    - The CSS state classes must start with `pp-`.
    - `npm run assets:audio` rewrites every `.m4a`: restore the others.
    - Its baseline CI was contaminated by edits made while it ran.
- **1.18:**
  - `ENDED_SYSTEMS` freezes the world at the end of the level.
  - The live 180 s idle tests take time (120 s timeouts); `phone.test.ts` can stop at `atMs + ringMaxMs + STEP_MS` with `--until-ms`-like logic rather than play 180 s, if it stays a full-level check of the plan.
  - `LogChannel` has no `level`.
- **1.17:** `pickContextObject` (Space / A) needs no active threat. In wave 3, with threats up, Space / A targets the threat, so the phone is answered by a tap or between threats. That is the « choose » of the GDD.
- **1.15 / 1.16 reviews** punished:
  - e2e tied to live timings or ids;
  - tautological assertions;
  - records that overstate what was verified.

  Derive every bound from the content and `STEP_MS`. Tick only what you ran.

### Git intelligence

- The commits read « Story X : création de la story », « Story X : <titre> » and « Story X : corrections de la revue de code », in French, with a space before the colon. The implementation commit is `Story 1.20 : le téléphone qui sonne`.
- Goldens, schemas and generated audio go in the same commit as the code that changes them.

### Project context rules (from `_bmad-output/project-context.md`)

- System order and « systems never call each other » (L40). FSMs only through `enter…State()`, with instants or `enteredAt` (L43).
- `TapObject` for objects. The hit-test priority is threat > (baby) > object > floor.
- No GDD number hard-coded (D2). Every feedback entry with `audio` has `visual` and `haptic`.
- Zero allocation in hot paths. Goldens are regenerated deliberately.
- No `enum`, no constructor parameter properties, no new library.

### Open points for Geo (do not block on them; implement the decisions above)

1. **When the phone rings:** fixed at 125 s (5 s into wave 3, D1). Should it be drawn at random within wave 3 instead (`atMinMs` / `atMaxMs`)?
2. **How long it rings:** `ringMaxMs` 15 s. Ignored, that will be +30 % noise once story 3.1 lands.
3. **A vibration on every ring** (1 per second, up to 15). Too much on a phone? `feedback.json` can drop the haptic from the ring cue and keep it on the first ring only (a second cue on `PhoneRingStarted`).
4. **No visible « ringing » icon on the phone** beyond the waves every second. Do you want a marker (like the threat icons) while it rings?
5. **Bots never answer**, so `npm run sim` always shows the phone ringing out. A bot that answers is a later need (1.24 playtest metrics?).

### References

- `epics.md`: L42, L65, L67, L1001-1031 (1.18), L1033-1064 (1.19), L1066-1086 (1.20), L1281-1284 (2.3) and L1545-1572 (3.1).
- GDD L91, L200, L213, L238, L366, L372, L480 and L495.
- Architecture L71, L229-230, L259, L273, L472, L493, L538, L580, L586, L941, L988, L1000 and L1019.
- `EXPERIENCE.md` L295, L393 and L409-435.
- `deferred-work.md` L304 and L325.
- `1-18-vagues-de-menaces-et-chrono-du-niveau.md` (D10, L44) and `1-19-fatigue-cafe-et-micro-siestes.md` (D5-D7, Downstream consumers, Debug Log).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5

### Debug Log References

- **Baseline (T0), before the first code edit:** `(unset VITE_DEBUG_ALLOWED; npm run ci)` green, exit 0. Typecheck, lint and `content:check` clean; Vitest 180 files / 2899 tests with coverage; Playwright 222 passed (chromium + webkit); `build:playtest` built. `env | grep VITE_` showed `VITE_DEBUG_ALLOWED=false`, unset for every CI, dev and e2e command below. 1.19 was `done`, with `git status` clean outside `_bmad-output/`.
- While the baseline ran, Geo committed `ef37359` (« Story 1.19 : terminée ; Story 1.20 : création de la story »), which carried my `baseline_commit` and `in-progress` edits to this story file and the sprint status (docs only). A stray untracked `tests/e2e/tmp-mug.spec.ts` (not mine) appeared at 10:57 and was gone before the final run. `baseline_commit` stays `ef78496`.
- **Final:** `npm run typecheck`, `npm run lint`, `npm run content:check` and `npm run build:playtest` green. Vitest **185 files / 3023 tests** with the `src/sim` coverage thresholds met (Statements 98.02 %, Branches 96.62 %, Functions 100 %, Lines 99.27 %). Playwright **230 passed** (222 + the 8 of `phone.spec.ts`).
- **Load, said plainly.** The machine was under a load average of 20 to 30 (an iOS simulator and other processes, partly my own CI). The first full `npm run ci` failed only on two `makePlaceholderAudio` tests timing out at 5 s (7.4 s and 7.6 s under coverage; 1.4 s alone). I re-ran `npm run test:coverage -- --maxWorkers=5` (green, 185 / 3023). The first `npm run e2e` lost its dev server under load (`ERR_CONNECTION_REFUSED`, 28 passed, the two `autoplay` failures in it passed alone straight after). I re-ran the whole suite with `npx playwright test --workers=4`: 230 passed. So the green CI is two commands (`--maxWorkers=5`, `--workers=4`) and not one plain `npm run ci`; no test or timeout was changed for it.
- **Goldens (T8):** `npm run golden:update`. In the six `*.expected.json` only `worldHash` moved (the new `disruptions` slice); in the six journals only `levelHash` moved (`LevelContent.disruptions`, the waves' `disruptions: []`). `eventTypes` and `eventsHash` are identical in all six. The screenshot references did not move (the first-threat shot is unchanged).
- **Audio:** `npm run assets:audio` rewrote every `.m4a`; I restored the thirteen others from git and kept `tel_phone_ring.m4a` (850 ms) and `papa_phone_answer.m4a` (150 ms).

### Implementation Plan

- **Content.** `DisruptionDefSchema` (`ringMaxMs`, `answerBusyMs`, `answerFatiguePoints`, `feedback.{ring,answer}`), a `disruptions/` `ContentPattern`, `LevelWaveDisruptionSchema` on the waves with the three refine rules, `LevelContent.disruptions`, loaded by `loadLevelContent` after the threat defs. `content:check` names the file, the path and the culprit for a missing def file, a def/object kind mismatch and a cue that is not in `feedback.json`; it also refuses an `object` anchor on an `events`-mapped cue or on a threat def's cue, and a `threat` anchor on a disruption cue.
- **Sim.** `world.disruptions` (`pending → ringing → answered / timedOut`, `enterDisruptionState` the only writer), `SimLevel.disruptions` index-aligned, snapshot v8 with `disruptionsProblem`, `runDisruptions` right after `runDirector` with a `Record<DisruptionKind, handler>`, the phone helpers (`startRinging`, `tickRinging`, `ringingDisruptionAt`, `answerPhone`), `onPhone` as a third busy state, `startCall` (`busyUntil`, `addFatigue`, `PhoneAnswered`), the four events, the `StartDisruption` debug command. The ticks are due from the start (`nextRingingAt` advances by exactly `PHONE_RINGING_EVERY_MS`), so they never drift, and a tick due in the timeout step comes first.
- **Client.** `disruptionCueOf` (twin of `threatCueOf`), the director's `object` anchor read from `getObjects()`, `playCue(..., objectId)`, `papaView.setOnPhone` driven by `levelScene.update`, `ppPhone` mirror on the phone events only, `resumeHeld` on every busy state, `ppFatigue` refreshed on `PhoneAnswered`.

### Completion Notes List

- ✅ All nine tasks and every acceptance criterion done; the headless check (AC 11) plays the live `salon_crawler` with the `idle` bot over 3 seeds and reads every bound from the live content and `STEP_MS`.
- ✅ The Dev Notes' decisions D1-D10 are implemented as written. Deviations and additions, all small:
  - `startCall(world, ctx, index)` takes the planned disruption's **index**, not the `objectId`: once `answerPhone` has run, the instance is `answered`, so `ringingDisruptionAt` could not find it again, and the index gives the def and the object without a second lookup.
  - `createSim` refuses a def that is not loaded, an object that is not in the level, a kind mismatch and an object planned twice, in the wording of `content:check`. It does **not** check the def's feedback cues: they live in `feedback.json`, which the sim ignores by design (like the threats' cues). `content:check` does (AC 3's third item).
  - `playCue` keeps `threatId` as its third parameter and gets an optional fourth, `objectId`, so no existing call changed. `FeedbackDirectorDeps.getObjects` is optional for the same reason.
  - No separate `src/sim/disruptions/phone.test.ts`: the phone helpers are covered through `disruptionsSystem.test.ts` (starts, ticks, drift, timeout, `StartDisruption`, rng, director, ended level) and `phoneCall.test.ts` (answer, busy, late gag, nap, no fatigue gauge, timeout during the walk) and `snapshot.test.ts` (v8, a ringing phone and a call mid-way).
  - An extra content rule beyond the story: a disruption cue anchored on a `threat` is refused (its events name an object), as is an `object`-anchored cue on a threat def.
  - `?threats=off` has no phone (the waves are emptied, so are the disruptions). Said in `deferred-work.md`.
- ✅ **Tests rewritten because their premise changed (none deleted):** `papaSystem.test.ts` / `coffee.test.ts` « the phone only walks » now say it only walks when it is **not ringing**; the `levelSchema` and `checkContent` tests that replace the level's `objects` first drop the phone's disruption (it needs its object); `sleep.test.ts` (`isPapaBusy` now includes `onPhone`); `threatSystem.test.ts` (the busy-press test runs for `asleep`, `drink` and `onPhone`); `inputMapper.test.ts` (the client busy gate for `onPhone`).
- ✅ **Bots need no code.** They never send `TapObject`, so the phone rings out under every bot, `phoneAnswers` stays 0 in the CLI report. A phone-answering bot is not asked (Open point 5).
- ✅ The phone is not a threat: the director is untouched, and `disruptionsSystem.test.ts` proves wave 3 telegraphs the same three threats, at the same steps, with and without a ringing phone, and that 20 000 steps leave `world.rng` and `nextId` identical.
- ✅ The Open points for Geo (fixed 125 s, 15 s ring, a vibration every ring, no marker on the phone, bots never answer) are implemented as the decisions say and listed in `deferred-work.md`.
- ⚠️ **Not verified by me:** how the ring and the handset look and feel on a real phone (the vibration is recorded by Playwright in chromium only; WebKit has no `vibrate`). No screenshot of the handset was taken: the frozen shot does not show a call.

### File List

**New**
- `content/disruptions/phone.json`
- `content/_schemas/disruption.schema.json`
- `public/assets/audio/tel_phone_ring.m4a`
- `public/assets/audio/papa_phone_answer.m4a`
- `src/content/schemas/disruption.ts`
- `src/sim/disruptions/disruptionFsm.ts`
- `src/sim/disruptions/phone.ts`
- `src/sim/disruptions/disruptionsSystem.ts`
- `src/sim/disruptions/disruptionsSystem.test.ts`
- `src/sim/papa/phoneCall.ts`
- `src/sim/papa/phoneCall.test.ts`
- `src/client/feedback/disruptionFeedback.ts`
- `src/client/feedback/disruptionFeedback.test.ts`
- `tests/content/disruptionSchema.test.ts`
- `tests/support/testPhone.disruption.json`
- `tests/tools/sim/phone.test.ts`
- `tests/e2e/phone.spec.ts`

**Modified**
- `content/feedback.json`, `content/levels/salon_crawler.json`
- `content/_schemas/feedback.schema.json`, `content/_schemas/level.schema.json`
- `src/shared/constants.ts`
- `src/content/contentBundle.ts`, `src/content/contentFiles.ts`, `src/content/loadLevelContent.ts`
- `src/content/schemas/feedback.ts`, `src/content/schemas/level.ts`
- `src/sim/commands.ts`, `src/sim/context.ts`, `src/sim/createSim.ts`, `src/sim/events.ts`, `src/sim/index.ts`, `src/sim/snapshot.ts`, `src/sim/step.ts`, `src/sim/world.ts`
- `src/sim/papa/papaFsm.ts`, `src/sim/papa/papaSystem.ts`
- `src/client/boot.ts`
- `src/client/app/threatsSwitch.ts`
- `src/client/feedback/feedbackDirector.ts`
- `src/client/input/inputMapper.ts`
- `src/client/render/levelScene.ts`, `src/client/render/views/papaView.ts`
- `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, `tools/sim/simReport.ts`
- Tests: `src/sim/commands.test.ts`, `src/sim/createSim.test.ts`, `src/sim/events.test.ts`, `src/sim/snapshot.test.ts`, `src/sim/step.test.ts`, `src/sim/papa/coffee.test.ts`, `src/sim/papa/papaSystem.test.ts`, `src/sim/papa/sleep.test.ts`, `src/sim/threats/threatSystem.test.ts`, `src/client/app/threatsSwitch.test.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/client/input/inputMapper.test.ts`, `src/client/render/levelScene.test.ts`, `src/client/render/views/papaView.test.ts`, `tests/content/checkContent.test.ts`, `tests/content/levelSchema.test.ts`, `tests/content/loadLevelContent.test.ts`, `tests/support/testContent.ts`, `tests/threats/threatCatalog.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tests/tools/sim/runSim.test.ts`, `tests/tools/sim/simReport.test.ts`, `tests/e2e/support/game.ts`
- Goldens (regenerated, `worldHash` and `levelHash` only): `tests/golden/journals/{baby_wander,core_basic,outlet_parry,papa_walk,prop_fall,threat_trio}.json` and `….expected.json`
- Docs: `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file

### Change Log

- 2026-10-28: Story 1.20 implemented. A phone planned by wave 3 (`disruptions: [{ def, object, atMs }]`, `content/disruptions/phone.json`) rings at 125 s with `PhoneRingStarted`, one `PhoneRinging` per second and a timeout after `ringMaxMs`; a `TapObject` that arrives while it rings answers it (`+answerFatiguePoints`, `onPhone` for `answerBusyMs`, a new busy state). `runDisruptions` joins the system order after the director; snapshot v8; `StartDisruption` debug command; the ring and the pick-up are placeholder cues anchored on the object (new `object` soundWave anchor); a handset cube on Papa's head during the call; `ppPhone` mirror; CLI counters `phoneRings`, `phoneAnswers`, `phoneRingingSeconds`. Goldens regenerated deliberately (`worldHash`, `levelHash` only).
