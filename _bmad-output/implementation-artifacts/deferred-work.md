# Deferred work

## Deferred from: code review of story 1-1-initialiser-le-projet-et-ses-garde-fous (2026-10-26)

- **Type-level isolation of the sim.** `tsconfig.json` gives `src/sim` the DOM `lib` and the Node `types`, so `window`, `document`, `process` or `Buffer` compile there; only Biome and the `simPurity` scanner stop them. A `src/sim/tsconfig.json` with `lib: ['ES2023']` and `types: []` would add a compile-time guard. Beyond story 1.1.
- **Biome vs `simPurity` on sim tests.** Biome lints `*.test.ts` under `src/sim` with the purity globals while `simPurity` skips them (AC 3). Decide with story 1.3, when the first sim test exists. **Resolved in story 1.3: no change** (Biome stays strict on sim tests, `simPurity` keeps skipping them; a sim test that needs a clock or randomness belongs in `tests/`).
- **Mobile canvas CSS.** `#pp-canvas` uses `100vw`/`100vh` as T2 specifies; the area under mobile browser bars is included. Missing: `100dvh`, `touch-action: none`, `overscroll-behavior`, safe-area insets. Stories 1.4 and 1.5. **Resolved in story 1.4:** `100dvh` (in an `@supports` block, since Biome rejects the duplicate `height`), `touch-action: none`, `overscroll-behavior: none`, `user-select` and `-webkit-touch-callout` are done; the safe-area insets are the HUD's, story 1.5. **Resolved in story 1.5:** the safe-area insets are `env(safe-area-inset-*)` in the `--pp-spacing-screen-margin-*` and `--pp-spacing-hud-inset-*` tokens (four sides each) and the HUD and overlays use them; a notch is simulated in e2e by overriding those variables, and the real notch is a manual check.
- **Global error hook.** No `error` / `unhandledrejection` listener feeds `log.error`, so uncaught errors on a phone never reach the ring buffer. Composition root, story 1.4. **Resolved in story 1.4:** `installGlobalErrorHandlers(window)` is the first call of `boot()` and logs both events through `log.error`; the player-facing « Oups » screen stays story 1.6.
- **Duplicated Biome override lists.** `src/sim/**` and `src/sim/physics/rapierPhysics.ts` repeat the whole `deniedGlobals` and import pattern lists by hand. Add a drift test if the lists grow.
- **Build coverage in CI.** CI never runs `npm run build` (production, `VITE_DEBUG_ALLOWED=false`) and e2e runs against the dev server, not the built bundle; `isMobile` is not emulated. Story 1.24.
- **Placeholder favicon.** `public/favicon.svg` is the stock Vite logo. Replace with real branding assets.

## Deferred from: creation of story 1-2-pipeline-de-contenu-et-fichier-de-feeling (2026-10-26)

- **Armed label of "Quitter vers le frigo".** The canonical string « Sûr ? Le niveau sera perdu. » (`EXPERIENCE.md` › Canonical on-screen strings) contains « perdu », which Voice and Tone and NFR9 forbid. It is not seeded in `content/strings.fr.json`. Geo reformulates it before story 3.11 (decision of 2026-10-26: later).

## Deferred from: code review of story 1-2-pipeline-de-contenu-et-fichier-de-feeling (2026-10-26)

- **`loadContent` does not loop over `CONTENT_FILES`.** It hard-codes `FEEL_FILE` and `STRINGS_FILE` and reference-checks only `feel`. The bundle is typed `{ feel, strings }`, so a registry loop only pays off with the third file. Revisit with the threat files (story 1.6).
- **`…Key` reference detection is narrow.** `KEY_PROPERTY` matches a singular `…Key` string: arrays of keys (`labelKeys`) are not checked, and names like `hotKey` or `apiKey` would be false positives. Revisit when the first threat file arrives.
- **Browser content source inlines every `content/**/*.json` in the main bundle** and derives the relative key with `lastIndexOf('/content/')`. Bundle size belongs to the performance budget (story 1.24); a nested `content/` folder is hypothetical.
- **No unused-string-key check.** Dead strings cannot be told from "not wired yet" until the client reads strings (stories 1.5+).
- **End-to-end test of `…Key` references.** The wiring in `loadContent` and `checkContent` is only covered through the `checkStringReferences` helper: `FeelSchema` is strict and no content file has a `…Key` field yet. Add the "reference to a missing string" test to both when the first threat file (story 1.6) has a `verbKey`.
- **Player-facing fallback when content fails outside dev.** `main.ts` only logs, so a playtest build with bad content shows an empty page (the `oops.message` / `oops.retry` strings are unused, and `void main()` drops any rejection). Story 1.4 (composition root), with the global error hook deferred from story 1.1. **Resolved in story 1.4: moved to story 1.6**, with the « Oups » screen (the epic puts it there, not in 1.4); `boot()` still only logs and, in dev, shows the content error screen.
- **Feel bounds are loose on purpose.** `windowMultiplier` accepts 0, `windowPenaltyPct` can reach 100, `earlyWakePenaltyStars` has no max of 5, `microSleepMinMs` accepts 0, and nothing checks that the Mama score can reach the top star threshold. Geo keeps them loose to experiment; tighten when the sim reads these values (story 1.6 onwards).

