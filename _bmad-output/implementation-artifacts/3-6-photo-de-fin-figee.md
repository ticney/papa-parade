---
baseline_commit: e3219e68f0673df5c5b5a94a65a52fef351da311
---

# Story 3.6: Photo de fin figée

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want a frozen photo of the state of the room when Mama arrives,
so that I can laugh at the scene and at my disasters.

Requirement: FR35 `[V1]`, UX-DR4, UX-DR13. It builds on the `photo` flow state of 3.5. Stories 3.7 (Mama's lines), 3.9 (replay) and 3.11 (the final buttons) slot into the sequence it starts.

## Acceptance Criteria

### The final snapshot

1. **Taken once, at the end.** On `LevelScored`, whatever the end (`timer`, `mamaWoke`, `cycleDone`: D1), after `levelSession.finish()` and before the app enters `result`, the client takes `sim.snapshot()` once. It is rendered through `level.update(snapshot.world, 1, now)`: no step runs and the picture is the snapshot's, not a live read of `sim.world`.
2. **Every end state can be snapshotted.** A test takes and restores a snapshot of a `photo` and of an `ended` world, and the restored world's hash equals the original's. `SimSnapshot.version` stays 28: this story adds no world field.
3. **A failure never blocks the Result screen.** If the snapshot or the capture fails, one `log.warn` on `render`, no photo (AC 12's fallback), and the Result screen runs as today. No « Oups ».

### The camera and the picture

4. **The camera is tunable.** `feel.fx.photoCamera` (`yawDeg`, `pitchDeg`, `zoomPct`) in `FeelSchema`, `content/feel.json`, `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json`; `content/_schemas` regenerated. Bounds: `yawDeg` 15 to 75 and `pitchDeg` 20 to 60, so the camera never looks through a wall the room does not model (D3); `zoomPct` 0 to 40. It is read from the live feel at capture, so a `SetFeel` applies to the next photo. Nothing in `src/sim` reads it.
5. **Its own camera.** A second `OrthographicCamera`, placed by `fitIsoCamera(camera, room, aspect, view?)`. The new optional `view: { yawDeg, pitchDeg }` defaults to `ISO_YAW_DEG` and `ISO_PITCH_DEG`, so the game camera is unchanged bit for bit (its existing tests pass unedited). The game camera, `cameraFx` and the world UI are not touched.
6. **The capture.** `GameRenderer.capture(scene, camera, aspect, target)` renders into a centred rectangle of the drawing buffer of aspect `aspect` (`setViewport` + `setScissor`), copies it with `target.drawImage(canvas, …)` **in the same task** (D4), restores the viewport and scissor, and returns a `Result`. A canvas with no size returns an `err` and draws nothing. The next `drawStatic` draws the game camera's view as before.
7. **A `<canvas>`, never an image URL.** The photo is a 2D `<canvas>` of `feedback.json › photo.widthPx` by `heightPx`. No `toDataURL`, no `toBlob`, no `<img>`: the CSP (`default-src 'self'`, no `img-src`) would refuse a `data:` or `blob:` image in the deployed build only. Do not touch the CSP.
8. **The filter.** The vignette of the mockup (`key-result.html`, `#vig`: clear to `vignetteFromPct` of the radius, then `ink` at `vignetteOpacityPct`) is drawn on the 2D canvas after the copy, with the colours from `PALETTE` and the numbers from `feedback.json › photo`. The frame is the polaroid (AC 11), the flash and the sound are AC 9.
9. **Flash and sound.** The client event `PhotoTaken` (`FEEDBACK_CLIENT_EVENTS`, `feedback.json › events`) plays a new cue `photo_taken`: a new clip `ui_camera_shutter` (bus `ui`), `visual: { kind: 'uiElement' }`, a `medium` haptic and a `flash`. The flash is visible over the Result screen (AC 10), and under reduced motion it is the existing border glow. It plays once: never on a screen rebuilt after the portrait overlay, never on a failed capture.

### The Result screen

10. **The flash leaves the HUD.** `#pp-hud` is `hidden` in `result`, so a flash inside it would never show. `screenFlash.element` moves to a sibling of `#pp-ui`, at `z-index` 15 (still above the HUD and below the pause panel, as today), and takes the class `pp-screen-flash--over` (`z-index` 60) only while the app is in `result`. A perfect's flash in play looks the same as before.
11. **The polaroid.** `pp-polaroid` (`DESIGN.md › polaroid`, `key-result.html`): `paper`, `{rounded.sm}`, the ink outline and sticker shadow, tilted by a random angle within `feedback.json › photo.tiltMaxDeg`, kept with the photo so that a rebuilt screen shows the same tilt. It sits left of the panel, in a two-column layout that fits 750 × 340 without scrolling, whatever the header (the 1.22 constraint). The canvas has `role="img"` and `aria-label` `result.photo_label` (« Photo de fin », in `strings.fr.json`).
12. **The sequence.** `ResultPhase` gains `photo`, first. With a photo: the polaroid drops in (one CSS animation with a reduced-motion rule) while the panel stays transparent (`opacity: 0`, not `visibility: hidden` or `hidden`: it holds the focus, D6), `onPhoto()` fires once, and after `feedback.json › resultScreen.photoHoldMs` the phase goes to `rows` as today. **With no photo the phase starts at `rows`, exactly as today, and the screen has no polaroid.**
13. **A woken Mama's header waits.** With a photo, the header and `onMamaWoke()` come when `rows` starts, not at build (EXPERIENCE: « never place anything between the photo and Mama's reaction »). With no photo, as today.
14. **Skip and rebuild.** A press during `photo`, past `inputGraceMs`, does what a skip does today: panel shown, rows at their totals, stars placed silently, header at rest with no slam and no `onMamaWoke`, buttons up. The polaroid stays. A screen rebuilt with `isDone` shows the same picture at rest, with no drop, no flash and no sound. The canvas lives in `boot.ts` (`resultPhoto`, cleared on `loading`), and each build re-parents it.
15. **The HUD.** The HUD stays hidden through `photo` and the rest of `result` (already so: `uiShell` shows it only in `level`; 3.9 keeps it hidden through its replay). An e2e pins it. No marker is in the picture: the markers are DOM, the capture is WebGL only, and the effects are reset by `finish()` first.
16. **Mirrors.** `data-pp-photo` (`taken` or `none`), cleared with `ppResult` on `loading`; add `ppPhoto` to `tools/build/inspectDist.ts`. `data-pp-result` shows `photo`.

### The near misses frozen on the photo

17. **The rule (D2).** In `endLevel`, right after `LevelEnded` and before `scoreLevel`, whatever the end: each threat whose def's gag is a near miss (`isNearMissGag`, in `sim/threats/gags.ts`; today `stairs_slide` alone) and whose target is an anchor counts once when the baby, **not carried**, stands within `feel.endOfLevel.frozenNearMissReachM` of the threat's point, by squared distance. The threat's state does not matter.
18. **What it writes.** `world.score.nearMisses + 1` and a new event `NearMissFrozen{threatId, gag}` at the same `t`, sitting between `LevelEnded` and `LevelScored`. It is a new event and not `NearMiss`, so 3.9's highlights do not take it for a moment of play. No sound, no `world.rng` draw, no gag.
19. **The note.** The Hurlement (« Sans hurlement ») falls by `screamPerNearMissPoints` per frozen near miss, through `computeMamaScore` as it stands, still held to `screamMaxPoints`. A test scores the same game with and without the baby at the stairs and pins the difference through the feel's values, not a literal.
20. **The tunable.** `feel.endOfLevel.frozenNearMissReachM` (1, positive), in the same three feel files as AC 4. `1` is measured, not a guess: see « The measure » below. **A value under 0.79 counts nothing in the live salon.**
21. **No double count.** A stairs gag during play stays one `NearMiss`, and a baby still within reach at the end adds one `NearMissFrozen`: two different things, the slide and the photo. A test pins both. A carried baby at the stairs, and a level with no near-miss threat (`chambre_night`), count none.
22. **Report.** `simReport` gains `frozenNearMisses`, per run and in the totals; `simArgs` help says so.

### Docs

23. **Docs.** `project-context.md` gets a « The end photo » paragraph (the capture, the CSP rule, the flash's move, the frozen near miss). `EXPERIENCE.md`: the Result sequence's first step is the photo with its flash, and a woken Mama's header comes after it. The GDD's Note de Maman and `decision-log.md` get the frozen rule. The stale « The photo (3.6)… come later » comment in `resultScreen.ts` goes.

## Tasks / Subtasks

- [x] Task 1: Frozen near misses in the sim (AC: 2, 17, 18, 19, 20, 21)
  - [x] `isNearMissGag` in `gags.ts`, as one typed table, with `stairsSlide` left as it is
  - [x] `sim/scoring/frozenNearMiss.ts` (`recordFrozenNearMisses`), called by `endLevel`; `NearMissFrozen` in `events.ts` and its list
  - [x] `feel.endOfLevel.frozenNearMissReachM`; `npm run content:schemas`
  - [x] Unit tests: within and beyond reach, carried, no such threat, a threat in each state, all three ends, the note's difference, snapshot round trip of `photo` and `ended`
- [x] Task 2: The camera and the capture (AC: 4, 5, 6, 7, 8)
  - [x] `feel.fx.photoCamera`; the `view` parameter of `fitIsoCamera`
  - [x] `GameRenderer.capture`, and the fakes (`levelSession.test.ts`)
  - [x] New `client/endOfLevel/photo.ts`: `takeEndPhoto` plus the pure `photoRectOf` and vignette helpers, with tests
  - [x] Look at a real photo of both levels and tune the default camera in `feel.json` (D3)
- [x] Task 3: Cue and flash (AC: 9, 10)
  - [x] `ui_camera_shutter` in `tools/audio/makePlaceholderAudio.ts`; `npm run assets:audio -- --only ui_camera_shutter`
  - [x] `PhotoTaken`, the cue and the event row; `feedback.json › photo` and `resultScreen.photoHoldMs` in the schema, `tests/support/testContent.ts` and the tests that build a full table
  - [x] Move `screenFlash.element`, add `pp-screen-flash--over`; check the perfect's flash specs still pass
- [x] Task 4: The Result screen (AC: 3, 11, 12, 13, 14, 15, 16)
  - [x] Option `photo: { canvas, tiltDeg } | null` and `onPhoto` in `createResultScreen`; the `photo` phase; `startRows`; the header's move
  - [x] Wire it in `boot.ts`: snapshot, capture, `resultPhoto`, mirror, clear on `loading`
  - [x] CSS in `ui.css`: two columns, polaroid, the drop and its `:where(:root[data-pp-motion="reduced"])` rule (`designTokens.test.ts` enforces it)
  - [x] `result.photo_label`; `ppPhoto` in `inspectDist.ts`
  - [x] Unit tests in `resultScreen.test.ts`: both paths, skip in `photo`, rebuild, the header's timing. Existing tests pass `photo: null` and keep their assertions
- [x] Task 5: Report and e2e (AC: 22 and all)
  - [x] `simReport.ts`, `simArgs.ts`, the whole-report pins
  - [x] `npm run golden:update`, deliberately; read the diff and say what moved in the Completion Notes
  - [x] New `tests/e2e/photo.spec.ts`; adapt `result.spec.ts`, `mamaWoke.spec.ts`, `debugOverlay.spec.ts` (see Traps); assert `data-pp-photo="taken"` in `tests/e2e-dist/dist.spec.ts`
  - [x] `npm run sim` with all four bots on the salon, before and after: `meanStars`, `endsByReason`, `frozenNearMisses`, in the Completion Notes
- [x] Task 6: Docs (AC: 23)
  - [x] `npm run ci:fast` after each task, plus the touched specs (`photo`, `result`, `mamaWoke`, `finalRush`, `feedback`, `debugOverlay`, `timer`, `journal`, `autoplay`) on Chromium

## Dev Notes

### Decisions

- **D1. Every end gets the photo.** 3.5 left this to 3.6 (its D2). The GDD says « Le perdant voit toujours sa photo », and `EXPERIENCE.md` shows the polaroid under « Maman s'est réveillée ! ». The trigger is therefore `LevelScored`, not `flow.state === 'photo'`. **The sim keeps `ended` for `mamaWoke` and `cycleDone`**: moving them to `photo` would touch every test that reads those ends and change nothing the player sees.
- **D2. A frozen near miss is where the baby is, not what a threat is doing.** The GDD's example is « bébé en haut de l'étagère », and the game has no height, no climbing and no shelf: `baby` is a point on the floor plane. The one near-miss gag is `stairs_slide`, so « the baby at the top of the stairs » stands in for it. A rule on threat state would be nearly empty: the last wave closes `lullMs` (3 000 ms) before the end and a stairs threat lasts about 1 400 ms, and in the 120 games measured below no stairs threat was up at a timer end (3 were, all after a `mamaWoke`). Position is what the photo shows, so the player can see why Mama screams, and it gives the rush one more job: get him away from the stairs. A future shelf threat gets the rule by adding its gag to the table.
- **D3. The photo shows the whole room, from a slightly different angle.** Fit the room box like the game camera, so the mess, the door and the baby are all in frame. The rooms were modelled for the iso camera (story 7.1), which looks from `+x +z`, so a yaw far from 45 risks looking through a wall that is not there: hence the bounds, and check them on a capture (tighten them if 15 or 75 shows the outside). Starting values `yawDeg: 38`, `pitchDeg: 30`, `zoomPct: 0`: **look at a capture of both levels and change them if the door or the stairs fall out of frame**. Geo tunes the rest.
- **D4. Same-task copy.** The renderer has `preserveDrawingBuffer: false` (leave it: it has a perf cost every frame), so the drawing buffer is only valid until the task ends. `drawImage` right after `render`, in one function. The main canvas shows the capture for no frame, because `drawStatic` follows in the same task.
- **D5. Not a render target.** A `WebGLRenderTarget` plus `readRenderTargetPixels` looks tidier, but three r186 writes the working (linear) colour space into a target (`outputColorSpace` applies only to the screen: `WebGLPrograms.js:213`), so the photo would be darker than the game, and it needs a y-flip too. The viewport route has neither problem.
- **D6. The panel is transparent during `photo`,** so the photo is alone on screen and the layout does not jump. `boot` focuses `initialFocus` (the panel) at build, and an element that is hidden cannot take focus: hence `opacity`.
- **D7. Sound on the `ui` bus,** like the star stamps of the same screen.

### The measure (behind AC 20)

Distance from the baby to `stairs_top` when the level ends, 30 live salon games per bot, seeds 1000 to 1029, measured at this story's creation with a throwaway script over `playGame`:

| Bot | Closest | Median | Within 0.6 m | Within 1 m | Within 1.5 m |
|---|---|---|---|---|---|
| `perfect` | 1.29 | 3.78 | 0 | 0 | 1 |
| `human` | 0.79 | 3.78 | 0 | 1 | 2 |
| `random` | 0.79 | 2.69 | 0 | 4 | 4 |
| `idle` | 0.79 | 3.78 | 0 | 2 | 3 |

**0.79 m is as close as he gets:** the anchor is not on an open cell, so his approach stops there. So at 1 m, `perfect` is never charged, `human` 1 game in 30 and `random` 4 in 30. Re-measure after the implementation with `frozenNearMisses` in the report.

### Current state of the files this story changes

- **`client/boot.ts`.** The `LevelScored` branch (L1442) stores the score, calls `levelSession.finish()`, `appFsm.enter('result')` and `drawStatic()`. **The capture goes between `finish()` and `enter`:** `finish()` runs `stopLoop`, which resets the effects and the camera, so nothing mid-shake is in the picture. This code runs while the loop is draining events and `currentLevel` is the scene. `camera` (L225) must stay the game's. `levelFeel()` is the live feel. The `result` builder is at L1610; `hasResultStarted` is the `isDone` of a rebuild (it goes true on the first `onPhase`, so a portrait flip during `photo` rebuilds straight to `actions`, which is correct). `screenFlash` is appended to `hudRoot` at L452. The cleanup on `loading` is at L1848.
- **`client/ui/screens/resultScreen.ts`.** `enter('rows')`, `onMamaWoke` and the staggered `later` calls run at build (L489-496): move them to a `startRows`. `complete()` must also bring the header up silently when skipped from `photo`, and remove the panel's transparency. Listeners sit on `element`, so a press on the polaroid skips too. `.pp-result-panel` keeps its name: many specs select it.
- **`client/render/renderer.ts`.** `render` remembers `lastScene` and `lastCamera` for the redraw after a cap change. `capture` must **not** write them, or a later pixel-ratio step would redraw the photo's camera on the main canvas.
- **`client/render/isoCamera.ts`.** Yaw and pitch come from constants at L56-57; default the new parameter to them. `zoomPct` is `camera.zoom = 1 + zoomPct / 100` then `updateProjectionMatrix`, in `photo.ts`, not in the fit.
- **`client/render/levelScene.ts`.** `update(world, alpha, nowReal)` takes any `Readonly<World>`: `alpha` 1 draws the current pose. Its clock is `world.time.sim + STEP_MS` at alpha 1, which is harmless on a frozen world. The door follows `flow.finalRushAt`.
- **`sim/flow/flowSystem.ts`.** `endLevel` closes the sequence, the phone, the silence and the instinct, enters the state, then `MamaWoke`, `LevelEnded`, `scoreLevel`. Add one call before `scoreLevel`. `scoreLevel` reads `world.score.nearMisses` as it stands.
- **`sim/threats/gags.ts`.** `GAG_CONSEQUENCES` is a typed per-gag table: follow that shape, so that a new gag must say whether it is a near miss. A def's `gag` can be absent (a `hiddenZone` def has `surpriseGags`): `ctx.level.threats[i].def` says, and `gagIdOf` throws on an unknown one.

### What must keep working

- A level that ends with the baby away from the stairs emits the same events as today.
- `data-pp-flow` is unchanged (`photo` or `ended`, from the world).
- The `Result` screen's `isDone` path, the 3.3 journal buttons and the input grace.
- `autoplay.spec.ts`'s frozen screenshot is taken in play: it must not move. If it does, the flash's move leaked into the frame, so fix that, do not regenerate.
- Perf: the capture is one extra render, once per level, outside play. Nothing is added to the frame path, so `perf.spec.ts` should not move. `dist:check`: one short clip, a level stays ≤ 3 MiB.

### Traps

- **The CSP fails only when deployed.** `npm run dev` has no `_headers`, so a `data:` image works there and breaks on the playtest link. AC 7 forbids it, and `e2e:dist` proves it (no CSP violation, `data-pp-photo="taken"`).
- **`#pp-hud` is hidden in `result`** (`hud.setVisible`), and an element with `hidden` hides its children: a cue's flash inside it draws nothing, while `__PP__.cueLog()` still says it drew. Assert visibility in the e2e, not only the log.
- **`#pp-ui` is `overlayHost`'s root** (`boot.ts:1554`), and its `clear()` runs `root.replaceChildren()`: a flash appended inside it is wiped at the next screen. Hence a sibling. Today `#pp-hud` is `z-index` 10 and `#pp-ui` 20.
- **`setViewport` takes CSS pixels, `drawImage` buffer pixels.** three multiplies the viewport by the pixel ratio; the buffer's origin is top-left for `drawImage` and bottom-left for GL. A centred rectangle hides the y difference; `photoRectOf` computes in CSS pixels and `capture` scales the source rect by the ratio. Pin it with DPR 2 in a unit test.
- **Restore the scissor test too,** or every later frame is drawn inside the photo's rectangle.
- **`e2e` specs that read `rows` first:** `result.spec.ts:204,247,285`, `mamaWoke.spec.ts:171`, `debugOverlay.spec.ts:946-954`. `toHaveAttribute` waits, but `photoHoldMs` plus a key pressed in `photo` skips: `debugOverlay` presses keys on a focused field and expects `rows` to hold. Wait for `rows` first; do not lengthen timeouts. `mamaWoke.spec.ts:199` reads the slam's animation on a header that now comes later.
- **Exact scores in tests.** A live-salon game that now ends with the baby by the stairs loses `screamPerNearMissPoints`: `result.spec.ts` and `tests/tools/sim/mamaScore.test.ts` may pin scores. Move the fixture or the seed with a reason; never loosen the assertion.
- **The goldens move.** Two new feel keys change `feelHash` and `worldHash` in every journal (3.5 saw the same). `eventTypes` and `eventsHash` must move **only** for a scenario whose baby ends within reach of a `stairs` threat: read the diff and name them. Any other movement is a bug.
- **New event lists:** `events.test.ts` pins the list, `simEventFeedback.ts` routes by type, and the whole-report tests need the new zero (`simReport.test.ts`).
- **`FEEDBACK_CLIENT_EVENTS` and `feedback.json › events`** go together, and `feedbackTwins.test.ts` checks the `uiElement` twin. `content:check` wants a visual and a haptic with any audio.
- **Math.random** is fine in `boot.ts` for the tilt (client), never in `src/sim`. E2E must not pin the tilt.
- **The worktree guard** refuses compound shell commands naming `git`, and commands with a shell variable in an option position. Use plain commands and the edit tools.
- **`VITE_DEBUG_ALLOWED=false` may be exported:** it was not set at this story's creation, but run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` if it is.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`.

### Out of scope

- Mama in the picture, her lines and `mum-bubble`, and her animations: 3.7. The mockup shows a Mama in the photo; do not model one here.
- `save.mamaMemory` and the tags: 3.8 (`NearMissFrozen` is ready for it).
- The replay and the `REPLAY` banner: 3.9. It starts after the stars.
- « Âge suivant », « Frigo », and the `< 2★` hint: 3.11.
- The catastrophe gauge and « door bursts open » of the GDD: not in the game yet.
- Saving the photo to the Fridge, sharing it, or a caption.

### Architecture compliance

- `src/client/endOfLevel/photo.ts` is where the architecture puts it (L524, L597, L959). `highlights.ts` beside it is 3.9's.
- `src/sim` stays pure and knows nothing of cameras, `photoCamera` or the snapshot's use. `World` gains no field.
- The client only reads the world. The snapshot's copy is read by `level.update` only and is dropped after the capture: 3.9 takes its own.
- Hot paths are untouched; `takeEndPhoto` may allocate, once per level.
- `feel.fx` is the home of client-only feel (`perfectCamera`), and the feel panel generates its fields from the schema.
- I/O-like failures return `Result` and every fallback logs a `warn`.

### Library and framework notes

Stack pinned (`three@0.186.1`); nothing to add or upgrade, so no version research was needed. Confirm the signatures of `setViewport`, `setScissor` and `setScissorTest` against the installed package. Web facts used: a canvas without `preserveDrawingBuffer` is only readable in the task that drew it; CSP `default-src` governs images when `img-src` is absent.

### File structure

- **New:** `src/client/endOfLevel/photo.ts` and test, `src/sim/scoring/frozenNearMiss.ts` and test, `tests/e2e/photo.spec.ts`, `public/assets/audio/ui_camera_shutter.m4a`, a clip test beside `tests/tools/audio/finalRushClips.test.ts`.
- **Updated:** `src/client/boot.ts`, `src/client/render/{renderer,isoCamera}.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/styles/ui.css`, `src/client/feedback/feedbackEvents.ts`, `src/content/schemas/{feel,feedback}.ts`, `src/sim/events.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/threats/gags.ts`, `content/{feel,feedback,strings.fr}.json`, `content/_schemas/`, `tools/audio/makePlaceholderAudio.ts`, `tools/build/inspectDist.ts`, `tools/sim/{simArgs,simReport}.ts`, `tests/support/{testFeel.json,testContent.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/golden/journals/*`, the e2e specs named in Traps.

### Testing

- **Sim:** real `createSim` with typed commands, time in `STEP_MS`, tunables through the feel's values. Place the baby by playing or with `restore`, never by writing to `sim.world`.
- **Client unit:** `photoRectOf` (aspects wider and narrower than the buffer, DPR 2), the vignette's colour stops, `fitIsoCamera`'s default unchanged and `view` honoured, `capture` with a fake (restores, does not touch `lastCamera`), Result screen paths with the existing fake scheduler.
- **E2E (Chromium), `photo.spec.ts`:** end a level through the test API (`advanceToEnd`, `?threats=off`), then: `data-pp-result` goes `photo` then `rows`; `data-pp-photo` is `taken`; `#pp-hud` is hidden; `.pp-polaroid canvas` is not blank (read `getImageData` and require more than one colour); `__PP__.cueLog()` holds `photo_taken` once and `.pp-screen-flash` was visible; a skip from `photo` reaches `actions` with the polaroid still there; portrait and back keeps the same pixels and adds no cue; a `mamaWoke` end shows the polaroid and the header after it; reduced motion has no drop animation; layout fits 750 × 340 with no scroll. A camera tune changes the picture: two ends with different `zoomPct`, different pixels.
- **Look at it.** Take screenshots of the Result screen on both levels with a door open and props down, say so in the notes, and flag anything Geo should judge. No new screenshot reference: the tilt is random.
- **Checks:** `npm run ci:fast` per task. `ci:story` belongs to the review, not to dev-story.

### Previous story intelligence

- **3.5 review:** tests that cannot fail were the main finding (`.every` on an empty array, `toBeHidden()` on an empty locator, two constants compared). Assert on something that exists. Module-level state in `src/sim` was refused: `recordFrozenNearMisses` keeps none.
- **3.5 Trap kept:** an idle live salon can wake Mama before the end, so a spec that needs a game reaching its timer uses `?threats=off`, and one that reads the end state accepts `photo` and `ended`.
- **3.5 and 7.1:** the salon sits at 40 of 40 draw calls: add nothing to the room. The door panel and the props are already in.
- **4.10:** a new feel key must reach `testFeel.json` and `feelSample.json`, and every report test needs the new zero. Stale doc comments and snapshot numbers in `project-context.md` get updated as you go.
- **3.3:** the journal's Result buttons are playtest-only: the two-column layout must still fit them, at +30 % text.

### Git intelligence

The last commits are 3.5's merge and review, and 7.1. Reuse 3.5's patterns: a client event with a `uiElement` cue, `feel.endOfLevel`, and a mirror with its `inspectDist.ts` marker.

### Project Structure Notes

Follows the layers and aliases. `client/endOfLevel/` is new and named by the architecture. No variance.

### Project Context Rules

- Anything Geo might tune is data: the camera and reach in `feel.json`, timings and the filter in `feedback.json`, strings in `strings.fr.json`, colours as tokens or `PALETTE`.
- Units are suffixes (`widthPx`, `photoHoldMs`, `yawDeg`, `frozenNearMissReachM`); `…At` is sim time; events are past tense; no `enum`; factories `create<Name>`.
- Every cue with audio has a visual and a haptic. Nothing flashes above 3 Hz. Reduced motion is client-only, and no stylesheet has `@media (prefers-reduced-motion)`.
- UI text is French, in `strings.fr.json`, and failure is never named. Polaroid, buttons and text sizes follow `DESIGN.md`; text ≥ 16 px.
- No `console.*`; the sim never logs. Regenerating goldens is deliberate and said in the story. Never weaken a guardrail, and never widen the CSP.
- No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **The frozen near miss is a position rule (D2).** The baby within 1 m of the stairs when the level ends costs 3 points. The game has no height yet, so this stands in for « en haut de l'étagère ». It can catch a player who did nothing wrong and whose baby just wandered there, about 1 game in 30 for `human`. If it feels unfair, raise the bar: only while he is `approach`-ing, or lower the reach to just above 0.79.
2. **The door stays shut on a `mamaWoke` or `cycleDone` photo.** 3.5 opens it only in a rush. The mockup shows it open, and in a `mamaWoke` Mama did come through. It could open for the photo; not done, since 3.5 said « never in a game without a rush ».
3. **The photo has no Mama until 3.7,** so it shows the room and Papa alone.
4. **`photoHoldMs` starts at 1 200.** It adds that to every Result sequence. A press skips it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6], UX-DR4, UX-DR13
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Macro-boucle : la fin de niveau], `#Conditions de victoire et d'échec`, `#Note de Maman` (L441)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L238, L524, L597, L823, L959
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L99-105, L224, L295, L323, L327, L380, L504
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L272-284, L486, L515; `mockups/key-result.html`
- [Source: _bmad-output/project-context.md] « Mama's note », « The final rush », « Three ways to end a level », « Feedback, rendering, UI », « Static hosting »
- [Source: _bmad-output/implementation-artifacts/3-5-porte-qui-s-ouvre-et-rush-final.md] D2, Traps, Review Findings

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Implementation Plan

