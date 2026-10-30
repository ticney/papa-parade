---
baseline_commit: 178e66ef5af8f205f3f11019c4b626d956e87deb
---

# Story 2.5: On-screen feel effects

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR61 (« Hitstop, tremblement d'écran et particules ; sur réponse parfaite, ralenti, zoom et rotation de caméra ») · **UX:** UX-DR15 (stamp « PARADE PARFAITE », ≤ 900 ms, never blocks input), EXPERIENCE.md › Game Feel & Juice (L408-440, the reduced-motion mapping), › Components › epic-stamp (L222), DESIGN.md › epic-stamp (L265, L518), `typography.epic` (L442: Anton 64 px / 0.95, uppercase, +0.04em), registers (L364-367, L555) · **Architecture:** L76 (« caméra dynamique (zoom au ralenti) »), **L210** (« La boucle client consomme ce gel en temps réel : aucun pas n'est exécuté et le rendu continue, avec tremblement et particules »), L250 (reduced motion: `cameraFx`, `vfx/`; shake and rotation removed, zoom capped at 50 %, particles −60 %), L253 (ADR-006), L512 (`render/cameraFx.ts`)

## Story

As a player,
I want the picture to react to my successes and to the disasters,
so that I feel every response, even with cubes.

## Acceptance Criteria

### What already works (keep it, build on it)

The hitstop and the slow-mos are sim decisions (story 1.14): `resolveThreat` (`src/sim/threats/threatFsm.ts` L161) requests `feel.timing.hitstopMs` of real-time freeze on **every success and perfect**, and a perfect also starts the `perfect` slow-mo (`world.time.slowMos`, entry `{ source, scale, startedAt, holdUntil, endsAt }`, `slowMoFactorAt` in `src/sim/time/slowMo.ts`). The client loop (`src/client/loop.ts` L211) consumes the freeze in real time and keeps rendering. The director plays a cue's parts in the call that receives the event (sound → layers → haptic → ring(s) → flash → camera → `onCue`). A `shake` already exists (`src/client/render/vfx/shake.ts`, `LevelFx.shake`, cue member `camera: { kind: 'shake', amplitudeM, durationMs }`) but **no cue uses it**, and it runs on the **sim clock**, so it would stand still during the hitstop. The flash of story 2.4 (`screenFlash.ts`, real time) is the model for a non-blocking screen overlay. This story adds the juice: shake and particles that play **during** the freeze, the perfect's camera move, the « PARADE PARFAITE » stamp and the gag's « pouf », each with a reduced-motion variant, all tuned in `feel.json`.

### Tunables: a `fx` section in `feel.json` (epics « intensités dans `feel.json` », « paramètres dans `feel.json` »)

1. **`FeelSchema` gains `fx`** (`src/content/schemas/feel.ts`, `.strictObject` everywhere, every number bounded and described, no `.default()`), so that Geo tunes every effect live in the Tweakpane panel (story 2.1 builds its folders from `FeelSchema`, nothing to add there):
   - `shakeFrequencyHz` (number, 4…30): one wobble frequency for every shake, in Hz (closes `deferred-work.md` L156: the frequency no longer depends on the duration). Starting value 14.
   - `success`, `perfect`, `gag`: three **presets**, each `{ shake: { amplitudeM (0…0.1, 0 = none), durationMs (0…400, real ms) }, particles: { style ('spark' | 'puff'), count (int 0…`PARTICLE_MAX_PER_BURST`), speedMps (0…6), lifeMs (int 50…1000, real ms), sizeM (0.01…0.3) } }`; `perfect` also has `stampMs` (int 0…`EPIC_STAMP_MAX_MS`, 0 = no stamp). Export `FX_PRESET_IDS = ['success', 'perfect', 'gag'] as const` and the `FxPresetId` type.
   - `perfectCamera`: `{ zoomPct (0…40), yawDeg (0…12), focusPct (0…60), zoomInMs (int 0…500, sim ms) }`.
   - Starting values (Geo retunes them): success shake 0.025 m / 120 ms, 10 sparks at 2.5 m/s, 350 ms, 0.05 m; perfect shake 0.05 m / 200 ms, 24 sparks at 3.5 m/s, 500 ms, 0.06 m, `stampMs` 800; gag shake 0.04 m / 250 ms, 12 puffs at 0.8 m/s, 650 ms, 0.12 m; perfect camera 18 % zoom, 6° yaw, 35 % focus, 150 ms in.
   - `content/feel.json` and **`tests/support/testFeel.json`** (the frozen copy the tests read) get the block; `npm run content:schemas` regenerates `content/_schemas/feel.schema.json` (never by hand). The schema tests (`tests/content/feelSchema.test.ts` or wherever `FeelSchema` is tested) cover a valid block and each bound refused.
   - The sim never reads `feel.fx` (client-only presentation, like `feel.input.autoTargetConeDeg`). It still lives in `world.feel`, so a `SetFeel` on it is journaled and replays like any other (story 2.1).