## Deferred from: creation of story 1-3-coeur-de-simulation-deterministe-en-headless (2026-10-26)

- **Periodic snapshots every 5 s (`SNAPSHOT_EVERY_MS`).** Story 1.3 delivers manual `snapshot()` / `restore()` only. The 5 s cadence and the snapshot list belong to the replay of best moments (story 3.9).
- **`JournalSchema`, `contentVersion` / `levelId` in the journal.** Story 1.3's `Journal` is `{ version, seed, feelHash, entries }` as a TypeScript type. The Zod schema, the content/level version and the export arrive with story 3.3 (levels do not exist before 1.6).
- **Effective feel in `World`.** `ctx.feel` is constant per sim in story 1.3. When `SetFeel` arrives (story 2.1) the effective feel has to live in the snapshotted state.
- **Slow-mo duration unit.** `feel.json` documents `slowMo*.durationMs` as real ms; the sim has no real clock. Story 1.14 decides how the sim counts it (and the overlap rule). Also for story 1.14: the freeze overlap rule (story 1.3 keeps `max`).
- **Rapier in the snapshot.** Story 1.15 adds the Rapier blob to `SimSnapshot` and bumps its `version`.

## Deferred from: code review of story 1-3-coeur-de-simulation-deterministe-en-headless (2026-10-27)

- **`cloneJson` normalises `-0` to `0`.** A restored world can differ from the live one where the sign of zero matters (`Math.atan2`, `1/x`). Latent: the sim has no float math yet. Decide with the first movement code (story 1.7).
- **The golden scenario never touches the rng or ids.** `core_basic` only sends `SetTimeScale`, and the determinism test compares two runs of the same process. The first gameplay golden (story 1.10) must exercise rng, ids and events.
- **Invariant strictness follows the build.** A playtest build (`PROD`) clamps what dev and CI throw on, and a journal recorded in one mode replays differently in the other. Matches the architecture; story 3.3 should record the mode in the exported journal.

## Deferred from: creation of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **Adaptive DPR** (2 → 1.5 → 1 on mean frame time). `pixelRatioFor` only caps at `MAX_PIXEL_RATIO`. Story 1.24, with the performance budget.
- **Interpolation of entity views** (`render/interpolate.ts`, previous and current state). `alpha` only feeds the probe cube today. Story 1.7, with the first moving entity.
- **`Platform.lifecycle`** replacing the direct `visibilitychange` listener, and Capacitor's app-state event. When `src/platform` is created, and in E8.
- **Forbid `@shared/emitter` in `src/sim`** with a Biome pattern and a scanner rule (like R3b for `@shared/log`). Add it if a second client-only shared module appears.
- **The « Oups » screen**, the player-facing fallback for a renderer or content failure, and restarting the level after an uncaught error. Story 1.6.

## Deferred from: implementation of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **`timeMap.reset()` after `sim.restore()`.** The loop records `world.time.sim + accumulator`, which jumps back when a snapshot is restored; `timeMap.record` throws on a sim time that goes back (the loop's monotone clamp would instead hold the old clock). Nothing restores a sim in the client yet. Story 3.9 (replay of the best moments) must call `timeMap.reset()` and reset the loop's clock when it restores.
- **One `frame stall` warning at boot in dev.** The second frame arrives about 100 ms late (seen as « dropped 90 ms of sim backlog » in the Playwright server log, probably the first render), so the loop drops that backlog and warns once. Harmless (nothing is happening yet); revisit with the loading screen (story 1.6), which can render once before the loop starts.
- **The room is assumed centred on the origin.** `fitIsoCamera` takes only a size; story 1.6 passes the real level bounds and may need a `center` field.
- **WebGL in CI.** The e2e specs need a WebGL context in chromium and webkit; both create one on the development Mac. Not yet seen on GitHub's ubuntu runner (webkit on Linux is the suspect). If a project cannot create one, report the exact error here and keep the test active for the other.
- **Bundle size.** `npm run build:playtest` gives a 645 kB JS chunk (168 kB gzip) now that `three` is in; Vite warns above 500 kB. Named imports are already used. Code-splitting or `three` trimming belongs to the performance budget, story 1.24.

