---
baseline_commit: 9dc17d2
---


# Story 1.17: Auto-Target on Keyboard and Gamepad

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.17 « Ciblage automatique au clavier et à la manette ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a keyboard or gamepad player,
I want to parry the most urgent threat in the direction I aim,
so that I play as well as on touch.

**Requirements covered:** FR11 (keyboard and gamepad auto-target the most urgent threat in the aimed direction; Parry = Space or A), FR12 (contextual interaction with Space or A: the `TapObject` command), UX-DR5 (Start/Options and gamepad disconnect pause, with the line), UX-DR7 (menus navigable by gamepad; B goes back, B never pauses in play), UX-DR10 (`target-highlight`), UX-DR11 (one `glyph-chip`, `getLayoutMap()`, pad family). Mockup: `ux-designs/…/mockups/key-hud-level.html`, state B.

GDD › Contrôles (gdd.md L206-219): Parer = « Espace (tap) sur la menace ciblée » / « A »; boire un café, décrocher = « Interaction contextuelle (Espace) » / « A contextuel »; « la menace la plus urgente dans la direction visée est sélectionnée automatiquement ». Architecture › Chaîne d'entrées (L216-221) and L734: « chaque commande vise une `threatId`. Le hit-test et le ciblage automatique la choisissent côté client, et la sim ne devine jamais la cible ».

**Downstream consumers. Design for them; none of them may need to change this story's code beyond adding their own case:**
- 1.19 (coffee) and 1.20 (phone): add what happens when Papa reaches a tapped object (busy 3000 / 5000 ms, fatigue). They reuse `TapObject`, `ObjectTapped`, the level's `objects` list and `pickContextObject`. 1.19 also adds the **touch** tap on the object (its AC: « je tape la machine à café »), with the hit-test priority threat > object > floor.
- 1.21 (silence): adds `TapBaby{t}` and « Espace / A près du bébé ». The context action's order becomes threat > baby > object; leave room for one more branch.
- 1.23 (Firmness): Space / A **held** ≥ `holdMinMs` = Firmness. This story already sends `Release` on keyup / button up, so 1.23 needs no input change.
- 2.2 (verb label): the chip moves beside the verb. Keep the chip's placement in CSS, from the icon's box.
- 2.7 (calibration): « Espace ou A comptent comme un tap ». It reuses the action-key binding and the pad's button edges.
- 5.1 (dodge): B + direction. B must stay free in play (never pause, never parry).

## Precondition (check first, stop if it fails)

Story 1.16 is `done`, with its review fixes committed. When this story was written, 1.16 was in `review` and its code review was running (uncommitted edits to the 1.16 story file and `deferred-work.md`). If `sprint-status.yaml` still says `review`, or `git status` shows anything outside `_bmad-output/`, stop and tell Geo. Run `env | grep VITE_`: the agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap). Then run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note the unit and e2e counts in the Debug Log. If the baseline is red, stop and say so.

## Acceptance Criteria

1. **Auto-target, as a pure function.** `src/client/input/autoTarget.ts` exports `pickAutoTarget(threats, papaXM, papaZM, aim, coneDeg): number | null`. `aim` is a unit floor direction or `null`.
   - Candidates: threats in `telegraph` or `windowOpen` only.
   - Urgency: the window closes at `windowOpenAt + responseWindow.windowMs`. The earliest close wins; ties go to the lower `id`.
   - With an `aim`, only threats inside the cone count: angle between `aim` and (threat − Papa) ≤ `coneDeg / 2`. A threat within `AUTO_TARGET_ON_PAPA_M` of Papa counts in every cone.
   - With an `aim` but nothing in the cone, the most urgent threat overall wins (D3).
   - With no `aim`, the most urgent threat overall wins.
   - No candidate → `null`. It allocates nothing and reads `feel.input.autoTargetConeDeg` (60) through its caller.
2. **Space and A parry the target.** In a live level, at Space `keydown` (not a repeat, no Ctrl / Cmd / Alt) or a pad's A press edge, the client computes the target now (the aim is the direction of the held move keys or the stick) and enqueues `PressThreat{threatId, t}`. `t` = `timeMap.realToSim(event.timeStamp)` for the keyboard, and the pad's stamp for the pad (D5). At Space `keyup` or the A release edge, it enqueues `Release`. The pressed threat gets the pressed highlight, like a tap (`onThreatPressed`). Space's default action (page scroll) is cancelled while the level is live.
3. **The target is shown while aiming.** Each level frame, while the last device used is the keyboard or a pad (D8), the threat `pickAutoTarget` returns gets the `target-highlight` (the existing solid `{colors.alert}` ring and bouncing chevron of `threatMarkers.ts`). The highlight follows the target as it changes. A pressed threat keeps its highlight, as today. On touch or mouse, no auto-target highlight is drawn.
4. **One glyph chip.** Exactly one `glyph-chip` (`src/client/ui/world/glyphChip.ts`, world-anchored, DESIGN.md › glyph-chip) shows beside the targeted threat's icon and moves with the target. It shows only while a target is shown (AC 3), never after a touch or mouse press, never outside a live level, and never under autoplay.
   - Keyboard: the key name of `Space` from `navigator.keyboard.getLayoutMap()` when it names it, else `t('key.space')` (« Espace »). Arrow fallbacks exist for later prompts (D10).
   - Pad: the family's confirm glyph, from `Gamepad.id` (D11): « ✕ » for PlayStation, « A » otherwise.
5. **Contextual action.** In a live level, with no threat in `telegraph` or `windowOpen`, Space or A sends `TapObject{t, objectId}` for the nearest object of the level's `objects` within `feel.input.contextReachM` of Papa (ties to the earlier entry). With none in reach, nothing is sent (a `debug` log). The sim handles `TapObject`: Papa walks to the object's anchor (like `TapFloor`, through `planWalkTo`) and the sim emits `ObjectTapped{t, objectId}`. An unknown `objectId` does nothing.
6. **Objects are data.** `LevelSchema` gains `objects: { id, anchor }[]` (default `[]`). `content/levels/salon_crawler.json` lists `coffee_machine` and `phone` (anchors `coffee_machine`, `phone`, already in the geometry). `content:check` and `createSim` refuse an object whose anchor the geometry lacks, and duplicate object ids, naming the culprit. `feel.input.contextReachM` (1.5) is in `FeelSchema`, `content/feel.json` and `tests/support/testFeel.json`. The generated JSON Schemas are regenerated.
7. **Hot-plug.** A pad plugged in during a level is used from the next frame, with no reload: the stick walks, A parries, the chip shows its family. Nothing caches a `Gamepad` across frames.
8. **Start / Options and the disconnect pause.**
   - In a level, Start / Options (standard button 9) does what Escape does (`escapeAction`): running or resuming → pause; paused → resume through the countdown.
   - When a pad that was connected goes away during a level (`gamepaddisconnected`, or the poll no longer sees it), the game pauses (`requestPause('gamepadDisconnected')`). The pause panel shows « Manette débranchée. Rebranche-la pour reprendre. » (`pause.gamepad_disconnected`). This also happens if the game was already paused for another reason.
   - The line goes when a pad is back. The player can still resume with the keyboard, touch or mouse (D13).
   - B (button 1) never pauses, never parries and never acts in play.