2. **A cue names its preset**: `CueSchema` (`src/content/schemas/feedback.ts`) **replaces** the unused `camera` member by `fx: z.enum(FX_PRESET_IDS).optional()` (« Plays the `feel.fx.<preset>` juice: shake, particles and, for `perfect`, the stamp; at the cue's ring anchor »), counted by the « at least one of » refine (update its message). Remove `ShakeSchema`; regenerate `content/_schemas/feedback.schema.json`. `feedback.json` gets `"fx": "success"` on `resp_parry` and `resp_firm`, `"fx": "perfect"` on `resp_parry_perfect` and `resp_firm_perfect`, `"fx": "gag"` on every `gag_*` cue (outlet, stairs, coffee table, papa asleep, silence mischief). Nothing else gets `fx` in this story (D2).

3. **`npm run content:check` fails** (`tools/content/contentChecks.ts`, next to `checkThreatTwins`; a failing and a passing case each in `tests/content/checkContent.test.ts`), naming the file and the JSON path, when:
   - a threat's `feedback.success` cue has no `fx` or an `fx` other than `success`; its `feedback.perfect` cue other than `perfect`; its `feedback.gag` cue other than `gag`;
   - a cue with `fx` has no `soundWave` visual (the particles start from the ring's anchor, AC 5);
   - an `events`-table cue of a **client** event has `fx` (it has no world: same rule as a world visual, `contentChecks.ts` L159-181).
   The live content and the frozen test defs pass (`tests/threats/fixtures/test_firm.json`, `tests/support/*.threat.json`: update them if a rule bites, as in 2.2-2.4).

### Successful response: shake and particles during the hitstop (epics AC 1)

4. **The shake runs on real time.** `createShake` becomes real-time: `start(amplitudeM, durationMs, frequencyHz, startAtReal)`, `update(nowReal)`; x wobbles at `frequencyHz`, z at `SHAKE_Z_RATIO` × it (keep the decay, the exact-zero return, `reset`). `LevelFx.shake` follows; `LevelScene.update` gains a `nowReal` argument (or a separate `updateRealFx(nowReal)`), called **every rendered frame, frozen or not**, and **before** `renderer.render`. Careful: in `levelSession.ts` L486-490 the frame is `level.update(sim.world, alpha)` → `renderer.render(...)` → `deps.onLevelFrame(alpha, frameAtReal)`, so anything updated in boot's `onLevelFrame` is drawn one frame late. Pass `frameAtReal` into `level.update`, and add a `beforeRender(alpha, frameAtReal)` hook (or equivalent) for the camera of AC 7. Real time comes from that `frameAtReal`, never `performance.now()` inside `render/`. Unit tests with a fake clock: offset non-zero during the 80 ms where the sim clock stands still, exactly zero at the end, a new shake replaces the running one.
   - Why real time (D1): architecture L210 asks for shake and particles *while* the loop is frozen; on the sim clock both would stand still for the whole hitstop. A pause during a ≤ 400 ms shake lets it finish: harmless.
   - Taps during a shake (`deferred-work.md` L157): accepted, not fixed. Hit-tests and the world UI work in unshaken space; the offset is ≤ `amplitudeM` (0.1 m max by schema) for ≤ 400 ms, under the 44 pt tap radius. Record it as resolved-by-bound in `deferred-work.md`.

5. **Particles: one pooled burst system, one draw call** — new `src/client/render/vfx/particles.ts` (`createParticles(parent)`): one `InstancedMesh` (a small box: « même avec des cubes ») of `PARTICLE_POOL_SIZE` instances (`src/shared/constants.ts`, 64; `PARTICLE_MAX_PER_BURST` 32, both perf limits, not feel), one shared material from `PALETTE` (no hex outside `palette.ts` / `tokens.css`), per-instance colour through `setColorAt` (allocated once). `burst(style, count, speedMps, lifeMs, sizeM, xM, zM, startAtReal)`:
   - origin: the anchor's floor point lifted by `PARTICLE_ORIGIN_LIFT_M` (an art constant in `particles.ts`, 0.25 m, like the constants of `render/gags.ts`; E7 will anchor on the real response point);
   - directions **deterministic** (golden-angle spiral over the upper hemisphere, no `Math.random`: the same burst looks the same twice, screenshots stay stable);
   - `spark`: fast, outward and up, gravity (`PARTICLE_GRAVITY_MPS2` = 9.8, physics not feel), shrinks to 0 over `lifeMs`, `paper` colour with an `ink` share for contrast; `puff`: slow outward drift, no gravity, grows to 2× then fades by shrinking, `cream` colour (the « pouf »);
   - a burst takes free slots, then the oldest ones (a new burst never loses to a stale one); `update(nowReal)` writes each live instance's matrix with **scratch** `Matrix4`/`Vector3`/`Quaternion` (zero allocation per frame), sets `mesh.count` to the live span (or scales a dead slot to 0), and flags `instanceMatrix.needsUpdate` only when something moved; `frustumCulled = false` (the instanced bounds would be stale); `reset()` hides all; `dispose()` frees geometry and material.
   - Unit tests (no WebGL needed, as `soundWaves.test.ts`): a burst of n lights n slots, a dead particle is hidden at `lifeMs`, pool overflow recycles the oldest, a second `update` with nothing alive writes nothing, the same burst gives the same positions twice, no allocation in `update` (count new objects in a loop, or assert the scratch objects are reused).

6. **The director plays the preset** after the flash and before `onCue` (order: sound → layers → haptic → ring(s) → flash → **fx** → `onCue`; update the `handle` doc comment): `FeedbackDirectorDeps` gains `getFx(): Feel['fx'] | null` (boot passes the live `levelFeel().fx`, so a Tweakpane change applies to the next cue) and `stamp?(durationMs: number, isMotionReduced: boolean): boolean`. For a cue with `fx`, with a world and a scene: shake (`amplitudeM > 0 && durationMs > 0`, **skipped under reduced motion**) at `feel.fx.shakeFrequencyHz`; particles at the ring's anchor (`anchorOf`, the same lookup as the ring; no anchor = skipped with the existing single `warn`), `count` under reduced motion = `Math.round(count × REDUCED_MOTION_PARTICLE_KEEP_PCT / 100)` (constant 40 in `constants.ts`: the « −60 % » of the UX mapping), nothing when the result is 0; for the `perfect` preset with `stampMs > 0`, `stamp(stampMs, isMotionReduced)` (with or without a world, like the flash). Each part guarded by `attempt`; the motion query asked once per cue (the existing memo). `onVisual` gains the kinds `'shake' | 'particles' | 'stamp'`, reported once per part that actually ran (not for a skipped shake, a 0-count burst or a stamp that returned `false`). Director tests: the order, each part skipped alone when it throws (one `warn`, the rest plays), reduced motion (no shake, 40 % of the particles, the stamp still plays), a cue without `fx` unchanged, the live preset read at play time (change `getFx`'s return between two cues).

### Perfect response: camera zoom and rotation during the slow-mo (epics AC 2)

7. **`src/client/render/cameraFx.ts`** (`createCameraFx(camera)`, the file the architecture names, L512): it moves the camera *around* the framing that `fitIsoCamera` computed, never instead of it.
   - `captureBase()`: boot calls it right after every `fitIsoCamera` (`fitViewToCanvas`), so a resize during a zoom keeps the right base.
   - `focusOn(xM, zM)`: boot calls it on `ResponseResolved{quality: 'perfect'}` with the resolved threat's `xM`/`zM` (read from the world in `onSimEvent`).
   - `update(world, clockMs, feel, isMotionReduced)` every rendered frame, **before** `renderer.render` (the `beforeRender` hook of AC 4, not `onLevelFrame`, which runs after the render), with `clockMs` the interpolated sim clock (`world.time.sim - STEP_MS × (1 − alpha)`, as the hold-ring uses): `blend = perfectCameraBlendAt(slowMo, clockMs, zoomInMs)` for the `perfect` entry of `world.time.slowMos` (0 when there is none). Pure exported function, unit-tested: 0 before `startedAt`, rises linearly to 1 over `zoomInMs`, 1 until `holdUntil`, then follows the slow-mo's own return (`1 − smoothstep((t − holdUntil)/(endsAt − holdUntil))`, the same curve as `slowMoFactorAt`), exactly 0 from `endsAt`. Then, from the captured base: `camera.zoom = 1 + zoomPct/100 × blend`; the view centre moves toward the focus point by `focusPct × blend` (move position and look target together, orthographic: no perspective change); the camera turns by `yawDeg × blend` around the vertical axis through the view centre. **State, not events** (like the silence bubble, story 1.21): the sim clock drives it, so the hitstop holds the zoom back until the freeze ends, a pause holds it, and the camera is back on the exact isometric framing at the end of the slow-mo (epics: « revient au cadrage isométrique à la fin du ralenti »). At `blend === 0` it restores the base **exactly** and writes nothing on later frames (no matrix churn when idle). `reset()` restores the base (level end, restart, loading: next to `resetFx`). Zero allocation per frame (scratch vectors, module-level).
   - A `lastThreat` slow-mo alone moves nothing (the epic asks it for the perfect only). Two perfects in a row: the slow-mo is extended (sim rule), the focus follows the latest perfect.
   - **Reduced motion**: no rotation (`yawDeg` treated as 0), zoom **and** focus pan at 50 % (`REDUCED_MOTION_ZOOM_CAP_PCT` = 50 in `constants.ts`).
   - Everything that projects through the camera (hit-test, world UI labels, the glyph chip, the silence bubble) uses the same moved camera, so taps stay on what is drawn. **Check** the Playwright mirrors that hold screen positions (`boot.ts` L444-526: object, baby and threat icon points): those written once per level are only valid at the base framing; an e2e that taps an object during a perfect slow-mo would miss. Re-mirror per frame only if a spec needs it; say what you found in the Completion Notes.
   - Unit tests with a real `OrthographicCamera` (pure maths, as `isoCamera.test.ts`): blend 0 leaves the base untouched bit for bit; blend 1 gives the zoom, the yaw and the pan; reduced motion; `captureBase` after a refit.

### Perfect response: the « PARADE PARFAITE » stamp (epics AC 3)

8. **`src/client/ui/hud/epicStamp.ts`** (`createEpicStamp(doc, { nowReal })`, built like `screenFlash.ts`): one `div.pp-epic-stamp` created once and appended to `#pp-hud` by boot, text `t('stamp.perfect')` (new key in `content/strings.fr.json`: « PARADE PARFAITE »), `aria-hidden="true"`, never focusable.
   - CSS in `ui.css`, tokens only: `--pp-font-epic-*` (`{typography.epic}`), uppercase, `{colors.paper}` fill and `{colors.ink}` stroke (reuse the verb-label's stroke technique, story 2.2), centred horizontally in the upper half (the bottom third stays free: `ui.spec.ts` checks it), fitted to ≤ 90 % of the width on a compact surface (never truncated), `pointer-events: none`, z-index above `.pp-screen-flash` (60) and inside `#pp-hud`, so below the pause panel (`#pp-ui`). Hidden (`opacity: 0`) when idle.
   - `show(durationMs, isMotionReduced): boolean`: cancels the running animation, then plays one Web Animations API animation of `min(durationMs, EPIC_STAMP_MAX_MS)` **real** ms (`EPIC_STAMP_MAX_MS` = 900 in `constants.ts`, the UX ceiling; the schema bound of AC 1 imports it): a stamp-in (scale from 1.35 to 1 with a slight tilt, ≤ 15 % of the time), a hold, a fade out over the last 25 %. Reduced motion: opacity only (plain fade in and out, no scale or tilt: « panneaux en simple fondu » applies to the stamp). It returns `true` (the director reports `stamp`). Real time for the same reason as the flash (2.4 D3): during the hitstop and the ×0.3 slow-mo a sim-clocked stamp would stall and last over 3 s.
   - **Never blocks input**: `pointer-events: none` (test it in the CSS text, as `screenFlash.test.ts` does), no focus, no `inert` on anything; the e2e of AC 11 taps through it.
   - Unit test (stub `animate`): duration clamped at 900, keyframes with and without reduced motion, restart cancels the previous animation, one element whatever the number of stamps.
   - **Debug mirror**: `data-pp-stamp-count` (`ppStampCount`, incremented on each shown stamp, `isMirrored` builds only), as `ppFlashCount` (2.4) for the e2e at speed 4.

### Gag: a comic effect (epics AC 4)

9. Every `gag_*` cue plays the `gag` preset (AC 2): « pouf » puffs and a shake, in the same call as its sound, alongside the provisional presentation of `render/gags.ts` (lights, hair, slide), which does not change. Under reduced motion: puffs at 40 %, no shake (the lights still carry the gag, as today).

### Reduced-motion variants, ready for story 2.10 (epics AC 5)

10. **One source of truth for « motion reduced »**: every effect of this story takes an `isMotionReduced` argument; boot computes it in one function (`prefersReducedMotion()` today: the OS query, as the director and the gags already do). Story 2.10 replaces that function's body with `save.settings.reducedMotion || OS query` and nothing else. The mapping implemented here (EXPERIENCE.md L427-439): shake and camera rotation removed; zoom and focus pan capped at 50 %; particles at 40 %; stamp as a plain fade; hitstop and slow-mo unchanged (sim). Write the list, with the constant or function of each, in the Completion Notes: it is 2.10's checklist.
    - **`window.__PP__.fx()`** (debug only, in `src/debug/testApi.ts` through a new `TestHost.fxState()`): `{ cameraZoom, cameraYawDeg, shakeOffsetM, particlesAlive, stampCount }`, read at call time (no per-frame mirror). Story 2.10's `reducedMotion.spec.ts` reads it (« aucune rotation de caméra ni aucun tremblement n'est observé via `window.__PP__` »). Unit-test the testApi part with `tests/support/fakeTestHost.ts`; `testApi.spec.ts` lists the new method. Add `fx` to the debug markers of `tools/build/inspectDist.ts` only if the string cannot appear in the prod bundle (it is a common word: pick a distinctive marker or skip it, and say which).

### Performance (epics AC 6)

11. **`perf.spec.ts` stays within budget** (bot `human`, a whole level at speed 1, with every effect): p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles. Particles add **one** draw call while any is alive (64 boxes = 768 triangles); the stamp and the camera add none. No allocation per frame in `particles.update`, `shake.update`, `cameraFx.update` (scratch objects; the review will grep for `new ` in those functions). Report the measured p95, draw calls max and triangles max in the Completion Notes, next to 2.4's (16.7 ms, 40, 1466).
12. **`tests/e2e/juice.spec.ts`** (Chromium and WebKit, the default projects), driven like `mute.spec.ts` and `timeEffects.spec.ts` (no fixed sleep, bounds from the live plan):
    - `?autoplay=perfect&seed=<n>&speed=4`: wait for the first `resp_parry_perfect` in `__PP__.cueLog()`; its record's `visuals` contain `particles`, `shake` and `stamp` (Playwright's default `reducedMotion` is `no-preference`); a `resp_parry` (success) record has `particles` and `shake` and no `stamp`; `data-pp-stamp-count` ≥ 1; `.pp-epic-stamp` has `pointer-events: none`.
    - Camera, deterministic: `__PP__.freeze(true)`, step with `__PP__.advance(n)` from the perfect's step; `__PP__.fx().cameraZoom` > 1 and `cameraYawDeg` ≠ 0 inside the slow-mo's hold, then exactly `1` and `0` once `world.time.slowMos` has no `perfect` entry (compute `n` from the live `feel.timing.slowMoPerfect`, never typed in the spec).
    - The stamp never blocks: the stamp runs on real time, so freezing the game does not keep it up. Right after `data-pp-stamp-count` increments, tap the stamp's centre through `page.mouse`; the tap reaches the game (a `TapFloor`/`PapaPathPlanned` or `PressThreat` in `__PP__.events()`). `document.elementFromPoint` at that centre is the canvas or a world element, never `.pp-epic-stamp`.
    - Reduced motion: a second test with `page.emulateMedia({ reducedMotion: 'reduce' })` before the load: no `shake` in any record, `cameraYawDeg` stays 0, `cameraZoom` ≤ 1 + `zoomPct`/200 during the hold, the perfect still has `particles` and `stamp`.
    - Gag: `?autoplay=idle`: the first `GagTriggered`'s `gag_*` record has `particles` and `shake`.
    - `collectProblems(page)` stays empty.

