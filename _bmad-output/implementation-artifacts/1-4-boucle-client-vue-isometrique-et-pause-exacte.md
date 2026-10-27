---
baseline_commit: 7dde7dc930d278a8e3d57216bdc7893f41de47c4
---

# Story 1.4: Client loop, isometric view and exact pause

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.4 « Boucle client, vue isométrique et pause exacte ». Epics, GDD and architecture are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see the world in a smooth isometric view, and the game to pause without losing anything,
so that I can be interrupted at any time.

**Requirements covered:** FR13 (landscape), FR14 (pause at any time, automatic when the app goes to the background, same instant after a 3 s countdown), NFR5 (exact resume). Foundation for ADR-002 (two clocks, fixed step) and the "Boucle de jeu et modèle de temps", "Correspondance des temps" (P5) and "Gestion des erreurs" sections of the architecture. It is the first story with a client: it creates the composition root.

## Acceptance Criteria

1. **Fixed-step loop.** Given `src/client/loop.ts` and a frame scheduler, when frames arrive, then each frame accumulates the real time elapsed multiplied by `sim.timeScale`, runs `sim.step()` while the accumulator holds at least `STEP_MS`, **at most `MAX_STEPS_PER_FRAME` (10) per frame**, and then renders with `alpha = accumulator / STEP_MS`.
   - And no step runs while `sim.freezeRealMs > 0`: the freeze is consumed in real time (`sim.consumeFreeze`), rendering goes on, and the sim time owed during the freeze is not lost.
   - And the events of the sim are drained after each step and handed to the client.
2. **Isometric render.** Given `src/client/render/` (`WebGLRenderer`, a fixed orthographic isometric camera, a provisional flat floor), when the window is resized, then the whole room stays visible in landscape and the pixel ratio is `min(devicePixelRatio, 2)`.
3. **Real → sim time map.** Given `src/client/timeMap.ts`, when a real timestamp within the last 2 s is converted, then it returns the interpolated sim time, slow-motion and freezes included (unit tests on constructed histories).
4. **Exact pause.** Given `src/client/app/pauseController.ts`, when the tab goes to the background (`visibilitychange`) or `requestPause()` is called (by the button and the keys of story 1.5), then no step runs and the client emits `PauseRequested` (the client systems that make sound or vibrations subscribe to it).
   - And at `requestResume()` a 3 s real-time countdown precedes the resume, and the game then goes on at the same sim time, to within 10 ms (proved by a test; the countdown display is story 1.5).
5. **Every resume counts down.** Given a resume after any pause (button, background, portrait, gamepad unplugged), when it happens, then it always goes through the 3 s countdown.
6. **Composition root (derived from the deferred work of stories 1.1 and 1.2, not in the epic text).** `src/client/boot.ts` assembles content, sim, renderer, loop and pause; `src/main.ts` only calls it; a global `error` / `unhandledrejection` hook logs through `log.error`; `InvariantViolated` events are logged as `warn`; the canvas CSS is mobile-safe (`dvh`, `touch-action`, `overscroll-behavior`).
7. **Quality gates.** `npm run ci` passes with the new unit and e2e tests; `tests/architecture/**` and `biome.json` are untouched; no new dependency (`three` is already pinned).

## Tasks / Subtasks

- [x] **T1: Shared primitives (AC 1, 3, 4, 5)**
  - [x] `src/shared/constants.ts`: add `MAX_STEPS_PER_FRAME = 10`, `RESUME_COUNTDOWN_MS = 3000`, `TIME_MAP_HISTORY_MS = 2000`, `TIME_MAP_CAPACITY = 1024`, `MAX_PIXEL_RATIO = 2`, and the camera constants of Dev Notes › Render (`ISO_YAW_DEG`, `ISO_PITCH_DEG`, `ISO_CAMERA_DISTANCE_M`, `ISO_FIT_MARGIN_PCT`, `PROVISIONAL_ROOM_WIDTH_M`, `PROVISIONAL_ROOM_DEPTH_M`, `PROVISIONAL_ROOM_HEIGHT_M`). One doc line each (these are technical constants, not GDD values; the provisional ones die with stories 1.6 and 1.7).
  - [x] `src/shared/emitter.ts`: `createEmitter<Events>()` where `Events` maps an event `type` to its payload. API in Dev Notes › Client events. Listeners run in subscription order; `on` returns an unsubscribe function; a listener that unsubscribes (itself or another) during an `emit` does not corrupt the iteration; an unknown `type` is a compile error. `shared` imports nothing else.
  - [x] `src/shared/emitter.test.ts`: order, payload, unsubscribe, unsubscribe during emit, no listener is fine, two emitters are independent.
- [x] **T2: `timeMap` (AC 3)**
  - [x] `src/client/timeMap.ts`: `createTimeMap(options?)` with `record`, `realToSim`, `reset`. Exact semantics, fixed-capacity typed-array ring (no allocation in `record`) and edge cases in Dev Notes › The time map.
  - [x] `src/client/timeMap.test.ts`: the table of Dev Notes (steady, slow-motion, freeze plateau, pause plateau, extrapolation with each rate, equal real timestamps, exactly 2 s back, older than the history → clamp + `warn`, empty history → `0` + `warn`, capacity overflow keeps the newest and stays monotone, decreasing real time throws). Import the constants; do not pin `2000` or `1024`.
- [x] **T3: Client events and pause (AC 4, 5)**
  - [x] `src/client/app/clientEvents.ts`: `ClientEvents` (`PauseRequested`, `ResumeRequested`, `GameResumed`) and `PauseReason`. Shapes in Dev Notes › Client events.
  - [x] `src/client/app/pauseController.ts`: `createPauseController({ events, countdownMs? })`. Contract in Dev Notes › Pause controller.
  - [x] `src/client/app/visibilityPause.ts`: `bindVisibilityPause(source, pause): () => void`, where `source` is the small structural type `{ readonly visibilityState: string; addEventListener(type: 'visibilitychange', listener: () => void): void; removeEventListener(...) }`. Hidden → `pause.requestPause('visibilityHidden')`; visible → nothing (see D3). Returns the unbind function.
  - [x] `src/client/app/globalErrorHandlers.ts`: `installGlobalErrorHandlers(target, logger = log): () => void`, structural `target` (`addEventListener` / `removeEventListener` for `error` and `unhandledrejection`). Both log through `log.error('boot', …, data)` with the message, file/line when present, or the rejection reason. No UI (the « Oups » screen is story 1.6).
  - [x] Tests: `pauseController.test.ts` (state table, event order, countdown measured in frames, cancel during the countdown, `requestResume` while running or already resuming is ignored, double pause emits once), `visibilityPause.test.ts` (hidden pauses, visible does nothing, unbind), `globalErrorHandlers.test.ts` (both listeners log at `error`, unbind removes them).
