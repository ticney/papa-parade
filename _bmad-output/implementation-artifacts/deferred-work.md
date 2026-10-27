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

- **`loadContent` does not loop over `CONTENT_FILES`.** It hard-codes `FEEL_FILE` and `STRINGS_FILE` and reference-checks only `feel`. The bundle is typed `{ feel, strings }`, so a registry loop only pays off with the third file. Revisit with the threat files (story 1.6). *Revisited in story 1.9: the third file (`feedback.json`) is loaded explicitly too, and its string references are checked with feel's; a typed bundle of three fields reads better than a heterogeneous loop. Still open for the threat files, where a loop over a pattern will pay off.* **Resolved in story 1.10:** the threat and level files are `CONTENT_PATTERNS` loaded by reference through `loadLevelContent` (a level names its threat files), not a registry loop.
- **`…Key` reference detection is narrow.** `KEY_PROPERTY` matches a singular `…Key` string: arrays of keys (`labelKeys`) are not checked, and names like `hotKey` or `apiKey` would be false positives. Revisit when the first threat file arrives. *Still open after story 1.10: the outlet has no string field (the verb is `verbKey`, story 2.2). Moved to story 2.2.*
- **Browser content source inlines every `content/**/*.json` in the main bundle** (*story 1.6: the level geometry is now excluded from the glob and loaded as a lazy chunk per level; the other files still go inline*) and derives the relative key with `lastIndexOf('/content/')`. Bundle size belongs to the performance budget (story 1.24); a nested `content/` folder is hypothetical.
- **No unused-string-key check.** Dead strings cannot be told from "not wired yet" until the client reads strings (stories 1.5+).
- **End-to-end test of `…Key` references.** The wiring in `loadContent` and `checkContent` is only covered through the `checkStringReferences` helper: `FeelSchema` is strict and no content file has a `…Key` field yet. Add the "reference to a missing string" test to both when the first threat file (story 1.6) has a `verbKey`. *Still open after story 1.6: the geometry file has no `…Key` field either; the first threat file is story 1.10.* *Still open after story 1.10 (the outlet has no `…Key` field yet). Moved to story 2.2, the first threat field with a string key.*
- **Player-facing fallback when content fails outside dev.** `main.ts` only logs, so a playtest build with bad content shows an empty page (the `oops.message` / `oops.retry` strings are unused, and `void main()` drops any rejection). Story 1.4 (composition root), with the global error hook deferred from story 1.1. **Resolved in story 1.4: moved to story 1.6**, with the « Oups » screen (the epic puts it there, not in 1.4); `boot()` still only logs and, in dev, shows the content error screen. **Still open after story 1.6:** the « Oups » screen of story 1.6 covers a failed level load and an uncaught exception, not a content failure at boot (the strings may be the very thing that failed) nor a missing WebGL context (no scene to put it over); both only log, and a playtest build with bad content still shows an empty page.
- **Feel bounds are loose on purpose.** `windowMultiplier` accepts 0, `windowPenaltyPct` can reach 100, `earlyWakePenaltyStars` has no max of 5, `microSleepMinMs` accepts 0, and nothing checks that the Mama score can reach the top star threshold. Geo keeps them loose to experiment; tighten when the sim reads these values (story 1.6 onwards).

## Deferred from: creation of story 1-3-coeur-de-simulation-deterministe-en-headless (2026-10-26)

- **Periodic snapshots every 5 s (`SNAPSHOT_EVERY_MS`).** Story 1.3 delivers manual `snapshot()` / `restore()` only. The 5 s cadence and the snapshot list belong to the replay of best moments (story 3.9).
- **`JournalSchema`, `contentVersion` / `levelId` in the journal.** Story 1.3's `Journal` is `{ version, seed, feelHash, entries }` as a TypeScript type. The Zod schema, the content/level version and the export arrive with story 3.3 (levels do not exist before 1.6).
- **Effective feel in `World`.** `ctx.feel` is constant per sim in story 1.3. When `SetFeel` arrives (story 2.1) the effective feel has to live in the snapshotted state.
- **Slow-mo duration unit.** `feel.json` documents `slowMo*.durationMs` as real ms; the sim has no real clock. Story 1.14 decides how the sim counts it (and the overlap rule). Also for story 1.14: the freeze overlap rule (story 1.3 keeps `max`).
- **Rapier in the snapshot.** Story 1.15 adds the Rapier blob to `SimSnapshot` and bumps its `version`.

## Deferred from: code review of story 1-3-coeur-de-simulation-deterministe-en-headless (2026-10-27)