## Deferred from: code review of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **`timeMap.realToSim` extrapolates without a bound.** A pause that starts between two frames (hidden tab: rAF stops, so no rate-0 record is written) leaves the newest record at rate 1, and a query before the next frame maps up to the hidden duration into the sim future. No caller yet. Decide with the first caller (stories 1.7 / 1.11): record a rate-0 point on `PauseRequested`, or cap the extrapolation to a couple of frames.
- **Only the first pause reason is kept.** `requestPause` returns early when already `paused`, so `portrait` then `gamepadDisconnected` loses the second and the player can resume while it still holds. Story 1.5 needs a set of reasons (and a `blockedBy` for the resume). **Resolved in story 1.5 for portrait:** portrait is a UI flag (`isPortrait`), not a pause reason; the overlay is derived from it and no code path resumes while it is true (Escape included). The set of reasons is still needed for the gamepad (story 1.17).
- **WebGL context loss and teardown.** Context loss is only logged (the loop keeps stepping into a dead context); `GameRenderer.dispose()` lacks `forceContextLoss()` and `ProvisionalScene` has no `dispose()`. Story 1.6 (« Oups » screen, level reload).
- **No listener isolation in `Emitter.emit`.** A throwing listener skips the next ones and ends the loop (D4 fail-stop). Fine while listeners are internal; decide with story 1.9 (audio, `FeedbackDirector`).
- **Resize can show one cleared frame.** `setSize` clears the canvas from a `ResizeObserver` callback (after rAF, before paint), and runs twice per resize (observer and window `resize`). Render in the same callback or mark the size dirty for the next frame. Polish, story 1.24.

## Deferred from: implementation of story 1-5-fondations-de-l-ui-tokens-ecran-de-demarrage-hud-et-panneau-de-pause (2026-10-27)

- **Gauge pill and timer content.** The HUD has the three zones and the pause button; the gauge and timer zones are reserved and empty. Stories 1.19 and 1.18 fill them, and add their own e2e (live values, the 40-node budget with content, `scaleX`-only fills).
- **Loading screen, « Oups » screen, `oops → loading`, « level waits for the foreground ».** `loading` has no screen and `oops` has no builder (the overlay host warns once). A failed `createSim` already goes to `oops` and logs an error. Story 1.6.
- **Countdown tick sound and vibration, audio unlock.** `CountdownTicked` and `StartGestureReceived` are emitted and have no subscriber. The unlock must happen synchronously inside the start gesture (iOS). Story 1.9, which also has to check on a real iPhone that `pointerup` and `keydown` count as unlocking gestures.
- **Settings, « Réduire les animations », « Grands verbes », « Quitter vers le frigo ».** Reduced motion is the OS `prefers-reduced-motion` query only; the panel lists its actions in code (`pauseScreen.ts`). Stories 2.8, 2.10, 3.11.
- **Gamepad Start/Options and disconnect pause, the « Manette débranchée » line.** `PauseReason` already has `gamepadDisconnected`; the panel has no message for it. Story 1.17 (with the set of pause reasons). Android back: E8.
- **Unused-string-key check.** Many keys of `strings.fr.json` are still unwired, so an « unused key » test would be noise. Add it when the Fridge and Result stories land.
- **`DESIGN.md` writes `touch-target-min: 44pt`.** In CSS that is 58.7 px; `tokens.css` uses `44px` and the token test reads `pt` as `px` for that one token. Geo to change the frontmatter to `44px`, then drop the exception in `tests/architecture/designTokens.ts`.
- **HUD band versus touch target on a short viewport.** 44 px is more than 12 % of the height below about 367 px (Playwright's `iPhone 12 landscape` viewport is 750 × 340). The e2e test uses 844 × 390; the 44 px target wins on shorter screens.
- **WebKit does not Tab to buttons by default** (Safari needs a system setting), so the Tab assertion of `ui.spec.ts` runs in chromium only; the arrow keys, which the story also asks for, are asserted in both.
- **The portrait overlay also covers a narrow desktop window** (`orientation: portrait`). Decide with Geo whether desktop is exempt.
- **A restart costs a 3 s countdown** (the level always starts through it, story 1.5 D1). If it slows the tuning loop, add a shorter or skippable one in dev builds.

