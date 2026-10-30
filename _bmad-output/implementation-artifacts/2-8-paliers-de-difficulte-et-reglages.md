# Story 2.8: Difficulty tiers and settings

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR55 · **UX:** UX-DR17, UX-DR24, `EXPERIENCE.md` L88-89, L97, L182-190, L227-230, L253, L312, **L332-340** (State Patterns › Réglages); `DESIGN.md` L314-343, L505-508 · **Architecture:** L223 (window order), L283-292 (save), L398 (`SettingsChanged`), L510, L522, L957 · **GDD:** L362-374

## Story

As a player,
I want to choose an Assistance, Normal or Experienced Dad tier, and to set the sound, the vibrations and the calibration,
so that the game stays funny and comfortable whatever my level.

## Acceptance Criteria

### Tier in the sim

1. **Ids.** `shared/constants.ts`: `DIFFICULTY_TIER_IDS = ['assistance', 'normal', 'experienced'] as const` and `DEFAULT_DIFFICULTY_TIER = 'normal'`, with the type `DifficultyTierId` (the sim may not import runtime values from `content`). `DifficultySchema` in `content/schemas/feel.ts` keeps its three keys; a compile-time check ties them to the ids.
2. **New journaled command `SetDifficultyTier { t, tier }`** (decision D1), built like `SetInputLag`: `sim/commands.ts` (union L70, list L100, validity L205: a known tier), public `@sim` type, applied in `applyCommands` (`commandQueue.ts` L68), first of the step. **`World.difficultyTier`**, `'normal'` at creation, in the snapshot with its validation: **version 18** (`snapshot.ts` L33, L40, L59; update the version comment and the test titles).
3. **One reader.** New helper `activeDifficulty(world, ctx)` in `src/sim/timing/difficulty.ts`, returning `ctx.feel.difficulty[world.difficultyTier]`, so a level's `feelOverrides` and a live `SetFeel` on the active tier both apply. It replaces both reads of `difficulty.normal`:
   - `threatFsm.ts` L63-66 (`tier:` in `telegraphThreat`; drop the comment on L65).
   - `judgeable.ts` L11-15. `isJudgeableBeforeEnd` gains `world`; callers `baby/carry.ts` L140, `gauges/fatigueSystem.ts` L41. **Trap:** left at `normal`, an Assistance micro-sleep spawned near the end shows a telegraph that never resolves.
4. **Order.** `effectiveWindow` is not touched: the tier already comes first (`base × tier × fatigue × instinct`, then the tolerance). `judgedWindow` (`threatFsm.ts` L126) stays neutral: a timed-out silence was never telegraphed. Tests: base 300 gives 450 / 300 / 225; with a fatigue penalty of 20 %, 360 / 240 / 180; tolerance and buffer unscaled; `perfectMs` capped by the window; a window telegraphed before a `SetDifficultyTier` keeps its length (frozen at telegraph, `threatFsm.ts` L52); the micro-sleep's judgeable check at each tier.
5. **Instinct gate (epic AC 4).** The instinct does not exist yet: `runInstinct` is story 2.9. Here: a unit test that `activeDifficulty(...).hasInstinct` is `false` at `experienced` and `true` otherwise. 2.9 must read it through this helper: record that in `deferred-work.md` under 2.9. No e2e or sim test of a non-trigger is possible in this story; say so in the Completion Notes.
6. **What reads the window needs no change, and a test proves it:** the ring and the auto-target read `responseWindow` (`client/input/urgency.ts`), the bots aim at its middle (`bots/threatTiming.ts`). The generated « perfect / success / too early / too late » tests run at each of the three tiers.
7. **Headless.** `npm run sim -- --tier <id>` (`tools/sim/simArgs.ts`, default `normal`, refused when unknown, in `SIM_HELP`): `runSim.ts` enqueues the command at t = 0 when the tier is not `normal`. The report and `runFile` carry `tier`. A `sim:replay` round trip at `experienced`. Update the `npm run sim` row of `CLAUDE.md`.

### The client sends the tier

8. **Sent at a level's start only**, in `onLevelStarted` (`boot.ts` L719, next to `sendInputLag`), with `t: sim.world.time.sim`, when the saved tier is not `normal` and not `isAutoplaying`. So there is no entry at `normal` (goldens, bots and journals are unchanged); a restart or the next game reads the save again, which is what « Appliqué à la prochaine partie » means; a game under way never changes. `?autoplay` ignores the player's save, as it does for the lag.