Six tasks in the story's order, `npm run ci:fast` after each: (1) the frozen near miss in the sim, (2) the photo camera and `GameRenderer.capture`, (3) the shutter cue and the flash's move, (4) the Result screen and the `boot.ts` wiring, (5) the report, goldens and e2e, (6) docs. Task 2's « look at a real photo » needed the boot wiring of Task 4, so it was done right after it (a throwaway spec took the photos, then it was deleted).

### Debug Log References

- The first `ci:fast` after Task 1 was red on the goldens only (`feelHash`), as expected: regenerated deliberately (see below).
- `renderer.test.ts` mocks `three`: the mock gained `Vector4` and the viewport / scissor calls `capture` uses.
- `designTokens.test.ts` refused `var(--pp-polaroid-tilt)` until `.pp-polaroid` declared it (`--pp-polaroid-tilt: 0deg`).
- `.pp-panel` has a `pp-pop-in` animation with `both`, whose fill beats a plain `opacity: 0`: the waiting panel is `.pp-result-panel.pp-result-panel-waiting { animation: none; opacity: 0 }` (two classes, so the later reduced-motion `.pp-panel` rule cannot bring it back).
- `tests/content/feedbackSchema.test.ts` has an explicit unit-suffix list: `^widthPx|^heightPx` added, with a comment, for the photo canvas (the story names `widthPx` and `heightPx`).
- The worktree guard refuses heredocs and a shell loop with a computed program: the edit tools and one script file in the scratchpad were used instead.