- [x] **T4: The loop (AC 1, 4, 5)**
  - [x] `src/client/loop.ts`: `createGameLoop(options)` returning `{ start(), stop(), stats }`. Per-frame algorithm, freeze rules, backlog drop and failure behaviour in Dev Notes › The loop. No allocation per frame (no closure, array or object literal in the frame callback; `stats` is one object mutated in place).
  - [x] `tests/support/fakeScheduler.ts`: `createFakeScheduler()` implementing `FrameScheduler` with `tick(frameAtReal)` that runs the pending callback once (and fails the test if none is pending), so tests choose every frame timestamp.
  - [x] `src/client/loop.test.ts` with a real `createSim` on `createTestContent()` (relative import of `../../tests/support/testContent.ts`): steps per frame at scale 1 and after a `SetTimeScale` of 0.3 (enqueued as a command, never by touching the world; 1 s of 10 ms frames gives 30 steps, ±1 for floating point); the 10-step cap, the dropped backlog and its `warn`; `alpha` range; freeze consumed in real time and a freeze requested by step *k* stopping step *k+1* in the same frame (`@sim` has no way to request a freeze, so drive it with a test double that wraps a real `Sim`, see Testing standards); events drained after each step; a throwing `sim.step()` stops the loop (no further frame requested) and the error propagates; `stop()` cancels the pending frame; a `NaN`, negative or decreasing frame timestamp counts as zero elapsed time and logs a `warn`.
  - [x] **Pause exactness test (AC 4)** in `loop.test.ts`, with two identical sims and loops. Loop A gets the running frames only. Loop B gets the same running frames up to frame *n*, then `requestPause('user')`, 30 s of real frames while paused (render keeps being called, no step runs, `sim.world.time.sim` unchanged), `requestResume()`, the countdown frames, and then its first running frame (zero elapsed time by design). Feed A a zero-elapsed frame at that point, then give both loops the **same frame spacing** for the remaining frames: `hashJson(world)` is equal, **exactly** (not "within 10 ms"). Also: during the whole pause + countdown `sim.step()` is called 0 times, and the first running frame after the countdown runs 0 steps (no catch-up).
- [x] **T5: Render (AC 2)**
  - [x] `src/client/render/renderer.ts`: `pixelRatioFor(devicePixelRatio)` (pure: `min(value, MAX_PIXEL_RATIO)`, and `1` for a non-finite or non-positive input, with no throw) and `createRenderer(canvas): Result<GameRenderer, AppError>`. Details in Dev Notes › Render. A failure to get a WebGL context returns `err({ kind: 'render', … })`, never throws.
  - [x] `src/client/render/isoCamera.ts`: `createIsoCamera()` and `fitIsoCamera(camera, room, aspect)`, pure maths on a `three` `OrthographicCamera` (no DOM, no WebGL, so Vitest/Node can test it).
  - [x] `src/client/render/materials/palette.ts`: the few 3D colours of the provisional scene, copied from the `DESIGN.md` frontmatter (`cream`, `ink`, `primary`) with a comment naming the token each one mirrors.
  - [x] `src/client/render/provisionalScene.ts`: `createProvisionalScene()` returning `{ scene, update(world, alpha) }`: a flat floor the size of the provisional room, a grid on it (depth cue and room extents), and one **probe cube** that slides back and forth along the floor as a function of the continuous sim clock (`world.time.sim + alpha * STEP_MS`). It exists so that a human or Playwright can *see* that the sim runs, pauses and resumes; it is deleted by story 1.7 (the file as a whole is replaced by `levelScene.ts` in 1.6). `MeshBasicMaterial` only: no lights, no toon yet.
  - [x] Tests: `renderer.test.ts` (`pixelRatioFor` table: 1, 1.5, 2, 3, 0, -1, NaN, Infinity), `isoCamera.test.ts` (for each aspect of `[1, 4/3, 16/9, 844/390, 21/9, 0.46]` the 8 corners of the room box project inside NDC `[-1, 1]` on both axes, and the fit is tight: on at least one axis the largest `|ndc|` is within 1 % of `1 - margin`, so the room is not needlessly small; the camera looks at the room centre; a non-finite or non-positive aspect throws via `invariant`).
- [x] **T6: Composition root and canvas CSS (AC 1, 2, 4, 6)**
  - [x] `src/client/boot.ts`: `boot(): Promise<void>`, the single composition root (Dev Notes › Composition root). `src/main.ts` becomes the CSS import plus `void boot()`.
  - [x] Move the temporary content wiring of `main.ts` into `boot.ts` without changing its behaviour: on a content error the dev content-error screen still appears and nothing else starts (`tests/e2e/contentError.spec.ts` must keep passing).
  - [x] `src/client/ui/styles/ui.css`: `#pp-canvas` gets `height: 100dvh` after the existing `100vh` line (fallback), `touch-action: none`; `html, body` get `overscroll-behavior: none`; add `user-select: none` and `-webkit-touch-callout: none` on `body`. No colours, no new classes.
  - [x] Provisional resume gesture and state attribute, both marked `// Provisional: story 1.5 replaces it with the pause panel` (see D3, D7).
- [x] **T7: End-to-end (AC 2, 4, 5)**
  - [x] `tests/e2e/boot.spec.ts`: keep the existing test; add: a WebGL context exists and is not lost (`canvas.getContext('webgl2')` returns non-null and `isContextLost()` is false), and the canvas backing store matches `round(cssSize * min(dpr, 2))` after a `page.setViewportSize` resize, and with `test.use({ deviceScaleFactor: 3 })` the ratio is capped at 2.
  - [x] `tests/e2e/pauseResume.spec.ts` (chromium + webkit) following Dev Notes › E2E script. No `waitForTimeout`: wait on conditions (`expect.poll`, attribute assertions, a bounded count of `requestAnimationFrame`s inside `page.evaluate`).
  - [x] If a project cannot create a WebGL context in CI (WebKit on Linux is the suspect), do **not** skip silently or weaken the chromium run: report it in the Completion Notes and `deferred-work.md` with the exact error, and keep the test active for the projects that can run it.
