# Story 2.7: Latency calibration

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR56 · **UX:** UX-DR3, UX-DR16, `EXPERIENCE.md` L82, L149-153, L231, **L248-259** (State Patterns › Calibration), L399 (inputs), L439 (flashing), L534, L554; `DESIGN.md` L343-347, L509 · **Architecture:** **P5** (L787-807), Persistence (L283-292), L398 (`CalibrationDone`), L511 (`input/calibration.ts`), L522 (`screens/calibrationScreen.ts`), L955 · **GDD:** L379-383

## Story

As a player on a new device,
I want a short calibration on first launch,
so that my responses are judged fairly despite my screen's and my audio's latency.

## Acceptance Criteria

### Flow

1. **`appFsm`** gains the state `calibration`; `APP_TRANSITIONS`: `start: ['loading', 'calibration']`, `calibration: ['loading', 'oops']`. No existing row changes. `src/client/app/overlay.ts`: `OverlayKind` gains `calibration`, shown when `appState === 'calibration'`, below `portrait` in precedence. `overlayHost.ts` gains the builder. Update `appFsm.test.ts` L113-118 (it extends the table with the row this story makes real) and `overlay.test.ts`.
2. **First launch.** The save is read **before** `appFsm.enter('start')` (`boot.ts` L1395: `await saveStore.load()`), so that `onStart` stays synchronous inside the gesture. `onStart` (`boot.ts`, `createStartScreen`): `audio.unlock()` first, then `calibration === null ? calibration flow with returnTo 'loading' : levelSession.start()`. Calibration leads straight to the load of Age 1, no menu. A saved calibration goes straight to loading. **`?autoplay` never calibrates** (it calls `levelSession.start()` directly, boot L1430: keep it), and a bot's commands never pass through the mapper, so its timing does not move.
3. **The screen** `src/client/ui/screens/calibrationScreen.ts` (`createCalibrationScreen`): `{colors.ink}` background, `{colors.paper}` text (tokens only, CSS in `ui.css`, class `pp-calibration-screen`). Audio phase: 8 beeps at 100 BPM, `t('calibration.audio_prompt')`, a ring that pops at each beep. Visual phase: 8 disc flashes at 100 BPM (1.67 Hz), `t('calibration.visual_prompt')`. Then `t('calibration.done')` for `doneHoldMs`, then the flow ends. All 5 strings already exist in `strings.fr.json` L6-10; add none.
4. **What counts as a tap**, with the **event's own timestamp** in every case (never `performance.now()` in a handler):
   - `pointerdown` anywhere on `window`, `event.timeStamp`, primary button only, except on the skip button.
   - `keydown` with `code === 'Space'`, not `repeat`, `event.timeStamp`, with `preventDefault` (a focused button would otherwise be clicked). Espace only, unlike `isStartKey`.
   - pad A: `confirm`, with its **edge stamp** `padState.stampAtReal`. Today `onPadButton(button)` carries no stamp: add a second argument `atReal` through `InputMapperDeps.onPadButton`, `shell.handlePadButton(button, atReal)` and `OverlayScreen.activate?(atReal?: number)`. `padAction`: overlay `calibration` → `confirm` is `activate`, `back` (B) is the new action `skip`. `uiShell.handlePadButton` needs its own `case 'skip'`: its `default` branch passes anything unknown to `pauseScreen.moveFocus`.
   - **`menuPoll` must run in `calibration`**: add it to `wantsPoll` (`boot.ts` L1213), or A does nothing.
   - The press that opened the screen is not a tap: a `pointerdown` counts only while the screen is mounted (the start gesture ends on `pointerup`), and a key held from the start screen is filtered by `repeat`.

### Measurement

