# Story 1.11: Parry the Electrical Outlet with a Tap

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.11 « Parer la prise électrique au tap ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see the baby rush to the outlet, read the danger and parry it with a tap at the right moment,
so that I live the core verb of the game: read, then respond right.

**Requirements covered:** FR1 (telegraph → window → result, visible), FR2 (Parry = a tap on the threat, released before `holdMinMs`), FR9 (freeflow glide: tapping a threat glides Papa there in ≤ 600 ms), FR25 (the outlet, its gag `outlet_hair`), NFR2 (≤ 50 ms tap → visual feedback), UX-DR10 (`threat-icon` with its `alert` halo, `target-highlight` distinct by shape; mockup `key-hud-level.html` state A). This is the story that makes the threat of story 1.10 **playable in the browser**: until now it only existed headless.

## Precondition (check first, stop if it fails)

Story 1.10 is in `review` at the time of writing (commit `757a124`). Start only when 1.10 is `done` in `sprint-status.yaml` and its review fixes are committed (`git status` clean apart from `_bmad-output/`), then run `npm run ci` green before the first edit so any later failure is yours. This story builds on what the 1.10 review changed (`src/sim/index.ts`, `src/client/app/levelSession.ts`, `content/feedback.json`, `tools/content/contentChecks.ts`…): never revert it. If the review renamed something this story names (`responseWindow`, `PapaGlideStarted`, `ThreatInstance`…), follow the code, not this file. If not, stop and tell Geo.

> Shell note from story 1.10: this shell may export `VITE_DEBUG_ALLOWED=false`, which wins over `.env.development` and makes every e2e spec time out on `data-pp-app="start"`. Run commands as `env -u VITE_DEBUG_ALLOWED npm run …` if that happens.

## Acceptance Criteria

From the epic (1 to 5), then derived from the architecture, the existing code and the deferred work (6 to 11).

