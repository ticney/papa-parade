---
baseline_commit: 516b463eb33099f1dba6c6e5ee4d9ad2bfd61b81
---

# Story 2.1: Debug overlay, timing timeline and feel panel

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 2.1 « Overlay de debug, timeline de timing et panneau de feeling » (L1222-1244). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As Geo,
I want to see the offset in ms of each of my presses and tune the feel values while I play,
so that I can tune the feel without touching the code.

**Requirements covered:**

- FR65 `[P]` (epics L132, coverage map L331: « E1 (fichier), E2 (panneau) »): every feel parameter is tuned without touching the logic. Story 1.2 delivered the file; this story delivers the panel.
- Supplementary requirements (epics L180, L198): Tweakpane panel (dev and `?debug=1`), journaled `SetFeel`, save through the dev-only Vite plugin `feel-writer`; debug overlay (F1 or 3-finger tap) with performance, timing timeline, inspector, navigation and colliders, step by step, cheats.
- Architecture P6 « Réglage à chaud du feeling » (game-architecture.md L809-815), « Outils de debug » (L420-434), security of `feel-writer` (L1075), `renderer.info` in the overlay (L1098).
- Golden rule (CLAUDE.md, GDD L60): Geo tunes, the AI writes and tests.

**What this story is not:**

- Not the latency calibration (story 2.7). There is no `visualOffsetMs` yet: the timeline shows the press as the sim judged it, which is « corrected for latency » with an offset of 0 until 2.7 (D9).
- Not the shareable playtest build, the FPS counter requirement of `?debug=1` on devices, the perf e2e budget or the production bundle check (story 1.24). This story must not break 1.24's « no debug code in the prod bundle » rule, and checks it once by hand (T9).
- Not the gating of debug commands in replayed journals (deferred-work L352): it stays deferred (D4).
- Not new gauges: noise is story 3.1, need is epic 4. « Régler une jauge » covers fatigue, the only gauge in the sim.
- Not the E4 sequence launcher (story 4.4 adds its cheat to this overlay; keep the cheat list easy to extend, D12).
- Not juice or player-facing UI: nothing here is seen by a player.

**Sources:** epics L1222-1244, L132, L180, L198, L331; game-architecture.md L187, L263, L420-434, L528-531, L603, L787-815, L927, L1031-1052, L1075, L1098; GDD §2 « Fenêtres de timing » (L147-159); EXPERIENCE.md L406; project-context.md (Debug, Testing, Performance, Platform rules); deferred-work.md L31, L95, L114, L133, L221, L257, L352, L398, L411.

## Acceptance Criteria

Sim tests use the frozen fixtures (`tests/support/testContent.ts`, `tests/support/testFeel.json`), never the live `content/feel.json`. E2E bounds are read from the live content, never written as literals.

### `SetFeel` in the sim

