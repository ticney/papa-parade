---
baseline_commit: fd3300b93fc238bcccd5d1b3e812a6b5d727a733
---

# Story 1.5: UI foundations: tokens, start screen, HUD and pause panel

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.5 « Fondations de l'UI : tokens, écran de démarrage, HUD et panneau de pause ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want a warm, readable interface that always leaves me the bottom third of the screen and that I can pause with one gesture,
so that I never lose sight of the action.

**Requirements covered:** FR13 (landscape), FR14 (pause at any time, automatic on background, exact resume after the 3 s countdown), NFR6 (readable HUD, safe areas), NFR8 (colour doubled by shape: nothing to draw yet, the tokens keep the reserved signal colours out of menus). **UX:** UX-DR1 to UX-DR7 and UX-DR26 (`DESIGN.md`: frontmatter, Typography, Layout & Spacing, Elevation & Depth; `EXPERIENCE.md`: Information Architecture, Voice and Tone, State Patterns › Start, Pause, Portrait, HUD & Diegetic UI, Accessibility Floor, Performance Budget (UI); mockup `mockups/key-pause.html`). It is the first story with a player-facing interface: it also decides how the app moves between screens (`appFsm`) and how a level starts and restarts.

## Acceptance Criteria

1. **Tokens mirror the design spec.** Given `src/client/ui/styles/tokens.css` and the frontmatter of `DESIGN.md`, when they are compared, then every token of `colors`, `typography`, `rounded` and `spacing` has its CSS variable (`--pp-color-ink`, `--pp-font-verb-size`…) with the same value, and `tokens.css` has no token the frontmatter lacks. `tests/architecture/designTokens.test.ts` reads the frontmatter YAML and enforces both ways.
   - And `ui.css` (and every other UI stylesheet) uses only those variables: no hard-coded colour, `pp-*` classes, sticker depth (3 px `ink` outline plus `0 4px 0` `ink` shadow) as the only elevation, and no `backdrop-filter`. The same test enforces it.
2. **Self-hosted fonts.** Given Baloo 2, Anton and Nunito (SIL OFL) as woff2 in `public/fonts/`, when the game starts, then they are preloaded and served from the same origin, with no external network request (Playwright asserts every request is same-origin).
3. **Strings.** Given `content/strings.fr.json` and `t(key)`, when any surface shows text, then the text comes from that file. No UI string is written in `src/client/ui/` (architecture test with a failing fixture), and every DOM button has a French `aria-label` taken from the same file. A Playwright test with every string lengthened by 30 % finds no truncated or overflowing text on an iPhone 12 landscape viewport.
4. **App flow.** Given `src/client/app/appFsm.ts`, when the app starts, then it follows `boot → start → loading → level → result`, with `oops` reachable from `loading` and `level`. The states `calibration` (2.7), `settings` (2.8) and `fridge` (3.11) are added later without changing the existing transitions. Overlays never stack: portrait and « Oups » replace whatever is shown.
5. **Start screen.** Given the first display, when the game is ready, then the start screen shows the title and « Touche pour commencer » over the dimmed scene and waits for a tap, a click or a key. That first gesture is the one that will unlock audio (story 1.9), and it leads to loading the level (calibration is inserted there from story 2.7).
6. **Portrait.** Given a phone held in portrait, when the game is shown, then the « Tourne ton téléphone » overlay covers it, the game stays paused while the orientation is portrait, and coming back to landscape shows the pause panel.
7. **HUD.** Given the DOM HUD layer, when it is shown in landscape, then it keeps fixed zones inside `{spacing.hud-inset}`: gauge pill top-left (content from story 1.19), timer top-centre (story 1.18), pause button top-right; the bottom third stays free and the HUD band is at most 12 % of the room height.
   - And every margin includes `env(safe-area-inset-*)` (`viewport-fit=cover`), so nothing hides under an iPhone notch in landscape (Playwright, see D7).
   - And the surface is « compact » when the landscape short side is under 430 px and « regular » above; the HUD corners do not move between surfaces.
   - And the HUD has at most 40 DOM nodes, its updates are batched once per frame, and nothing in it animates a layout property (gauges, later, only by `transform: scaleX`).
8. **Pause.** Given the pause button (`button-icon`, at least 44 × 44) or the Escape key, when I use it in a level, then `requestPause()` is called and the « Pause » panel opens on the `{colors.scrim}` veil within 220 ms; the HUD stays visible under the veil, dimmed and inert.
   - And the panel offers « Reprendre » (default focus) and « Recommencer » (« Réglages » comes with story 2.8, « Quitter vers le frigo » with 3.11).
   - And « Reprendre », Escape or a back gesture closes the panel and starts the countdown; « Recommencer » restarts the level through loading with a new seed.
9. **Countdown.** Given a resume, when the countdown shows, then « 3 » « 2 » « 1 » appear in `{typography.countdown}` at the centre of the dimmed scene, with a pulse each second. The tick sound and the vibration are story 1.9; this story emits the event they will listen to.
10. **Buttons.** Given any UI button, when I use it, then it shows the press on `pointerdown` and acts on `pointerup` inside the button (sliding out cancels); it is at least 44 × 44; on a keyboard it is reachable by Tab or the arrow keys and activated by Enter or Space, with a visible focus ring (`{spacing.focus-ring-width}` `{colors.primary}`).
11. **Quality gates.** `npm run ci` passes with the new unit, architecture and e2e tests; `biome.json` and the existing files of `tests/architecture/` are untouched (new architecture test files may be added); no new dependency (fonts are assets, not packages).

## Tasks / Subtasks

- [x] **T1: Strings and `t()` (AC 3)**
  - [x] `content/strings.fr.json`: add `start.title` (« Papa Parade ») and `hud.pause_button` (« Pause »). Nothing else: every other string this story needs is already there (`start.tap_to_start`, `pause.*`, `countdown.step_1|2|3`, `portrait.rotate`). Run `npm run content:check` and `npm run content:schemas` (no diff expected in `content/_schemas/`).
  - [x] `src/client/ui/strings.ts`: `createTranslator(strings: Strings): (key: string) => string`. A missing key logs `log.warn('boot', …)` once per key and returns the key itself (never throws, never an empty string). `boot.ts` builds it from `content.value.strings` and passes it down; no module-level singleton.
  - [x] `src/client/ui/strings.test.ts`: found, missing (warns once, returns the key), two translators independent.
  - [x] `tests/architecture/uiStrings.test.ts` (new, with its own fixtures under `tests/architecture/fixtures/uiStrings/`): over `src/client/ui/**/*.ts` (tests excluded) it fails on (a) a string literal passed to a text sink (`textContent`, `innerText`, `innerHTML`, `append`/`prepend`/`replaceChildren`, `createTextNode`, `insertAdjacentText`, `setAttribute('aria-label' | 'title' | 'alt' | 'placeholder', …)`, `.ariaLabel`, `.title`, `.alt`) unless it is a call to `t(…)`; (b) any literal containing a letter outside ASCII or one of `« » …` (that is French prose); and over all of `src/client/**` (c) any literal shaped like a string key whose group exists in `strings.fr.json` but whose key does not. One failing fixture per rule, one clean fixture. Reuse `maskSource` from `scanners.ts` by importing it; do not edit `scanners.ts`.