1. **Telegraph visible.** When the client receives `ThreatTelegraphed`, a `threat-icon` (a `{colors.parry}` circle with an `ink` outline and a lightning-bolt glyph, 56 px on the compact surface and 64 px on the regular one) and a soft, pulsing `{colors.alert}` halo appear on the outlet (at its anchor, world-anchored through the `CSS2DRenderer`), and the def's `feedback.telegraph` cue (`tel_outlet`) plays through `feedback.json`: sound, visual twin and light vibration. The icon and halo stay while the threat is `telegraph` or `windowOpen` and disappear as soon as it leaves those states (resolved or gag).
2. **Tap on the threat.** A primary `pointerdown` within `feel.input.touchRadiusPx` (screen CSS px) of an active threat's icon centre is a press on that threat, never a floor tap: `inputMapper` sends `PressThreat{threatId, t}` with `t = timeMap.realToSim(event.timeStamp)` and no `TapFloor`, and no tap marker. The pressed threat gets the `target-highlight` (solid 4 px `{colors.alert}` outline plus a bouncing `{colors.alert}` chevron with an ink outline: distinct from the halo by shape) drawn by the **next frame**, and Papa sets off on his glide (the sim's `PapaGlideStarted`) at the first step that applies the press. Several active threats: the nearest icon within the radius wins. A tap outside every radius is a floor tap, exactly as in story 1.7.
3. **Release.** The `pointerup` or `pointercancel` of the pointer that pressed a threat sends `Release{t}` (same time conversion), wherever the finger is (bound on `window`, not only the canvas), and even while paused or counting down. A pause request while that pointer is still down sends `Release` stamped with the sim clock. A quick tap is therefore always a Parry; only a real hold of `holdMinMs` (400 ms) is judged as Firmness (a gag `wrongResponse` on the outlet, story 1.10 D7).
4. **Response feedback at once, pose on arrival (P3).** On a `ResponseResolved` with `perfect` or `success`, the def's `feedback.perfect` / `feedback.success` cue plays in that very call (sound, visual twin, haptic). The provisional « lift the baby » pose is queued and plays when Papa's glide to that threat arrives (`PapaArrived` while gliding to it); if Papa is not gliding to it at resolution, it plays at once; if the glide is cancelled (`TapFloor` / `Move`), it is dropped. Nothing at the arrival contradicts the result already shown (no second sound, no change of outcome).
5. **Gag presented.** On `GagTriggered{gag: 'outlet_hair'}`, the def's `feedback.gag` cue plays and the provisional cube gag plays: the room's lights go out (the lamp plugged into the outlet) and come back, and Papa's hair stands on end (spikes on top of his cube). No text, no failure screen, nothing removed (NFR9). Every `GagId` of `@sim` has a presentation (compile-time check).
6. **Tap latency e2e.** `tests/e2e/tapLatency.spec.ts` (chromium and webkit) dispatches a `pointerdown` on the telegraphed threat and checks `performance.mark('highlightRendered').startTime − performance.mark('press').startTime ≤ 50` ms, where `press` is marked in the input handler and `highlightRendered` in the first frame whose world-UI render shows the highlight. Both marks exist only in debug builds (`VITE_DEBUG_ALLOWED`), and each mark clears its previous one (no growing buffer).
7. **The live level plays the outlet.** `content/levels/salon_crawler.json` plans the outlet at `outlet_01` (`fromMs: 4000`): in `npm run dev`, after the countdown, the baby locks on the outlet, rushes to it, and the player can parry it or watch the gag, again every cycle (cooldown 6 s). `npm run content:check` passes.
8. **Debug switch for the e2e suite.** In debug builds only, `?threats=off` loads the level with its planned threats removed (the sim gets `threats: []`); any other value is ignored with a `warn`. Existing e2e specs whose assertions an outlet cycle disturbs (exact vibration or cue sequences, the baby's wander cycle) open with it; no assertion is weakened. A new `tests/e2e/threat.spec.ts` covers ACs 1 to 5 on the live level (telegraph icon and cue, tap → highlight → glide → success cue, no tap → gag cue and gag mirror, a floor tap far from the outlet still walks).
9. **Feedback table and content checks.** `content/feedback.json`: `tel_outlet`, `resp_parry`, `resp_parry_perfect` and `gag_outlet` each gain an `audio` (new placeholder clips, generated by `npm run assets:audio`) and a `visual` twin (a `soundWave` anchored on the new anchor kind `threat`); `feedbackEquivalence` stays green. `content:check` refuses a `threat`-anchored visual on a cue that a key of `events` points at (a generic event has no threat), and names the file and the JSON path. The four clips exist, are real M4A files, and the level payload stays within `LEVEL_PAYLOAD_MAX_BYTES` (`audioAssets.test.ts`).
10. **No sim behaviour change.** The only `src/sim` change is exporting the types the client reads (`ThreatInstance`, `ThreatState`, `PapaGlide`, `PendingPress`) from `src/sim/index.ts`. The golden references are **not** regenerated and still pass; `src/sim` coverage stays ≥ 90 %.
11. **Quality gates.** `npm run ci` passes (chromium and webkit). `biome.json` and the existing `tests/architecture/*.test.ts` are untouched (fixtures may be added). No new npm dependency. No per-frame allocation in the new frame code (world UI update, threat markers, hit test, choreography, gag effects).

## Tasks / Subtasks

- [ ] **T0: Precondition (all ACs)** — check the Precondition section; `npm run ci` green before the first edit.
- [ ] **T1: `@sim` types (AC 10)** — export `ThreatInstance`, `ThreatState`, `PapaGlide`, `PendingPress` from `src/sim/index.ts` (types only). Nothing else in `src/sim` changes. The 1.10 code review (in progress at the time of writing) lists the first two as a patch and has open decisions that touch this story (whether Papa glides on a `resolved` / `gag` threat, whether a gag `act` is interruptible): read its « Review Findings » in the 1.10 file and build on whatever it settled.
- [ ] **T2: Feedback content (AC 1, 4, 5, 9)**
  - [ ] `src/content/schemas/feedback.ts`: `SoundWaveSchema.anchor` becomes `z.enum(['papa', 'baby', 'threat'])` with a description saying `threat` is « the threat the event names; only for cues a threat def points at ». `npm run content:schemas` (never by hand).
  - [ ] `tools/audio/makePlaceholderAudio.ts`: four new synthesized clips, named constants with units like the existing ones (Dev Notes › Placeholder sounds); extend `tests/tools/audio/makePlaceholderAudio.test.ts`. Run `npm run assets:audio` on the Mac (macOS only, `afconvert`) and commit the four `.m4a` files.
  - [ ] `content/feedback.json`: the four cues of Dev Notes › Feedback cues. Still no `events` entry for the threat events (the cue comes from the def, D3).
  - [ ] `tools/content/contentChecks.ts`: the `threat` anchor rule (AC 9), with a failing fixture case in `tests/content/checkContent.test.ts`; the « real repository » case stays green. `tests/content/feedbackSchema.test.ts`: `threat` accepted, an unknown anchor refused.
  - [ ] `content/levels/salon_crawler.json`: `"threats": [{ "def": "outlet", "anchor": "outlet_01", "fromMs": 4000 }]` (AC 7). `npm run content:check`.
- [ ] **T3: Feedback director routing (AC 1, 4, 5)**
  - [ ] `feedbackDirector.ts`: add `playCue(cueId, world, threatId)` (Dev Notes › Feedback routing). `handle` keeps its contract and shares the playing code; a `threat` anchor resolves the threat's `xM` / `zM` from `world.threats` by id (missing threat or `threatId === null`: the ring is skipped with a `warn`, the sound and haptic still play). Unknown cue id: `warn`, nothing plays.
  - [ ] `src/client/feedback/threatFeedback.ts` (+ test): `threatCueOf(event, defs)`: `ThreatTelegraphed` → `feedback.telegraph`; `ResponseResolved` `perfect` → `feedback.perfect`, `success` → `feedback.success`, `fail` → `null` (the gag cue comes with `GagTriggered`, never twice); `GagTriggered` → `feedback.gag`; any other event → `null`. The def is found through the instance's `defId` in `world.threats` (`kind` on `ThreatTelegraphed`).
  - [ ] `feedbackDirector.test.ts`: `playCue` plays sound, haptic and ring at the threat; a `ResponseResolved{fail}` plays nothing and its `GagTriggered` plays the gag cue once.
- [ ] **T4: Threat markers in the world UI (AC 1, 2, 6)**
  - [ ] `src/client/ui/world/threatMarkers.ts` (+ test with the DOM double used by `tapMarker.test.ts`): Dev Notes › Threat markers. One pooled marker per threat instance, mounted per level, `update(world, highlightedId)` once per frame, no allocation.
  - [ ] `worldUi.ts`: owns the markers (`mountThreats(entries)`, `unmountThreats()`); `render(camera)` skips the DOM renderer only when neither the tap marker nor any threat marker is visible; returns or reports whether the highlight became visible this frame (for the `highlightRendered` mark).
  - [ ] `ui.css`: `.pp-threat`, `.pp-threat-halo`, `.pp-threat-icon`, `.pp-threat-highlight`, `.pp-threat-chevron` from the tokens (`--pp-color-parry`, `--pp-color-alert`, `--pp-color-ink`), sizes by `[data-pp-surface]`, halo pulse ≤ 1 Hz and chevron bounce, both static under `prefers-reduced-motion: reduce`. No colour or size literal that a token covers.
- [ ] **T5: Input (AC 2, 3, 6)**
  - [ ] `hitTest.ts`: `pickThreat(clientX, clientY, rect, candidates, radiusPx)` per Dev Notes › Hit test (preallocated, nearest wins). `hitTest.test.ts`: inside / outside the radius, the boundary (inclusive), the nearest of two, an icon behind the camera ignored.
  - [ ] `pointerInput.ts`: `PointerSample` gains `pointerId`; `bindPointer` also binds `pointerup` and `pointercancel` on a second target (`window`) and hands them to `onUp`.
  - [ ] `src/client/input/threatPress.ts` (+ test): the pure press tracker of Dev Notes › Press tracking (which pointer pressed which threat, when to send `Release`).
  - [ ] `inputMapper.ts`: Dev Notes › Input mapper changes. `inputMapper.test.ts`: threat beats floor, no marker on a threat press, floor tap outside the radius unchanged, `Release` on the pressing pointer's up only, `Release` while paused, pause with a held press sends `Release` at the sim clock, a new level forgets the press, non-primary pointers ignored.
- [ ] **T6: Gag and response choreography (AC 4, 5)**
  - [ ] `src/client/render/gags.ts`: `GAG_PRESENTATIONS` typed `Record<GagId, …>` (Dev Notes › Gag presentation); `outlet_hair` dims the scene lights and shows Papa's hair. `levelScene.ts`: `LevelFx` gains `gag(gag, startAt)` and `liftBaby(startAt)`; `update` drives them on the sim clock; `resetFx` ends them.
  - [ ] `papaView.ts`: provisional hair (a few ink spikes on top of the cube, hidden by default, one shared geometry), `setHair(amount01)`. `babyView.ts`: a vertical lift offset, `setLiftM(m)`. Pose maths stay pure and tested (`papaView.test.ts`, `babyView.test.ts`).
  - [ ] `src/client/feedback/responseChoreography.ts` (+ test): Dev Notes › Lift choreography.
- [ ] **T7: Wiring (AC 1–8)**
  - [ ] `levelSession.ts`: `ActiveLevel` gains `level: LevelContent` (the defs the director and the markers need); `onLevelReady` also receives what the markers need (the threat instances with their anchor positions from the geometry, Dev Notes › Threat markers).
  - [ ] `boot.ts`: Dev Notes › Boot wiring (routing, choreography, markers, press/release binding, `?threats=off`, debug mirrors, performance marks).
  - [ ] `levelSession.test.ts`, `levelScene.test.ts`: the new fields and effects.
- [ ] **T8: E2E (AC 6, 8)**
  - [ ] `tests/e2e/support/game.ts`: `openGame(page, query?)` / `startLevel(page, query?)`; helpers to wait for a threat state and read its icon point from `data-pp-threat-px`.
  - [ ] `tests/e2e/threat.spec.ts` and `tests/e2e/tapLatency.spec.ts` (Dev Notes › E2E).
  - [ ] Run the whole e2e suite with the outlet live first; add `?threats=off` to exactly the specs an outlet cycle disturbs, never weaken an assertion. List them in the Completion Notes with the reason.
- [ ] **T9: Docs and verification (AC 11)**
  - [ ] `deferred-work.md`: Dev Notes › Deferred items this story touches, and › Deferred by this story.
  - [ ] `npm run lint`, `npm run typecheck`, `npm test` after T3, T5 and T7; then `npm run ci` end to end.
  - [ ] Break things to prove the guards bite, then restore: a cue with `audio` and no `visual` → `feedbackEquivalence` fails; `"anchor": "threat"` on `papa_bump` → `content:check` names `cues.papa_bump.visual.anchor`; a `GagId` added to `GAG_IDS` with no presentation → `typecheck` fails; a `new Vector3()` in `threatMarkers.update` → caught by review (no automated guard: say so).
  - [ ] Manual check on `npm run dev` (844 × 390, touch emulation): the icon and halo appear on the outlet, a tap highlights it at once and Papa glides, success and gag both read; Papa's hair and the lights; no console error. Then on a phone over `npm run dev --host` if one is at hand (otherwise say it was not done).
  - [ ] `git status`: only the files of the File List changed; nothing committed.

## Dev Notes

### What exists today (stories 1.1 to 1.10)

- **Sim** (story 1.10): `world.threats: ThreatInstance[]` (`id`, `defId`, `anchorId`, `xM`, `zM`, `state: 'idle' | 'telegraph' | 'windowOpen' | 'resolved' | 'gag'`, `enteredAt`, `windowOpenAt`, `responseWindow` — **not** `window`, `simPurity` forbids that identifier —, `press`); `world.papa.glide: PapaGlide | null` (`threatId`, `toXM`, `toZM`, `startedAt`, `arriveAt`, `speedMps`), Papa state `glide`. Commands `PressThreat{t, threatId}` and `Release{t}` (no `threatId`: it ends every pending press with `press.t ≤ t`). Events `ThreatTelegraphed{threatId, kind, anchorId}`, `WindowOpened`, `ResponseResolved{threatId, response, quality, reason?, offsetMs}`, `GagTriggered{threatId, gag, reason}`, `ThreatRearmed`, `PapaGlideStarted{threatId, toXM, toZM, arriveAt}`, `PapaArrived`, `PapaStateChanged`. The sim judges on `command.t`; Papa glides on **every** press on a non-idle threat (1.10 D11), `TapFloor` and `Move` cancel the glide, `MoveStop` does not; a press held `holdMinMs` with no `Release` is classified as Firmness → gag `wrongResponse` on the outlet (D7). A press is applied at `max(ceil(t / STEP_MS) × STEP_MS, simNow + STEP_MS)`: the next step.
- **`@sim` today** exports `World`, `PapaSlice`, `BabySlice`, `SimEvent`, `ResponseQuality`, `FailReason`, `GAG_IDS`, `GagId`… but **not** `ThreatInstance` / `ThreatState` / `PapaGlide` (T1). The client may only import `@sim`.
- **Content**: `content/threats/outlet.json` (`feedback: { telegraph: tel_outlet, success: resp_parry, perfect: resp_parry_perfect, gag: gag_outlet }`, `cooldownMs: 6000`); the four cues are haptic only; `content/levels/salon_crawler.json` plans nothing (1.10 D4: this story turns it on). `loadLevelContent` gives `LevelContent { level, threats: Record<defId, ThreatDef> }`; the session already loads it and passes it to `createSim`.
- **Input** (`src/client/input/`): `bindPointer(canvas, onDown)` binds only `pointerdown`; there is **no `pointerup` handling in play**. `inputMapper.handlePointerDown` drops non-primary pointers and non-left buttons, gates on `appFsm.state === 'level' && pause.state === 'running' && active`, converts to NDC, `hitTester.pickFloor` → `TapFloor` + `showTapMarker` + `onTap`. `createHitTester(camera)` is preallocated (Raycaster, Plane).
- **World UI** (`src/client/ui/world/`): `createWorldUi(container)` = one `CSS2DRenderer` (`sortObjects = false`) and its own scene, created once in `boot.ts`; `render(camera)` returns early while the tap marker is hidden. `#pp-world` is `pointer-events: none` and `aria-hidden`: elements in it never catch taps (the hit test is done in the mapper, by projection). `tapMarker.ts` is the pooled-element pattern to copy (outer element positioned by CSS2D, inner element animated).
- **Feedback** (`src/client/feedback/feedbackDirector.ts`): `handle(name, world)` plays the cue the `events` table maps `name` to (audio → haptic → visual ring → camera, each guarded by `attempt`, a failure is a `warn`). The `soundWave` anchor is `'papa' | 'baby'` and is read from `world`. `boot.ts` calls `director.handle(event.type, world)` for every sim event.
- **Scene** (`render/levelScene.ts`): ambient + directional light created locally, `content_root` group (room, shadows, Papa, baby, waves), `LevelFx { soundWave, shake }` on the sim clock (`world.time.sim + alpha × STEP_MS`), `resetFx`, `dispose`. Views: `papaView` (toon cube, interpolated), `babyView` (sphere + gaze cone). Art constants live at the top of each view file with their units.
- **Room** (`salon_crawler`): anchor `outlet_01` at `(-3.95, 0.3, 0.5)` on the west wall (`outlet_plate` visual node there). **There is no lamp node in the room.** Papa spawns at `(2.5, 0, 1.5)`, the baby at `(-0.5, 0, 1.2)`.
- **Debug mirrors** (`boot.ts`): `data-pp-*` attributes on `<html>`, written on events only and only in debug builds; e2e specs read them (`tests/e2e/support/game.ts`). `?throwAfterMs` is the precedent for a debug-only URL switch.
- **Audio**: `npm run assets:audio` (`tools/audio/makePlaceholderAudio.ts`, macOS only) synthesizes the placeholder `.m4a`; `feedbackClips(table)` lists every clip; the client preloads them all; `audioAssets.test.ts` checks each is a real M4A and the payload ceiling.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | The sim does not change (types exported only). Everything here is client, content and e2e. | Story 1.10 made the threat complete headless (judgement, glide, cycle); 1.11 is its presentation and input. The goldens must stay as they are. |
| D2 | **No client-side predicted glide.** Papa's glide is the sim's (`papa.glide`, interpolated by `papaView`). The press is applied at the next sim step, so at time scale 1 the next frame that runs a step shows Papa moving; the ≤ 50 ms budget (NFR2) is carried by the highlight, drawn in the frame after `pointerdown` whatever the sim does. | A predicted glide would have to be reconciled with the sim's path (and would contradict it when there is no path). The epic's « dès la frame suivante » holds at ×1; under slow-mo (1.14) or hitstop the glide starts with the step: Open point 1. |
| D3 | Threat cues come **from the def** (`feedback.telegraph/success/perfect/gag`), never from the `events` table. `ResponseResolved{fail}` plays nothing: its `GagTriggered` (same step, right after) plays the gag cue, once. | 1.10 left `ThreatTelegraphed` generic on purpose: two threats share the event, not the sound. One cue per outcome. |
| D4 | The visual twin of a threat cue is a `soundWave` at the threat (`anchor: 'threat'`). The icon, halo and highlight are UI, not cues. `content:check` refuses `threat` on a cue an `events` key points at. | The twin rule (`feedbackEquivalence`) is per cue: the telegraph sound needs a world effect of its own, and the outlet is where it comes from. A generic event has no threat to anchor on. |
| D5 | **Release always reaches the sim.** `pointerup` / `pointercancel` of the pressing pointer sends `Release` even when the level is paused or counting down (the time map is flat during a pause, so `t` is the pause time). A pause request while it is down sends `Release{t: sim clock}`. A level change forgets the press without sending anything. | Without a release the sim classifies a held press as Firmness at 400 ms: a pause in the middle of a tap would gag the player for something they did not do. A sim command queued while paused is applied at the next step, with its own `t`. |
| D6 | Only the **primary** pointer presses threats (the mapper already ignores the others); its `pointerId` is remembered until its up or cancel. A second primary `pointerdown` (mouse click while held is impossible; a new touch after the first lifted) replaces it. | `Release` names no threat and ends every pending press: multi-touch on several threats needs a decision of its own (Open point 2). One active threat at a time in E1 anyway. |
| D7 | Hit test in **screen space**: each pressable threat (`telegraph` or `windowOpen`) is projected at its icon point (the anchor's 3D position from the geometry) with the camera; a press counts if the pointer is within `touchRadiusPx` CSS px of it (inclusive); nearest wins. Threat before floor; the baby and objects come later (1.17, 1.19, 1.20). | The architecture's priority (threat > baby > object > floor) and a radius « en px écran » (`feel.input.touchRadiusPx`). The icon is what the player aims at, so the icon point is the target. |
| D8 | The threat markers are reconciled **from the world each frame** (visible iff `telegraph` / `windowOpen`), not from events; the highlight is client state (`highlightedThreatId`) set in the `pointerdown` handler and cleared when that threat stops being active. | Architecture › Rendu: views are reconciled from `World` each frame. Events would desynchronise after a restore or a missed event; the highlight must appear before any sim step. |
| D9 | The gag is presented **at `GagTriggered`**, wherever Papa is: the lights fade out over `GAG_LIGHTS_FADE_MS`, stay dark `GAG_LIGHTS_DARK_MS`, come back; Papa's hair pops up and settles over `GAG_HAIR_MS`. All on the sim clock (pause freezes it), all art constants at the top of `render/gags.ts`. No lamp is added to the `.blend`: the room's lights are « the lamp » until E7. | The epic asks for a provisional cube gag. Adding a lamp means a Blender re-export (story 1.6 pipeline) for a placeholder. One fade out and in is not a flash (< 3 Hz, EXPERIENCE › Motion), so reduced motion keeps it (Open point 3). |
| D10 | The « lift the baby » pose (P3) is a provisional hop of the baby sphere (`LIFT_HEIGHT_M` over `LIFT_MS`, sim clock), queued per Dev Notes › Lift choreography. | The architecture's rule « son et haptique au jugement, pose finale à l'arrivée ». The real animation is E7. |
| D11 | The live level plans the outlet at `fromMs: 4000` (after the 3 s countdown, about 4 s of play before the first telegraph). | Geo needs to play it now; 1.18 replaces the plan with waves. Open point 4. |
| D12 | `?threats=off` (debug builds only) strips the level's planned threats in the client before `createSim`; the specs that an outlet cycle disturbs use it. | The live level now plans a threat that fires every ~8 s: exact vibration and cue sequences (`feedback.spec.ts`) and the baby's wander cycle (`baby.spec.ts`) would become flaky. Same precedent as `?throwAfterMs`. The sim still gets a valid `LevelContent` (and its journal the matching `levelHash`). |
| D13 | `performance.mark('press')` / `('highlightRendered')` exist in debug builds only, each preceded by `performance.clearMarks(name)`. | AC 6 measures them; an unbounded mark buffer in a store build would be a leak for nothing. |

### Threat markers (`src/client/ui/world/threatMarkers.ts`)

```ts
export interface ThreatMarkerEntry { threatId: number; xM: number; yM: number; zM: number } // icon point: the anchor's positionM
export interface ThreatMarkers {
  mount(entries: readonly ThreatMarkerEntry[]): void; // one marker per entry, replaces the previous level's
  unmount(): void;
  /** Once per frame: shows the active ones, highlights `highlightedId`. Allocation-free. Returns true when the highlight became visible this frame. */
  update(threats: readonly Readonly<ThreatInstance>[], highlightedId: number | null): boolean;
  readonly isAnyVisible: boolean;
  /** The icon points, for the hit test (same objects, never copied). */
  readonly entries: readonly ThreatMarkerEntry[];
  dispose(): void;
}
```

- One `CSS2DObject` per entry: outer `.pp-threat` (placed by the renderer) holding `.pp-threat-halo`, `.pp-threat-highlight` (hidden unless highlighted), `.pp-threat-chevron` (an SVG down-pointing triangle above the icon, `alert` fill, `ink` stroke, hidden unless highlighted) and `.pp-threat-icon` (parry circle with a white lightning bolt, the mockup's `i-bolt` path; build it with `svgElement`). `aria-hidden` (the layer already is).
- Visibility and highlight are toggled by writing `hidden` / a class only when the value changes (no style writes per frame). Match by index: `entries[i].threatId === world.threats[i].id` (same order, 1.10 D5); `mount` checks it once and `warn`s on a mismatch.
- The entries come from `world.threats` and the level geometry (`anchors.find(a => a.id === threat.anchorId).positionM`), built once per level in `levelSession` (never per frame). An anchor missing from the geometry cannot happen (`createSim` refuses it), but if it does, place the icon at `(xM, 0, zM)` with a `warn`.
- CSS (from the mockup state A and DESIGN.md › threat-icon / target-highlight): icon 56 px (`[data-pp-surface='compact']`) or 64 px (regular), `--pp-color-parry` fill, ink outline (the mockup's `--outline` equivalent token), bolt about 54 % of the icon; halo a radial `--pp-color-alert` glow about 2.1 × the icon, pulsing opacity/scale at ≤ 1 Hz; highlight a ring `4px solid var(--pp-color-alert)` with 2 px ink inside and outside, about 1.6 × the icon; chevron bouncing a few px at ≤ 2 Hz. Under `prefers-reduced-motion: reduce`, no pulse and no bounce. Names in `ui.css`: `pp-` prefix, kebab-case.

### Hit test (`hitTest.ts`)

`pickThreat(clientX, clientY, rect, candidates, radiusPx): number | null` — for each candidate whose threat is pressable (the caller passes `world.threats` and the marker entries; skip states other than `telegraph` / `windowOpen`), project its icon point with one preallocated `Vector3` (`v.set(x, y, z).project(camera)`), skip if `v.z > 1` or `v.z < −1` (outside the frustum), convert to CSS px (`rect.left + (v.x + 1) / 2 × rect.width`, `rect.top + (1 − v.y) / 2 × rect.height`), compare the squared distance with `radiusPx²` (inclusive), keep the nearest. Allocation-free. Keep `pickFloor` unchanged.

### Press tracking (`src/client/input/threatPress.ts`)

A pure, testable tracker (this also answers the 1.5 review item « extract a pure reducer » for the in-game press; the UI button press machine stays as it is):

```ts
export interface ThreatPressTracker {
  pressed(pointerId: number, threatId: number): void; // remembers the pointer (replaces any previous)
  /** True when `pointerId` is the one that pressed: the caller sends `Release` and the tracker forgets it. */
  released(pointerId: number): boolean;
  /** True when a press is held: the caller sends `Release` (pause). Forgets it. */
  releaseAll(): boolean;
  forget(): void;                       // new level: drop without sending
  readonly heldThreatId: number | null; // for the highlight
}
```

### Input mapper changes (`inputMapper.ts`)

- `handlePointerDown(sample)`: after the existing gates and the rect check, `threatId = pickThreat(...)` with `deps.getThreatTargets()` (new dep: `{ threats: world.threats, entries }` of the active level, or null) and `feel.input.touchRadiusPx` (new dep, read once). If a threat is hit: `enqueue({ type: 'PressThreat', threatId, t })`, `tracker.pressed(sample.pointerId, threatId)`, `deps.onThreatPressed(threatId)` (boot sets the highlight and, in debug builds, marks `press`), and **return** (no `TapFloor`, no marker, no `onTap`). Otherwise the floor path exactly as today.
- New `handlePointerUp(sample)`: if `tracker.released(sample.pointerId)` and a level is active (paused or not, D5): `enqueue({ type: 'Release', t: timeMap.realToSim(sample.timeStamp) })`.
- New `releaseHeld()` (boot calls it on `PauseRequested`): if `tracker.releaseAll()` and a level is active: `enqueue({ type: 'Release', t: active.sim.world.time.sim })`.
- The bound sim changes (new level): `tracker.forget()` (same place as `moveIntent.reset()`).
- The calibration offset (`visualOffsetMs`, story 2.7) still comes later and will be subtracted here only.

### Feedback routing

- `FeedbackDirector.playCue(cueId: string, world: Readonly<World>, threatId: number | null): void` — same order and guards as `handle` (audio, haptic, visual, camera, `onCue`). Resolve cues by id once (a `Map` built at creation, `hasOwn` like today).
- `boot.ts` `onSimEvent`: after `director.handle(event.type, world)`, `const cue = threatCueOf(event, world, active.level.threats)`; if not null, `director.playCue(cue, world, event.threatId)`.
- `threatCueOf` allocates nothing and has no `if` on a def id (a second threat in 1.16 must work by JSON alone).

### Lift choreography (`src/client/feedback/responseChoreography.ts`)

Pure state, one queued threat id (E1 has one active threat; the structure takes a list if 1.16 needs more):
- `ResponseResolved` with `perfect` / `success`: if `world.papa.state === 'glide' && world.papa.glide?.threatId === event.threatId` → queue it; else → `fx.liftBaby(world.time.sim)` now.
- `PapaArrived` while one is queued → play it (`fx.liftBaby(event.t)`), clear the queue.
- `PapaStateChanged{from: 'glide'}` with `to !== 'idle'` (a `TapFloor` or `Move` cancelled the glide) → clear the queue without playing.
- New level → clear. Tested with hand-written event sequences and world slices (no sim needed, but one integration case with a real sim and `createTestLevel([outletEntry(0)])` is welcome).

### Gag presentation (`src/client/render/gags.ts`)

```ts
export const GAG_PRESENTATIONS: Readonly<Record<GagId, GagPresentation>> = { outlet_hair: { lightsOff: true, hair: true } };
```

`Record<GagId, …>` makes a new `GagId` without a presentation a type error (AC 5). `levelScene` keeps references to its ambient and sun lights and their base intensities; `fx.gag(gag, startAt)` starts the effects the presentation lists; `update` sets the light intensity factor (1 → `GAG_LIGHTS_MIN_PCT` → 1 over fade / dark / fade) and Papa's hair amount from the sim clock; `resetFx` restores both. Art constants with units at the top of `gags.ts` (start around: fade 120 ms, dark 600 ms, min 25 %, hair 900 ms): Geo tunes them there until E7.

### Feedback cues (`content/feedback.json`)

| Cue | audio (`bus`, `gainPct`) | visual | haptic |
|---|---|---|---|
| `tel_outlet` | `tel_outlet`, `sfx`, 90 | `soundWave`, `threat`, 0.6 m, 400 ms | `light` |
| `resp_parry` | `resp_parry`, `sfx`, 100 | `soundWave`, `threat`, 0.8 m, 350 ms | `medium` |
| `resp_parry_perfect` | `resp_parry_perfect`, `sfx`, 100 | `soundWave`, `threat`, 1.2 m, 450 ms | `heavy` |
| `gag_outlet` | `gag_outlet`, `sfx`, 100 | `soundWave`, `threat`, 1.0 m, 500 ms | `heavy` |

Starting values for Geo (Open point 5). No `camera` (shake is story 2.5's).

### Placeholder sounds (`tools/audio/makePlaceholderAudio.ts`)

Same style as the bump (synth function per clip, `normalize`, `fadeEnds`, named constants with units, seeded rng if any noise): `tel_outlet` a short rising electric buzz (~300 ms), `resp_parry` a bright « pop » (~150 ms), `resp_parry_perfect` the pop plus a higher chime (~350 ms), `gag_outlet` a crackle then a descending « bzzt » (~500 ms). One-shots, not loops. They are placeholders (stories 2.3, 7.5 replace them under the same names); nobody has to listen to them for the story to be done, but say in the Completion Notes whether you did.

### Boot wiring (`boot.ts`)

- `levelSession`: `onLevelReady(level, threatEntries)` → `worldUi.mountThreats(threatEntries)`; a stopped level → `unmountThreats()` happens on the next mount (the markers are hidden outside `level` because `update` only runs in level frames: make sure a restart hides the old markers before its countdown).
- `onLevelFrame`: `const shown = worldUi.updateThreats(world.threats, highlightedThreatId)` before `worldUi.render(camera)`; clear `highlightedThreatId` when that threat is no longer active; if `shown` and debug: `performance.clearMarks('highlightRendered'); performance.mark('highlightRendered')` after `worldUi.render`.
- `inputMapper` deps: `getThreatTargets`, `touchRadiusPx`, `onThreatPressed(threatId)` (sets `highlightedThreatId`; debug: clear + mark `press`; mirror). `bindPointer(canvas, window, onDown, onUp)`. `events.on('PauseRequested', () => inputMapper.releaseHeld())`.
- `onSimEvent`: `threatCueOf` + `director.playCue`; `choreography.onEvent(event, world, currentLevel.fx)`; `GagTriggered` → `currentLevel.fx.gag(event.gag, event.t)`.
- `?threats=off`: parsed once (`URLSearchParams`), debug builds only; wraps `loadLevelContent` so that an `ok` result gets `level.threats = []` and `threats = {}`; another value → `warn` naming it, ignored.
- New debug mirrors (written on events, never per frame): `ppThreat` = `<threatId>:<state>` on `ThreatTelegraphed` (`telegraph`), `WindowOpened` (`windowOpen`), `ResponseResolved` (`resolved` or `gag`), `ThreatRearmed` (`idle`); `ppThreatPx` = `x,y` CSS px of the icon centre in page coordinates, written on `ThreatTelegraphed` (project the entry with the camera once, outside the hot path); `ppResponse` = the last `quality`; `ppGag` = the last gag id; `ppPress` = the threat id of the last press sent. Add them to the `mirror` name union.

### E2E

- `threat.spec.ts` (chromium and webkit, live level, `startLevel(page)` without `?threats=off`): (1) the telegraph shows `.pp-threat-icon` and `.pp-threat-halo`, `data-pp-threat` ends in `:telegraph`, `data-pp-cue` = `tel_outlet` (and its vibration where the device has one, `hapticPatternOf`); (2) wait for `:windowOpen`, tap `data-pp-threat-px` → `.pp-threat-highlight` visible, `data-pp-press` set, `data-pp-papa-state` = `glide`, `data-pp-response` ∈ `perfect | success`, cue `resp_parry*`, then the icon is hidden; (3) never tap → `data-pp-response` = `fail`, `data-pp-gag` = `outlet_hair`, cue `gag_outlet`; (4) a floor tap far from the outlet still shows the tap marker and walks Papa. No `waitForTimeout`: wait on mirrors with timeouts derived from the live data (`fromMs`, delay, window, cooldown) plus `OVERRUN_MARGIN_MS`, read from the files like `game.ts` does today.
- `tapLatency.spec.ts`: wait for `:telegraph` or `:windowOpen`, read the point, `page.touchscreen.tap` (or `page.mouse` where touch is unavailable), then poll `performance.getEntriesByName` for both marks and assert the difference ≤ 50 ms. One attempt per test, no retry loop that would hide a slow frame.
- `collectProblems` stays the guard against console errors and own warnings in both new specs.

### Previous story intelligence (1.7 to 1.10 and their reviews)

- **Hot paths allocate nothing**: rAF frame, `worldUi.render`, marker update, hit test, `onLevelFrame`, choreography and gag `update`. Event-driven work (a cue, a press, a gag start) may allocate. No template string in a per-frame `log` or `invariant` (test the condition first; `if (log.enabled('debug'))`).
- **Debug mirrors are written on events only**, guarded by `isMirrored`; Playwright reads them. Specs wait on mirrors with bounds derived from the live data, never fixed sleeps (1.7 / 1.8 reviews).
- **Every I/O-ish call in the frame loop is guarded** (the director's `attempt`): the loop is fail-stop, an exception ends the game. The new `playCue` follows the same pattern.
- **Art constants** live at the top of their file with their unit and the line « Geo tunes them here until the final art (E7) »; never `parry`, `dodge` or `alert` on anything but threats and signals (Papa is `primary`, the baby `paper`).
- **Tests use frozen fixtures** for the sim (`createTestLevel`, `outletEntry`, `testFeel.json`); client unit tests that create a sim pass `createTestLevel()`. E2E specs read the **live** files (`liveFeel`, `liveFeedback`, `anchorMirror`) and never copy numbers.
- `simPurity` bans the identifier `window` in `src/sim` (not in the client); keep `responseWindow`.
- Story 1.10's manual browser check was done with a headless Playwright script rather than the built-in browser: if you do the same, say so.
- The dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.11 : …`, by Geo.

### Architecture guardrails and traps

- **Judge on the press's `t`** (ADR-003): `PressThreat.t` and `Release.t` come from `event.timeStamp` through `timeMap`, never from `performance.now()` at enqueue time, never from the step. The client never decides quality: it only shows what the sim emitted.
- **The client never writes the world.** It reads `world.threats` and `world.papa.glide` and sends commands. No gameplay timing in the client: windows, delay, hold threshold stay in the sim and the feel.
- **Hitstop and slow-mo are story 1.14**: nothing here freezes or changes `timeScale`. The « PARADE PARFAITE » stamp, the verb label (2.2), the hold ring (1.23) and auto-target / glyph chip (1.17) are not in this story, even though the mockup's state A shows a verb and a ring.
- **`src/client` imports `@sim` only** (no deep path), `@content` types, `@shared`, `@platform`, `three`. `three/addons/renderers/CSS2DRenderer.js` is already used by `worldUi`.
- **No `navigator.vibrate`** outside `src/platform` (`platformApis` test): haptics go through `platform.haptics` via the director.
- **No colour, size or UI string literal** that a token or `strings.fr.json` covers (`designTokens` test mirrors `tokens.css`); this story adds no UI string (the world layer is `aria-hidden`).
- **Reduced motion is client-only** and never touches sim timing.
- **Existing tests that must keep passing unchanged**: every sim test and golden, `feedbackEquivalence`, `audioAssets`, `simPurity`, `layerBoundaries`, `platformApis`, `designTokens`, `move.spec.ts` (floor taps), `ui.spec.ts`, `pauseResume.spec.ts`, `level.spec.ts`. Deliberate edits: `feedbackDirector.test.ts`, `inputMapper.test.ts`, `hitTest.test.ts`, `pointerInput.test.ts`, `worldUi.test.ts`, `levelSession.test.ts`, `levelScene.test.ts`, the two view tests, `feedbackSchema.test.ts`, `checkContent.test.ts`, `makePlaceholderAudio.test.ts`, `game.ts` and the specs that get `?threats=off`. List every edited existing test in the Completion Notes with the reason.

### Project Structure Notes

- New (all in the architecture tree): `src/client/ui/world/threatMarkers.ts` (+ test; the architecture names `threatIcon.ts` and `targetHighlight.ts` — one module owns both because the highlight is drawn on the icon's element; say so if you split them), `src/client/input/threatPress.ts` (+ test), `src/client/feedback/threatFeedback.ts` (+ test), `src/client/feedback/responseChoreography.ts` (+ test), `src/client/render/gags.ts` (+ test), `public/assets/audio/{tel_outlet,resp_parry,resp_parry_perfect,gag_outlet}.m4a`, `tests/e2e/threat.spec.ts`, `tests/e2e/tapLatency.spec.ts`, a `checkContent` fixture for the `threat` anchor rule.
- Modified: `src/sim/index.ts`; `src/content/schemas/feedback.ts`, `content/_schemas/feedback.schema.json` (generated), `content/feedback.json`, `content/levels/salon_crawler.json`; `tools/content/contentChecks.ts`, `tools/audio/makePlaceholderAudio.ts`; `src/client/{boot.ts}`, `client/app/levelSession.ts`, `client/feedback/feedbackDirector.ts`, `client/input/{hitTest,pointerInput,inputMapper}.ts`, `client/render/{levelScene.ts,views/papaView.ts,views/babyView.ts}`, `client/ui/world/worldUi.ts`, `client/ui/styles/ui.css` and their tests; `tests/e2e/support/game.ts` and the specs that get `?threats=off`; `tests/content/{feedbackSchema,checkContent}.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`; `deferred-work.md`, `sprint-status.yaml`.
- Not in this story: keyboard / gamepad parry and auto-target (1.17), bots and `npm run sim` (1.12), `window.__PP__` (1.13), hitstop and slow-mo (1.14), more threats (1.16), waves (1.18), verb labels (2.2), hold ring and Firmness threats (1.23), calibration offset (2.7), a real lamp and real animations (E7).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** Geo tunes, the AI tests. The level plan, the cues, their sounds and rings are data; the provisional art constants sit named at the top of their files. Everything stays playable end to end without a human (the sim is unchanged, so headless and goldens are untouched; the browser path is covered by the two new specs).
- **Input:** Pointer Events on the canvas (plus `pointerup` / `pointercancel` on `window`), `event.timeStamp` kept, hit-test priority threat > floor, `touchRadiusPx` from the feel; handlers only stamp, pick, enqueue and set the highlight.
- **Performance:** tap → visual ≤ 50 ms (NFR2); zero allocation in frame code; CSS2D labels pooled; no blur filter or `backdrop-filter` (EXPERIENCE › Performance Budget: the halo is a radial gradient, not a blur).
- **Feedback:** response sound and haptic at judgement, final pose at arrival; every `audio` has `visual` + `haptic` (pillar 3, test-enforced); time effects are never feedback.
- **UX source of truth:** DESIGN.md (`threat-icon`, `target-highlight`, colours `parry` / `alert` / `ink`, compact 56 px / regular 64 px) and EXPERIENCE.md (icon disappears when the threat resolves; highlight in the frame after `pointerdown`; nothing flashes above 3 Hz; reduced motion).
- **Content:** ids `lower_snake_case`, camelCase keys with units; `content/_schemas/` generated only; `content:check` checks every cross-reference.
- **Stack pinned:** no new dependency. Three r186's `Vector3.project(camera)` and `CSS2DObject` are what is needed; no web research was required (nothing outside the pinned stack is touched).

### Deferred items this story touches (update `deferred-work.md`)

- 1.7, « A tap on a threat, the baby or an object »: **partly resolved in 1.11** (threat > floor); the baby and objects stay with 1.17, 1.19, 1.20.
- 1.9, « Sound waves … anchored on threats or props (`anchor` gains values with 1.11 / 1.15) »: **partly resolved** (`threat`); props stay with 1.15.
- 1.9, « Per-level audio manifest »: **still open**, moved to story 1.18 (four tiny clips added here; every clip is still preloaded).
- 1.10, « A press enqueued after its window expired is lost »: **watched, not changed** — `tapLatency` measures the visual side only; the window side needs a lagging time map to show up. Keep the item open for the playtest (1.24).
- 1.10, « Gag consequences … and the gag presentation »: **presentation resolved in 1.11** (provisional); consequences stay with E3, 1.15, 1.16, 1.22.
- 1.5 review, « The press state machine has no unit test … Extract a pure reducer with the input mapper. Story 1.11 »: **partly resolved** — the in-game threat press is a pure tested tracker (`threatPress.ts`); the UI button press machine (`pressButton.ts`) is unchanged, moved to the accessibility pass (2.10).
- 1.7 review, « Tap marker at the raw tapped point » / « `#pp-world` is `inset: 0` while taps use the canvas rect »: **still open**; the threat icons have the same assumption (hit test on the canvas rect, layer on the window). Note it there.

### Deferred by this story

- **Glide start under slow-mo or hitstop** (D2): the glide starts with the step that applies the press; story 1.14 decides whether the client must predict it.
- **Multi-touch on several threats** (D6): `Release` ends every pending press; story 1.16 or 1.18 (the first time two threats are active together).
- **A real lamp in the room and real gag / lift animations** (D9, D10): E7 (or a Blender pass if Geo wants the lamp sooner).
- **Halo and chevron animations run on real time**, so they keep moving behind the pause panel (like the tap marker): accessibility pass, 2.10.
- **`?threats=off` is a test switch**: remove it if 1.13's `window.__PP__.loadLevel()` makes it redundant.

### Open points for Geo (do not block the dev)

1. **Glide start.** At ×1 Papa moves on the next frame that runs a step (usually the very next one); the highlight is always next-frame. Under the perfect slow-mo (1.14) the glide may start a frame or two later. Fine, or should the client predict it?
2. **Two fingers.** Only one finger can press a threat at a time (primary pointer). Enough for E1?
3. **The gag** dims the whole room (the room's lights are the lamp) for about 0.8 s and pops Papa's hair. Keep it under « Réduire les animations », or soften it?
4. **First outlet at 4 s of play**, then every ~8 s (6 s cooldown + the baby freeing itself). Too often for a tuning session?
5. **Sounds and rings** are synthesized placeholders with guessed volumes and ring sizes (table above): tune them in `feedback.json`.
6. **Touch radius 48 px** around a 56 px icon on a phone: generous on purpose (`feel.input.touchRadiusPx`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.11 : Parer la prise électrique au tap], and around it [#Story 1.10] (the headless threat), [#Story 1.13] (`window.__PP__`), [#Story 1.14] (hitstop, slow-mo), [#Story 1.16] (more threats, no threat-specific code), [#Story 1.17] (auto-target, glyph chip), [#Story 1.23] (hold ring, Firmness), [#Exigences › FR1, FR2, FR9, FR25, NFR2], [#UX-DR10]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Chaîne d'entrées] (capture, hit-test priority, `touchRadiusPx`, commands), [#P3 — Jugement à l'appui, chorégraphie ensuite], [#P5 — Calibration et correspondance des temps] (`timeMap.realToSim`), [#P1 — Cycle de vie d'une menace] (several threats, Papa busy), [#Retours multimodaux], [#Système d'événements], [#Arborescence] (`client/input`, `client/ui/world/threatIcon.ts`, `targetHighlight.ts`, `render/views/threatView.ts`), [#Performances], ADR-003, ADR-006, ADR-008
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md#Components] (`threat-icon`, `target-highlight`, colours, surfaces), [EXPERIENCE.md#Component behaviour] (icon disappears on resolve, highlight in the next frame), [#Voice and Tone] (telegraph juice, reduced motion), [#Performance Budget (UI)], [mockups/key-hud-level.html] state A (icon, halo, bolt glyph; its verb and hold ring belong to 2.2 and 1.23)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Catalogue des menaces] (outlet: 1.2 s, Parry, the lamp goes off, Papa's hair), [#Contrôles et entrées] (vibration on each telegraph, marked on a perfect), [#Timing et latence]
- [Source: _bmad-output/project-context.md] (Time & input judgement, Feedback rendering UI, Performance Rules, Platform › Input capture, Critical Don't-Miss Rules)
- [Source: _bmad-output/implementation-artifacts/1-10-premiere-menace-jugee-en-headless-la-prise-electrique.md] (D4 live level off until now, D7 hold → Firmness, D11 glide on every press, the world shape), [1-9-retours-de-base.md] (feedback table, director, twin rule, placeholder audio), [1-7-deplacer-papa.md] (input mapper, tap marker, hit tester), [deferred-work.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-10-27: Story 1.11 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