### The save

9. **`SaveSchema` v2** (`content/schemas/save.ts`, `SAVE_VERSION = 2` in `constants.ts`): adds `settings: { tier, volumes: { music, sfx, voice, ui }, haptics }`, strict. Volumes are whole `0..100` numbers, 100 by default (100 = the mix of `feedback.json`, which they multiply). `createDefaultSave` gives `{ tier: 'normal', volumes: all 100, haptics: true }`. **No `reducedMotion` or `largeVerbs`:** 2.10 adds them with v3 (architecture L287: each field comes with the story that uses it). Export `Settings`.
10. **Migration `v1 → v2`** in `SAVE_MIGRATIONS` (`saveStore.ts` L18), pure, not mutating its input: keeps `calibration`, adds the defaults. Migrated saves are written back (L137 does it). Tests: a real v1 save keeps its calibration; `saveStore.test.ts` fakes that assume `SAVE_VERSION === 1` are updated.
11. **`saveStore.setSettings(settings)`**: memory at once, then write, like `setCalibration`. A slider sends many writes, so a failing storage warns **once** until a write succeeds again.
12. **The two 2.7 deferrals this story owes** (`deferred-work.md` L648): `setAside` keeps the **first** copy in `papa-parade.save.invalid` (never overwrites one); a **future-version** save is left in place, set aside as well, and the session runs on in-memory defaults with **no writes at all** (one `warn`), so a rollback cannot destroy a newer save. `migrateSave` must tell that case apart (`reason` becomes a discriminated outcome). Tests for both.

### App flow

13. **`appFsm`** (`appFsm.ts`): states `settings`, `credits`. Rows: `level: […, 'settings']`, `settings: ['level', 'calibration', 'credits', 'oops']`, `credits: ['settings', 'oops']`, `calibration: […, 'settings']`. No entry is removed. Export pure `isSettingsDetour(from, to)`: true for `level → settings` and `settings → level`. Update `appFsm.test.ts` (L113-118, L133) and `calibrationFlow.test.ts` L22.
14. **`overlay.ts`**: `OverlayKind` gains `settings` and `credits`, below `calibration`, above `oops`. `overlayHost.ts`: builders and `switch` cases. Overlays never stack; portrait rebuilds the screen from the save, so a screen holds no state of its own.
15. **A level is still alive under `settings`: the existing listeners would destroy it (decision D2).** Fix each one, with an e2e proof:
    - `boot.ts` L1355-1364 (`from === 'level'`): skip on a detour, or **every threat icon and object label is unmounted** and never comes back.
    - `boot.ts` L1384-1388 (`to === 'level'`): skip on a detour, or `mirrorNewLevel` resets the mirrors mid-game.
    - `boot.ts` L432-435 (loops): `to === 'level'` → `startLevelLoops` (idempotent; it restarts them after a recalibration); `from === 'level' && to !== 'settings'` → stop; **`to === 'calibration'` → stop**, or the music plays under the beeps.
    - `boot.ts` L1039 (global error gate): add `settings` and `credits`, and `calibration` when `levelSession.active !== null`. The first-launch calibration stays outside, as 2.7 wants.
    - `boot.ts` L1268 (pad lost): also true in `settings` and `credits`, or the panel loses its line. `pause.requestPause` is already a no-op there.
    - `boot.ts` L1325 (`wantsPoll`): add `settings`, `credits`. The level loop also polls (L813): a second read in a frame sees no new edge, and this stays right for the Fridge (3.11).
16. **Audio on a recalibration from the pause (decision D3).** The pause suspended the context and only `GameResumed` or a page return resume it, so the audio phase would always auto-skip after `audioWaitMs`. `startRecalibration` calls `audio.resume()` first. On `calibration → settings` with `pause.state !== 'running'`, boot calls `audio.suspend()`, or the resume countdown and the panel are no longer silent. Tests in `calibrationFlow.test.ts`; the e2e checks `audioSkipped === false` on a recalibration from the pause.
17. **Recalibrate** from Settings: `calibrationFlow.startRecalibration('settings')`. `CalibrationDone` already re-sends `SetInputLag` to the active sim (`boot.ts` L1106-1109).
    **`lagMs` is not latched per threat** (`deferred-work.md` L646, decision D4).

### Screens and inputs