### Hygiene

13. **No sim behaviour change.** No sim file changes except through `FeelSchema` (the sim never reads `fx`). The new keys of `testFeel.json` move the goldens' `feelHash` and `worldHash` (`world.feel` is hashed): regenerate with `npm run golden:update`, **deliberately**, and check the diff of `tests/golden/journals/` holds **only hash lines** (no event moves). Say so in the Completion Notes with the files that moved. `npm run sim` results (judgements, scores) do not move.
14. **Screenshots**: `autoplay.spec.ts` freezes its frames; if the stamp, a shake or the camera move appears in a darwin reference, look at it, say so and regenerate only that one deliberately (`--update-snapshots`, macOS only).
15. **Specs that pin shared contracts** (run each on Chromium while developing): `mute.spec.ts` (its kind checks use `toContain`, so new kinds are fine: verify), `ui.spec.ts` (HUD node budget and free bottom third: skip `.pp-epic-stamp` like `.pp-screen-flash` if it counts it), `testApi.spec.ts` (method list), `timeEffects.spec.ts` (slow-mo), `feedback.spec.ts`, `debugOverlay.spec.ts` (the new feel folder).
16. **`deferred-work.md`** gets a dated 2.5 section: L147/L524/L528 (zoom, stamp, shake, particles: done), L156 (shake frequency now `feel.fx.shakeFrequencyHz`), L157 (taps vs shake: accepted by bound, AC 4), L246 (camera under slow-mo: done; music is 2.6), L261 (prop sounds and a `prop` ring anchor: **not done**, D5), plus the new open points. `project-context.md` › Feedback gains one line (AC 17).
17. `project-context.md` › « Feedback, rendering, UI »: « A cue may name an `fx` preset (`feel.fx.success|perfect|gag`: real-time shake and pooled particles, the perfect's stamp; `content:check` pins them on threat cues). The perfect's camera move is `render/cameraFx.ts`, driven per frame by the `perfect` slow-mo (sim clock). Every effect takes `isMotionReduced` from one boot function (story 2.10 plugs the setting there). »
18. **`(unset VITE_DEBUG_ALLOWED; npm run ci)` is green** once, before the review (`env | grep VITE_` first), `dist:check` for both flavours, `e2e:dist` with `perf.spec.ts` within budget.

## Tasks / Subtasks

- [x] **T1. Feel schema** (AC 1): `fx` in `FeelSchema`, `FX_PRESET_IDS`; constants `PARTICLE_POOL_SIZE`, `PARTICLE_MAX_PER_BURST`, `EPIC_STAMP_MAX_MS`, `REDUCED_MOTION_PARTICLE_KEEP_PCT`, `REDUCED_MOTION_ZOOM_CAP_PCT` in `src/shared/constants.ts`; `content/feel.json` + `tests/support/testFeel.json`; `npm run content:schemas`; schema tests.
- [x] **T2. Cue schema and content** (AC 2): `fx` replaces `camera` (remove `ShakeSchema`; fix every reference: director, its tests, `contentChecks.ts`, `feedbackSchema.test.ts`, fixtures); `feedback.json`; regenerate schemas.
- [x] **T3. Content checks** (AC 3) + tests.
- [x] **T4. Real-time shake** (AC 4): `shake.ts` on real time with `frequencyHz`; `LevelFx.shake` / `updateRealFx`; frames rendered during the freeze call it; tests.
- [x] **T5. Particles** (AC 5): `vfx/particles.ts` + test; wired in `levelScene.ts` (`LevelFx.particles`, `resetFx`, `dispose`).
- [x] **T6. Director** (AC 6): `fx` part, `getFx`, `stamp`, new `onVisual` kinds; tests (`feedbackDirector.test.ts`, `feedbackTwins.test.ts` still green: a perfect now also reports `particles`/`stamp`).
- [x] **T7. Camera** (AC 7): `render/cameraFx.ts` + test; boot: `captureBase` in `fitViewToCanvas`, `focusOn` on the perfect, `update` per frame, `reset` with `resetFx`.
- [x] **T8. Stamp** (AC 8): `ui/hud/epicStamp.ts` + test, CSS, string key, `ppStampCount` mirror, boot wiring.
- [x] **T9. Reduced motion and test API** (AC 10): one `isMotionReduced` source in boot; `TestHost.fxState`, `__PP__.fx()`, `fakeTestHost`, `testApi.test.ts`, `tests/e2e/support/testApi.ts` helper.
- [x] **T10. e2e** (AC 12, 15): `tests/e2e/juice.spec.ts`; run the touched specs on Chromium.
- [x] **T11. Goldens** (AC 13): `npm run golden:update`; journals diff = hashes only.
- [x] **T12. Docs** (AC 16, 17): `deferred-work.md`, `project-context.md`.
- [x] **T13. CI** (AC 11, 14, 18): `npm run ci:fast` after each task; the full `(unset VITE_DEBUG_ALLOWED; npm run ci)` once at the end; report the perf numbers. On a loaded machine rerun with `--maxWorkers=5` / `--workers=4` and say so.

### Review Findings

Code review of 2026-10-30 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; golden journals and generated schemas left out of the diff). No acceptance criterion is clearly unmet.