9. **Menus by pad.** While the pause panel shows, the stick (edge-triggered, deadzone with hysteresis) and the D-pad (buttons 12 to 15) move the focus like the arrow keys (`moveFocus`). A activates the focused button (the first if none). B goes back one level, which on the pause panel resumes through the countdown. On the start screen, A or Start starts the game. On the « Oups » screen, A presses « Réessayer ».
10. **Tests and CI.** The unit, e2e and golden tests of § Testing pass. Coverage of `src/sim` stays ≥ 90 %. `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T0 — Precondition** (§ Precondition). Baseline CI, counts in the Debug Log.
- [x] **T1 — Content: objects and reach** (AC 6)
  - [x] `src/content/schemas/level.ts`: `LevelObjectSchema = strictObject({ id: idSchema(…), anchor: idSchema(…) })`; `objects: z.array(LevelObjectSchema).default([])`, with `.describe()` texts in the style of the file. Update the file's header comment (1.17 adds objects).
  - [x] `src/content/schemas/feel.ts` › `InputSchema`: `contextReachM: z.number().positive().describe('Space or A acts on the nearest interactive object within this distance of Papa, in metres (story 1.17).')`.
  - [x] `content/feel.json` and `tests/support/testFeel.json`: `"contextReachM": 1.5` in `input`, after `autoTargetConeDeg`.
  - [x] `content/levels/salon_crawler.json`: `"objects": [{ "id": "coffee_machine", "anchor": "coffee_machine" }, { "id": "phone", "anchor": "phone" }]`.
  - [x] `tools/content/contentChecks.ts`: an object's anchor exists in `<level>.geometry.json`; ids are unique. Name the level, the object and the anchor in the message. Add tests to `tests/content/checkContent.test.ts`.
  - [x] `npm run content:schemas` (commit the regenerated `level.schema.json` and `feel.schema.json`); `npm run content:check` green.
  - [x] `ReachM` already passes the unit-suffix test (1.16 added it). Check it.
- [x] **T2 — Sim: `TapObject` and `ObjectTapped`** (AC 5)
  - [x] `src/sim/commands.ts`: `| { type: 'TapObject'; t: SimMs; objectId: string }` (doc comment: « Walk to this interactive object of the level; what happens there is the object's (stories 1.19, 1.20). An unknown id does nothing. »). Add it to `COMMAND_TYPES`, and to `commandProblem` (`objectId` must be a non-empty string).
  - [x] `src/sim/createSim.ts`: validate the level's objects next to the threats (anchor exists, ids unique: `invariant` with the same wording as `content:check`). Resolve each object's floor point **once**, outside `World` (where the level's threats and defs live today in the step context). Objects have no runtime state yet, so nothing goes into `World` or the snapshot.
  - [x] `src/sim/papa/papaSystem.ts`: `tapObject(world, ctx, objectId)`. Find the object (unknown → return). Plan exactly as `tapFloor` to the anchor's `(xM, zM)`, and reuse `tapFloor`'s body rather than copying it. When a path is planned, push `ObjectTapped{type, t: world.time.sim, objectId}`. Update `runPapa`'s doc comment (it lists the commands it handles).
  - [x] `src/sim/events.ts`: `ObjectTapped` in the union and in `SIM_EVENT_TYPES`, which stays **sorted** (between `NearMiss` and `PapaArrived`). It gets no `feedback.json` entry (no sound yet; 1.19 / 1.20 add theirs).
  - [x] Tests: `commands.test.ts` (shape check), `papaSystem.test.ts` (walks to the coffee machine; `PapaPathPlanned` then `ObjectTapped`; unknown id: no event, no state change; a `TapObject` during a glide cancels it, as `TapFloor` does), `createSim.test.ts` (bad anchor, duplicate id), `replay.test.ts` or `determinism.test.ts` (a journal with `TapObject` replays bit-identical).
- [x] **T3 — `autoTarget.ts` and `contextObject.ts`** (AC 1, 5)
  - [x] `src/client/input/autoTarget.ts`: `pickAutoTarget` (AC 1). Use the squared distance and the dot product. The cone test is `dot ≥ cos(coneDeg/2) · distance` (no `atan2`, no `acos`). Compute the cosine from `coneDeg` on each call: Geo can change the feel. `coneDeg ≥ 360` accepts everything. Add `AUTO_TARGET_ON_PAPA_M` (1e-3) to `shared/constants.ts`.
  - [x] `src/client/input/contextObject.ts`: `pickContextObject(objects, papaXM, papaZM, reachM): string | null`, where `objects` are the resolved `{ id, xM, zM }[]` of the level (built once per level in the client from the level and the geometry, like `threatMarkerEntries`). Distance ≤ `reachM` inclusive, nearest wins, ties to the earlier entry.
  - [x] Unit tests (Node, no DOM). See § Testing.
- [x] **T4 — Keyboard action key** (AC 2)
  - [x] `keyboardInput.ts`: `ACTION_KEY_CODES = ['Space'] as const` and `isActionKey(code)`. `bindKeyboard` gains `bindings.onAction?(phase: 'down' | 'up', timeStampAtReal: number)`. `down` fires on a non-repeat Space with no Ctrl / Cmd / Alt. `up` fires on every Space `keyup`: a key must never stay stuck. Call `preventDefault()` on Space only while `isLive()`. The paused panel's focused button must keep Space for its native activation, so a non-live Space is left alone.
  - [x] Blur and hidden: if Space is down, call `onAction('up', …)` (the existing `clear()` path), so a lost keyup never holds a threat.
  - [x] Tests in `keyboardInput.test.ts`.
- [x] **T5 — Gamepad buttons, family, presence** (AC 2, 7, 8, 9)
  - [x] `gamepadInput.ts`: extend `GamepadLike` with `id?`, `timestamp?`, `buttons?: ArrayLike<{ pressed: boolean }>`. `poll(out)` keeps its stick contract and also fills the same `out` (or a second reused object) with:
    - `isPresent`;
    - `family: 'xbox' | 'playstation'`;
    - the **press and release edges** of buttons 0 (confirm), 1 (back), 9 (start) and 12 to 15 (D-pad), against the previous poll;
    - `stampAtReal` (D5).
  - [x] Buttons are read only on a `mapping === 'standard'` pad. On another pad: the stick only, with one `warn` per pad id.
  - [x] Pad selection stays the same as today (first standard pad, else the first pad with two axes). If the selected pad changes (another index), reset the previous button state so that a held button is not read as a new press.
  - [x] `padFamily(id: string)`: `/054c|playstation|dualshock|dualsense/i` → `'playstation'`, else `'xbox'` (D11).
  - [x] Presence edge: `isPresent` false after true is the disconnect signal (D13). Allocate nothing per poll beyond what `getGamepads()` returns.
  - [x] Tests in `gamepadInput.test.ts`: edges (press, hold, release, re-press), non-standard pad, family ids (a DualSense Chrome id, a Firefox `054c-0ce6-…` id, an Xbox id, an empty id), presence.
- [x] **T6 — Input mapper: action, target, context** (AC 2, 3, 5)
  - [x] `MoveIntent` exposes the current aim: `aimDir(out: FloorDir): boolean`, from the same held keys and stick it already reads. The stick wins outside its deadzone. Same `screenToWorldDir`. **Do not duplicate the conversion.**
  - [x] `InputMapper` gains:
    - `handleAction(phase, timeStampAtReal, device: 'keyboard' | 'gamepad')`;
    - `lastDevice: 'pointer' | 'keyboard' | 'gamepad' | null`, set by `handlePointerDown` (pointer), a move key or Space (keyboard), and a pad edge or stick out of deadzone (gamepad);
    - `targetedThreatId(): number | null`, which recomputes `pickAutoTarget` from the live world (allocation-free; read once per frame by `boot.ts`).
  - [x] `handleAction('down')` when live:
    - target ≠ null → `PressThreat` (D5 stamp), then `press.pressed(KEYBOARD_PRESS_ID | GAMEPAD_PRESS_ID, threatId)` and `onThreatPressed`;
    - else, no threat active → `pickContextObject` → `TapObject`;
    - else (threats active but `pickAutoTarget` found none: cannot happen, D3) → nothing.
  - [x] `handleAction('up')` → `press.released(id)` → `Release`.
  - [x] The two press ids are negative constants in `shared/constants.ts` (`KEYBOARD_PRESS_ID = -1`, `GAMEPAD_PRESS_ID = -2`). Pointer ids are ≥ 0, so they never collide.
  - [x] `pollGamepad()` also turns the A edges into `handleAction`, and reports the pad's presence edge and the other buttons to a callback (`onPadButtons` / `onPadPresence`) that `boot.ts` wires to the UI (T8). The mapper does not know about pause panels.
  - [x] Tests in `inputMapper.test.ts` (see § Testing).
- [x] **T7 — World UI: target highlight and glyph chip** (AC 3, 4)
  - [x] `threatMarkers.update(threats, highlightedId, targetedId)`: the highlight shows when `id === highlightedId || id === targetedId`. The return value keeps its meaning (true when a highlight **became** visible this call; the tap-latency mark reads it). Keep zero allocation.
  - [x] `src/client/ui/world/glyphChip.ts`: `createGlyphChip(scene, doc)` → `{ showAt(entry: ThreatMarkerEntry, text: string): void; hide(): void; readonly isVisible: boolean; dispose() }`.
    - One `CSS2DObject` with a `<span class="pp-glyph-chip pp-type-label">`, moved to the entry's point. Write `textContent` and the position only on change.
    - CSS in `ui.css` (DESIGN.md › glyph-chip: `{colors.paper}` fill, ink outline 3 px, `{rounded.full}`, sticker shadow `0 4px 0`, `{typography.label}`, `white-space: nowrap`, height 32 px as in the mockup). Placed right of the icon box with a `{spacing}` gap, vertically centred: `transform` from `--pp-threat-size`, no hard-coded px where a token exists.
    - `aria-hidden="true"` (the icons are too).
  - [x] `worldUi.ts`: `updateThreats(threats, highlightedId, targetedId)`, the `glyphChip`, and `render` also runs while the chip is visible.
  - [x] Tests: `threatMarkers.test.ts` (targeted highlight, switch of target, pressed + targeted, no allocation), `glyphChip.test.ts` (one element, moves, text on change only), `worldUi.test.ts`.
- [x] **T8 — Key glyphs, pad UI, pause line, menus** (AC 4, 8, 9)
  - [x] `src/client/input/keyGlyphs.ts`:
    - `loadKeyboardLayoutMap(nav)` → `Promise<Result<ReadonlyMap<string, string>, AppError>>`. A missing `navigator.keyboard` or a rejection (iframe, insecure context) is an `err`, and the caller logs **one** `warn`.
    - `keyGlyph(code, layoutMap | null, t)`: the map's value, trimmed and upper-cased, if non-empty; else `Space` → `t('key.space')`, `ArrowUp/Down/Left/Right` → `t('key.arrow_up' …)`, else `code`.
    - `padConfirmGlyph(family, t)` → `t('key.pad_confirm_xbox')` (« A ») or `t('key.pad_confirm_playstation')` (« ✕ »).
    - Tests.
  - [x] `content/strings.fr.json`: `key.arrow_up` « ↑ », `key.arrow_down` « ↓ », `key.arrow_left` « ← », `key.arrow_right` « → », `key.pad_confirm_xbox` « A », `key.pad_confirm_playstation` « ✕ », `key.pad_back_xbox` « B », `key.pad_back_playstation` « ○ ». `key.space` and `pause.gamepad_disconnected` already exist. `content:check` must stay green (string references).
  - [x] `pauseScreen.ts`: `setPadDisconnected(isDisconnected: boolean)` shows or hides a `<p class="pp-panel-note pp-type-body">` with `t('pause.gamepad_disconnected')` under the title. Use `role="status"` so a screen reader announces it. The note never takes focus. Add `activateFocused(): boolean` (A: `click()` on the focused button, else focus the first and return true) and `back(): void` (B: `onResume`).
  - [x] `uiShell.ts`:
    - `setPadDisconnected(flag)`. The flag is kept in the shell, like `isPortrait`, and pushed into the pause screen on each `refresh` and on change.
    - `handlePadButton(button: 'confirm' | 'back' | 'start' | 'up' | 'down' | 'left' | 'right')` routes by app and pause state:
      - level + panel: D-pad and stick → `moveFocus('Arrow…')`, confirm → `activateFocused`, back → `back`, start → `escapeAction`;
      - level + running or resuming: start → `escapeAction`; everything else is the mapper's or nothing (B never pauses);
      - start screen: confirm or start → the start screen's `start`;
      - oops: confirm → retry.
    - Portrait: nothing, like Escape.
  - [x] `startScreen.ts` and `oopsScreen.ts`: expose their action for the shell, e.g. `OverlayScreen.activate?()`. Keep one way in: the start screen's `start()` is the same closure the key and the tap call (audio unlock inside it, D14).
  - [x] Stick as menu arrows: a small pure helper `stickToMenuStep(axes, memory, deadzonePct)` → `'up' | 'down' | 'left' | 'right' | null` on the **edge** of leaving the deadzone (hysteresis `STICK_RELEASE_RATIO`, dominant axis). No auto-repeat (D14). Tests.
- [x] **T9 — `boot.ts` wiring** (AC 2 to 9)
  - [x] `bindKeyboard(…, { onChange, isLive, onAction: (phase, ts) => inputMapper.handleAction(phase, ts, 'keyboard') })`.
  - [x] `onLevelFrame`:
    - `const targetedId = inputMapper.lastDevice === 'keyboard' || inputMapper.lastDevice === 'gamepad' ? inputMapper.targetedThreatId() : null`;
    - `worldUi.updateThreats(world.threats, highlightedThreatId, targetedId)`;
    - chip: `showAt(entry, glyph)` for the target, else `hide()`. `glyph` comes from `lastDevice` and the pad family. Cache the text: recompute only when the device or family changes.
    - Find the entry by index: `world.threats[i]` ↔ `worldUi.threatEntries[i]`. No `find` per frame.
  - [x] The target is `null` when `getActive()` is null: autoplay, paused, outside a level (`isLive()` false). Then no highlight and no chip.
  - [x] Pad presence: in a level, an edge to absent → `shell.setPadDisconnected(true)` and `pause.requestPause('gamepadDisconnected')` (a no-op when already paused). Present again → `setPadDisconnected(false)` and a `log.info`.
  - [x] `window` `gamepaddisconnected` / `gamepadconnected` listeners do the same (idempotent with the poll). Read `event.gamepad` defensively: a test may dispatch a plain `Event`.
  - [x] Pad buttons other than A in play, and every button outside play, go to `shell.handlePadButton`.
  - [x] Outside a level (start, oops), nothing polls today: run a light rAF poller only while `appFsm.state` is `start` or `oops`. Start it on `AppStateChanged` and stop it on leaving. Use the same `readGamepads` and the same `GamepadInput`. Allocate nothing per frame.
  - [x] In a level, `onLevelFrame` runs while paused and during the countdown: `loop.ts:26` says `render` is « called every frame, paused or not », and `onLevelFrame` is called from it (`levelSession.ts:337`). The panel's pad navigation relies on it. `inputMapper.pollGamepad()` returns early when not live (`pollAndRefresh`), so read the buttons and the presence **before** that gate (the stick still only walks when live).
  - [x] `events.on('PauseRequested', () => inputMapper.releaseHeld())` already releases a held Space or A: check with a test.
  - [x] The layout map: `void loadKeyboardLayoutMap(navigator).then(…)` at boot, stored in a `let`. The chip falls back until it resolves.
  - [x] Debug mirror (`isMirrored` only): `ppTarget` = the targeted threat id or `none`, written on change. It goes in the `mirror()` name union.
- [x] **T10 — e2e** (AC 2 to 9): `tests/e2e/autoTarget.spec.ts` (new) and the support changes. See § Testing.
- [x] **T11 — Goldens, docs, close**
  - [x] `npm run golden:update` **deliberately**. Every journal's `feelHash` moves (`input.contextReachM`). `levelHash` moves for the scenarios that use `salon_crawler` (`objects`). Event sequences must not move. Check with `git diff tests/golden` and state it in the Completion Notes, as 1.14 to 1.16 did.
  - [x] `deferred-work.md`:
    - close « Only the first pause reason is kept » (1.4 review) for the gamepad, with a flag, see D13;
    - close « Gamepad Start/Options and disconnect pause, the « Manette débranchée » line » (1.5);
    - mark « A tap on a threat, the baby or an object » (1.7) as « objects: the command and keyboard / gamepad in 1.17; the touch tap on objects in 1.19 / 1.20; the baby in 1.21 »;
    - add § Deferred by this story.
  - [x] Fix the comments that name 1.17: `gamepadInput.ts:27` (« no button here (story 1.17) »), `hitTest.ts:33`, `feel.ts:85`.
  - [x] `_bmad-output/project-context.md`: one bullet under « Time & input judgement » or « Platform »: auto-target is `client/input/autoTarget.ts` (window close time, cone from Papa, fallback to the global most urgent); `TapObject` walks to `level.objects` and emits `ObjectTapped`; a pad disconnect is a UI flag plus a pause.
  - [x] Story file (Dev Agent Record, File List, Change Log), `sprint-status.yaml` → `review`. One commit `Story 1.17 : ciblage automatique au clavier et à la manette`, in French.

## Dev Notes

### What exists today (stories 1.7 to 1.16)

- **`inputMapper.ts`** (`src/client/input/`) is the only place that turns input into `SimCommand`s. Its gate: `isLive()` = app `level`, pause `running`, a level active (`getActive()` returns `null` under autoplay, D11 of 1.13). `handlePointerDown` hit-tests threats (`pickThreat`, screen space, `touchRadiusPx`), else the floor. A threat press:
  1. stamps `t = timeMap.realToSim(asRealMs(sample.timeStamp))`;
  2. enqueues `PressThreat`;
  3. calls `press.pressed(pointerId, threatId)` and `onThreatPressed(threatId)`.

  `handlePointerUp` → `Release` if this pointer pressed. `releaseHeld()` on pause sends `Release` stamped `max(heldPressAt, simNow)`. Copy these paths, do not fork them.
- **`threatPress.ts`**: one press remembered at a time, keyed by a pointer id. `Release` names no threat and ends every press made before it (D6 of 1.11). A keyboard press replaces a pointer press and the other way round: that is the existing rule, keep it.
- **`moveIntent.ts` / `moveDirection.ts`**: held keys (`MOVE_KEY_CODES`, by `KeyboardEvent.code`: W/A/S/D and arrows) and the stick (deadzone `stickDeadzonePct`, `stickAngleStepDeg` rounding, hysteresis `STICK_RELEASE_RATIO`, `STICK_TURN_HYSTERESIS_STEPS`) → one world direction through `screenToWorldDir(camera, …)`. **The aim of this story is that same direction.** Expose it (`aimDir`), do not recompute it differently.
- **`gamepadInput.ts`**: reads only axes 0 and 1 of the first standard pad (else the first pad with two axes). No buttons, no `id`, no presence. Its own comment defers buttons and the disconnect pause to this story.
- **`boot.ts`** wires everything:
  - `readGamepads()`, with a `warn` once when the API is missing or throws (`Gamepad API is secure-context only`, deferred 1.7);
  - `highlightedThreatId`, set by `onThreatPressed` and cleared when that threat stops being active;
  - `onLevelFrame` calls `inputMapper.pollGamepad()`, then `worldUi.updateThreats(world.threats, highlightedThreatId)`, then `worldUi.render(camera)`;
  - `events.on('PauseRequested', () => inputMapper.releaseHeld())`.
- **`threatMarkers.ts`** already draws the `target-highlight` (`.pp-threat-highlight` ring plus `.pp-threat-chevron`) for the **pressed** threat. Its doc and DESIGN.md say the same highlight serves the auto-target (« on the auto-targeted or pressed threat (stories 1.11 and 1.17) »). Reuse it. Do not draw a second highlight style.
- **`pauseController.ts`**: `requestPause(reason)` returns early when already paused (« first reason wins »). `PauseReason` already has `'gamepadDisconnected'`. **`uiShell.ts`**: Escape → `escapeAction` (D14 of 1.5); arrow keys → `pauseScreen.moveFocus(code)`. **`keys.ts`**: `escapeAction`, `nextFocusIndex`, `isStartKey` (any key but Escape, Tab, F-keys… starts, **Space included**). **`pressButton.ts`**: a `click` with `detail === 0` activates (keyboard / AT), so `button.click()` from the pad goes through the same path.
- **Strings already there:** `key.space` « Espace », `pause.gamepad_disconnected` « Manette débranchée. Rebranche-la pour reprendre. ».
- **`World.threats[i]`**: `state`, `windowOpenAt`, `responseWindow: EffectiveWindow | null` (frozen at telegraph; `windowMs` is the scaled length), `xM`, `zM` (the anchor on the floor). `worldUi.threatEntries[i]` is the icon point of `world.threats[i]` (same order, D8 of 1.11). **`World.papa.xM / zM`** is Papa's position.
- **The geometry already has** `ANCHOR_coffee_machine` (-3.6, 1.05, -2) and `ANCHOR_phone` (-1.3, 0.65, -1.2) (`content/levels/salon_crawler.geometry.json`). No level lists interactive objects, and no `TapObject` command exists yet (architecture L221 names it).
- **e2e support** (`tests/e2e/support/game.ts`):
  - `stubGamepad(page)` replaces `navigator.getGamepads` with one pad `{ connected, axes }`: no `buttons`, no `id`, no `mapping`. Extend it, see § Testing;
  - `pressCode(page, type, key, code)` dispatches a `KeyboardEvent` on `window`.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | **The aim is the walk direction**: the held move keys or the stick, in world axes through the camera (`MoveIntent.aimDir`). The cone's apex is Papa's sim position (`world.papa.xM/zM`, not interpolated). Half-angle = `coneDeg / 2`. | GDD L219 « dans la direction visée »; EXPERIENCE Flow 2 step 4 « Aiming with the movement keys re-targets ». One direction for walking and aiming means the player has nothing new to learn. |
| D2 | **Urgency = `windowOpenAt + responseWindow.windowMs`** (sim ms), the earliest wins, ties to the lower id. A threat in `telegraph` already has its `responseWindow` (frozen at telegraph); if it is `null` there (it should not be), skip the threat and log one `warn` per threat id. | The epic's « la menace dont la fenêtre se ferme le plus tôt ». Tolerance and buffer are the same for every threat, so they do not change the order. Fatigue and instinct (1.19, 2.9) are already in `windowMs`. |
| D3 | **Aim given, nothing in the cone → the globally most urgent threat**, never « no target ». | Pressing Space while walking away from the only threat must still parry it: an input that does nothing feels broken, and touch has no such dead zone. **Open point for Geo** (one line to change if he wants « nothing »). |
| D4 | **The target is recomputed at the press**, from the world at that moment, with the same function the frame used. It is not « the one shown last frame ». | Same world, same function: they agree unless the world stepped in between, and then the press is the truth (it is what the sim judges). No state to keep in sync. |
| D5 | **Stamps.** Keyboard: `event.timeStamp`. Pad: `Gamepad.timestamp` when it is finite, `> 0`, `≤ now` and `≥ now − PAD_STAMP_MAX_AGE_MS` (100, `shared/constants.ts`); else `now` (`nowAtReal()`). | Gamepads are polled once per frame. The pad's own timestamp (same base as `performance.now()` in Chromium) recovers up to a frame. A bogus value must not stamp a press in the past (an early gag) or the future. Calibration (2.7) absorbs what is left. |
| D6 | **Context action only when no threat is active** (none in `telegraph` / `windowOpen`). Nearest object within `contextReachM` of Papa (floor distance to the anchor). | EXPERIENCE › Input Schemes: « Space near the object, with no threat active ». A threat must never lose its parry to a coffee. |
| D7 | **`TapObject` = walk to the object + `ObjectTapped`.** The object's effect (busy, fatigue) is 1.19 / 1.20. The level lists `objects: {id, anchor}`. `objectId` is the object's `id`. The sim keeps no object state in `World` yet. **The touch tap on an object is not in this story** (1.19's AC). | The architecture names the command `TapObject{objectId, t}` (L221). Walking there is what 1.19 and 1.20 both start with (« papa y va »), so 1.19 only adds the arrival. Keeping touch out keeps this story's scope on keyboard and gamepad, and 1.19 owns the « threat > object > floor » hit-test. |
| D8 | **`lastDevice`** decides whether the auto-target UI shows. `pointerdown` (any pointer type) → `'pointer'`. A move key or Space down → `'keyboard'`. A pad button edge or the stick leaving its deadzone → `'gamepad'`. A `null` device (nothing pressed yet in this page) shows nothing. | UX-DR11 « Aucune invite au tactile »; EXPERIENCE: « Keyboard and gamepad only, never on touch ». A laptop with a touchscreen switches back and forth, so it is the last device, not a capability. |
| D9 | **One chip object, moved.** `glyphChip.ts` owns one `CSS2DObject`. It is not one chip per marker. It sits right of the icon until 2.2 brings the verb, then it goes beside the verb. | UX-DR11 « Un seul `glyph-chip` »; architecture L521 lists `glyphChip.ts`. One object makes « exactly one » true by construction. |
| D10 | **`getLayoutMap()` never names Space.** It maps *writing-system* keys only (letters, digits, punctuation; UI Events KeyboardEvent code spec), so `get('Space')` is `undefined` and the chip falls back to « Espace » **in every browser**. Implement the lookup anyway (generic `keyGlyph(code, map, t)`): it is the AC, and the letter keys of later prompts (E for breath, 4.9; remapping) need it. It is Chromium-only (Chrome / Edge; not Safari, not Firefox), secure-context only, top-level only, async. Load it once at boot. | Matches the UX fallback text (EXPERIENCE L165, L567) and keeps the chip identical across browsers today. Tell Geo (open point), since the AC reads as if the chip would show a localised name for Space. |
| D11 | **Pad family from `Gamepad.id`**: `/054c|playstation|dualshock|dualsense/i` → PlayStation (`054c` is Sony's USB vendor id: Chrome writes `Vendor: 054c`, Firefox `054c-0ce6-…`), else Xbox-style. Recomputed when the selected pad changes. | Architecture L218 « déduite de `Gamepad.id` », Xbox by default. Nintendo pads read as Xbox (A); good enough for the prototype. |
| D12 | **Standard mapping only for buttons**: 0 = A / ✕ (confirm), 1 = B / ○ (back), 9 = Start / Options, 12 to 15 = D-pad up, down, left, right. A non-standard pad keeps its stick (as today) and has no buttons, with one `warn`. **One pad** (the selected one); a second pad is ignored. | W3C Gamepad « standard » layout. Guessing button indices on unknown pads would map A to anything. |
| D13 | **The disconnect is a UI flag plus a pause, not a set of pause reasons.** `shell.isPadDisconnected` is set on a presence edge to absent during `level` and cleared when a pad is present. While it is set, the panel shows the line, whatever paused the game. `requestPause('gamepadDisconnected')` pauses a running or resuming game and is a no-op when already paused. **Resume is not blocked**: keyboard, mouse or touch can resume without the pad. | Same pattern as portrait (D5 of 1.5), which avoided « first reason wins » without redesigning `pauseController`. EXPERIENCE › Pause: « Stays paused and shows the disconnect line. Once reconnected, the pad navigates the panel »; L282 « touch and mouse still work ». Blocking resume would trap a player whose pad battery died. |
| D14 | **Pad in menus**: stick and D-pad are edge-triggered (one step per push, no auto-repeat), A = `click()` on the focused button, B = back, Start = Escape. On the start screen, A or Start calls the start screen's own `start()`, **with its synchronous `audio.unlock()`**. Browsers do not count a pad button as a user activation (HTML › activation-triggering input events: keydown, pointerdown / pointerup… not gamepad), so a pad-only start may stay **silent** until a key or a tap. The existing unlock path already logs a `warn` if the context stays suspended. Do not add a workaround. | UX-DR7, EXPERIENCE › Input Schemes. Two panel buttons do not need repeat. Audio from a pad-only start is a browser limit. List it in § Deferred and as an open point. |
| D15 | **B in play is nothing.** No pause, no parry, no context action. | UX-DR5 / UX-DR7: « B ne met jamais en pause en jeu, puisque B + direction sert à esquiver (story 5.1) ». |

### Auto-target sketch (`autoTarget.ts`)

```ts
/** Unit floor direction, or null for « no direction ». */
export function pickAutoTarget(
  threats: readonly Readonly<ThreatInstance>[],
  papaXM: number,
  papaZM: number,
  aim: Readonly<FloorDir> | null,
  coneDeg: number,
): number | null {
  const cosHalf = coneDeg >= 360 ? -1 : Math.cos((coneDeg * Math.PI) / 360);
  let bestId: number | null = null; let bestCloseAt = Infinity;      // in the cone
  let anyId: number | null = null;  let anyCloseAt = Infinity;       // global fallback (D3)
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i]!;
    if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
    if (threat.responseWindow === null) continue;                    // D2 (warn once, caller side or here)
    const closeAt = threat.windowOpenAt + threat.responseWindow.windowMs;
    if (closeAt < anyCloseAt || (closeAt === anyCloseAt && threat.id < (anyId as number))) { … }
    if (aim === null) continue;
    const dx = threat.xM - papaXM; const dz = threat.zM - papaZM;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const isInCone = distance <= AUTO_TARGET_ON_PAPA_M || dx * aim.x + dz * aim.z >= cosHalf * distance;
    if (isInCone && (closeAt < bestCloseAt || …)) { … }
  }
  return aim === null ? anyId : (bestId ?? anyId);
}
```

Use the real code style (no `!`; the repo casts `threats[i] as …`). The tie-break compares ids only when the close times are equal. Write it so that `bestId === null` is handled without `as number` tricks.

### Feel and content

```jsonc
// content/feel.json › input (and tests/support/testFeel.json)
"autoTargetConeDeg": 60,
"contextReachM": 1.5,