18. **Pause.** `pauseScreen.ts` L55-58 gains `{ labelKey: 'pause.settings', variant: 'secondary', onActivate: options.onSettings }` after « Recommencer » (`EXPERIENCE.md` L167). In `boot.ts`: `onSettings: () => appFsm.enter('settings')`. Back rebuilds the panel with focus on its first button (default in `EXPERIENCE.md` L227).
19. **`src/client/ui/screens/settingsScreen.ts`** (`createSettingsScreen`), `pp-overlay` + a panel (`role="dialog"`, `aria-modal`, title `t('settings.title')`), CSS in `ui.css`, tokens only. Rows in this order (leave the slot 2.10 needs between Vibrations and Recalibrer):
    - **Difficulté** (`settings-segmented`, `DESIGN.md` L332, L508): `role="radiogroup"`, three `role="radio"` buttons with roving `tabindex`, the selected one first in focus. Below: the selected tier's hint (`settings.tier_*_hint`), then `settings.applies_next_game`. The string keys exist. Always shown in this story, since the only entry is the pause; 3.11 decides for the Fridge.
    - **Four volumes** (`settings-slider`, L324, L507): `<label>` + `<input type="range" min="0" max="100" step>`, step `VOLUME_STEP_PCT = 5` in `constants.ts`. Fill by a CSS variable set with `style.setProperty`. **Never `setAttribute('style', …)`: the CSP forbids it.**
    - **Vibrations** (`settings-toggle`, L316, L506): a `role="switch"` button; **not built** when `capabilities.haptics` is `false`.
    - **Recalibrer**, **Crédits**, **Retour** (`pp-button`, `bindPressButton`: UX-DR7).
    - Every change: `onChange(settings)` at once, on the range's `input` event. No Save button.
    - Focus on the first row (`initialFocus`). The radio that takes focus is the selected one, not necessarily the first.
20. **Fit in a landscape phone** (844 × 390, the e2e viewport): the rows exceed the height, so the panel scrolls (`max-height: 100%`, `overflow-y: auto` exist on `.pp-panel`). Wider panel (`pp-settings-panel`, about `min(560px, 100%)`), volumes on a two-column grid. **Trap:** this is the first panel that really has to scroll by touch: give the sliders `touch-action: pan-y`, so a vertical swipe that starts on one scrolls the panel instead of moving its value (`touch-action: none` in `ui.css` L42 is the canvas only and does not reach the overlay). Every target ≥ 44 pt. Moving focus by key or pad calls `scrollIntoView({ block: 'nearest' })` (`preventScroll` would hide Crédits). The e2e reaches Crédits by touch and by key at that viewport.
21. **Keys and pad.** `OverlayScreen` gains optional `moveFocus?(code): boolean` and `back?(): void` (`pauseScreen` already has both).
    - `uiShell.bindKeys` (L146-147) and `handlePadButton` (L117-121) call `overlayHost.screen`, not `pauseScreen`.
    - `keys.ts`: `EscapeAction` gains `back`; `escapeAction` returns it in `settings` and `credits` (not on a repeat, not in portrait). `padAction` for those overlays: A `activate`, B `back`, D-pad `PAD_FOCUS`, Start nothing. Place it before L124.
    - In Settings: Up/Down move between rows (`nextFocusIndex` with vertical codes only; the radiogroup is one row). Left/Right change the row: a radio selects the neighbour and wraps, a slider moves one step and clamps, others nothing. `moveFocus` is true for all four arrows so the shell calls `preventDefault`, or a focused range would move twice. A presses the focused control (`click()`, `detail === 0`). B and Esc go back one level.
    - `activate` is a no-op with a range focused.
22. **`creditsScreen.ts`** (`createCreditsScreen`): a plain panel with `t('credits.title')`, `t('credits.body')`, and Retour (focus on it). Back to `settings`.
23. **Strings:** add `settings.title` (« Réglages »), `settings.back` (« Retour »), `credits.title` (« Crédits »), `credits.body` (« Papa Parade. Crédits à venir. », provisional) to `strings.fr.json` and to the list in `tests/content/stringsSchema.test.ts`. `uiStrings.test.ts`: no literal in the two screens.

### Applying the settings