- [x] **T2: Tokens (AC 1)**
  - [x] `tests/architecture/yamlSubset.ts` + `yamlSubset.test.ts`: a small indentation-based parser for the frontmatter (nested maps, `- item` lists, single/double-quoted or bare scalars, quoted keys such as `'1'`). It throws on anything it does not understand (tabs, flow collections, anchors, multi-line scalars) so a future frontmatter change fails loudly. No `yaml` package (D12).
  - [x] `src/client/ui/styles/tokens.css`: `:root` with the variables named in Dev Notes › Tokens. `screen-margin` and `hud-inset` expand to four side variables (D7); `touch-target-min` is `44px` (D6).
  - [x] `tests/architecture/designTokens.test.ts` with a pure `checkTokens(frontmatter, css)` returning problems, tested against inline good and bad inputs (a missing variable, a wrong value, an extra variable, a hard-coded colour, a `backdrop-filter`), then run on the real files. Value comparison: trim, collapse whitespace, strip quotes, numbers compared as numbers (Biome may reformat `1.0`), `pt` read as `px` for `touch-target-min` only.
  - [x] The same test scans every `src/client/ui/**/*.css` except `tokens.css` and `fonts.css`: no `#rgb`/`#rrggbb`/`rgb(`/`rgba(`/`hsl(`/`hwb(`/`oklch(` literal, no named colour (a list of CSS colour keywords; `transparent`, `currentcolor`, `inherit`, `none` are allowed), no `backdrop-filter`, no `transition`/`animation` of `width|height|top|right|bottom|left|margin|padding|inset` (HUD rule). `src/client/app/contentErrorScreen.css` is dev-only technical English with its own colours: out of scope for this test.
- [x] **T3: Fonts (AC 2)**
  - [x] Get the files without adding a dependency (Dev Notes › Fonts): `npm pack` the three `@fontsource` packages into a scratch directory outside the repo, copy only the three woff2 files and the three licence files into `public/fonts/`, delete the scratch directory. Licence files are named `OFL-<family>.txt`.
  - [x] `src/client/ui/styles/fonts.css`: three `@font-face` rules (`font-display: swap`, variable weight ranges for Baloo 2 and Nunito).
  - [x] `index.html`: `<link rel="preload" as="font" type="font/woff2" crossorigin>` for Baloo 2 and Nunito (the two used on the start screen); Anton is warmed with `document.fonts.load` in `boot.ts` (a preload of a font unused for seconds makes Chromium warn).
  - [x] `src/client/ui/fonts.ts`: `loadFonts(fontSet): Promise<Result<void, AppError>>` over `document.fonts.load('800 56px "Baloo 2"')`, `'800 16px Nunito'` and `'400 64px Anton'`; on failure `log.warn('assets', …)` and carry on with the fallback stack. `boot.ts` awaits it before showing the start screen.
  - [x] After `npm run build:playtest`, check `dist/index.html` and `dist/assets/*.css`: the font URLs are relative (`base: './'`) and the files are in `dist/fonts/`.
- [x] **T4: Stylesheet (AC 1, 7, 8, 9, 10)**
  - [x] `src/client/ui/styles/ui.css` (keep the canvas, `dvh` and `overscroll-behavior` rules from story 1.4): `pp-type-<token>` typography classes; `pp-button` with `-primary`, `-secondary`, `-tertiary`, `-icon` variants (sticker depth, `pp-pressed` state, `:focus-visible` ring with the 2 px `paper` inner ring over the scene, `min-height`/`min-width` from `--pp-spacing-touch-target-min`, `touch-action: manipulation`, text that wraps rather than truncates); `pp-panel`, `pp-scrim`; HUD zones; start, portrait and countdown screens; panel pop-in at most 200 ms (`PANEL_POP_MAX_MS` is the ceiling) with a plain fade under `@media (prefers-reduced-motion: reduce)` (D11); `[hidden] { display: none }` that wins over author `display` rules.
  - [x] Run `npm run lint` right after the first CSS file: Biome lints CSS (story 1.4 hit `noDuplicateProperties`). Rework the CSS, never `biome.json`.
- [x] **T5: App flow, events, surface, orientation (AC 4, 6, 7)**
  - [x] `src/shared/constants.ts`: `COMPACT_SURFACE_MAX_PX = 430`, `TOUCH_TARGET_MIN_PX = 44`, `HUD_BAND_MAX_PCT = 12`, `HUD_MAX_DOM_NODES = 40`, `PANEL_POP_MAX_MS = 220`. One doc line each.
  - [x] `src/client/app/clientEvents.ts`: add `'levelStart'` to `PauseReason`; add `AppStateChanged { from; to }`, `StartGestureReceived`, `CountdownTicked { step: 3 | 2 | 1 }` (Dev Notes › Events).
  - [x] `src/client/app/appFsm.ts` (+ test): `createAppFsm({ events })` with `state`, `enter(next)`. Transitions are data (Dev Notes › App flow); an illegal one is a programmer error (`invariant`). Emits `AppStateChanged`. Tests: every allowed transition, every forbidden one in a table, `oops` only from `loading` and `level`, the event payload, that `start → loading` stays legal when `calibration` rows are added (add a test-only extended table and check the old pairs still pass).
  - [x] `src/client/app/overlay.ts` (+ test): pure `chooseOverlay({ appState, isPortrait, pauseState }): OverlayKind | null` with the precedence of D5, tested as a table.
  - [x] `src/client/app/surface.ts` (+ test): pure `surfaceFor(width, height): 'compact' | 'regular'` on `min(width, height)`, and `bindSurface(target, root)` writing `data-pp-surface` on `<html>` (structural `target`, like `bindVisibilityPause`). Tests: 429 / 430 / portrait input / non-finite input (regular, `warn`).
  - [x] `src/client/app/orientation.ts` (+ test): `bindOrientation(query, onChange): () => void` over a structural `MediaQueryList` slice (`matches`, `addEventListener('change')`), reporting `isPortrait` at bind time and on change. Boot passes `matchMedia('(orientation: portrait)')`.
- [x] **T6: UI components (AC 5 to 10)**
  - [x] `src/client/ui/pressButton.ts` (+ test of the pure part): `bindPressButton(button, onActivate)` per D8, plus the pure `isInsideRect(point, rect)`.
  - [x] `src/client/ui/hud/hudBatch.ts` (+ test): `createHudBatch()` with `set(slot, value)` and `flush()`; `flush()` runs each changed slot's writer once and allocates nothing when nothing changed. The loop's `render` callback calls `flush()` once per frame.
  - [x] `src/client/ui/hud/hudLayer.ts`, `pauseButton.ts`: builds `#pp-hud` content (three zone `div`s plus the pause button with an inline SVG icon, `aria-hidden`), `setInteractive(isInteractive)` toggling `inert`, `setVisible(isVisible)`.
  - [x] `src/client/ui/hud/countdown.ts` (+ test of the pure part): `countdownStep(remainingMs): 3 | 2 | 1 | null` = `ceil(remainingMs / 1000)` clamped, `null` at 0; the DOM part writes the digit only when it changes, restarts the pulse, and emits `CountdownTicked`.
  - [x] `src/client/ui/screens/startScreen.ts`, `pauseScreen.ts` (panel and countdown modes on the same scrim), `portraitOverlay.ts`, and `src/client/ui/overlayHost.ts`: one overlay root in `#pp-ui`, `sync(kind)` mounts the builder for that kind and removes the previous one, so there is never more than one overlay child. Focus goes to « Reprendre » when the panel opens.
  - [x] `src/client/ui/keys.ts` (+ test of the pure part): Escape handling per D14 and arrow-key focus movement inside a panel (Up/Down and Left/Right move focus between its buttons; Tab keeps working natively). Bind by `KeyboardEvent.code`, ignore `event.repeat`.