- [x] **T8: Docs and verification (AC 7)**
  - [x] `deferred-work.md`: add a "Resolved in story 1.4" note under the 1.1 items "Mobile canvas CSS" (`dvh`, `touch-action`, `overscroll-behavior` done; safe-area insets are the HUD's, story 1.5) and "Global error hook" (logging done; the player-facing « Oups » screen stays story 1.6), and under the 1.2 item "Player-facing fallback when content fails outside dev" ("story 1.6, with the « Oups » screen: the epic puts it there, not in 1.4"). Add the new deferred items listed in Dev Notes › Deferred by this story.
  - [x] `npm run ci` passes end to end (typecheck, lint, content:check, test:coverage, e2e chromium + webkit, build:playtest).
  - [x] Manual check in a real browser (the built-in browser pane or `npm run dev --host`): the floor and grid show in iso, the cube slides; switching to another tab and back leaves the cube still; one tap resumes after a visible 3 s with no catch-up jump; resizing the window never crops the room; portrait on a phone-sized viewport still shows the whole room. Say in the Completion Notes what was and was not checked on a real device.
  - [x] Temporarily break things to prove the guards bite, then restore: make `loop.ts` skip the `MAX_STEPS_PER_FRAME` cap (the cap test fails); make `requestResume()` skip the countdown (the pause test fails); import `three` from `src/shared/emitter.ts` (`layerBoundaries` and Biome fail).
  - [x] `git status`: only the files of the File List changed; `tests/architecture/**` and `biome.json` unchanged; nothing committed (the sprint workflow leaves that to Geo or the review).

## Dev Notes

### What exists today (stories 1.1 to 1.3, done)

- `src/main.ts` holds a **temporary** content wiring that says "story 1.4 moves it into client/boot.ts". It imports `./client/ui/styles/ui.css`, loads content through `createBrowserContentSource()` and `loadContent`, logs, and on a content error in dev dynamically imports `@client/app/contentErrorScreen` to show it in `#pp-ui`. Keep that behaviour.
- `index.html`: `<canvas id="pp-canvas">`, `<div id="pp-ui">`, viewport meta with `viewport-fit=cover`. `ui.css` has only `html, body` and `#pp-canvas` (`position: fixed; inset: 0; width: 100vw; height: 100vh`).
- `src/shared`: `constants.ts` (`STEP_MS`, `MIN_TIME_SCALE`…), `time.ts` (`SimMs`, `RealMs`, `asSimMs`, `asRealMs`), `result.ts` (`Result`, `ok`, `err`, `AppError`), `log.ts` (`log.<level>(channel, message, data?)`, channels `boot|assets|audio|input|render|feedback|storage|platform|debug|content|sim`; the ring buffer keeps `info`+; `log.buffer()` is how tests see a `warn`), `invariant.ts` (`invariant()` throws), `hash.ts` (`hashJson`).
- `@sim` exports `createSim`, `Sim`, `SimCommand`, `SimEvent`, `World`, `Journal`, `replayJournal`… `Sim` has `step()`, `drainEvents()` (returns a **reused** array, valid until the next call), `world` (a getter: a different object after `restore`, never cache it), `timeScale`, `freezeRealMs`, `consumeFreeze(realMs)`, `enqueue(cmd)`. `createSim` is async. The only command is `SetTimeScale { t, scale }`; the only events are `TimeScaleChanged` and `InvariantViolated`. There is no gameplay, no entity and no way to request a freeze from outside the sim yet (story 1.14 adds the first hitstop).
- `src/client/` holds `app/contentErrorScreen.{ts,css}`, `assets/browserContentSource.ts`, `ui/styles/ui.css`. `src/platform/` is empty (`.gitkeep`): **`Platform` does not exist yet**, so there is no `lifecycle` to use (D11).
- `tests/support/testContent.ts` gives `createTestContent()` and `stepN(sim, n)`; `tests/e2e/{boot,contentError}.spec.ts` exist; Playwright runs chromium and webkit at 844 × 390 with touch; the dev server (`.env.development`) has `VITE_DEBUG_ALLOWED=true`.
- Biome already has an `src/client/**` override (no `@sim/**`, `@debug/**`, `@bots/**`, `@dimforge/**`) and a `src/client/boot.ts` override that lifts the `@debug` / `@bots` bans (the dynamic-import slot). `three` is allowed in `client`. `requestAnimationFrame`, `performance` and `window` are allowed in `client` (the purity globals apply to `src/sim` only).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | `timeMap` is fed **once per frame**, with the *continuous* sim clock `world.time.sim + accumulator` and a forward rate, not once per step. | The architecture says "updated at each step", but the steps of a frame all run at one real instant, so per-step records would share a timestamp and carry no extra information; at `timeScale` 0.3 most frames run no step at all. The continuous clock is smooth, monotone and is what the player sees. Same data, honest granularity. |
| D2 | The pause stops stepping, **rendering goes on**. The countdown is driven by the frame timestamps (`pause.update(frameAtReal)` each frame), not by `setTimeout`. The accumulator is kept across a pause. Countdown length is the constant `RESUME_COUNTDOWN_MS` (3000) in `shared/constants.ts`. | Deterministic and testable with a fake scheduler; keeping the accumulator makes a paused-and-resumed run *identical* to an uninterrupted one that gets the same running frames (the first running frame after a resume measures no elapsed time). The countdown is a UX structure ("3", "2", "1" digits, one per second), not a feel value; if Geo wants to tune it, it moves to `feel.json` later. |
| D3 | Returning to the foreground does **not** resume. Until story 1.5 ships the pause panel, a `pointerdown` anywhere while the state is `paused` calls `requestResume()` (provisional, marked as such). | Otherwise switching tabs would pause the game forever with nothing to click. Story 1.5 removes the gesture and opens the panel instead. |
| D4 | A frame that throws is **fail-stop**: the next frame is requested at the *end* of a successful frame, so an exception ends the loop and reaches the global error hook (`log.error`). No `try/catch`, no retry. | Avoids one error per frame flooding the log. Story 1.6 turns the hook into the « Oups » screen and a level restart. |
| D5 | The scene is a provisional flat floor + grid + a **probe cube** driven by the sim clock. | With no entity yet there is nothing to show that the loop, the interpolation and the pause work. The cube is the visible heartbeat for Geo and for Playwright. Removed in 1.7. |
| D6 | Camera angles and the provisional room size are named constants in `shared/constants.ts`, not in `feel.json`. | The `Feel` schema has no camera section (`cameraFx` and its tunables arrive with story 2.5). Moving them later is a one-line change; do not extend `FeelSchema` here. |
| D7 | `document.documentElement.dataset.ppState` mirrors the pause state (`running` / `paused` / `resuming`) **only when `import.meta.env.VITE_DEBUG_ALLOWED === 'true'`**. No `window.__PP__`. | Playwright needs something observable; `window.__PP__` belongs to story 1.13 and must not appear before it. A data attribute written on rare transitions costs nothing and is stripped from store builds by the flag. |
| D8 | Sim events are drained **after each step** and passed to one `onSimEvent` handler built at boot: `InvariantViolated` → `log.warn('sim', …)`; every other event → `log.debug` behind `log.enabled('debug')`. | Matches the architecture and the 1.3 note ("the client logs `InvariantViolated` as `warn`"). Story 1.9 replaces the debug branch with the `FeedbackDirector`. |
| D9 | The sim seed comes from `crypto.getRandomValues(new Uint32Array(1))` and is logged at `info`. No `?seed=` parsing. | The client may use randomness, the sim may not. `?seed=` and `?autoplay=` are story 1.13. A logged seed makes any run reproducible by hand. |
| D10 | No adaptive DPR. `min(devicePixelRatio, 2)` is re-read at every resize. | The 2 → 1.5 → 1 stepping on frame time belongs to the performance budget (story 1.24). |
| D11 | Foreground / background comes from `document` `visibilitychange` in the client. `Platform.lifecycle` is not created here. | The epic names `visibilitychange`; `src/platform/` does not exist yet. Capacitor's app-state event arrives with E8 behind `Platform`. |
| D12 | No `Emitter` import in `src/sim` is enforced by convention and a deferred guardrail (below), not by a new Biome/scanner rule in this story. | A rule would touch both sim Biome overrides, the scanner, a fixture and two test files for a risk that is hypothetical today. |

### The loop (`src/client/loop.ts`)

```ts
export interface FrameScheduler {
  request(callback: (frameAtReal: number) => void): number;
  cancel(handle: number): void;
}
export interface GameLoopOptions {
  readonly sim: Sim;
  readonly timeMap: TimeMap;
  readonly pause: PauseController;
  readonly scheduler?: FrameScheduler;               // default: requestAnimationFrame / cancelAnimationFrame
  render(alpha: number): void;                        // called every frame, paused or not
  onSimEvent(event: SimEvent): void;                  // called synchronously; do not keep the event
}
export interface LoopStats { stepsLastFrame: number; droppedBacklogMs: number; frames: number }
export interface GameLoop { start(): void; stop(): void; readonly stats: LoopStats }
```

Frame algorithm (`frameAtReal` is the rAF timestamp, the same timeline as `performance.now()` and `event.timeStamp`; brand it with `asRealMs` for `timeMap` and `pause`):

1. `pause.update(frameAtReal)`.
2. If `pause.state !== 'running'`: remember "not running" (so the next running frame measures no elapsed time), record the map point (rate 0), `render(alpha)` with the current alpha, request the next frame, return. **No freeze consumption, no step.**
3. `dtReal = frameAtReal - lastFrameAtReal` where `lastFrameAtReal` is the previous frame **if it also ran in `running`**; otherwise `0` (this is what prevents a catch-up burst after a resume, a first frame, or a tab that was hidden). A negative or non-finite `dtReal` counts as `0` and logs a `warn` (rare, so allowed on a hot path).
4. Freeze: `consumed = min(dtReal, sim.freezeRealMs)`; `sim.consumeFreeze(consumed)`; `dtReal -= consumed`.
5. `accumulatorMs += dtReal * sim.timeScale` (the accumulator is in **sim** ms; read `timeScale` once per frame).
6. `while (accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_FRAME && sim.freezeRealMs === 0)`: `sim.step()`, `accumulatorMs -= STEP_MS`, `steps++`, then drain the events and call `onSimEvent` for each. The freeze test runs **before every step**, so a hitstop requested by step *k* (judgement) stops step *k+1* of the same frame; the sim time still owed stays in the accumulator and is spent after the freeze.
7. Backlog: if the loop stopped because of the cap (`steps === MAX_STEPS_PER_FRAME` and `accumulatorMs >= STEP_MS`), drop whole steps: `droppedMs = accumulatorMs - accumulatorMs % STEP_MS`, `accumulatorMs %= STEP_MS`, add to `stats.droppedBacklogMs`, and log a `warn` at most once per real second. Never drop because of a freeze.
8. `alpha = accumulatorMs / STEP_MS` (in `[0, 1)`). `timeMap.record(frameAtReal, sim.world.time.sim + accumulatorMs, rate)` with `rate = sim.freezeRealMs > 0 ? 0 : sim.timeScale` (read `sim.world` fresh, it changes identity on `restore`).
9. `render(alpha)`, then request the next frame. Frame ends.

- `start()` requests the first frame; `stop()` cancels the pending one; both are idempotent. Reset `lastFrameAtReal` on `start()`.
- **Zero allocation per frame** (project-context): the callback is created once in `createGameLoop`, `stats` is one object, no spread, no array.
- The interpolation lag of the render (it shows the state ≤ one step behind the continuous clock) is a constant offset the latency calibration (story 2.7) absorbs. Do not "fix" it.
- Entity views will need the previous and current state to interpolate; that is `render/interpolate.ts` with the first moving entity (story 1.7). Here `alpha` only feeds the probe cube.

### The time map (`src/client/timeMap.ts`)

```ts
export interface TimeMap {
  /** At `realMs` the continuous sim clock read `simMs`; from there on it advances `simPerRealMs` sim ms per real ms (timeScale; 0 when frozen or paused). */
  record(realMs: RealMs, simMs: SimMs, simPerRealMs: number): void;
  /** Sim time at `realMs`. Inside the history: linear interpolation between the two surrounding records. After the newest: extrapolated at the newest record's rate. Before the oldest kept record: the oldest sim time, with a `warn`. */
  realToSim(realMs: RealMs): SimMs;
  reset(): void;
}
export function createTimeMap(options?: { logger?: Pick<Logger, 'warn'> }): TimeMap;   // default: `log`
```

- Storage: three preallocated `Float64Array`s of `TIME_MAP_CAPACITY` (real, sim, rate) used as a ring. `record` first drops records older than `realMs - TIME_MAP_HISTORY_MS`, then appends; when the ring is full the oldest is overwritten. No allocation in `record`.
- `record` validates with `invariant`: finite numbers, `realMs >= ` the previous real, `simMs >= ` the previous sim, `simPerRealMs >= 0`.
- Equal real timestamps are allowed (the later record wins at that exact instant). `realToSim` of exactly `newest.real - TIME_MAP_HISTORY_MS` is inside the history.
- `realToSim` is for rare calls (an input), so a linear scan from the newest record is fine; it must not allocate. Empty history → `asSimMs(0)` with a `warn` (the loop has not run a frame yet). The `warn` goes to channel `input`.
- The loop records **every** frame, paused or not, so a pause is just a flat segment and a freeze a short flat segment: there is no special case in `timeMap`. A press timestamp *later* than the newest record (an event that arrived between two frames) is extrapolated at the newest rate, which is `0` while paused or frozen.
- Constructed histories to test (all in real ms → sim ms):

| History (real, sim, rate) | Query | Expected |
|---|---|---|
| (0, 0, 1) (100, 100, 1) (200, 200, 1) | 150 | 150 |
| (0, 0, .3) (100, 30, .3) (200, 60, .3) | 150 | 45 |
| (0, 0, 1) (100, 100, 0) (250, 100, 0) (300, 150, 1) | 120 | 100 |
| same | 275 | 125 |
| (0, 0, 1) (100, 100, 0) (1100, 100, 0) (1110, 100, 1) (1200, 190, 1) (a 1 s pause) | 600 | 100 |
| (300, 160, .3) is the newest | 400 | 190 |
| (300, 160, 0) is the newest | 400 | 160 |
| two records at real 100 with sims 100 and 100 | 100 | 100 |

### Pause controller (`src/client/app/pauseController.ts`)

```ts
export type PauseState = 'running' | 'paused' | 'resuming';
export interface PauseController {
  readonly state: PauseState;
  readonly countdownRemainingMs: number;              // 0 unless 'resuming'; story 1.5 draws "3" "2" "1" from it
  requestPause(reason: PauseReason): void;
  requestResume(): void;
  update(frameAtReal: RealMs): void;                  // called once per frame by the loop
}
export function createPauseController(options: {
  events: Emitter<ClientEvents>;
  countdownMs?: number;                               // default RESUME_COUNTDOWN_MS
}): PauseController;
```

- Initial state `running`. `requestPause`: from `running` or `resuming` → `paused` (a countdown in progress is cancelled and will restart at full length) and emit `PauseRequested { reason }`; already `paused` → nothing. `requestResume`: only from `paused` → `resuming` and emit `ResumeRequested`; otherwise ignored (no event, `log.debug`).
- The countdown starts at the **first `update` after `requestResume`** (it records that frame's timestamp as its start) and runs `countdownMs` of frame time; the `update` that reaches it sets `running` and emits `GameResumed` once. `countdownRemainingMs` is `max(0, countdownMs - (lastUpdate - start))`.
- `PauseRequested` and `GameResumed` are what story 1.9 uses to suspend and resume the `AudioContext`; keep the names exactly.
- Every path to `running` goes through `resuming` (AC 5): there is no `forceResume`. A test pins that a controller that is `paused` can only reach `running` via `requestResume` plus at least `countdownMs` of frames.
- The controller never touches the sim; the loop reads `pause.state`.
- Boot at `document.visibilityState === 'hidden'` (a tab opened in the background) starts the controller paused: call `requestPause('visibilityHidden')` right after construction when hidden.

### Client events (`src/shared/emitter.ts`, `src/client/app/clientEvents.ts`)

```ts
// shared/emitter.ts: `Events` is an object type mapping a PascalCase name to its payload type.
export interface Emitter<Events extends object> {
  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}
export function createEmitter<Events extends object>(): Emitter<Events>;

// client/app/clientEvents.ts
export type PauseReason = 'visibilityHidden' | 'user' | 'portrait' | 'gamepadDisconnected';
export interface ClientEvents {
  PauseRequested: { reason: PauseReason };
  ResumeRequested: Record<string, never>;
  GameResumed: Record<string, never>;
}
```

- Names are PascalCase past tense with the subject first, as for sim events. Use `Record<string, never>` (or an empty `{}`-free equivalent that Biome accepts) for payload-less events. `SettingsChanged` and `CalibrationDone` (architecture) are added by the stories that emit them.
- **The emitter is client-only**: never import `@shared/emitter` from `src/sim`.

### Render (`src/client/render/`)

- **Constants** (all in `shared/constants.ts`, all provisional where noted): `ISO_YAW_DEG = 45`, `ISO_PITCH_DEG = 35.264` (true isometric, `atan(1/√2)`), `ISO_CAMERA_DISTANCE_M = 40` (far enough that near/far planes never clip the room), `ISO_FIT_MARGIN_PCT = 4` (breathing room around the room), `PROVISIONAL_ROOM_WIDTH_M = 8`, `PROVISIONAL_ROOM_DEPTH_M = 6`, `PROVISIONAL_ROOM_HEIGHT_M = 2.5`. The real room comes from `<level>.geometry.json` in story 1.6; `fitIsoCamera` takes a `room` size so that story passes the real bounds without touching the maths.
- **`fitIsoCamera(camera, room, aspect)`**: place the camera on the iso direction at `ISO_CAMERA_DISTANCE_M` from the room centre, looking at the centre; project the 8 corners of the room box (floor rectangle at y = 0 and the same rectangle at `room.heightM`) into the camera's view space; take the bounding rectangle of the projected points, grow it by `ISO_FIT_MARGIN_PCT`, then widen **one** axis so that `width / height === aspect`; set `left/right/top/bottom` and `updateProjectionMatrix()`. This is what keeps the room visible at every aspect, including portrait (story 1.5 covers portrait with an overlay anyway).
- **`createRenderer(canvas)`**: `new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })`; sizes from `canvas.clientWidth / clientHeight` with `setSize(w, h, false)` (CSS owns the canvas size) and `setPixelRatio(pixelRatioFor(window.devicePixelRatio))`; `resize()` re-reads both. Observe the canvas with a `ResizeObserver` (and listen to `window` `resize` as a fallback) from boot, calling `resize()` and `fitIsoCamera` with the new aspect. Do **not** set `preserveDrawingBuffer`.
- **Context loss**: listen to `webglcontextlost` (call `preventDefault()`, `log.warn('render', …)`) and `webglcontextrestored` (`log.warn('render', …)`; three rebuilds its resources and the next frame redraws). No silent handling.
- `three@0.186.1` only; import named classes (`WebGLRenderer`, `OrthographicCamera`, `Scene`, `Mesh`, `PlaneGeometry`, `BoxGeometry`, `GridHelper`, `MeshBasicMaterial`, `Color`…) so the bundle tree-shakes. Colour management and `SRGBColorSpace` output are three's defaults: pass the `DESIGN.md` hex values as they are. No post-processing, no shadow maps, no WebGPU.
- Provisional scene numbers (probe size, path half-length, period) are named local constants in `provisionalScene.ts`, commented "provisional, removed with story 1.7": they are visual scaffolding, not game rules.

### Composition root (`src/client/boot.ts`)

The only place that wires things together (no singletons except `log`). In order:

1. `installGlobalErrorHandlers(window)` first, so that nothing below can fail unseen.
2. `loadContent(createBrowserContentSource())`; on error keep the current behaviour (log; in dev show `contentErrorScreen`; stop).
3. Seed (D9), `await createSim({ content, seed })`, `log.info('boot', 'sim ready', { seed })`.
4. `createRenderer(canvas)`; on `err` → `log.error('render', …)` and stop (the player-facing fallback is story 1.6).
5. Camera, provisional scene, first `resize()`.
6. `events = createEmitter<ClientEvents>()`, `pause = createPauseController({ events })`, `bindVisibilityPause(document, pause)`, pause immediately if the document is hidden.
7. `timeMap = createTimeMap()`, `createGameLoop({ sim, timeMap, pause, render, onSimEvent })` with `render = (alpha) => { scene.update(sim.world, alpha); renderer.render(…) }` built once, then `loop.start()`.
8. Provisional resume gesture (D3) and, behind `VITE_DEBUG_ALLOWED`, the `data-pp-state` mirror (D7): subscribe to the three client events and write `documentElement.dataset.ppState` from `pause.state` after each.
9. `log.info('boot', 'game running')`.

- Nothing here is unit-tested directly (it is wiring); the e2e specs cover it. Keep the logic in the small modules above so that `boot.ts` stays a list of calls.
- Do not add `window.__PP__`, `?autoplay`, `?debug`, `?seed`, the feel panel or any `src/debug` / `src/bots` import: later stories.

### E2E script (`tests/e2e/pauseResume.spec.ts`)

1. `goto('/')`; wait for `html[data-pp-state="running"]`.
2. Screenshot the canvas; `expect.poll` a fresh canvas screenshot until it differs from the first (the cube moves, proving the loop steps and the renderer draws).
3. In `page.evaluate`, override `document.visibilityState` to `'hidden'` (`Object.defineProperty`, configurable) and dispatch `visibilitychange`. Expect `data-pp-state="paused"`.
4. Take two canvas screenshots separated by a bounded number of `requestAnimationFrame`s awaited inside `page.evaluate` (not a timeout): they are byte-identical.
5. Restore `'visible'` and dispatch the event: the state is still `paused` (D3).
6. Click the canvas: expect `resuming`; install a `MutationObserver` (or poll) to measure with `performance.now()` the time until `running`; expect it at least `RESUME_COUNTDOWN_MS` minus one frame of slack, and at most that plus a generous margin. Import the constant from `../../src/shared/constants.ts`; do not write `3000`.
7. Poll until the canvas changes again (the sim runs after the resume).

### Architecture guardrails and traps (read before coding)

- **Layers:** `src/client` may import `@sim` (public API only), `@content/*`, `@shared/*`, `three`. It must not import `src/sim/...`, `@debug`, `@bots`, `@dimforge`. `src/shared` imports nothing from other layers (the emitter and constants are plain TypeScript). Nothing imports `src/main.ts`. Cross-layer imports use aliases without extension (`@shared/log`); inside `src/client` use relative paths with `.ts`. `import type` for types (`verbatimModuleSyntax`).
- **No `console.*`** anywhere (`log` only). **No silent catch.** No `enum`, `namespace` or constructor parameter properties.
- **Time:** real instants are `RealMs` (`asRealMs`), sim instants `SimMs`; names carry unit suffixes (`frameAtReal`, `dtRealMs`, `accumulatorMs`, `countdownMs`). A bare `time` or `delta` is a review failure. Never judge or schedule sim logic from real time; the client only feeds the sim via `step()` and (later) commands.
- **Never mutate `sim.world`** from the client; read it. Never cache `sim.world` across frames.
- **Never pause with `timeScale = 0`**; never change the step size; never run steps during a freeze or a pause.
- **No GDD value in code.** The countdown, the 10-step cap, the 2 s history and the 2× pixel ratio are architecture constants (named, in `shared/constants.ts`). Tests import them instead of repeating the number.
- **Hot path:** the frame callback, `timeMap.record` and `provisionalScene.update` allocate nothing. `realToSim` and the event handlers may allocate (rare). Logging inside the frame stays at `debug` behind `log.enabled('debug')`, except the rate-limited backlog `warn` and the anomaly `warn`s named above.
- **Vitest runs in Node**: no DOM in client unit tests. Everything unit-tested takes its environment by parameter (scheduler, event source, `target`). `three` itself loads fine in Node (no WebGL is created in the tests of `isoCamera`).
- **Input is not wired yet.** No pointer, keyboard or gamepad handling beyond the provisional resume gesture. `timeMap.realToSim` has no caller until story 1.7/1.11.

### Technical notes

- **Stack as pinned:** `three@0.186.1`, `vite@8.3.5` (Oxc transpiles; `tsc` is typecheck only), `vitest@5.0.5`, `@playwright/test@1.64.1`, `typescript@7.0.2`. Add no dependency.
- **`import.meta.env.VITE_DEBUG_ALLOWED`** is a string (`'true'` / `'false'`); compare with `=== 'true'`, as `shared/log.ts` does. It is not typed in a `vite-env.d.ts` today: if `tsc` rejects the access in `src/client`, add the smallest `ImportMetaEnv` augmentation (one `src/vite-env.d.ts` declaring `readonly VITE_DEBUG_ALLOWED?: string`), nothing more.
- **rAF timestamps** share the `performance.now()` / `event.timeStamp` timebase, which is why the loop uses the callback argument and never reads a clock of its own.
- **Visibility:** `document.visibilityState` is the source of truth; `visibilitychange` fires when a tab is switched, the window minimised, or (iOS) the app backgrounded. `rAF` stops in hidden tabs, which is why the pause is requested from the event, not from a missing frame.
- **Playwright and visibility:** headless browsers do not hide pages on demand; override `document.visibilityState` and dispatch the event, as in the script.
- **Biome 2.6** formats imports and sorts them; run `npm run format` after writing files.

### Testing standards

- Unit tests colocated (`loop.test.ts`, `timeMap.test.ts`, `pauseController.test.ts`, `isoCamera.test.ts`…); shared fixtures in `tests/support/`; e2e in `tests/e2e/`. `describe/it/expect` from `vitest`.
- **Every test must exercise what its name claims** (the reviews of 1.1, 1.2 and 1.3 each found tests that did not): the pause test must run frames *while paused* and compare world hashes against an uninterrupted twin; the freeze test must have a freeze actually pending; the cap test must feed a stall long enough to need more than 10 steps.
- **Driving a freeze:** `@sim` exposes no way to request a freeze, and the loop test must not reach into sim internals. Wrap a real `Sim` in a small test double (`{ ...sim, get freezeRealMs() {…}, consumeFreeze() {…} }` implementing the `Sim` interface, with a settable freeze and a `step` that sets it on the *k*-th call). Keep the double in the test file.
- **Express time in frames and sim steps**, not sleeps: a loop test is a list of explicit `frameAtReal` values. Use `STEP_MS`, `MAX_STEPS_PER_FRAME`, `RESUME_COUNTDOWN_MS` from `@shared/constants`; the only literals are the scale passed to `SetTimeScale` and the constructed `timeMap` histories.
- Validate inputs the way story 1.3's review taught: a `NaN`/negative frame delta, a decreasing timestamp, a bad aspect ratio, a non-finite device pixel ratio each have a test.
- `src/client` is not covered by the 90 % gate (only `src/sim` is), but untested logic is still a review finding; `boot.ts` is the one file allowed to be covered only by e2e.

### Project Structure Notes

- New files follow the architecture tree: `src/client/{boot,loop,timeMap}.ts`, `src/client/app/{pauseController,clientEvents,visibilityPause,globalErrorHandlers}.ts`, `src/client/render/{renderer,isoCamera}.ts`, `src/client/render/materials/palette.ts`, `src/shared/emitter.ts`, `tests/e2e/pauseResume.spec.ts`.
- Additions to the documented tree (same layers, no new top-level folder): `src/client/render/provisionalScene.ts` (temporary; replaced by `levelScene.ts` in 1.6), `src/client/app/{visibilityPause,globalErrorHandlers,clientEvents}.ts`, `tests/support/fakeScheduler.ts`.
- `src/main.ts` stays the browser entry and shrinks to the CSS import and `void boot()`.

### Previous story intelligence (1.1 to 1.3)

- Reviews found the same defect classes every time: **unvalidated inputs** (a `NaN` buffer size, a missing `t`), **aliasing** (returning internal objects: `drainEvents()` returns a reused array, so the loop must not keep it), **tests that do not exercise their claim**, **tunable or magic values pinned in tests**, **planned end-to-end checks replaced by weaker ones**. This story's input guards, constants-in-tests rule, fake-scheduler frame lists and full e2e script answer them.
- The sim API is final for this story: `step()` never refuses because of a freeze (the **loop** is what honours it), `consumeFreeze` ignores non-positive and `NaN` durations, `world` changes identity after `restore`, `drainEvents()` must be consumed regularly.
- The scanners are strict and hand-written: run `npm test` and `npm run lint` after the first client file, not at the end.
- 1.3 deferred items that touch this story and stay deferred: the effective feel in `World` (2.1), the slow-mo duration unit and the freeze overlap rule (1.14), invariant strictness following the build (3.3). The loop reads `sim.timeScale` and `sim.freezeRealMs` and nothing else about them.
- Commit style so far: one implementation commit and one review-fix commit per story, short French title (`Story 1.4 : …`) with the `Co-Authored-By` line. The dev workflow leaves changes uncommitted.

### Git intelligence

- `14e370b` / `7dde7dc` Story 1.3 (sim core and its review fixes), `b44451b` / `15312b9` Story 1.2 (content), `625a94b` Story 1.1. Tests that need real files or cross-layer fixtures live in `tests/`; pure helpers are colocated. Dependencies are exact-pinned. No dependency is added by this story.

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests the systems, Geo plays and tunes the feel; anything tweakable is data; everything stays playable without a human. The probe cube and the `data-pp-state` attribute are what let an agent (and Geo) see the loop work before any gameplay exists.
- **Loop and time:** fixed `STEP_MS = 10`, rAF + accumulator, max 10 steps per frame, render interpolated with `alpha`; `timeScale` changes the number of steps per real second, never the step; hitstop is a real-time freeze the loop consumes while rendering goes on; pause = the loop stops stepping, resume after a 3 s real-time countdown, never `timeScale = 0`.
- **Time map:** a 2 s ring of `(realTime, simTime)` pairs; older timestamps clamp with a `warn`.
- **Client rules:** `client/boot.ts` is the single composition root, dependencies injected explicitly; vanilla DOM + CSS with `pp-` classes (none added here); `MeshToonMaterial` and outlines come later; DPR `min(devicePixelRatio, 2)`; landscape only (the portrait overlay is story 1.5).
- **Errors and logs:** `Result` for I/O-like boundaries (renderer creation), `invariant` for programmer errors, no silent failure, `log.<level>(channel, message, data?)`, nothing above `debug` in hot paths, no `console.*`.
- **Performance:** frame ≤ 16.6 ms, zero allocation in the rAF loop and `sim.step()`, input handlers do almost nothing (none yet).
- **Testing:** Vitest in Node, e2e on chromium + webkit at a landscape phone viewport, no `waitForTimeout` to let the game play, architecture tests are guardrails.
- **Stack pinned:** no ESLint/Prettier/React/ECS/state libs, no Capacitor before E8.
- **When docs disagree:** game rules follow the GDD, technical mechanics the architecture; if still ambiguous, ask Geo.

### Deferred by this story

- **Adaptive DPR** (2 → 1.5 → 1 on mean frame time): story 1.24.
- **Interpolation of entity views** (`render/interpolate.ts`, previous/current state): story 1.7, with the first moving entity.
- **`Platform.lifecycle`** replacing the direct `visibilitychange` listener, and Capacitor's app-state event: when `src/platform` is created and in E8.
- **Forbid `@shared/emitter` in `src/sim`** with a Biome pattern and a scanner rule (like R3b for `@shared/log`): add if a second client-only shared module appears.
- **The « Oups » screen**, the player-facing fallback for a renderer or content failure, and restarting the level after an uncaught error: story 1.6.

### Out of scope (belongs to other stories)

- Start screen, HUD, pause panel and its keys, countdown display, tokens, strings, portrait overlay (1.5). Level loading, `.glb`, loading screen, « Oups » (1.6). Papa, input, hit-testing, `InputMapper` (1.7, 1.11). Audio, haptics, `FeedbackDirector` (1.9). Bots, `npm run sim` (1.12). `window.__PP__`, `?autoplay`, `?seed` (1.13). Hitstop and slow-motion decisions (1.14). Debug overlay and feel panel (2.1). Calibration (2.7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4 : Boucle client, vue isométrique et pause exacte]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences supplémentaires (architecture) › Simulation et temps; Présentation]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] (consumers of `requestPause` / `requestResume` and the countdown), [#Story 1.6] (« Oups », global handler, `levelScene`), [#Story 1.9] (`PauseRequested` → `AudioContext`), [#Story 1.14] (freeze rules), [#Story 1.24] (adaptive DPR, perf test)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Boucle de jeu et modèle de temps], [#Chaîne d'entrées], [#Modèle d'état], [#Gestion des erreurs], [#Logs], [#Système d'événements], [#Configuration]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#P3 — Jugement à l'appui, chorégraphie ensuite], [#P5 — Calibration et correspondance des temps] (the `timeMap` contract)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Arborescence] (`src/client/`, `src/shared/emitter.ts`) and [#Frontières d'architecture], [#Performances]
- [Source: _bmad-output/project-context.md] (Engine-Specific Rules › Simulation core, Time & input judgement; Performance Rules; Platform & Build Rules; Critical Don't-Miss Rules)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] (frontmatter colours `cream`, `ink`, `primary` for the provisional 3D palette)
- [Source: _bmad-output/implementation-artifacts/1-3-coeur-de-simulation-deterministe-en-headless.md] (sim API, review findings) and [deferred-work.md] (mobile canvas CSS, global error hook, content fallback)

### Open points for Geo (do not block the dev)

1. D1: the `timeMap` is fed per frame with the continuous sim clock, not per step as the architecture sentence says. Same information, no duplicate timestamps.
2. D2: the 3 s countdown is a constant, not a `feel.json` key. Say so if you want to tune it.
3. D3: until the pause panel exists (1.5), a tap anywhere resumes after a background pause.
4. D6: true isometric (45° / 35.264°) and an 8 × 6 × 2.5 m provisional room. The real angle and room are your call once you see the salon (1.6).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), via the `gds-dev-story` workflow.

### Debug Log References

- Red phase first for T1 to T5: each test file was run before its module existed (`Cannot find package` / missing module), then went green once implemented.
- `loop.test.ts` first run: the `createRig` helper spread the `createSimDouble` object, which froze its getters (`stepCalls`, `freezeRealMs`) at their initial value. Replaced by explicit getters. Also, the freeze test expected `[0, 0, 0, 1, 1]` steps but the owed 4 ms makes the last frame run 2 steps: fixed the expectation, not the loop.
- Loop bug found by the "render calls `stop()`" test: with a single `isPending` flag, a `stop()` made from inside the frame did nothing and the frame then requested the next one. Split into `isRunning` (between `start()` and `stop()`) and `isPending`.
- `isoCamera` tests, `provisionalScene` test and the first `boot.spec.ts` resize test were wrong in my first draft (a probe test compared two different clocks; the resize `poll` returned the *expected* backing-store size instead of the canvas's). Fixed before the run counted.
- Biome: `fit()` in `boot.ts` is read as a focused test (`noFocusedTests`, false positive): renamed `fitViewToCanvas`. `height: 100vh; height: 100dvh` is flagged `noDuplicateProperties`: the `dvh` rule moved into an `@supports (height: 100dvh)` block (same behaviour, rule not weakened, `biome.json` untouched).
- Guards proved by breaking things and restoring (files compared with a backup afterwards): without the cap, 3 `loop.test.ts` tests fail; with `requestResume()` skipping the countdown, 10 tests fail (8 in `pauseController.test.ts`, 2 in `loop.test.ts`); `import 'three'` in `src/shared/emitter.ts` fails `layerBoundaries` ("the repository respects every rule") and Biome (`Layer boundary`).
- Manual check in the built-in browser pane (dev server on a temporary port, with a temporary `.claude/launch.json`, deleted afterwards).

### Completion Notes List

- **All 8 tasks done, all 7 ACs met.** `npm run ci` passes end to end: typecheck, lint, content:check, 539 unit/golden/architecture tests (`src/sim` coverage 100 % lines / 92.5 % branches, threshold 90 %), 14 e2e on chromium + webkit, `build:playtest`.
- **New tests:** 57 for T1 to T3, 27 for the loop (incl. the exactness twin test: `hashJson(world)` equal, not "within 10 ms", after a 30 s pause + 3 s countdown), 61 for the render modules; e2e: WebGL context alive, backing store = `round(css × min(dpr, 2))` through three resizes (one portrait) and capped at 2 on a 3x screen, and the full background → stay paused → tap → 3 s countdown → moves again script.
- **Choices inside the spec (all small, all documented in code):**
  - `alpha` is clamped to `[0, 1]`, not `[0, 1)`: it is exactly 1 only while a hitstop holds back whole owed steps, and the view must not extrapolate past the last step.
  - `timeMap` keeps one record just before the 2 s window, so that the exact start of the window can be interpolated (an AC 3 test: "exactly 2 s back"). A query before the window start is clamped to that start, with a `warn` on channel `input`.
  - The loop clamps the continuous clock it records to be non-decreasing (one-ulp float noise must not trip `timeMap`'s invariant). It also keeps the pause and the time map on a monotone clock when a frame timestamp is `NaN` or goes back (zero elapsed time, one `warn` per real second on channel `sim`).
  - A frame that arrives while the backlog hit the cap logs one `warn` per real second (`frame stall: dropped N ms of sim backlog`); the backlog is dropped in whole steps and the sub-step remainder is kept.
  - `bindVisibilityPause` also pauses at bind time when the page is already hidden (Dev Notes put that call in `boot.ts`): same behaviour, but it is now unit-tested.
  - `createRenderer` is the one `try/catch` of the story: `new WebGLRenderer` throws when there is no context, and the boundary must return `err({ kind: 'render' })`. It is not silent: `boot()` logs the error.
  - The provisional grid is a `LineSegments` made for the 8 × 6 m room (three's `GridHelper` is square); the scene background is the `ink` token so the floor stands out. `provisionalScene.test.ts` is an extra test file for the probe maths.
  - The room is assumed centred on the origin (documented in `RoomSize`; recorded in `deferred-work.md`).
  - e2e countdown measure: lower bound `RESUME_COUNTDOWN_MS - 50 ms` (a frame or so of slack, a little more than the "one frame" of the spec so that a slow CI frame does not make it flaky), upper bound `+ 2 s`. Mid-countdown the canvas is also asserted byte-identical to the paused one (no step runs during the countdown).
  - `-webkit-user-select: none` is added next to `user-select: none` (Safari needs the prefix).
- **Manual check (built-in browser pane, Chromium):** the floor, grid and cube show in true isometric; one tap gives a visible ~3 s `resuming` with the cube still, then `running` with the cube sliding on from where it stopped (no catch-up jump); the room stays whole at 1024 × 768, 844 × 390 and a 375 × 812 portrait viewport, with the backing store at `css × 2` (dpr 2); no console error. **Not checked:** a real tab switch (the pane keeps `visibilityState` at `visible` when another tab is fronted; the same `visibilitychange` path is covered in e2e with the event dispatched by hand, and the pane's page loaded hidden and started paused, as designed); any physical phone or tablet (touch, iOS Safari, notch/safe-area, real DPR, 60 FPS); the GitHub ubuntu runner (webkit on Linux may fail to create a WebGL context: see `deferred-work.md`). The pane throttles the page in the background (~1 fps), which produced `frame stall` warnings of ~900 ms: that is the step cap doing its job.
- **Nothing committed.** `tests/architecture/**` and `biome.json` untouched; no new dependency.

### File List

New:
- `src/shared/emitter.ts`, `src/shared/emitter.test.ts`
- `src/client/timeMap.ts`, `src/client/timeMap.test.ts`
- `src/client/loop.ts`, `src/client/loop.test.ts`
- `src/client/boot.ts`
- `src/client/app/clientEvents.ts`
- `src/client/app/pauseController.ts`, `src/client/app/pauseController.test.ts`
- `src/client/app/visibilityPause.ts`, `src/client/app/visibilityPause.test.ts`
- `src/client/app/globalErrorHandlers.ts`, `src/client/app/globalErrorHandlers.test.ts`
- `src/client/render/renderer.ts`, `src/client/render/renderer.test.ts`
- `src/client/render/isoCamera.ts`, `src/client/render/isoCamera.test.ts`
- `src/client/render/provisionalScene.ts`, `src/client/render/provisionalScene.test.ts`
- `src/client/render/materials/palette.ts`
- `tests/support/fakeScheduler.ts`
- `tests/e2e/pauseResume.spec.ts`

Modified:
- `src/shared/constants.ts` (12 constants)
- `src/main.ts` (CSS import + `void boot()`)
- `src/client/ui/styles/ui.css`
- `tests/e2e/boot.spec.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-4-boucle-client-vue-isometrique-et-pause-exacte.md` (this file)

## Change Log

- 2026-10-27: Story 1.4 created (ready-for-dev).
- 2026-10-27: Story 1.4 implemented: fixed-step client loop with freeze and backlog handling, real → sim `timeMap`, pause controller with a 3 s countdown and visibility binding, isometric camera and provisional scene, composition root `boot.ts`, global error hook, mobile canvas CSS, unit and e2e tests (status: review).