### Completion Notes List

- **Frozen near miss (AC 17-22).** `isNearMissGag` is one table typed on `GagId` (`stairs_slide` alone is `true`); `recordFrozenNearMisses` runs in `endLevel` between `LevelEnded` and `scoreLevel`, whatever the end, with a squared-distance test, no state and no draw. `NearMissFrozen` is a new event (sorted right after `NearMiss`). `SimSnapshot.version` stays 28 (a test restores a `photo`, an `ended` and a `mamaWoke` world and compares `hashJson` of the world). `cycleDone` is reached in the unit test through a hidden system that sets `world.cycle.completedAt` (the snapshot refuses the field in a level with no cycle), as `bedtimeCycle.test.ts` does for its hand.
- **Goldens (deliberate `npm run golden:update`).** All 54 files moved by the two new feel keys: `feelHash` in each journal and `worldHash` in each `.expected`. **No `eventTypes` and no `eventsHash` moved**: no scenario ends with the baby within reach of a stairs threat, so the rule is invisible there, as the story predicted. The only other diff was a Biome reformat of `mama_woke.expected.json`'s array, undone.
- **Sim before and after** (`npm run sim`, salon, 30 games per bot, seeds 1000 to 1029; « before » is the same code with `frozenNearMissReachM` at 0.01, which counts nothing, put back to 1 after). `perfect`: meanStars 5, ends `timer` 30, `frozenNearMisses` 0 before and after. `human`: meanStars 3.9, ends `timer` 30; `frozenNearMisses` 0 → **1** (seed 1016: 80.2 → 80.1 mean, one game 3 points lower, same stars). `random`: meanStars 0.8, ends `timer` 25 / `mamaWoke` 5; `frozenNearMisses` 0 → **4**, no score moved. `idle`: meanStars 0.8, ends `timer` 24 / `mamaWoke` 6; `frozenNearMisses` 0 → **2**, no score moved. The last two already have their Hurlement row at its cap (about 330 `NearMiss` over 30 games), so a frozen one costs them nothing visible. This matches « The measure » of the story (human 1, random 4, idle 2 within 1 m; perfect 0). The `human` figure is Geo's open point 1.
- **Camera (D3), looked at.** The Result screen and the photo of both levels (salon with the door open, bedroom with a woken Mama, Papa asleep) were captured and read. At the default (`yawDeg` 38, `pitchDeg` 30, `zoomPct` 0) the whole room is in frame, the door, the stairs and the playpen included. The four corners of the bounds (yaw 15 and 75, pitch 20 and 60) were captured on both levels: none shows the outside or looks through a wall the room does not model, so the bounds stay as the story set them and the **default values are unchanged**. Geo tunes the rest: at zoom 0 the room leaves ink margins, and since the room already fills the frame from top to bottom, a large zoom crops its corners (the threshold was not measured).
- **Capture (AC 6, D4).** `GameRenderer.capture` renders into the centred rectangle (`setViewport`, `setScissor`, the scissor test), copies it with `target.drawImage(canvas, …)` in the same call, and restores the viewport, the scissor and the test in a `finally`; it returns an `err` for a canvas with no size, a bad aspect or a refused copy, and it does not write `lastScene` / `lastCamera`. **Deviation:** `photoRectOf` (and `bufferRectOf`, which turns GL's bottom-left origin into `drawImage`'s top-left one, pinned at a pixel ratio of 2) live in `client/render/captureRect.ts`, not in `endOfLevel/photo.ts`: the renderer needs them and `photo.ts` imports the renderer's type, so this avoids a cycle. `photo.ts` has `takeEndPhoto`, `placePhotoCamera`, the vignette (`vignetteStopsOf`, `drawVignette`, the radius ratio 0.7 of the mockup is `PHOTO_VIGNETTE_RADIUS_RATIO` in `shared/constants.ts`).
- **Flash, cue and sound.** `photo_taken` (clip `ui_camera_shutter`, `ui` bus, `uiElement`, `medium`, flash 60 % for 300 ms, the maximum the schema allows) and a placeholder clip with its own seed (`SEED + 49`). The flash is a sibling of `#pp-ui` at `z-index` 15 and takes `pp-screen-flash--over` (60) only in `result`. **One addition beyond the story:** the epic stamp moved with it (to `z-index` 16, still above the flash and below the pause panel), or the stamp of a perfect would now sit under the flash's fade; the unit test pins flash < stamp < `#pp-ui`.
- **Result screen.** `ResultPhase` gains `photo`; `photo: { canvas, tiltDeg } | null` and `onPhoto` are required options. The header of a woken Mama (and the cycle's) is mounted by `mountHeader` when the rows start, at rest on a skip or a rebuild. `.pp-result-panel` keeps its name and stays the only panel; with no photo the screen is built exactly as before (its tests pass with `photo: null` and unchanged assertions; the helper now finds the panel by class because a photo puts the polaroid first).
- **E2E (Chromium).** New `tests/e2e/photo.spec.ts` (15 tests, passing): the phases through a mutation recorder (`photo`, `rows`, `stars`, `actions`, so no polling race), the moment of `photo` (HUD hidden, panel `opacity: 0`, polaroid dropping, panel focused), non-blank canvas, no `<img>`, the shutter once and the flash seen (opacity, outside the hidden HUD, `z-index` above `#pp-ui`), reduced motion (glow, no drop), skip during `photo`, a portrait rebuild (same pixels and tilt, no cue, no flash), the tilt bound, a woken Mama (header after the photo; skip brings it up at rest), a camera tune changing the pixels, `data-pp-photo` cleared on replay, 844 × 390 and 750 × 340 in two columns without a scroll, and a failed capture (the 2D context refused: `data-pp-photo="none"`, no polaroid, no cue, the rows start as before, one warning). Adapted: `mamaWoke.spec.ts` (the shutter is one more cue and one more vibration, first); `result.spec.ts` and `debugOverlay.spec.ts` needed no edit (they already wait for `rows`) and pass. `tests/e2e-dist/dist.spec.ts` asserts `data-pp-photo="taken"` and one canvas.
- **Checks run.** `npm run ci:fast` green after each task and at the end (375 files, 7 793 tests). Chromium e2e: `photo`, `result`, `mamaWoke`, `finalRush`, `mute`, `reducedMotion`, `juice`, `ui`, `feedback`, `timer`, `journal`, `autoplay` (its frozen screenshot did not move), `testApi`, `chambreNight` and the two `debugOverlay` tests of the Result screen: all green. `npm run build:playtest` + `dist:check --flavor playtest`, then the dist spec « plays a level end to end » on the built bundle with its real CSP (`dist-chromium`): green, `data-pp-photo="taken"`, no CSP violation. `npm run build` + `dist:check --flavor prod`: green, so `ppPhoto` is not in the store build; level payload 906 KiB. **Not run, by the story's own rule:** `npm run ci:story` and `npm run ci` (the review runs the gate), WebKit, `perf.spec.ts`, the full `debugOverlay` and the other suites.
- **Look (for Geo).** Seen on screenshots of both levels (rows phase): the polaroid left of the panel, tilted, the room whole in the picture, the panel on the right with the woken header on the bedroom. The vignette is over the picture, but the margins are ink-coloured, so it is hard to see: judge it by playing. The panel's pop-in at the start of the rows and the drop of the polaroid were checked by their computed styles in the e2e, not by eye. To judge by playing: the photo has no Mama (3.7); zoom 0 leaves empty margins; `photoHoldMs` 1 200 adds that to every Result (a press skips it); the salon's photo shows its door swung open (that level has a rush), and a `mamaWoke` or `cycleDone` end gets no door-opening (open point 2). No screenshot reference was added: the tilt is random.

### File List

**New**

- `src/sim/scoring/frozenNearMiss.ts`, `src/sim/scoring/frozenNearMiss.test.ts`
- `src/client/endOfLevel/photo.ts`, `src/client/endOfLevel/photo.test.ts`
- `src/client/render/captureRect.ts`, `src/client/render/captureRect.test.ts`
- `tests/e2e/photo.spec.ts`
- `tests/tools/audio/cameraShutterClip.test.ts`
- `public/assets/audio/ui_camera_shutter.m4a`

**Modified**

- Sim: `src/sim/events.ts`, `src/sim/events.test.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/threats/gags.ts`, `src/sim/threats/gags.test.ts`
- Content and schemas: `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`, `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`, `src/shared/constants.ts`
- Client: `src/client/boot.ts`, `src/client/render/renderer.ts`, `src/client/render/renderer.test.ts`, `src/client/render/isoCamera.ts`, `src/client/render/isoCamera.test.ts`, `src/client/feedback/feedbackEvents.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/client/app/levelSession.test.ts`, `src/client/ui/hud/screenFlash.ts`, `src/client/ui/hud/screenFlash.test.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/screens/resultScreen.test.ts`, `src/client/ui/styles/ui.css`
- Tools: `tools/audio/makePlaceholderAudio.ts`, `tools/build/inspectDist.ts`, `tools/sim/simReport.ts`, `tools/sim/simArgs.ts`
- Tests: `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`, `tests/tools/sim/simReport.test.ts`, `tests/tools/build/checkDist.test.ts`, `tests/content/feelSchema.test.ts`, `tests/content/feedbackSchema.test.ts`, `tests/e2e/mamaWoke.spec.ts`, `tests/e2e/support/game.ts`, `tests/e2e-dist/dist.spec.ts`
- Goldens (`feelHash` / `worldHash` only): the 54 files of `tests/golden/journals/`
- Docs: `_bmad-output/project-context.md`, `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`, `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md`, `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md`
- Tracking: `_bmad-output/implementation-artifacts/3-6-photo-de-fin-figee.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-11-02 — Story 3.6 implemented: the near misses frozen on the end photo (sim, `NearMissFrozen`, `feel.endOfLevel.frozenNearMissReachM`), the photo camera and `GameRenderer.capture`, the polaroid and the `photo` phase of the Result screen, the shutter cue and the flash moved out of the HUD, `simReport.frozenNearMisses`, docs. Goldens regenerated deliberately (`feelHash`, `worldHash`).