1. **The command.** `SimCommand` gains `{ type: 'SetFeel'; t: SimMs; patch: FeelPatch }` (a deep partial of `Feel`: objects merge key by key, arrays and scalars are given whole). It is added to `COMMAND_TYPES` (the sorted list test in `commands.test.ts` is updated) and to `commandProblem`, which refuses a `patch` that is not a plain object or holds a non-finite number, a `__proto__`/`constructor`/`prototype` key, or a value that is not a plain object, finite number, string or array. At apply time the sim also refuses a patch that does not fit the current feel's shape (an unknown key at any depth, a leaf whose type differs, an array of another length): it is ignored with an `InvariantViolated` event (strict mode throws). Range checks are not the sim's job (D3). (epics AC 3; D1, D3)
2. **Applied at the next step, journaled.** `sim.enqueue(SetFeel)` records the command in the journal like any other; at its `applyAt` step it merges the patch into the effective feel **before** any system of that step runs, so every system of that step reads the new values. A `SetFeel` received while the level has `ended` is drained and ignored like any command. (epics AC 3; D1, D2)
3. **The effective feel lives in the world.** The effective feel moves from `ctx.feel` (constant) to `world.feel`, so it is in `snapshot()` and survives `restore()` (snapshot version 12, with a `feelProblem` validator). `ctx.feel` stays the way systems read it (a getter onto the current world's feel), so no system call site changes. The journal header and snapshot `feelHash` stay the hash of the **initial** feel given to `createSim`. (D2; deferred-work L31)
4. **Replay reproduces it.** A journal with a `SetFeel` at `t` replays to the same `worldHash` and the same events, and the change takes effect at the same step in the replay as in the recording (unit test plus a new golden scenario, D13). `npm run sim:replay` accepts it; `tools/sim` additionally validates each `SetFeel` of a loaded journal with `FeelSchema` (merged onto the level's feel) and refuses the journal with a clear message if one is invalid. (epics AC 3; D3)
5. **Values read once are documented, not hidden.** The values the sim reads only at creation (`movement.papaRadiusM`, `baby.bodyRadiusM`, `baby.babbleMinMs` for the first wander, `fatigue.startPoints`, every `physics.*`) keep doing so; a threat already telegraphed keeps the window frozen at telegraph time (threatFsm D8). The panel marks those keys « next level » (AC 15). No test may expect them to change mid-level. (D5)
6. **The timeline gets the window from the event.** `ResponseResolved` gains `window: { windowMs; perfectMs; toleranceMs; bufferMs }`, the effective window the threat was judged against (its `responseWindow`), at every emission site (`resolveThreat`, `gagThreat`, the `nothing` success, the timed-out fail). (epics AC 2; D9)

### Client: the live feel

7. **The client reads the live feel.** `levelFeel()` in `boot.ts` (touch radii, input settings, baby body radius, `holdMinMs` for the hold ring, `mama` for the Result screen) reads the sim's effective feel (`active.sim.world.feel`), not `ActiveLevel.feel` frozen at start. A `SetFeel` on `input.touchRadiusPx` changes the hit test on the next pointer event. (deferred-work L221; D6)
8. **`__PP__.setFeel` becomes the journaled command.** `setFeel(patch)` validates `patch` merged onto the current effective feel with `applyFeelPatch` (an invalid patch rejects with the schema paths, and nothing is sent), then enqueues `SetFeel{ patch, t: world.time.sim }` on the running sim. It no longer restarts the level, and no longer warns about `input` patches. It also updates the feel the next `loadLevel`/restart uses (`levelSession.current.feel`), so a tuned value survives a restart (D7). The 1.13 doc comment, the e2e spec « setFeel() restarts the level » and `result.spec.ts`'s use of it are updated to the new behaviour. (D7)

### Debug overlay

9. **Opening.** The overlay is loaded by a literal dynamic `import('@debug/debugOverlay')` in `client/boot.ts`, inside `if (import.meta.env.VITE_DEBUG_ALLOWED === 'true')`, only when `isTestApiEnabled(...)` is true (dev, or `?debug=1` on a playtest build). It starts **hidden**. `F1` (`KeyboardEvent.code === 'F1'`, default prevented) or three touch pointers down at the same time on the game toggles it. The toggle gesture never becomes a game command beyond what the first finger already sent (D10). (epics AC 1)
10. **Performance.** It shows FPS, frame time, sim time per frame (all steps of the frame) and render time, plus draw calls and triangles from `renderer.info` (`GameRenderer.stats()`), refreshed every `DEBUG_PANEL_REFRESH_MS` (a constant, not every frame). The loop measures sim and render time with an injected clock only when asked (no cost when the overlay is absent). (epics AC 1; D11)
11. **World inspector.** A read-only view of `sim.world`: a summary (sim time, `timeScale`, flow state, Papa state, baby state, fatigue, each threat's id, def and state) and a collapsible JSON tree of each world slice. It never writes the world (it reads; it never holds a mutable reference across frames it could write through) and refreshes at the panel rate only while the overlay is open. (epics AC 1)
12. **Debug views.** Toggles draw, in the 3D scene, the navigation grid (walkable cells of the level geometry) and Papa's current path, the colliders (boxes), the anchors (points) and the zones (boxes, coloured by `kind`); a DOM toggle draws each threat's touch radius (`input.touchRadiusPx`, live) around its icon point. Everything is off by default, lives in one debug group/layer cleared at each level start, and is removed when the overlay hides. (epics AC 1; D12; deferred-work L95, L114, L133)
13. **Time controls and cheats.** Pause and resume (`levelSession.freeze`), one step (`advance(1)`), forced `timeScale` (sends `SetTimeScale`, so its range is `[MIN_TIME_SCALE, 1]`, with a « 1 » reset), and the cheats: launch a threat (a list of the level's threats, sends `ForceThreat{threatId}`), set fatigue (sends `SetFatigue{points}`, hidden in a level with no fatigue), skip to the end (fast-forwards through `levelSession.advance` in chunks of `DEBUG_SKIP_CHUNK_STEPS` per frame until `LevelEnded`, D12), and restart with another seed (`loadLevel(id, seed)`, architecture L429). Every cheat goes through a command or the level session; none writes the world. (epics AC 1; D12; deferred-work L398)

### Timing timeline

14. **The 10 last responses.** On each `ResponseResolved`, the timeline adds a row (the newest on top; it keeps `DEBUG_TIMELINE_ROWS = 10`) showing, on a horizontal axis centred on the window centre: the tolerance band, the standard window, the perfect window, and the press marker at `offsetMs`; with the signed offset in ms (« +23 ms », « −41 ms ») and the quality (`perfect`, `success`, `fail` + `reason`). A response with `offsetMs: null` shows « no press » with no marker. The axis spans from the early limit (`−(windowMs/2 + toleranceMs + bufferMs)`) to the late limit (`windowMs/2 + toleranceMs`) of that row's window. The row geometry comes from a pure function, unit tested. It updates on events only. (epics AC 2; D9)

### Feel panel and save

15. **Generated from `FeelSchema`.** A Tweakpane 4 pane, built from `z.toJSONSchema(FeelSchema)`: one folder per top-level section, nested folders for nested objects (including each `physics.kinds` entry), a number binding per numeric leaf with `min`/`max` from the schema (a slider only when both bounds exist; `step: 1` for integers), a list for enums (`input.earlyPress`, `shape`), one binding per array item for `mama.starThresholdPoints`, the `.describe()` text as the label's hint, a « next level » marker on the keys of AC 5, and a « level override » marker on the keys the current level's `feelOverrides` sets. Nothing about the feel shape is hand-written in the panel: a new key in `FeelSchema` appears with no panel change (unit test on the pure descriptor builder). (epics AC 3; D8)
16. **A change sends `SetFeel`.** When a binding's change is final (Tweakpane's `ev.last`, so a slider drag sends one command), the panel builds the one-leaf patch, validates it with `applyFeelPatch` against the current effective feel (so the cross-field refines such as `perfectMs ≤ windowMs` apply), and on success enqueues `SetFeel{ patch, t: world.time.sim }`. On failure it puts the binding back to the effective value, shows the schema message in the pane and logs a `warn` on the `debug` channel; nothing is sent. The pane refreshes from `world.feel` on each level start. (epics AC 3)
17. **« Enregistrer », dev only.** The button exists only when `import.meta.env.DEV`. It POSTs the leaves changed in this session (not the whole effective feel, so the level's `feelOverrides` never leak into `feel.json`) to the `feel-writer` endpoint, and shows the result (saved, or the refusal message). (epics AC 3; architecture P6 L814; D14)
18. **The `feel-writer` plugin.** `tools/vite/feelWriterPlugin.ts`, wired in `vite.config.ts`, `apply: 'serve'` (absent from any build). Its middleware answers only `POST` on `FEEL_WRITER_ENDPOINT` with a JSON body `{ file: string; patch: object }` of at most `FEEL_WRITER_MAX_BODY_BYTES`. It refuses (403) any `file` that does not resolve to `<root>/content/feel.json` (path traversal, absolute paths, other files). It merges `patch` into the **file's** current JSON (not the effective feel), keeps `"$schema"` as the first key and the key order, validates the result with `FeelSchema` (400 with the paths on failure, file untouched), writes it formatted so that `biome check content/feel.json` passes, and answers 200. Its own write does not reload the page (D14). (epics AC 3; architecture L1075)

### Tests and checks

19. **Unit and golden.** Tests cover: `commandProblem` for `SetFeel`; apply at the next step; journaled and replayed at the same step; snapshot/restore with a changed feel; `ResponseResolved.window` at each emission site; the client's live `levelFeel()`; the panel descriptor builder; the timeline row function; the plugin handler (accepted merge, refused paths, invalid values, oversize body, method other than POST, `$schema` and key order kept, overrides untouched). The golden journals and references are regenerated deliberately (`npm run golden:update`), and the story says so. (D13)
20. **End to end.** New `tests/e2e/debugOverlay.spec.ts` (chromium and webkit): F1 toggles the overlay; a three-finger touch toggles it; it is hidden at boot (so the autoplay screenshot references do not change); after a perfect parry the timeline's first row shows `perfect` and an offset; changing `timing.windowMs` in the pane puts a `SetFeel` in `__PP__.events`/the journal and changes `world.feel`; launch-threat and skip-to-end cheats work; typing in a pane field never moves Papa or skips the Result screen (deferred-work L411). `testApi.spec.ts` and `result.spec.ts` pass with the new `setFeel`. The save endpoint is unit tested, not hit by e2e (it would rewrite the live file).
21. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green. `npm run build` output contains no `tweakpane`, `debugOverlay` or `feel-writer` string (checked by hand in T9, recorded in the Debug Log; the automated check is story 1.24's).

## Tasks / Subtasks

- [ ] **T0: Baseline** (all)
  - [ ] `env | grep VITE_`; then `(unset VITE_DEBUG_ALLOWED; npm run ci)` before the first edit. Write the counts (unit, e2e) in the Debug Log. Do not edit files while it runs (1.23 got 36 false e2e failures that way).
- [ ] **T1: `SetFeel` and the feel in the world** (AC 1-5)
  - [ ] `src/sim/commands.ts`: add `SetFeel` to the union, `COMMAND_TYPES`, `commandProblem` (it has no feel, so it checks only the value kinds listed in AC 1; the shape check against the current feel runs in the apply function, D3). Update `commands.test.ts`.
  - [ ] New `src/sim/feel/applyFeelPatch.ts` (the sim's own merge: the sim may not value-import `@content`): pure, proto-safe (`__proto__`, `constructor`, `prototype` keys refused), returns the merged feel or `null` when the patch does not fit the shape. Unit tests next to it.
  - [ ] `src/sim/world.ts`: `feel: Feel` slice; `createWorld` takes the initial feel (cloned). `src/sim/context.ts` / `createSim.ts`: `ctx.feel` becomes a getter on the current `world.feel` (mind `restore()` replacing the world object). Apply due `SetFeel`s in `applyCommands` (or a dedicated step at the head of `step.ts`, before `advanceTime`).
  - [ ] `src/sim/snapshot.ts`: version 12, `feel` field with its `…Problem` validator; tests in `snapshot.test.ts`.
  - [ ] `src/sim/journal.ts` stays version 3 unless the shape check needs a bump (it should not: a new command type is additive); `feelHash` stays the initial feel's.
  - [ ] `tools/sim`: validate each `SetFeel` of a loaded journal with `FeelSchema` (merged in order onto the level's feel); clear refusal message.
- [ ] **T2: `ResponseResolved.window`** (AC 6)
  - [ ] `src/sim/events.ts` and every emission site in `src/sim/threats/threatFsm.ts` (and any other emitter: grep `type: 'ResponseResolved'`). Update the tests that build or match this event (`grep -rn ResponseResolved src tests`), including bots and client handlers that destructure it.
- [ ] **T3: Client live feel and `__PP__.setFeel`** (AC 7, 8)
  - [ ] `src/client/boot.ts` `levelFeel()` and its readers read `active.sim.world.feel`; keep `ActiveLevel.feel` only where the start feel is meant.
  - [ ] `src/debug/testApi.ts` `setFeel`: validate, enqueue `SetFeel`, update `levelSession.current.feel` (D7); remove the restart and the `input` warn; rewrite the doc comment. Update `src/debug/testApi.test.ts`, `tests/e2e/testApi.spec.ts` (« setFeel() sends SetFeel… »: same `time.sim` order of magnitude, no restart, `world.feel` changed after one `advance`), `tests/e2e/result.spec.ts`.
- [ ] **T4: Hooks the overlay needs** (AC 10, 12)
  - [ ] `src/client/loop.ts`: optional `measure?: () => number` clock; when given, `LoopStats` gains `simMsLastFrame`, `renderMsLastFrame`, `frameMsLastFrame` (no allocation per frame). Tests in `loop.test.ts`.
  - [ ] `src/client/app/testHost.ts` (+ `tests/support/fakeTestHost.ts`): add what the overlay reads and nothing more: `renderStats()`, `loopStats()`, `levelGeometry()` (kept on the active level), `debugGroup()` (a `THREE.Group` in the level scene, emptied at level start), `threatScreenPoints()` (the icon points the hit test uses), and a way to turn loop measuring on. Keep `TestHost` read-only towards the sim.
- [ ] **T5: The overlay** (AC 9-13)
  - [ ] `src/debug/debugOverlay.ts` (`createDebugOverlay(host)`: root element, toggle by F1/3 fingers, show/hide, owns the panels), `perfPanel.ts`, `stateInspector.ts`, `navDebugView.ts` (grid, path, colliders, anchors, zones, touch radii), `cheats.ts`, `debugOverlay.css` (`pp-debug-` classes; above the HUD and game overlays; `pointer-events` only on its panels). Architecture names (L529-530) are the file names, except the entry, which is `debugOverlay.ts` (D12).
  - [ ] Keyboard and pointer events inside the overlay root stop propagation so they never reach game input or the Result screen's Enter/Space skip.
  - [ ] `src/client/boot.ts`: the guarded literal dynamic import, try/catch + `warn` (1.13 review pattern).
  - [ ] Constants in `src/shared/constants.ts`: `DEBUG_PANEL_REFRESH_MS`, `DEBUG_TIMELINE_ROWS`, `DEBUG_SKIP_CHUNK_STEPS`, `DEBUG_THREE_FINGER_COUNT`, `FEEL_WRITER_ENDPOINT`, `FEEL_WRITER_MAX_BODY_BYTES`.
- [ ] **T6: Timing timeline** (AC 14)
  - [ ] `src/debug/timingTimeline.ts`: pure `timelineRow(event): TimelineRow` (percent positions of tolerance band, window, perfect window, marker; signed label; quality label) + the DOM view with 10 preallocated rows. Tests on `timelineRow` (early, late, perfect, `null` offset, `nothing` response, a widened window).
- [ ] **T7: Feel panel** (AC 15-17)
  - [ ] `src/debug/feelControls.ts`: pure `describeFeelControls(jsonSchema)` → a tree of folder/binding descriptors (path, kind, min, max, step, options, hint, `isNextLevel`). Tests: every leaf of `FeelSchema` has a descriptor; bounds match the schema; enums become lists; integers get `step: 1`.
  - [ ] `src/debug/feelPanel.ts`: builds the Tweakpane `Pane` from the descriptors, binds a working copy of `world.feel`, sends `SetFeel` on `ev.last`, reverts on refusal, tracks the changed leaves for « Enregistrer » (dev only), refreshes at level start.
- [ ] **T8: `feel-writer`** (AC 18)
  - [ ] `tools/vite/feelWriterPlugin.ts`: `feelWriterPlugin({ root })` + an exported pure-ish `handleFeelWrite(request, fs)` for tests; formatting through the project's Biome (D14); HMR self-write suppression. `vite.config.ts`: register it, remove the « arrives in story 2.1 » comment. `tools/vite/feelWriterPlugin.test.ts` with a temp directory (never the real `content/feel.json`).
  - [ ] Check Vitest still starts (it merges `vite.config.ts`).
- [ ] **T9: E2E, goldens, finish** (AC 19-21)
  - [ ] `tests/e2e/debugOverlay.spec.ts` as in AC 20; `collectProblems` in every test, no `waitForTimeout`, `freeze`/`advance` for timing.
  - [ ] New golden scenario with a `SetFeel` (D13); `npm run golden:update`, deliberately; say so in Completion Notes with the hashes that moved.
  - [ ] `npm run build`, then `grep -rl "tweakpane\|debugOverlay\|feel-writer" dist/` returns nothing; record it in the Debug Log.
  - [ ] Manual check in `npm run dev`: open with F1, change `timing.windowMs`, play a parry, see the row; « Enregistrer » writes `content/feel.json`, `git diff` shows only that key, then restore the file. Record it.
  - [ ] `(unset VITE_DEBUG_ALLOWED; npm run ci)` green; update `deferred-work.md` (close L31, L95, L114, L133, L221, L398, L411 where done; add what this story defers). File List, Completion Notes. Tick only what you ran.

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | `SetFeel{t, patch}` is a normal journaled `SimCommand`, applied before the systems of its `applyAt` step. | Architecture P6 (L813) and the consistency rule L927; « appliqué au pas suivant » is `computeApplyAt`'s `simNow + STEP_MS` floor. |
| D2 | The effective feel moves into `world.feel`; `ctx.feel` becomes a getter on it. Snapshot v12. `feelHash` stays the initial feel's. | deferred-work L31 and 1-3 D2: once the feel can change, it must be in the snapshotted state or `restore()` would bring back the wrong feel. A getter keeps the ~30 `ctx.feel.*` call sites unchanged. The initial hash still identifies the content a journal was recorded with. |
| D3 | The sim checks shape, not ranges: `commandProblem` checks a plain object of finite numbers/strings/arrays; the apply step checks the patch fits the current feel's shape and ignores it otherwise (emitting `InvariantViolated`, strict mode throws). Ranges and refines are checked by the sender (`applyFeelPatch` in debug) and by `tools/sim` when loading a journal. | The sim may only type-import `@content` (CLAUDE.md layer table), so it cannot run `FeelSchema`. Same split as `SetTimeScale`, whose range is the sender's/`clampInvariant`'s. |
| D4 | Debug commands stay accepted from any journal (no build gate). | deferred-work L352 says revisit with the other debug commands; the production client has no code that sends them (the debug chunk is not in the bundle). Keep it deferred; note `SetFeel` in that entry. |
| D5 | Values read once at sim creation stay that way; the panel labels them « next level ». | Rebuilding nav grids or Rapier mid-level is out of scope and would break determinism guarantees; FeelSchema descriptions already say « next level » for the radii (feel.ts L135, L152). A threat keeps the window frozen at telegraph (threatFsm D8). |
| D6 | The client reads `active.sim.world.feel` for every live feel value. | One source of truth; deferred-work L221 asks that the patched feel reach the input mapper. |
| D7 | `__PP__.setFeel` sends `SetFeel` and also updates `levelSession.current.feel`, so a restart keeps the tuned values. | The 1.13 contract (architecture L1051: « via la commande SetFeel »). Geo restarts often while tuning; losing values on restart would be a trap. The panel does the same. |
| D8 | The panel is generated from `z.toJSONSchema(FeelSchema)` through a pure descriptor builder. | « généré depuis `FeelSchema`, bornes issues du schéma » (AC 3); the JSON Schema already carries `minimum`/`maximum`/`exclusiveMinimum`/`description`/`enum` (`src/content/jsonSchema.ts`). A pure builder is testable without a DOM. |
| D9 | `ResponseResolved` carries the judged `window`. The press offset is the sim's `offsetMs`. | The event has no window today, and the threat's `responseWindow` is nulled at rearm, so reading it from the world afterwards is fragile. Latency: the press `t` is already « corrected » where the correction will live (`inputMapper.ts` L141-142, story 2.7); with no calibration yet, the offset is 0. |
| D10 | Toggle: `F1` by `code`; three touch pointers down at once on the canvas/overlay host (window capture listener counting active `pointerType === 'touch'` pointers). The first finger's game command is not undone. | Architecture L433. Undoing a sent command would need a new command; one stray tap while opening a debug tool is acceptable. |
| D11 | Frame/sim/render timing comes from an optional `measure` clock injected in the loop (`performance.now` from `boot.ts`), on only when the overlay is loaded. | The loop does not time anything today; the client may read real time, but zero cost and zero allocation when the overlay is absent (project-context Performance). |
| D12 | Overlay entry `src/debug/debugOverlay.ts` (not `overlay.ts`, to avoid confusion with `client/app/overlay.ts`, the game's screen chooser). Skip-to-end = chunked `advance` until `LevelEnded`, not a new command. Cheats live in `cheats.ts` as a list of entries so story 4.4 can add one. | Skip-to-end through real steps keeps the game rules and the journal honest (the end is scored as played) and needs no sim change; chunking keeps the page responsive (e2e `advanceToEnd` does the same). |
| D13 | One new golden scenario `feel_change` (a `SetFeel` on `timing.windowMs` before a parry, so the change visibly affects the judgement) in `tests/golden/scenarios.ts`; all goldens regenerated (world hash moves with `world.feel`). | Architecture L814, L927: « tests golden ». `world.feel` changes every `worldHash`. |
| D14 | « Enregistrer » sends only the leaves changed this session; the plugin merges them into the file's JSON, validates with `FeelSchema`, formats with the project's Biome, and suppresses the HMR reload of its own write. | P6 L814: « sans toucher aux `feelOverrides` des niveaux ». `JSON.stringify(…, 2)` would expand the one-line objects and arrays of `feel.json` (`slowMoPerfect`, `starThresholdPoints`), so `npm run lint` would fail. Without suppression, Vite reloads `browserContentSource` and the game restarts mid-tuning. |

### Current state of the files this story changes (read before editing)

- **`src/sim/context.ts` L119-121**: `readonly feel: Feel` (« the effective feel as given to `createSim` »). **`createSim.ts`**: `ctx = { feel: content.feel, … }` (L503-518); `feelHash = hashJson(content.feel)` (L420), used by `journal()` (L602), `snapshot()` (L565), `restore()` (L570-575, invariant on `feelHash`). Values read once: nav grids from radii (L424-425), `simLevelOf(…, content.feel.physics)` (L317-330), Rapier from `feel.physics` (L494), `createWorld` with `babbleMinMs` and `startPoints` (L430-432). `restore()` replaces the world object: the getter must read the current one. Preserve: everything about determinism and the hash checks.
- **`src/sim/commands.ts`**: union, `COMMAND_TYPES`, `commandProblem` (shape only). No central dispatcher: each system reads `ctx.commands` (`SetTimeScale` in `time/clock.ts` L14-18 clamps to `[MIN_TIME_SCALE, 1]`; `SetFatigue` in `gauges/gaugesSystem.ts` L12-17; `ForceThreat` in `director/directorSystem.ts` L46-49). `applyCommands` (`commandQueue.ts` L55-58) drains due commands; `step.ts` L35-53 orders systems, and only `applyCommands` + `advanceTime` run after `ended`.
- **`src/sim/snapshot.ts`**: version 11, holds `feelHash` but not the feel (L269 comment).
- **`src/sim/events.ts` L100-112**: `ResponseResolved{t, threatId, response, quality, reason?, offsetMs}`; emitted in `threatFsm.ts` `resolveThreat` (L133-140) and `gagThreat` (L182-191). `judgePress` (`timing/judge.ts` L16-28) defines early/late/perfect against `EffectiveWindow {windowMs, perfectMs, toleranceMs, bufferMs}` (`world.ts` L82-117).
- **`src/debug/testApi.ts`**: `setFeel` (L153-170) merges onto `levelSession.current.feel` and restarts the level; doc comment L24-26; `input` warn. `src/debug/feelPatch.ts` `applyFeelPatch(feel, patch)` validates with `FeelSchema` — reuse it in the panel.
- **`src/client/boot.ts`**: debug gating (L202-206, L1057-1112), `levelFeel()` (L860) and its readers (L626, L832, L914-923), `renderer.stats()` mirrored per level (L648-656), `beforeStep` hook (L548), `LevelScored` → `finish()` + Result (L746-758).
- **`src/client/loop.ts`**: `LoopStats {stepsLastFrame, droppedBacklogMs, frames}`, `setFrozen`, `advance(n)`; no timing. Lives inside `levelSession` (L395-405).
- **`src/client/app/testHost.ts`**: `content`, `levelSession`, `pauseState()`, `setStepHook`, `onLevelStarted`, `onSimEvent`, `onGameResumed`, `setGameInputBlocked`. Fake in `tests/support/fakeTestHost.ts`.
- **`src/client/app/overlay.ts`**: the game's screen chooser (`portrait|oops|result|pause|loading|start`). Not debug. Leave it alone.
- **`src/client/input/inputMapper.ts` L141-142**: where calibration will be subtracted (2.7). Not this story.
- **`vite.config.ts`**: 8 lines, the « feel-writer arrives in story 2.1 » comment. `vitest.config.ts` merges it.
- **Geometry**: `LevelGeometry.nav`, `colliders`, `anchors`, `zones` (`src/content/schemas/levelGeometry.ts` L28-94); loaded in `levelSession.start`, not kept on `ActiveLevel` today. `ctx.nav` is not reachable; draw the geometry's grid.

### Architecture compliance

- `src/debug` may import anything; nothing imports it statically; `boot.ts` only through a literal guarded `import()` (R7, R9; Biome `noRestrictedImports`). Never weaken these rules.
- The client and debug code never write `sim.world`; they enqueue commands (project-context ❌ list).
- The sim: no `@content` value import, no real time, no logging (emit events). `src/sim/feel/applyFeelPatch.ts` is pure.
- `src/sim` coverage stays ≥ 90 %. Every new sim function has unit tests.
- No `console.*`: `log.warn('debug', …)`. I/O (the plugin's file read/write) returns `Result`; no silent catch.
- Units are suffixes; real-time values in the overlay are `…Real`/`…AtReal` when they are instants.
- Bind keys by `KeyboardEvent.code`.

### Library and framework notes

- **Tweakpane 4.0.5** (devDependency, pinned; do not upgrade): `import { Pane } from 'tweakpane'`; `pane.addFolder({ title })`, `folder.addBinding(obj, key, { min, max, step, label, options })`, `binding.on('change', (ev) => { if (ev.last) … })`, `pane.refresh()`, `pane.addButton({ title })`, `pane.dispose()`. `options` for lists is `{ label: value }`. Tweakpane binds to an object property, so bind to a working copy and rebuild/refresh it from `world.feel` (never bind `world.feel` itself: that would write the world). It injects its own styles; mount it inside the overlay root.
- **zod 4.6.7**: `z.toJSONSchema(FeelSchema)` (already used in `src/content/jsonSchema.ts`) gives `minimum`, `maximum`, `exclusiveMinimum`, `description`, `enum`, `type: 'integer'`. Refines are not in the JSON Schema: hence the full validation per change (AC 16).
- **Vite 8.3.5** plugin API: `{ name, apply: 'serve', configureServer(server) { server.middlewares.use(...) }, handleHotUpdate(ctx) }`. `server.host: true` exposes the dev server on the LAN: the plugin's path restriction and schema validation are the safety (architecture L1075).
- **Biome 2.6.3** formats `feel.json`; call the local binary (`node_modules/.bin/biome format --write <file>`) from the plugin, or an equivalent the dev proves stable with a test.

### File structure

New:
- `src/sim/feel/applyFeelPatch.ts` (+ test)
- `src/debug/debugOverlay.ts`, `debugOverlay.css`, `perfPanel.ts`, `stateInspector.ts`, `navDebugView.ts`, `cheats.ts`, `timingTimeline.ts`, `feelControls.ts`, `feelPanel.ts` (+ tests for the pure parts)
- `tools/vite/feelWriterPlugin.ts` (+ test)
- `tests/e2e/debugOverlay.spec.ts`
- `tests/golden/journals/feel_change.json` + `.expected.json`

Changed (expected): `src/sim/commands.ts`, `commands.test.ts`, `commandQueue.ts` or `step.ts`, `context.ts`, `createSim.ts`, `world.ts`, `snapshot.ts`, `snapshot.test.ts`, `events.ts`, `threats/threatFsm.ts` (+ tests), `index.ts` (export the `FeelPatch` type if the debug layer needs it from `@sim`), `src/client/loop.ts`, `src/client/app/testHost.ts`, `src/client/app/levelSession.ts`, `src/client/boot.ts`, `src/debug/testApi.ts` (+ test), `src/shared/constants.ts`, `tools/sim/*` (journal validation), `vite.config.ts`, `tests/support/fakeTestHost.ts`, `tests/golden/scenarios.ts` + all golden files, `tests/e2e/testApi.spec.ts`, `tests/e2e/result.spec.ts`, `tests/e2e/support/testApi.ts`, `_bmad-output/implementation-artifacts/deferred-work.md`.

### Testing

- Sim: Node, `createSim` + typed commands, `stepN`, no fake timers. Test the step at which a `SetFeel` takes effect (e.g. `walkSpeedMps` or `timing.windowMs` read by a judgement right after).
- Debug: pure parts (`describeFeelControls`, `timelineRow`, cheat list) unit tested; DOM parts e2e.
- Plugin: temp directory, never the real file; assert a refused request leaves the file byte-identical.
- E2E: chromium + webkit, landscape 844 × 390 with touch; `collectProblems`; `freeze` + `advance`; no `waitForTimeout`; no screenshot of the overlay (no new references).
- Goldens: `npm run golden:update` is deliberate; list the moved files in Completion Notes.

### Previous story intelligence (1.13, 1.14, 1.22, 1.23)

- `__PP__` and `TestHost` patterns (1.13): debug modules load in try/catch + `warn`; `state()` returns a copy; the review removed unused `TestHost` members — add only what is used.
- `SetTimeScale` writes `world.time.baseScale`, composed with slow-mos by `min` (1.14 D6); `TimeScaleChanged` fires on every effective change (1.14 D10).
- Every sim-touching story regenerated the six goldens' hash lines and bumped the snapshot (1.22, 1.23); new slices need a validator per field.
- Reviews keep catching: tautological e2e assertions, tests that pin live tunables or ids, « verified » claims never run, allocations/template strings in per-step paths, doc comments that disagree with the code (1.15, 1.16, 1.22, 1.23).
- Never edit files while the baseline CI runs (1.23).

### Git intelligence

- Recent history: 1.21 (silence, `ForceThreat`), 1.22 (Mama's note, Result screen, `boot.ts` +88), 1.23 (Firmness, `ResponseHeld`, `press.heldAt`). Branch `story/2-1-…`, cut from `516b463`.
- Commits: « Story 2.1 : Overlay de debug, timeline de timing et panneau de feeling », then the review fixes. Generated schemas and goldens go in the same commit as the code.

### Project Structure Notes

- Architecture L529 lists `overlay.ts`; this story names it `debugOverlay.ts` (D12). Everything else follows L528-531 and L560 (`tools/vite/feelWriterPlugin.ts`).
- The debug overlay is not a game overlay: the « overlays never stack » rule (DESIGN.md L477) does not apply; it sits above everything and leaves the game's overlays as they are.
- Debug labels are developer text in `src/debug`, not in `strings.fr.json` (the UI string scanner covers `src/client` only), so the debug strings never reach the store build's content.

### Project context rules (from `_bmad-output/project-context.md`)

- Live tuning goes through `SetFeel{patch, t}` (journaled), never by mutating `ctx.feel`.
- Static import of `src/debug/**` from client code is forbidden (it would ship debug to stores).
- Zero allocation in hot paths (rAF loop, `sim.step()`, systems, view `update`); the overlay's per-frame work is reading numbers, and DOM writes happen at the panel rate.
- Tool limits are constants in `shared/constants.ts`; game feel is data.
- `VITE_DEBUG_ALLOWED` trap: run `dev`, `e2e`, `ci` with `(unset VITE_DEBUG_ALLOWED; …)`.
- The shared machine may time out two CI runs at once: rerun with `--maxWorkers=5` / `--workers=4` and say so.

### Open points for Geo (tune or decide after playing)

- « Changer la graine » is in the architecture (L429) but not in the story's AC; it is included as a cheap cheat. Remove it if you do not want it.
- Keys with no upper bound in `FeelSchema` (e.g. `hitstopMs`, slow-mo `durationMs`, deferred-work L257) get a plain number field, not a slider; a typo such as `1e9` freezes the game until you fix it. Adding maxima to the schema is a separate change.
- A changed leaf that the level also overrides is saved into `feel.json` as you set it (you changed it on purpose); the panel shows a « level override » marker on those keys so you know.
- Overlay layout (corner, size, opacity) is a first pass: tell us what is in the way when you play on the phone.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] (L1222-1244); FR65 (L132); supplementary requirements (L180, L198); coverage (L331)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Contenu et feeling] (L263); #Outils de debug (L420-434); source tree (L528-531, L560); P5 latency (L787-806); P6 (L809-815); consistency rules (L927); Sim API and `__PP__` (L1031-1052); security (L1075); performance (L1098)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Fenêtres de timing] (L147-159)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] (L406); DESIGN.md (L477)
- [Source: _bmad-output/project-context.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] (L31, L95, L114, L133, L221, L257, L352, L398, L411)
- [Source: _bmad-output/implementation-artifacts/1-13-autoplay-et-api-de-test-dans-le-navigateur.md] (D16, L284); 1-14 (D6, D10); 1-3 (D2)

## Dev Agent Record

### Agent Model Used

### Implementation Plan

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-28: story created (gds-create-story).

### Review Findings