5. **`src/client/input/calibration.ts`** holds the pure maths (no DOM, no audio, allocation does not matter): `computePhaseOffset(beatsAtReal, tapsAtReal, rules)` returns `{ isEnough: true, offsetMs, validCount } | { isEnough: false, validCount }`.
   - Each tap is paired with the nearest beat; a tap further than half a beat interval from every beat is dropped; a beat keeps its **first** tap only.
   - Gap = tap − beat (positive = late). Median (mean of the two middle values when even). Values further than `outlierMs` (150) from it are rejected. **Then the median of the kept values**, rounded to a whole ms, clamped to `[offsetMinMs, offsetMaxMs]` (−50, 250).
   - Fewer than `minValidTaps` (5) kept: not enough.
   - Unit tests: perfect taps give 0; a constant lag gives it; each bound; an outlier rejected at 151 and kept at 150; even and odd counts; double taps on one beat; 4 valid taps refused and 5 accepted; no taps; taps before the first beat.
6. **Beat times.** Do not add `outputLatency` or `baseLatency`: the latency is what is being measured.
   - **Audio:** the beeps are scheduled on the audio clock at phase start. New engine method `playOneShotAt(clip, bus, gainPct, atS): { cancel(): void } | null` (`null` when the clip is not decoded or the context is not running; same `warn`-once and no-throw rules as `playOneShot`) and getter `currentTimeS: number | null`. `beatAtReal = performance.now() + (atS − currentTimeS) × 1000`, read once, at scheduling. The ring is drawn when the frame's time reaches `beatAtReal`.
   - **Visual:** the beat's time is the **`requestAnimationFrame` timestamp of the frame that turns the disc on**, not the planned time.
   - Each phase starts after `leadInMs` and listens for `tailMs` after its last beat. Screen timing goes through an injected frame scheduler and clock (as `resultScreen.ts` does), so tests drive it without a browser.
7. **Too few taps.** The phase does not restart on its own: it shows `t('calibration.too_few_taps')` and waits; the next tap (Espace, A) restarts it and is not counted. The skip button stays available in the audio phase.
8. **Skip.** `t('calibration.skip_audio')` is a real `<button>` (≥ 44 × 44 pt) in the audio phase, reachable by tap, Tab + Enter and pad B. It cancels every scheduled beep; only the visual phase is played; `audioOffsetMs = visualOffsetMs`, `audioSkipped = true`. Initial focus goes to the screen element (`tabindex="-1"`), never to the button.
9. **Audio cannot play → same result as a skip, automatically, with one `warn` on `audio`:** no context (unlock failed), beep not decoded, or context not `running` after `audioWaitMs`. A game started with a pad is the known case: a pad press is no user activation (`boot.ts` L1222). The screen never hangs on silence. The beep is preloaded on entry (`audio.preload([beepClip])`), and the audio phase starts when it settles.
10. **Background.** While the page is hidden or the portrait overlay covers the screen, the phase is stopped: scheduled beeps cancelled, taps discarded. On return it restarts from its beginning, with no prompt.
    - **Trap:** `bindVisibilityPause` already runs outside a level: `PauseRequested` suspends the context (`boot.ts` L413) and nothing resumes it, since `GameResumed` needs a level. The calibration flow calls `audio.resume()` on return, and rule 9's wait covers the async resume. `pause.state` may stay `paused`; `levelSession.start()` already handles that (L538-539).
    - **Trap:** portrait rebuilds overlays (`overlayHost.sync`). The flow's state (phase, gaps already measured) must live **outside** the screen, in the flow object, or a turned phone forgets the audio phase. Rebuild restarts the current phase only.
11. **Flashing** stays under 3 Hz (`EXPERIENCE.md` L439): `content:check` or a schema `refine` refuses a `bpm` above 180. Under reduced motion the ring pop drops its scale and keeps its opacity: the beat is information, so it never disappears. Use the boot's `prefersReducedMotion`. Calibration has no haptics (`EXPERIENCE.md` L256).

### Save