- [x] **T7: Level session and composition root (AC 4, 5, 8)**
  - [x] `src/client/app/levelSession.ts`: `createLevelSession(deps)` with `start(): Promise<void>` and `stop()`. `start` stops the previous loop, draws a fresh seed (`crypto.getRandomValues`, logged at `info`, mirrored in debug), creates the sim, a new `timeMap` and a new loop, then runs the level-start countdown (D1). The pause controller and the emitter outlive levels.
  - [x] `src/client/boot.ts` stays a list of calls: build the translator, load fonts, build `appFsm`, HUD, overlay host and the bindings, show the start screen, and wire `StartGestureReceived` → `loading` → `levelSession.start()` → `level`. Remove both « Provisional: story 1.5 replaces it » blocks of story 1.4: the canvas `pointerdown` resume (the panel replaces it) and keep the `data-pp-state` mirror, which Playwright still needs until story 1.13 (D13).
  - [x] Outside a level (`start`, `loading`), draw the scene once with `renderer.render` and again on every resize (D4).
  - [x] Update `// Provisional` comments so none points to story 1.5 any more; the mirror's comment names story 1.13.
- [x] **T8: End-to-end (AC 2 to 10)**
  - [x] `tests/e2e/support/game.ts`: `openGame(page)` (goto, wait for `html[data-pp-app="start"]`) and `startLevel(page)` (open, press the start screen, wait for `data-pp-app="level"` and `data-pp-state="running"`, which includes the 3 s countdown). Update `boot.spec.ts` and `pauseResume.spec.ts` to use them; the pause test now opens the panel, uses « Reprendre » and no longer taps the canvas.
  - [x] `tests/e2e/ui.spec.ts` (chromium + webkit) following Dev Notes › E2E script. No `waitForTimeout`; wait on attributes, `expect.poll` or a bounded count of `requestAnimationFrame`s as in story 1.4.
  - [x] If a project cannot run a check in CI (for example touch taps in WebKit on Linux), report the exact error in the Completion Notes and `deferred-work.md` and keep the test for the projects that can; never skip silently.
- [x] **T9: Docs and verification (AC 11)**
  - [x] `deferred-work.md`: add « Resolved in story 1.5 » to the story 1.1 « Mobile canvas CSS » item (safe-area insets) and to the story 1.4 « Only the first pause reason is kept » item (portrait is a UI flag, not a pause reason, see D5; the set of reasons stays for story 1.17), and add the items of Dev Notes › Deferred by this story.
  - [x] `npm run ci` passes end to end.
  - [x] Manual check in a real browser (built-in browser pane or `npm run dev`): start screen over the dimmed scene, tap, 3 s countdown, probe cube sliding; pause button and Escape; panel then countdown; background tab; resize to portrait and back; fonts are the real ones. Optional, and worth doing for the notch: open the dev server in the iOS Simulator (iPhone 12, landscape) and check that the HUD clears the notch. Say in the Completion Notes what was and was not checked on a real device.
  - [x] Break things to prove the guards bite, then restore: hard-code `#fff` in `ui.css` (designTokens fails); delete a token from `tokens.css` (designTokens fails); write a French literal in a file under `src/client/ui/` (uiStrings fails); add `backdrop-filter` (designTokens fails); make `requestResume()` skip the countdown (the pause tests fail).
  - [x] `git status`: only the files of the File List changed; `biome.json` and the existing `tests/architecture/` files unchanged; nothing committed (the sprint workflow leaves that to Geo or the review).

## Dev Notes

### What exists today (stories 1.1 to 1.4, done)