- **`cloneJson` normalises `-0` to `0`.** A restored world can differ from the live one where the sign of zero matters (`Math.atan2`, `1/x`). Latent: the sim has no float math yet. Decide with the first movement code (story 1.7). **Resolved in story 1.7** (D15): nothing in the sim depends on the sign of zero (`Math.sqrt` only, no `Math.hypot`, no trigonometry, no `1/x`; a `Move` direction is normalised with `+ 0`), and the mid-walk snapshot test proves a restored world equals the live one.
- **The golden scenario never touches the rng or ids.** `core_basic` only sends `SetTimeScale`, and the determinism test compares two runs of the same process. The first gameplay golden (story 1.10) must exercise rng, ids and events. **Resolved in story 1.10:** `outlet_parry` allocates ids, draws from the rng (the baby wanders between cycles) and emits the threat events.
- **Invariant strictness follows the build.** A playtest build (`PROD`) clamps what dev and CI throw on, and a journal recorded in one mode replays differently in the other. Matches the architecture; story 3.3 should record the mode in the exported journal.

## Deferred from: creation of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **Adaptive DPR** (2 → 1.5 → 1 on mean frame time). `pixelRatioFor` only caps at `MAX_PIXEL_RATIO`. Story 1.24, with the performance budget.
- **Interpolation of entity views** (`render/interpolate.ts`, previous and current state). `alpha` only feeds the probe cube today. Story 1.7, with the first moving entity. **Resolved in story 1.7:** `render/interpolate.ts` (`lerp`, `interpolateXZ`) feeds `papaView`, from the sim's `prevXM` / `prevZM` (D11).
- **`Platform.lifecycle`** replacing the direct `visibilitychange` listener, and Capacitor's app-state event. When `src/platform` is created, and in E8. *Story 1.9: `src/platform` exists now, with `haptics` and `capabilities` only; `lifecycle` stays E8's.*
- **Forbid `@shared/emitter` in `src/sim`** with a Biome pattern and a scanner rule (like R3b for `@shared/log`). Add it if a second client-only shared module appears.
- **The « Oups » screen**, the player-facing fallback for a renderer or content failure, and restarting the level after an uncaught error. Story 1.6. **Resolved in story 1.6** for a failed level load and an uncaught exception (`oops → loading`, « Réessayer », `?throwAfterMs` e2e); the renderer and boot-time content failures stay open (see story 1.2's item).

## Deferred from: implementation of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **`timeMap.reset()` after `sim.restore()`.** The loop records `world.time.sim + accumulator`, which jumps back when a snapshot is restored; `timeMap.record` throws on a sim time that goes back (the loop's monotone clamp would instead hold the old clock). Nothing restores a sim in the client yet. Story 3.9 (replay of the best moments) must call `timeMap.reset()` and reset the loop's clock when it restores.
- **One `frame stall` warning at boot in dev.** The second frame arrives about 100 ms late (seen as « dropped 90 ms of sim backlog » in the Playwright server log, probably the first render), so the loop drops that backlog and warns once. Harmless (nothing is happening yet); revisit with the loading screen (story 1.6), which can render once before the loop starts. **Resolved in story 1.6:** the level scene is built and drawn behind the loading screen before the loop starts, and no `frame stall` line appears in the dev-server log of the whole e2e run.
- **The room is assumed centred on the origin.** `fitIsoCamera` takes only a size; story 1.6 passes the real level bounds and may need a `center` field. **Resolved in story 1.6:** `RoomSize` has optional `centerXM` / `centerZM`, and the camera aims at the room centre.
- **WebGL in CI.** The e2e specs need a WebGL context in chromium and webkit; both create one on the development Mac. Not yet seen on GitHub's ubuntu runner (webkit on Linux is the suspect). If a project cannot create one, report the exact error here and keep the test active for the other.
- **Bundle size.** `npm run build:playtest` gives a 645 kB JS chunk (168 kB gzip) now that `three` is in; Vite warns above 500 kB. Named imports are already used. Code-splitting or `three` trimming belongs to the performance budget, story 1.24.

## Deferred from: code review of story 1-4-boucle-client-vue-isometrique-et-pause-exacte (2026-10-27)

- **`timeMap.realToSim` extrapolates without a bound.** A pause that starts between two frames (hidden tab: rAF stops, so no rate-0 record is written) leaves the newest record at rate 1, and a query before the next frame maps up to the hidden duration into the sim future. No caller yet. Decide with the first caller (stories 1.7 / 1.11): record a rate-0 point on `PauseRequested`, or cap the extrapolation to a couple of frames. **Resolved in story 1.7** (D14): the extrapolation is capped at `TIME_MAP_MAX_EXTRAPOLATION_MS` (100) with a `warn`; the input mapper's gate (only a running level) is the first line of defence.
- **Only the first pause reason is kept.** `requestPause` returns early when already `paused`, so `portrait` then `gamepadDisconnected` loses the second and the player can resume while it still holds. Story 1.5 needs a set of reasons (and a `blockedBy` for the resume). **Resolved in story 1.5 for portrait:** portrait is a UI flag (`isPortrait`), not a pause reason; the overlay is derived from it and no code path resumes while it is true (Escape included). The set of reasons is still needed for the gamepad (story 1.17).
- **WebGL context loss and teardown.** Context loss is only logged (the loop keeps stepping into a dead context); `GameRenderer.dispose()` lacks `forceContextLoss()` and `ProvisionalScene` has no `dispose()`. Story 1.6 (« Oups » screen, level reload). **Partly resolved in story 1.6:** `LevelScene.dispose()` frees geometries, materials and textures and runs on every level replacement. The context-loss handling and `forceContextLoss()` stay open.
- **No listener isolation in `Emitter.emit`.** A throwing listener skips the next ones and ends the loop (D4 fail-stop). Fine while listeners are internal; decide with story 1.9 (audio, `FeedbackDirector`). **Resolved in story 1.9: no change.** The emitter stays fail-stop; every listener that does I/O (audio engine, haptics, director) catches its own Web Audio / `vibrate` exceptions and rejections and logs a `warn`.
- **Resize can show one cleared frame.** `setSize` clears the canvas from a `ResizeObserver` callback (after rAF, before paint), and runs twice per resize (observer and window `resize`). Render in the same callback or mark the size dirty for the next frame. Polish, story 1.24.

## Deferred from: implementation of story 1-5-fondations-de-l-ui-tokens-ecran-de-demarrage-hud-et-panneau-de-pause (2026-10-27)

- **Gauge pill and timer content.** The HUD has the three zones and the pause button; the gauge and timer zones are reserved and empty. Stories 1.19 and 1.18 fill them, and add their own e2e (live values, the 40-node budget with content, `scaleX`-only fills).
- **Loading screen, « Oups » screen, `oops → loading`, « level waits for the foreground ».** `loading` has no screen and `oops` has no builder (the overlay host warns once). A failed `createSim` already goes to `oops` and logs an error. Story 1.6. **Resolved in story 1.6:** the loading screen, the « Oups » screen, `oops → loading` and the wait for the foreground exist and are covered by `tests/e2e/level.spec.ts`.
- **Countdown tick sound and vibration, audio unlock.** `CountdownTicked` and `StartGestureReceived` are emitted and have no subscriber. The unlock must happen synchronously inside the start gesture (iOS). Story 1.9, which also has to check on a real iPhone that `pointerup` and `keydown` count as unlocking gestures. **Resolved in story 1.9** for the unlock (synchronously in the start gesture, before `StartGestureReceived`) and the vibration (`countdown_tick`, a light haptic per digit). The tick **sound** stays open (the countdown is silent; see « Deferred by story 1.9 »), and so does the real-iPhone check that `pointerup` and `keydown` unlock.
- **Settings, « Réduire les animations », « Grands verbes », « Quitter vers le frigo ».** Reduced motion is the OS `prefers-reduced-motion` query only; the panel lists its actions in code (`pauseScreen.ts`). Stories 2.8, 2.10, 3.11.
- **Gamepad Start/Options and disconnect pause, the « Manette débranchée » line.** `PauseReason` already has `gamepadDisconnected`; the panel has no message for it. Story 1.17 (with the set of pause reasons). Android back: E8.
- **Unused-string-key check.** Many keys of `strings.fr.json` are still unwired, so an « unused key » test would be noise. Add it when the Fridge and Result stories land.
- **`DESIGN.md` writes `touch-target-min: 44pt`.** In CSS that is 58.7 px; `tokens.css` uses `44px` and the token test reads `pt` as `px` for that one token. Geo to change the frontmatter to `44px`, then drop the exception in `tests/architecture/designTokens.ts`.
- **HUD band versus touch target on a short viewport.** 44 px is more than 12 % of the height below about 367 px (Playwright's `iPhone 12 landscape` viewport is 750 × 340). The e2e test uses 844 × 390; the 44 px target wins on shorter screens.
- **WebKit does not Tab to buttons by default** (Safari needs a system setting), so the Tab assertion of `ui.spec.ts` runs in chromium only; the arrow keys, which the story also asks for, are asserted in both.
- **The portrait overlay also covers a narrow desktop window** (`orientation: portrait`). Decide with Geo whether desktop is exempt.
- **A restart costs a 3 s countdown** (the level always starts through it, story 1.5 D1). If it slows the tuning loop, add a shorter or skippable one in dev builds.

## Deferred from: code review of story 1-5-fondations-de-l-ui-tokens-ecran-de-demarrage-hud-et-panneau-de-pause (2026-10-27)

- **`levelSession.stop()` does not cancel a start awaiting `createSim`.** The start resumes, builds a loop and enters `level` after a teardown. No caller does it yet; add a generation token with the first teardown path. Story 1.6. **Resolved in story 1.6:** `stop()` bumps a generation token and frees the single-flight guard; a start that resumes after it does nothing more (unit and e2e tests).
- **Focus and screen-reader semantics.** No focus restore when an overlay closes, no Tab trap in the `aria-modal` panel, no focus target for the countdown, the start button's `aria-label` hides the title, no role on the portrait overlay. The story pins focus to `document.body` after the panel and `aria-label` = the prompt. Accessibility pass, story 2.10.
- **The start screen starts on any window `pointerup`,** including the tail of a gesture begun before it was mounted. D15 pins it; require a `pointerdown` seen while mounted when the audio unlock is checked on a device. Story 1.9. **Resolved in story 1.9:** a tap or click starts only on the `pointerup` of a pointer whose primary `pointerdown` the screen saw while mounted (`createStartGesture`); keys are unchanged.
- **`paint-order` fallback for `.pp-stroked`.** Chromium 123+ and Safari 11+ paint the stroke behind the fill for HTML text; an older WebView would let the stroke eat the glyphs. Add an `@supports not (paint-order: stroke fill)` fallback if the device pass finds one. E8 device pass.
- **The press state machine has no unit test** (pointer id tracking, `detail === 0`, slide-out, multi-touch); only `isInsideRect` does. Extract a pure reducer with the input mapper. Story 1.11. **Partly resolved in story 1.11:** the in-game threat press is a pure, tested tracker (`threatPress.ts`); the UI button press machine (`pressButton.ts`) is unchanged, moved to the accessibility pass (2.10).
- **No « every animation has a reduced-motion override » check** in `tests/architecture/designTokens.ts`. With the « Réduire les animations » setting, story 2.8.

## Deferred from: implementation of story 1-6-salon-greybox-depuis-blender (2026-10-27)

- **Preloading the level while the start screen shows, and a cache of parsed assets across restarts.** At `start` the canvas shows an empty ink backdrop; the room appears after the first gesture, behind the loading screen (D6). Every « Recommencer » reloads the level (D7). Revisit with real assets (E7) or if Geo wants the room behind the title.
- **No drift check between the `.blend` / raw export and the committed geometry.** The shipped `.glb` is optimised, so it cannot be re-extracted; a stale `salon_crawler.geometry.json` is only caught by re-running `assets:export` → `assets:extract` → `assets:optimize`. A source hash written by the extractor, checked against the `.blend`, is the next step if this bites.
- **Collision, navigation, zone and anchor nodes still ship in the `.glb`** (D4) and `PROP_*` stay static meshes. Story 1.15 replaces the props with pooled physics views; if the extra nodes ever matter, `export_level.py` can write a second file.
- **The sim does not read the geometry yet.** Navigation, colliders and zones reach it in stories 1.7, 1.10 and 1.21; the schema type lives in `@content` for that. **Partly resolved in story 1.7:** `createSim` takes the geometry (D1) and reads its navigation grid for Papa; colliders and zones stay for stories 1.10, 1.15 and 1.21. **Partly resolved in story 1.10:** the sim reads the threat anchors (`createSim` checks them and places each threat); colliders (1.15) and zones (1.21) stay.
- **Only axis-aligned and 90° boxes** for `COL_`, `NAV_`, `ZONE_` (D3): the extractor refuses any other rotation. Convex or rotated colliders come with a story that needs them.
- **Debug views of navigation, colliders and anchors:** story 2.1 (the client removes those nodes after loading).
- **The `.blend` was built through Blender MCP and is reproducible only from the committed file.** There is no script that regenerates it from scratch; Geo edits it in Blender and re-runs the three `assets:*` commands.
- **Tool tests live in `tests/tools/`**, because `vitest.config.ts` only includes `src/**` and `tests/**`; `tools/` itself has no co-located tests.
- **Bundle size:** the glTF loader and meshopt decoder are a lazy 72 kB chunk, the geometry a 3 kB chunk per level; the main chunk (three) is 715 kB. Story 1.24.
- **No WebGL means no « Oups »:** when `createRenderer` fails there is no canvas to put the screen over and `boot()` returns after logging. A plain-DOM fallback is a separate decision.

## Deferred from: code review of story 1-6-salon-greybox-depuis-blender (2026-10-27)

- **Loading screen polish.** `role="status"` with `aria-live="polite"` re-announces every rotating line; the 5 s bottle animation is a CSS literal (not data, ends at 0.9 scale, never jumps to full when the screen goes); a sub-100 ms load flashes the opaque screen. Accessibility pass story 2.10; the fill duration with the performance and feel pass. Reason: not an AC, and accessibility is already scheduled.
- **The toon swap keeps only `color` of `material[0]`.** `side`, `transparent`, `opacity`, `alphaTest`, `emissive` and the further materials of an array are lost, and the cache key is the sRGB hex. Fine for opaque greybox cubes; revisit with the final art, E7. Reason: provisional material by design (AC 4).
- **Blob shadow eligibility is a height heuristic** (`BLOB_MAX_TOP_M`, non-zero half extents): a raised collider or a low partition gets a blob on the floor, a tall wall gets none, and only code changes it. Move it to a flag from Blender or to data with the art pass, E7. Reason: provisional.
- **More cross-field checks for `LevelGeometrySchema`.** `cellM` is not tied to `NAV_CELL_M`; colliders, zones and props are not checked against the bounds; a prop's `kind` is not checked against its id prefix. Add them when the sim reads the geometry (stories 1.7, 1.10). Reason: nothing consumes them yet. **Partly resolved in story 1.7:** `cellM` is now `NAV_CELL_M` (the sim's grid maths assume it); the other checks stay open. **Partly resolved in story 1.10:** the anchors a level plans are checked by `content:check` (and by `createSim`); bounds and prop kinds stay open.

## Deferred from: implementation of story 1-7-deplacer-papa (2026-10-27)

- **Analog walking speed** from the stick magnitude. The stick walks at full speed past its deadzone (D5, Open point 3); a slow walk with a half push is a feel choice for Geo.
- **Papa and the baby, art pass E7: inverted-hull outline** (ADR-008 puts outlines on characters). Moved here by story 1.8: the baby is a provisional sphere too, so neither gets an outline before E7. Reason: both are provisional.
- **Iso-flattened tap marker** (an ellipse lying on the floor) if Geo prefers it to the flat circle on screen (Open point 5).
- **Clearance per agent from data** beyond `papaRadiusM`. The baby's radius and grid arrive with story 1.8 (`ctx.nav.baby`). **Resolved in story 1.8:** `feel.baby.bodyRadiusM` and `ctx.nav.baby` (built once, with the baby's own clearance).
- **Debug view of the open mask and the path** (story 2.1's navigation view). The client has the geometry; the sim keeps the grid in `ctx.nav`, outside `World`.
- **A tap on a threat, the baby or an object** (hit-test priority threat > baby > object > floor): stories 1.11, 1.17 and the interactions of 1.19 / 1.20. `createHitTester` only picks the floor today. **Partly resolved in story 1.11:** threat > floor (`pickThreat`); the baby and objects stay with 1.17, 1.19 and 1.20.
- **The Gamepad API is secure-context only.** Over plain `http://<LAN ip>` (a phone on `npm run dev --host`) `navigator.getGamepads` is missing: the game logs one `warn` and plays without a pad. Playtest over HTTPS (story 1.24) if a pad matters there.

## Deferred from: code review of story 1-7-deplacer-papa (2026-10-27)

- **Tap marker at the raw tapped point.** It does not move to the snapped target and a failed tap (`findPath` false) still shows it; a marker at `PapaPathPlanned`'s target or a « denied » marker is a design choice. Reason: matches UX-DR9, Open point 5 with Geo.
- **`#pp-world` is `inset: 0` while taps use the canvas rect.** A letterboxed or inset canvas (notch, HUD insets) would offset the marker. Reason: equal today, safe areas come with story 2.10. *Still open after story 1.11: the threat icons share the assumption (hit test on the canvas rect, layer on the window).*
- **Tap marker and `prefers-reduced-motion` / pause.** The marker animates regardless and keeps fading behind the pause panel. Reason: accessibility pass, story 2.10.
- **Papa's yaw has no smoothing** (shortest-arc turn, turn rate in `feel.json`). Reason: Papa is a provisional cube, art pass E7.
- **E2E brittleness.** Taps are chosen by screen share and tied to the level art, `startWalking` walks only a few seconds (a `walkPath` assertion can race), the pause-gate tests are trivially true. Reason: resolve taps from the sim's nav grid when the e2e suite is reworked.
- **Spawn in a tiny region.** `papaSpawnOf` takes the nearest open cell whatever its region. Reason: the current level is fine; add a « spawn region is the main region » check with the level validation, stories 1.10 / 1.21. *Moved to story 1.18 (story 1.10 does not touch it): the first level with real content can also require every planned anchor to be reachable from the baby's spawn region.*

## Deferred from: implementation of story 1-8-le-bebe-vit-dans-le-salon (2026-10-27)

- **Inverted-hull outline** on Papa and the baby (ADR-008): art pass E7 (see the story 1.7 entry, moved there).
- **Baby and Papa colliding** (Papa stepping round the baby, or the baby round Papa): each walks on its own grid and ignores the other (D5). A crawler blocking Papa's path would be a design question (Open point 4 of the story). Reason: not an AC; Geo decides with playtests.
- **Hidden zones in wander:** the baby may wander behind the sofa (`behind_sofa`) while babbling; story 1.21 decides whether wander avoids hidden zones once silence exists.
- **Smoothed turning** of the gaze marker and any crawl animation (bob, squash and stretch): E7. Reason: provisional art.
- **Debug view of the baby's path and grid:** story 2.1's navigation view.
- **E2E stability of « the scene changed » proofs.** The baby moves on its own, so a changing picture no longer proves that Papa walks; the specs that used it now also check Papa's own mirrored position (`papaAt`) at the end of his walk or at the wall. The mirrors are written on events only, so a per-frame proof of Papa's motion still needs `window.__PP__` (story 1.13).

## Deferred from: code review of story 1-8-le-bebe-vit-dans-le-salon (2026-10-27)

- **Agent spawned in a tiny region or walled in never moves, and nothing reports it.** `spawnOf` takes the nearest open cell whatever its region; the baby's failed plan retries a pause forever (D3) with no event. Reason: the retry is the specified behaviour and the sim never logs; the « spawn is in the main region » check belongs to the level validation, stories 1.10 / 1.21 (same item as the Papa entry of story 1.7). *Moved to story 1.18, with the check above.*
- **`Math.random` is not in Biome's `noRestrictedGlobals` for `src/sim`.** Only `tests/architecture/simPurity.test.ts` catches it, while CLAUDE.md says Biome enforces the sim purity rules. Reason: adding a restricted global strengthens a guardrail, Geo's call.

## Deferred by story 1-9-retours-de-base (2026-10-27)

- **Real-device audio check** (iPhone Safari): unlock on `pointerup` and on `keydown` (a Bluetooth keyboard), `resume()` on `GameResumed` outside a gesture, the `interrupted` state after a call, the silent switch muting everything; a real Android vibration. Story 1.24's device pass, or before if the playtest needs sound.
- **AAC decoding on GitHub's ubuntu runner.** Playwright's Chromium and WebKit decode the `afconvert` `.m4a` files on this Mac; Linux WebKit uses GStreamer, which may lack AAC. If CI shows `audio clip … unavailable`, report the exact warning here and keep the test active for the other project (same policy as WebGL in CI, story 1.4). Not measured yet.
- **Countdown tick sound.** Needs the context running during the countdown with the game buses held silent (the epic resumes audio at the countdown's end, so today the tick is a vibration and the digit's CSS pulse).
- **Volumes and the « Vibrations » toggle** (`save.settings.volumes`, `settings.haptics`): story 2.8. The bus gains of `feedback.json` are the mix; the player's volumes will multiply them.
- **More visual and camera kinds** (`flash`, `bubble`, `zoom`) and the full twins: stories 2.4, 2.5. The in-game reduced-motion setting: story 2.10 (today the OS query only).
- **Sound waves as final art**, waves anchored on threats or props (`anchor` gains values with 1.11 / 1.15): E7 and those stories. **Partly resolved in story 1.11:** `anchor: 'threat'` (the threat an event names, for the cues a threat def points at); props stay with 1.15. Today's ring is small on screen (0.6 m in an 8 m room, ink on cream) and starts hidden under Papa's body; Geo tunes `maxRadiusM` / `durationMs` in `feedback.json` and the ring's thickness constant in `soundWaves.ts`.
- **Per-level audio manifest** (only the clips a level uses): with `LevelSchema`, story 1.10 or later. Today every clip of `feedback.json` is preloaded. *Still open after story 1.10: with story 1.11 (the first threat cues with sounds) or 1.18.* *Still open after story 1.11 (four tiny clips added, every clip is still preloaded): moved to story 1.18.*
- **Real sounds.** The three `.m4a` files are synthesized beeps (`npm run assets:audio`, macOS only); replace them under the same names (stories 2.3, 7.5). Nobody has listened to them yet: see the Completion Notes of story 1.9.


## Deferred from: code review of story 1-9-retours-de-base (2026-10-27)

- **A held Enter or Space still starts the game from the start screen.** `startScreen.ts` `onKeyDown` ignores `event.repeat`, so an auto-repeating `keydown` carried over from the previous screen (« Recommencer ») starts the game at once; only the pointer path got the D12 protection. Reason: pre-existing key path from story 1.5; D12 covers pointers only. Revisit with the next start-screen change.
- **Shake frequency is tied to `durationMs` and aliases at 60 fps** (`shake.ts`: `SHAKE_CYCLES / durationMs`, z at 1.5×; 20 Hz and 30 Hz with the table's 200 ms and 4 cycles, the z axis sits at Nyquist). Make the frequency a value in Hz in the data. Reason: no cue uses `camera` yet; story 2.5 introduces and tunes the first one.
- **Taps and the tap marker ignore the shake offset** (`hitTest.pickFloor` and the world UI work in unshaken space while the shake moves `content_root` by up to `amplitudeM`). Reason: latent until the first `camera` cue; story 2.5.
- **Looped `.m4a` clips will not loop gaplessly** on WebKit (AAC encoder delay and padding survive `decodeAudioData`). Reason: today's clips are placeholders; check the real babble and music (stories 2.3, 7.5) on a device, and reconsider the container (or trim the padding) if there is an audible gap.
- **WebKit reports `running` once at the start of the level's countdown** (seen by the e2e's mirror history, found while writing the silent-countdown proof): the unlock's `resume()` lands after `PauseRequested('levelStart')` queued the `suspend()`, so the context runs for a moment, then settles on `suspended`. Nothing plays then (the loops start with the level), so it is inaudible today; the e2e accepts it. Check on a real iPhone (with the real-device audio item above), and if a sound ever plays during loading, make `suspend()` wait for a pending `resume()`.

## Deferred from: implementation of story 1-10-premiere-menace-jugee-en-headless-la-prise-electrique (2026-10-27)

- **A press enqueued after its window expired** (a client whose time map lags by more than one step at the window's end) is lost: the threat already gagged `late`. Commands run before the expiry in a step, which covers a same-step arrival; anything later is story 1.11's input pipeline to watch (`tapLatency`), or a small expiry grace in the feel if the playtest shows it. *Watched, not changed, in story 1.11: `tapLatency` measures the visual side only; the window side needs a lagging time map to show up. Keep open for the playtest (1.24).*
- **`targeted` state and a reach gate** (P1): only if a later threat needs the baby in reach before its telegraph.
- **Several simultaneous threats and one baby**: the baby locks on the first active threat; story 1.18 decides how waves share it.
- **Gag consequences** (noise, mess, near miss, score) and the **gag presentation**: E3, 1.15, 1.16, 1.22 and 1.11. *Presentation resolved in story 1.11 (provisional: the lights dim, Papa's hair stands up); consequences stay with E3, 1.15, 1.16, 1.22.*
- **`feelOverrides` in `LevelSchema`** and the client merge (`mergeFeel` is ready): the first level that needs one, story 1.18 at the latest.
- **A threat's `window` is called `responseWindow`.** `tests/architecture/simPurity` forbids the identifier `window` in `src/sim` (any declaration, parameter or key), so the story's `ThreatInstance.window` became `responseWindow`. Keep the name; do not weaken the scanner.
- **The baby never abandons an `act`.** Story 1.10's rule 1 would send it back to `babble` as soon as a short cooldown re-arms the threat; `act` is now played out for `actMs` whatever the threat does (a cooldown shorter than `actMs` is the only way to see the difference). Confirmed in the code review of 2026-10-27: kept (the spec's rule 1 was amended).


## Deferred from: code review of story 1-10-premiere-menace-jugee-en-headless-la-prise-electrique (2026-10-27)

- **The director targets the first idle due threat in array order**, not the one with the smallest `fromMs`, and adds no gap between threats (`directorSystem.ts`; pinned by a test). Reason: story 1.18's wave director replaces this policy.
- **`cooldownMs: 0` gags and re-arms in the same step** (`threatSystem.ts`): the baby never sees the gag and Papa's glide is skipped. Reason: legal by schema but no content uses it; decide with the first threat that needs a zero cooldown.
- **Anchor checks only test existence** (`contentChecks.ts`, `createSim.ts`): a threat can be planned on `baby_spawn` / `papa_spawn`, and two entries can share an anchor. Reason: needs anchor kinds in the geometry; stories 1.16 / 1.18.
- **A degenerate `glideMaxMs` (0 or tiny) gives a wrong `arriveAt` or a huge `speedMps`** (`glide.ts`). Reason: enforce a floor in the feel schema when story 1.14 tunes the glide.
- **`threatCatalog.test.ts` hard-codes anchor `outlet_01` and a Parry release for every def.** Reason: story 1.16 (second threat) is the first to break it; derive both from the def then.
- **`loadLevelContent` does not check `levelId` against `SNAKE_ID_PATTERN`**, and a non-snake file name under `levels/` or `threats/` reports "no schema registered" instead of "id must be lower_snake_case". Reason: the level id is a code constant today.

## Deferred from: implementation of story 1-11-parer-la-prise-electrique-au-tap (2026-10-27)

- **Glide start under slow-mo or hitstop** (D2): the glide starts with the step that applies the press, so at ×1 Papa moves on the next frame that runs a step, but under the perfect slow-mo or a hitstop it can start a frame or two later. The highlight is always drawn the frame after `pointerdown`. Reason: story 1.14 decides whether the client must predict the glide.
- **Multi-touch on several threats** (D6): `Release` names no threat and ends every pending press, so only the primary pointer presses a threat. Reason: story 1.16 or 1.18, the first time two threats are active together.
- **A real lamp in the room and real gag / lift animations** (D9, D10): the room's lights are « the lamp » and the lift is a hop of the baby sphere. Reason: E7 (or a Blender pass if Geo wants the lamp sooner).
- **The halo and chevron animations run on real time**, so they keep moving behind the pause panel (like the tap marker). Reason: accessibility pass, story 2.10.
- **`?threats=off` is a test switch** (debug builds only). Remove it if story 1.13's `window.__PP__.loadLevel()` makes it redundant.
- **Placeholder sounds and ring sizes** of the four outlet cues (`tel_outlet`, `resp_parry`, `resp_parry_perfect`, `gag_outlet`) are synthesized and unheard by the dev; volumes and radii in `feedback.json` are starting values. Reason: Geo tunes them; stories 2.3 and 7.5 replace the clips under the same names.
- **A press that resolves its threat in the frame it is pressed** keeps the icon and highlight up for one more frame (the highlight must be drawn once). Reason: by design of the NFR2 budget; revisit if it reads as a flicker in the playtest.

## Deferred from: code review of story 1-11-parer-la-prise-electrique-au-tap (2026-10-27)

- **The e2e suite does not cover the gag's lights and hair, the baby lift, nor the `boot.ts` glue with the outlet live** (restart while a threat is telegraphed, pause with a finger held, error-screen exit). Reason: no debug mirror to read yet; add with story 1.13 (`window.__PP__`).
- **`threat.spec.ts` taps inside a window of a few hundred ms in real time** (CDP round trip), a possible flake on a loaded runner or in WebKit. Reason: green on the full suite now; make deterministic with story 1.13.
- **Only the primary pointer presses a threat**: a thumb resting on the screen makes every other touch non-primary. Reason: D6 / Open point 2 (`Release` names no threat); decide with the first multi-threat story (1.16 / 1.18) or on the first phone playtest.
- **The pressed threat's highlight is optimistic**: a press the sim ignores keeps the ring and chevron up while the threat stays `telegraph` / `windowOpen`. Reason: same family as the 1.10 « press enqueued after its window expired » item; watch in the playtest (1.24).
- **`tapLatency` marks are JS-side** (handler, right after `worldUi.render`): compositor and vsync presentation are not measured. Reason: AC 6 defines these marks; a trace-based check belongs to the performance pass (1.24).

## Deferred from: implementation of story 1-12-bots-et-simulation-en-masse (2026-10-27)

- **Run duration is a CLI default** (`SIM_CLI_DEFAULT_UNTIL_MS`, 3 min, D10). Story 1.18 gives the level a `durationMs`; the CLI should then default to it.
- **`meanScore` is `null`** in the report (D9). Story 1.22 fills it from Mama's score; 3.4 adds the playtest indicators.
- **Overlapping presses**: a bot's `Release` ends every pending press (the sim's rule), fine while one threat is active at a time. Stories 1.16 / 1.18 (two threats at once), with the multi-touch item of 1.11.
- **Bots know only Parry** (`BotResponse` = `'parry'`): `holdMsFor` is an exhaustive `switch`, so story 1.23 (Firmness) fails to typecheck until the bots learn it; 4.6 / 4.9 (`wait`, `nothing`) likewise.
- **The human bot's reaction floor reads `threat.enteredAt`**, the entry of the *current* state: a bot created while a window is already open measures its reaction from the window's opening, not from the telegraph. Only matters for a bot created mid-window (1.13's autoplay started late); fix with a telegraph time on `ThreatInstance` if it ever does.
- **`sim:replay` is always strict** (D13). Still open from 1.3, « Invariant strictness follows the build »: a playtest journal recorded with clamping on may diverge in `sim:replay`.
- **Still open (1.3), « `JournalSchema`, `contentVersion` / `levelId` in the journal »** (story 3.3): the recorded-game wrapper (`tools/sim/runFile.ts`, D12) carries `levelId`, `untilSimMs` and `worldHash` for the CLI only; 3.3 may absorb it.
- **`?threats=off`** (1.11): untouched, still for story 1.13.
- **`npm run ci` e2e step does not pass in the remote container this story was developed in** (134 of 140 Playwright tests never see `data-pp-app="start"`, the same on the untouched tree before the first edit; likely no WebGL in the container). Not caused by this story; to re-run on Geo's Mac.

## Deferred from: code review of story-1-12 (2026-10-27)

- **Recorder threat → def map is frozen at `createSim`** (`tools/sim/simReport.ts`): threats spawned later (stories 1.16, 1.18) fall back to `threat_<id>` and split the per-def stats silently. Rebuild the lookup from `ThreatSpawned` events when dynamic threats arrive.
- **`commandScheduler.flush` can emit a command with a `t` below one already in `out`**: harmless while only the scheduler writes `out`; revisit if a bot pushes commands directly.
- **`BotOptions` / `BotSettings` compile check is one-directional** and sits in `tests/bots/botContract.test.ts`: an extra field in the content schema is not caught.
- **Run-file wrapper has no content hashes** (D13 / story 3.3): a content change shows up only as « another state » in `sim:replay`.
- **A late human press is not capped at the end of its cycle** (`src/bots/humanBot.ts`): a very large `reactionMs` or `jitterSdMs` can land the press on the next cycle of the same threat id. `humanBot.test.ts` pins the `late` response, so a cap needs the sim to expose the cycle end.