12. **`StoragePort`** in `src/platform/platform.ts` (`storage: StoragePort`): `get`, `set`, `remove`, async, JSON values, each returning `Result`. `src/platform/web/webStorage.ts` wraps localStorage; every access in `try`, since a private window can throw on read. Never touch localStorage outside it (`tests/architecture` may need a rule; add a failing fixture if so).
13. **`SaveSchema` v1** in `src/content/schemas/save.ts` (zod stays in `content`: `client` has no zod import today) and **`src/client/save/saveStore.ts`** (`createSaveStore(storage)`). Key `papa-parade.save`. `{ version: 1, calibration: { visualOffsetMs, audioOffsetMs, audioSkipped, measuredAt, device } | null }`. Offsets are bounded numbers, `measuredAt` an ISO date string (wall clock, a name imposed by the epic, not sim time: say so in a comment), `device` = `` `${capabilities.target}-${capabilities.touch ? 'touch' : 'desktop'}` ``, **never a user-agent**. Migrations: an ordered table `v{n-1} → v{n}`, empty today, run by `load()`, unit-tested with a fake v0.
    - An unparsable, invalid or future-version save is **set aside** under `papa-parade.save.invalid` and replaced by defaults, with a `warn` on `storage`. It never throws and never blocks the start. Calibration then runs again (`EXPERIENCE.md` L259).
    - A failed write is a `warn`, silent for the player. The values stay in memory, so this session's game is still corrected.
    - Only the fields this story uses (architecture L287); 2.8 adds `settings` with its migration.
14. **`CalibrationDone`** joins `ClientEvents` (architecture L398). `log.info` milestone on the `input` channel, with both offsets.

### Applying it

15. **Every input stamp is corrected in `inputMapper.ts`, nowhere else** (its comment at L141-142 says so). New dep `visualOffsetMs(): number`, read at each input. One local `toSim(active, atReal) = active.timeMap.realToSim(asRealMs(atReal - deps.visualOffsetMs()))` replaces each `realToSim` call: pointer down (L360, L395, L405, L420), **pointer up (L434)**, keys (L448), action (L276), `nowStamp` and `padEdgeStamp` (L281, L283). `simClockStamp` stays as it is. **The Release must be corrected too:** corrected press and raw release would add the offset to every hold. No calibration = offset 0 = today's behaviour, byte for byte.
16. **The sim must wait for the lag: without this, the correction breaks two rules** (decision D1, read it):
    - `classifyPress` (`sim/timing/classifyPress.ts` L18) declares a Firmness when `nowT >= pressT + holdMinMs`. A press corrected by 250 ms reaches that 250 ms early, before the finger's release can arrive: **any tap over 150 ms becomes a Firmness**, breaking ADR-010's single 400 ms threshold.
    - `runThreats` (`threatSystem.ts` L125) expires a window on the sim clock. A press physically after the close but inside it once corrected arrives on a threat already in `gag`, and is ignored: **the late edge never gets the correction.**
    - **Fix:** new journaled command `SetInputLag { t, lagMs }` (`sim/commands.ts`, list L78, a validity check, `lagMs` finite and ≥ 0, public `@sim` type) and `World.input.lagMs`, 0 by default, **in the snapshot (bump its version)**. `classifyPress` gets `holdMinMs + lagMs` for the no-release branch only (the branch with a release is exact, both stamps being corrected). The no-answer expiry at L125 adds `lagMs`. The `late` gag therefore plays `lagMs` later on a calibrated device. **Do not touch `judgePress`:** windows and `perfect` stay judged on the corrected `t`. Check `threatFsm` and `holdEnd.ts` for any other expiry read from the sim clock while a command may be in flight (`firmHoldOutcome`, the micro-sleep, a `wait` threat) and treat or justify each.
    - The client sends it at each level's start, `lagMs = Math.max(0, visualOffsetMs)`, only when that is > 0 (no command at offset 0, so goldens, bots and journals gain no entry), before the first frame; a new sim starts at 0. A recalibration with an active level re-sends it.
    - Tests: `classifyPress` and `threatSystem` with `lagMs`, at 0 and 250: a 200 ms tap stays a parry, a physical press at close + 100 with lag 150 is judged on its `t`, an unanswered window gags at `close + tolerance + lag`, a held press still fires `ResponseHeld`. A `sim:replay` round trip with the command. Generated threat tests stay green at lag 0.
