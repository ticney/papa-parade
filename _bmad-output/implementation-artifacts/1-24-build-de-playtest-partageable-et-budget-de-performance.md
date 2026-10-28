---
baseline_commit: 659150d
---

# Story 1.24: Shareable Playtest Build and Performance Budget

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.24 « Build de playtest partageable et budget de performance » (L1184-1216). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As Geo,
I want to send a link to testers and know that the game holds 60 FPS,
so that I can start the prototype's playtests.

**Requirements covered:**
- **FR67 (epics L134):** a web build can be shared by link for playtests.
- **NFR1 (L141):** 60 FPS stable on mid-range phones (iPhone 12, a 2021 Android) over a full level.
- **NFR2 (L142):** at most 50 ms from a tap to the visual feedback.
- **NFR3 (L143):** a level loads in under 5 s on 4G.
- **NFR14 (L154):** no personal data, no backend.
- **UX-DR1 (L215), fonts and CSP:** three self-hosted woff2 families (already done in 1.5), served under `font-src 'self'`.
- **UX-DR26 (L258-261):** the UI performance budget. Tap → visual ≤ 50 ms, measured on real devices here.

**Sources:**
- Epics `epics.md`:
  - L1184-1216: the story itself.
  - L201-209: build, deploy, CSP and performance budgets.
  - L1232-1235: story 2.1, the full debug overlay (Tweakpane, timeline, draw calls panel). **Not this story.**
  - L1355-1357 (2.5) and L2366 (7.1): later stories keep `perf.spec.ts` green.