24. **Client event `SettingsChanged { settings }`** (`clientEvents.ts`, architecture L398). `boot.ts`: `onChange` → `saveStore.setSettings`, then emit. No `log` per slider tick.
25. **Volumes.** Engine method `setPlayerVolumes(volumes)`: remembered, applied at once when the graph exists, and at its creation otherwise (`createBusGraph`, `audioEngine.ts` L329: the unlock comes after the save is read). A bus gain is `gainPct / 100 × pct / 100`. Never throws. Called at boot after `saveStore.load()` and on `SettingsChanged`. Tests with `fakeAudioContext`: before and after unlock, 0, and that the other buses do not move. The comment at `feedback.ts` L42 is now true.
26. **Vibrations.** `createGatedHaptics(haptics, isEnabled)` in `src/client/feedback/gatedHaptics.ts`, unit-tested: `boot.ts` L369 gives it to the director with `() => saveStore.current().settings.haptics`. Read at each pulse. `__PP__.cueLog()` still records the cue's table value (`boot.ts` L394).
27. **Guards.** `reducedMotion` is not read here (2.10). `tests/architecture` stays as is. No new dependency. CSP unchanged. No Capacitor.

### Tests and hygiene

28. **`tests/e2e/support/calibratedSave.ts`** becomes a v2 save (`Partial` overrides still work; add a `settings` override). `tests/content/calibratedSave.test.ts` and the seeds of `calibration.spec.ts` follow. **`calibratedSave` at `normal` adds no command**, so no timing moves.
29. **`tests/e2e/settings.spec.ts`** (Chromium and WebKit), through `data-pp-*` mirrors, DOM attributes and `localStorage`; no fixed sleep; `collectProblems` empty unless a case warns on purpose.
    - Pause → Réglages: `ppApp === 'settings'`, one child in `#pp-ui`, focus on the selected tier. Back: the pause panel; the threat markers and objects still mounted; `ppFlow`, `ppCombo`, the journal and sim time unchanged; Reprendre then counts down and the game continues.
    - Tier: select Assistance, then the hint and the note show, and the save holds it at once. The running game's next window is still 300 (`__PP__.state()`). « Recommencer »: a `SetDifficultyTier` in the journal and a window of 450. Same for `experienced`: 225. Back at `normal`: no command.
    - A reload keeps the tier, the volumes and the toggle.
    - Volumes and toggle: the save changes on each. Toggle hidden with `navigator.vibrate` stubbed away (WebKit has none; use the mirror `ppHaptics`).
    - Recalibrer: `calibration`, `audioSkipped === false`, back in `settings`; the music is stopped during it and playing after Reprendre.
    - Crédits and back. Esc and pad (`stubGamepad`): D-pad, A, B through every row.
    - Portrait over Settings and back: the same panel, the saved values.
    - A seeded v1 save migrates; a seeded v3 save stays untouched in `papa-parade.save` and `papa-parade.save.invalid`, with one `warn` allowed.
30. **Unit:** `settingsScreen.test.ts`, `creditsScreen.test.ts`, `keys.test.ts` (Escape and pad tables), `uiShell.test.ts`, `overlay.test.ts`, `pauseScreen.test.ts` (three buttons: focus wrap), `simArgs` tests.
31. **Goldens:** `World.difficultyTier` moves `worldHash`: `npm run golden:update`, deliberately; the diff must hold **only hash lines** (`eventsHash` and `eventTypes` identical). State it in the Completion Notes. `npm run content:schemas` only if a schema output changes (`feel` should not).
32. **Bots, once:** `npm run sim -- --bot perfect --tier experienced --runs 5` has no gag from timing; `--bot human --runs 20` at each tier: report the gags by tier in the Completion Notes (Assistance < Normal < Experienced is the expected order). The balance itself is Geo's.
33. **Docs.** `project-context.md`: snapshot version 18, `SetDifficultyTier`, the save v2, `isSettingsDetour`, the `calibratedSave` line. `CLAUDE.md`: `--tier`. `deferred-work.md`, dated section: close L70 (rest → 2.10, 3.11), L146, L535 (Vibrations part), L631, L646 (D4), L648; move L86 to 2.10 (the setting it waits for is there); and AC 34.
34. **Deferred, to record:**
    - 2.9 must gate on `activeDifficulty(...).hasInstinct` (AC 5).
    - The catastrophe gauge's ×0.5 / ×1 / ×1.25 by tier (GDD L366-368): no story or code has that gauge yet (`decision-log.md` L45: `gds-correct-course` pending). `feel.difficulty` gets its multiplier with that gauge.
    - The Fridge magnet entry and its return (3.11); the repeated-failure card (3.x); the automatic Crédits (6.8); `credits` content.
    - No sound preview on a slider from the pause (context suspended): open point 2.
    - No way out of a recalibration from Settings below 5 taps: open point 3.
    - The tier is in the journal's commands but not in `summary`, so `playtest:metrics` does not split by tier.
    - Menu auto-repeat on a held D-pad (L307) stays deferred: a pad reaches any volume in 20 presses.
    - `sessionStorage` fallback (L647) stays deferred: no story needs it, the platform decision waits for E8's `@capacitor/preferences`.
