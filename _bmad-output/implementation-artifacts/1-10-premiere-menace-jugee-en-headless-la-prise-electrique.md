---
baseline_commit: 1c24ae4623a855321f4323e51f846a5dab96e92e
---

# Story 1.10: First Threat Judged Headless, the Electrical Outlet

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.10 « Première menace jugée en headless, la prise électrique ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As an AI developer agent,
I want the electrical outlet to be scheduled, telegraphed and judged entirely inside the simulation,
so that the core verb « read, then respond right » is validated by tests, with no browser.

**Requirements covered:** FR1 (telegraph → delay → window → result, early or late is a gag), FR2 (Parry: press on the threat, 300 ms window, release before 400 ms counts as Parry — ADR-010), FR7 (timing measured at the press; delay, perfect window, hidden tolerance, input buffer), FR15 (second half: the baby's gaze locks on its target during the telegraph), FR25 (the outlet: 1.2 s, Parry, gag `outlet_hair`), NFR9 (the gag is an event, never an injury), NFR4 / NFR12 (windows in sim ms, all of it testable in Node). It is the first story of `src/sim/timing/`, `src/sim/threats/`, `src/sim/director/`, `content/threats/` and `LevelSchema`: stories 1.11 (tap and visuals), 1.12 (bots), 1.14 (hitstop, slow-mo), 1.16 (two more threats), 1.17 (auto-target), 1.18 (waves), 1.19 (fatigue modifier, micro-sleep threat), 1.23 (Firmness) and 2.9 (instinct modifier) all build on it.

## Precondition (check first, stop if it fails)

Story 1.9 is in `review`, and its review fixes are **uncommitted** in the working tree at the time of writing (`audioEngine.ts`, `startGesture.ts`, `levelSession.test.ts`, `constants.ts`, `deferred-work.md`…). Start only when 1.9 is `done` in `sprint-status.yaml` and its fixes are committed (`git status` clean apart from `_bmad-output/`), then run `npm run ci` green before the first edit so any later failure is yours. If not, stop and tell Geo. This story edits files 1.9 touched (`src/sim/events.ts`, `src/content/contentFiles.ts`, `tools/content/contentChecks.ts`, `content/feedback.json`, `src/client/app/levelSession.ts` and its test, `src/client/boot.ts`, `tests/support/testContent.ts`): build on whatever the 1.9 review changed, never revert it.

## Acceptance Criteria

From the epic (1 to 6), then derived from the architecture, the existing code and the deferred work (7 to 11).

1. **Content.** `content/threats/outlet.json` is validated by `ThreatDefSchema` (`response: "parry"`, `telegraphDelayMs: 1200`, `windowMs: null` = the standard window, `gag: "outlet_hair"`, feedback cue ids, `cooldownMs`). `LevelSchema` (minimal, D3) validates `content/levels/<id>.json`. `npm run content:check` refuses: a threat or level file whose `id` is not its file name, a level that plans an unknown threat def or an anchor its geometry lacks, a level without its `<id>.geometry.json`, a threat whose feedback cue is not in `feedback.json` `cues`, an unknown gag id. Each problem names the file and the JSON path.
2. **Director and telegraph.** Given a test level that plans the outlet, when the minimal director targets it, then the threat enters `telegraph` (`ThreatTelegraphed`), the baby locks its gaze on `ANCHOR_outlet_01` (`targetLocked`, `BabyStateChanged`) and then approaches it (`approach`); the window opens **exactly** 1200 ms of sim time after the telegraph (`WindowOpened`), whatever the time scale.
3. **Parry judged.** Given the open window, when the sim receives `PressThreat{threatId, t}` then `Release{t}` (held less than `holdMinMs`), then `judgePress` rates the press `perfect` (within ±`perfectMs / 2` = ±50 ms of the window centre) or `success` (inside the window ± tolerance, or inside the input buffer before it), the sim emits `ResponseResolved{quality, offsetMs}` and the threat is `resolved`; Papa received a glide at the press (`papa.glide = {…, arriveAt}`, `PapaGlideStarted`) and arrives in at most `glideMaxMs` (600 ms, P3).
4. **Gag.** An early press (before the window minus tolerance and buffer, D6) with `earlyPress = "fail"`, or no press until the window and its tolerance are over, sends the threat to `gag`: `ResponseResolved{quality: "fail", reason: "early" | "late"}` then `GagTriggered{gag: "outlet_hair"}`. The gag is an event only: no health, no game over, nothing removed (NFR9). With `earlyPress = "guard"`, an early press starts the glide without any judgement or event of the threat, and only a new press in the window counts.
5. **Timing functions.** `src/sim/timing/effectiveWindow.ts` (base × tier × fatigue × instinct, then ± tolerance; modifiers at 1 while their systems do not exist, D8), `judge.ts` (`judgePress`) and `classifyPress.ts` have unit tests at every boundary, to the millisecond (D6, D7).
6. **Generated catalogue tests.** Every file of `content/threats/` generates the « perfect », « success », « too early » and « too late » tests automatically (`tests/threats/threatCatalog.test.ts`), with no code specific to a threat.
7. **Hold and release.** The response type is decided at `Release` or once the press has been held `holdMinMs` (ADR-010): a Parry threat held that long is a gag with `reason: "wrongResponse"`. A press whose type is known before the window opens (buffered press) resolves at the step the window opens. A threat with a pending press never expires. A `Release` with no pending press, and a `PressThreat` on an unknown or `idle` threat, do nothing.
8. **Cycle.** A `resolved` or `gag` threat returns to `idle` after its `cooldownMs` (`ThreatRearmed`), and the director may target it again once the baby is free. After `resolved` the baby babbles again; after `gag` it plays `act` for `feel.baby.actMs`, then babbles.
9. **Deterministic.** A new golden scenario `outlet_parry` passes and exercises `world.rng`, entity ids and the threat events (perfect, early gag, late gag at least). `core_basic`, `papa_walk` and `baby_wander` are regenerated deliberately and their **events are unchanged** (same `eventTypes`, same `eventsHash`). Journal and snapshot are version 3 and carry `levelHash` (D13). A snapshot taken mid-telegraph and restored with its journal tail gives the uninterrupted hash.
10. **The client still plays.** The client loads `content/levels/salon_crawler.json` with the level's assets and gives it to `createSim`; a level file that fails to load goes to « Oups » with a `warn`. The live level plans **no** threat yet (D4), so the browser game behaves exactly as after story 1.9; every existing e2e spec passes unchanged.
11. **Quality gates.** `npm run ci` passes. `biome.json` and the existing `tests/architecture/*.test.ts` are untouched. No new npm dependency. `src/sim` coverage stays ≥ 90 %. Golden references are regenerated only with `npm run golden:update`, and the Completion Notes say which and why.

## Tasks / Subtasks

- [x] **T0: Precondition (all ACs)** — check the Precondition section; `npm run ci` green before the first edit.
- [x] **T1: Content schemas and files (AC 1)**
  - [x] `src/content/schemas/threat.ts`: `ThreatDefSchema` per Dev Notes › Threat definition, `z.strictObject`, `.describe` on every key with its unit; ids with the existing `SNAKE_ID_PATTERN` (the one `levelGeometry.ts` imports). Export `ThreatDef`, `ThreatResponse`.
  - [x] `src/content/schemas/level.ts`: `LevelSchema` per Dev Notes › Level (D3). Export `Level`, `LevelThreatEntry`.
  - [x] `src/content/contentBundle.ts`: `LevelContent { level: Level; threats: Readonly<Record<string, ThreatDef>> }` (exactly the defs the level plans, keyed by id, in order of first reference).
  - [x] `src/content/contentFiles.ts`: `THREAT_DEF_PATTERN` (`threats/`, `.json`, schema `threat`) and `LEVEL_PATTERN` (`levels/`, `.json`, schema `level`) in `CONTENT_PATTERNS`, **after** `LEVEL_GEOMETRY_PATTERN`; `matchContentPattern` only accepts an id matching `SNAKE_ID_PATTERN`, so `levels/salon_crawler.geometry.json` can never match `LEVEL_PATTERN` (test it in both orders).
  - [x] `src/content/loadLevelContent.ts` (+ `tests/content/loadLevelContent.test.ts`): `loadLevelContent(source, levelId): Promise<Result<LevelContent, ContentError>>` per Dev Notes › Loading a level. Never throws, never logs; collects every problem; same `parseContentFile` path as `loadContent`.
  - [x] `content/threats/outlet.json`, `content/levels/salon_crawler.json` (`"threats": []`, D4), each with a `$schema` pointer (`../_schemas/threat.schema.json`, `../_schemas/level.schema.json`). `content/feedback.json`: the four haptic-only cues of Dev Notes › Feedback cues (no `events` entry).
  - [x] `src/content/schemas/feel.ts`: `baby.lockMs`, `baby.approachSpeedMps`, `baby.actMs` (Dev Notes › Feel); fix the `earlyPress` description (D6 wording). Same keys and values in `content/feel.json` and `tests/support/testFeel.json`. Cases in `tests/content/feelSchema.test.ts` (negative values, speed 0 and above `MAX_CRAWL_SPEED_MPS`).
  - [x] `npm run content:schemas` (generates `threat.schema.json`, `level.schema.json`, regenerates `feel.schema.json`; never by hand), then `npm run content:check`. `tests/content/jsonSchema.test.ts`: the two new `$schema` pointers.
  - [x] `tests/content/threatSchema.test.ts`, `tests/content/levelSchema.test.ts`: the live files parse; refused: unknown key at any level, `response: "firm"` (not yet, D2), `telegraphDelayMs` 0 or negative, `windowMs` 0, a cue id or gag id not in lower_snake_case, negative `cooldownMs` / `fromMs`, a level `id` with a dot. Unit-suffix rule on every numeric key (`Ms`), same spirit as `feelSchema.test.ts`.
- [x] **T2: `content:check` cross-references (AC 1)**
  - [x] `tools/content/contentChecks.ts`: Dev Notes › Content checks. `GAG_IDS` comes from `@sim` (like `SIM_EVENT_TYPES`). Cases with failing fixtures in `tests/content/checkContent.test.ts` (its temp root copies `content/`; add the threat and level fixtures there).
- [x] **T3: Timing (`src/sim/timing/`, AC 5, 7)**
  - [x] `effectiveWindow.ts` (+ test): `effectiveWindow(timing, baseWindowMs, modifiers): EffectiveWindow` (D8).
  - [x] `judge.ts` (+ test): `judgePress(pressT, windowOpenAt, window): Judgement`, the architecture's code (P1) as written (D6). Every boundary to the ms (Dev Notes › Timing test cases).
  - [x] `classifyPress.ts` (+ test): `classifyPress(pressT, releasedAt, nowT, holdMinMs): 'parry' | 'firm' | null` (D7).
- [x] **T4: Threats (`src/sim/threats/`, AC 2, 3, 4, 7, 8)**
  - [x] `gags.ts`: `GAG_IDS = ['outlet_hair'] as const`, `GagId`. No consequence code (D10).
  - [x] `threatFsm.ts`: `ThreatState`, `enterThreatState` (the only writer of `state` / `enteredAt`, no event) and one helper per transition, each emitting its event(s) (D9): `telegraphThreat`, `openWindow`, `resolveThreat`, `gagThreat`, `rearmThreat`.
  - [x] `threatSystem.ts` (+ test): `runThreats(world, ctx)` per Dev Notes › Threat rules.
  - [x] Events (`events.ts` + `SIM_EVENT_TYPES`): `ThreatTelegraphed`, `WindowOpened`, `ResponseResolved`, `GagTriggered`, `ThreatRearmed`, `PapaGlideStarted` (Dev Notes › Events). Commands (`commands.ts` + `COMMAND_TYPES` + `commandProblem`): `PressThreat{t, threatId}`, `Release{t}`.
- [x] **T5: Director (`src/sim/director/directorSystem.ts`, AC 2, 8)** (+ test): `runDirector(world, ctx)` per Dev Notes › Director rules.
- [x] **T6: Baby (`src/sim/baby/`, AC 2, 8)**
  - [x] `babyFsm.ts`: `BabyState` gains `targetLocked`, `approach`, `act` (D1 of story 1.8: each story adds what it uses).
  - [x] `World.baby` gains `targetThreatId` and `approachSpeedMps` (Dev Notes › World).
  - [x] `approach.ts` (+ test): `planApproach(baby, grid, toXM, toZM): boolean` (A* + string pulling to the nearest open cell of the baby's region, same snapping rule as Papa's tap), `gazeAt(baby, xM, zM)` (unit vector, unchanged when the distance is 0).
  - [x] `babySystem.ts` (+ tests): Dev Notes › Baby rules. The wander/babble behaviour of story 1.8 must not change when no threat is active (its tests and the `baby_wander` events stay identical).
- [x] **T7: Papa's glide (`src/sim/papa/`, AC 3, 4)**
  - [x] Extract the planning of `tapFloor` into `papa/planWalk.ts` (`planWalkTo(papa, grid, xM, zM) → { goalXM, goalZM } | null`, writing `papa.path`), used by `tapFloor` and the glide. No behaviour change: the `papa_walk` events must be identical before and after (check before T9 changes the world).
  - [x] `PapaState` gains `glide`; `World.papa.glide` (Dev Notes › World). `glide.ts` (+ test): `startGlide(world, ctx, threat)` per Dev Notes › Glide rules. `papaSystem.ts`: `PressThreat` handling, glide movement, `TapFloor` / `Move` cancel a glide, `MoveStop` does not.
- [x] **T8: Sim wiring (AC 2, 9)**
  - [x] `context.ts`: `StepContext.level: SimLevel` (Dev Notes › World). `createSim.ts`: `CreateSimOptions.level: LevelContent` (required); build `ctx.level` and the initial `world.threats` (ids from `allocateId`, in level order); invariants of Dev Notes › createSim checks; `levelHash`.
  - [x] `step.ts`: `SYSTEMS = [applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa]` (the architecture slots); update the comment and the pinned order in `step.test.ts`.
  - [x] `journal.ts`, `snapshot.ts`: version 3 with `levelHash` (D13); a version 2 journal gets a message saying it was recorded before the sim read the level (story 1.10). `worldProblem`: `threatProblem` for each instance, Papa's `glide` and the new baby fields and states (Dev Notes › Snapshot checks). `replay.ts`: `ReplayOptions.level`, refused with an `err` on another `levelHash`.
  - [x] `index.ts`: export `GAG_IDS`, `GagId`, `ThreatState`, `ThreatInstance`, `ResponseQuality` (and keep every existing export).
- [x] **T9: Every `createSim` / `replayJournal` call site (AC 9, 11)**
  - [x] `tests/support/testContent.ts`: `createTestLevel(entries = [])` (a `LevelContent` with id `salon_crawler`, the frozen outlet def `tests/support/testOutlet.threat.json` — a byte copy of the live file, never the live file) and `outletEntry(fromMs)`. Every existing call site passes `level: createTestLevel()` (no threat: behaviour unchanged). Never weaken what a test proves; tests asserting exact event lists of other subjects still filter to their subject (story 1.8 D10).
- [x] **T10: Golden and determinism (AC 9)**
  - [x] `tests/golden/scenarios.ts`: a `level` per scenario (`createTestLevel()` for the three existing ones) and `recordScenario` / the golden harness pass it; new scenario `outlet_parry` (Dev Notes › Golden scenario) and `tests/golden/outletParry.test.ts` pinning what it covers.
  - [x] Before `golden:update`, record the current `eventTypes` / `eventsHash` of the three existing scenarios; after it, check they are identical (only `worldHash`, `feelHash`, `levelHash` and the version change). Say so in the Completion Notes.
  - [x] `snapshot.test.ts`: mid-telegraph snapshot (threat `telegraph`, baby `approach`, Papa `glide`) restored with its tail gives the uninterrupted hash; a snapshot with an unknown threat state, a `windowOpen` threat without `window`, or a `glide` Papa with `glide: null` is refused with a message naming the field; another `levelHash` is refused.
- [x] **T11: Client (AC 10)**
  - [x] `levelSession.ts`: new dep `loadLevelContent(id): Promise<Result<LevelContent, ContentError>>`, run in parallel with the assets and the audio; an `err` logs a `warn` with the level id and the problems, then `oops`; `createSim` gets `level`. `boot.ts` passes `(id) => loadLevelContent(contentSource, id)` with the browser source it already creates (create it once, reuse it). `levelSession.test.ts`: the fakes gain the dep; one test for the failure → `oops`, one that `createSim` receives the loaded level.
  - [x] Every client test calling `createSim` (`loop.test.ts`, `levelScene.test.ts`, `feedbackDirector.test.ts`, `levelSession.test.ts`) passes `createTestLevel()`.
- [x] **T12: Docs and verification (AC 11)**
  - [x] `deferred-work.md`: Dev Notes › Deferred items this story touches, and › Deferred by this story.
  - [x] Run `npm run lint`, `npm run typecheck`, `npm test` after T4/T5, after T8/T9, and after T11; then `npm run ci` end to end.
  - [x] Break things to prove the guards bite, then restore: a level planning `outlett` → `content:check` names it; `gag: "outlet_hairs"` → `content:check`; `feedback.telegraph` naming a missing cue → `content:check`; a `ThreatState` added to the union but not to `THREAT_STATES` → the snapshot test fails; a `Math.random()` in `threatSystem.ts` → `simPurity` fails.
  - [x] Manual check in the built-in browser on `npm run dev` (844 × 390): the game starts, Papa walks, the baby wanders and babbles as before, no console error (the live level plans nothing yet). Say that nothing of the threat is visible before story 1.11.
  - [x] `git status`: only the files of the File List changed; nothing committed.

## Dev Notes

### What exists today (stories 1.1 to 1.9)

- **Sim** (`src/sim/`): `createSim({ content, geometry, seed, journal?, strictInvariants? })`; `World = { time, rng, nextId, papa, baby }`; `SYSTEMS = [applyCommands, advanceTime, runBaby, runPapa]`; commands `SetTimeScale`, `TapFloor`, `Move`, `MoveStop` (`COMMAND_TYPES`, `commandProblem`); events `TimeScaleChanged`, `PapaStateChanged`, `PapaPathPlanned`, `PapaArrived`, `PapaBlocked`, `BabyStateChanged`, `InvariantViolated`, listed in `SIM_EVENT_TYPES` with the compile-time completeness proof `SIM_EVENT_TYPES_ARE_COMPLETE` (a new event that is not listed fails `typecheck`). `ctx = { feel, events, queue, commands, nav: { papa, baby }, strictInvariants, t, requestFreezeRealMs }`. Journal and snapshot are version 2 (`seed`, `feelHash`, `geometryHash`; `startSimMs` for the journal).
- **Command timing** (`commandQueue.ts`): `applyAt = max(ceil(t / STEP_MS) × STEP_MS, simNow + STEP_MS)`. In a step, `applyCommands` moves the due commands into `ctx.commands`, then `advanceTime` adds `STEP_MS`: when the other systems run, `world.time.sim` equals the `applyAt` of the commands they see, and every command's `t` is ≤ `world.time.sim`. A judgement uses `command.t`, never `world.time.sim`.
- **Baby** (`src/sim/baby/`): `wander` / `babble` (`enterBabyState` emits `BabyStateChanged`), `pickWanderCell` + `planWander` (A* + `smoothPath` into a new array), `drawBabbleMs` (one `nextFloat`), `ensureOnOpenCell`. Gaze and heading are separate unit vectors (story 1.8 D7): the view draws the gaze only, so locking the gaze needs no client change.
- **Papa** (`src/sim/papa/`): `idle` / `walkPath` / `walkDir`; `tapFloor` snaps the goal to the nearest open cell of Papa's region and plans with `findPath` + `smoothPath`; `advanceAlongPath` (`nav/followPath.ts`) walks a `PathFollower` for a budget in metres and returns true on arrival.
- **Content** (`src/content/`): `ContentBundle { feel, feedback, strings }` from `loadContent(source)`; `ContentSource.read(file)` (no listing); `CONTENT_FILES` (must exist) and `CONTENT_PATTERNS` (one file per id: today only `levels/<id>.geometry.json`); `parseContentFile` drops `$schema`; `mergeFeel` exists (its comment says « story 1.10 », see D3). `content:check` (`tools/content/contentChecks.ts`) walks every `content/**/*.json`, matches `CONTENT_FILES` then `matchContentPattern`, checks feedback references (event names against `SIM_EVENT_TYPES` + `FEEDBACK_CLIENT_EVENTS`, cue ids, clip files) and `…Key` string references.
- **Geometry**: anchors of the live and frozen room: `outlet_01 (-3.95, 0.3, 0.5)` on the west wall (its own cell is probably closed for both radii: snap like a tap), `baby_spawn (-0.5, 0, 1.2)` about 3.5 m away, `papa_spawn (2.5, 0, 1.5)` about 6.5 m away.
- **Client**: `levelSession.start()` loads assets (`.glb` + geometry) and audio in parallel, then `createSim({ content, geometry, seed })`; `boot.ts` creates the browser content source inline in `loadContent(createBrowserContentSource())`. `browserContentSource` already inlines every `content/**/*.json` except the geometry: `levels/salon_crawler.json` and `threats/outlet.json` are bundled with no change. The `FeedbackDirector` plays only events listed in `feedback.json` `events`: the new sim events are ignored by it until story 1.11.
- **Goldens**: `core_basic`, `papa_walk`, `baby_wander` (`tests/golden/scenarios.ts`, harness `golden.test.ts`, `npm run golden:update`); none has a threat, so their events must not change in this story.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | `ThreatState = 'idle' \| 'telegraph' \| 'windowOpen' \| 'resolved' \| 'gag'`. P1's `targeted` (« the baby in reach ») is **not** added: the director's targeting starts the telegraph, and the baby approaches **during** it. | The epic orders it so (targeting → `targetLocked` + `telegraph` → approach), and so do the GDD micro-loop (« l'enfant repère un danger… le regard se verrouille ») and the architecture's own baby FSM (`targetLocked (télégraphe) → approach → act`). A state nothing enters is dead code (story 1.8 D1); a story that needs a reach gate adds it. |
| D2 | `ThreatDef.response` is `z.enum(['parry'])` today. `firm` (1.23), `wait` (4.6), `nothing` (4.9), `dodge` (5.1) each join with their story. | Same rule: the schema accepts only what the sim judges. |
| D3 | Minimal `LevelSchema`: `{ id, threats: [{ def, anchor, fromMs }] }`. No `durationMs`, `variant`, `waves`, spawns or `feelOverrides`: story 1.18 replaces `threats` with `waves` and adds the rest. A level and its geometry share the id (`levels/<id>.json`, `levels/<id>.geometry.json`, `assets/levels/<id>.glb`); the spawns stay the fixed `papa_spawn` / `baby_spawn` anchors. | The epic asks for a minimal schema. `mergeFeel` stays unused until a level declares overrides: wiring it now would add a client merge path no level exercises. |
| D4 | The live `content/levels/salon_crawler.json` plans **no** threat (`"threats": []`). Story 1.11 adds the outlet to it, together with its visuals. Tests and the golden use frozen test levels. | The story is headless: with nothing visible, a baby that suddenly rushes to the wall would be a regression for Geo and would break `baby.spec.ts` timings. The client still loads the level, so 1.11 only edits data and the client. |
| D5 | One threat **instance** per planned entry, created at `createSim` in level order with ids from `allocateId` (ids 1…n). The instance keeps its anchor's position (`xM`, `zM`); the def and `fromMs` stay in `ctx.level` (index-aligned with `world.threats`). | Architecture › Patterns d'entités (`world.nextId++`, plain data). The view (1.11) and the glide need the position; the defs are constant data, outside the hash of the world. |
| D6 | `judgePress` is the architecture's P1 code as written: `center = windowOpenAt + windowMs / 2`; `perfect` if `|offset| ≤ perfectMs / 2`; `early` if `offset < −(windowMs / 2 + toleranceMs) − bufferMs`; `late` if `offset > windowMs / 2 + toleranceMs`; else `success`. With the defaults a press is accepted in `[open − 160, open + 360]` ms (inclusive), perfect in `[open + 100, open + 200]`. | Technical mechanics follow the architecture. The GDD says « avant l'ouverture de sa fenêtre (moins le buffer) »: whether the tolerance also applies on the early side is Open point 1. |
| D7 | The response type is decided at `Release` (held `< holdMinMs` = Parry, `≥` = Firmness) or, with no release, at the first step where `world.time.sim ≥ press.t + holdMinMs` (Firmness). A Parry threat answered with Firmness is a gag `wrongResponse`. `Release{t}` carries no `threatId`: it classifies every pending press with `press.t ≤ release.t`. | ADR-010 and the architecture's input chain (« le type de réponse se décide au relâchement, ou à 400 ms »). Without it a press with no release would hang a threat forever. Story 1.23 adds `firm` threats on top; multi-touch pointer ids are story 1.11's call. |
| D8 | `effectiveWindow` computes `windowMs = base × tier × fatigue × instinct` (in that order), `perfectMs = min(feel.perfectMs, windowMs)`, and passes `toleranceMs` and `bufferMs` through. `base` is the def's `windowMs` or, when `null`, `feel.timing.windowMs`. In this story `tier = feel.difficulty.normal.windowMultiplier` (the default tier until story 2.8 lets the player pick; its value is 1), `fatigue = instinct = 1` (systems of 1.19 and 2.9). The window is computed **once, when the threat enters `telegraph`**, and stored on the instance. | The fixed order is the architecture's (Chaîne d'entrées › 5). A buffered press is judged before the window opens, so the window must already exist; a window that moves while the player reads it would be unfair. 1.19 / 2.9 may revisit. |
| D9 | `enterThreatState(world, ctx, threat, next)` is the only writer of `threat.state` / `enteredAt` and emits nothing; one helper per transition emits its events: `telegraphThreat` → `ThreatTelegraphed`; `openWindow` → `WindowOpened`; `resolveThreat` → `ResponseResolved`; `gagThreat` → `ResponseResolved{fail}` then `GagTriggered`; `rearmThreat` → `ThreatRearmed`. | Every state change has exactly one entry point and at least one event (Patterns d'état), and the events carry the data each transition owns (quality, reason, offset). |
| D10 | `gags.ts` holds only `GAG_IDS` and `GagId`. `outlet_hair` has no sim consequence yet: noise (E3), mess and breakage (1.15), near miss (1.16) and score (1.22) arrive with their stories; the presentation (lamp off, hair on end) is story 1.11's, from `GagTriggered.gag`. | NFR9: the gag is an event. No dead consequence code. |
| D11 | Papa glides on **every** `PressThreat` whose threat exists and is not `idle` (so also on an early press, judged or guarded, and on a press that resolves or gags it). The glide is planned like a tap to the threat's position; it lasts `min(glideMaxMs, pathLength / walkSpeedMps)` and moves at `pathLength / duration` (never slower than walking). `TapFloor` and `Move` cancel it; `MoveStop` does not. A new `PressThreat` replans it. No path: no glide, the judgement is unaffected. | P3: the result never depends on Papa's arrival, and the client (1.11) starts the glide visually at `pointerdown`, before any judgement: the sim must glide whenever the client does, or the two would contradict. The architecture gives the duration rule but no glide speed: walking speed is the floor. |
| D12 | The minimal director targets, at most once per step, the first `idle` entry (level order) whose `fromMs ≤ world.time.sim`, only while the baby is free (`wander` or `babble`) and no threat is `telegraph` or `windowOpen`. No rng. After its cooldown a threat may be targeted again. | The epic's « director minimal ». One active threat at a time is the wave 1 rule anyway; story 1.18's `WaveDirector` replaces this policy (simultaneity, delays drawn by the PRNG). |
| D13 | Journal and snapshot become version 3 with `levelHash = hashJson(levelContent)`; `createSim` refuses a journal or snapshot of another level, `replayJournal` returns an `err`. | The planned threats are part of what a replay needs, exactly as the room was (story 1.7 bumped to v2 for `geometryHash`). A replay against another level would diverge silently. |
| D14 | The baby approaches at `max(feel.baby.approachSpeedMps, pathLength / (windowOpenAt − now))`, capped at `MAX_CRAWL_SPEED_MPS`, computed once when it leaves `targetLocked` (if `windowOpenAt − now ≤ 0`, the cap). So it reaches the outlet by the window's opening when it can, and « fonce » (1.11) instead of crawling. | Timing is data (the 1.2 s delay is fixed, NFR4), and the baby can start 3.5 m away: at 0.6 m/s it would reach the outlet long after the gag. The arrival is choreography only: nothing is judged on it. |
| D15 | A press whose type is known while the threat is still in `telegraph` (a buffered press released quickly) is resolved at the step the window opens: `WindowOpened` then `ResponseResolved` in that step. | The FSM stays `telegraph → windowOpen → resolved`, every non-early cycle has its `WindowOpened`, and the quality is still computed from the press's own `t`. The response sound can then come up to 160 ms after such a tap: Open point 2. |

### Threat definition (`content/threats/outlet.json`, `ThreatDefSchema`)

```json
{
  "$schema": "../_schemas/threat.schema.json",
  "id": "outlet",
  "response": "parry",
  "telegraphDelayMs": 1200,
  "windowMs": null,
  "gag": "outlet_hair",
  "feedback": { "telegraph": "tel_outlet", "success": "resp_parry", "perfect": "resp_parry_perfect", "gag": "gag_outlet" },
  "cooldownMs": 6000
}
```

| Key | Schema | Meaning |
|---|---|---|
| `id` | `SNAKE_ID_PATTERN` | Equals the file name. |
| `response` | `z.enum(['parry'])` | The response the threat asks for (D2). |
| `telegraphDelayMs` | `> 0`, nullable | Telegraph → window opening, in sim ms; `null` = `feel.timing.telegraphDelayDefaultMs`. |
| `windowMs` | `> 0`, nullable | Base response window, in sim ms; `null` = `feel.timing.windowMs` (D8). |
| `gag` | `SNAKE_ID_PATTERN` | A gag id; `content:check` and `createSim` check it is in `GAG_IDS`. |
| `feedback` | strict object of four cue ids (`telegraph`, `success`, `perfect`, `gag`) | Cues of `feedback.json` `cues`, played by the client from story 1.11. |
| `cooldownMs` | `≥ 0` | Time spent in `resolved` or `gag` before the threat is `idle` again, in sim ms. |

`.nullable()` keeps the file, the type and the JSON Schema one to one (the value is always written). No `verb`, `iconShape` or `color` yet: stories 1.11 / 2.2 add them (with a `verbKey` into `strings.fr.json`).

### Level (`LevelSchema`, `content/levels/<id>.json`)

```json
{ "$schema": "../_schemas/level.schema.json", "id": "salon_crawler", "threats": [] }
```

`threats[]`: `{ def: <threat id>, anchor: <anchor id without ANCHOR_>, fromMs: ≥ 0 }` — « the director may target this threat from `fromMs` of sim time on » (D12). The same def may appear twice (two outlets, two instances).

### Loading a level (`loadLevelContent`)

Reads `levels/<id>.json` (`LevelSchema`, id = `<id>`), then each distinct `threats/<def>.json` it plans (`ThreatDefSchema`, id = file name), in order of first reference, through the same `ContentSource` (no listing needed: the level names its files). It returns every problem found (a missing def file is a problem naming the level's JSON path `threats[2].def`), never throws, never logs. It does not check anchors or gag ids (it has no geometry and must not import the sim): `createSim` does, as invariants, and `content:check` does statically.

### Content checks (`tools/content/contentChecks.ts`)

- Threat files (`THREAT_DEF_PATTERN`): id = file name (the existing pattern check); `gag ∈ GAG_IDS`; each `feedback.*` value is a key of `feedback.json` `cues` (`threats/outlet.json` › `feedback.telegraph`).
- Level files (`LEVEL_PATTERN`): id = file name; `content/levels/<id>.geometry.json` exists and parses; each `threats[i].def` names an existing, valid threat file; each `threats[i].anchor` is an anchor of that geometry (`levels/salon_crawler.json` › `threats[0].anchor`).
- Problems name the file and the JSON path, like the feedback checks. Each rule has a failing fixture case in `checkContent.test.ts`, plus the « on the real repository » case still green.

### Feedback cues (`content/feedback.json`)

Add, haptic only (no audio, so the twin rule holds; story 1.11 gives them sounds and visuals): `tel_outlet: { haptic: "light" }`, `resp_parry: { haptic: "medium" }`, `resp_parry_perfect: { haptic: "heavy" }`, `gag_outlet: { haptic: "heavy" }` (GDD › Contrôles: short vibration on each telegraph, marked on a perfect response). No `events` entry: `ThreatTelegraphed` is generic, the cue comes from the threat's def, and that routing is story 1.11's.

### Feel (`content/feel.json`, section `baby`)

| Key | Value | Schema | Meaning |
|---|---|---|---|
| `lockMs` | `300` | `≥ 0` | How long the baby stares at its target, still, before it sets off (`targetLocked`), in sim ms. |
| `approachSpeedMps` | `1.5` | `> 0`, `≤ MAX_CRAWL_SPEED_MPS` | Slowest approach speed; faster when needed to reach the target by the window's opening (D14), in m/s. |
| `actMs` | `1500` | `≥ 0` | How long the baby plays its mischief after a gag (`act`) before babbling again, in sim ms. |

Starting values, not GDD numbers: Open point 3. Also fix `input.earlyPress`'s description: « What a press before the window (minus tolerance and buffer) does: `fail` triggers the gag, `guard` starts the glide without a judgement. » (the description only; `feelHash` hashes values).

### World

```ts
// world.threats: ThreatInstance[] (level order, D5)
interface ThreatInstance {
  id: number;                 // allocateId
  defId: string;
  anchorId: string;
  xM: number; zM: number;     // the anchor's position on the floor plane
  state: ThreatState;
  enteredAt: SimMs;
  windowOpenAt: SimMs;        // telegraph entry + delay; 0 when idle
  window: EffectiveWindow | null;   // { windowMs, perfectMs, toleranceMs, bufferMs }, frozen at telegraph (D8); null when idle
  press: { t: SimMs; quality: 'perfect' | 'success'; offsetMs: number; releasedAt: SimMs | null } | null; // a judged, not yet classified press
}
// world.papa gains:
glide: { threatId: number; toXM: number; toZM: number; startedAt: SimMs; arriveAt: SimMs; speedMps: number } | null;
// world.baby gains:
targetThreatId: number | null; // the threat it locked on (runBaby's own memory)
approachSpeedMps: number;      // speed of the current approach (D14); 0 otherwise
// ctx.level (outside World, built once): { threats: readonly { def: ThreatDef; fromMs: number }[] } — index-aligned with world.threats
```

`arriveAt` and `windowOpenAt` may be off the step grid (a delay of 1205 ms); transitions happen at the first step `≥` them, judgements use the exact value. Plain data only (JSON round trip equal).

### createSim checks (invariants, so `replayJournal` turns them into an `err`)

`level.level.id === geometry.id`; every planned `def` is in `level.threats`; every planned `anchor` is in the geometry (message names the level, the def and the anchor); every def's `gag` is in `GAG_IDS`.

### Director rules (`runDirector`, D12)

Return unless `baby.state` is `wander` or `babble` and no threat is `telegraph` or `windowOpen`. Then for `i` in level order: if `world.threats[i].state === 'idle'` and `world.time.sim ≥ ctx.level.threats[i].fromMs` → `telegraphThreat` (window = `effectiveWindow(…)`, `windowOpenAt = now + (def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs)`, event `ThreatTelegraphed{t, threatId, kind: defId, anchorId}`), and stop.

### Baby rules (`runBaby`, in this order, after `prev ← position`)

1. **Release.** `targetThreatId !== null` and its threat is not `telegraph` / `windowOpen`: if it is `gag` and the baby is not already in `act` → clear the path, `enterBabyState('act')`; otherwise (resolved, idle, missing) → `targetThreatId = null`, clear the path, `wanderAt = now + drawBabbleMs`, `enterBabyState('babble')`.
2. **Lock.** `targetThreatId === null`, state `wander` or `babble`, and some threat is `telegraph` or `windowOpen` (the first in array order) → `targetThreatId = id`, clear the path, gaze at the threat, `enterBabyState('targetLocked')`.
3. **Set off.** `targetLocked` and `now ≥ enteredAt + lockMs` → `planApproach` (on failure the path stays empty: the baby stares where it is), `approachSpeedMps` per D14, `enterBabyState('approach')` (same step when `lockMs` is 0).
4. **Approach.** `approach` with a path → `advanceAlongPath(baby, approachSpeedMps × STEP_MS / 1000)`; on arrival clear the path (it stays in `approach`, at the outlet). Every step of `targetLocked` / `approach`, gaze at the threat (`gazeAt`).
5. **Act end.** `act` and `now ≥ enteredAt + actMs` → `targetThreatId = null`, `wanderAt = now + drawBabbleMs`, `enterBabyState('babble')`.
6. **Wander / babble** exactly as story 1.8, only in those states.

`runBaby` reads `world.threats` (reading another slice is fine; it never writes it). The release reacts one step after the threat's transition (`runThreats` runs after `runBaby`): deterministic and invisible. `babbling` stays `true` in every state (story 1.21 owns silence). The draw order (babble draws on release and at act end) is part of the goldens: keep it.

### Threat rules (`runThreats`, each step)

1. **Commands**, in `ctx.commands` order:
   - `PressThreat`: find the instance by id; ignore if none, or if its state is not `telegraph` / `windowOpen`, or if it already has a `press`. Else `j = judgePress(cmd.t, windowOpenAt, window)`: `early` → `earlyPress === 'fail'` ? `gagThreat(reason 'early', offset)` : nothing (guard); `late` → `gagThreat('late', offset)`; `perfect` / `success` → `press = { t: cmd.t, quality, offsetMs, releasedAt: null }`.
   - `Release`: every instance with a `press` whose `releasedAt === null` and `press.t ≤ cmd.t` gets `releasedAt = cmd.t`; nothing else.
2. **Per instance, in array order:**
   - `telegraph` and `now ≥ windowOpenAt` → `openWindow`.
   - `press !== null`: `kind = classifyPress(press.t, press.releasedAt, now, holdMinMs)`; if `kind !== null` and the state is `windowOpen` → `kind === def.response` ? `resolveThreat(quality, offsetMs)` : `gagThreat('wrongResponse', offsetMs)` (D7, D15).
   - `windowOpen`, `press === null`, `now > windowOpenAt + window.windowMs + window.toleranceMs` → `gagThreat('late', offsetMs: null)`.
   - `resolved` / `gag` and `now ≥ enteredAt + def.cooldownMs` → `rearmThreat` (`press`, `window` = null, `windowOpenAt` = 0).

`gagThreat` emits `ResponseResolved{quality: 'fail', reason, offsetMs}` then `GagTriggered{gag}`. Commands are handled before the expiry, so a press with `t` at the very end of the tolerance, applied at the step that would expire the window, is still judged on its `t`.

### Glide rules (`startGlide`, D11)

`planWalkTo(papa, ctx.nav.papa, threat.xM, threat.zM)`; none → return. `lengthM` = sum of the segments from Papa through the path (`Math.sqrt` only). `durationMs = min(glideMaxMs, lengthM × 1000 / walkSpeedMps)`; `speedMps = durationMs > 0 ? lengthM × 1000 / durationMs : walkSpeedMps`; `glide = { threatId, toXM, toZM, startedAt: now, arriveAt: now + durationMs, speedMps }`; clear `dir`, `isBlocked`; push `PapaGlideStarted{t, threatId, toXM, toZM, arriveAt}`; `enterPapaState('glide')`. Movement in `glide`: `advanceAlongPath(papa, speedMps × STEP_MS / 1000)`; on arrival `PapaArrived`, `glide = null`, `idle`. A zero-length glide arrives in the same step.

### Events

```ts
| { type: 'ThreatTelegraphed'; t: SimMs; threatId: number; kind: string; anchorId: string }
| { type: 'WindowOpened'; t: SimMs; threatId: number }
| { type: 'ResponseResolved'; t: SimMs; threatId: number; response: ThreatResponse; quality: 'perfect' | 'success' | 'fail'; reason?: 'early' | 'late' | 'wrongResponse'; offsetMs: number | null }
| { type: 'GagTriggered'; t: SimMs; threatId: number; gag: GagId; reason: 'early' | 'late' | 'wrongResponse' }
| { type: 'ThreatRearmed'; t: SimMs; threatId: number }
| { type: 'PapaGlideStarted'; t: SimMs; threatId: number; toXM: number; toZM: number; arriveAt: SimMs }
```

`response` is what the threat asks for (always known, even for an early gag). `offsetMs` is the press's offset from the window centre, `null` when the window ran out with no press (the architecture types it `number`; `null` is more honest than a made-up offset). `t` is the step time. Add each to `SIM_EVENT_TYPES` (the completeness proof will insist). Commands: `PressThreat{t, threatId}` (`commandProblem`: integer `threatId ≥ 1`), `Release{t}`.

### Snapshot checks (`snapshot.ts`)

`THREAT_STATES` list; per instance: integer `id`, strings, finite numbers, `window` and `press` shapes; `idle` ↔ `window === null && press === null`; `telegraph` / `windowOpen` ↔ `window !== null`; `press` only in `telegraph` / `windowOpen`. Papa: `PAPA_STATES` gains `glide`; `glide` ↔ `glide !== null` (and a path, possibly fully walked only at the arrival step — keep the rule « `glide` state has a non-null glide », not the path); any other state ↔ `glide === null`. Baby: `BABY_STATES` gains the three states; `wander` needs a path as today, `approach` may have one, every other state has none; `targetThreatId` is `null` or an integer; `approachSpeedMps` finite ≥ 0. Messages name the field (`world.threats[0].window`), like the existing ones.

### Timing test cases (`judge.test.ts`, `effectiveWindow.test.ts`, `classifyPress.test.ts`)

With `windowOpenAt = 1000`, window 300, perfect 100, tolerance 60, buffer 100: centre 1150; `1100` and `1200` perfect, `1099` and `1201` success; `840` success (the early boundary, inclusive), `839` early; `1360` success, `1361` late; fractional `t` (`1099.5`) rated by the same rule. `effectiveWindow`: base from the def vs `null`; each modifier alone and together, in the fixed order; `perfectMs` capped at the shrunk window; tier from the feel. `classifyPress`: release at `holdMinMs − 1` = parry, at `holdMinMs` = firm; no release before `press.t + holdMinMs` = `null`, at it = firm; a release earlier than the press is not a release.

### Sim test cases (`threatSystem.test.ts`, `directorSystem.test.ts`, `babySystem.test.ts`, `glide.test.ts`)

Use `createTestLevel([outletEntry(fromMs)])` and `stepN`. Read `windowOpenAt` and `window` from the world after `ThreatTelegraphed`, never re-derive them by hand.
- **AC 2:** telegraph at the first step `≥ fromMs` with the baby free, `ThreatTelegraphed` and `BabyStateChanged(→ targetLocked)` in that step; `approach` after `lockMs`; gaze points at the outlet in both; `WindowOpened` exactly at telegraph + 1200, also under `SetTimeScale 0.3` (sim time, ADR-002); the director waits while the baby is in `act`, while another threat is active, and before `fromMs`.
- **AC 3:** perfect at the centre, success at the window start; `ResponseResolved` carries quality and offset; the threat is `resolved`; `PapaGlideStarted` at the press step with `arriveAt − startedAt ≤ glideMaxMs`; `PapaArrived` at the first step `≥ arriveAt` (± one step); Papa far away (spawn) glides faster than he walks; Papa next to the outlet glides at walking speed.
- **AC 4:** early press (fail) → gag `early` at the press step, even during `telegraph`; no press → gag `late` at the first step after the tolerance; guard mode → glide, no threat event, then a press in the window resolves it; the gag changes nothing else in the world (no field of Papa or the baby outside their FSM moves because of it).
- **AC 7:** hold `holdMinMs` with no release → gag `wrongResponse` at `press.t + holdMinMs`; a buffered press released before the opening resolves at the opening step (`WindowOpened` then `ResponseResolved`); a pending press keeps the window from expiring; `Release` alone, a second `PressThreat` while one is pending, and a press on an unknown or idle threat do nothing.
- **AC 8:** `ThreatRearmed` at resolution + `cooldownMs`; re-targeted afterwards; after a gag the baby is in `act` for `actMs` then `babble`; after a success it babbles again (and wanders after its pause).
- **Papa:** `TapFloor` and `Move` cancel a glide, `MoveStop` does not; a second press replans; an unreachable threat position (custom geometry) gives no glide and the judgement still happens.
- **Baby:** with an empty level, every story 1.8 test passes unchanged; approach speed per D14 (fast when far, `approachSpeedMps` when near, the cap when the window is already open); a target in another region (custom geometry) leaves it staring in `approach` with an empty path, no throw.

### Generated catalogue tests (`tests/threats/threatCatalog.test.ts`)

Reads every `content/threats/*.json` from disk (node `fs`; this is a `tests/` file, not a sim test), parses it with `ThreatDefSchema`, and for each def builds a `LevelContent` planning it once at `fromMs: 0` at anchor `outlet_01` (one fixed anchor: no judgement depends on the anchor), with the **frozen** test feel and geometry. Four cases per def, all times read from the world after `ThreatTelegraphed`: **perfect** (press at the centre, release `holdMinMs / 2` later) → `perfect`; **success** (press at `windowOpenAt − toleranceMs`) → `success`; **too early** (press 1 ms before the early boundary) → gag `early`; **too late** (no press) → gag `late`. Plus: the catalogue is not empty, and every def's `gag` is in `GAG_IDS`. No `if` on a def id anywhere in the file.

### Golden scenario (`outlet_parry`)

Seed of your choice, `untilSimMs` 30 000, frozen feel and geometry, `createTestLevel([outletEntry(2000)])`. Actions, computed from the first recording's `ThreatTelegraphed` events and then written as literals: cycle 1 a perfect press and its release; cycle 2 an early press (gag `early`); cycle 3 no press (gag `late`); cycle 4, if time allows, a press enqueued **after** its own `t` (late enqueue, judged on `t`), and one `TapFloor` during a glide. `tests/golden/outletParry.test.ts` pins: the order of qualities and reasons, at least one `ThreatRearmed`, `BabyStateChanged` through `targetLocked`, `approach` and `act`, the threat id is 1, and at least one rng draw (the baby wanders between cycles). Commit the journal and its expected file.

### Previous story intelligence (1.7 to 1.9 and their reviews)

- Hot paths allocate nothing: `runDirector`, `runThreats`, `runBaby`, `runPapa`. Event-driven allocations are fine (one `window` per telegraph, one `press` per press, one `glide` and one path per glide, one path per approach). No template string in an `invariant(...)` called per step (test the condition first).
- Sim tests use the frozen fixtures (`testFeel.json`, `testLevel.geometry.json`, and now the frozen outlet def); a story that adds a feel key adds it to `testFeel.json` too. Golden updates are deliberate and explained, with the « events unchanged » proof for scenarios the story does not touch (stories 1.8 and 1.9 did it).
- Name every number that is not a feel or content value as a constant at the top of its file with its unit (1.8 review). Comments describe what the code does.
- `Math.ceil(-1e-9)` is `-0`; nothing may depend on a sign of zero (`cloneJson`). Gaze and heading are normalised with `Math.sqrt` only, no `Math.hypot`, no trigonometry in the sim (story 1.7 D15).
- `content:check`'s test copies `content/` (and since 1.9 `public/assets/audio/`) into a temp root: new fixture files go there.
- Biome does **not** forbid `Math.random` in `src/sim` (only `simPurity` does; story 1.8 review deferred it to Geo): do not touch `biome.json`.
- The dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.10 : …`, by Geo.

### Architecture guardrails and traps (read before coding)

- **Sim purity:** no `three`, DOM, `Math.random`, `Date`, `performance`, `setTimeout`; randomness only `world.rng`; `@content` imports in `src/sim` are `import type` only; relative imports inside `src/sim`; `@sim` = `src/sim/index.ts`.
- **Systems never call each other.** `runDirector` writes threats only; `runBaby` writes the baby only (reads threats); `runThreats` writes threats only; `runPapa` writes Papa only (reads threats). FSM changes only through `enter…State` and the threat helpers.
- **Judge on `command.t`,** never on `world.time.sim`, never on Papa's arrival (P3, ADR-003). Windows in sim ms: never scale them by `timeScale` (slow-mo widening them in real time is the point, ADR-002).
- **No GDD number in code:** delay, windows, perfect, tolerance, buffer, `holdMinMs`, glide, cooldown, lock, approach, act are content or feel. Only neutral modifiers (`1`) and the schema caps are code, named.
- **One target per command:** `PressThreat` carries `threatId`; the sim never guesses a target.
- **No hitstop, no slow-mo here:** `ResponseResolved` requests no freeze and changes no `timeScale` (story 1.14). No score (1.22), no noise (E3).
- **The client never writes the world** and gets the level through `loadLevelContent` only; nothing imports a JSON of `content/` directly (Patterns de données).
- **Existing tests that must keep passing unchanged** (apart from the added `level:` argument): every nav, wander, walk, followPath test, `babySystem.test.ts`'s story 1.8 cases, `papaSystem.test.ts`, `tests/architecture/*`, every e2e spec. Deliberate edits: `step.test.ts` (order), `snapshot.test.ts` / `replay.test.ts` / `createSim.test.ts` (version 3, `levelHash`, new checks), `commands.test.ts` / `events.test.ts` (new members), the golden files, `feelSchema.test.ts`, `jsonSchema.test.ts`, `checkContent.test.ts`, `levelSession.test.ts`. List every edited existing test in the Completion Notes with the reason.

### Project Structure Notes

- New (all in the architecture tree): `src/content/schemas/{threat,level}.ts`, `src/content/loadLevelContent.ts`, `src/sim/timing/{effectiveWindow,judge,classifyPress}.ts` (+ tests), `src/sim/threats/{threatFsm,threatSystem,gags}.ts` (+ `threatSystem.test.ts`), `src/sim/director/directorSystem.ts` (+ test; story 1.18 adds `waveDirector.ts` beside it), `src/sim/baby/approach.ts` (+ test), `src/sim/papa/{planWalk,glide}.ts` (+ `glide.test.ts`), `content/threats/outlet.json`, `content/levels/salon_crawler.json`, `content/_schemas/{threat,level}.schema.json` (generated), `tests/support/testOutlet.threat.json`, `tests/content/{threatSchema,levelSchema,loadLevelContent}.test.ts`, `tests/threats/threatCatalog.test.ts`, `tests/golden/outletParry.test.ts`, `tests/golden/journals/outlet_parry{,.expected}.json`.
- Modified: `src/sim/{world,context,createSim,step,snapshot,journal,replay,events,commands,index}.ts` (+ tests), `src/sim/baby/{babyFsm,babySystem}.ts`, `src/sim/papa/{papaFsm,papaSystem}.ts`, `src/content/{contentBundle,contentFiles}.ts`, `src/content/schemas/feel.ts`, `content/{feel,feedback}.json`, `content/_schemas/feel.schema.json`, `tools/content/contentChecks.ts`, `src/client/app/levelSession.ts` (+ test), `src/client/boot.ts`, the client tests that create a sim, `tests/support/{testContent.ts,testFeel.json}`, `tests/content/{feelSchema,jsonSchema,checkContent}.test.ts`, `tests/golden/{scenarios,golden.test}.ts` and the regenerated journals, `deferred-work.md`, `sprint-status.yaml`.
- Not in this story: any visual, sound or input on the threat (1.11), `window.__PP__` (1.13), bots and the `sim` CLI (1.12), hitstop and slow-mo (1.14), `WaveDirector` and level duration (1.18), Firmness threats (1.23), `src/shared/ids.ts` branded ids (optional; plain `number` is fine here).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests; Geo tunes. Every timing number is in `feel.json` or the threat file; adding a threat = adding a JSON (and maybe a gag id), never a class (P1). The whole cycle runs headless, so bots (1.12) and the CLI get it for free.
- **Time & input judgement (ADR-002/003/010):** windows in sim time; judge on the press's `t`; release `< holdMinMs` = Parry, `≥` = Firmness; effective window order fixed and only in `sim/timing/effectiveWindow.ts`; early press follows `feel.earlyPress`.
- **Sim:** fixed 10 ms steps; `World` serializable; systems in the fixed order (commands → time → director → baby → threats → papa → …); FSM via `enter…State`; randomness only `world.rng`; ids only `world.nextId++`; never logs, emits events; no `try/catch`.
- **Edge cases to always handle** (project-context): several active threats (each command names its threat; the director keeps one active here); Papa already gliding (new command judged on its own `t`, the glide replans); a gag during a glide plays in parallel; wrong response type in the window = gag; system-spawned threats (1.19) will reuse this FSM unchanged.
- **Content:** ids `lower_snake_case` = file name; JSON keys camelCase with unit suffixes; `content/_schemas/` generated only; every cross-reference checked by `content:check`.
- **Tests:** unit tests colocated; every `sim/timing` function and every FSM has unit tests; every threat has generated « perfect, success, too early, too late » tests from its JSON (Règles de cohérence); goldens regenerated deliberately; `src/sim` ≥ 90 %.
- **Stack pinned:** no new dependency (Zod 4's `.nullable()` and `z.enum` are in 4.6.7). No web research was needed: nothing outside the pinned stack is touched.

### Deferred items this story touches (update `deferred-work.md`)

- 1.2 review, « `loadContent` does not loop over `CONTENT_FILES` … still open for the threat files »: **resolved in 1.10** — threat and level files are `CONTENT_PATTERNS` loaded by reference through `loadLevelContent`, not a registry loop.
- 1.2 review, « `…Key` reference detection is narrow » and « End-to-end test of `…Key` references »: **still open**, moved to story 2.2 (the first threat field with a string key, `verbKey`).
- 1.3 review, « The golden scenario never touches the rng or ids »: **resolved in 1.10** (`outlet_parry`).
- 1.6, « The sim does not read the geometry yet »: **partly resolved in 1.10** — the sim reads the threat anchors; colliders (1.15) and zones (1.21) stay.
- 1.6 review, « More cross-field checks for `LevelGeometrySchema` »: **partly resolved** — anchors a level plans are checked by `content:check`; bounds and prop kinds stay open.
- 1.7 / 1.8 reviews, « spawn in a tiny region » and « spawn is in the main region » check: **still open**, moved to story 1.18 (the first level with real content, where the same check can also require every planned anchor to be reachable from the baby's spawn region).
- 1.9, « Per-level audio manifest »: **still open**, with story 1.11 (the first threat cues with sounds) or 1.18.

### Deferred by this story

- **A press enqueued after its window expired** (a client whose time map lags by more than one step at the window's end) is lost: the threat already gagged `late`. Commands run before the expiry in a step, which covers same-step arrival; anything later is story 1.11's input pipeline to watch (`tapLatency`), or a small expiry grace in the feel if the playtest shows it.
- **`targeted` state and a reach gate** (P1): only if a later threat needs the baby in reach before its telegraph.
- **Several simultaneous threats and one baby**: the baby locks on the first active threat; story 1.18 decides how waves share it.
- **Gag consequences** (noise, mess, near miss, score) and the **gag presentation**: E3, 1.15, 1.16, 1.22 and 1.11.
- **`feelOverrides` in `LevelSchema`** and the client merge (`mergeFeel` is ready): the first level that needs one, story 1.18 at the latest.

### Open points for Geo (do not block the dev)

1. **Early boundary.** The architecture's `judgePress` accepts a press from `open − tolerance − buffer` (160 ms early with the defaults); the GDD sentence reads « avant l'ouverture (moins le buffer) », i.e. 100 ms. The code follows the architecture; changing it is one line and a few test values.
2. **Buffered press.** A press in the buffer, released quickly, is resolved when the window opens: its sound (1.11) can come up to 160 ms after the tap.
3. **Baby feel guesses:** `lockMs` 300, `approachSpeedMps` 1.5, `actMs` 1500, and the rule « the baby speeds up to reach the outlet by the window's opening ».
4. **Holding a Parry threat ≥ 400 ms is a gag** (`wrongResponse`), the rule story 1.23 states, applied now so that no press can hang.
5. **Papa glides on every press on an active threat**, including an early one that gags: he arrives just in time to see the lamp go out.
6. **The outlet re-arms 6 s after each result** and the director re-targets as soon as the baby is free: in a level with only the outlet, it comes back every ~8 s.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.10 : Première menace jugée en headless, la prise électrique], and for what comes next [#Story 1.11] (icon, tap, glide visual, gag presentation), [#Story 1.12] (bots: « toutes les réponses à la prise sont perfect »), [#Story 1.14], [#Story 1.16] (tests generated from the JSON, no threat-specific code outside `gags.ts`), [#Story 1.18] (`LevelSchema` waves), [#Story 1.19] (fatigue modifier, `papa_microsleep`), [#Story 1.23] (Firmness), [#Exigences fonctionnelles › FR1, FR2, FR7, FR15, FR25], [#Exigences non fonctionnelles › NFR4, NFR9, NFR12]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#P1 — Cycle de vie d'une menace (« frame data »)] (`ThreatDefSchema`, `judgePress`, edge cases), [#P3 — Jugement à l'appui, chorégraphie ensuite], [#Chaîne d'entrées] (commands, judgement, fixed window order), [#Boucle de jeu et modèle de temps], [#IA du bébé et navigation] (baby FSM, glide in `glideMaxMs`), [#Modèle d'état], [#Patterns d'état], [#Patterns d'entités], [#Patterns de données], [#Système d'événements], [#Architecture des données] (relations checked by `content:check`), [#Contrats d'API (internes)], [#Arborescence] (`sim/timing`, `sim/threats`, `sim/director`, `schemas/threat.ts`, `level.ts`), [#Règles de cohérence], ADR-002, ADR-003, ADR-004, ADR-010
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Boucle de jeu] (micro-loop), [#Mécaniques principales › 1. Les cinq réponses] (input rules, early press, guard mode), [#› 2. Fenêtres de timing], [#Catalogue des menaces] (outlet: 1.2 s, Parry, gag), [#Contrôles et entrées] (haptics on telegraph and perfect), [#Timing et latence]
- [Source: _bmad-output/project-context.md] (Engine-Specific Rules, Time & input judgement, Critical Don't-Miss Rules, edge cases)
- [Source: _bmad-output/implementation-artifacts/1-8-le-bebe-vit-dans-le-salon.md] (D1 states per story, D7 gaze vs heading, D10 test filters, golden « events unchanged » proof), [1-9-retours-de-base.md] (`SIM_EVENT_TYPES`, feedback cues and checks, `levelSession` loaders), [deferred-work.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- **Baseline.** `npm run ci` was green before the first edit (commit `1c24ae4`), but only with `VITE_DEBUG_ALLOWED` unset: this shell exports `VITE_DEBUG_ALLOWED=false`, which wins over `.env.development`, so the dev server never wrote the `data-pp-*` mirrors and every e2e spec timed out on `data-pp-app="start"`. Every command below ran as `env -u VITE_DEBUG_ALLOWED …`. Not a repo bug (CI and a clean shell are fine), but worth knowing.
- **`simPurity` forbids the identifier `window`** anywhere in `src/sim` (declarations, parameters, keys). It flagged `ThreatInstance.window` and the `window` parameter of `judgePress` at the first full test run; the field became `responseWindow` and the parameter `effective`.
- **A test of mine had a wrong expectation** (a gag during a hold counted `WindowOpened` too) and the golden `cancels a glide` test miscounted the glides (three presses, one of them zero-length): fixed in the tests, not in the code.

### Implementation Plan

- **Content.** `ThreatDefSchema` / `LevelSchema` strict, with `.describe` and a unit suffix on every numeric key. `THREAT_DEF_PATTERN` and `LEVEL_PATTERN` go in `CONTENT_PATTERNS` after `LEVEL_GEOMETRY_PATTERN`; `matchContentPattern` accepts only `SNAKE_ID_PATTERN` ids (and takes the pattern list as an optional argument, to test both orders). `loadLevelContent` reads the level, then each distinct def it names, collecting every problem. `content:check` gains `checkThreatReferences` (gag ∈ `GAG_IDS`, cues ∈ `feedback.json`) and `checkLevelReferences` (geometry beside it, defs exist, anchors exist), each problem naming the file and the JSON path.
- **Timing** (`sim/timing/`): `effectiveWindow` (base × tier × fatigue × instinct, perfect capped at the window), `judgePress` (architecture P1 as written) and `classifyPress` (ADR-010), all pure and tested to the ms.
- **Threats** (`sim/threats/`): `threatFsm.ts` is the only writer of `state` / `enteredAt` (`enterThreatState`) with one helper per transition and its events; `runThreats` handles `PressThreat` / `Release` first (judged on `command.t`), then each instance in level order. `THREAT_STATES` has a compile-time completeness proof like `SIM_EVENT_TYPES`.
- **Director / baby / Papa.** `runDirector` (no rng) telegraphs the first due idle threat when the baby is free. `runBaby` adds the six rules of the story (release, lock, set off with D14's speed, approach, act end, then the unchanged wander/babble). Papa's `glide` state: `planWalkTo` (extracted from `tapFloor`, `papa_walk` events unchanged) + `startGlide`; `TapFloor` / `Move` cancel it, `MoveStop` does not. The A* + snapping logic Papa's tap, Papa's glide and the baby's approach share is `nav/planRoute.ts`; `nav/pathLength.ts` measures a path.
- **Wiring.** `createSim` takes a required `level: LevelContent`, checks it against the geometry (level id, defs loaded, anchors, gags), creates the instances with `allocateId`, builds `ctx.level`. Journal and snapshot are version 3 with `levelHash`; `replayJournal` refuses another level with an `err`. `SYSTEMS` = `applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa`.
- **Client.** `levelSession` loads the level JSON in parallel with the assets and the sounds (`loadLevelContent` dep, wired in `boot.ts` with the one browser content source); a failure is a `warn` naming the level and the problems, then « Oups ». The live `salon_crawler.json` plans nothing (D4).

### Completion Notes List

- **All 11 ACs are met.** `npm run ci` is green end to end (typecheck, lint, content:check, 1744 unit/golden/architecture tests with `src/sim` at ≥ 90 % coverage, 128 e2e on chromium and webkit, playtest build). Biome config and `tests/architecture/*.test.ts` are untouched; no new dependency.
- **Goldens regenerated deliberately** (`npm run golden:update`), for a reason that is not behavioural: `core_basic`, `papa_walk` and `baby_wander` changed only in `worldHash` (the world gained `threats`, `papa.glide`, `baby.targetThreatId` / `approachSpeedMps`) and in their journals (version 3, new `feelHash` because `feel.json` gained three baby keys, new `levelHash`). **Their `eventTypes` and `eventsHash` are identical to the committed ones** (checked on the `git diff` of the `.expected.json` files: only the `worldHash` line moves), which also proves the `tapFloor` extraction and the baby rewrite changed no behaviour. **`outlet_parry` is new**: seed 11, four cycles (perfect, early gag, late gag, perfect with a late enqueue and a `TapFloor` in the middle of the glide), pinned by `tests/golden/outletParry.test.ts`.
- **Deviations to know about (all recorded in `deferred-work.md`):**
  1. **`ThreatInstance.window` is `responseWindow`** (see Debug Log: `simPurity` forbids `window`). The snapshot messages name `world.threats[0].responseWindow`.
  2. **An `act` is never abandoned.** The story's baby rule 1 would send the baby back to `babble` as soon as the threat is `idle` again; with the shipped values (cooldown 6000 ms, `actMs` 1500) this never happens, but with a cooldown shorter than `actMs` it would cut the mischief short, against AC 8. `releaseTarget` now returns while the baby is in `act` and rule 5 ends it. To confirm with Geo.
  3. **« A target in another region leaves it staring with an empty path » cannot happen**: like Papa's tap, the approach snaps a target to the nearest open cell *of the baby's own region*, so a path always exists. `planApproach` still returns `false` when the baby stands on a closed cell (tested directly) and `runBaby` handles it (stays in `approach`, empty path).
  4. `nav/planRoute.ts` and `nav/pathLength.ts` are not in the story's file list: they hold the logic that `planWalkTo`, `planApproach`, the glide and D14's approach speed would otherwise have duplicated.
  5. Guard checks done by breaking things, then restoring: a level planning `outlett` → `content:check` names `threats[0].def`; `gag: "outlet_hairs"` → names `gag`; `feedback.telegraph: "tel_missing"` → names `feedback.telegraph`; a `ThreatState` added to the union but not to `THREAT_STATES` → `typecheck` fails (`Type 'true' is not assignable to type '"sleeping"'`); `Math.random()` in `threatSystem.ts` → `simPurity` fails. (They are also real cases of `checkContent.test.ts`.)
  6. The manual browser check ran as a headless Playwright script (844 × 390) on `npm run dev`, not in the built-in browser: the game starts through the countdown, a tap walks Papa (`walkPath`), the baby goes `babble ↔ wander`, no console error or warning (apart from the GL driver message). Nothing of the threat is visible before story 1.11.
- **Existing tests edited, and why.** Every `createSim` / `createSimWithSystems` / `replayJournal` call now passes `level` (`createTestLevel()`, no threat: `commandQueue`, `createSim`, `determinism`, `replay`, `snapshot`, `step`, `babySystem`, `papaSystem`, `clock`, `timeScale`, `loop`, `levelScene`, `feedbackDirector`, `levelSession`, the golden harness). Also: `step.test.ts` (pinned order: `runDirector` and `runThreats`), `createSim.test.ts` / `replay.test.ts` / `snapshot.test.ts` (version 3, `levelHash`, a moved-wall case needs a level of the same room), `commands.test.ts` (new commands), `feelSchema.test.ts` (the three baby keys), `jsonSchema.test.ts` (the pattern schemas and the two `$schema` pointers), `checkContent.test.ts` (two cases moved off paths that are now valid: `threats/feel.json` → `elsewhere/feel.json`, `levels/salon.json` → `levels/Salon.json`; plus the threat and level cases), `wander.test.ts` / `walk.test.ts` / `papaView.test.ts` / `babyView.test.ts` (the slice literals gain the new fields), `levelSession.test.ts` (the new dep, three new cases). None of them proves less than before.
- **Open points for Geo** are those of the story (early boundary 160 ms vs 100 ms, buffered-press sound up to 160 ms late, baby feel guesses, holding ≥ 400 ms is a gag, glide on every press, outlet back every ~8 s) plus deviation 2 above.

### File List

**Content and schemas**
- `content/threats/outlet.json` (new), `content/levels/salon_crawler.json` (new), `content/feedback.json`, `content/feel.json`
- `content/_schemas/threat.schema.json` (new, generated), `content/_schemas/level.schema.json` (new, generated), `content/_schemas/feel.schema.json` (generated)
- `src/content/schemas/threat.ts` (new), `src/content/schemas/level.ts` (new), `src/content/schemas/feel.ts`
- `src/content/loadLevelContent.ts` (new), `src/content/contentBundle.ts`, `src/content/contentFiles.ts`
- `tools/content/contentChecks.ts`
- `src/shared/constants.ts`

**Sim**
- `src/sim/timing/effectiveWindow.ts`, `judge.ts`, `classifyPress.ts` (new) and their three tests
- `src/sim/threats/gags.ts`, `threatFsm.ts`, `threatSystem.ts` (new), `threatFsm.test.ts`, `threatSystem.test.ts` (new)
- `src/sim/director/directorSystem.ts`, `directorSystem.test.ts` (new)
- `src/sim/baby/approach.ts`, `approach.test.ts` (new), `babyFsm.ts`, `babySystem.ts`, `babySystem.test.ts`, `wander.test.ts`
- `src/sim/papa/planWalk.ts`, `glide.ts`, `glide.test.ts` (new), `papaFsm.ts`, `papaSystem.ts`, `papaSystem.test.ts`, `walk.test.ts`
- `src/sim/nav/planRoute.ts`, `planRoute.test.ts`, `pathLength.ts`, `pathLength.test.ts` (new)
- `src/sim/world.ts`, `context.ts`, `createSim.ts`, `step.ts`, `events.ts`, `commands.ts`, `journal.ts`, `snapshot.ts`, `replay.ts`, `index.ts`
- `src/sim/commandQueue.test.ts`, `commands.test.ts`, `createSim.test.ts`, `determinism.test.ts`, `replay.test.ts`, `snapshot.test.ts`, `step.test.ts`, `time/clock.test.ts`, `time/timeScale.test.ts`

**Client**
- `src/client/app/levelSession.ts`, `levelSession.test.ts`, `src/client/boot.ts`
- `src/client/loop.test.ts`, `src/client/render/levelScene.test.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/client/render/views/babyView.test.ts`, `papaView.test.ts`

**Tests and fixtures**
- `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/support/testOutlet.threat.json` (new)
- `tests/content/threatSchema.test.ts`, `levelSchema.test.ts`, `loadLevelContent.test.ts`, `contentFiles.test.ts` (new), `feelSchema.test.ts`, `jsonSchema.test.ts`, `checkContent.test.ts`
- `tests/threats/threatCatalog.test.ts` (new)
- `tests/golden/scenarios.ts`, `golden.test.ts`, `outletParry.test.ts` (new), `journals/outlet_parry.json`, `journals/outlet_parry.expected.json` (new), `journals/{core_basic,papa_walk,baby_wander}{,.expected}.json` (regenerated)

**Docs**
- `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, this file

## Change Log

- 2026-10-27: Story 1.10 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
- 2026-10-27: Story 1.10 implemented (review): threat and level schemas, `loadLevelContent`, `content:check` cross-references; `sim/timing`, `sim/threats`, `sim/director`, the baby's lock / approach / act and Papa's glide; level in `createSim`, journal and snapshot version 3 with `levelHash`; client loads the level JSON; generated threat catalogue tests; new golden `outlet_parry`; `core_basic`, `papa_walk` and `baby_wander` regenerated with identical events.