- Architecture `game-architecture.md`:
  - L420-434: debug tools and how they are switched on (always in dev, `?debug=1` in playtest, stripped from store builds).
  - L528-531: `src/debug/` holds `perfPanel.ts`, `testApi.ts`, … loaded by dynamic `import()`.
  - L657-658: `client` may import `debug` only from `boot.ts`, by a guarded dynamic import.
  - L1069-1075: security. CSP `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (Rapier), `font-src 'self'`; HTTPS; no request to another domain.
  - L1077-1099: the performance table (draw calls ≤ 100, triangles ≤ 100 000, adaptive DPR 2 → 1.5 → 1 when the mean frame time exceeds 18 ms for 2 s, level ≤ 3 MB, tap → visual ≤ 50 ms) and `perf.spec.ts` (bot `human`, a full level, fails if p95 frame time > 20 ms on the CI machine; real devices are measured by hand with `?debug=1`).
  - L1101-1112 and L1148: deployment. Cloudflare Pages or Netlify, chosen at the first deployment; one URL per version; `base: './'`.
- UX:
  - `EXPERIENCE.md` L476-487: the UI performance budget (UX-DR26).
  - `EXPERIENCE.md` L245 and L406: no network calls; debug is stripped from store builds (story 1.24).
  - `EXPERIENCE.md` L549-562: Flow 2, « Priya, on the playtest link ». The tester is on a laptop browser.
  - `DESIGN.md` L433: self-hosted woff2 fonts. `DESIGN.md` has no design for the debug overlay.
- GDD `gdd.md`: L451-459 (performance, the playtest link), L505-522 (technical and playtest indicators).
- `project-context.md` L76-85 (performance rules), L131 (real-device checks gate the playtest), L141-144 (build flavors, static hosting, CI).
- Deferred to this story by earlier stories, in `deferred-work.md` and in the story files:
  - 1.1 L154: CI never runs `npm run build`, and e2e only runs on the dev server.
  - 1.4 D10 (L43): adaptive DPR.
  - 1.4 L55, 1.6 L98, 1.15 L483: bundle size. Rapier's chunk is 1.68 MB gzip.
  - 1.13 L225 / L313: `__PP__` in a playtest build without `?debug=1`, and in prod, was checked only by hand on `dist/`.
  - 1.13 L284: « the FPS counter of `?debug=1` is story 1.24 ».
  - 1.22 D10: the prod bundle must hold no « Copier le journal ».
  - 1.9 L143, 1.17 L305, 1.11 L197: real-device audio, pad-only start, and tap latency, for the device pass.

## Precondition (check first, stop if it fails)

1. This branch was cut from `main` at `659150d` (1.22 merged). **Story 1.23 (« Fermeté ») is `backlog` and independent.** If 1.23 is merged into `main` before this story finishes, run `git merge main` before the review. Conflicts are likely only in `tests/e2e/support/*`, `CLAUDE.md` and `sprint-status.yaml`.
2. Run `env | grep VITE_`. The agent shell exports `VITE_DEBUG_ALLOWED=false` (CLAUDE.md › Trap). T1 pins the flag in the two build scripts. `dev`, `e2e` and `ci` still need `(unset VITE_DEBUG_ALLOWED; …)`.
3. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit**, and let it finish.
   - **Do not edit anything while it runs.**
   - Note the unit and e2e counts in the Debug Log.
   - If the baseline is red, stop and say so.
   - Under heavy load, use `--maxWorkers=5` / `--workers=4` and say so.

## Acceptance Criteria

### A. The two builds

1. **The flag is pinned by the scripts, not the shell.**
   - `"build": "VITE_DEBUG_ALLOWED=false vite build"`.
   - `"build:playtest": "VITE_DEBUG_ALLOWED=true vite build --mode playtest"`.
   - A process env var beats `.env*` in Vite, so an exported shell value can no longer flip a build (D2).
   - `vite.config.ts` gains `build: { manifest: true }`. `dist/.vite/manifest.json` then lists every source module of every chunk; the dist check reads it (AC 4).
2. **`public/_headers` holds the security headers, for every path** (D1). It is the single source: the hosts read it from the published folder (Cloudflare Pages and Netlify use the same format), and the local server of AC 5 applies it.
   ```
   /*
     Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self'; object-src 'none'; base-uri 'self'
     X-Content-Type-Options: nosniff
     Referrer-Policy: no-referrer
   ```
   - The three directives of the epic are required as written. `object-src 'none'` and `base-uri 'self'` are free hardening (D1).
   - No `'unsafe-inline'` and no `'unsafe-eval'`. The code has had no inline `<style>` or `style=""` since 1.1. `element.style.x = …` through the CSSOM (CSS2DRenderer) is not blocked by CSP.
3. **« Copier le journal » cannot reach the prod bundle.**
   - In `resultScreen.ts`, the copy button is built only when `import.meta.env.VITE_DEBUG_ALLOWED === 'true' && options.copyLog !== undefined`. Use a literal comparison so that Vite folds it and tree-shakes the branch.
   - Today the `copyLog` property name is in the prod chunk (checked while writing this story: `grep copyLog` hits `index-*.js` in prod).
   - The unit test « renders no Copier le journal without a copyLog action, and one with it » stubs the flag with `vi.stubEnv('VITE_DEBUG_ALLOWED', 'true')`, then `vi.unstubAllEnvs()`. Add one case: with the flag `'false'`, a `copyLog` action renders no button.
4. **`tools/build/checkDist.ts` inspects a built `dist/`** (`npm run dist:check -- --flavor prod|playtest [--dir dist]`). It exits 1 and lists every problem.
   - A pure `inspectDist(files, flavor)` holds all the logic. It takes the manifest, the file list with sizes, the text of each JS chunk, `index.html` and `_headers`. A thin CLI reads the disk. Unit tests go in `tests/tools/build/checkDist.test.ts`, on in-memory fixtures.
   - **Both flavors:**
     - `_headers` exists and its CSP for `/*` holds the three required directives exactly as in AC 2.
     - `index.html` loads nothing from another origin: no `src` or `href` starting with `http:`, `https:` or `//`.
     - **Level payload (the epic's « test sur `dist/` »):** for each level in `content/levels/`, `dist/assets/levels/<id>.glb` plus every file under `dist/assets/audio/` is at most `LEVEL_PAYLOAD_MAX_BYTES` (3 MiB, `shared/constants.ts`). All the audio is preloaded with the level today, so all of it counts.
     - The CLI prints the level payload and the **first-load gzip total** (`index.html`, the entry JS and CSS, every chunk the manifest reaches from the entry through static or dynamic imports, minus `src/debug/**` and `src/bots/**`, the fonts, plus the level payload). The first-load total is printed, not asserted (D9).
   - **`--flavor prod`:**
     - No manifest entry whose `src` starts with `src/debug/` or `src/bots/`, or contains `node_modules/tweakpane`.
     - No JS chunk contains `__PP__`, `installTestApi`, `installAutoplay`, `installPerfHud` or `copyLog`.
   - **`--flavor playtest`:** the manifest *does* hold `src/debug/testApi.ts`, `src/debug/autoplay.ts` and `src/debug/perfHud.ts`, and some chunk contains `__PP__`.
     - This proves the prod markers are real: if a module is renamed, the playtest check fails first and the marker list gets updated.
   - Unit tests cover:
     - a clean prod tree passes;
     - each prod marker, each forbidden manifest `src`, a missing or weak CSP, an external `index.html` URL and an overweight payload each fail with their own message;
     - a playtest tree without `testApi` fails.

### B. The playtest build, served and played

5. **`tools/serve/serveDist.ts` serves a built folder like the host does** (`npm run serve:dist -- [--dir dist] [--port n] [--host]`).
   - It is a small `node:http` static server. Use no new dependency.
   - It applies the rules of `<dir>/_headers`. A pure `parseHeaders(text)` / `headersFor(rules, path)` pair holds the logic and is unit-tested: a `/*` rule, a specific path, comments, a bad line.
   - It serves `index.html` for `/` and gives correct MIME types: `.js` `text/javascript`, `.wasm`, `.woff2`, `.m4a` `audio/mp4`, `.glb` `model/gltf-binary`, `.svg`, `.css`, `.json`, `.html`.
   - It returns 404 for a missing file and refuses a path that escapes the folder (`..`).
   - With `--host`, Geo can open it from a phone on the LAN. Note in CLAUDE.md that the gamepad needs HTTPS, so it does not work over the LAN (deferred-work L116).
6. **A second Playwright config runs on the built playtest bundle:** `playwright.dist.config.ts`, `testDir: 'tests/e2e-dist'`, `npm run e2e:dist`.
   - `webServer` runs `tsx tools/serve/serveDist.ts --port <port>` on the existing `dist/`. It does **not** build. Before Playwright starts, the script runs `npm run dist:check -- --flavor playtest`, so a missing or prod `dist/` fails with a clear message (D4).
   - The port: move `e2ePort()` from `playwright.config.ts` to `tests/e2e/support/e2ePort.ts`. Both configs import it. The dist port is `e2ePort() + DIST_PORT_OFFSET` (1000), or `PP_E2E_DIST_PORT`. The main checkout and worktrees stay distinct, as in CLAUDE.md › Git workflow.
   - Projects:
     - `dist-chromium` and `dist-webkit` (the existing landscape phone viewport) run `dist.spec.ts`;
     - `perf` (chromium only) runs `perf.spec.ts` (D6).
   - **Live mode:** with `PP_DIST_URL=https://…`, there is no `webServer`, `baseURL` is that URL, and only `dist.spec.ts` runs. This is how the deployed build is checked (AC 12).
7. **`tests/e2e-dist/dist.spec.ts`** (both browsers), on the served playtest build:
   - **Plays end to end:** `/?autoplay=perfect&seed=1&speed=4&debug=1` reaches `data-pp-app="result"`, with a `LevelScored` read through `__PP__.events()`. Use the timeout of the level's live `durationMs` / 4 plus margins (as in `game.ts`).
   - **No CSP violation and no cross-origin request:**
     - a `securitypolicyviolation` listener is added by `page.addInitScript` and its records are read at the end; the list is empty;
     - every `page.on('request')` URL has the page's origin;
     - `collectProblems(page)` is empty.
     - The served response of `/` carries the CSP header of `_headers`.
   - **`?debug=1` shows the FPS counter** (AC 9): `.pp-debug-perf` is visible and its text matches `/\d+ FPS/` and `/\d+(\.\d)? ms/` after a few frames of the level.
   - **Without `?debug=1`:** after the start screen is up, `window.__PP__` is `undefined` and `.pp-debug-perf` does not exist. This closes deferred-work L225 for the playtest flavor. Prod is covered by AC 4.
   - **A human start works with no test API:** `/` (no params), tap « Jouer », and `data-pp-app` reaches `level`. The `data-pp-*` mirrors exist in every debug-allowed build (`isMirrored`), with or without `?debug=1`. `audioState(page)` (`support/game.ts`) reads a mirror and needs no `__PP__`; a tap start must leave it `running`.
8. **`tests/e2e-dist/perf.spec.ts`** (`perf` project, chromium, serial), on the served playtest build:
   - Opens `/?autoplay=human&seed=1&speed=1&debug=1`. **Speed 1 is real time:** speed changes the steps per frame, so it must stay 1 for honest numbers.
   - Waits for `data-pp-app="result"`. The timeout is `durationMs` + countdown + `OVERRUN_MARGIN_MS` + loading margin; `test.setTimeout` sets it, about 4 min for the 180 s level.
   - Reads `await __PP__.perf()` (AC 10) and asserts:
     - `frames ≥ durationMs / 1000 × PERF_MIN_FPS_SAMPLED` (30): the measure really ran;
     - `frameMsP95 ≤ FRAME_P95_MAX_MS` (20);
     - `drawCallsMax ≤ DRAW_CALLS_MAX` (100);
     - `trianglesMax ≤ TRIANGLES_MAX` (100 000).
   - The three budgets move to `shared/constants.ts` (`FRAME_P95_MAX_MS`, `DRAW_CALLS_MAX`, `TRIANGLES_MAX`). `level.spec.ts`, `props.spec.ts` and `threats.spec.ts` import them instead of their local copies.
   - Attaches the full `perf()` report to the test (`testInfo.attach('perf.json', …)`) and logs one line, so the numbers are visible on a green run. Paste them in the Debug Log.
   - **The perf run is alone on the machine's Playwright.** `e2e:dist` runs two invocations in sequence: first `--project dist-chromium --project dist-webkit`, then `--project perf --workers=1`. So the dist specs never share the CPU with the measure.
     - The machine is shared with other worktrees (CLAUDE.md › Git workflow). If p95 fails while another CI runs, rerun `perf` alone before concluding, and say so.
   - **The level is 180 s** (`salon_crawler.json › durationMs`); the architecture's « 5 min » predates the level data. The spec reads the live duration, never a literal.
   - **Never loosen a budget to pass.** If the Mac or the GitHub runner cannot hold 20 ms, stop and tell Geo with the numbers (open point 2).

### C. The FPS counter and the measures (debug only)

9. **`src/debug/perfHud.ts`: `installPerfHud(host, root)`** shows a small counter. It is shown only when `?debug=1` is in the URL (`params.isDebug`), in any debug-allowed build, so plain dev and the screenshot specs do not see it (D5).
   - **Loading:** boot loads it in the existing `VITE_DEBUG_ALLOWED === 'true'` block, by the literal `await import('@debug/perfHud')`, inside `try/catch` with a `log.warn` (like autoplay). The R7 architecture rule allows a literal dynamic import in `boot.ts` only; do not touch the rule.
   - **DOM:** `div.pp-debug-perf[aria-hidden=true]`, a child of `#pp-ui`, fixed at the bottom-left inside the safe area. `pointer-events: none`, so it never steals a tap. Text at `var(--pp-spacing-text-min)`, `ink` on `paper`, the sticker outline.
   - **Style:** in `src/debug/perfHud.css`, imported by `perfHud.ts`. Vite emits it in the debug chunk; no inline style (CSP).
   - **Text:** `60 FPS · 16.7 ms · p95 17.0 ms · DPR 2`:
     - FPS is the frame count of the last full second;
     - ms is the mean frame interval of that second;
     - p95 is the level's frame-interval p95 so far (AC 10);
     - DPR is the renderer's current pixel ratio (AC 11).
   - **Rewrite cadence:** the text is rewritten at most every `PERF_HUD_REFRESH_MS` (250 ms), and only if it changed. It stays up, frozen, on the Result screen, so Geo reads the level's p95 there for `device-measurements.md`.
   - It is not localized prose: « FPS », « ms », « p95 » and « DPR » are units, and `src/debug` is outside the UI string scanner. Keep it that way.
10. **`src/debug/perfMeter.ts`: `createPerfMeter()`** is pure and allocates nothing per frame.
    - `frame(frameAtReal, drawCalls, triangles)`:
      - the frame interval is `frameAtReal − previous`;
      - the first frame after a `reset()` or after `skipNextInterval()` gives no interval.
    - `reset()`: called on each `onLevelStarted`.
    - `skipNextInterval()`: called when the page becomes hidden or visible again, so a hidden tab is not a 30 s frame.
    - **p95 comes from a fixed histogram.** Buckets are `PERF_BUCKET_MS` wide (0.1 ms) up to `PERF_HISTOGRAM_MAX_MS` (250 ms), plus one overflow bucket. The reported p95 is the upper edge of the bucket that holds the 95th percentile. That is conservative and exact to 0.1 ms.
    - **The rolling FPS** is the count of intervals in the last whole second, kept as a running count. No array of timestamps.
    - `report()` returns `{ frames, fpsLastSecond, frameMsMeanLastSecond, frameMsMean, frameMsP95, frameMsMax, drawCallsMax, trianglesMax }`. It fills one reused object; `__PP__.perf()` returns a copy.
    - **Unit tests:**
      - a constant 16.7 ms stream gives p95 16.7 ms (bucket edge) and 60 FPS;
      - 94 % at 16 ms with 6 % at 40 ms gives a p95 at 40 ms; 96 % / 4 % gives 16 ms;
      - an overflow interval;
      - `reset` and `skipNextInterval`;
      - max draw calls and triangles;
      - the first frame gives no interval.
    - **The frame source:** `TestHost` gains `onRenderedFrame(listener: (frameAtReal: number, stats: RendererStats) => void): () => void`.
      - `boot.ts` calls the listeners at the end of `onLevelFrame`, after `worldUi.render`, with `performance.now()` and `renderer.stats()`. That object is reused; listeners must not keep it.
      - With no listener, the call costs one length check.
      - Only level frames are measured, since the result and start screens render no level frame. That is what NFR1 measures.
    - **`__PP__` gains `perf(): PerfReport`.**
      - `installTestApi` creates its own meter on `host.onRenderedFrame` / `onLevelStarted`. Two meters (HUD and API) are cheap, and this keeps the modules independent (D7).
      - `testApi.spec.ts` « with its seven methods » becomes eight.
      - No doc lists the methods (CLAUDE.md only says `window.__PP__` drives the game), so no doc changes for `perf()`. Do not edit the architecture doc.
11. **Adaptive pixel ratio** (architecture L1090, deferred by 1.4 D10).
    - `src/client/render/adaptivePixelRatio.ts`: `createAdaptivePixelRatio()` is pure. `frame(intervalMs)` returns the cap to use now.
    - The cap starts at `PIXEL_RATIO_STEPS[0]` (2). The pixel ratio is `min(devicePixelRatio, cap)`, as today with `MAX_PIXEL_RATIO`.
    - **Windows:** intervals are summed over consecutive windows of `PIXEL_RATIO_WINDOW_MS` (2000 ms of real time). At the end of a window, if the mean interval is above `PIXEL_RATIO_SLOW_FRAME_MS` (18), the cap steps down to the next step (1.5, then 1), and a new window starts.
    - **It never steps back up** within the page (D8): no oscillation on a phone that is just warm.
    - `resetWindow()` is called on level start and on `GameResumed`, so the countdown and the frames after a pause start clean.
    - **Constants** in `shared/constants.ts`: `PIXEL_RATIO_STEPS = [2, 1.5, 1] as const`, `PIXEL_RATIO_WINDOW_MS = 2000`, `PIXEL_RATIO_SLOW_FRAME_MS = 18`. `MAX_PIXEL_RATIO` becomes `PIXEL_RATIO_STEPS[0]`, or is removed if nothing else reads it.
    - **Renderer:** `GameRenderer` gains `setPixelRatioCap(cap)`. It stores the cap, reapplies `setPixelRatio(min(dpr, cap))` and `setSize` at the current size, and does nothing if the ratio is unchanged.
      - `pixelRatioFor(dpr, cap)` takes the cap.
      - The resize path uses the stored cap.
      - `renderer.test.ts` is updated.
    - **Boot:** fed from `onLevelFrame` with the same `performance.now()` interval as AC 10, measured in boot, not in debug. It runs in every build.
      - When the cap changes: `log.info('render', 'pixel ratio stepped down', { fromCap, toCap, meanFrameMs })`.
      - In debug builds, mirror `data-pp-pixel-ratio`.
      - The HUD of AC 9 reads the renderer's pixel ratio. `RendererStats` gains `pixelRatio`, filled in `stats()`.
    - **Unit tests:**
      - fast frames never step;
      - a slow window steps 2 → 1.5, a second one 1.5 → 1, and a third stays at 1;
      - a slow half-window followed by `resetWindow()` does not step;
      - the mean is per window, not a moving average.
    - **e2e:** none. The headless viewport has DPR 1. The perf spec still sees any stepping through `pixelRatio` in the report.

### D. Deploy and devices

12. **Deployment is documented and checked.**
    - **CLAUDE.md** gains a short `## Playtest deployment` section (English), and a Commands row for each new script: `dist:check`, `serve:dist`, `e2e:dist`, `deploy:check`. The section covers:
      1. `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, `(unset VITE_DEBUG_ALLOWED; npm run e2e:dist)`.
      2. The deploy command for the host Geo chose (open point 1). Without an answer, write the section for **Cloudflare Pages direct upload** (`npx wrangler@<pinned> pages deploy dist --project-name papa-parade --branch playtest`), with the Netlify alternative (`npx netlify-cli@<pinned> deploy --dir dist --prod`) in one line.
         - No new devDependency.
         - Pin the version you checked at implementation time.
         - Both hosts read `dist/_headers`.
         - Each upload gets its own URL: « une URL par version », architecture L1106.
      3. The first time only: the account login (`wrangler login`). **Geo does this.** An agent never handles his credentials.
      4. `npm run deploy:check -- <url>` (below), then `PP_DIST_URL=<url> npm run e2e:dist`.
      5. Send the URL; testers open it as is. `?debug=1` is for Geo's device pass only.
    - **`tools/deploy/checkDeployment.ts`** (`npm run deploy:check -- <url>`):
      - the URL must be `https:`;
      - `GET <url>` is 200, `GET <url>/_headers` is not served as a file (404 is fine), and the entry JS named in the returned HTML is 200;
      - each response carries the CSP of `public/_headers` (compared with the parsed file, not a copy) and `X-Content-Type-Options: nosniff`.
      - It uses the global `fetch`, and exits 1 with the list of problems. Unit-test the pure comparison (`cspProblems(expected, actual)`).
    - **The live deploy is Geo's step (open point 1).** At the end of dev-story, ask Geo to choose the host and log in. Then run the deploy, `deploy:check` and `PP_DIST_URL=… npm run e2e:dist`, and paste the URL and results in the Debug Log.
      - If Geo is not available, leave that task unchecked and say so in the Completion Notes. It does not block the review; it blocks the playtest (AC 13).
13. **`docs/playtest/device-measurements.md`** (French, like the other docs for Geo) is created with:
    - **The protocol** for each device (iPhone 12 or newer with Safari, an Android from 2021 with Chrome):
      - open `<url>/?debug=1` over 4G, not Wi-Fi. Note the load time from the tap on the link to the start screen, using a stopwatch or a 240 fps video (NFR3, < 5 s);
      - play one full level by hand. On the Result screen, read the counter's `p95` and DPR;
      - film at 240 fps (iPhone « Ralenti » 240 i/s), the finger and the screen in the frame, with at least 10 taps on threat icons;
      - for each tap, count the frames from finger contact to the highlight. Latency = frames × 4.17 ms;
      - also note:
        - audio works after the first tap (iOS silent switch off);
        - vibration (Android);
        - a pad-only start, if a pad is at hand (deferred-work L305).
    - **One table per device:**
      - date, build URL and commit, device and OS, browser and version;
      - load time;
      - FPS p95, as `1000 / p95` from the counter, and p95 ms;
      - DPR at the end;
      - the 10+ latencies, with mean and max;
      - verdicts NFR1 (p95 ≤ 16.7 ms, i.e. 60 FPS stable), NFR2 (every tap ≤ 50 ms), NFR3 (< 5 s);
      - notes.
    - **The gate:** the playtest starts only if NFR1 and NFR2 pass on both devices. Otherwise note the gap there, and the next create-story run adds a correction story (Geo decides its number).
    - The tables are left empty, with `—`. **The dev agent does not fill in measurements it did not take.** Geo, or an agent that drives a real device, fills them in.
    - `docs/playtest/` is new. `docs/` holds only the GDD PDF today.

### E. CI

14. **`npm run ci` and `.github/workflows/ci.yml` gain the dist stages,** in this order. The first failure stops the run.
    1. `typecheck`
    2. `lint`
    3. `content:check`
    4. `test:coverage`
    5. `e2e`
    6. `build:playtest`
    7. `dist:check -- --flavor playtest`
    8. `e2e:dist`
    9. `build`
    10. `dist:check -- --flavor prod`

    - So `dist/` holds the prod build after a CI run. CLAUDE.md says so in the `ci` row, and the deployment section starts with `build:playtest`.
    - In `ci.yml`, one step per stage, as today. `timeout-minutes` goes from 20 to 35 (the perf run is about 4 min). Add `if: failure()` upload of `test-results/` only if it is a one-liner; otherwise skip it.
    - `vitest.config.ts` / `playwright.config.ts`: `tests/e2e-dist/**` is excluded from Vitest (like `tests/e2e/**`), and the main Playwright config never picks it up (its `testDir` is `tests/e2e`).
    - The CLAUDE.md row « `npm run ci` | Everything CI runs… » is updated with the new stages.

## Tasks / Subtasks

- [ ] **T0 Baseline** (Precondition).
- [ ] **T1 Builds** (AC 1, 2, 3):
  - [ ] Pin the flag in both build scripts. Add `build.manifest: true`.
  - [ ] Add `public/_headers`.
  - [ ] Gate `copyLog` in `resultScreen.ts` and update its test (`vi.stubEnv`).
  - [ ] Build both flavors by hand. `grep -c copyLog` in the prod chunk must be 0.
- [ ] **T2 Dist check** (AC 4):
  - [ ] Write `tools/build/checkDist.ts` and its tests.
  - [ ] Add the script `dist:check`.
  - [ ] Run it on both real builds and paste the printed payload and first-load figures in the Debug Log.
- [ ] **T3 Perf meter and HUD** (AC 9, 10):
  - [ ] `src/debug/perfMeter.ts` and its tests.
  - [ ] `src/debug/perfHud.ts`, `src/debug/perfHud.css` and their test (happy-dom is not used here: check how `testApi.test.ts` fakes the DOM and do the same, or test only the text formatting as a pure function).
  - [ ] `TestHost.onRenderedFrame`; boot wiring.
  - [ ] `__PP__.perf()`, and `testApi.test.ts` / `testApi.spec.ts` updated.
- [ ] **T4 Adaptive pixel ratio** (AC 11):
  - [ ] `adaptivePixelRatio.ts` and its tests.
  - [ ] Renderer `setPixelRatioCap`, `RendererStats.pixelRatio`, and the boot wiring.
- [ ] **T5 Serve and dist e2e** (AC 5-8):
  - [ ] `tools/serve/serveDist.ts` and its tests.
  - [ ] `tests/e2e/support/e2ePort.ts`.
  - [ ] `playwright.dist.config.ts`, `tests/e2e-dist/dist.spec.ts`, `tests/e2e-dist/perf.spec.ts`.
  - [ ] Budgets to `shared/constants.ts`; the three specs import them.
  - [ ] Run `e2e:dist` and paste the perf report.
- [ ] **T6 Deploy tooling and docs** (AC 12, 13):
  - [ ] `tools/deploy/checkDeployment.ts` and its tests.
  - [ ] The CLAUDE.md section and rows.
  - [ ] `docs/playtest/device-measurements.md`.
- [ ] **T7 CI** (AC 14): `package.json` `ci`, `.github/workflows/ci.yml`, the Vitest exclude.
- [ ] **T8 Full run:** `(unset VITE_DEBUG_ALLOWED; npm run ci)` green. Paste the counts.
- [ ] **T9 [Geo] Live deploy:** host choice, login, deploy, `deploy:check`, `PP_DIST_URL=… npm run e2e:dist`. Leave unchecked if not done, and say so.
- [ ] **T10 [Geo] Device pass:** fill in `device-measurements.md`. This happens after the merge, before the playtest. It is not part of dev-story.

## Dev Notes

### Decisions (D1-D9)

| # | Decision | Why |
|---|---|---|
| D1 | **`public/_headers` is the one source of the headers**, applied by the hosts and by `serveDist.ts`, and checked by `dist:check` and `deploy:check`. CSP = the three directives of the epic + `object-src 'none'` + `base-uri 'self'`. | Cloudflare Pages and Netlify both read `_headers` (same format) from the published folder. So the host choice changes only the deploy command. A `<meta>` CSP would not cover `frame-ancestors`, and it would be a second copy. |
| D2 | **The build scripts pin `VITE_DEBUG_ALLOWED`.** | The shell exports `false` (CLAUDE.md › Trap). That made `build:playtest` silently a debug-less build, and a shell `true` would have shipped debug in prod. A process env var wins over `.env*`, so the script's value wins. |
| D3 | **Debug absence is proved on the bundle, with the manifest and markers, and the markers are proved present in playtest.** | A grep for a name that has since been renamed always passes. The playtest check catches that. The string « Copier le journal » itself is in the prod bundle through `content/strings.fr.json`, which is eagerly inlined, so the check looks for the wiring (`copyLog`), not the label. |
| D4 | **The dist e2e serves the existing `dist/`; it never builds.** | CI already builds once (`build:playtest`). Building in `webServer` would double the time and hide which build is tested. `dist:check --flavor playtest` first gives a clear error on a prod or missing `dist/`. |
| D5 | **The FPS counter shows only with `?debug=1`**, not in plain dev. | Plain dev runs the e2e suite, including `autoplay-frozen.png`. A counter there changes the screenshots and covers the HUD. Geo types `?debug=1` in dev too. The full overlay (F1, 3-finger tap, draw calls panel, Tweakpane) is story 2.1. |
| D6 | **`perf.spec.ts` runs on chromium only, at speed 1, on the served playtest build.** | Speed scales the steps per frame, so only speed 1 is honest. The built bundle is what testers get; dev mode is unminified with HMR. WebKit on Linux CI is software-rendered and is a proxy for Safari's correctness, not its speed. Real Safari speed comes from the iPhone pass (AC 13). |
| D7 | **The HUD and `__PP__` each own a meter**, fed by `TestHost.onRenderedFrame`. | It keeps the debug modules independent, and either can load alone. A meter is a few hundred numbers and one `frame()` call. |
| D8 | **The pixel ratio only steps down, once per window, never back up.** | It follows the architecture's rule (2 → 1.5 → 1 if mean > 18 ms for 2 s). Stepping up on a warm phone would make it oscillate. A new page (« Rejouer » keeps the page) starts at 2 again. |
| D9 | **The first-load gzip total is printed, not asserted.** | The epic's test is glb + audio ≤ 3 MB (0.28 MB today). NFR3 (< 5 s on 4G) is measured on the device (AC 13). Today's first load is about 2.3 MB gzip: Rapier 1.68 MB, the entry 0.24 MB, glTF 0.02 MB, fonts 0.09 MB, payload 0.28 MB. A second budget would be a new number nobody chose (open point 3). |

### Measured while writing this story (2026-10-28, `659150d`, flag unset)

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` (entry, three included) | 875.8 kB (prod) / 882.7 kB (playtest) | 240.7 kB |
| `rapier-*.js` | 4 366.8 kB | 1 677.2 kB |
| `gltf-*.js` (lazy) | 71.8 kB | 20.8 kB |
| `salon_crawler.geometry-*.js` | 3.1 kB | 0.6 kB |
| `index-*.css` | 21.9 kB | 4.5 kB |
| playtest only: `testApi-*.js` 3.0 kB, `autoplay-*.js` 4.9 kB | | |

- **Prod grep:**
  - `__PP__`, `installTestApi`, `installAutoplay`, `createHumanBot` and `tweakpane`: **absent**.
  - `copyLog`: **present** (fixed by AC 3).
  - `data:` and `blob:` appear in the entry and glTF chunks. These are three.js loader paths for embedded images, unused here: the glb has no textures.
  - `new Worker` appears in the glTF chunk. That is meshopt's `useWorkers`, never called.
  - `https://` appears in the entry: three.js message strings, not requests.
  - The dist e2e's `securitypolicyviolation` listener (AC 7) is the real proof. If something is blocked, find what loads it. Never widen the CSP without asking Geo.
- **Level payload:** `salon_crawler.glb` is 20 972 B, `public/assets/audio/` is about 256 kB. That is 0.28 MB, against 3 MiB.
- **Cloudflare Pages** direct upload has a per-file limit of about 25 MiB (third-party source, check at deploy). Rapier's 4.4 MB chunk is well under it.
- **`'wasm-unsafe-eval'`** is supported since Chrome 97 and Safari 16 (secondary sources). Rapier's compat build and meshopt both instantiate inline wasm, so it is required.

### Current state of the files this story changes (read before editing)

- **`vite.config.ts`** (9 lines): `base: './'`, `resolve.tsconfigPaths`, `server.host`. Comment: the `feel-writer` plugin is story 2.1. Keep it.
- **`package.json` scripts:**
  - `build`: `vite build`; `build:playtest`: `vite build --mode playtest`.
  - `ci`: typecheck → lint → content:check → test:coverage → e2e → build:playtest.
  - `.env`: `VITE_DEBUG_ALLOWED=false`, `VITE_TARGET=web`; `.env.development` and `.env.playtest`: `true`. Keep the `.env*` files; the scripts override them.
- **`src/client/boot.ts`:**
  - L202 `isMirrored = VITE_DEBUG_ALLOWED === 'true'`; L204 `params = readDebugParams(...)` only when mirrored (`params.isDebug` is `?debug=1`).
  - L574-652 `onLevelFrame`: render → … → `worldUi.render(camera)` → `highlightRendered` mark → the first-frame stats mirror (`isStatsMirrored`, L644-651, keep it: `level.spec.ts` reads it).
  - L1049-1086: the debug block that builds `testHost` and loads autoplay. Add `onRenderedFrame` to `testHost` here, and the `perfHud` import beside autoplay's (only when `params.isDebug`).
  - L1094-1108: `installTestApi`.
  - The adaptive pixel ratio goes in `onLevelFrame` too, outside the debug block.
- **`src/client/app/testHost.ts`:** the `TestHost` interface. Add `onRenderedFrame`; doc comment: « the stats object is reused; do not keep it ».
- **`src/client/render/renderer.ts`:**
  - L44-59 `createRenderer` (`antialias: true`, `powerPreference: 'high-performance'`); `pixelRatioFor(dpr)` = `min(dpr, MAX_PIXEL_RATIO)`.
  - L80-82 resize: `setPixelRatio(pixelRatioFor(window.devicePixelRatio))` then `setSize`.
  - L87-93 `stats()` fills one reused `{drawCalls, triangles, geometries, textures}` from `renderer.info`.
- **`src/client/loop.ts`:** `LoopStats` has no frame time. Do not add the meter here: the loop is shared with `advance`, and the meter belongs to debug.
- **`src/client/ui/screens/resultScreen.ts`** L54-55 (`copyLog?`), L227-234 (the button). The test is at `resultScreen.test.ts:500`.
- **`src/debug/`:** `testApi.ts`, `autoplay.ts`, `feelPatch.ts` and their tests. `testApi.ts` declares `Window.__PP__` and `PPTestApi`; add `perf` there.
- **`tests/e2e/support/testApi.ts`:** Playwright wrappers (`ppState`, …). Add `ppPerf(page)`.
- **`tests/e2e/support/game.ts`:**
  - `LEVEL_DURATION_MS`, `OVERRUN_MARGIN_MS`, `collectProblems`, `html(page)`, `audioState`, `startLevel`, `waitFrames`. Reuse them from `tests/e2e-dist/*` with relative imports.
  - `advanceToEnd` is frozen stepping: **useless for frame times**. The perf spec plays in real time.
- **`playwright.config.ts`:** `e2ePort()` L20-36 (moves to `support/e2ePort.ts`); projects chromium and webkit at 844×390 with touch; `webServer` = the dev server.
- **`tests/architecture/levelAssets.test.ts` and `audioAssets.test.ts`:** already check `public/` against `LEVEL_PAYLOAD_MAX_BYTES`. Keep them (a fast source check). `dist:check` is the built check the epic asks for.
- **`.github/workflows/ci.yml`:** one step per stage, `timeout-minutes: 20`, `CI: true`, installs chromium + webkit.

### What must be preserved

- Every existing e2e and its screenshots: the counter only appears with `?debug=1` (D5). `autoplay.spec.ts` uses `/?autoplay=perfect&seed=42&speed=4`, without `debug=1`.
- `data-pp-draw-calls` and the other first-frame mirrors (`level.spec.ts`).
- `isTestApiEnabled`: dev always; playtest only with `?debug=1`; prod never.
- R7 (`tests/architecture/layerBoundaries.test.ts`, `biome.json`): `@debug/*` only by a literal dynamic import in `boot.ts`. Do not widen it.
- Zero allocation per frame in `onLevelFrame` (project-context L78): no closures, arrays or objects created per frame in the new code. The listeners loop is an indexed `for`.
- The sim is untouched: no `performance` or `requestAnimationFrame` there (`simPurity.test.ts`). Nothing in this story goes in `src/sim`. **No golden changes are expected.** If one changes, something is wrong.

### Architecture compliance

- Layers:
  - `tools/**` is Node only and never imported by `src/`;
  - `tests/e2e-dist` imports `tests/e2e/support/*` and `@shared` only;
  - `src/debug` may import anything;
  - `src/client` reaches it only through `boot.ts`.
- No `console.*`: tools use `log` from `@shared/log` like the other tools (check `tools/sim/runSim.ts` for the pattern of printing a report and exit codes).
- I/O in tools returns `Result` where a function reads the disk; the CLI turns it into the exit code. No silent `catch`.
- Names: `create…` factories in files named after the export; units in names (`frameMsP95`, `PIXEL_RATIO_WINDOW_MS`); constants `UPPER_SNAKE` in `shared/constants.ts`.

### Library and framework notes

- **Vite 8.3.5** (Rolldown): `build.manifest: true` writes `dist/.vite/manifest.json`, keyed by source path with `file`, `imports`, `dynamicImports`, `isEntry`, `isDynamicEntry`, `css`. Process env beats `.env*` files.
- **Playwright 1.64:**
  - `defineConfig` accepts `webServer` as an object or an array. Leave it out entirely for `PP_DIST_URL`.
  - `-c playwright.dist.config.ts` selects the config.
  - Use `testInfo.attach` for the report.
  - Use `test.describe.configure({ mode: 'serial' })` and `test.setTimeout` in `perf.spec.ts`.
- **three 0.186.1:** `renderer.info.render.calls` and `.triangles` are reset by each `render()` (`info.autoReset`), so read them after the level render, which is where `onLevelFrame` runs. CSS2D labels are DOM and not counted.
- **Cloudflare Pages / Netlify:**
  - `_headers` in the output folder; a URL pattern line, then indented `Name: value` lines.
  - Headers from several matching rules are merged.
  - `wrangler pages deploy <dir> --project-name <name> [--branch <b>]`.
  - Pin the wrangler / netlify-cli version you check at implementation time, run through `npx`. Do not add them to `package.json` (pinned stack).
- **No new dependency.** The static server is `node:http` + `node:fs`. Do not add Tweakpane usage (2.1). No stats.js; the meter is ours.

### File structure

New:
- `public/_headers`
- `tools/build/checkDist.ts`, `tests/tools/build/checkDist.test.ts`
- `tools/serve/serveDist.ts`, `tests/tools/serve/serveDist.test.ts`
- `tools/deploy/checkDeployment.ts`, `tests/tools/deploy/checkDeployment.test.ts`
- `src/debug/perfMeter.ts` + test, `src/debug/perfHud.ts` + `perfHud.css` + test
- `src/client/render/adaptivePixelRatio.ts` + test
- `playwright.dist.config.ts`, `tests/e2e/support/e2ePort.ts`
- `tests/e2e-dist/dist.spec.ts`, `tests/e2e-dist/perf.spec.ts`
- `docs/playtest/device-measurements.md`

Changed:
- `package.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `CLAUDE.md`
- `src/shared/constants.ts`
- `src/client/boot.ts`, `src/client/app/testHost.ts`
- `src/client/render/renderer.ts` + test
- `src/client/ui/screens/resultScreen.ts` + test
- `src/debug/testApi.ts` + test
- `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`, `tests/e2e/level.spec.ts`, `props.spec.ts`, `threats.spec.ts`
- `biome.json`, only if `tests/e2e-dist` or `tools/serve` need the same lint overrides as `tests/e2e` / `tools` (check `overrides`; widen nothing else).

### Testing

- **Unit (Vitest, Node):** `perfMeter`, the `perfHud` text formatting, `adaptivePixelRatio`, `pixelRatioFor` with a cap, `inspectDist`, `parseHeaders` / `headersFor`, `cspProblems`, and `resultScreen`'s flag gate. Use in-memory fixtures; no real `dist/` in unit tests.
- **e2e (dev, existing suite):**
  - `testApi.spec.ts`: eight methods, and `perf()` returns a report with `frames > 0` after a few frames;
  - the three specs import the shared budgets;
  - nothing else changes.
- **e2e:dist:** AC 7 (both browsers), AC 8 (chromium).
- **Never assert on timings in the dev suite.** The only timing assertion is `perf.spec.ts`, on the build.
- `src/sim` coverage is untouched (no sim code).
- Tick only what you ran. The 1.15 / 1.16 reviews punished records that overstated what was verified.

### Previous story intelligence (1.13, 1.22)

- **1.22:**
  - left the « Copier le journal » slot (`copyLog?`) unrendered, for 3.3;
  - the review added `inputGraceMs` and the `blur` reset of the skip key;
  - the result screen's e2e checks every text is ≥ `--pp-spacing-text-min`, which is why the counter uses that size (and it does not appear there without `?debug=1` anyway).
  - **Story 3.3 note:** when it wires `copyLog`, it passes it from the debug block of `boot.ts`. The flag gate in `resultScreen.ts` (AC 3) keeps prod clean whatever 3.3 does. Leave a one-line comment there for 3.3.
- **1.13:**
  - built `__PP__`, `?autoplay` and the `isTestApiEnabled` predicate;
  - its D-notes: debug code sits behind a literal `=== 'true'` and a literal dynamic import, so Rolldown drops it;
  - « checked by hand here, by test in 1.24 »: that test is AC 4 + AC 7.
- **1.11:** `tapLatency.spec.ts` measures a JS-side mark only; compositor latency is not measured. The 240 fps film (AC 13) is the real measure. Do not try a trace-based e2e here.
- **1.15:** Rapier's chunk is 1.68 MB gzip. D9 keeps it as a printed figure.

### Git intelligence

- The last commits are 1.21 and 1.22 (sim, scoring, Result screen) with the usual three-commit pattern, then a `--no-ff` merge.
- Worktree tooling landed in `112f865` / `1c03684`: `tools/git/newStoryWorktree.sh`, and the per-worktree e2e port of `playwright.config.ts` that AC 6 reuses.

### Project context rules (from `_bmad-output/project-context.md`)

- **L141:** debug code behind `if (import.meta.env.VITE_DEBUG_ALLOWED)` plus a dynamic `import()`, tree-shaken from store builds: no `window.__PP__`, cheats or panel.
- **L143:** static hosting, `base: './'`, the strict CSP, HTTPS, no backend, no network calls, no personal data.
- **L144:** the CI pipeline, fail on first error. This story extends it (AC 14) and updates the line's meaning in CLAUDE.md. Do not edit `project-context.md` without asking.
- **L76-85:**
  - performance targets;
  - zero allocation in hot paths;
  - input handlers do almost nothing;
  - render budgets;
  - DPR stepping;
  - level payload ≤ 3 MB;
  - `renderer.info` shown in the debug overlay;
  - `perf.spec.ts`.
- **L131:** real-device checks gate the playtest; CI perf tests do not replace them.
- **Pinned stack:** no new npm dependency, no ESLint, Prettier or UI library.
- **Never weaken a guardrail** (architecture tests, Biome rules, budgets, goldens) to get a green run.

### Open points for Geo (decide when you can; the story is written so that dev can start)

1. **Hosting: Cloudflare Pages or Netlify?**
   - The code is the same (`_headers`); only the deploy command and the account differ.
   - Recommendation: **Cloudflare Pages**. Free, unlimited bandwidth, and every direct upload gets its own URL (« une URL par version »).
   - Either way, **you** create the account and run `wrangler login` (or `netlify login`) once; the agent deploys after.
2. **If the GitHub runner cannot hold p95 ≤ 20 ms.** Its Chromium renders WebGL in software (SwiftShader), which may be slow. The architecture says « sur la machine de CI ». If it fails on GitHub but passes on the Mac, the options are:
   - (a) a larger GitHub runner;
   - (b) run `perf` only in local `npm run ci`, and skip it on GitHub with a visible annotation;
   - (c) a separate budget for software rendering.

   The agent will stop and ask rather than choose.
3. **First-load budget.** About 2.3 MB gzip today, Rapier being 1.68 MB. It is printed, not asserted (D9). Say if you want it to be a budget (e.g. ≤ 3 MB, the architecture's « 3 Mo, donc < 5 s en 4G »).
4. **The counter shows only with `?debug=1`, even in dev** (D5). Say if you want it always on in dev; that needs care with the screenshot specs.

### References

- `_bmad-output/planning-artifacts/epics.md` L134, L141-L154, L201-L209, L215, L258-L261, L338, L1184-L1216, L1232-L1235.
- `_bmad-output/planning-artifacts/game-architecture.md` L86-L93, L197, L263, L281, L420-L434, L528-L531, L657-L658, L1069-L1112, L1148.
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md` L245, L406, L476-L487, L549-L562; `DESIGN.md` L433.
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` L451-L459, L505-L522.
- `_bmad-output/project-context.md` L76-L85, L131, L141-L144.
- `_bmad-output/implementation-artifacts/deferred-work.md` L10, L21, L43, L55, L63, L98, L116, L143, L197, L225, L305.
- Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