35. **Checks:** `env | grep VITE_` first. `ci:fast` after each task. Touched specs on Chromium: `settings`, `calibration`, `ui`, `pauseResume`, `boot`, `feedback`, `mute`, `adaptiveMusic`, `testApi`, `threat`, `autoplay`. `(unset VITE_DEBUG_ALLOWED; npm run ci)` once, green, before the review. Report `perf.spec.ts` next to 2.7's (16.8 ms, 40 draw calls, 1466 triangles).

## Tasks / Subtasks

- [ ] **T1. Sim** (AC 1-6): ids, `SetDifficultyTier`, `World.difficultyTier`, snapshot v18, `activeDifficulty`, `judgeable`; tests first.
- [ ] **T2. Headless** (AC 7, 32): `--tier`, report, replay round trip, bot runs.
- [ ] **T3. Save** (AC 9-12): v2, migration, `setSettings`, first copy kept, future version; tests.
- [ ] **T4. App states** (AC 13-17): rows, `isSettingsDetour`, overlay kinds, the boot listeners, audio on a recalibration.
- [ ] **T5. Screens** (AC 18-23): pause row, `settingsScreen`, `creditsScreen`, CSS, strings.
- [ ] **T6. Keys and pad** (AC 21): `OverlayScreen`, shell, `keys.ts`.
- [ ] **T7. Applying** (AC 8, 24-26): tier at level start, `setPlayerVolumes`, `createGatedHaptics`, `SettingsChanged`.
- [ ] **T8. e2e** (AC 28-30): `calibratedSave` v2, `settings.spec.ts`, pinned specs.
- [ ] **T9. Goldens and docs** (AC 31, 33, 34).
- [ ] **T10. CI** (AC 35).

## Dev Notes

### Decisions

- **D1. The tier reaches the sim as a journaled command, at the level's start.** Same shape as `SetInputLag`: no change to the journal format or to `createSim`, no entry at `normal`, so goldens and old journals still replay and `sim:replay` needs nothing new. Rejected: a `createSim` option plus a journal header (journal v4, every golden rewritten, testers' journals refused); `SetFeel` on `difficulty.normal` (the debug panel's « Enregistrer » would write a player's tier into `content/feel.json`, the reason 2.7 D1 gave too); merging into the feel before `createSim` (`feelHash` would no longer match `content/feel.json`, and replay would refuse it).
- **D2. `settings` is a real `appFsm` state, as the epic and the architecture ask, and the level survives it.** The sim, the loop and the pause controller are untouched: the game stays `paused` under the panel, and the loop keeps rendering. What had to change is everything that read « left `level` » as « the level is over » (AC 15), hence one pure `isSettingsDetour`. The HUD hides in `settings` (`uiShell.ts` L70): the panel is on a scrim, and the shell does not need to know a level is underneath.
- **D3. The music is kept across Settings, stopped across a calibration.** Under Settings the context is suspended, so the loops are silent and resume where they were. A calibration needs a running context, so its loops stop and restart from the top on return. Accepted: a recalibration is rare.
- **D4. `lagMs` is not latched.** A recalibration happens in a pause; it can move only the expiry of a window open at that moment, by at most the difference of two offsets, once. Latching means a field per threat and a snapshot change for that one case. In slow-mo the wait in sim ms lasts longer in real time, which errs in the player's favour. Close the deferral with this reason.
- **D5. Autoplay ignores the save** (AC 8). A `?autoplay&seed` run must stay reproducible whatever the player chose. `--tier` covers bots at other tiers.
- **D6. `VOLUME_STEP_PCT` is a constant, not feel.** It is the grain of a control, not something Geo tunes for feel. The volumes' defaults are 100 because the mix lives in `feedback.json`.

### Current state of the files this story changes

