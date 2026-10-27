---
baseline_commit: ea248640f1f5148009da703ad7c48976ff1dc828
---

# Story 1.13: Autoplay and Test API in the Browser

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.13 « Autoplay et API de test dans le navigateur ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As an AI developer agent,
I want to make a bot play in the real browser and inspect the game from Playwright,
so that I can check the whole game, rendering included, without any human.

**Requirements covered:** FR66 (the game can be launched and played end to end without human intervention), NFR13 (automated tests), plus the architecture's « Automatisation » decision (`?autoplay=human&seed=42&speed=4`, `window.__PP__`) and its `PPTestApi` contract (« Contrats d'API (internes) »). This story is the browser half of the golden rule; story 1.12 built the headless half and the four bots this story reuses unchanged.

## Precondition (check first, stop if it fails)

Story 1.12 is in `review` at the time of writing (commit `ffddcda`). Start only when 1.12 is `done` in `sprint-status.yaml` and its review fixes are committed (`git status` clean apart from `_bmad-output/`), then run `npm run ci` **before the first edit** and let it finish before editing anything. If the 1.12 review renamed something this story names (`createBot`, `BotSetup`, `BotResponse`, `playGame`, `responsesOf`, `content.bots`, `runList[].worldHash`…), follow the code, not this file. If 1.12 is not done, stop and tell Geo.

**The e2e suite needs WebGL.** 1.12 was developed in a remote container where 134 of 140 Playwright tests never reach `data-pp-app="start"` (no WebGL). This story is mostly e2e: it must be developed and verified **on Geo's Mac** (or any machine where the untouched suite is green). If the baseline e2e is red before the first edit, stop and say so; do not write e2e specs you cannot run.

## Acceptance Criteria

1. **Autoplay** — with `?autoplay=<bot>&seed=<n>&speed=<x>` (dev and playtest builds), the game starts the level by itself (no start gesture), and the bot plays instead of the player: before every sim step the bot is asked for its commands, exactly as `playGame` does headless. `speed` multiplies real time for the level loop (4 → four times real speed). The bots are loaded by a dynamic `import()` from `client/boot.ts` (through `@debug/autoplay`), never statically, and the production build contains no bot code.
2. **Same game as headless** — a browser game with `?autoplay=perfect&seed=42`, frozen at any sim time `T`, has the same world hash as `npm run sim -- --bot perfect --seed 42 --runs 1 --until-ms T` (`runList[0].worldHash`), in chromium and webkit.
3. **Bad parameters** — an unknown bot id, a seed that is not an integer in `[0, 2**32)`, or a speed outside `(0, PLAY_SPEED_MAX]` is ignored with one `warn` naming the valid choices, and the game behaves as without that parameter (an unknown bot → the normal start screen).
4. **`window.__PP__`** — available in dev (`npm run dev`) always, and in a playtest build only with `?debug=1`; never in a production build. `state()`, `events(since?)`, `send(cmd)`, `advance(n)`, `freeze(on)`, `setFeel(patch)` and `loadLevel(id, seed)` work as pinned in Dev Notes › Test API, and each is proven by `tests/e2e/testApi.spec.ts` in chromium and webkit.
5. **`tests/e2e/autoplay.spec.ts`** (chromium and webkit) — loads the game with `?autoplay=perfect&seed=42&speed=4`, checks that at least one `ResponseResolved` with quality `perfect` or `success` is emitted, that there is no console error and none of the app's own warnings (`collectProblems`), and takes a screenshot of a frozen frame (`freeze` + `loadLevel` + `advance`) compared to a committed reference with `toHaveScreenshot`.
6. **Nothing else moves** — `src/sim/**` and `src/bots/**` behaviour are untouched (the one allowed `src/bots` change is moving `responsesOf` there, D9); no golden regenerated; the existing e2e specs and data mirrors (`data-pp-*`) keep working unchanged; `npm run ci` is green on the reference machine.

## Tasks / Subtasks

- [x] **T0 — Baseline** (Precondition)
  - [x] `npm run ci` green on the untouched tree on the reference machine; note unit and e2e test counts and durations in the Debug Log.
- [x] **T1 — URL parameters** (AC 1, 3; D1, D2, D3)
  - [x] `src/client/app/debugParams.ts`: `readDebugParams(search): DebugParams` (`{ isDebug, autoplay, seed, speed }`, each `null` when absent or invalid), pattern of `threatsSwitch.ts` (one `warn` per bad value, on channel `'boot'`). Constants `PLAY_SPEED_MAX` in `shared/constants.ts`. Colocated `debugParams.test.ts` (every valid / invalid case of Dev Notes › URL parameters).
- [x] **T2 — The loop learns to freeze, advance, speed up and ask a hook before each step** (AC 1, 4; D4, D5, D6)
  - [x] `src/client/loop.ts`: options `speed?: number` (default 1) and `beforeStep?: (sim: Sim) => void`; methods `setFrozen(isFrozen)`, `readonly isFrozen`, `advance(steps)` (Dev Notes › Loop). No allocation per frame or per step; doc comment updated.
  - [x] `src/client/loop.test.ts`: new cases (Dev Notes › Testing › loop). Every existing case passes unchanged.