- [x] [Review][Decision→Patch, Geo 2026-10-30: ease the refocus] A second perfect during a running perfect slow-mo snaps the camera pan — `focusOn` replaces the focus point at once and `k = focusPct × blend` has no easing, so on back-to-back perfects the view jumps by `focusPct` of the distance between the two threats in one frame. Decided: ease the focus toward the new point over a new `feel.fx.perfectCamera.refocusMs` (schema, `content/feel.json`, `testFeel.json`, `feelSample.json`, generated schema, golden hashes). — see the Patch below
- [x] [Review][Patch] Ease the camera focus toward a new perfect's point over `feel.fx.perfectCamera.refocusMs` (int, real or sim ms to decide in the schema doc, 0 = cut), so back-to-back perfects do not snap the pan; unit test with two perfects and a mid-way frame. [`src/client/render/cameraFx.ts`:106-120, `src/content/schemas/feel.ts`, `content/feel.json`]
- [x] [Review][Defer] Art constants hard-coded (stamp scale-in share, fade-out start, tilt and entry scale, `FOCUS_HEIGHT_M`, `PARTICLE_ORIGIN_LIFT_M`, `PUFF_*`, `INK_EVERY`, `SHAKE_Z_RATIO`, the stamp's `top: 22%`, `z-index: 61`) — deferred by Geo (2026-10-30): provisional art constants, moved into `feel.fx` if retouched after playing [`src/client/ui/hud/epicStamp.ts`:11-17, `cameraFx.ts`:8, `vfx/particles.ts`, `ui.css`]
- [x] [Review][Dismissed] The unit-suffix guard accepts bare `count` and exact `Hz` / `amplitudeM` / `sizeM` — Geo keeps the exceptions (one exact, commented key each; names imposed by the spec)
- [x] [Review][Dismissed] AC 11 perf numbers do not cover a frame with live particles or a camera move — Geo accepts: the delta (+1 draw call, +768 triangles) is known by construction and far inside the budgets
- [x] [Review][Patch] The camera is displaced again after the level-end reset and stays that way behind the Result screen — `LevelScored` → `finish()` → `stopLoop()` → `cameraFx.reset()` runs inside a loop step; `loop.stop()` does not abort the frame, so `render` runs once more, `beforeRender` → `cameraFx.update` sees the `perfect` slow-mo still in `world.time.slowMos` (the sim never clears it) and re-applies zoom, pan and yaw after the reset. Skip `beforeRender` when the loop is gone (`loop === null`), with a levelSession test. [`src/client/app/levelSession.ts`:501, `src/client/render/cameraFx.ts`:151-154]
- [x] [Review][Patch] A stale focus point survives `reset()` and a new level — `isFocused`/`focus` are never cleared, so a perfect whose threat is not found in `world.threats` (no `focusOn`) pans toward the previous level's coordinates. Clear `isFocused` in `reset()` (and test it on a used instance, not a fresh one). [`src/client/render/cameraFx.ts`:104-110, 151-154]
- [x] [Review][Patch] The stamp is not cancelled with the other effects — `onFxReset` ends shake, particles and camera but `EpicStamp` has no `cancel`, so « PARADE PARFAITE » can finish its animation over the Result, loading or start screens. Add `cancel()` and call it from `onFxReset` in `boot.ts` (reset also hides it under a quit/restart). [`src/client/ui/hud/epicStamp.ts`, `src/client/boot.ts`:694]
- [x] [Review][Patch] The stamp's `easing: 'ease-out'` warps the whole iteration, so the keyframe offsets 0.15 / 0.75 are not at 15 % / 75 % of the time (the fade out starts at about half of it, the hold is shorter) — contradicts the documented « fade out over the last quarter ». Put the easing on the keyframes (or use `linear` overall) and pin it in the unit test. [`src/client/ui/hud/epicStamp.ts`:~65]
- [x] [Review][Patch] Live retuning of `perfectCamera` is ignored while the move is held — the early return `!isDirty && blend === appliedBlend && …` ignores `zoomPct`, `yawDeg` and `focusPct`; during the hold (blend 1) a change in the Tweakpane panel applies only at the next blend change. Include the three values in the applied key. [`src/client/render/cameraFx.ts`:~87]
- [x] [Review][Patch] The `levelSession` test « moves the camera before the draw » does not record the draw, so moving `beforeRender` after `renderer.render` would still pass. Record the render call in `calls` and assert `update` → `beforeRender` → `render` → `onLevelFrame`. [`src/client/app/levelSession.test.ts`:~267-298]
- [x] [Review][Patch] Weak or tautological tests — `cameraFx.test.ts` « keeps the right base after a refit » compares the camera to a snapshot of itself, « reads its tuning » asserts `zoomPct >= 0` (the schema guarantees it) on the test feel, and `camera.position.x += 0` does nothing; the « allocates nothing » tests grep the source for `new `; `shake.test.ts` « wobbles at the asked frequency » accepts 12-16 Hz for 14 Hz; `epicStamp.test.ts` titles a test « below the panels » but only checks `z-index` > the flash; `feedbackSchema.test.ts` « refuses the removed camera member » does not check the cause. Tighten them (real baseline compare, exact crossing count, assert on the removed key). [`src/client/render/cameraFx.test.ts`, `vfx/shake.test.ts`, `vfx/particles.test.ts`, `ui/hud/epicStamp.test.ts`, `tests/content/feedbackSchema.test.ts`]
- [x] [Review][Patch] The stamp tap-through e2e is weaker than AC 12 and its stated reason is wrong — it checks `elementFromPoint` and the `pointerdown` target but never that the game received the tap (`TapFloor` / `PapaPathPlanned` / `PressThreat` in `__PP__.events()`); the notes say « autoplay blocks game input », which does not apply to this manual `perfectParry` test. Tap at the stamp's centre with `page.mouse` and assert on the events. [`tests/e2e/juice.spec.ts`:164-197]
- [x] [Review][Patch] The stamp is not excluded from the HUD box measure of `ui.spec.ts` (AC 15 says to skip `.pp-epic-stamp` like `.pp-screen-flash`): it is a child of `#pp-hud` and counts toward `nodes` against `HUD_MAX_DOM_NODES` (40). Filter it there. [`tests/e2e/ui.spec.ts`:441]
- [x] [Review][Defer] Shake and particles start from `performance.now()` and are advanced with the rAF timestamp — the effect is skipped for its first frame (negative elapsed) — deferred, already listed in `deferred-work.md` (story 2.5) as a one-frame gap [`src/client/boot.ts`:343]
- [x] [Review][Defer] Real-time effects (shake, particles, stamp) keep running during a pause while the camera and rings hold — deferred, by the real-time design of AC 4; Geo judges after playing [`src/client/app/levelSession.ts`:499]
- [x] [Review][Defer] The camera blend clock (`sim − STEP_MS × (1 − alpha)`) runs 10 ms behind the rings and gags (`sim + alpha × STEP_MS`) — deferred, pre-existing: `updateThreats` in `boot.ts` uses the same formula [`src/client/boot.ts`:689]
- [x] [Review][Defer] A smaller shake replaces a larger one still under way (no max-merge) — deferred, documented as « replaces » in the shake contract [`src/client/render/vfx/shake.ts`:23-30]

## Dev Notes

### Decisions (D1-D6)

- **D1. Shake, particles and stamp run on real time; the camera move on sim time.** Architecture L210 wants shake and particles *during* the freeze, when the sim clock stands still: on the sim clock they would hold still for 80 ms, then crawl at ×0.3 through the perfect's slow-mo. The stamp is a screen overlay like the flash (2.4 D3). The camera zoom, on the contrary, *is* the slow-mo made visible: it follows `world.time.slowMos` on the sim clock, so it waits out the hitstop, pauses with the game, and lands on the iso framing exactly when the slow-mo ends (the epic's words). The rings (2.4) stay on sim time.
- **D2. Intensities in `feel.json`, routing in `feedback.json`.** The epic puts the intensities in `feel.json`, and that is where Geo can tune them live (the Tweakpane panel is generated from `FeelSchema`; `feedback.json` has no live panel). ADR-006 keeps `feedback.json` as the one place where an event meets its effects, so a cue *names* its preset (`"fx": "perfect"`) and `content:check` pins which threat cue names which. Three presets, not one per cue: the juice of a success is the same whatever the threat, and three folders are what Geo can tune in one sitting. Removing the unused `camera` member avoids two ways to shake.
- **D3. The camera moves around the fitted framing, never replaces it.** `fitIsoCamera` stays the only author of the iso framing; `cameraFx` captures it and applies zoom (orthographic `zoom`), pan and yaw on top, and restores it bit for bit at blend 0. Hit-tests and world UI read the same camera, so what you tap is what you see, even mid-zoom.
- **D4. One draw call for every particle.** An `InstancedMesh` pool of 64 boxes, deterministic directions, no allocation per frame, `frustumCulled = false`. Points sprites would need a texture or a shader for the toon look; boxes match the greybox (« même avec des cubes ») and E7 can swap the geometry.
- **D5. What 2.5 does not do** (record each in `deferred-work.md`):
  - *Prop impact and break sounds, and a `prop` ring anchor* (L261, moved here by 2.3): not an AC of this story, needs clips and a schema anchor kind; it belongs with the sound library (story 7.5) or a correct-course. Particles on `PropBroken` would be cheap with the pool: Geo decides after playing (Open points).
  - *The in-game reduced-motion setting and « Grands verbes »*: story 2.10 (this story makes every effect take `isMotionReduced`).
  - *Music under slow-mo*: story 2.6. *Instinct vignette*: story 2.9. *The REPLAY banner* (same `epic-stamp` component): story 3.9; keep `epicStamp.ts` generic enough to show another string later (a `text` option), without building it.
  - *Final art and animation of the effects*: story 7.3.