- **`src/client/boot.ts`** (1551 lines): audio events L431-435, `sendInputLag` L700, `onLevelStarted` L719, global error gate L1039, `calibrationFlow` L1078, `CalibrationDone` L1106, overlay host L1115, pause builder L1132, pad lost L1268, `wantsPoll` L1325, level-left listener L1355, level-entered listener L1384.
- **`src/client/ui/screens/pauseScreen.ts`**: the actions list L55 announces this row; it spreads to three buttons.
- **`src/client/ui/uiShell.ts`**: `refresh` L60-73, pad L94-123, keys L131-151 (`pauseScreen` only today).
- **`src/client/app/calibrationFlow.ts`**: `returnTo` already serves this; `finish` L146-147 enters it. Only `audio.resume()` is new.
- **`src/client/save/saveStore.ts`**: the migration table is empty; `setAside` L102-108 overwrites today; `migrateSave` L41-43 folds the future version into a plain failure.
- **`src/client/audio/buses.ts`**: gain from the table only. The engine holds `graph` (`audioEngine.ts` L133, L329).
- **`src/sim/threats/threatFsm.ts`** L63-69 and **`judgeable.ts`** L11-15: the only two reads of a tier in the sim (`grep difficulty`).
- **Strings:** tier, hint, note, volume, Vibrations, Recalibrer and Crédits labels are already in `strings.fr.json` L77-95 (`settings.reduced_motion` and `large_verbs` wait for 2.10).

### Must not change

- `effectiveWindow`, `judgePress`, the input mapper, window values, the sim at `normal` (events identical).
- `pause` semantics: Back from Settings never resumes. Only Reprendre does, through the countdown.
- The start screen's gesture, first-launch calibration, `?autoplay`.
- CSP, stack, `feel.json` values.

### Architecture compliance

- `sim`: no client type; the tier is plain data. `shared` holds the ids. `content` holds zod. `client` reaches storage only through `saveStore`. The two screens import no `sim`.
- `create<Name>` in a file named after it; units as suffixes (`volumeStepPct` style: `VOLUME_STEP_PCT`); no `enum`; `log`, never `console`; strings through `t`; CSS tokens only; ≥ 44 pt.
- Window order is `sim/timing` only.

### Previous story intelligence

- **2.7:** a `World` field moves `worldHash` only: check the golden diff holds hash lines; `storageState` keeps every spec off new paths; state outside the screen survives portrait; `migrateSave`'s no-throw contract; a mirror behind `isMirrored`; timing bounds in specs are sim ms and instinct-aware.
- **2.6:** mirrors plus counts, since polling misses short states; a failed unlock leaves no half state.
- **1.17:** pad edges and `padAction` tables; pad press is no user activation, so a pad recalibration may auto-skip audio (2.7 AC 9, fine).
- **1.5 D14:** Escape's table; `bindPressButton` cancels the compat mouse events, so a press that swaps the screen does not fall through to the new one.

### Git

Branch `story/2-8-paliers-de-difficulte-et-reglages` in `.claude/worktrees/2-8-paliers-de-difficulte-et-reglages`. Commit « Story 2.8 : paliers de difficulté et réglages », then « Story 2.8 : corrections de la revue de code ». Never on `main`.

### Web research

None needed: no new library, the stack is pinned, and native `<input type="range">` is covered by the Chromium and WebKit e2e runs.

### Open points for Geo

1. **Catastrophe gauge (GDD L366-368).** The GDD gives each tier a gauge multiplier; the epic does not (FR55), and the gauge exists in no story yet (`decision-log.md` L45). Built here: windows and the instinct flag only. Run `gds-correct-course` when you want that gauge.
2. **No sound on a slider from the pause.** The audio is suspended there, so « Musique » moves silently; you hear the result on resuming. A short sample would need a running context in a pause. Worth it?
3. **Stuck in a recalibration.** 2.7 kept « no way out below 5 taps » for the first launch. From Settings, an accidental « Recalibrer » forces 8 + 8 beats (the audio phase can be skipped, the visual cannot). Not built: a Retour there would be an easy add if you want one.
4. **Crédits text** is a placeholder, as the epic allows.
5. **Interface at 0** silences the calibration beep (it is on the `ui` bus). The skip button stays, so nobody is blocked. Accepted.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8], [#Story 2.9], L608, L635; FR55 (L119), UX-DR17 (L246), UX-DR24 (L256)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L223, L283-292, L398, L510, L522, L956-957
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] L228, L362-374
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md] L41-45
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L88-89, L97, L182-190, L227-230, L312, L332-340; [DESIGN.md] L314-343, L505-508
- [Source: _bmad-output/project-context.md] › Time & input judgement, › Platform & Build Rules
- [Source: _bmad-output/implementation-artifacts/2-7-calibration-de-la-latence.md] AC 16-17, Review Findings, D1
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L70, L86, L146, L307, L535, L631, L646-648

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