- [x] **T3 — The level session takes start options** (AC 1, 4; D7, D8)
  - [x] `src/client/app/levelSession.ts`: `start(options?: LevelStartOptions)` with `levelId`, `seed`, `feel`, returning a `LevelStartOutcome`; deps `speed?`, `beforeStep?`, `onLevelStarted?`; methods `freeze(on)`, `advance(steps)`, `readonly isFrozen`, `readonly current` (id + seed + feel of the running level). « Recommencer » / « Réessayer » restart the **same** level id, seed rule of D2, and the current feel override.
  - [x] `src/client/app/levelSession.test.ts`: new cases (Dev Notes › Testing › level session). Existing cases unchanged (the default `start()` keeps today's behaviour).
- [x] **T4 — The host the debug code drives** (AC 4; D10)
  - [x] `src/client/app/testHost.ts`: `TestHost` interface only (Dev Notes › Test host); built in `boot.ts`, passed to the debug modules. No logic here.
- [x] **T5 — Bot setup shared with the CLI** (AC 2; D9)
  - [x] Move `responsesOf` from `tools/sim/runSim.ts` to `src/bots/botResponses.ts` as `botResponsesOf(defs)` (structural type, no `@content` import); `runSim.ts` imports it. `tests/tools/sim/*` stay green unchanged; colocated `botResponses.test.ts`.
- [x] **T6 — Autoplay** (AC 1, 2, 3; D1, D2, D11, D12)
  - [x] `src/debug/autoplay.ts`: `installAutoplay(host, botId)` → `Result<void, AppError>`: validates the id with `createBot` against a throwaway setup (unknown → `err` with the `createBot` message), then on every `onLevelStarted` builds a fresh bot (`seed` = level seed, `holdMinMs` = the level's feel, `responses` = `botResponsesOf(level.threats)`, `settings` = `content.bots`) and installs it as the step hook (one reused `out` array).
  - [x] `boot.ts`: when `VITE_DEBUG_ALLOWED === 'true'` and `params.autoplay !== null`, `await import('@debug/autoplay')` before `appFsm.enter('start')`; on success the app skips the start screen and calls `levelSession.start()` itself, the gameplay input is ignored (D11), and audio stays locked and silent (D12). On `err`: `log.warn('boot', …)` and the normal start screen.
  - [x] `src/debug/autoplay.test.ts` (Node, frozen fixtures): over a fake host driving a real sim, N steps through the hook give the same `journal()` and `hashJson(world)` as `playGame` with the same bot and seed; an unknown id is an `err` naming `perfect, human, random, idle`; a second level start builds a new bot (no plan carried over).
- [x] **T7 — `window.__PP__`** (AC 4; D13–D18)
  - [x] `src/debug/feelPatch.ts`: `applyFeelPatch(feel, patch)` → `Result<Feel, AppError>` (deep merge of plain objects, arrays replaced, then `FeelSchema.safeParse`; the error lists the Zod issue paths). Colocated test.
  - [x] `src/debug/testApi.ts`: `createTestApi(host): PPTestApi` and `installTestApi(window, host)`; the `PPTestApi` type and the `Window.__PP__` global declaration live here. Behaviour exactly as Dev Notes › Test API. Colocated `testApi.test.ts` over a fake host (every method, every error).
  - [x] `boot.ts`: when `VITE_DEBUG_ALLOWED === 'true'` and (`import.meta.env.DEV` or `params.isDebug`), `await import('@debug/testApi')` and install it once boot is ready (just before `log.info('boot', 'ready: …')`).
- [x] **T8 — E2E** (AC 2, 4, 5; Dev Notes › Testing › e2e)
  - [x] `tests/e2e/support/testApi.ts`: typed helpers over `page.evaluate` (`waitForTestApi`, `ppState`, `ppEvents`, `ppSend`, `ppAdvance`, `ppFreeze`, `ppSetFeel`, `ppLoadLevel`), importing `PPTestApi` as a type from `src/debug/testApi.ts`.
  - [x] `tests/e2e/autoplay.spec.ts` (AC 2, 3, 5) and `tests/e2e/testApi.spec.ts` (AC 4).
  - [x] Screenshot references: `playwright.config.ts` gains `snapshotPathTemplate` and an `expect.toHaveScreenshot` default (Dev Notes › Screenshots); generate the `darwin` ones with `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` and the `linux` ones in Docker (`linux/amd64`, Dev Notes › Screenshots), look at each of the four PNGs, commit them.
- [x] **T9 — Docs and status**
  - [x] `CLAUDE.md` › Commands: one row for the autoplay URL and `window.__PP__`, one for refreshing the screenshot references (Dev Notes › Docs). Nothing else.
  - [x] `_bmad-output/project-context.md` › Testing Rules: « `window.__PP__` exists from story 1.12 onward » → « from story 1.13 onward », and add `setFeel` restarts the level until story 2.1 (D16). Nothing else.
  - [x] Fix the stale comment in `boot.ts` (« Story 1.13 brings `window.__PP__`; until then these are how a test sees the app ») to say the mirrors stay for the existing specs and `__PP__` is the API for new ones.
  - [x] `deferred-work.md`: Dev Notes › Deferred items this story touches / Deferred by this story.
  - [x] Final `npm run ci` green on the reference machine. By hand: `npm run build` then `grep -rl "__PP__\|createPerfectBot" dist/` finds nothing (paste the result in the Debug Log); open `/?autoplay=human&seed=42&speed=4` in the dev server and note in the Debug Log what you saw (responses, gags).

## Dev Notes

### What exists today (stories 1.4 to 1.12)

- **Composition root** `src/client/boot.ts`: loads content, builds renderer, camera, `appFsm` (`boot → start → loading → level → …`; `start → loading` is legal without anything else), `pause` (`createPauseController`, states `running | paused | resuming`, 3 s real-time countdown, frame-driven), feedback director, audio engine, input mapper, UI shell and `levelSession`. `appFsm.enter('start')` then waits for the start gesture, whose handler calls `audio.unlock()` synchronously, then `levelSession.start()`. **Debug mirrors** (`isMirrored = VITE_DEBUG_ALLOWED === 'true'`): `data-pp-*` attributes on `<html>` written on events (`ppApp`, `ppState`, `ppThreat`, `ppThreatPx`, `ppResponse`, `ppGag`, `ppPress`, `ppSeed`…); every existing e2e spec reads them. `?threats=off` (`app/threatsSwitch.ts`) and `?throwAfterMs=` (`app/forcedThrow.ts`) are the two existing debug URL switches and the pattern to copy (parse, `warn` on a bad value, ignore it).
- **Level session** `src/client/app/levelSession.ts`: `start()` (single flight, generation token; `loading` → assets + level JSON + sounds → `createSim({ content, geometry, level, seed })` → scene → wait for foreground → `pause.requestPause('levelStart')` + `requestResume()` → `active = { sim, timeMap, level }` → `appFsm.enter('level')` → `loop.start()`), `stop()`, `active`. Today the level id is a dep fixed at creation (`DEFAULT_LEVEL_ID`) and the seed comes from `deps.newSeed()` (`crypto.getRandomValues` in `boot.ts`).
- **Loop** `src/client/loop.ts`: `createGameLoop({ sim, timeMap, pause, scheduler?, render, onSimEvent })`, `start()`, `stop()`, `stats`. Per frame: `pause.update`, then while `running`: real dt → pays off `sim.freezeRealMs` first (hitstop, not used before 1.14) → `accumulatorMs += dt × sim.timeScale` → up to `MAX_STEPS_PER_FRAME` steps (each: `sim.step()`, `drainEvents()`, `onSimEvent` per event) → stall drop → time map record → `render(alpha)`. A frame after a pause or a start measures no dt (`hasLastRunning = false`). Fail-stop on exception.
- **Render clock**: `levelScene.update(world, alpha)` drives every VFX (waves, shake, gags, lift) from `world.time.sim + alpha × STEP_MS`, never real time. A frozen loop with a constant accumulator therefore renders the same frame forever: that is what makes `freeze` screenshots stable. CSS animations (threat pulse/bounce, panel pop-in) are real time: `toHaveScreenshot({ animations: 'disabled' })` stops them.
- **Audio** `client/audio/audioEngine.ts`: without `unlock()` there is no context; `preload` then warns once (`[audio] audio preload skipped: no audio context, the game is silent`), loops and one-shots return silently. `[audio]` warnings fail `collectProblems` (`tests/e2e/support/game.ts › OWN_WARNINGS`).
- **Bots** (1.12): `@bots/bot` (`BOT_IDS`, `BotId`, `Bot { id, act(world, out) }`, `BotSetup { seed, holdMinMs, responses, settings }`, `BotOptions`, `BotResponse`), `@bots/createBot` (`createBot(id, setup): Result<Bot, AppError>`, unknown id → message `unknown bot "x": choose perfect, human, random, idle`), `@bots/playGame` (`act` → enqueue → step → drain, one reused `out`). Contract D3 of 1.12: `act` is called once **before each step** with the world at `now`, and pushes commands with `t ∈ [now, now + STEP_MS)`. The bot's RNG is salted from the seed (`BOT_SEED_SALT`), never `world.rng`. `ContentBundle.bots` holds `content/bots.json`.
- **CLI** (1.12): `npm run sim -- --level <id> --bot <id> --seed <n> --runs 1 --until-ms <n>` writes the report to stdout when `--out` is absent; `runList[0].worldHash` is `hashJson(sim.world)` after the run. `--until-ms` is rounded up to the step grid. `tests/tools/sim/cli.test.ts` shows how to spawn it (`npx tsx tools/sim/runSim.ts …` through `spawnSync`).
- **Sim API**: `Sim.enqueue` throws (`invariant`) on a malformed command (shape checked by `commandProblem`); `SimCommand` = `SetTimeScale | TapFloor | Move | MoveStop | PressThreat | Release`. **There is no `SetFeel` command** (story 2.1 adds it and moves the effective feel into `World`, see `deferred-work.md` › « Effective feel in `World` »). `createSim` hashes the feel (`feelHash`) into the journal.
- **Architecture tests and Biome** already allow exactly what this story needs: `src/client/**` may not import `@bots/**` or `@debug/**` (static or dynamic), **except** `src/client/boot.ts`, which may `import()` them dynamically with a literal specifier (R7; a template-string `import()` is flagged). `src/debug/**` may import anything. Type-only imports count as imports: client code may not even `import type` from `@debug` or `@bots`.
- `src/debug/` holds only `.gitkeep` (delete it).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | **Where each piece lives.** URL parsing: `client/app/debugParams.ts` (plain strings and numbers, no bot ids). Freeze / advance / speed / step hook: the loop and the level session (client: they are loop mechanics). The host interface the debug code drives: `client/app/testHost.ts`. Autoplay (`installAutoplay`) and `window.__PP__` (`installTestApi`): `src/debug/`, loaded by two literal dynamic imports in `boot.ts` guarded by `import.meta.env.VITE_DEBUG_ALLOWED === 'true'`. | R7: the client may not name bot types, so the code that creates bots must be in `debug` (which imports anything) and reach the client through an interface the client owns. The guard + dynamic import keeps both modules (and the bots) out of the production chunk. The architecture tree names `src/debug/testApi.ts`; `autoplay.ts` and `feelPatch.ts` are additions in the same folder (stated variance). |
| D2 | **Availability.** Autoplay, `?seed` and `?speed` work whenever `VITE_DEBUG_ALLOWED === 'true'` (dev and playtest builds), with or without `?debug=1`. `window.__PP__` is installed when `VITE_DEBUG_ALLOWED === 'true'` **and** (`import.meta.env.DEV` or `?debug=1`). Production (`VITE_DEBUG_ALLOWED=false`): none of them; the parameters are not even read. `?seed=<n>` fixes the seed of **every** level started in the page (start, « Recommencer », « Réessayer »); without it, a fresh random seed per level, as today. Priority: an explicit `start({ seed })` (`loadLevel`, `setFeel`'s restart) > `?seed` > random; `boot.ts` implements `newSeed` as `params.seed ?? random`. | The epic's autoplay URL has no `debug=1`; the architecture says `__PP__` « en dev et avec `?debug=1` ». A fixed seed for every restart makes a restart reproduce the same game, which is what a tester sharing a link wants. |
| D3 | **`?speed=<x>`**: a finite number in `(0, PLAY_SPEED_MAX]`, `PLAY_SPEED_MAX = 4` in `shared/constants.ts`; it applies with or without autoplay. It multiplies the real time the loop measures for the level (dt), hitstop payment included; it does **not** speed the resume countdown (real time, `pauseController`) nor CSS animations. | At 60 Hz, ×4 is ~67 ms of sim per frame (≈ 7 steps), under `MAX_STEPS_PER_FRAME = 10`; more would drop backlog on every slow frame. The speed changes only how fast steps happen, never what they do: the game stays the same game (AC 2). |
| D4 | **Freeze** (`loop.setFrozen(true)`): while frozen the loop keeps running frames, calls `pause.update` and renders, but runs no step, adds nothing to the accumulator, does not pay off a hitstop, and records `simPerRealMs = 0` in the time map. Unfreezing measures no elapsed time for the first frame (like a resume: no catch-up). | « Fige la boucle pour des captures stables »: rendering must go on (screenshots, world UI), sim time must not. Same rule as pause, which is the proven path for « no catch-up ». |
| D5 | **Advance** (`loop.advance(steps)`): sets frozen, then runs exactly `steps` steps synchronously, each exactly as a frame's step (step hook, `sim.step()`, drain, `onSimEvent` per event), ignoring the pause state and `sim.freezeRealMs` (and not consuming it), then renders once with the current alpha. `steps` is an integer in `[0, ADVANCE_MAX_STEPS]` (`ADVANCE_MAX_STEPS = 360_000`, one hour of sim, in `shared/constants.ts`), else it throws. | « Avance N pas, temps figé ensuite ». A test tool must not depend on the countdown or a future hitstop to be exact. Rendering once makes the DOM (world UI, threat icon) match the new world before the call returns. |
| D6 | **Step hook** (`beforeStep(sim)`): called before **every** `sim.step()` the loop runs (frames and `advance`), never between steps of another path. The loop knows nothing of bots. | 1.12 D3: a bot is asked once before each step. Putting the call in the loop keeps the browser game identical to `playGame` (AC 2). |
| D7 | **Start options**: `levelSession.start(options?: { levelId?: string; seed?: number; feel?: Feel })`. Absent fields: `levelId` → the current level's (initially `DEFAULT_LEVEL_ID`), `seed` → `deps.newSeed()`, `feel` → the current override (initially `content.feel`). The sim gets `{ ...content, feel }`, the scene gets that feel's radii. `start` resolves with a `LevelStartOutcome`: `'started'` (app in `level`), `'ignored'` (a start was in flight), `'stale'` (superseded by `stop()` or a newer start), `'failed'` (app in `oops`). | `loadLevel(id, seed)` and `setFeel` need both; today's callers ignore the return value, so their behaviour does not change. |
| D8 | **`onLevelStarted({ sim, levelId, seed, level, feel })`** dep: called once per started level, right after the sim is created and before the first step (before `appFsm.enter('level')`). Both autoplay (a new bot) and the test API (a new event log) hang on it. | One place where « a new game begins » is known, with everything a bot setup needs. |
| D9 | **`botResponsesOf(defs)`** moves from `tools/sim/runSim.ts` (`responsesOf`) to `src/bots/botResponses.ts`, typed structurally (`Readonly<Record<string, { readonly response: BotResponse }>>`). The CLI and autoplay use the same function. | One rule for « what each def asks for », or the browser bot and the CLI bot could diverge. `src/bots` may not import `@content`, hence the structural type. |
| D10 | **The test host** (`TestHost`, client interface, implemented in `boot.ts`): `content`; `levelSession` operations (`start`, `active`, `current`, `freeze`, `advance`, `isFrozen`); `setStepHook(hook \| null)`; `onLevelStarted(listener)` and `onSimEvent(listener)` (each returns an unsubscribe); `appState()` and `pauseState()`; `onAppStateChanged` / `onGameResumed` (for `loadLevel`'s resolution). Exact shape in Dev Notes › Test host. | The debug modules must not reach into `boot.ts` closures; an explicit interface is testable with a fake. |
| D11 | **Autoplay owns the game input.** While autoplay is installed, the input mapper sends nothing to the sim and shows no tap marker: in `boot.ts`, both its `getActive` dep and the `moveIntent`'s `send` (which reads `levelSession.active` directly today) go through one `isGameInputBlocked` check; pause (HUD button, Échap, pad Start), the pause panel and « Recommencer » still work. Commands from `__PP__.send` still go through. | A human tap mixed into a bot game breaks AC 2 and makes the run unreproducible; pausing to look is still useful. |
| D12 | **Autoplay is silent.** No start gesture means no audio unlock: the composition root skips the sound preload (`loadAudio` resolves at once) and logs once `log.info('audio', 'autoplay: no gesture, the game is silent')`. Haptics and visuals still play. | iOS and Chromium refuse an audio context outside a gesture; the existing `preload` warning would fail every autoplay spec. A silent agent run is the expected behaviour, not a degraded one. |
| D13 | **`state()`** returns `cloneJson(sim.world)` of the running level, or `null` when no level is active (start screen, loading, oops). | A copy: a test can never mutate the live world (« le client ne fait que lire `world` »). `null` makes `waitForFunction(() => __PP__.state() !== null)` easy. |
| D14 | **`events(since = 0)`**: the test API keeps a copy (`cloneJson`) of every `SimEvent` of the current level, in order; `events(since)` returns those of absolute index `≥ since` (a new array). The log is cleared at each `onLevelStarted` (indices restart at 0). It holds at most `TEST_API_EVENT_LOG_MAX = 50_000` events (`shared/constants.ts`); beyond, the oldest are dropped, one `warn` is logged, and indices stay absolute (a `since` older than the oldest kept returns from the oldest). | A cursor gives no duplicates and no gaps when a test polls (`const seen = events(); … events(seen.length)`); sim time would (several events share a `t`). The events of `drainEvents` must be copied anyway (reused array). A 3-minute autoplay game is a few thousand events. |
| D15 | **`send(cmd)`**: `cmd` is a `SimCommand` whose `t` may be omitted (then `t = world.time.sim`, i.e. applied at the next step). It goes through `sim.enqueue` (journaled, judged on its `t`); a malformed command throws (the sim's message), and so does `send` with no level running. | The test cannot know the exact sim time between two evaluates; « now » is what a fresh tap would get. Throws propagate as a rejected `page.evaluate`, with the message. |
| D16 | **`setFeel(patch)`** (until story 2.1): `patch` is a deep partial of `Feel`; the API merges it onto the **current override** (initially `content.feel`) with `applyFeelPatch` (plain objects merged, arrays and scalars replaced, then `FeelSchema.safeParse`), then **restarts the current level with the same id and seed** and the merged feel; returns a promise resolved like `loadLevel`. Invalid patch → rejects with the Zod issue paths, nothing restarts. The override stays for later starts (« Recommencer », `loadLevel`) until the page reloads. Only the sim and the level scene see it (the input mapper keeps the boot feel's `touchRadiusPx` / stick values). | The architecture's `setFeel` sends `SetFeel`, which does not exist before story 2.1 (it also moves the feel into `World`). A restart with a patched `ContentBundle` gives the test the same power today with no sim change; the journal of the new game carries the new `feelHash`. Story 2.1 switches `setFeel` to the command (deferred item). Open point 1. |
| D17 | **`loadLevel(id, seed)`**: `seed` an integer in `[0, 2**32)` (else rejects), then `levelSession.start({ levelId: id, seed })`; the promise resolves when that level is **running** (its countdown over: `GameResumed` while the app is in `level`), and rejects with an `Error` naming the id when the outcome is `'failed'` (unknown id, bad content: the app shows « Oups »), `'ignored'` or `'stale'`. It works from `start`, `level`, `oops` (and `result` later). The freeze state is kept across levels: `freeze(true)` then `loadLevel` gives a level that waits at sim time 0 for `advance`. | Resolving after the countdown means no overlay is left on screen when the test resumes; keeping the freeze across levels is what makes a screenshot exact (no step can slip in between the countdown's end and the test's `advance`). |
| D18 | **`freeze(on)`** and **`advance(n)`** delegate to the level session (D4, D5); with no level running, `freeze` only records the wish (applied to the next loop) and `advance` throws. `advance` returns after the render (synchronous). | Same semantics in every state; a test can freeze before the level exists. |

### URL parameters (`client/app/debugParams.ts`)

| Param | Valid | Result | Invalid → `warn` (channel `boot`), treated as absent |
|---|---|---|---|
| `debug` | `1` | `isDebug: true` | any other value: « ignoring ?debug=x: the only value is "1" » |
| `autoplay` | any non-empty string (validated by `installAutoplay`, D1) | `autoplay: 'perfect'` | empty: « ignoring ?autoplay=: name a bot » |
| `seed` | integer string in `[0, 2**32)` (`/^\d+$/`, no sign, no exponent) | `seed: 42` | « ignoring ?seed=x: not an integer in [0, 4294967296) » |
| `speed` | finite number in `(0, PLAY_SPEED_MAX]` | `speed: 4` | « ignoring ?speed=x: not a number in (0, 4] » |

`readDebugParams` is only called when `VITE_DEBUG_ALLOWED === 'true'`. An unknown bot id is warned by `boot.ts` with the `createBot` message (« unknown bot "x": choose perfect, human, random, idle »).

### Loop (`client/loop.ts`)

```ts
export interface GameLoopOptions {
  // …existing…
  /** Real-time multiplier for the level (`?speed`, D3). Default 1. A finite number > 0. */
  readonly speed?: number;
  /** Called before every `sim.step()` this loop runs, frames and `advance` alike (D6). */
  readonly beforeStep?: (sim: Sim) => void;
}

export interface GameLoop {
  // …existing start / stop / stats…
  readonly isFrozen: boolean;
  /** D4. Idempotent. Unfreezing measures no time for the next frame. */
  setFrozen(isFrozen: boolean): void;
  /** D5. Leaves the loop frozen. Throws on a `steps` that is not an integer in [0, ADVANCE_MAX_STEPS]. */
  advance(steps: number): void;
}
```

- Factor one `runStep()` used by the frame loop and `advance` (hook → `sim.step()` → drain → `onSimEvent`), so they cannot drift.
- The frozen check goes where `pause.state === 'running'` is tested: frozen behaves like « not running » for stepping and dt (`hasLastRunning = false`), but `pause.update` still runs (the countdown must end while frozen, D17).
- `simPerRealMs` recorded in the time map = `0` when frozen or in hitstop, else `sim.timeScale × speed` (the real→sim conversion of a human tap stays right at ×4).
- `invariant` (throw) on a bad `speed` at creation; validation messages built only on failure (no template string in the hot path).

### Level session additions (`client/app/levelSession.ts`)

```ts
export interface LevelStartOptions { levelId?: string; seed?: number; feel?: Feel }
export type LevelStartOutcome = 'started' | 'ignored' | 'stale' | 'failed';
export interface StartedLevel { sim: Sim; levelId: string; seed: number; level: LevelContent; feel: Feel }

// deps: speed?: number; beforeStep?: (sim: Sim) => void; onLevelStarted?: (started: StartedLevel) => void;
// LevelSession: start(options?): Promise<LevelStartOutcome>;
//   readonly current: { levelId: string; seed: number | null; feel: Feel };  // last requested
//   readonly isFrozen: boolean; freeze(isFrozen: boolean): void; advance(steps: number): void;
```

- `beforeStep` is passed to each new loop as `(sim) => deps.beforeStep?.(sim)` **once per loop** (no closure per step). Autoplay swaps its bot behind it through `TestHost.setStepHook`.
- `freeze` stores the wish and applies it to the current loop and to every new loop (`loop.setFrozen(isFrozen)` right after `createGameLoop`).
- `advance` with no active loop throws `Error('no level is running')`.
- `current.feel` is what the next `start()` without `feel` uses (D16); `current.levelId` likewise (D7).

### Test host (`client/app/testHost.ts`)

```ts
import type { ContentBundle } from '@content/contentBundle';
import type { Feel } from '@content/schemas/feel';
import type { Sim, SimEvent } from '@sim';
import type { AppState } from './appFsm.ts';
import type { LevelSession, StartedLevel } from './levelSession.ts';
import type { PauseState } from './pauseController.ts';

/** What the debug code (autoplay, `window.__PP__`) may do to the app. Built by `boot.ts` only. */
export interface TestHost {
  readonly content: ContentBundle;
  readonly levelSession: LevelSession;
  appState(): AppState;
  pauseState(): PauseState;
  /** The hook run before every step of the level loop (D6); `null` removes it. One at a time. */
  setStepHook(hook: ((sim: Sim) => void) | null): void;
  /** Each returns its unsubscribe. */
  onLevelStarted(listener: (started: StartedLevel) => void): () => void;
  onSimEvent(listener: (event: SimEvent) => void): () => void;
  onGameResumed(listener: () => void): () => void;
  onAppStateChanged(listener: (to: AppState) => void): () => void;
  /** Set by autoplay: the input mapper sends nothing to the sim while true (D11). */
  setGameInputBlocked(isBlocked: boolean): void;
}
```

In `boot.ts`: the listeners are plain arrays fed from the existing `onSimEvent` dep and emitter subscriptions (`events.on('GameResumed', …)`, `AppStateChanged`); `onSimEvent` listeners get the event **after** the existing handling (director, choreography, mirrors). With no debug module installed the arrays are empty: the cost on the hot path is one `length` check per event. Build the host only when `VITE_DEBUG_ALLOWED === 'true'`.

### Test API (`src/debug/testApi.ts`)

```ts
import type { Feel } from '@content/schemas/feel';
import type { SimCommand, SimEvent, World } from '@sim';

export type FeelPatch = { [K in keyof Feel]?: DeepPartial<Feel[K]> }; // DeepPartial: plain objects only, arrays whole
export type TestCommand = SimCommand extends infer C ? (C extends { t: unknown } ? Omit<C, 't'> & { t?: number } : never) : never;

export interface PPTestApi {
  state(): World | null;                                   // D13
  events(since?: number): SimEvent[];                      // D14
  send(cmd: TestCommand): void;                            // D15
  advance(steps: number): void;                            // D5, D18
  freeze(on: boolean): void;                               // D4, D18
  setFeel(patch: FeelPatch): Promise<void>;                // D16
  loadLevel(id: string, seed: number): Promise<void>;      // D17
}

declare global { interface Window { __PP__?: PPTestApi } }
```

- Variances from the architecture contract, stated: `state()` may return `null` and returns a copy; `events` returns a mutable copy; `send` accepts a missing `t`; `setFeel` returns a promise and restarts the level (D16). Update nothing in the architecture doc; the story records them.
- `installTestApi(target, host)` sets `target.__PP__` once (a second call is a no-op with a `warn`) and logs `log.info('debug', 'window.__PP__ ready')`.
- All errors are `Error` instances with a message naming the method (`'__PP__.advance: steps must be an integer in [0, 360000], got 1.5'`), never `Result` (this API is for test scripts, and a rejected `page.evaluate` carries the message).

### Testing

- **Unit, `src/client/app/debugParams.test.ts`**: every row of the URL table, combined parameters, warnings counted through `log.buffer()` (as `loop.test.ts` does), nothing warned for absent parameters.
- **Unit, `src/client/loop.test.ts`** (fake scheduler, real sim with the frozen fixtures): frozen → frames render, no step, `world.time.sim` constant, `pause.update` still ends a countdown; unfreeze → no catch-up on the next frame; `advance(n)` → exactly `n` steps, `beforeStep` called `n` times each before its step (record `world.time.sim` seen by the hook), events reach `onSimEvent`, one render, loop left frozen, works while `paused`; `advance` with `1.5`, `-1`, `ADVANCE_MAX_STEPS + 1` throws; `speed: 4` with 10 ms frames → 4 steps per frame; `speed` invalid → throws at creation; `beforeStep` called once per step in normal frames. The existing cases pass unchanged.
- **Unit, `src/client/app/levelSession.test.ts`**: `start({ levelId, seed, feel })` gives `createSim` that id's content, that seed and `{ ...content, feel }`; outcomes `started` / `ignored` / `stale` / `failed`; `onLevelStarted` called once per level, before the first step, with the seed; `freeze(true)` before `start` → the new loop is frozen; `advance` without a level throws; a restart without options reuses the current id, the seed rule and the feel override.
- **Unit, `src/debug/autoplay.test.ts`**, **`testApi.test.ts`**, **`feelPatch.test.ts`** (Node; a fake `TestHost` over a real sim with the frozen fixtures of `tests/support/testContent.ts`): autoplay = `playGame` (same journal, same hash after 4 000 steps, perfect and human bots); unknown id `err`; new bot per level. Test API: each method on the happy path and each error (no level, bad steps, bad seed, malformed command, invalid patch), `events(since)` cursor and reset at a new level, the 50 000 cap (use a small cap injected through an option `eventLogMax` for the test, default the constant), `state()` is a copy (mutating it changes nothing), `loadLevel` resolves on `GameResumed` and rejects on `failed`. Feel patch: nested merge, array replaced, unknown key refused (strict schema), value out of range refused, the input feel not mutated.
- **E2E helpers** `tests/e2e/support/testApi.ts`: `waitForTestApi(page)` (`waitForFunction(() => window.__PP__ !== undefined)`), thin typed wrappers around `page.evaluate`. A world hash on the Node side: `hashJson` from `src/shared/hash.ts` (relative import, like `support/game.ts` imports `src/content/feedbackClips.ts`).
- **`tests/e2e/autoplay.spec.ts`** (AC 2, 3, 5):
  1. `collectProblems(page)`; `goto('/?autoplay=perfect&seed=42&speed=4')`; `waitForTestApi`; `expect.poll(() => ppEvents(page))` until some `ResponseResolved` has quality `perfect` or `success` (timeout derived from the live plan as `threat.spec.ts` does: `RESUME_COUNTDOWN_MS + (FIRST_TELEGRAPH_MS + TELEGRAPH_DELAY_MS + WINDOW_OPEN_MS) / 4 + OVERRUN_MARGIN_MS`); no `GagTriggered`; `data-pp-app` went `start` → `loading` → `level` with no click; `problems` empty.
  2. Same as headless (AC 2): same URL; once a response is seen, `ppFreeze(page, true)`; `const world = await ppState(page)`; spawn `npx tsx tools/sim/runSim.ts --bot perfect --seed 42 --runs 1 --until-ms ${world.time.sim}` (as `tests/tools/sim/cli.test.ts` does, `--until-ms` must be > 0: wait for a response first guarantees it); `expect(hashJson(world)).toBe(report.runList[0].worldHash)`. If webkit differs and chromium matches, do **not** loosen: find the first divergent field (compare `state()` with the CLI's `--journals` replay), report it in the Debug Log and to Geo.
  3. Frozen screenshot (AC 5): same URL; `waitForTestApi`; `ppFreeze(page, true)`; `ppLoadLevel(page, 'salon_crawler', 42)`; `ppAdvance(page, SHOT_STEPS)` where `SHOT_STEPS` is derived from the live plan to land while the first outlet is telegraphed (`(FIRST_TELEGRAPH_MS + TELEGRAPH_DELAY_MS / 2) / STEP_MS`, rounded; assert `ppState(page).threats` has one in `telegraph` or `windowOpen`, else the frame is not the one intended: fail with the state); `expect(page).toHaveScreenshot('autoplay-frozen.png')`. Take it twice in a row in the same test (`expect.toHaveScreenshot` already retries until two shots match; an extra `waitFrames(page, 10)` before must not change it).
  4. AC 3: `?autoplay=nobody` → the normal start screen (`data-pp-app="start"` stays), the warning naming the bots appears in the console (`page.on('console')`); `?seed=abc&speed=99` with `?autoplay=idle` → still plays (autoplay on) with the warnings, and `data-pp-seed` is a random seed, not `abc`.
- **`tests/e2e/testApi.spec.ts`** (AC 4), each in its own test, all through `?threats=off` unless the threat is needed, all with `collectProblems`:
  - `state()` is `null` on the start screen, a world after `loadLevel`; its `time.sim` equals the steps advanced × `STEP_MS` when frozen from 0.
  - `freeze(true)` then 10 display frames (`waitFrames`) → `time.sim` unchanged; `freeze(false)` → it grows.
  - `advance(n)` from frozen → `time.sim` grows by exactly `n × STEP_MS`, and `events()` has the matching `PapaStateChanged` … for a walk started by `send({ type: 'TapFloor', xM, zM })` (take a point from the live geometry's anchors, as `support/game.ts › anchorMirror` does).
  - `events(since)` returns only newer events; reset after `loadLevel`.
  - `send` of a malformed command (`{ type: 'Move', dirX: 0, dirZ: 0 }`) rejects with the sim's message; the game goes on.
  - `setFeel({ movement: { walkSpeedMps: 2 × live } })`: frozen, `send` a `TapFloor` far away, `advance(100)`, distance walked ≈ twice the distance of the same run before the patch (within one step of travel); an invalid patch (`{ timing: { windowMs: -1 } }`) rejects and does not restart (`time.sim` unchanged).
  - `loadLevel('salon_crawler', 7)` → `data-pp-seed="7"`, resolves with `data-pp-state="running"`; `loadLevel('nowhere', 1)` rejects naming `nowhere` and the app shows « Oups » (use `collectProblems(page, { allowedErrors })` for the level-load error the app logs); `loadLevel('salon_crawler', -1)` rejects without leaving the level.
  - Without `?debug=1` in dev, `window.__PP__` exists (D2). (The playtest-without-`debug=1` and production cases are unit-tested on the predicate and checked by hand on `dist/`, T9; e2e runs on the dev server only, see `deferred-work.md` › « Build coverage in CI », story 1.24.)
- **Existing tests that must pass unchanged**: every sim test and golden, every bot and `tools/sim` test (only `runSim.ts` imports `botResponsesOf` from its new home), `layerBoundaries`, `biomeBoundaries`, `simPurity`, every client test except the new cases in `loop.test.ts` / `levelSession.test.ts`, and **every existing e2e spec without edit**. List any edited existing test with its reason.

### Screenshots (`playwright.config.ts`)

- Add `snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}'` and `expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 } }`. The ratio is a guard against GPU dithering, not a slack for real changes: never raise it above 0.01; if it needs more, the frame is not deterministic and that is the bug.
- References are per browser **and per OS**, and **both OS are required** (no skip path): `darwin` made on Geo's Mac, `linux` made in Docker for CI (`ubuntu-latest`, x86_64). Docker 29.9.2 is installed on Geo's Mac (Apple Silicon); its CLI is at `~/.docker/bin/docker`, which may not be on an agent shell's `PATH`: call it by that path or prepend it. Generate the `linux` references with the Playwright image pinned to our version, **forced to amd64** so the GPU emulation matches the CI runner (an arm64 image can render a few pixels differently):
  ```bash
  ~/.docker/bin/docker run --rm --platform linux/amd64 --ipc=host -v "$PWD":/work -v pp-node-modules:/work/node_modules -w /work mcr.microsoft.com/playwright:v1.64.1-noble /bin/bash -c "npm ci && npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots"
  ```
  It runs under emulation (slow: allow several minutes). The named volume `pp-node-modules` keeps the container's Linux `node_modules` off the Mac's (without it, `npm ci` overwrites the Mac's and needs re-running); it stays on Docker until `docker volume rm pp-node-modules`. Open each PNG and check it shows the intended frame before committing. If the container cannot create a WebGL context in one browser (`deferred-work.md` › « WebGL in CI »), report the exact error in the Debug Log and to Geo; do not skip the assertion. Never let CI write a reference.
- A content or art change (Geo re-exports the room, retunes the baby) legitimately changes the frame: refresh with `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`, look at the new PNG, commit it, say so in the story (same rule as `npm run golden:update`).

### Docs (T9)

Two rows in `CLAUDE.md` › Commands, in the table's style:
- `/?autoplay=<bot>&seed=<n>&speed=<x>` | A bot (`perfect`, `human`, `random`, `idle`) plays in the browser, silent, `speed` ≤ 4 (dev and playtest builds); `window.__PP__` (dev, or `?debug=1`) drives the game from Playwright
- `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` | Regenerate the macOS screenshot references (deliberate: look at them, say so in the story); the Linux ones (CI) with the Docker command of story 1.13 › Screenshots

### Previous story intelligence (1.10 to 1.12 and their reviews)

- **Copy what you keep from `drainEvents()`** (reused array): the event log copies each event (D14). This is debug-only code; it may allocate per event, the loop and the sim may not.
- **No template string in a hot loop** (1.8 / 1.10 reviews): `beforeStep`, `runStep` and the event forwarding run every step; build messages only on failure, guard debug logs with `log.enabled('debug')`.
- **1.12 deviation to remember**: a bot cycle is identified by `(threat.id, threat.windowOpenAt)`, not `enteredAt`. Autoplay starts each bot with its level (sim time 0), so the deferred « human bot created mid-window » item does not apply; a bot is never created mid-level here (D8).
- **Frozen fixtures for anything judged**: unit tests use `tests/support/testContent.ts` (`createTestContent`, `createTestGeometry`, `createTestLevel`, `outletEntry`, `stepN`), never the live feel; e2e specs derive every bound from the live files (`support/game.ts`), never copy a number.
- **e2e rules** (1.4 to 1.11): no `waitForTimeout`; bounds derived from the live plan plus `OVERRUN_MARGIN_MS`; `collectProblems` in every test; `waitFrames` for « a few frames »; touch is `page.touchscreen.tap`. `threat.spec.ts` shows deriving timeouts from `FIRST_TELEGRAPH_MS`, `TELEGRAPH_DELAY_MS`, `WINDOW_OPEN_MS`.
- **The 1.10 rule**: every press on a non-idle threat makes Papa glide; a perfect bot pressing in `telegraph` glides early. Expected in screenshots.
- **The e2e baseline of 1.12 was red in a remote container** (no WebGL): see Precondition. Do not mark e2e tasks done from a machine where the suite cannot run.
- **Commits**: the dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.13 : …`, by Geo.

### Architecture guardrails and traps

- **Never** import `@bots/**` or `@debug/**` from `src/client/**` other than by the two literal `import('@debug/autoplay')` / `import('@debug/testApi')` in `boot.ts`, inside `if (import.meta.env.VITE_DEBUG_ALLOWED === 'true')`. Not even `import type` (R7 counts type-only imports). The client names only its own `TestHost`.
- **The sim is not touched.** No `SetFeel` command (story 2.1), no new event, no `World` field, no golden regenerated. If something seems to need one, stop and ask.
- **The client only reads `world` and writes via `sim.enqueue`** — the test API too: `state()` is a copy, `send` enqueues, `setFeel` restarts. No debug code writes into `sim.world`.
- **Bots are pure of real time**: the step hook gives the bot `sim.world` only; `speed`, freeze and frame timing never reach it. That is what makes AC 2 hold at any speed.
- **Units and names**: `speed` is a dimensionless factor (name it `speed` in options, `PLAY_SPEED_MAX` as a constant: it is not a `…Mps`); `steps` is a count; `…AtReal` for real timestamps; constants (`PLAY_SPEED_MAX`, `ADVANCE_MAX_STEPS`, `TEST_API_EVENT_LOG_MAX`) in `shared/constants.ts` only.
- **Errors**: `readDebugParams` and `installAutoplay` return values / `Result`s and log `warn`s; the test API throws `Error`s (a test-only boundary, D-notes). No silent `catch`: a hook that throws during a frame is a fail-stop like any frame exception (it reaches the global error handler → « Oups »).
- **No new dependency**, no Playwright plugin, no `pixelmatch`: `toHaveScreenshot` is built in (`@playwright/test@1.64.1`).
- **Logs**: channels `boot` (parameters), `debug` (test API, autoplay), `audio` (D12); no `console.*`.
- Stack pinned: `@playwright/test@1.64.1`, `vite@8.3.5`, `typescript@7.0.2`, `vitest@5.0.5`. Everything used is built into these versions (`toHaveScreenshot`, `snapshotPathTemplate`, `expect.poll`, `page.waitForFunction`); no web research needed beyond Playwright's own docs for `snapshotPathTemplate` tokens (`{testDir}`, `{testFilePath}`, `{arg}`, `{projectName}`, `{platform}`, `{ext}`).

### Project Structure Notes

- New: `src/client/app/debugParams.ts` (+ test), `src/client/app/testHost.ts`, `src/bots/botResponses.ts` (+ test), `src/debug/autoplay.ts`, `src/debug/testApi.ts`, `src/debug/feelPatch.ts` (+ a colocated test each), `tests/e2e/support/testApi.ts`, `tests/e2e/autoplay.spec.ts`, `tests/e2e/testApi.spec.ts`, `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-{chromium,webkit}-{darwin,linux}.png`.
- Modified: `src/client/boot.ts`, `src/client/loop.ts` (+ test), `src/client/app/levelSession.ts` (+ test), `src/client/input/inputMapper.ts` only if `getActive` cannot carry D11 from `boot.ts` (prefer doing it in `boot.ts`), `src/shared/constants.ts`, `tools/sim/runSim.ts` (import only), `playwright.config.ts`, `CLAUDE.md`, `_bmad-output/project-context.md` (one line), `deferred-work.md`, `sprint-status.yaml`. Deleted: `src/debug/.gitkeep`.
- Architecture tree: `src/debug/testApi.ts` and `tests/e2e/autoplay.spec.ts` are named there; `autoplay.ts`, `feelPatch.ts`, `testApi.spec.ts`, `debugParams.ts`, `testHost.ts` and `botResponses.ts` are additions in existing folders (stated variance). The overlay, perf panel, timeline and feel panel of `src/debug/` are story 2.1; the FPS counter of `?debug=1` is story 1.24.
- Not in this story: `SetFeel` and the feel panel (2.1); hitstop (1.14: `advance` already ignores `freezeRealMs`, D5); the perf spec with the human bot (1.24); migrating the existing specs from mirrors to `__PP__` (see deferred).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** everything playable end to end without a human: this story is the browser half (autoplay + `__PP__`). Bot tuning stays in `content/bots.json`; no number Geo may tune enters the code (`PLAY_SPEED_MAX`, `ADVANCE_MAX_STEPS`, `TEST_API_EVENT_LOG_MAX` are tool limits, not game feel: constants).
- **Layers:** client → `@sim`, `content`, `shared`, `platform`, `three`; bots and debug only by dynamic `import()` in `boot.ts`; debug imports anything; nobody imports debug statically. Cross-layer imports through aliases only; inside a layer, relative.
- **Build flavors:** debug code behind `if (import.meta.env.VITE_DEBUG_ALLOWED === 'true')` + dynamic `import()`, so the store build has no `window.__PP__`, no bots, no cheats (checked by hand here, by test in 1.24).
- **E2E:** chromium + webkit, landscape phone viewport (844 × 390, touch); drive the game via `window.__PP__` or `?autoplay=`; `freeze()` + `advance(n)` for stable screenshots, never `waitForTimeout`.
- **Determinism:** the bot and the sim never see real time; the client loop owns speed, freeze and pause.
- **Errors and logs:** `Result` at I/O boundaries, every fallback a `warn`, `log.<level>(channel, …)`, no `console.*`, no silent `catch`.
- **Naming:** `create<Name>` factories, files named after their main export, unit suffixes, constants in `shared/constants.ts`, `describe/it/expect` from `vitest`.

### Deferred items this story touches (update `deferred-work.md`)

- 1.11 / 1.12, « `?threats=off` is a test switch »: **kept** (`loadLevel` does not strip threats; specs still use it to get a quiet room). Note it.
- 1.9, « a per-frame proof of Papa's motion still needs `window.__PP__` »: **tools now exist** (`freeze` + `advance` + `state`); the specs are not migrated here.
- 1.11, « the e2e suite does not cover the gag's lights and hair, the baby lift, nor the `boot.ts` glue with the outlet live »: **tools now exist**; still open.
- 1.11, « `threat.spec.ts` taps inside a window of a few hundred ms in real time »: **tools now exist** (`freeze` + `advance` + `send`, or the frozen icon point); still open, not migrated.
- 1.12, « the human bot's reaction floor reads `threat.enteredAt` »: **does not apply to autoplay** (bots start at sim time 0, D8); still open for a mid-level bot.
- 1.3, « Effective feel in `World` » (2.1): unchanged; add that `__PP__.setFeel` restarts the level until then (D16).

### Deferred by this story

- **`setFeel` restarts the level** (D16): story 2.1 replaces it with the journaled `SetFeel` command, applied at the next step without a restart; the patched feel then also reaches the input mapper.
- **Screenshot references are per OS** (`darwin` from the Mac, `linux` from Docker `linux/amd64`): any content or art change means refreshing both. A script wrapping the Docker command is not worth it yet; add one if refreshing becomes frequent.
- **Autoplay is silent** (D12): a « play with sound » option would need a gesture; not needed for agents.
- **Existing specs still read the `data-pp-*` mirrors**; migrate them to `__PP__` when the e2e suite is reworked (with the 1.9 « E2E brittleness » item), not one by one.
- **`__PP__` in a playtest build without `?debug=1` and in production is not e2e-tested** (e2e runs on the dev server): story 1.24 (bundle inspection, perf spec on the build).

### Open points for Geo (do not block the dev)

1. **`setFeel` restarts the level** (same seed) until story 2.1 brings the `SetFeel` command (D16). OK for tests in the meantime?
2. **Autoplay skips the start screen and is silent** (D11, D12), and the player's taps are ignored while a bot plays (pause still works). OK?
3. ~~Screenshot references for Linux CI~~ — **settled 2026-10-27**: Geo installed Docker; the `linux` references are generated in the Playwright image (`linux/amd64`) and the screenshot check is required on both OS.
4. **`?speed` capped at 4** (D3) to stay under the loop's 10 steps per frame at 60 Hz.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.13 : Autoplay et API de test dans le navigateur], and around it [#Story 1.12] (the bots), [#Story 1.14] (hitstop, `freezeRealMs`), [#Story 1.24] (prod bundle without `__PP__`, perf spec with the human bot), [#Story 2.1] (`SetFeel`, feel panel), [#Exigences › FR66, NFR13]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Automatisation], [#Boucle de jeu et modèle de temps] (accumulator, `timeScale`, hitstop, pause), [#Outils de debug] (activation: dev, `?debug=1`, store builds), [#Contrats d'API (internes)] (`PPTestApi`), [#Frontières d'architecture] (client → bots / debug by dynamic import only), [#Arborescence] (`src/debug/testApi.ts`, `tests/e2e/autoplay.spec.ts`), [#P6 — Réglage à chaud du feeling], [#Architecture de sécurité] (no `__PP__` in store builds)
- [Source: _bmad-output/project-context.md] (Testing Rules › E2E, Platform & Build Rules › Build flavors, Code Organization Rules › layers, Critical Don't-Miss Rules)
- [Source: _bmad-output/implementation-artifacts/1-12-bots-et-simulation-en-masse.md] (D3 contract, D4 bot RNG, `playGame`, CLI, Debug Log on e2e in the container), [1-11-parer-la-prise-electrique-au-tap.md] (`?threats=off`, threat mirrors), [deferred-work.md]
- Code: `src/client/{boot,loop}.ts`, `src/client/app/{levelSession,threatsSwitch,forcedThrow,appFsm,pauseController,clientEvents}.ts`, `src/client/audio/audioEngine.ts` (`preload` warning without context), `src/client/input/inputMapper.ts` (`getActive`), `src/client/render/levelScene.ts` (VFX on the sim clock), `src/bots/{bot,createBot,playGame}.ts`, `tools/sim/runSim.ts` (`responsesOf`), `src/sim/{index,commands,createSim}.ts`, `src/content/schemas/feel.ts`, `src/shared/{constants,hash}.ts`, `tests/e2e/support/game.ts`, `tests/e2e/threat.spec.ts`, `tests/tools/sim/cli.test.ts`, `tests/architecture/{layerBoundaries.test,scanners}.ts`, `biome.json` (client / boot overrides), `playwright.config.ts`, `.github/workflows/ci.yml`

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- **T0 baseline** (commit `ea24864`, Geo's Mac, Apple Silicon): `npm run ci` green on the untouched tree once `VITE_DEBUG_ALLOWED` was unset in the shell: typecheck, lint, `content:check`, 145 test files / **2003 unit tests**, **140 e2e** (1 min 45 s), `build:playtest`.
  - **First baseline run was red on e2e (6 of 140 passed) and it was not WebGL**: the agent shell exports `VITE_DEBUG_ALLOWED=false`, and a process env var beats `.env.development` in Vite, so the dev server had no `data-pp-*` mirrors and every spec timed out on `data-pp-app="start"`. A probe showed `webgl: true` in chromium and webkit. Every e2e / dev-server / `npm run ci` command of this story was run with `unset VITE_DEBUG_ALLOWED`. **The 1.12 note « 134 of 140 e2e fail, likely no WebGL in the container » (deferred-work.md) probably had this same cause**: worth rechecking.
- **Final**: `npm run ci` green: 150 test files / **2088 unit tests** (+85), `src/sim` coverage thresholds met, **172 e2e** (+32: 10 in `autoplay.spec.ts`, 22 in `testApi.spec.ts`, both browsers; 2 min), `build:playtest`.
- **AC 2 (same game as headless)**: passes in chromium **and** webkit, no loosening. The browser's frozen world at the first response (`?autoplay=perfect&seed=42&speed=4`) hashes to the CLI's `runList[0].worldHash` for the same `--until-ms`.
- **Screenshot stability**: `autoplay.spec.ts --repeat-each 4` on the Mac: 40 / 40 green with the committed `darwin` references. The `linux` references were made in Docker (`linux/amd64`, `mcr.microsoft.com/playwright:v1.64.1-noble`, 51 s including the pull); WebGL worked in the container for both browsers. I opened all four PNGs: each shows the greybox living room with the outlet's icon and halo (telegraphed) and the pause button.
  - **Deviation from the story's Docker command**: I added `-v pp-node-modules:/work/node_modules` (a named volume), so the container's `npm ci` does not overwrite the Mac's `node_modules`; no `npm ci` was needed afterwards. Also `docker` needed `PATH="$HOME/.docker/bin:$PATH"` (the credential helper lives there), not only the CLI path. The volume `pp-node-modules` is left on Geo's Docker (`docker volume rm pp-node-modules` to remove it).
- **T9 by hand**:
  - `npm run build` (production) then `grep -rl "__PP__\|createPerfectBot" dist/` → **no match** (exit 1). `dist/assets` holds only `index`, `gltf`, the geometry chunk and the CSS: no `autoplay` / `testApi` chunk. (A looser `grep autoplay` matches two harmless strings: a description in the `bots.json` schema and the `{ autoplay: null }` constant of the params.) The playtest build does have `dist/assets/testApi-*.js`.
  - `/?autoplay=human&seed=42&speed=4` in the dev server, chromium and webkit, 30 s of sim: the level starts by itself (`start → loading → level`), silent; four outlets, answered at 5420 ms `perfect`, 12 870 `perfect`, 20 300 `perfect`, 27 890 `success`; **no gag**; identical in both browsers. Chromium logged one `[sim] frame stall: dropped 300 ms of sim backlog` (first-frame GPU stall at ×4); it changes when the game reaches a sim time, never what happens.

### Implementation Plan / Decisions

- Followed D1 to D18 as written. Where the story left a choice:
  - `LevelSession.current.seed` is the seed of the level that last **began** (`null` before the first); `levelId` and `feel` are the last **requested**. `setFeel` reuses it for « same id and seed »; « Recommencer » / « Réessayer » take a fresh seed (or `?seed`).
  - `beforeStep` is given to each loop as is (a stable function in `boot.ts` that reads the swappable `stepHook`), instead of wrapped again in the session.
  - `onLevelStarted` fires after the loop is created and the freeze wish applied, just before the pause/resume pair and `appFsm.enter('level')`: once per level that really starts (not on `failed` / `stale`).
  - `FeelPatch` and `DeepPartial` live in `src/debug/feelPatch.ts` and are re-exported from `testApi.ts`.
  - The availability rule of `window.__PP__` is a pure function, `isTestApiEnabled`, in `debugParams.ts`, so the « playtest without `?debug=1` » and « production » cases are unit-tested.
  - `setFeel` with no level running rejects (`no level is running`) instead of starting one.
  - **D12 generalised to « no start gesture »**: in debug builds `loadAudio` skips the preload and logs one `info` whenever `audio.state === 'none'` (autoplay, but also `__PP__.loadLevel` from the start screen), otherwise the existing `[audio] preload skipped` warning would fail `collectProblems` in every spec that loads a level through the API. A start by gesture unlocks audio first, so existing behaviour is unchanged.
  - A `loadLevel` sent while a level start is already in flight (e.g. right after an autoplay page opens) is `ignored` and rejects (D17); `autoplay.spec.ts` waits for the level to exist, then freezes, then loads.
- Test support added: `tests/support/fakeTestHost.ts` (a `TestHost` fake for the debug modules' unit tests).

### Completion Notes List

- ✅ T0: baseline measured (see above), including the discovery that the shell's `VITE_DEBUG_ALLOWED=false` makes the e2e suite look red.
- ✅ T1: `src/client/app/debugParams.ts` (`readDebugParams`, `isTestApiEnabled`) + 13 tests; `PLAY_SPEED_MAX`, `ADVANCE_MAX_STEPS`, `TEST_API_EVENT_LOG_MAX` in `shared/constants.ts`.
- ✅ T2: loop `speed`, `beforeStep`, `setFrozen` / `isFrozen`, `advance` with one shared `runStep()`; 17 new cases in `loop.test.ts`, the 31 existing ones untouched.
- ✅ T3: `levelSession.start(options?)` → `LevelStartOutcome`, `onLevelStarted`, `current`, `freeze`, `advance`, `isFrozen`, `speed`, `beforeStep`; 13 new cases, existing ones untouched.
- ✅ T4: `src/client/app/testHost.ts` (interface only), built in `boot.ts` in debug builds only.
- ✅ T5: `botResponsesOf` moved to `src/bots/botResponses.ts`; `runSim.ts` imports it (the only change to `tools/sim`); `tests/tools/sim/*` and `tests/bots/*` unchanged and green.
- ✅ T6: `src/debug/autoplay.ts` + test: 4 000 steps through the hook give the same journal and `hashJson(world)` as `playGame` for `perfect` and `human`; unknown id is an `err` naming `perfect, human, random, idle`; a new bot per level. `boot.ts` loads it by a literal dynamic `import()` behind the flag, blocks the game input (D11), starts the level itself.
- ✅ T7: `src/debug/feelPatch.ts`, `src/debug/testApi.ts` + tests (every method, every error, the event cap through `eventLogMax`, the `events(since)` cursor, the copy in `state()`).
- ✅ T8: `tests/e2e/support/testApi.ts`, `autoplay.spec.ts` (5 tests), `testApi.spec.ts` (11 tests), `playwright.config.ts` snapshot template and defaults, four screenshot references (`darwin` and `linux` × chromium and webkit).
- ✅ T9: `CLAUDE.md` (two rows), `project-context.md` (one line), `boot.ts` comment, `deferred-work.md`; final CI and the by-hand checks above.
- **Nothing else moved**: `src/sim/**` untouched, no golden regenerated, every existing e2e spec untouched and green. **Existing tests edited**: `src/client/loop.test.ts` (the `createRig` helper takes `speed` and `beforeStep`; new cases appended) and `src/client/app/levelSession.test.ts` (new cases appended, two imports); no existing assertion changed.
- Variances from the architecture's `PPTestApi`, stated in the story and in the module's doc comment: `state()` may be `null` and is a copy; `events` returns a copy; `send` accepts a missing `t`; `setFeel` returns a promise and restarts the level.

### File List

New:
- `src/client/app/debugParams.ts`, `src/client/app/debugParams.test.ts`
- `src/client/app/testHost.ts`
- `src/bots/botResponses.ts`, `src/bots/botResponses.test.ts`
- `src/debug/autoplay.ts`, `src/debug/autoplay.test.ts`
- `src/debug/feelPatch.ts`, `src/debug/feelPatch.test.ts`
- `src/debug/testApi.ts`, `src/debug/testApi.test.ts`
- `tests/support/fakeTestHost.ts`
- `tests/e2e/support/testApi.ts`
- `tests/e2e/autoplay.spec.ts`, `tests/e2e/testApi.spec.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-chromium-darwin.png`, `…-webkit-darwin.png`, `…-chromium-linux.png`, `…-webkit-linux.png`

Modified:
- `src/client/boot.ts`
- `src/client/loop.ts`, `src/client/loop.test.ts`
- `src/client/app/levelSession.ts`, `src/client/app/levelSession.test.ts`
- `src/shared/constants.ts`
- `tools/sim/runSim.ts` (import only)
- `playwright.config.ts`
- `CLAUDE.md`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-13-autoplay-et-api-de-test-dans-le-navigateur.md`

Deleted:
- `src/debug/.gitkeep`

### Review Findings

Code review of commit dbbc2be (2026-10-27): Blind Hunter, Edge Case Hunter, Acceptance Auditor. 8 findings dismissed as noise or already blessed by the spec.

- [x] [Review][Decision] `setFeel` is applied to the sim, scene and bot but not to the client input (`createMoveIntent` / input mapper keep the boot feel): reject `input.*` patches in `applyFeelPatch`, document the limit only (story 2.1 already plans the full fix), or rebuild the client input on a patched level? [src/client/boot.ts:564, src/client/boot.ts:578, src/debug/feelPatch.ts] → Resolved: documented, and `setFeel` logs one `warn` when a patch touches `input` (story 2.1 brings the full fix; rejecting `input.*` would also forbid `holdMinMs`, which the bot reads).
- [x] [Review][Decision] `speed` doc and D3 say the hitstop payment is scaled by `speed`, but the code pays `consumedMs` in unscaled real ms (at ×4 a 100 ms hitstop lasts 400 ms of sped-up time). Fix the comment and D3, or scale the payment? No test covers speed with a pending hitstop; matters when story 1.14 lands hitstop. [src/client/loop.ts:~81-85 vs ~150-160] → Resolved: the code follows D3, the hitstop is paid in sped-up time (`dtSpedMs`); test added.
- [x] [Review][Decision] `?speed=4` assumes ≥ 40 fps: any frame over 25 ms at ×4 owes more than `MAX_STEPS_PER_FRAME` (10) steps, the rest is dropped and sim time runs below ×4 (e2e `FIRST_RESPONSE_TIMEOUT_MS` assumes a true ×4, so a slow CI frame rate can time out). Raise the per-frame cap when `speed > 1` (`MAX_STEPS_PER_FRAME * speed`), or document `min(speed, 10 steps / frame)` and size the e2e timeouts? [src/client/loop.ts:162, src/shared/constants.ts:163] → Resolved: the cap is `ceil(MAX_STEPS_PER_FRAME * speed)`; test added.
- [x] [Review][Decision] `events(since)`: `since` is an absolute index but the API never exposes the absolute count; after the 50 000-event cap (`firstIndex` > 0) `events(prev.length)` re-delivers seen events and an old cursor jumps forward silently. Add `eventCount()` / return `{ events, next }`, throw when `since < firstIndex`, or accept it (the pinned contract and the 50 000 cap)? [src/debug/testApi.ts:~2205, ~2242-2247] → Resolved: accepted and deferred (pinned contract, one `warn` at the cap); see `deferred-work.md`.
- [x] [Review][Decision] Debug builds skip `audio.preload` whenever `audio.state === 'none'` (also after a failed `unlock()`, and for a human tap after `__PP__.loadLevel` from the start screen), and the info message differs from D12. Preload on `StartGestureReceived`, skip only when no unlock was ever attempted, or keep the documented generalisation? [src/client/boot.ts:441-456] → Resolved: kept (documented in the Dev Agent Record and `deferred-work.md`; debug builds only, a human tap after `__PP__.loadLevel` is not a supported flow).
- [x] [Review][Patch] `start()` commits `requested.levelId` / `requested.feel` before the load can fail or go stale (and `requested.seed` before the stale check): after `__PP__.loadLevel('nowhere', 1)` the « Oups » retry and « Recommencer » reload `nowhere` forever, `session.current` reports the failed level. Commit `requested.*` only on `'started'`. [src/client/app/levelSession.ts:216-217, :286]
- [x] [Review][Patch] `levelSession.advance()` sets `isFrozenWish = true` before `loop.advance(steps)` validates the count: a bad `steps` leaves `isFrozen === true` on a running loop and every later level starts frozen. Set the wish after `loop.advance` returns, and add the test. [src/client/app/levelSession.ts:198-202]
- [x] [Review][Patch] A throwing `onLevelStarted` listener leaves the app in `loading` (no « Oups », an unhandled rejection under autoplay's `void levelSession.start()`): wrap the call, `log.warn` and go to `oops`. [src/client/app/levelSession.ts:~796 of the diff, src/client/boot.ts:~907]
- [x] [Review][Patch] `await import('@debug/autoplay')` and `await import('@debug/testApi')` are unguarded: a failed chunk or a broken debug module aborts `boot()` with a blank page. `try/catch`, `log.warn`, and carry on to the start screen. [src/client/boot.ts:997, :1020]
- [x] [Review][Patch] Autoplay leaves the game input blocked when `createBot` fails for a later level (the hook is removed, `setGameInputBlocked(true)` stays): unblock input on that path and assert both the `warn` and the unblock in the « removes the hook and says so » test. [src/debug/autoplay.ts:~1587-1601]
- [x] [Review][Patch] Dead and redundant surface (done: unused `TestHost` members, fake members, the re-export and the comment removed; `isTestApiEnabled`'s `isDebugAllowed` kept on purpose, it is the unit-tested predicate and the literal `VITE_DEBUG_ALLOWED` check in `boot.ts` must stay for tree-shaking): `TestHost.appState` / `onAppStateChanged` (and the fake's `setApp` / `fireAppStateChanged`) are unused; `isTestApiEnabled({ isDebugAllowed: true })` is vacuous at its only call site in `boot.ts`; `isMirrored` is reused to mean « debug allowed »; `fakeTestHost.ts` ends with a pointless `export type { StartedLevel }`; the « eslint-free fake » comment in `testApi.test.ts` is wrong (no ESLint in this project). [src/client/app/testHost.ts, src/client/boot.ts:1011-1019, tests/support/fakeTestHost.ts, src/debug/testApi.test.ts]
- [x] [Review][Patch] `events()` returns `entries.slice(...)`, a new array of the same event objects, while the doc and test say « a copy »: copy the events (or fix the doc) and test an in-page mutation. [src/debug/testApi.ts:~2246]
- [x] [Review][Patch] `playwright.config.ts` comment says « more than 1 % is not deterministic » but `maxDiffPixelRatio` is `0.002`: align the comment. [playwright.config.ts:12-14]
- [x] [Review][Patch] The Docker command for the Linux screenshot references still points at the original recipe (it overwrites the Mac's `node_modules`); carry `-v pp-node-modules:/work/node_modules` and `PATH="$HOME/.docker/bin:$PATH"` into Dev Notes › Screenshots and the CLAUDE.md row (see the memory note `story-1-13-screenshot-refs`). [story Dev Notes, CLAUDE.md]
- [x] [Review][Defer] `__PP__.loadLevel` / `setFeel` (`startAndWait`) wait for `GameResumed` with no timeout and leave an `onGameResumed` listener when the page is in portrait or hidden — deferred, already listed in `deferred-work.md` (« `__PP__.loadLevel` waits for the countdown »), not a concern for agents [src/debug/testApi.ts:~2219-2234]
- [x] [Review][Defer] Event log at the cap does `splice(0, excess)` on 50 000 entries per event (O(n)) and `advance(360 000)` runs the whole `onSimEvent` path synchronously — deferred, ring buffer / yielding only if a spec hits it [src/debug/testApi.ts:~2202-2206]
- [x] [Review][Defer] A frozen frame renders `alpha = accumulatorMs / STEP_MS`: freezing after live play gives a leftover interpolation, so a screenshot is only deterministic after `loadLevel` (what the spec does) — deferred, the e2e avoids it [src/client/loop.ts:~1398]
- [x] [Review][Defer] Blocking input through `getActive() → null` also makes `inputMapper.isLive()` false, so move-key `preventDefault` is skipped during autoplay (arrow keys can scroll the page) — deferred, harmless in the specs [src/client/input/keyboardInput.ts:114]
- [x] [Review][Defer] D2 (`?seed` reused on restart), D11 (input ignored under autoplay) and D12 (silent autoplay) have no automated test: `boot.ts` glue has no unit test — deferred, joins the 1.11 « `boot.ts` glue » item [src/client/boot.ts]
- [x] [Review][Defer] `levelStartedListeners` / `simEventListeners` dispatch in `boot.ts` is not removal-safe (the fake host copies the array) — deferred, no subscriber unsubscribes today [src/client/boot.ts:~889, ~938]

## Change Log

- 2026-10-27: Story 1.13 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
- 2026-10-27: Open point 3 settled (Docker installed): Linux screenshot references made in Docker `linux/amd64`, no skip path.
- 2026-10-27: Story 1.13 implemented (review). Autoplay (`?autoplay=<bot>&seed=&speed=`) and `window.__PP__` in the browser; loop `speed` / `beforeStep` / freeze / advance; level session start options; `botResponsesOf` shared with the CLI; 32 new e2e tests and four screenshot references (darwin and linux); no sim change, no golden regenerated.
- 2026-10-27: Code review of 1.13 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 5 decisions resolved, 9 patches applied (`current` committed only on a started level, `advance` freezes after validation, a throwing `onLevelStarted` goes to « Oups », guarded debug imports, autoplay gives the input back, `events()` copies, loop step cap grows with `speed` and the hitstop is paid in sped-up time, `setFeel` warns on `input`, doc fixes), 6 items deferred. `npm run ci` steps re-run on the Mac: lint, typecheck, content check, 2093 unit tests with coverage, 172 e2e green (chromium and webkit). Status `done`.