- **D6. Reduced-motion constants are code, feel values are data.** `REDUCED_MOTION_PARTICLE_KEEP_PCT` (40), `REDUCED_MOTION_ZOOM_CAP_PCT` (50) and `EPIC_STAMP_MAX_MS` (900) are accessibility and UX ceilings (EXPERIENCE.md, DESIGN.md), not tunables: `src/shared/constants.ts`, like `SCREEN_FLASH_MIN_INTERVAL_MS` (2.4 D4). Everything else is `feel.fx`.

### Current state of the files this story changes (read before editing)

- **`src/client/render/vfx/shake.ts`**: `createShake(target)` moves `content_root` (never the camera, so the framing and world UI stay put); `start(amplitudeM, durationMs, startAt)` on sim ms; 4 cycles over the duration on x, ×1.5 on z (the aliasing of deferred L156); `update(clockMs)`, `reset()`. Keep the decay shape, the exact-zero end and the « not started yet → zero » branch.
- **`src/client/render/levelScene.ts`** (355 lines): `LevelFx` (`soundWave`, `shake`, `gag`, `liftBaby`), all sim-clocked; `update(world, alpha)` runs the effects on the interpolated sim clock; `resetFx()` ends effects when the loop stops; `dispose()`. The content root is `content_root` (L233). Add the particles and the real-time update without moving the sim-clocked effects.
- **`src/client/feedback/feedbackDirector.ts`** (≈250 lines): `play()` with `attempt` per part, `anchorOf` (warns once per skipped ring), the motion memo `isMotionReducedNow`, `reportVisual`, the `camera` part at the end (to be replaced by the `fx` part). Keep `hasOwn` lookups, the order, the guards.
- **`src/content/schemas/feedback.ts`**: `ShakeSchema` L133-139 and `camera` L184-187 (to remove), the « at least one of » refine L190-197, `FlashSchema` bound by `SCREEN_FLASH_MIN_INTERVAL_MS` (the model for importing a constant into a schema).
- **`src/content/schemas/feel.ts`**: sections `timing`, `input`, `movement`, `baby`, `fatigue`, `noise`, `instinct`, `difficulty`, `mama`, `physics`, `gags`; `FeelSchema` at L463. `feel.timing.slowMoPerfect` = `{ timeScale 0.3, durationMs 1200, returnMs 300 }`, `hitstopMs` 80.
- **`content/feedback.json`**: 25 cues, none with `camera`; the success, perfect and gag cues listed in AC 2 all have a `threat`-anchored `soundWave`. Preserve every id.
- **`src/client/boot.ts`** (1327 lines): `camera = createIsoCamera()` L180, `fitViewToCanvas` L200-205 (where `captureBase` goes), `screenFlash` created and appended to `hudRoot` L307-308 (the stamp goes next to it), director deps L315-330 (`prefersReducedMotion` L315), `levelSession` with `onLevelFrame(alpha, frameAtReal)` L668 (per-frame work: the silence bubble is the « state, not events » model), `onSimEvent` L803 (`playSimEventFeedback`, the gag presentation with `isMotionReduced`: where `focusOn` goes), the test host near L1170-1260.
- **`src/client/loop.ts`**: L211-236, the freeze is consumed in real time and rendering continues; confirm the render callback runs on frozen frames.
- **`src/client/app/levelSession.ts`**: the per-frame `render` closure L486-490 (`level.update` → `renderer.render` → `onLevelFrame`): the real-time effects and the camera must update before the render call (AC 4, AC 7).
- **`src/client/ui/hud/screenFlash.ts`** (+ test): the template for `epicStamp.ts` (injected `nowReal`, WAAPI, stubbed `animate` in the test, CSS checked as text).
- **`src/client/ui/styles/ui.css`**: layers comment L242 (canvas < `#pp-world` 5 < `#pp-hud` 10 < `#pp-ui`), `.pp-screen-flash` L263 (z-index 60). `designTokens.test.ts` refuses colours and blurred shadows outside tokens.
- **`src/debug/testApi.ts`**: `cueLog()` (2.4) is the model for `fx()`.