17. **`startRecalibration(returnTo)`.** The flow is `src/client/app/calibrationFlow.ts` (`createCalibrationFlow(deps)`), built in `boot.ts`, exposing `startRecalibration(returnTo: AppState)`; first launch calls the same function. On completion: `returnTo === 'loading'` → `levelSession.start()`, else `appFsm.enter(returnTo)`. It replaces the stored values. **Story 2.8 adds the row and the transitions** (`settings → calibration → settings`): do not add a settings row here. Unit test with an extended table, as `appFsm.test.ts` does. A failure (the `oops` row) is not expected: nothing here throws; keep the row for the global handler (`boot.ts` L973 only sends `loading` and `level` to `oops`, so leave that gate alone).

### Content

18. **`feel.calibration`** (`src/content/schemas/feel.ts`, `.strictObject`, every number bounded and described, no `.default()`): `beatCount` 8, `bpm` 100, `outlierMs` 150, `offsetMinMs` −50, `offsetMaxMs` 250, `minValidTaps` 5, `leadInMs` 1000, `tailMs` 600, `audioWaitMs` 1500, `doneHoldMs` 1000, `pulseMs` 150. A `refine`: `minValidTaps ≤ beatCount`, `offsetMinMs < offsetMaxMs`. Client-only, like `feel.fx`: the sim never reads it. Read the base `content.value.feel`, not `levelFeel()` of a dead level. Files: `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `feelSchema.test.ts`, `npm run content:schemas`.
19. **The beep.** `feedback.json › calibration: { beep: { clip: 'ui_calibration_beep', bus: 'ui', gainPct: 100 } }` (schema in `feedback.ts`, in `feedbackClips`, so `content:check` looks for the file; path added to `contentChecks.ts` `clipPaths`). It is **not a cue**: the ring and the flash are the visual measure, and it has no haptic by design. Placeholder `synthCalibrationBeep` in `tools/audio/makePlaceholderAudio.ts`: short, sharp attack (the onset is what the player aligns to), deterministic. `npm run assets:audio -- --only ui_calibration_beep`, commit **only** that `.m4a`. The test in `makePlaceholderAudio.test.ts`, and `audioAssets.test.ts` stays under budget. Update the table fixtures as 2.6 did (`testContent.ts`, `feedbackDirector.test.ts`, `feedbackClips.test.ts`, `feedbackSchema.test.ts`, `tests/e2e/support/game.ts`).

### Tests and hygiene

20. **Keep the e2e suite off the calibration: one place, no edit to any spec.** `tests/e2e/support/calibratedSave.ts` builds a valid save (offsets 0, parsed by `SaveSchema` in a test, so it cannot rot). `playwright.config.ts` and `playwright.dist.config.ts` set `use.storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: 'papa-parade.save', value }] }] }` (also for `PP_DIST_URL`). `startLevel` and `openGame` are unchanged, and offset 0 sends no `SetInputLag`, so no timing moves. `autoplay.spec.ts` screenshots do not change.
21. **`tests/e2e/calibration.spec.ts`** (Chromium and WebKit), `test.use({ storageState: { cookies: [], origins: [] } })`, driven by debug mirrors (`isMirrored` only): `data-pp-calibration` (`audio|visual|retry|done`) and `data-pp-calibration-beats` (count, since polling misses a flash). Tap on the mirror's change, no fixed sleep. `collectProblems` empty unless the case warns on purpose.
    - First launch: start → `calibration` → both phases, taps by `Space` → « Calé ! » → `loading` → `level` (`recordAppStates`). The save holds both offsets within bounds.
    - Second load: start → `loading`, no calibration.
    - Skip: `audioSkipped === true`, `audioOffsetMs === visualOffsetMs`.
    - No taps: `retry` shows the string, the next tap restarts.
    - Background (`setVisibility`) mid-phase: beats restart from 0.
    - A corrupt save seeded: game reaches calibration, `papa-parade.save.invalid` holds the old value, one `warn` (allowed).
    - Pad (`stubGamepad`): A counts, B skips.
    - A level with a seeded offset of 100: `__PP__`'s journal shows `SetInputLag`, and a `PressThreat`'s `t` is earlier than without it.
    - What no spec checks, and the Completion Notes must say: **real latency on a real device.** The maths and the plumbing are proven; whether the offsets feel fair is Geo's call on a phone (`docs/playtest/device-measurements.md`).
22. **`dist:check`:** prod holds no `data-pp-calibration*` (behind `isMirrored`); the screen itself ships in prod. `uiStrings.test.ts`: no literal strings in the screen.
23. **Goldens:** `feel.calibration` and `World.input` move `feelHash` and `worldHash`: `npm run golden:update`, deliberately; the diff must hold **only hash lines** (plus the snapshot version where it appears), no event moved. State it in the Completion Notes.
24. **Docs.** `project-context.md`: Time & input (the correction covers every stamp including releases, and `SetInputLag`), Persistence (`saveStore`, `StoragePort`), snapshot version, e2e `storageState`. `CLAUDE.md` only if a command changes. `deferred-work.md` dated section: AC 25.
25. **Deferred, to record:** the Recalibrate row (2.8); `audioOffsetMs` is stored but unread until E4; a player unable to reach 5 taps in the visual phase has no way out (open point 3); the offsets are not in the exported playtest journal; a device change does not re-trigger calibration (`device` is stored, unread); a `SetInputLag` late gag and its feel (open point 1).
26. **Checks:** `(unset VITE_DEBUG_ALLOWED; npm run ci)` green once before the review (`env | grep VITE_` first). `ci:fast` after each task. Touched specs on Chromium: `calibration`, `ui`, `boot`, `feedback`, `mute`, `testApi`, `pauseResume`, `threat`, `debugOverlay`. Report `perf.spec.ts` next to 2.6's (16.8 ms, 40 draw calls, 1466 triangles).

## Tasks / Subtasks

- [ ] **T1. Content** (AC 18, 19): `feel.calibration`, `feedback.calibration`, beep clip, `content:schemas`, fixtures.
- [ ] **T2. Platform and save** (AC 12, 13): `StoragePort`, `webStorage`, `SaveSchema`, `saveStore`, migrations, set-aside; tests.
- [ ] **T3. Pure maths** (AC 5): `input/calibration.ts`; tests first.
- [ ] **T4. Engine** (AC 6): `playOneShotAt`, `currentTimeS`, `fakeAudioContext`; tests.
- [ ] **T5. Screen and flow** (AC 3, 4, 6-11, 14, 17): `calibrationScreen.ts`, `calibrationFlow.ts`, CSS; tests with an injected clock.
- [ ] **T6. App wiring** (AC 1, 2, 4): `appFsm`, `overlay`, `overlayHost`, `keys.ts`, `uiShell`, pad stamp, `menuPoll`, `boot.ts`, mirrors.
- [ ] **T7. Sim** (AC 16): `SetInputLag`, `World.input`, snapshot bump, `classifyPress`, expiry; tests.
- [ ] **T8. Mapper** (AC 15, 16): `toSim`, `visualOffsetMs`, sending `SetInputLag`; `inputMapper.test.ts` with offsets 0 and 100, press and release.
- [ ] **T9. e2e** (AC 20-22): `storageState`, `calibration.spec.ts`, pinned specs.
- [ ] **T10. Goldens and docs** (AC 23-25).
- [ ] **T11. CI** (AC 26).

## Dev Notes

### Decisions

- **D1. The sim learns the lag (AC 16). This goes beyond the epic's letter** (« corrigé avant d'être converti ») and the architecture's snippet, both of which stay true: `t` is still corrected in the client, and the judgement is unchanged. A correction into the past cannot work alone in a sim that decides on its own clock while the command is still in flight. Rejected: a raw and a corrected stamp on `PressThreat` (fixes the hold, not the expiry; two clocks in a command); `SetFeel` on `feel.input` (« Enregistrer » in the panel would write one device's lag into `content/feel.json`); ignoring it (a 250 ms device gets a broken Firmness). Geo can overrule: open point 1.
- **D2. Negative offsets:** `t` is ahead of the clock by at most 50 ms; `computeApplyAt` handles a future `t` and `TIME_MAP_MAX_EXTRAPOLATION_MS` (100) covers it. `lagMs` floors at 0.
- **D3. Tunables in `feel.calibration`** like `fx` and `music`; only the client reads them, and the golden hash move is the known price. Change them in `feel.json`; the panel's live value only reaches a calibration started while a level is on, which is not this story's path.
- **D4. Save schema in `content`, store in `client`.** The epic's sentence groups them under `saveStore.ts`; the zod boundary wins.
- **D5. `storageState` over a URL flag or a spec edit:** the real boot path runs, every existing spec stays untouched, and no bypass ships in the product.
- **D6. Papa's glide is unaffected:** `runPapa` never reads a command's `t` (`papaSystem.ts` L190-197). He sets off when the command applies.

### Current state of the files this story changes

- **`src/client/app/appFsm.ts`**: table in L12-19, whose comment announces these rows.
- **`src/client/boot.ts`** (1431 lines): `onStart` in `createOverlayHost`, `appFsm.enter('start')` L1395, `wantsPoll` L1213, mirror union L231-276, `onPadButton` L1147, `createInputMapper` L1106.
- **`src/client/input/inputMapper.ts`**: see AC 15. `isLive()` is false in `calibration`, so game commands cannot leak.
- **`src/client/ui/keys.ts`**: `padAction` returns null outside its overlays; add `calibration` before the `appState !== 'level'` line.
- **`src/client/audio/audioEngine.ts`**: `playOneShot` is the model; `suspend` / `resume` already exist.
- **`src/platform/platform.ts`**: its header comment already announces `storage`.
- **Real and sim clocks:** the calibration is all real time; no sim exists on the first launch.

### Must not change

- `judgePress`, `effectiveWindow`, window values, bots, `npm run sim` at lag 0.
- The start screen's gesture and the synchronous `audio.unlock()`.
- The CSP (localStorage needs none of it). No new dependency. No Capacitor.

### Architecture compliance

- `platform` imports no `content`; `client` reaches storage only through `Platform`. Sim globals rule holds: `SetInputLag` is plain data.
- `create<Name>` in a file named after it; units as suffixes (`offsetMinMs`, `tapsAtReal`, `beatsAtReal`, `atS`); constants in `shared/constants.ts`; no `enum`; `log`, never `console`; I/O returns `Result`.

### Previous story intelligence

- **2.6:** a client-only `feel` block moves golden hashes: regenerate and check it is hashes only; fix the fixture list in AC 19 at once; `--only` for an audio clip; mirrors plus `*-count`, since polling misses short states; a failed unlock must leave no half state (its review finding).
- **2.5:** live values read at use; reset state between runs.
- **1.17 D5:** pad edges carry their own stamp; a pad press is no activation.
- **1.9:** the engine never throws into a caller; `warn` once.

### Git

Branch `story/2-7-calibration-de-la-latence` in `.claude/worktrees/2-7-calibration-de-la-latence`. Commit « Story 2.7 : calibration de la latence », then « Story 2.7 : corrections de la revue de code ». Never on `main`.

### Open points for Geo

1. **D1 / AC 16:** the sim waits `lagMs` before a late gag and before a Firmness. On a slow device the gag comes up to 250 ms later, by design. OK?
2. **Starting values:** `leadInMs`, `tailMs`, `doneHoldMs`, `pulseMs` are guesses. Tune by playing.
3. **No way out of the visual phase:** the epic re-proposes it indefinitely below 5 taps. Is a « Plus tard » worth adding? Not built here.
4. **Pad start:** the audio phase is skipped automatically (AC 9), so a pad player gets `audioSkipped: true`. Acceptable until E4 reads the audio offset?

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7], [#Story 2.8]; FR56 (L120)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] P5 L787-807, L283-292, L398, L511, L522, L955
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] L379-383
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L248-259, L231, L399, L439; [DESIGN.md] L343-347, L509
- [Source: _bmad-output/project-context.md] › Time & input judgement, › Platform & Build Rules
- [Source: _bmad-output/implementation-artifacts/2-6-musique-adaptative-de-base.md] Review Findings

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed: comprehensive developer guide created.

### File List