- `index.html`: `<canvas id="pp-canvas">`, `<div id="pp-ui">`, viewport meta with `viewport-fit=cover`, `lang="fr"`. `src/main.ts` imports `./client/ui/styles/ui.css` and calls `void boot()`. `ui.css` holds `html, body` (overflow hidden, `overscroll-behavior: none`), `body` (`user-select: none`) and `#pp-canvas` (fixed, `100vw`/`100dvh`, `touch-action: none`). There is no `tokens.css`, no font, no `public/fonts/`, no `t()`.
- `src/client/boot.ts` (the composition root, reviewed in story 1.4): installs the global error hook, loads content (`createBrowserContentSource` + `loadContent`; on error, the dev error screen in `#pp-ui` and stop), creates the sim **once at boot** with a fresh seed, creates the renderer (`err` → `log.error` and stop), camera and provisional scene, a `ResizeObserver` + window `resize` calling `fitViewToCanvas`, the emitter, the pause controller, `bindVisibilityPause(document, pause)` (also pauses at once if the page is hidden), the time map, the loop, and `loop.start()`. Two blocks are marked « Provisional: story 1.5 replaces it with the pause panel »: a canvas `pointerdown` that calls `pause.requestResume()` when `paused`, and the `data-pp-state` mirror gated by `VITE_DEBUG_ALLOWED === 'true'`. **The mirror stays** (D13); the pointer resume goes.
- `src/client/app/`: `pauseController.ts` (`state: 'running' | 'paused' | 'resuming'`, `countdownRemainingMs`, `requestPause(reason)`, `requestResume()`, `update(frameAtReal)`; initial state `running`; from `running` or `resuming` it goes to `paused`, from `paused` only to `resuming`, only `update` reaches `running`; `requestPause` while `paused` is a no-op), `clientEvents.ts` (`PauseReason = 'visibilityHidden' | 'user' | 'portrait' | 'gamepadDisconnected'`; `PauseRequested`, `ResumeRequested`, `GameResumed`), `visibilityPause.ts`, `globalErrorHandlers.ts`, `contentErrorScreen.{ts,css}` (dev only, English, its own colours, lives in `app/` not `ui/`).
- `src/shared`: `emitter.ts` (`createEmitter<Events>()`, `on` returns unsubscribe, `emit`), `constants.ts` (`RESUME_COUNTDOWN_MS` = 3000, `MAX_PIXEL_RATIO`, iso camera constants…), `log.ts` (`log.<level>(channel, message, data?)`, channels `boot|assets|audio|input|render|feedback|storage|platform|debug|content|sim`), `result.ts`, `invariant.ts`.
- `src/content`: `StringsSchema` (a `Record<string, string>` with key shape `group.lower_snake_case`; strings may not name failure and must use « tu »), `ContentBundle { feel, strings }`, `checkStringReferences` for content JSON. The client reads strings from `content.value.strings`. `content/strings.fr.json` already has the keys listed in T1.
- `tests/architecture/`: `layerBoundaries.test.ts`, `simPurity.test.ts`, `biomeBoundaries.test.ts`, `scanners.ts` (exports `maskSource`, `findImports`…), `fixtures/{layers,simPurity}`. `tests/e2e/{boot,contentError,pauseResume}.spec.ts`; Playwright runs chromium and webkit at 844 × 390 with touch against `npm run dev -- --port 5179` (`.env.development` sets `VITE_DEBUG_ALLOWED=true`). `tests/support/{testContent,fakeScheduler}.ts`.
- Biome 2.6.3 lints and formats CSS too. `public` and `tests/architecture/fixtures` are ignored by Biome. `package.json` has no YAML parser and none is installed.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | A level **always starts through the 3 s countdown**. `levelSession.start()` ends with `pause.requestPause('levelStart')` (a no-op if already paused) then `pause.requestResume()`. First start and « Recommencer » take the same path. Add `'levelStart'` to `PauseReason`. | Story 1.4 forbids any way to reach `running` without the countdown, and a restart must leave the old `paused` state. This also gives story 1.6 its « le niveau démarre par le décompte de 3 s » for free. The panel never shows for it (`paused` then `resuming` in the same tick). |
| D2 | `loading` has **no screen** in this story: it is the `await createSim(…)`. The bottle screen and the failure path are story 1.6. | Nothing loads yet beyond the sim, which takes a few ms. |
| D3 | Sim, time map and loop are **per level**; the emitter, the pause controller, the renderer and the camera outlive levels. `levelSession.stop()` calls `loop.stop()` before a new level replaces them. | A restart needs a new sim with a new seed; the pause controller must keep its subscribers. |
| D4 | On the start screen (and during `loading`) the provisional scene is drawn **once** and again on resize, without stepping or updating the probe. The dimming is the CSS scrim, not a render effect. | No loop, no sim before a level. |
| D5 | Overlay precedence is **portrait > oops > pause > start**, and at most one overlay root child exists. Portrait is a **UI flag** (`isPortrait`), not a pause reason: while it is true, `requestResume()` is never called (Escape included) and the HUD and every overlay are inert under the portrait overlay. Entering portrait calls `pause.requestPause('portrait')`; leaving it changes nothing but the derived overlay, so the pause panel appears. | « Overlays never stack » and « portrait and Oups replace what is shown » become one pure, testable table. Keeping portrait out of the pause controller avoids the « first reason wins » trap (deferred from 1.4) without redesigning it; the set of reasons is still story 1.17's (gamepad). |
| D6 | `touch-target-min` is `44px`, not `44pt`. `DESIGN.md` writes `44pt` (iOS points = CSS px); in CSS `44pt` is 58.7 px, which would break the 12 % HUD band and the mockup (44 px). The token test reads `pt` as `px` for this one token. | A literal mirror would make every button 33 % too big. Raised to Geo (open point 2). |
| D7 | `screen-margin` and `hud-inset` are `max(<n>px, env(safe-area-inset-*))`, where `*` stands for the four sides: `tokens.css` defines `--pp-spacing-screen-margin-top|right|bottom|left` and `--pp-spacing-hud-inset-top|right|bottom|left`, each with its own `env(safe-area-inset-<side>)`. The token test substitutes `*` with the side. Playwright cannot emulate a notch, so the safe-area test overrides the four `hud-inset` variables with `max(12px, 47px)` left/right (as the mockup's simulated notch) and checks the HUD honours them; a static check asserts each side variable contains `env(safe-area-inset-<side>`. Real notch behaviour is checked by hand (T9). | `*` is not valid CSS; this keeps the 1:1 mirror and still tests the layout. |
| D8 | Buttons: `pointerdown` adds `pp-pressed` (sticker press, no reliance on `:active`, which iOS ignores without a touch listener) and captures the pointer; `pointermove` toggles `pp-pressed` by whether the pointer is inside the button's rect; `pointerup` activates only when inside; `pointercancel` cancels. Keyboard and assistive tech activate through `click` **only when `event.detail === 0`**; a pointer-born `click` is ignored so a tap never fires twice. | Matches UX-DR7 exactly and avoids the double activation of `pointerup` + `click`. |
| D9 | The HUD layer has the **three zones and the pause button**. The gauge pill and the timer are **reserved empty zones**: their content is stories 1.19 and 1.18. This story also ships the per-frame batching primitive and the CSS rules those stories need, but no fake gauge. | Showing placeholder gauges would put invented values in the player's face; the zone geometry, safe area, 12 % band and node budget are all testable with the real elements. |
| D10 | `t(key)` takes a plain `string` (a key typo is caught at runtime with a `warn` and by the architecture scan, not by the compiler). `contentErrorScreen` is outside `src/client/ui/`, so the string test does not apply to it. | Importing the JSON for a key type would break « only `loadContent` reads content JSON ». |
| D11 | Reduced motion is the OS media query `prefers-reduced-motion: reduce` for now (panel pop → plain fade, countdown pulse → none). The player setting « Réduire les animations » is story 2.8 / 2.10 and will add a `data-` attribute that the same CSS rules honour. It never changes sim timing. | The setting does not exist yet. |
| D12 | No `yaml` dependency: a ~40-line subset parser in `tests/architecture/yamlSubset.ts`. Adding a package needs Geo's OK. | The stack is pinned and the frontmatter is simple. |
| D13 | Debug mirrors on `<html>`, only when `VITE_DEBUG_ALLOWED === 'true'` (stripped from store builds): `data-pp-state` (pause state, kept), `data-pp-app` (app state), `data-pp-seed` (the level's seed). Still no `window.__PP__` (story 1.13). `data-pp-surface` is not debug: CSS uses it. | Playwright needs something observable; same reasoning as story 1.4 D7. |
| D14 | Escape, by app and pause state: `level` + `running` → `requestPause('user')`; `level` + `paused` → `requestResume()`; `level` + `resuming` → `requestPause('user')` (cancels the countdown and re-opens the panel); any other app state, `isPortrait`, or `event.repeat` → ignored. A mouse or touch tap on the veil outside the panel does nothing. | UX-DR5/UX-DR7: Escape toggles, B never pauses (gamepad is 1.17). Re-pausing during the countdown is the natural reading of « Escape pauses in play » (open point 5). |
| D15 | The first gesture of the start screen emits `StartGestureReceived` **synchronously inside the `pointerup` / `keydown` handler**, then moves the app to `loading`. Story 1.9 subscribes to unlock the `AudioContext` (iOS only allows it inside the gesture). Any key counts except the pure modifiers (`Shift`, `Control`, `Alt`, `Meta`, `CapsLock`); `pointerup` counts anywhere on the screen. | Keeps 1.9 from having to touch the start screen. |

### App flow (`src/client/app/appFsm.ts`)

```ts
export type AppState = 'boot' | 'start' | 'loading' | 'level' | 'result' | 'oops';
```

Allowed transitions (a data table, `Record<AppState, readonly AppState[]>`):

| From | To |
|---|---|
| `boot` | `start` |
| `start` | `loading` |
| `loading` | `level`, `oops` |
| `level` | `loading` (« Recommencer »), `result`, `oops` |
| `result` | `loading` (story 1.22 uses it) |
| `oops` | (none yet: story 1.6 adds `oops → loading` for « Réessayer ») |

Later stories **add** rows and entries (`start → calibration`, `calibration → loading`, `settings`, `fridge`) and never remove or change these: `start → loading` must stay legal (it is the returning-player path). `enter(next)` throws through `invariant` on an illegal move and emits `AppStateChanged { from, to }` otherwise; entering the current state is a no-op. Same pattern as the sim's `enter…State`, with no `enteredAt`: the app has no sim clock.

### Events (`clientEvents.ts`)

```ts
export type PauseReason = 'visibilityHidden' | 'user' | 'portrait' | 'gamepadDisconnected' | 'levelStart';
export interface ClientEvents {
  PauseRequested: { reason: PauseReason };
  ResumeRequested: Record<string, never>;
  GameResumed: Record<string, never>;
  AppStateChanged: { from: AppState; to: AppState };
  StartGestureReceived: Record<string, never>;      // story 1.9: unlock audio here
  CountdownTicked: { step: 3 | 2 | 1 };             // story 1.9: tick sound + vibration
}
```

`CountdownTicked` is emitted by the countdown screen when the visible digit changes, including the first « 3 » when the countdown starts (`countdownRemainingMs` is the full length right after `requestResume()`). Boundaries: remaining in `(2000, 3000]` shows « 3 », `(1000, 2000]` « 2 », `(0, 1000]` « 1 », `0` hides the digit. The length is `RESUME_COUNTDOWN_MS`; do not write `3000`, `2000` or `1000` literally: derive the step from it. The emitter stays client-only: never import it from `src/sim`.

### Tokens (`tokens.css`)

Naming, from the frontmatter keys (kebab-case as written):

| Frontmatter | CSS variable | Example |
|---|---|---|
| `colors.<name>` | `--pp-color-<name>` | `--pp-color-ink-soft: #6B6283` |
| `typography.<name>.fontFamily` / `fontSize` / `fontWeight` / `lineHeight` / `letterSpacing` | `--pp-font-<name>-family` / `-size` / `-weight` / `-line-height` / `-letter-spacing` (only the fields present) | `--pp-font-verb-size: 40px` |
| `rounded.<name>` | `--pp-rounded-<name>` | `--pp-rounded-lg: 22px` |
| `spacing.<name>` | `--pp-spacing-<name>` | `--pp-spacing-4: 16px`, `--pp-spacing-focus-ring-width: 4px` |
| `spacing.screen-margin`, `spacing.hud-inset` | four variables per D7 | `--pp-spacing-hud-inset-left: max(12px, env(safe-area-inset-left))` |

- `components:` and the rest of the frontmatter are **not** mirrored as variables; components are `pp-*` classes built from the variables.
- The font-family tokens hold only the family (`'Baloo 2'`), as in the frontmatter. The fallback stack (`ui-rounded, system-ui, sans-serif`) is added in `ui.css` rules, not in the token, so the mirror stays 1:1.
- `pp-type-<name>` classes set family (with fallback), size, weight, line-height and letter-spacing from the variables. Numbers that change in place add `font-variant-numeric: tabular-nums` (`numeric`, `numeric-compact`, `countdown`). Verbs are uppercase and never below 28 px (the verb classes are used from story 2.2; define them now).
- Menu surfaces use `cream`; `parry`, `dodge`, `alert` never decorate a menu; no dark theme (`color-scheme: light` on `:root`).

### Fonts

Pinned sources (verified on npm, 2026-10-27): `@fontsource-variable/baloo-2@5.3.0`, `@fontsource-variable/nunito@5.3.0`, `@fontsource/anton@5.3.0`, all OFL-1.1. In a scratch directory (never inside the repo): `npm pack <package>@<version>`, extract, and copy:

| Package file | To |
|---|---|
| `package/files/baloo-2-latin-wght-normal.woff2` | `public/fonts/baloo-2-latin-wght-normal.woff2` |
| `package/files/nunito-latin-wght-normal.woff2` | `public/fonts/nunito-latin-wght-normal.woff2` |
| `package/files/anton-latin-400-normal.woff2` | `public/fonts/anton-latin-400-normal.woff2` |
| each `package/LICENSE` | `public/fonts/OFL-baloo-2.txt`, `OFL-nunito.txt`, `OFL-anton.txt` |

The `latin` subset should cover every character of `strings.fr.json` (accents, `œ`, `« »`, `…`, `−` U+2212, curly apostrophe). Verify it with a one-off script that lists the code points of the strings above U+00FF and checks them against the Google `latin` unicode-range (`U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`), and report the result in the Completion Notes. Variable fonts: `font-weight: 400 800` for Baloo 2, `200 1000` for Nunito. No `latin-ext`, no other weights: three files in total. In `fonts.css` reference them as `url('/fonts/…')` (a public-folder URL: Vite rewrites it for `base: './'`); check the built CSS (T3).

### The HUD (`#pp-hud`)

- A new `<div id="pp-hud"></div>` in `index.html`, between the canvas and `#pp-ui`. Layers, bottom to top: canvas, `#pp-hud`, `#pp-ui` (start, pause veil and panel, countdown, portrait). The HUD sits **under** the veil, so « dimmed » is the veil itself; the HUD is `inert` and not `aria`-hidden while paused or resuming. `#pp-hud` is `hidden` outside `level`.
- `#pp-hud` is `pointer-events: none`; only the pause button takes pointer events. It is a grid of three columns (`1fr auto 1fr`) positioned with `top: var(--pp-spacing-hud-inset-top)` and the left/right inset variables, one 44 px row (the pause button's height). The three zone elements carry `data-pp-zone="gauges" | "timer" | "pause"`.
- **Band rule:** the HUD band is the height of that row (44 px), without the inset. At 844 × 390 it is 11.3 % (limit 46.8 px); at 375 px tall, 11.7 %. Below about 367 px of viewport height (for example Playwright's own `iPhone 12 landscape` viewport, 750 × 340) 44 px is more than 12 %: the touch target wins there (open point 4). The e2e test uses 844 × 390.
- **Budget:** `#pp-hud` and its descendants stay at `HUD_MAX_DOM_NODES` or fewer (about 8 now). The pause icon is an inline SVG built with `document.createElementNS` (two `rect`s), `aria-hidden="true"`, `fill` from a variable through `currentColor`.
- **Hot path:** the loop calls `render(alpha)` every frame, paused or not. The UI part of it (`hudBatch.flush()` and the countdown) must not allocate: compare numbers, write `textContent` or a class only on change, no template strings or arrays per frame. Event-driven DOM changes (opening the panel) may allocate; they are rare.

### Pause and countdown screens

- `pauseScreen` has two modes on one scrim, chosen from `pause.state` by the overlay host: `paused` → panel; `resuming` → countdown digits (`pp-type-countdown`, `paper` fill, 5 px `ink` stroke via `paint-order: stroke`, centred). The scrim stays through the countdown. `role="dialog"`, `aria-modal="true"`, `aria-label` from `pause.title` for the panel; `role="timer"` and `aria-live="assertive"` for the digits.
- Panel: width 320 px capped to the viewport minus the screen margins, `pp-panel` (paper, 3 px ink outline, sticker shadow, `rounded.lg`, `spacing.5` padding), title `pp-type-heading`, buttons stacked: « Reprendre » `pp-button-primary` first, « Recommencer » `pp-button-secondary`. A list of actions in code, so stories 2.8 and 3.11 append rows. `min-height` not `height`, text wraps, so +30 % strings do not truncate. Open the panel with a pop (scale from 0.9 with overshoot, at most 200 ms) and focus « Reprendre ».
- « Reprendre » and « Recommencer » activate through `bindPressButton`. A tap on the veil outside the panel is swallowed (it must not reach the canvas).
- « Recommencer »: close the panel, `appFsm.enter('loading')`, `levelSession.start()`, `appFsm.enter('level')`. The old loop is stopped first. The seed differs from the previous one (`data-pp-seed`).
- After the panel or the countdown closes, focus returns to `document.body` (the pause button is not auto-focused).

### Start screen and portrait overlay

- Start: a full-surface `<button type="button" class="pp-start">` (so keyboard and screen readers get a real control) with the title (`pp-type-display`, `start.title`) and the prompt (`pp-type-heading` or `body`, `start.tap_to_start`) as `<span>`s; `aria-label` = the prompt. It sits on the scrim over the drawn scene. It listens to `pointerup` (anywhere) and `keydown` (D15) on `window` while shown, and removes both listeners when it leaves. The tap that starts the game must not reach the canvas or the pause button afterwards (stop propagation, remove the screen before the next event). It is focused on show.
- Portrait overlay: opaque `cream`, centred phone-rotating icon (inline SVG, `aria-hidden`) and `portrait.rotate` in `pp-type-heading`. It is a state, not an alarm (no `role="alert"`), and has no button, so no `aria-label`. It blocks all pointer input beneath it. The 1.4 test `boot.spec.ts` that resizes to portrait must still pass: resizing keeps working under the overlay.
- Boot in portrait: if `matchMedia('(orientation: portrait)').matches` at bind time, `bindOrientation` reports it at once and the app pauses with `'portrait'` as soon as a level exists. On the start screen only the overlay shows.

### E2E script (`tests/e2e/ui.spec.ts`)

Use `devices['iPhone 12 landscape']` for the mobile flags (touch, scale factor 3) but override the viewport to 844 × 390 (see the band rule in Dev Notes › The HUD), and import every number from `src/shared/constants.ts`.

1. **Start and fonts:** `openGame`; the title and prompt are visible with texts equal to `strings.fr.json` (read with Node `fs` in the test); `document.fonts.check('800 56px "Baloo 2"')` and the Nunito one are true; collected `request` events are all same-origin (data/blob allowed). Press the screen (touch tap, then in a fresh page a keypress, then a mouse click): `data-pp-app` becomes `level`; the countdown digits show, then `data-pp-state="running"`.
2. **Pause button and Escape:** in a level, `pointerdown` on the pause button gives `pp-pressed` and does not pause yet; `pointerup` inside pauses; a second try that moves the mouse out before releasing does nothing. Escape pauses (panel visible, focus on « Reprendre », computed `animation-duration` plus delay at most `PANEL_POP_MAX_MS`, HUD `inert`), Escape again resumes with the countdown.
3. **Resume and restart:** « Reprendre » → digits « 3 », « 2 », « 1 » then `running`; the canvas screenshot is byte-identical during the countdown and differs after. « Recommencer » → `data-pp-app` goes through `loading` back to `level`, the countdown runs, `data-pp-seed` changed.
4. **Portrait:** `setViewportSize` to 390 × 844 → portrait overlay visible, `data-pp-state="paused"`, canvas screenshots equal; back to 844 × 390 → pause panel visible (not the overlay), resume goes through the countdown; Escape in portrait does nothing.
5. **HUD geometry:** at 844 × 390 and at 1024 × 768 (`data-pp-surface` `compact` then `regular`); pause button box inside the insets, top-right, same offsets on both surfaces; HUD row height at most `HUD_BAND_MAX_PCT` of the viewport height at 844 × 390; nothing of `#pp-hud` below two thirds of the height; `#pp-hud` descendants at most `HUD_MAX_DOM_NODES`; no HUD element has a transition on a layout property. Simulate the notch by setting the four `--pp-spacing-hud-inset-*` variables on `:root` (47 px left/right, 21 px bottom) and assert the zones move inside.
6. **Buttons:** every `button` in each overlay is at least `TOUCH_TARGET_MIN_PX` square and has a non-empty `aria-label` equal to one of the values of `strings.fr.json`; Tab reaches each button; keyboard focus shows an outline of `--pp-spacing-focus-ring-width` in `--pp-color-primary` (computed style); Enter and Space activate; arrow keys move focus in the panel.
7. **+30 % strings:** `page.route` the dev request for the strings module (Vite serves `content/strings.fr.json?raw` as a JS module `export default "<json>"`; confirm the exact URL in the network log) and answer with every value extended by `' ab'` repeated to reach 130 % of its length. On the start screen, the panel, the countdown and the portrait overlay: for each element with text, `scrollWidth <= clientWidth + 1`, `scrollHeight <= clientHeight + 1`, computed `text-overflow` is not `ellipsis`, and its box is inside the viewport minus the insets.
8. **Reduced motion:** `page.emulateMedia({ reducedMotion: 'reduce' })`; the panel animation is the fade (name differs from the pop) and still at most `PANEL_POP_MAX_MS`.

### Architecture guardrails and traps (read before coding)

- **Layers:** `src/client/ui/**` and `src/client/app/**` may import `@shared`, `@content` (types), `@sim` (public API, types only here) and `three`; never `src/sim/...`, `@debug`, `@bots`. Cross-layer imports use the aliases without extension; inside `src/client` use relative paths with `.ts`; `import type` for types. No `console.*`, no silent `catch`, no `enum`/`namespace`/constructor parameter properties.
- **Units and time:** `…Ms`, `…Px`, `…Pct`; real instants are `RealMs` and end in `AtReal`. The countdown is frame time from the pause controller; do not add a `setTimeout`. A 3 s `setTimeout` for anything is a review failure.
- **No GDD number in code:** the countdown length is `RESUME_COUNTDOWN_MS`; the UX numbers (430, 44, 12, 40, 220) are constants in `shared/constants.ts` and tests import them.
- **`[hidden]` loses to `display`:** any rule such as `.pp-start { display: grid }` overrides the `hidden` attribute. Keep `[hidden] { display: none }` in `ui.css` and use it.
- **`inert`** is supported by every target (Safari 15.5+, Chromium 102+). Do not build a focus trap by hand for the HUD; for the panel, Tab cycling inside it is enough (the veil and the HUD are inert or covered).
- **Do not put `touch-action: none` on UI** (it is on the canvas only); buttons use `touch-action: manipulation`. The veil must swallow taps so nothing reaches the canvas, which will get a `pointerdown` handler in story 1.7.
- **Keys:** bind `KeyboardEvent.code` (`Escape`, `Enter`, `Space`, `ArrowUp`…), never `event.key`.
- **Strings:** the title is a string (`start.title`); the pause button, the panel and the portrait text all come from `t()`. The SVG icons carry no text. The `aria-label` of a button equals a value in the strings file.
- **Do not weaken guardrails:** `biome.json` and the existing architecture tests are untouched. If Biome rejects the CSS, fix the CSS.
- **The sim is untouched:** the client only calls `createSim`, `step` (through the loop) and, later, `enqueue`. A restart is a new sim, never a reset of the old one, and `sim.world` is never mutated.
- **Level start is async:** `createSim` is async, so a second « Recommencer » tap while `loading` must not start two levels. Ignore `start()` while one is in flight (a guard flag), and test it.
- **Hidden at level start:** if the page is hidden when the level is ready, `levelSession.start()` leaves it paused (do not call `requestResume()`); the panel shows on return. Story 1.6 turns this into « the level waits for the foreground ».

### Previous story intelligence (1.4 and its review)

- The review of 1.4 found: an allocation per frame hidden in a template string (`invariant(cond, \`…${x}\`)` builds the message even when the condition holds: test the condition first on hot paths); a loop that could not restart after a fail-stop (now fixed: `start()` restarts, but you still create a new loop per level); a test that read errors before the app had booted (wait for `data-pp-app` / `data-pp-state`, not for static HTML); tests that pinned magic numbers or did not exercise their claim; a listener subscribed after the event it needed (subscribe to events **before** binding sources that emit at bind time, like `bindVisibilityPause`).
- `requestPause` while `paused` is a no-op and `requestResume` only works from `paused`: the UI must never call them speculatively. Derive what to show from `pause.state`, and call the controller only from user actions and the bindings.
- Tests in Vitest run in Node: no DOM. Everything unit-tested here takes its environment by parameter (structural `target`, `query`, `root`), as `bindVisibilityPause` and `installGlobalErrorHandlers` do. DOM behaviour is covered by Playwright.
- e2e in 1.4 used `expect.poll`, bounded `requestAnimationFrame` counts and byte-equal canvas screenshots for « nothing moved »; reuse those helpers (move `waitFrames` into `tests/e2e/support/`).
- `npm run ci` is the bar: run `npm run lint` and `npm test` after the first CSS and first test files, not at the end.

### Git intelligence

- `fd3300b` / `e75afa1` Story 1.4 (client loop, review fixes), `14e370b` / `7dde7dc` Story 1.3, `b44451b` / `15312b9` Story 1.2. Style: one implementation commit and one review-fix commit per story, short French title (`Story 1.5 : …`) with the `Co-Authored-By` line; the dev workflow leaves changes uncommitted. Dependencies are exact-pinned; none is added here.

### Project Structure Notes

- New files follow the architecture tree: `src/client/app/{appFsm,overlay,surface,orientation,levelSession}.ts`, `src/client/ui/{strings,fonts,pressButton,overlayHost,keys}.ts`, `src/client/ui/hud/{hudLayer,pauseButton,hudBatch,countdown}.ts`, `src/client/ui/screens/{startScreen,pauseScreen,portraitOverlay}.ts`, `src/client/ui/styles/{tokens,fonts}.css`, `public/fonts/*`, `tests/architecture/{designTokens,uiStrings,yamlSubset}*.ts` with `fixtures/uiStrings/`, `tests/e2e/ui.spec.ts`, `tests/e2e/support/game.ts`. `overlay.ts`, `surface.ts`, `orientation.ts` and `levelSession.ts` are additions to the documented tree in the same layer (`app/`), no new top-level folder.
- Modified: `index.html`, `src/main.ts` (the CSS imports: `tokens.css`, `fonts.css`, `ui.css`), `src/client/boot.ts`, `src/client/app/clientEvents.ts`, `src/client/ui/styles/ui.css`, `src/shared/constants.ts`, `content/strings.fr.json`, `tests/e2e/{boot,pauseResume}.spec.ts`, `_bmad-output/implementation-artifacts/deferred-work.md`.

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests the systems, Geo plays and tunes the feel; tweakable things are data; everything stays playable end to end without a human. The `data-pp-*` mirrors let an agent see the app flow before `window.__PP__` exists.
- **UI:** vanilla DOM + CSS with `pp-` kebab-case classes, no framework, no WebGL UI. The UX spec (`DESIGN.md`, `EXPERIENCE.md`) is the source of truth; `tokens.css` mirrors the frontmatter 1:1 (test-enforced); never hard-code a colour, size or UI string; strings go through `t(key)`. Reduced motion is client-only and never changes sim timing.
- **Time and pause:** pause = the loop stops stepping; resume after a 3 s real-time countdown; never `timeScale = 0`; every resume counts down (no way around it).
- **Platform:** landscape only (web shows « Tourne ton téléphone »), respect `env(safe-area-inset-*)`, touch targets at least 44 × 44, HUD in fixed zones, DPR `min(devicePixelRatio, 2)`. No Capacitor before E8; no `navigator.vibrate` outside `src/platform` (the countdown vibration is story 1.9, behind `Platform.haptics`).
- **Errors and logs:** `Result` for I/O-like boundaries (fonts), `invariant` for programmer errors (illegal FSM move), every fallback logs a `warn`, `log.<level>(channel, message, data?)`, nothing above `debug` in hot paths, no `console.*`.
- **Performance:** frame at most 16.6 ms, zero allocation in the frame callback, HUD updates batched once per frame, no `backdrop-filter`, no blur filters.
- **Testing:** unit tests next to the code, e2e on chromium and webkit at a landscape phone viewport, no `waitForTimeout` to let the game play, architecture tests are guardrails.
- **Stack pinned:** no ESLint/Prettier/React/ECS/state libs, no new dependency.
- **When docs disagree:** game rules follow the GDD, technical mechanics the architecture; the UX spines win over their mockups; if still ambiguous, ask Geo.

### Deferred by this story

- **Gauge pill and timer content** (zones are reserved and empty): stories 1.19 and 1.18; their own e2e then checks live values, the node budget with content, and `scaleX`-only fills.
- **Loading screen, « Oups » screen, `oops → loading`**, level waiting for the foreground: story 1.6.
- **Tick sound and vibration of the countdown, audio unlock** (`CountdownTicked`, `StartGestureReceived` are ready): story 1.9.
- **Settings, « Réduire les animations », « Grands verbes », « Quitter vers le frigo »:** stories 2.8, 2.10, 3.11.
- **Gamepad Start/Options and disconnect pause, the « Manette débranchée » line, the set of pause reasons:** story 1.17. **Android back:** E8.
- **Unused-string-key check** (many keys are still unwired): when the Fridge and Result stories land.

### Out of scope (belongs to other stories)

- Level geometry, `.glb`, the real loading screen (1.6). Papa, input, hit-testing, tap marker (1.7, 1.11). Feedback, audio, haptics (1.9). `window.__PP__`, `?autoplay`, `?seed` (1.13). Hitstop (1.14). Auto-target keys and glyph chip (1.17). Gauges, timer, fatigue (1.18, 1.19). Result screen (1.22). Calibration (2.7). Debug overlay and feel panel (2.1). Fridge (3.11).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5 : Fondations de l'UI : tokens, écran de démarrage, HUD et panneau de pause]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences UX (UX-DR1 à UX-DR7, UX-DR26)] and [#Story 1.4] (the pause controller and countdown this story draws), [#Story 1.6] (loading, « Oups »), [#Story 1.9] (audio unlock, countdown cues), [#Story 1.17] (gamepad pause), [#Story 1.18, 1.19] (timer, gauges)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] (frontmatter, Colors, Typography, Layout & Spacing, Elevation & Depth, Components: button-*, panel, hud-gauge, hud-timer, countdown)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] (Information Architecture, Voice and Tone, Canonical on-screen strings, Component Patterns, State Patterns › Start, Pause, Portrait, HUD & Diegetic UI, Responsive & Platform, Performance Budget (UI), Localization, Accessibility Floor) and [`mockups/key-pause.html`] (states A to C; the spines win over it)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Arborescence] (`src/client/ui/`, `app/appFsm.ts`, `public/fonts/`), [#Patterns d'état], [#Patterns de communication], [#Boucle de jeu et modèle de temps], [#Architecture de sécurité] (CSP, `font-src 'self'`), [#Architecture de déploiement] (landscape, portrait screen)
- [Source: _bmad-output/project-context.md] (Feedback, rendering, UI; Performance Rules; Code Organization Rules; Platform & Build Rules; Critical Don't-Miss Rules)
- [Source: _bmad-output/implementation-artifacts/1-4-boucle-client-vue-isometrique-et-pause-exacte.md] (pause controller contract, D3/D7, Review Findings) and [deferred-work.md] (mobile canvas CSS, only the first pause reason is kept, unused string keys)

### Open points for Geo (do not block the dev)

1. D1: a level now always starts with the 3 s countdown (story 1.6 asks for it at level start; it is pulled forward so « Recommencer » and the first start share one path). Each restart costs 3 s while tuning the feel; say if you want a shorter or skippable one in dev builds.
2. D6: `DESIGN.md` says `touch-target-min: 44pt`; as CSS that is 58.7 px. The story reads it as 44 CSS px. Consider changing the frontmatter to `44px` so the mirror needs no exception.
3. The portrait overlay also covers a narrow desktop window (`orientation: portrait`). Say if desktop should be exempt.
4. The 12 % HUD band and the 44 px target conflict below about 367 px of viewport height (for instance an iPhone 12 in Safari with its bars shown: about 340 px). The 44 px target wins.
5. D14: Escape during the countdown re-opens the pause panel.
6. Wording is `[ASSUMPTION]` in the UX spine: `start.title` « Papa Parade » and `hud.pause_button` « Pause » are new strings.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), via the `gds-dev-story` workflow.

### Debug Log References

- Red phase for the pure modules (`appFsm`, `overlay`, `surface`, `orientation`, `keys`, `hudBatch`, `countdown`, `levelSession`): each test file was written with its module; all went green on the first run except the cases below. The translator test caught `strings['constructor']` (an inherited property is not a missing key): `createTranslator` uses `Object.hasOwn`.
- `tests/architecture`: the `PROSE` regex first used a control-character range (Biome `noControlCharactersInRegex`): now `/\P{ASCII}/u`. `designTokens.test.ts` first expected one problem for a two-frame keyframe: it reports two.
- Biome reformats `1.0` to `1` in `tokens.css`; the test compares numbers by value, as planned. `[hidden] { display: none !important }` is a Biome warning (`noImportantStyles`): the rule moved to the end of `ui.css` without `!important` (same specificity, later wins).
- `levelSession.test.ts`: none failed.
- First `ui.spec.ts` run, 8 failures, three causes. (1) Measuring boxes during the 200 ms pop-in (`scale(0.9)`: a 44 px button reads 39.6 px): `settleAnimations` waits for finite animations. (2) A real defect: after a touch tap the browser sends compatibility mouse events to whatever is now under the finger (the new pause veil), which stole the focus the panel had just taken. `bindPressButton` now calls `preventDefault()` on `pointerdown`, which drops them. (3) Test mistakes: the HUD measure included `#pp-hud`, the full-screen root; `transition-property` defaults to `all` over 0 s; `scrollHeight` of a tall font on `line-height: 1` is not a clipped text; the lengthened verbs broke the `MOT !` schema rule (the filler now goes before the closing ` !`); WebKit does not Tab to buttons by default.
- A last race in the whole-session test: two `setViewportSize` calls in a row can merge in WebKit; the test waits for the portrait overlay in between.
- Guards proved by breaking things and restoring (files compared with backups afterwards): a hard-coded `#fff` and a `backdrop-filter` in `ui.css` each fail `designTokens`; deleting `--pp-color-ink-soft` from `tokens.css` fails `designTokens`; a French literal in `src/client/ui/` and an unknown string key in `src/client/app/` each fail `uiStrings`; `requestResume()` skipping the countdown fails 6 `pauseController` tests.
- Manual check in the built-in browser pane (dev server on a temporary port 5180 with a temporary `.claude/launch.json`, deleted afterwards).

### Completion Notes List

- **All 9 tasks done, all 11 ACs met.** `npm run ci` passes end to end: typecheck, lint, content:check, 711 unit, golden and architecture tests (`src/sim` coverage 100 % lines / 92.5 % branches, threshold 90 %), 52 e2e on chromium + webkit, `build:playtest`. `biome.json`, the existing `tests/architecture/` files (`scanners.ts` included), `package.json` and the lockfile are untouched; `content/_schemas/` did not change.
- **New tests:** 166 unit and architecture tests (appFsm, overlay table, surface, orientation, levelSession, keys, hudBatch, countdown, translator, fonts, pure part of the press button, YAML subset, design tokens with good and bad inputs, UI strings with 7 failing fixtures and a clean one) and 26 e2e per browser in `ui.spec.ts` (start gestures and fonts and no external request, press-on-down and act-on-up and slide-out, panel focus and inert HUD and veil colour, pop-in budget and reduced motion, Escape toggling, countdown digits, restart with a new seed, portrait, HUD geometry on both surfaces, notch simulation, buttons audit, arrows and ring and Enter and Space, +30 % strings, a whole session without console error), plus the updated `boot`, `contentError` and `pauseResume` specs.
- **Choices inside the spec (all small, all documented in code):**
  - `uiShell.ts`, `svg.ts` and `overlayScreen.ts` are small additions to the planned file list (same layers): the shell ties app state, pause state and the portrait flag to what is shown; the other two are shared helpers.
  - The level always starts through the countdown (D1) by pausing with the new `levelStart` reason and resuming **before** `appFsm.enter('level')`, so the pause panel never builds for it. A start while portrait or hidden is left paused (`canResumeNow`), so the panel shows when the player comes back.
  - A failed `createSim` goes to `oops` and logs an error (the screen is story 1.6; the overlay host warns once that there is no `oops` screen).
  - `createHudBatch([])` has no slot yet: the loop's render still calls `flush()` once per frame, so stories 1.18 and 1.19 only add writers.
  - The press button cancels `pointerdown` (see Debug Log): it also means a mouse press does not focus the button, which the panel's own focus handling does not need.
  - The start screen ignores `Escape` as a start key, besides the modifiers, a held key and Ctrl/Cmd/Alt chords (`isStartKey`).
  - The +30 % e2e test adds `' ab'` (or `' AB'` before the closing ` !` of verbs, which the strings schema requires) to every string, through `page.route` on `/content/strings.fr.json?…` (Vite serves it as `export default "<text>"`; confirmed by the test passing).
  - `data-pp-app`, `data-pp-seed` and `data-pp-state` are the debug mirrors (D13), written once more at the end of boot so they only appear when the app is up.
- **Manual check (built-in browser pane, Chromium, 800 × 600):** the start screen shows the title and prompt in Baloo 2 over the dimmed scene; a click starts the level, « 3 » shows with the pause button under the veil; after the countdown the cube slides and the bottom of the screen is free; the pause button opens the panel (« Pause », « Reprendre » focused, « Recommencer »); a 375 × 812 viewport shows « Tourne ton téléphone » on cream. **Not checked:** the iOS Simulator and a real phone (the notch, touch, real DPR, 60 FPS, audio unlock); a real tab switch (covered in e2e with the event dispatched by hand, as in story 1.4); the GitHub ubuntu runner (WebKit there).
- **For Geo (also in `deferred-work.md` and the story's open points):** `44pt` in `DESIGN.md` is read as 44 px; the HUD band and the 44 px target conflict under about 367 px of height; the portrait overlay also covers a narrow desktop window; a restart costs the 3 s countdown; Safari does not Tab to buttons by default (the arrow keys are tested in both browsers, Tab in chromium only).
- **Nothing committed.**

### File List

New:
- `public/fonts/{baloo-2-latin-wght-normal,nunito-latin-wght-normal,anton-latin-400-normal}.woff2`, `public/fonts/OFL-{baloo-2,nunito,anton}.txt`
- `src/client/ui/strings.ts`, `src/client/ui/strings.test.ts`
- `src/client/ui/fonts.ts`, `src/client/ui/fonts.test.ts`
- `src/client/ui/keys.ts`, `src/client/ui/keys.test.ts`
- `src/client/ui/pressButton.ts`, `src/client/ui/pressButton.test.ts`
- `src/client/ui/overlayHost.ts`, `src/client/ui/overlayScreen.ts`, `src/client/ui/svg.ts`, `src/client/ui/uiShell.ts`
- `src/client/ui/hud/{hudBatch,hudLayer,pauseButton,countdown}.ts`, `src/client/ui/hud/{hudBatch,countdown}.test.ts`
- `src/client/ui/screens/{startScreen,pauseScreen,portraitOverlay}.ts`
- `src/client/ui/styles/tokens.css`, `src/client/ui/styles/fonts.css`
- `src/client/app/{appFsm,overlay,surface,orientation,levelSession}.ts` and their `.test.ts`
- `tests/architecture/{yamlSubset,designTokens,uiStringScanner}.ts`, `tests/architecture/{yamlSubset,designTokens,uiStrings}.test.ts`, `tests/architecture/fixtures/uiStrings/**` (8 fixtures)
- `tests/e2e/ui.spec.ts`, `tests/e2e/support/{game,strings}.ts`

Modified:
- `index.html` (`#pp-hud`, font preloads), `src/main.ts` (CSS imports)
- `src/client/boot.ts` (rewritten as the composition root of the new flow)
- `src/client/app/clientEvents.ts` (`levelStart`, `AppStateChanged`, `StartGestureReceived`, `CountdownTicked`)
- `src/client/ui/styles/ui.css`
- `src/shared/constants.ts` (5 constants)
- `content/strings.fr.json` (`start.title`, `hud.pause_button`)
- `tests/e2e/{boot,contentError,pauseResume}.spec.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-5-fondations-de-l-ui-tokens-ecran-de-demarrage-hud-et-panneau-de-pause.md` (this file)

## Change Log

- 2026-10-27: Story 1.5 created (ready-for-dev).
- 2026-10-27: Story 1.5 implemented: design tokens mirrored from `DESIGN.md` and tested, self-hosted fonts, `t()` and a no-UI-text-in-code test, `appFsm`, overlay host (start, pause with countdown, portrait), DOM HUD zones with the pause button, press-on-down / act-on-up buttons with keyboard and focus ring, level session (a level always starts through the countdown), composition root rewritten, unit, architecture and e2e tests (status: review).