### Must not change

- Sim behaviour, events, judgements, bots, `npm run sim` results; only goldens' hash lines move (AC 13).
- The hitstop and slow-mo values and their sim ownership: reduced motion never touches them (UX, architecture L250).
- Every cue id, the 2.4 twin rules (telegraph `light`, perfect `heavy` + `flash`, success no flash, gag `heavy`), the flash and its 3 Hz rule, the ring pool behaviour.
- The provisional gag presentation (`render/gags.ts`) and its reduced-motion behaviour.
- The CSP (everything is same-origin DOM, CSS and WebGL; Anton is already self-hosted in `public/fonts/`).

### Architecture compliance

- Layers: schemas in `src/content` (zod only, may import `@shared/constants`); director, camera, particles, stamp in `src/client`; `fx()` in `src/debug` through `TestHost`; checks in `tools/`. Aliases across layers only.
- ADR-006: `feedback.json` routes events to presets; no cue id or preset routing hard-coded in TS outside tests and `tools/`.
- `render/` never reads `performance.now()`: real time is passed in from boot's frame time.
- No `console.*`: `log.warn('feedback' | 'render' | 'ui', …)`; every fallback logs once.
- Naming: `create<Name>` in a file named after it (`createParticles` in `particles.ts`, `createCameraFx` in `cameraFx.ts`, `createEpicStamp` in `epicStamp.ts`); units as suffixes (`amplitudeM`, `speedMps`, `lifeMs`, `sizeM`, `zoomPct`, `yawDeg`, `focusPct`, `zoomInMs`, `shakeFrequencyHz`, `startAtReal`); constants `UPPER_SNAKE` in `shared/constants.ts`.