// content/levels/salon_crawler.json
"objects": [
  { "id": "coffee_machine", "anchor": "coffee_machine" },
  { "id": "phone", "anchor": "phone" }
]
```

1.5 m is a guess (Papa's radius is 0.25 m; the coffee machine sits on a counter against the wall, so Papa's nearest open cell is about 0.5 to 1 m from its anchor). Check by hand that Papa can stand within reach of both objects (nearest open cell to each anchor, from `ctx.nav.papa`), and note the two distances in the Debug Log. If one is out of reach, raise `contextReachM` (do not move an anchor) and say so.

### `glyph-chip` look (DESIGN.md L236-241, L538; mockup L83)

- `{colors.paper}` fill, `3px solid {colors.ink}` outline, `{rounded.full}` (DESIGN.md L488 « glyph chips »; the mockup's `--r-sm` is overruled by DESIGN.md, which wins over mockups), the sticker shadow `0 4px 0 {colors.ink}`, `{typography.label}` (`pp-type-label`: Nunito 800 16 px / 1.2) in `{colors.ink}`, height 32 px, horizontal padding `{spacing.s3}` (or the token the HUD pills use), `white-space: nowrap`.
- Never truncated; tolerate +30 % (UX-DR2): « Espace » is the longest label today.
- No animation: it moves with its target and never blinks. Reduced motion changes nothing for it.

### Testing

- **`autoTarget.test.ts`** (Node, hand-built `ThreatInstance`s; derive the cone from `createTestContent().feel.input.autoTargetConeDeg`):
  - idle, resolved and gagged threats are never picked; `responseWindow === null` is skipped;
  - earliest close wins over the nearest; `windowMs` matters (two equal `windowOpenAt`, different `windowMs`); ties go to the lower id;
  - aim inside the cone, at exactly ± half-angle (inclusive), just outside;
  - aim with nothing in the cone → global; no aim → global; no candidate → null;
  - a threat on Papa (distance 0) is in every cone;
  - `coneDeg` 360 accepts behind; a very small cone;
  - the four diagonal aims (unit vectors).
  - Allocation is checked by review: **no arrays, objects or closures inside** `pickAutoTarget` (a test cannot measure it reliably).
- **`contextObject.test.ts`**: nearest within reach, reach inclusive, none in reach, ties to the earlier entry, empty list.
- **`keyboardInput.test.ts`**: Space down / up through `onAction`, repeat ignored, Ctrl / Cmd / Alt chords ignored on down but **not** on up, `preventDefault` only when live, blur and hidden release a held Space, Space does not change the held move keys.
- **`gamepadInput.test.ts`**: T5 list. Fake pads are plain objects (`{ connected, axes, buttons, id, mapping, timestamp }`), no DOM.
- **`inputMapper.test.ts`** (the existing harness and doubles):
  - Space with one telegraphed threat → `PressThreat{threatId}` with `t` from the time map, then keyup → `Release`;
  - two threats, aim toward the later-closing one inside the cone → that one; aim away from both → the earlier-closing one (D3);
  - not live (paused, autoplay `getActive() → null`, countdown) → nothing;
  - no threat active and Papa within reach of `coffee_machine` → `TapObject{objectId: 'coffee_machine'}`; out of reach → nothing;
  - pad A edge → `PressThreat` stamped with `pad.timestamp` (D5), and with `now` when the pad timestamp is stale or in the future;
  - B and Start never reach the sim;
  - `lastDevice` transitions;
  - a pause while Space is held → `releaseHeld` sends `Release` once, and the later keyup sends nothing.
- **`threatMarkers.test.ts`, `glyphChip.test.ts`, `worldUi.test.ts`, `keyGlyphs.test.ts`, `pauseScreen.test.ts`** (the note shows and hides; `activateFocused`; `back`), **`uiShell.test.ts`** (pad routing table: every app × pause state × button, and portrait ignores all of it), the `stickToMenuStep` tests.
- **Sim** (T2): commands, `papaSystem`, `createSim`, replay. `src/sim` coverage ≥ 90 %.
- **Content:** `checkContent.test.ts` (bad object anchor, duplicate id), `feelSchema.test.ts` (`contextReachM` required and positive), the level schema test if one exists.
- **e2e `tests/e2e/autoTarget.spec.ts`** (new; `__PP__` + `freeze` / `advance`, `collectProblems`, no `waitForTimeout`, no screenshot):
  - **Keyboard parry:** load `salon_crawler`, `advance` until the outlet is `telegraph`, then press Space with `page.keyboard.down('Space')` / `up`. The threat resolves (`ResponseResolved` in `__PP__.events()`), and `data-pp-target` named it before the press.
  - **Chip:** after a key press, `.pp-glyph-chip` is visible with text « Espace » (Playwright's Chromium has `navigator.keyboard`, but D10 says Space is never in the map). After a `page.touchscreen.tap` on the floor, the chip is hidden.
  - **Re-target:** two threats active (use `__PP__.send` + `advance` to telegraph two, or a test level). Hold an arrow toward one, then the other: `data-pp-target` follows.
  - **Context:** with `?threats=off`, walk Papa next to the coffee machine (`__PP__.send({type:'TapFloor',…})` to a point within reach), press Space → `ObjectTapped{objectId:'coffee_machine'}` in the events.
  - **Pad:** extend `stubGamepad` (below). Plug a pad mid-level → A parries; the chip shows « A »; with a DualSense id it shows « ✕ ».
  - **Disconnect:** unplug → `data-pp-state="paused"`, the panel shows the line. Plug back → the line goes. Pad down + A → « Recommencer » is pressed (`data-pp-seed` restarts, or the app goes to `loading`). B on the panel → countdown.
  - **Start:** Start pauses; Start again resumes through the countdown. B in play does nothing (`data-pp-state` stays `running`).
  - **Start screen:** with a stubbed pad, A starts the level.
  - WebKit runs it too (the pad is a stub; `navigator.keyboard` is absent there, so the chip uses the fallback: same text).
- **`stubGamepad` extension:** `{ connected, axes, buttons: [{pressed}…×17], id, mapping: 'standard', timestamp: performance.now(), index: 0 }`. Add `pressButton(index)` / `releaseButton(index)` and `setId(id)`. `setPadPresent(false)` also dispatches `new Event('gamepaddisconnected')` on `window` (`GamepadEvent` needs a real pad). Keep `setStick` and `setPadPresent` backwards compatible.
- **Mutation checks** (Debug Log): break the cone test (`>=` → `<=`), then the D6 « no threat active » guard, then the `isLive` gate of `handleAction`. Each must fail a test. Restore.

### Regression traps

- **`tests/e2e/move.spec.ts:297` « … or when the pad is gone » now pauses the game** when it unplugs the pad (AC 8). Update it: after `setPadPresent(false)`, expect `data-pp-state="paused"` and the line. Then resume with Escape and expect Papa `idle` (the resync sends `MoveStop`). Keep the stick-walk part.
- **Space on the start screen** already starts the game (`isStartKey`). In a level the new Space binding must not fire for that same keydown: the level is not live yet (loading, countdown). Check that the first Space keyup after the countdown sends nothing (no press is held).
- **Space on the pause panel** activates the focused button natively (`click`, detail 0). The action binding must not `preventDefault` it (not live) and must not send anything.
- **`threatMarkers.update` signature change**: update every caller (`worldUi.ts`, `boot.ts`, tests).
- **The tap-latency mark** (`highlightRendered`, story 1.11 `tapLatency.spec.ts`) reads `updateThreats`'s return value. An auto-target highlight already visible must not swallow the « became visible » of a pressed one on the same threat: when the pressed threat is also the target, the ring is already up. Make sure `tapLatency.spec.ts` (touch: no auto-target) still passes. Under touch, `targetedId` is always null (D8).
- **Autoplay screenshots** (`autoplay.spec.ts`, darwin + linux references): autoplay has `getActive() → null`, so no target, no chip, and the references must not change. If they do, something leaks: fix it, do not refresh them.
- **Golden hashes** move (`feelHash` everywhere, `levelHash` with `salon_crawler`); event sequences must not move (T11).
- **`SIM_EVENT_TYPES` stays sorted**; `content:check` validates `feedback.json` event names against it. **`COMMAND_TYPES`**: journals from files are checked against it (`commandProblem`, `replayJournal`). Add a malformed-`TapObject` case.
- **Bots** need no change: they never send `TapObject` yet. `threatTiming` and `responseOf` do not know about input devices.
- **`hitTest.ts`** needs no behaviour change. Only its comment changes (objects come with 1.19 / 1.20 for touch).
- **`getGamepads()` allocates** a new array per call. It is accepted once per frame (1.7 Dev Notes). Do not add a second call per frame: the menu poller runs **only** outside `level`, and `onLevelFrame` keeps its single call.
- **`loop.ts`, `testApi.ts`, `pauseController.ts`, `biome.json`, `tests/architecture/**`** need **no** change. If one seems needed, stop and write why in the Debug Log first.

### Previous story intelligence (1.11 to 1.16 and their reviews)

- **Review hunts:**
  - comments that disagree with the code (fix every comment that names 1.17);
  - edge values (cone exactly at the half-angle, reach exactly at the limit, a threat on Papa, a pad timestamp of 0);
  - allocation in per-frame paths (`pickAutoTarget`, chip, marker update);
  - every client fallback logs a `warn` (no layout map, non-standard pad, missing `responseWindow`), once, not per frame.
- **Patterns to copy:**
  - pure functions with injected inputs, tested in Node (`moveDirection.ts`, `keys.ts`, `threatPress.ts`);
  - a data list plus a completeness proof for new unions (`COMMAND_TYPES`, `SIM_EVENT_TYPES`);
  - frozen test fixtures for live content (`testFeel.json`);
  - by-hand checks in the Debug Log;
  - one implementation commit in French that also touches the story file, `sprint-status.yaml`, `deferred-work.md` and `project-context.md`.
- **1.13:** `__PP__` drives e2e (`freeze`, `advance`, `send`, `events`). Never let the game play in real time to « reach » a state. `?threats=off` gives a quiet room. The `data-pp-*` mirrors are written on change only.
- **1.13 review:** `boot.ts` listener arrays are not removal-safe; do not unsubscribe inside a dispatch.
- **1.11:** the pressed highlight must be drawn the frame after the press (NFR2, ≤ 50 ms). Keyboard and pad presses follow the same path (`onThreatPressed`), so they get it for free.
- **1.16:** three threats can be active together now (`threat_trio`), which is what makes the cone meaningful. `world.threats[i]` order = level order (outlet, stairs, coffee table).

### Project Structure Notes

- New files:
  - `src/client/input/autoTarget.ts` and its test (architecture L511 lists `autoTarget.ts`);
  - `src/client/input/contextObject.ts`, `keyGlyphs.ts` and their tests;
  - `src/client/ui/world/glyphChip.ts` and its test (architecture L521);
  - `tests/e2e/autoTarget.spec.ts`.
- Changed: `src/sim/commands.ts`, `events.ts`, `createSim.ts`, `papa/papaSystem.ts` (+ tests); `src/content/schemas/level.ts`, `feel.ts`; `content/feel.json`, `content/levels/salon_crawler.json`, `content/strings.fr.json`, `content/_schemas/*` (generated); `tools/content/contentChecks.ts`; `src/client/input/{inputMapper,keyboardInput,gamepadInput,moveIntent}.ts`; `src/client/ui/uiShell.ts` (and `keys.ts` only if `stickToMenuStep` lives there), `ui/screens/{pauseScreen,startScreen,oopsScreen}.ts`, `ui/world/{threatMarkers,worldUi}.ts`, `ui/styles/ui.css`; `src/client/boot.ts`; `src/shared/constants.ts`; `tests/support/testFeel.json`, `tests/e2e/support/game.ts`, `tests/e2e/move.spec.ts`; goldens (regenerated).
- Constants (`shared/constants.ts`, `UPPER_SNAKE`): `AUTO_TARGET_ON_PAPA_M`, `KEYBOARD_PRESS_ID`, `GAMEPAD_PRESS_ID`, `PAD_STAMP_MAX_AGE_MS`, the standard button indices (`PAD_BUTTON_CONFIRM = 0`, `PAD_BUTTON_BACK = 1`, `PAD_BUTTON_START = 9`, `PAD_BUTTON_DPAD_UP = 12` … `15`). These are not tuning values: they are layout and implementation constants, not feel.
- `client` may read `navigator.keyboard` and `navigator.getGamepads` (as `boot.ts` already does); they are not `Platform` concerns (that list is storage, haptics, lifecycle, capabilities). Inject them into pure modules; never call them inside a pure function.

### Project Context Rules

- The sim never guesses a target: every `PressThreat` carries a `threatId` chosen by the client (project-context › Time & input judgement). `TapObject` carries its `objectId` likewise.
- Judge on the press timestamp, in sim time through `timeMap.realToSim` (ADR-003). Never stamp at `step()` time.
- Bind keys by `KeyboardEvent.code`, never `event.key` (the chip is the only place a localised name appears, and it comes from the layout map).
- No hard-coded tuning: `autoTargetConeDeg` and `contextReachM` live in `feel.json`. No UI string in code: everything through `t(key)`. No colour or size in code where a token exists.
- Zero allocation in the rAF path (`pickAutoTarget`, chip, marker update, menu poller).
- I/O returns `Result` (`loadKeyboardLayoutMap`); every fallback logs a `warn`; no silent `catch`.
- Names: units as suffixes (`contextReachM`, `stampAtReal`, `coneDeg`); `…AtReal` for real time; booleans `is` / `has`; factories `create<Name>`; events past tense (`ObjectTapped`), commands imperative (`TapObject`).
- Client imports the sim only through `@sim` (`ThreatInstance`, `SimCommand`).

### Deferred by this story (add to `deferred-work.md`)

- **The touch tap on an interactive object** (hit-test threat > object > floor, a generous radius around the object's anchor): story 1.19 (coffee), reused by 1.20.
- **What happens on arrival at an object** (`ObjectTapped` has no consumer): 1.19 / 1.20.
- **A pad-only start can be silent** (D14): browsers do not count a gamepad button as a user activation, so `audio.unlock()` from A on the start screen may leave the context suspended until a key or a tap. Device pass (1.24), or a « press a key » hint if playtesters hit it.
- **D-pad as movement in play, and analog stick speed** (1.7's item): not asked; the left stick walks.
- **Menu auto-repeat on a held stick or D-pad**: not needed for two buttons; the Fridge (3.11) and Settings (2.8) may want it.
- **Several pads**: only the selected one counts. A second pad's buttons are ignored.
- **The chip shows « Espace » everywhere** (D10): `getLayoutMap()` never names Space. The lookup is ready for letter keys (4.9's E, remapping).
- **Nintendo pads read as Xbox** (D11): « A » is printed where the Switch's A is on the right. Fine for the prototype.

### Open points for Geo (do not block the dev)

1. **D3:** with a direction held and no threat in the cone, Space parries the most urgent threat anyway. The alternative is « nothing happens ». Which do you prefer once you've played it?
2. **D10:** the chip will always say « Espace ». The layout map cannot name the space bar; it names letter keys only.
3. **`contextReachM` 1.5 m and `autoTargetConeDeg` 60°:** starting values, both in `feel.json`.
4. **D13:** after a disconnect, the game can be resumed with the keyboard or touch while the line is shown. Fine, or should the pad be required?
5. **D14:** starting from the start screen with only a pad may leave the game silent (browser rule).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.17 : Ciblage automatique au clavier et à la manette], and around it [#Story 1.19] (coffee, touch tap on the object), [#Story 1.20] (phone, `TapObject`), [#Story 1.21] (`TapBaby`, priority threat > baby > object > floor), [#Story 1.23] (Firmness on hold), [#Story 2.2] (verb label), [#Story 2.7] (Space / A in calibration), [#Story 5.1] (B + direction = dodge), [#Exigences › FR10, FR11, FR12, FR14], [#UX-DR5, UX-DR7, UX-DR10, UX-DR11]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L206-219] (controls table, auto-target)
- [Source: _bmad-output/planning-artifacts/game-architecture.md L216-221] (input chain, `TapObject{objectId, t}`, pad family from `Gamepad.id`, `gamepaddisconnected` pauses), [L511, L521] (file tree: `autoTarget.ts`, `glyphChip.ts`, `targetHighlight.ts`), [L734] (the client chooses the target)
- [Source: ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L236-248, L488, L538-539] (glyph-chip, target-highlight), [EXPERIENCE.md L206, L216-217, L282, L298, L314, L360-404] (states, Input Schemes, prompts, targeting), [L555-586] (Flows 2 and 3), [L165, L170] (strings), [mockups/key-hud-level.html state B, L83, L208-249]
- [Source: _bmad-output/project-context.md] › Time & input judgement, Platform & Build Rules (Input capture), Performance Rules
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] › 1.4 review « Only the first pause reason is kept », 1.5 « Gamepad Start/Options and disconnect pause », 1.7 « A tap on a threat, the baby or an object », « The Gamepad API is secure-context only », 1.13 review « Autoplay blocks input through `getActive() → null` »
- [Source: _bmad-output/implementation-artifacts/1-5-…md D5, D14] (portrait flag, Escape table), [1-7-…md] (stick, held keys, `screenToWorldDir`), [1-11-…md D6, D7, D8] (one press, screen-space hit-test, highlight next frame), [1-16-…md] (three threats, « 1.17 picks by `windowOpenAt` »)
- W3C Gamepad › Standard Gamepad layout (button indices); UI Events KeyboardEvent code values › writing-system keys (what `getLayoutMap()` covers); WICG Keyboard Map (`navigator.keyboard.getLayoutMap()`, Chromium-only, secure context); HTML › user activation (activation-triggering input events do not include gamepads).

## Dev Agent Record

### Agent Model Used

AI developer agent (model not recorded in the repository).

### Debug Log References

- **T0 baseline** (before the first edit, `(unset VITE_DEBUG_ALLOWED; npm run ci)`): green, **2399 unit tests** (161 files) and **180 e2e** (chromium + webkit). `env | grep VITE_` showed `VITE_DEBUG_ALLOWED=false`, unset for dev / e2e / ci as the CLAUDE.md trap says.
- **Final CI** (same command): green, **2565 unit tests** (166 files, +166), **198 e2e** (+18, `autoTarget.spec.ts` on both browsers), `src/sim` coverage 97.91 % statements / 96.67 % branches (threshold 90 %). The autoplay screenshot references did not move (`git status tests/e2e/__screenshots__` is clean).
- **`contextReachM` by hand** (nearest open cell of Papa's grid to each anchor, `papaRadiusM` clearance): `coffee_machine` anchor (-3.6, -2) → cell (-2.875, -2.125), **0.736 m**; `phone` anchor (-1.3, -1.2) → cell (-1.875, -1.125), **0.580 m**. Both are inside the 1.5 m reach, so no change to the value. The e2e also asserts Papa ends within `contextReachM` of the coffee machine after a `TapFloor` on its anchor.
- **Mutation checks** (each restored afterwards):
  1. cone test `>=` → `<=` in `pickAutoTarget`: 19 tests fail (`autoTarget.test.ts`, `inputMapper.test.ts`);
  2. D6 guard removed (the context action also runs after a threat press): « prefers a threat to an object » fails;
  3. `isLive()` gate removed from `handleAction('down')`: 4 `inputMapper` tests fail (paused, countdown, not in a level, no level).
- **Story text that was wrong**: T1 says « `ReachM` already passes the unit-suffix test (1.16 added it) ». It did not: `feelSchema.test.ts` rejected `contextReachM`. `ReachM` is now an accepted suffix there (a length in metres, like `RadiusM` and `DistM`).
- **The minimal director activates one threat at a time** (`directorSystem.ts`: no new target while one is `telegraph` / `windowOpen`), so the e2e « re-target » of § Testing cannot have two threats active on the live level. The cone's choice between threats is proved by `autoTarget.test.ts` and `inputMapper.test.ts` (two and three threats); the e2e proves the D3 fallback with the single outlet (target kept whatever key is held, Space parries walking away). The multi-threat e2e is deferred to the wave director (1.18), see `deferred-work.md`.
- **Float edge of the cone**: a threat exactly at the half-angle (e.g. (1, 1) with a 90° cone) failed the `>=` by one ulp (`cos(45°) · √2 = 1.0000000000000002`). The AC says inclusive, so the test carries `AUTO_TARGET_EDGE_EPSILON_M` (1e-9 m, `shared/constants.ts`).
- **Golden journals**: both `feelHash` (`input.contextReachM`) **and** `levelHash` moved in all six journals, not only the `salon_crawler` ones: the level object now has an `objects` key (`[]` in the test levels), which changes the hash of any level. `git diff tests/golden` shows nothing but those two lines per file; the recorded events and world hashes did not move.
- Playwright (chromium and webkit here) logs one `[input] navigator.keyboard.getLayoutMap() is not available here` warn per page load: the single fallback warn the story asks for. It is not in `OWN_WARNINGS`, so it does not fail `collectProblems`.

### Implementation Plan

- **Content / sim (T1, T2):** `LevelSchema.objects` (default `[]`), `feel.input.contextReachM`; `content:check` and `createSim` refuse an object whose anchor is missing and duplicate ids, naming level, object and anchor. `SimLevel.objects` holds each object's floor point, resolved once outside `World`. `TapObject` reuses `tapFloor` (now returning whether a path was planned) and emits `ObjectTapped` after the plan; an unknown id does nothing.
- **Targeting (T3):** `pickAutoTarget` (dot product against the cosine of the half-angle, recomputed per call, one pass, no allocation, global fallback kept in the same loop) and `pickContextObject`; `contextObjectsOf` resolves the level's objects once per level (like `threatMarkerEntries`) and `levelSession` hands them to `onLevelReady`.
- **Input (T4 to T6):** `bindKeyboard` gets `onAction`; the gamepad input now fills a reused `PadState` (presence, family, press and release edges of buttons 0, 1, 9, 12 to 15, pad stamp per D5) and keeps its stick contract (second argument optional). `MoveIntent.aimDir` returns the direction `update` last computed (no second conversion). The mapper owns `handleAction`, `lastDevice`, `targetedThreatId`, and now reads the pad every frame, live or not (`readPad`); outside play, A and every other edge go to `onPadButton`, and the stick becomes one menu step per push (`stickToMenuStep`).
- **UI (T7, T8):** `threatMarkers.update(…, targetedId)`, `createGlyphChip` (one `CSS2DObject`, text and position written on change only), CSS from the tokens. `padAction` (in `keys.ts`) is the pure routing table of a pad button by overlay, app and pause state; `uiShell.handlePadButton` executes it. `pauseScreen` gets `setPadDisconnected`, `activateFocused`, `back`; the start and « Oups » screens expose `activate`.
- **Wiring (T9):** `boot.ts` binds Space, wires the presence callback (`level` only: `setPadDisconnected(true)` + `requestPause('gamepadDisconnected')`), the chip (text cached per device / family / layout map), the `ppTarget` mirror, a rAF menu poller only in `start` and `oops`, and `gamepadconnected` / `gamepaddisconnected` listeners that just poll now (the poll is the truth).

### Completion Notes List

- All ten acceptance criteria are met; `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green (numbers in the Debug Log).
- **Commit:** one commit `Story 1.17 : ciblage automatique au clavier et à la manette`, made on request after the review-ready state, on the branch `story-1-17-ciblage-clavier-manette` (the session was on `main`).
- **Deviations from the story's test list:** there is no `pauseScreen.test.ts` or `uiShell.test.ts`. The test environment is Node with no DOM and those two files build their DOM directly with `document`, so the logic worth testing was put in pure functions: `padAction` (every app × pause × overlay × button, in `keys.test.ts`), `stickToMenuStep` (`menuStep.test.ts`) and `keyGlyph`; the DOM side (note shows and hides, `activateFocused`, `back`, Start / B / D-pad / A on the panel, the start screen and « Recommencer ») is covered by `autoTarget.spec.ts` on chromium and webkit.
- **`aimDir`** reads what `update` last computed rather than recomputing from the held keys, so the aim is exactly the walk direction (D1) and the stick's hysteresis memory is touched once.
- **`gamepadconnected` / `gamepaddisconnected`** do not read `event.gamepad`: they ask for an immediate poll. A second pad cannot pause the game, a stale event cannot pause it, and a plain `Event` (as the e2e stub dispatches) works.
- **Open points for Geo** (unchanged from the story, nothing here settles them): D3 (fallback when nothing is in the cone), D10 (the chip always says « Espace »), `contextReachM` 1.5 m and `autoTargetConeDeg` 60°, D13 (resume without the pad), D14 (a pad-only start may be silent).
- Deferred items are in `deferred-work.md` › « Deferred from: implementation of story 1-17 ». The two 1.4 / 1.5 items and the 1.7 hit-test item are closed or narrowed there.

### File List

- `_bmad-output/implementation-artifacts/1-17-ciblage-automatique-au-clavier-et-a-la-manette.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/project-context.md`
- `content/feel.json`, `content/levels/salon_crawler.json`, `content/strings.fr.json`
- `content/_schemas/feel.schema.json`, `content/_schemas/level.schema.json` (generated)
- `src/content/schemas/feel.ts`, `src/content/schemas/level.ts`
- `src/shared/constants.ts`
- `src/sim/commands.ts`, `src/sim/events.ts`, `src/sim/context.ts`, `src/sim/createSim.ts`, `src/sim/papa/papaSystem.ts`
- `src/sim/commands.test.ts`, `src/sim/events.test.ts`, `src/sim/createSim.test.ts`, `src/sim/replay.test.ts`, `src/sim/papa/papaSystem.test.ts`
- `src/client/input/autoTarget.ts` (+ test), `contextObject.ts` (+ test), `keyGlyphs.ts` (+ test), `menuStep.ts` (+ test) — new
- `src/client/input/gamepadInput.ts`, `inputMapper.ts`, `keyboardInput.ts`, `moveIntent.ts`, `hitTest.ts` and the tests `gamepadInput.test.ts`, `inputMapper.test.ts`, `keyboardInput.test.ts`
- `src/client/ui/world/glyphChip.ts` (+ test) — new; `threatMarkers.ts`, `worldUi.ts` and their tests
- `src/client/ui/keys.ts`, `keys.test.ts`, `uiShell.ts`, `overlayHost.ts`, `overlayScreen.ts`, `screens/pauseScreen.ts`, `screens/startScreen.ts`, `screens/oopsScreen.ts`, `styles/ui.css`
- `src/client/app/levelSession.ts`, `src/client/boot.ts`
- `tools/content/contentChecks.ts`
- `tests/content/checkContent.test.ts`, `tests/content/feelSchema.test.ts`, `tests/content/levelSchema.test.ts`
- `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/threats/threatCatalog.test.ts`
- `tests/e2e/autoTarget.spec.ts` (new), `tests/e2e/move.spec.ts`, `tests/e2e/support/game.ts`
- `tests/golden/journals/*.json` (six journals, `feelHash` and `levelHash` regenerated on purpose)

### Change Log

- 2026-10-27: Story 1.17 implemented. Keyboard and gamepad auto-target (`pickAutoTarget`), Space / A parry and context action (`TapObject`, `ObjectTapped`, `level.objects`, `feel.input.contextReachM`), target highlight and the single glyph chip, pad hot-plug, Start / Options and the disconnect pause with its line, pad navigation of the menus. Goldens regenerated on purpose (`feelHash`, `levelHash`). Status → review.