### Library and framework notes

- No new dependency. `three@0.186.1`: `InstancedMesh(geometry, material, count)`, `setMatrixAt`, `setColorAt` (creates `instanceColor` on first call: call it at construction), `instanceMatrix.needsUpdate`, `mesh.count` to draw fewer instances; set `frustumCulled = false` (bounds computed once would cull moving particles). `OrthographicCamera.zoom` + `updateProjectionMatrix()` for the zoom.
- Web Animations API as in 2.4 (Chromium, WebKit ≥ 13.1; stub in unit tests).
- Zod 4: `z.enum(FX_PRESET_IDS)`, `z.int().min().max()`; JSON Schemas through `npm run content:schemas`.
- Playwright `page.emulateMedia({ reducedMotion: 'reduce' })` sets `prefers-reduced-motion` for the page (both engines).

### File structure

New:
- `src/client/render/vfx/particles.ts`, `particles.test.ts`
- `src/client/render/cameraFx.ts`, `cameraFx.test.ts`
- `src/client/ui/hud/epicStamp.ts`, `epicStamp.test.ts`
- `tests/e2e/juice.spec.ts`

Changed:
- `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`, `content/_schemas/feel.schema.json` and `feedback.schema.json` (generated), `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `tests/support/testFeel.json`
- `src/shared/constants.ts`
- `src/client/render/vfx/shake.ts` (+ test), `src/client/render/levelScene.ts` (+ test), `src/client/feedback/feedbackDirector.ts` (+ test, `feedbackTwins.test.ts` if needed), `src/client/boot.ts`, `src/client/app/levelSession.ts` (if frozen frames skip `onLevelFrame`), `src/client/app/testHost.ts`, `src/client/ui/styles/ui.css`
- `src/debug/testApi.ts` (+ test), `tests/support/fakeTestHost.ts`, `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`, `tests/e2e/ui.spec.ts` (if needed)
- `tools/content/contentChecks.ts`, `tests/content/checkContent.test.ts`, `tests/content/feedbackSchema.test.ts`, the feel schema test, `tools/build/inspectDist.ts` (if a marker is added)
- `tests/golden/journals/*` (hashes only, via `golden:update`)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`

### Testing

- Vitest next to the code; `describe/it/expect` from `vitest`. Tests read `testFeel.json` (via `tests/support/testContent.ts`), never the live `feel.json`.
- Fakes: the recording scene/audio/haptics of `feedbackDirector.test.ts`; extend the fake scene with `particles` and the real-time `shake`; `fakeTestHost.ts` for the test API.
- e2e: `juice.spec.ts` plus the specs of AC 15, on Chromium while developing (`npx playwright test <files> --project=chromium`, with `VITE_DEBUG_ALLOWED` unset); the full suite once through `npm run ci`.
- At speed 4 a 800 ms stamp lasts 800 ms real but the bot plays fast: rely on the cue log and the `ppStampCount` mirror, not on polling the element (2.4's lesson with the flash).
- The harness fails a session on any `warn` of the director: a particle burst with no anchor would show there.

### Previous story intelligence (1.9, 1.14, 2.2, 2.3, 2.4)

- **1.9**: the director never throws into the frame loop; every part in `attempt`. Shake/zoom were promised « in story 2.5 » since 1.9 (`deferred-work.md` L147, L156-157).
- **1.14**: hitstop on every success and perfect; the perfect slow-mo ×0.3 for 1200 sim ms + 300 ms return (≈ 4 s real); CSS animations stay real-time under slow-mo (L253 of deferred); « camera and music under slow-mo: start on `ResponseResolved{perfect}`, end when `timeScale` returns to its base » (D10) — this story derives it from the `perfect` slow-mo entry instead of `timeScale`, so a `lastThreat` slow-mo does not zoom.
- **2.2**: rules the schema cannot see go to `contentChecks.ts` with a failing and a passing test; verbs use a paper fill with an ink stroke (reuse it for the stamp).
- **2.3**: AC-by-AC Completion Notes saying what was really verified and what could not be (the agent cannot judge how an effect *feels*: say so).
- **2.4**: the screen-overlay module pattern (`screenFlash.ts`), real time for screen effects, the `onVisual`/`cueLog` record (extend it, do not mirror `data-pp-cue`), a `data-pp-*-count` mirror because polling misses short effects at speed 4, `ui.spec.ts` had to skip the full-screen overlay in its HUD node count, `designTokens.test.ts` refuses blurred `box-shadow`. Review findings to avoid repeating: bound every new number in the schema, guard per sub-part (a throwing pulse hid the others), query reduced motion once per cue, iterate listener copies, keep comment lines ≤ 100 columns.

### Git intelligence

Recent commits on `main`: « Story 2.4 : équivalents visuels et haptiques complets » (`e132b2b`), its review fixes (`5dbcd79`), « Story 2.4 : boucle de CI rapide (ci:fast) et consignes sur le CI complet » (`2c52d53`: use `npm run ci:fast` after each task, the full CI once before the review), « gdd update » (`c77414f`), merge `474f27b`. Commit style: French, « Story 2.5 : <titre> », then « Story 2.5 : corrections de la revue de code ». Work on `story/2-5-effets-de-feeling-a-l-ecran` in its worktree (`.claude/worktrees/2-5-effets-de-feeling-a-l-ecran`); never commit on `main`.

### Project context rules (from `_bmad-output/project-context.md` and CLAUDE.md)

- Anything Geo might tweak is data: every intensity, size, speed, duration and camera value is in `feel.fx`. Accessibility ceilings are constants.
- Reduced motion is client-only and never changes sim timing; goldens give the same results with or without it.
- Zero allocation in hot paths (rAF loop, view `update`): scratch vectors, pools; ≤ 100 draw calls, ≤ 100k triangles.
- UI is vanilla DOM + CSS with `pp-` classes and tokens only; strings through `t(key)`; Anton only in the Epic register, in short bursts.
- `create<Name>` factories, files `camelCase.ts`, units as suffixes, no `enum`, `log` not `console`, `Result` for I/O.
- Check `env | grep VITE_` before `dev`/`e2e`/`ci`; run them as `(unset VITE_DEBUG_ALLOWED; …)`.

### Open points for Geo (tune or decide after playing)

1. **Every starting value of `feel.fx`** is a guess: tune them in the debug overlay's feel panel (folder `fx`), then « Enregistrer ».
2. **The perfect's camera**: 18 % zoom, 6° yaw and 35 % pan toward the action over ≈ 4 s of real slow-mo. Too much on a small phone? Does the yaw show the back of a wall?
3. **The stamp**: 800 ms, upper half of the screen. Does it hide the threat you just parried, or the next telegraph?
4. **Particles on a falling or broken prop** (`PropBroken`), a « pouf » when the baby is found in a silence: cheap with the pool, not asked by the epic. Want them?

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] (ACs), [#Story 2.10] (reduced-motion mapping and `reducedMotion.spec.ts`), [#Story 3.9] (REPLAY banner); FR61 (L125), UX-DR15 (L244), UX-DR18 (L250)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L76, L210, L250, L253, L512
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L134 (registers), L161 (« PARADE PARFAITE »), L222 (epic-stamp), L408-440 (Game Feel & Juice, Reduced motion), L540 (the perfect in the muted journey)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L265, L364-367, L442, L455, L518, L555
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L147, L156, L157, L246, L261, L524, L528
- [Source: _bmad-output/implementation-artifacts/2-4-equivalents-visuels-et-haptiques-complets.md] D1, D3, D4, D6, Review Findings
- [Source: _bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md] D10
- [Source: _bmad-output/project-context.md] › Time & input judgement, › Feedback, rendering, UI, › Performance Rules

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5

### Debug Log References

- `(unset VITE_DEBUG_ALLOWED; npm run ci)`: green, once, at the end (typecheck, lint, content:check, coverage, e2e, playtest build + dist:check + e2e:dist, prod build + dist:check).
- The shell guard refused compound commands and heredocs naming git: patches were applied through scripts in the scratchpad.

### Completion Notes List

- **AC 1-3 (feel.fx, cue `fx`, content:check):** `FeelSchema.fx` (bounded, described, no defaults) with the starting values of the story, in `content/feel.json` and `tests/support/testFeel.json`; schemas regenerated. `CueSchema.camera`/`ShakeSchema` replaced by `fx`; `feedback.json` routes `success`/`perfect`/`gag`. `content:check` pins the preset of each threat cue, a `soundWave` on any cue with `fx`, and no `fx` on a client-event cue (failing + passing tests).
- **AC 4 (real-time shake):** `createShake(start(amp, ms, Hz, startAtReal), update(nowReal))`; `LevelScene.update(world, alpha, nowReal)` runs it every rendered frame; `levelSession` passes `frameAtReal` and calls a new `beforeRender` hook before the draw (`onLevelFrame` still runs after). Tap vs shake: accepted by bound (recorded in `deferred-work.md`).
- **AC 5 (particles):** one `InstancedMesh` of 64 boxes, deterministic golden-angle directions, scratch objects, no allocation in `update` (a test greps the source). **AC 6 (director):** order sound, layers, haptic, ring, flash, fx (shake, particles, stamp), `onCue`; `getFx`/`nowReal`/`stamp` deps; `onVisual` kinds `shake|particles|stamp`.
- **AC 7 (camera):** `render/cameraFx.ts` moves the camera around the fitted framing from the `perfect` slow-mo (`perfectCameraBlendAt` is pure and tested); restores the base bit for bit and writes nothing idle. `captureBase` after each `fitIsoCamera`, `focusOn` on a perfect, `reset` through a new `onFxReset` hook of the session. Mirrors check: `data-pp-*-px` mirrors are valid at the base framing only; no spec taps an icon during a slow-mo (recorded in `deferred-work.md`).
- **AC 8 (stamp):** `epicStamp.ts` (WAAPI, real ms, clamped at 900, plain fade under reduced motion), CSS in `ui.css` (z-index 61, `pointer-events: none`), `data-pp-stamp-count` mirror. **Deviation:** the text uses the existing key `stamp.perfect_parry` instead of a new `stamp.perfect`.
- **AC 9-10 (gag, reduced motion, `fx()`):** gag cues play the `gag` preset. `window.__PP__.fx()` through `TestHost.fxState()`. No `fx` marker added to `inspectDist` (too common a word). **Reduced-motion checklist for story 2.10** (all fed by `prefersReducedMotion()` in `boot.ts`, the only function to change): shake removed (director); camera rotation removed and zoom/pan at `REDUCED_MOTION_ZOOM_CAP_PCT` = 50 % (`cameraFx.update`); particles at `REDUCED_MOTION_PARTICLE_KEEP_PCT` = 40 % (director); stamp is a plain fade (`epicStamp.show`); hitstop and slow-mo untouched (sim).
- **AC 11 (perf), `perf.spec.ts` via `e2e:dist`:** p95 frame 16.7 ms, draw calls max 40, triangles max 1466 (same as 2.4; the sampled maxima did not catch a frame with live particles, which add one draw call and 768 triangles at most).
- **AC 12 (e2e):** `tests/e2e/juice.spec.ts` (7 tests, Chromium green, WebKit run in the full CI): perfect (particles, shake, stamp), success (no stamp), gag, camera zoom/yaw in the hold and exactly back after, stamp tap-through, reduced motion. The tap-through test also checks, after the review, that the game got the tap (a `PapaPathPlanned` after one step of the frozen level).
- **AC 13-14 (goldens, screenshots):** `golden:update` moved only `worldHash`/`feelHash` lines (checked on the diff of `tests/golden/journals/*`; `mama_woke.expected.json` reformatted by Biome back to one line); sim results unmoved. No darwin screenshot reference needed regenerating (`autoplay.spec.ts` green).
- **Not verifiable by an agent:** how any of it *feels* (intensities, the camera on a small phone, whether the stamp hides the next telegraph): the Open points of the story are Geo's to tune in the `fx` folder of the panel.

### File List

New: `src/client/render/cameraFx.ts` (+ test), `src/client/render/vfx/particles.ts` (+ test), `src/client/ui/hud/epicStamp.ts` (+ test), `tests/e2e/juice.spec.ts`.

Modified: `content/feel.json`, `content/feedback.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`, `src/shared/constants.ts`, `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`, `tools/content/contentChecks.ts`, `src/client/render/vfx/shake.ts` (+ test), `src/client/render/levelScene.ts` (+ test), `src/client/feedback/feedbackDirector.ts` (+ test, `feedbackTwins.test.ts`, `simEventFeedback.test.ts`), `src/client/app/levelSession.ts` (+ test), `src/client/app/testHost.ts`, `src/client/boot.ts`, `src/client/ui/styles/ui.css`, `src/debug/testApi.ts` (+ test), `tests/support/testFeel.json`, `tests/support/fakeTestHost.ts`, `tests/tools/vite/fixtures/feelSample.json`, `tests/content/feelSchema.test.ts`, `tests/content/feedbackSchema.test.ts`, `tests/content/checkContent.test.ts`, `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`, `tests/golden/journals/*` (hash lines only), `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## Change Log

- 2026-10-29: Story 2.5 implemented: `feel.fx`, cue `fx` presets, real-time shake, pooled particles, the perfect's camera move, the « PARADE PARFAITE » stamp, `__PP__.fx()`, goldens regenerated (hashes only).
- 2026-10-30: Code review (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 10 patches applied (no camera move after the level ended in the same frame, focus forgotten on reset, `EpicStamp.cancel()`, linear stamp timeline, live retuning of `perfectCamera`, `feel.fx.perfectCamera.refocusMs` to glide between two perfects, tighter tests, a real tap-through assertion, the stamp out of the HUD box measure); goldens regenerated again (hashes only, `feel.json` changed); AC 11 perf evidence accepted by Geo as it stands; 5 items deferred.
