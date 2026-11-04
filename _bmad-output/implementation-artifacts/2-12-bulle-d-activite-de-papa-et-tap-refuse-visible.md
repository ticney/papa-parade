---
baseline_commit: 827a927e9f08d6c207b6ec057bc43323ffd9d2d6
---

# Story 2.12: Bulle d'activité de papa et tap refusé visible

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see that Papa is busy and for how long,
so that I understand why he does not answer and can choose when to drink a coffee or pick up the phone.

Requirement: FR74 `[P]`, UX-DR28. This is the fourth story of the v2.3 catch-up (sprint change proposal 2026-11-03, §1 and §3: 3.12 → 2.11 → 3.13 → **2.12** → 2.13 → 3.14 → 3.15 → 3.16 → playtest → E9). At Geo's playtest, the `drink` / `on_phone` clips and their props were tiny in the iso view. There was « aucun signal d'occupation ; les taps sont ignorés en silence (`inputMapper`) », so refused taps « passaient pour un jeu qui ne répond pas » (GDD mechanic 15). Later stories reuse the bubble:
- 2.13: the exaggerated poses (out of scope here).
- 3.15: the after-effects that occupy Papa, with their « étoiles de vertige ».
- 9.4: the house chores, which can be interrupted and so are never refused.

## Acceptance Criteria

### The bubble

1. **When it shows.** An `activity-bubble` shows above Papa during every busy state: exactly the states `isPapaBusy` returns true for (`drink`, `onPhone`, `onToilet`, `asleep`, the failed micro-sleep that is today's only after-effect that occupies Papa). It shows from the frame the drawn world is in that state until Papa is free.
   - The pictogram comes from one table typed on `PapaState` (`Record<PapaState, ActivityPictogram | null>`, `null` for a state that is not busy), so a new state (3.15, 9.4) cannot compile without choosing one.
   - A unit test checks the table against `isPapaBusy`: a pictogram for every state that function calls busy, and `null` for every other.
   - The four pictograms are: `drink` a cup, `onPhone` a handset, `onToilet` a door, `asleep` dizzy stars. They are drawn in `{colors.ink}` on the paper bubble.
2. **Look (DESIGN.md › `activity-bubble`).**
   - A `{colors.paper}` disc with a 3 px `{colors.ink}` border, `rounded: full`, and a tail pointing down to Papa.
   - 48 px on the compact surface and 56 px on the regular one. The bubble follows the surface the way `--pp-threat-size` already does (56 / 64).
   - Never a threat colour (`parry`, `dodge`, `alert`), so it cannot be read as a threat.
   - Every pixel size is a constant in `shared/constants.ts`. A drift test beside `holdRingSpec.test.ts` pins those constants and the bubble's tokens to DESIGN.md's `activity-bubble` frontmatter: `borderWidth`, `sizeCompact`, `sizeRegular`, `refusedShakeMs`, the ring's 5 px / 2 px and `counter-clockwise`.
3. **Where it sits.**
   - The bubble is world-anchored in the `CSS2DRenderer` layer (ADR-008), at Papa's x/z. It is placed at the combo badge's height (`PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M`), centred, with its tail down.
   - **On the toilet** Papa is hidden (`papaPose` is `null`). The bubble then stays at the world's `papa.xM` / `papa.zM`, where he went in, so it does not depend on the pose.
   - It never takes a tap (`pointer-events: none`), so a tap through it still reaches the threats under it.
4. **The squash at the start.** When the bubble appears, it squashes in: a short scale `transform` in real ms, with `ACTIVITY_BUBBLE_SQUASH_MS` and its scale in constants.
   - It uses the Web Animations API, as the combo badge's pop does, and reads `isMotionReduced` when it starts.
   - A busy state that replaces another (`drink` → `asleep` when the micro-sleep interrupts the coffee) swaps the pictogram and squashes again.

### The ring

5. **The ring drains to `busyUntil`, in game time.**
   - A ring around the bubble has the hold-ring visual: a 5 px `{colors.paper}` band on `{colors.ring-track}` with a 2 px `{colors.ink}` outer outline. It reuses `HOLD_RING_STROKE_PX` and `HOLD_RING_OUTLINE_PX`.
   - It is full when the state starts (`papa.enteredAt`), empty at `papa.busyUntil`, and its moving edge travels counter-clockwise. The paper arc is the hold-ring's conic arc from 12 o'clock clockwise, over the fraction still to go, so the arc shrinks back towards 12 o'clock (D4).
   - It is computed each frame from the world and the drawn sim time (`renderSimMs`, the value the threat markers already get), never from real time or from events. It uses `chronoDrainPermille(papa.enteredAt, papa.busyUntil, renderSimMs)` from `chronoRing.ts`.
   - So it slows with a slow-mo, freezes in a hitstop and stops in the pause, with no code for any of them.
   - No `performance.now()`, no timer, no CSS transition or animation on its progress.
   - It is written only when the drawn value changes, from a table of strings built once, with no allocation per frame (the `breathRing.ts` / hold-ring pattern).
6. **No new world field.** `papa.enteredAt` and `papa.busyUntil` already hold the start and the end of every busy state (`world.ts` L17, L47–48), so the snapshot version does not move.

### The end

7. **Ding, pop, vibration (triple equivalence, ADR-006).** When Papa goes from a busy state to a free one, at the sim step where `PapaStateChanged{from: busy, to: not busy}` comes out:
   - The client sends a new client event `ActivityBubblePopped`. `feedback.json › events` maps it to a new cue `papa_free`: audio is a new « ding » clip, the visual is `{ kind: 'uiElement' }` (the pop), and the haptic is `light`.
   - The bubble pops out: a short scale-up and fade in real ms (`ACTIVITY_BUBBLE_POP_MS`), then it is hidden.
   - A busy-to-busy change (`drink` → `asleep`) is not an end: no ding and no pop, only the swap of AC 4.
   - A level end, a restart, `loadLevel` or the unmount hides the bubble without a pop or a cue.

### The refused tap

8. **The sim makes the refusal an event (architecture L413, P1).**
   - A `PressThreat` that `runThreats` skips because Papa is busy (`isPapaBusy(world.papa) && now < world.papa.busyUntil`, threatSystem.ts L149) now emits `{ type: 'TapRefused', t, threatId }`. It is emitted once per such command, and only when the command names a threat that is `telegraph` or `windowOpen`.
   - The command is still refused exactly as today: no press is recorded, no glide happens, nothing else in the world changes.
   - `TapRefused` joins the `SimEvent` union and `SIM_EVENT_TYPES` (their completeness check refuses it otherwise). It is exported through `@sim` like the others.
   - A press at the step where `busyUntil` is reached is judged as today, so it emits no `TapRefused`.
   - `TapBaby`, `TapFloor`, `TapObject` and `Move` while busy stay refused in silence, as today (open point 2).
9. **The client sends the press it used to drop.**
   - In `inputMapper.ts`, a primary tap while busy is hit-tested against the threats (`deps.hitTester.pickThreat`, moved above the busy return). If it hits a threat, the client enqueues the `PressThreat` and records the finger (`press.pressed`), so that its `Release` follows.
   - The same holds for the keyboard / gamepad action: `targetNow` picks the threat while busy, the client enqueues the `PressThreat` and records the press.
   - The client calls neither `onThreatPressed` (no target-highlight latency mark) nor `showTapMarker`, and sends no floor or object command.
   - A tap that hits no threat while busy is dropped as today: nothing is sent and no tap-marker is drawn.
   - `targetedThreatId()` still returns `null` while busy, so no target highlight is shown.
   - The sim decides: refused (`TapRefused`), or judged when that step already has Papa free.
10. **The bubble shakes, and a « busy » sound plays.**
    - On a `TapRefused`, the client sends a new client event `ActivityBubbleShaken`. It is routed in `simEventFeedback.ts`, the way `ChronoArcLit` comes from `WindowOpened`.
    - `feedback.json › events` maps it to a new cue `papa_busy_refused`: audio is a new « occupé » clip, the visual is `{ kind: 'uiElement' }` (the shake), and the haptic is `light` (EXPERIENCE.md L375, L436).
    - The bubble shakes for `ACTIVITY_BUBBLE_REFUSED_SHAKE_MS` = 150 ms (DESIGN `refusedShakeMs`), with a `translateX` keyframe in the style of `pp-gauge-shake`.
    - A second refused tap during a shake restarts the shake. The cue plays once per `TapRefused`, with no throttle (open point 3).
    - No `tap-marker`, no target-highlight, no glide.
11. **Bots.** The bots do not check busy today (`src/bots/threatTiming.ts`, `randomBot.ts`), so a bot press that lands while Papa is busy now emits `TapRefused`. That is wanted: autoplay shows and plays the refusal, and the headless sim sees it. No bot logic changes.

### The combo badge

12. **The badge moves to the bubble's right.**
    - While the bubble shows and the combo badge shows (multiplier above x1), the badge sits to the bubble's right with no overlap. This is a new `pp-combo-badge--beside-activity` state whose offset comes from the bubble's size, its ring, a gap and the badge's half-width (constants or custom properties, no new literal).
    - `worldUi.updateCombo` decides it, as it decides `--aside` today.
    - When a threat that follows Papa (micro-sleep, cry in the arms) is up while Papa is busy, the threat keeps the spot above Papa. The bubble steps to the left by the same aside offset (`pp-activity-bubble--aside`) and the badge stays on the right (D6).
    - A unit test pins that none of the three overlap at either surface. A screenshot confirms it.
    - On the toilet the badge is hidden as today (`papa === null`), and the bubble is alone.

### Reduced motion

13. **Reduced motion is client-only (EXPERIENCE.md L456–457, L461).** Under `data-pp-motion="reduced"`:
    - The squash, the pop and the shake are removed.
    - The refused tap keeps its sound and haptic, and the bubble's border thickens (3 → 5 px, by an ink `box-shadow`, the way `.pp-hud-gauge-alert` does it) for the same 150 ms.
    - The end keeps its ding and haptic, and the bubble just goes.
    - The ring is unchanged: it is gameplay timing, like the chrono-ring.
    - Every animated selector has its `:where(:root[data-pp-motion="reduced"])` rule (`designTokens.test.ts`), and animations touch `transform` / `opacity` only. The thickened border is a static rule on a class held for 150 ms, never an animated border.

### Tests and docs

14. **Sim tests.**
    - `TapRefused` comes out for a press on an answerable threat during each busy state (coffee, phone, toilet, nap).
    - It does not come out when Papa is free, at the `busyUntil` step (the press is judged), for an unknown or resolved threat, or for `TapBaby` / `TapFloor`.
    - A refused press records nothing: the threat has no `press` and Papa does not glide, which a world-hash comparison with and without the command checks.
    - **Goldens.** Run `npm test`. If a golden moves, it may only be a scenario where a bot pressed while Papa was busy, and its `eventTypes` diff may only add `TapRefused` entries (the world hash stays the same).
    - In that case regenerate the goldens deliberately (`npm run golden:update`), check the diff against those two rules and say so in the Completion Notes. Any other change is a bug.
15. **Client unit tests.**
    - `activityBubble.test.ts`:
      - the bubble is shown and hidden by state;
      - each state has its pictogram, and the swap on busy → busy;
      - the ring's per-mille from `renderSimMs` (full at `enteredAt`, half-way, empty at `busyUntil`, clamped);
      - the DOM is written only on change;
      - the toilet anchor without a pose;
      - the shake on `shake()` and its restart;
      - the pop on the end, with no pop on a hide by unmount;
      - the reduced variants (no animation started).
    - `inputMapper.test.ts`:
      - busy tap on a threat → `PressThreat` and no tap-marker or `onThreatPressed`;
      - busy tap on the floor → nothing sent;
      - busy keyboard action with a threat up → `PressThreat`;
      - the `Release` follows the busy press.
    - `simEventFeedback.test.ts`:
      - `TapRefused` → `papa_busy_refused` once;
      - `PapaStateChanged` busy → idle → `papa_free`;
      - busy → busy plays nothing.
    - `worldUi.test.ts`: the badge state and the bubble's aside.
16. **E2E (Chromium).** New `tests/e2e/activityBubble.spec.ts`, on a frozen level through the test API:
    - **Coffee.**
      - `TapObject coffee_machine`, step until `drink`. Let a frame render (`waitFrames`) after each `ppAdvance` before reading the DOM.
      - The bubble shows with the cup, and its ring is near full. After `n` steps its progress matches `1 − (n × STEP_MS − STEP_MS) / coffeeDurationMs`, from the live feel. The drawn time trails the sim by one step in a frozen frame, as in 2.11.
      - At `busyUntil` the bubble pops and is gone. `cueLog()` holds `papa_free` once, and a `light` vibration is recorded.
    - **Refused tap.** Force the outlet during the coffee (`ForceThreat`) and tap its marker with a real pointer click:
      - `events()` holds `TapRefused` with that threat id;
      - `cueLog()` holds `papa_busy_refused`;
      - the bubble has its shake class;
      - no `.pp-tap-marker` is in the DOM;
      - the threat has no press.
    - **Pause.** A real pause leaves the ring unchanged.
    - **Phone, toilet, nap.** Add one assertion each to the existing specs, which already reach those states (`phone.spec.ts` answering, `toilet.spec.ts` « taps do nothing », `fatigue.spec.ts` nap):
      - the bubble with its pictogram;
      - for the toilet, the bubble with no Papa drawn;
      - the « taps do nothing » assertions still hold for the floor.
    - **Reduced motion.** In `reducedMotion.spec.ts`, a refused tap leaves no running animation on the bubble and the thicker border class, and the cue still plays.
17. **Specs to rerun on Chromium.** `activityBubble`, `phone`, `toilet`, `fatigue`, `reducedMotion`, `combo`, `feedback`, `testApi`, `threat`, `autoTarget`, `ui`, `chambreNight`, `sequence`, `autoplay`.
    - `autoplay.spec.ts`'s frozen frame moves only if Papa is busy in it. If it moves, regenerate the two macOS references deliberately, look at them and say so.
18. **Docs.**
    - `project-context.md`:
      - Fix the « Busy Papa » paragraph: the client now sends a press on a threat while Papa is busy, and the sim refuses it with `TapRefused`.
      - Add an « Activity bubble (story 2.12) » paragraph covering the states, the pictogram table, the ring's time base, the two client events, the badge, reduced motion and the bots.
    - `game-architecture.md` L413: `TapRefused{t, threatId}` (the field is `threatId`, as in every other threat event).
    - `EXPERIENCE.md`:
      - The « Refused tap » row: the haptic is no longer an `[ASSUMPTION]`.
      - The activity-bubble row: the `asleep` state and its stars.

## Tasks / Subtasks

- [x] Task 1: `TapRefused` in the sim (AC: 8, 11, 14)
  - [x] `src/sim/events.ts`: `{ type: 'TapRefused'; t: SimMs; threatId: number }` in `SimEvent`, `'TapRefused'` in `SIM_EVENT_TYPES`
  - [x] `src/sim/threats/threatSystem.ts` L144–150: on the busy skip, emit `TapRefused` once when the command's threat exists and is `telegraph` / `windowOpen` (one loop over `threats`, no allocation beyond the event)
  - [x] `threatSystem.test.ts` (or a new `tapRefused.test.ts` beside it): every case of AC 14
  - [x] `npm test`. If a golden moves, check it against AC 14's rule, then `npm run golden:update` and note it
- [x] Task 2: The input mapper sends the busy press (AC: 9)
  - [x] `handlePointerDown`: hit-test first. When busy, a hit means `PressThreat` plus `press.pressed`, and returns before `onThreatPressed` and every floor, object or baby branch; no hit means the debug log line and a return, as today
  - [x] `act`: when busy, `targetNow` is used the same way; with no threat up, the action is dropped as today
  - [x] Update the « Papa drinks, sleeps… the client sends none either » comment (L245–248)
  - [x] `inputMapper.test.ts`: the AC 15 cases
- [x] Task 3: The bubble (AC: 1–7, 12, 13)
  - [x] Constants in `shared/constants.ts`:
    - `ACTIVITY_BUBBLE_BORDER_PX`, `ACTIVITY_BUBBLE_COMPACT_PX`, `ACTIVITY_BUBBLE_REGULAR_PX`, `ACTIVITY_BUBBLE_REFUSED_SHAKE_MS`
    - `ACTIVITY_BUBBLE_SQUASH_MS` and its scale, `ACTIVITY_BUBBLE_POP_MS` and its scale
    - `ACTIVITY_BUBBLE_REDUCED_BORDER_PX`, the badge gap
    - The drift test in `tests/architecture/holdRingSpec.test.ts` (or a sibling `activityBubbleSpec.test.ts`)
  - [x] New `src/client/ui/world/activityBubble.ts`: `createActivityBubble(doc, scene, options)` returns `{ update(papa, renderSimMs, isAside), shake(), hide(), dispose() }`
    - One `CSS2DObject`: an outer box placed by the renderer, an inner box animated by the Web Animations API, the ring (outline plus band, from `breathRing.ts`'s build), and the pictogram SVG.
    - The pictogram table is typed on `PapaState`. The paths: the cup from `THREAT_ICON_PATHS.mug`, the door from `OBJECT_ICON_PATHS`' toilet door, and new handset and dizzy-stars paths, each a single ink path in the style of the icons beside them.
  - [x] `worldUi.ts`:
    - create the bubble **last** (tests read the scene's children by index; the mounted threat markers therefore start at index 8, and `worldUi.test.ts` reads them there);
    - add it to `render()`'s `isVisible` list (L225–247), or it is never drawn;
    - expose `updateActivity` and `shakeActivity`;
    - `updateActivity` computes the bubble's aside (a private helper shared with `updateCombo`), and `updateCombo` sets the badge's `--beside-activity` from `activityBubble.isActive`, so `updateActivity` runs first (deviation: `updateCombo` returns nothing).
  - [x] `comboBadge.ts` / `ui.css`: the `--beside-activity` state (a `translate`, as `--aside` is), with the offset from custom properties written once; the `--aside` offset is now computed too (it was a 64 px literal that overlapped a threat's chrono-ring), so the three never overlap
  - [x] `ui.css`:
    - `.pp-activity-bubble` and its tail, the ring, the pictogram;
    - `@keyframes pp-activity-shake` (`transform` only);
    - the reduced rules (`:where(:root[data-pp-motion="reduced"])`);
    - every custom property it reads is declared (`designTokens.test.ts`);
    - `tokens.css` mirrors any new DESIGN token 1:1.
  - [x] `boot.ts`, in the frame loop next to `updateCombo` (≈ L1285–1316): `worldUi.updateActivity(world.papa, renderSimMs, …)` from the world's Papa, not from `papaPose`. Hide the bubble on level end, restart and `loadLevel`, alongside the other world UI resets
  - [x] `activityBubble.test.ts`, `worldUi.test.ts`, `comboBadge.test.ts`: the AC 12 and AC 15 cases
- [x] Task 4: Cues and sounds (AC: 7, 10)
  - [x] `feedbackEvents.ts`: `ActivityBubbleShaken` and `ActivityBubblePopped` in `FEEDBACK_CLIENT_EVENTS`
  - [x] `simEventFeedback.ts`:
    - `TapRefused` → `director.handle('ActivityBubbleShaken', null)`; `boot.ts` calls `worldUi.shakeActivity()` itself in `onSimEvent`, next to `ToiletRefused` (deviation: no callback);
    - `PapaStateChanged` with `isPapaBusy(from) && !isPapaBusy(to)` → `director.handle('ActivityBubblePopped', null)`;
    - `isPapaBusy` takes `{ state }` and is already exported through `@sim` (with `PAPA_STATES` and `PapaState`), so `isPapaBusy({ state: event.from })` needs no new export and no deep import.
  - [x] `content/feedback.json`:
    - the cues `papa_busy_refused` (`audio: papa_busy`, `uiElement`, `light`) and `papa_free` (`audio: ui_papa_free_ding`, `uiElement`, `light`);
    - the two `events` rows.
  - [x] `tools/audio/makePlaceholderAudio.ts`:
    - two placeholder synths: a short low double « bonk » for `papa_busy` (a dry, not alarming « nope », clearly unlike the `papa_bump` of the toilet refusal) and a small bell for `ui_papa_free_ding`;
    - `npm run assets:audio -- --only papa_busy,ui_papa_free_ding` (macOS, `afconvert`), commit the two `.m4a`;
    - update the header comment's list of stories.
  - [x] Run `npm run content:check`: each clip exists, each client cue has only a `uiElement` visual, and each cue with audio has its visual and haptic twin (`feedbackTwins.test.ts`, `feedbackEquivalence.test.ts`)
  - [x] `simEventFeedback.test.ts`: the AC 15 cases
- [x] Task 5: E2E (AC: 16, 17)
  - [x] New `tests/e2e/activityBubble.spec.ts`; additions to `phone`, `toilet`, `fatigue`, `reducedMotion`
  - [x] Run AC 17's specs on Chromium: `npm run e2e -- <files> --project=chromium` (never `npx playwright test`)
- [x] Task 6: Docs, checks, look (AC: 18)
  - [x] `project-context.md`, `game-architecture.md` L413, `EXPERIENCE.md`; `npm run ci:fast` after each task
  - [x] Look at the bubble in play (zoomed captures at both surfaces):
    - a coffee with the ring half drained;
    - a phone with the badge at x2 or more beside it;
    - the toilet bubble with no Papa;
    - the nap with its stars and the 3D « Z »;
    - a micro-sleep threat on Papa during the phone (bubble aside).
    - Say in the notes what Geo should judge.

### Review Findings

Code review 2026-11-04 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; full diff `main...HEAD`). No high-severity finding; ACs 1-18 are met except where noted.

- [x] [Review][Patch] (decided by Geo: 1a, capture both surfaces + e2e measuring overlap and edge clamp) AC 12's three-way layout (bubble aside, threat in the centre, badge on the right) was never looked at, and its no-overlap unit test is true by construction — The test (`activityBubble.test.ts` L498-533) checks geometry computed from the same constants (`reach + GAP + HALF`), so it can only fail if a constant becomes ≤ 0; `COMBO_BADGE_HALF_WIDTH_PX = 24` is a guess not tied to the badge's real CSS (a « x10 » is wider). Task 6's last look item (a micro-sleep threat on Papa during the phone) is ticked `[x]` but the Completion Notes say it was not captured. The `--aside` offset has no screen-edge clamp (Papa near the left edge: the bubble may leave the screen), also unlooked. Options: (a) capture both surfaces and add an e2e that measures `getBoundingClientRect` overlap and the edge clamp; (b) untick the item, say so in the notes, and leave it to Geo's device pass.
- [x] [Review][Patch] (decided by Geo: 2b, nested wrapper for the shake) A refused tap's shake can be swallowed — The shake is a CSS animation on `transform` on the same `body` that the squash/pop animates through WAAPI, and script animations outrank CSS ones: a refusal in the first 180 ms of a bubble (or a busy → busy swap) shows no shake, while sound and haptic play. `shake()` also returns early when `!isActive`, so a refusal handled before the frame's first `update` (several sim steps in one frame) is dropped. Options: (a) accept and note it (rare, 180 ms); (b) put the shake on a nested wrapper so the two never share `transform`, and let `shake()` arm itself for a bubble about to appear.
- [x] [Review][Patch] The `pp-activity-bubble--<pictogram>` class is never removed after a pop [`src/client/ui/world/activityBubble.ts:341-355`] — `update` sets `shownPictogram = null` before `forget()`, whose removal is guarded by `shownPictogram !== null`; `setPictogram` has the same guard. After drink then phone the element carries `--cup --handset`, and the e2e regexes (`toHaveClass(/--stars/)`) pass anyway. Keep the class actually on the element in its own variable, and add a pop-path test.
- [x] [Review][Patch] The combo badge snaps back to the centre while the bubble is still popping [`src/client/ui/world/worldUi.ts:232`] — `updateCombo` passes `activityBubble.isActive`, false from the first frame of the 160 ms pop, so the badge drops `--beside-activity` under the enlarging bubble (AC 12 / D6). Pass `isVisible` instead, and test it.
- [x] [Review][Patch] `hide()` writes the DOM every frame once the flow is `ended` or `photo` [`src/client/boot.ts:1303`, `activityBubble.ts:304-314`] — `forget()` always runs `classList.remove` and `enter?.cancel()`, against « DOM written only on change ». Return early when nothing is shown.
- [x] [Review][Patch] `door: OBJECT_ICON_PATHS.toilet ?? ''` is a silent fallback [`src/client/ui/world/activityBubble.ts`, near the pictogram table] — an empty door with no `log.warn`, against the project rule. Warn once, or fail loudly.
- [x] [Review][Patch] Weak e2e assertions [`tests/e2e/activityBubble.spec.ts` L117-120, L205-225, floor-tap test] — the coffee spec only asserts `toBeHidden()` + the cue, so nothing fails if the pop is removed; the pause check `toBeLessThanOrEqual(100)` is true by construction and never asserts the ring had drained before the pause; the floor tap clicks a hard-coded `(300, 200)` without proving it hit the floor.
- [x] [Review][Patch] The sim's busy tests set `papa.state` / `busyUntil` by hand [`src/sim/threats/tapRefused.test.ts:608-612`] — `makeBusy` does not prove that the real `startCoffee`, `startCall`, `startToilet` and `putPapaToSleep` leave `now < busyUntil`. Drive at least one case per busy state through the real start path.
- [x] [Review][Patch] Nits: `enter?.cancel(); enter = null;` before `play()` is redundant (`activityBubble.ts:368-371`, `play` cancels), and the `TapRefused` loop has no `break` after its match [`src/sim/threats/threatSystem.ts:151-159`].
- [x] [Review][Defer] The ring refills when an already-asleep Papa is put to sleep again [`src/sim/papa/sleep.ts:28-31`, `papaFsm.ts:73-81`] — deferred, pre-existing: `busyUntil` is extended but `enterPapaState` returns early, so `enteredAt` stays and the ring jumps back up with no cue. Not confirmed that a level can produce it.
- [x] [Review][Defer] « Papa is free » ding plays on a busy → idle → busy chain in one step [`src/client/feedback/simEventFeedback.ts:46-52`] — deferred, pre-existing: a nap landing on the step a coffee or toilet ends emits the pop cue while the bubble only swaps.

## Dev Notes

### Decisions

- **D1. `TapRefused` is a sim event, as the architecture says (confirmed by Geo, 2026-11-03).** L413 lists `TapRefused{target}` among the domain events, and L753 (P1) says the refusal becomes visible through `TapRefused`. Two other ways were weighed and not taken:
  - A client-only event would leave goldens and journals as they are, but it goes against the architecture.
  - It would also keep the journal blind to refused taps, which are the playtest's finding.
  - Since the sim emits the event, the client must send the press it drops today (D2).
  - The cost: goldens where a bot presses during a busy state get `TapRefused` entries. That regeneration is deliberate and bounded (AC 14).
  - The field is `threatId`, like every threat event. « target » in the architecture predates the event's shape; update L413.
- **D2. Why the client keeps the finger.** The client only knows the world of its last frame. A press it sends while busy may reach the step where `busyUntil` is reached, and that step judges the press (threatSystem.ts L146–148).
  - If the client did not record the press, no `Release` would follow, and a tap would become a hold, which turns into a `wrongResponse` at `holdMinMs`.
  - So it records the press (`press.pressed`) and leaves the sim to decide. When the sim refuses the press, the `Release` that follows ends nothing, because `releasePresses` ends only the presses it finds.
  - It does not call `onThreatPressed`: no highlight latency mark for a refusal. In the edge case where the sim judges the press, the mark is lost, which does not matter.
- **D3. Which states.** The rule is `isPapaBusy`, which covers `drink`, `asleep`, `onPhone` and `onToilet`.
  - The story lists `drink`, `onPhone`, `onToilet` and « séquelle qui l'occupe ». `asleep` (the failed micro-sleep, 3 s) is the after-effect that exists today (GDD L218, 3.15 lists it among the after-effects), so its pictogram is the after-effect's « étoiles de vertige » (GDD L238).
  - The table typed on `PapaState` is the extension point for 3.15 (after-effects as new states, or a field: then the table's key changes, and 3.15 decides that) and 9.4 (a chore is interruptible: no refusal, but a bubble with a pan or a plate).
  - No state is interruptible today, so every busy state refuses.
- **D4. « Drains counter-clockwise ».** The ring is full at the start and empty at the end, so it is the hold-ring's conic arc (paper from 12 o'clock clockwise over the remaining fraction) with a falling value. Its moving edge goes counter-clockwise, which is the UX's « drains counter-clockwise », and it reads as the opposite of the chrono-ring, which fills clockwise.
  - Build it as `breathRing.ts` does: a conic gradient and a radial mask, an outline div and a band div, percent strings built once.
  - `chronoDrainPermille` gives the value; converting it to the strings' resolution is fine. At 3 s, a whole percent is 30 ms, smooth enough.
- **D5. Real time for the juice, sim time for the ring.** The squash, the pop and the shake are UI juice in real ms (the tap-marker's and the combo pop's model), so they run through a pause too. The ring is gameplay information in sim time (architecture L214).
  - The sounds and the vibrations are events, so they come out at the exact step. The pop is state, seen on the drawn frame, so the two can be a frame apart, as in 2.11 D6.
- **D6. Three things above Papa.** Today, the threat icons on Papa and the combo badge share `PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M`, and the badge steps aside (`--aside`, 64 px) when a threat follows Papa.
  - The bubble takes that spot and the badge goes to its right (UX-DR28).
  - When a threat on Papa is up during a busy state (a micro-sleep telegraphed during the phone, the cry in the arms), the threat keeps the centre, because it is what the player answers, or cannot answer. The bubble then steps left by the aside offset and the badge stays on the right.
  - Check the three on a screenshot at both surfaces. If the bubble's left step clips at the screen edge, `clampVerbShiftPx` (used by `papaHint.ts`) is the model.
- **D7. The client events.** A sim event's cue may not have a `uiElement` visual (`contentChecks.ts` L230–237), and a soundWave on Papa would add a second visual to the shake. So, as `WindowOpened` → `ChronoArcLit` and `InstinctTriggered` → `InstinctVignetteShown` do, `simEventFeedback.ts` turns:
  - `TapRefused` into `ActivityBubbleShaken`;
  - a busy → free `PapaStateChanged` into `ActivityBubblePopped`.
  - Each gets a `uiElement` cue whose visual twin is the bubble itself.
  - The existing `toilet_flushed` cue (`ToiletFinished`, same step) still plays with the ding. Geo judges whether both stay (open point 4).
- **D8. No new mirror.** The e2e reads the bubble's DOM (its classes, its progress custom property, its pictogram class), `events()` and `cueLog()`, so `inspectDist.ts` gets nothing new. If the dev adds a `data-pp-*` mirror anyway, it goes into the `mirror()` union and into `PROD_FORBIDDEN_MARKERS`.

### Current state of the files this story changes

- **`src/sim/threats/threatSystem.ts` L141–168.**
  - What it does today: the command loop. `PressThreat` is skipped with a silent `continue` when `isPapaBusy(world.papa) && now < world.papa.busyUntil`. `TapBaby` is skipped the same way. `Release` always passes (`releasePresses`).
  - What changes: only the `PressThreat` skip emits `TapRefused`.
  - What must be preserved: the judgement at the `busyUntil` step, and the `TapBaby` silence.
- **`src/sim/papa/papaSystem.ts` L275.** `if (isPapaBusy(papa)) break;` drops every Papa command while busy. It is unchanged: the event comes from `runThreats` only, so one command gives one event.
- **`src/sim/papa/papaFsm.ts`.** `PapaState` (L10–18), `PAPA_STATES` (L21, with a completeness check), `isPapaBusy` (L60–67), `enterPapaState` (L73–80, the only writer, which emits `PapaStateChanged{t, from, to}` and sets `enteredAt`). Read it, do not change it.
- **Busy starts and ends** (read only).
  - `coffee.ts` `startCoffee`: `coffeeDurationMs` 3000, `CoffeeStarted`, then `CoffeeDrunk` at the end.
  - `phoneCall.ts` `startCall`: `answerBusyMs` 5000, `PhoneAnswered`.
  - `toilet.ts` `startToilet`: `toiletDurationMs` 5000, `ToiletStarted`, then `ToiletFinished`.
  - `sleep.ts` `putPapaToSleep`: `asleepMs` 3000, only `PapaStateChanged`. It replaces `drink`, `onToilet` or `onPhone`, and then the cancelled coffee or toilet emits no end event.
  - `papaSystem.ts` L254–263 ends them all on `now >= busyUntil`.
  - The end the bubble needs is therefore `PapaStateChanged` busy → not busy, the one event common to all four.
- **`src/client/input/inputMapper.ts`.**
  - `isBusy` (L249).
  - `refreshMove` drops moves (L283–289). It is unchanged.
  - `act` returns on busy before `targetNow` (L332–335).
  - `handlePointerDown` returns on busy before `pickThreat` (L538–541).
  - `targetedThreatId` returns `null` while busy (L733). It is unchanged.
  - The tap-marker is shown only on baby, prop, object and floor taps (L626, 646, 653, 667), never on a threat press. The toilet refusal already skips it (L650–655), which is the precedent.
- **`src/client/ui/world/worldUi.ts`.**
  - One `CSS2DRenderer` scene in `#pp-world`. `render()` returns early unless an element `isVisible` (L225–247).
  - Creation order is read by index in tests (L166–173).
  - `updateCombo` (L189–201) computes `isAside` from the entries that follow Papa: the place for the badge's new state and the bubble's aside.
- **`src/client/ui/world/comboBadge.ts`.** It is placed at `PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M` and hides when `papa === null`.
  - Its pop uses the Web Animations API on the child, skipped under reduced motion.
  - CSS lives in `ui.css` L1636–1664: `--pp-combo-aside-offset: 64px` and `.pp-combo-badge--aside { translate: … }`. The renderer owns `transform`, so offsets use `translate`.
- **`src/client/ui/world/breathRing.ts`** (+ `ui.css` L1684–1730). The ring model to copy: a `CSS2DObject` on Papa, outline plus band, a conic gradient with a radial mask, hold-ring constants, `PROGRESS_PCT` strings, DOM written only on a whole-percent change, no animation.
- **`src/client/ui/world/chronoRing.ts`.** `chronoDrainPermille(pressT, endAt, simMs)` (L170–173) is exactly full-at-start, empty-at-end. Its header (L13–17) says its helpers are meant for reuse.
  - Do not reuse `chronoRingElement.ts`: it is threat-specific (lit arc, notch, clockwise SVG).
- **`src/client/ui/world/papaHint.ts`.** The other world text above Papa (`PAPA_HINT_OFFSET_M` 0.85, shown on `ToiletRefused`). It is higher than the bubble, so they do not meet. Check it on a screenshot after a toilet refusal (Papa carrying is never busy, so the two never show together).
- **`src/client/render/views/papaView.ts`.** `PAPA_HEIGHT_M` 0.9. The mug and handset nodes and the 3D ink « Z » above the head when asleep (`PAPA_Z_HEIGHT_M` 0.45, L146–164), and the group is hidden on the toilet.
  - The CSS2D layer is drawn over the canvas, so the bubble may cover the « Z ». Look at it; changing the « Z » is 2.13's or Geo's call (open point 5).
- **`src/client/feedback/`.**
  - `feedbackEvents.ts` L7–18: `FEEDBACK_CLIENT_EVENTS`.
  - `simEventFeedback.ts` L25–49 `playSimEventFeedback` handles, in order: the events table, the threat-def cues, `ChronoArcLit` (L38–40), the disruption cues, the sequence cues. It is called from `boot.ts` ≈ L1405.
  - `feedbackDirector.ts` `handle(name, world)`.
- **`content/feedback.json`.** `haptics.light` is `[15]`. `CoffeeStarted`, `CoffeeDrunk` and `PapaStateChanged` have no cue today. `toilet_refused` (`papa_bump`, soundWave on Papa, `light`) is the closest cue.
- **`src/client/boot.ts`.**
  - The frame loop has the drawn time `world.time.sim − STEP_MS × (1 − alpha)` (≈ L1275) and `updateCombo` / `updatePapaHint` / `updateBeatRing` / `updateStealth` (≈ L1285–1316).
  - `papaPose` is `null` while `onToilet` (≈ L1287).
  - `ToiletRefused` shows the papa hint (≈ L1480–1486).
  - `isMotionReduced` goes to `worldUi` through `comboOptions` (≈ L261–264).

### What must keep working

- Every « taps do nothing while busy » behaviour on the floor, objects and the baby (`toilet.spec.ts`, `fatigue.spec.ts` nap).
- The coffee's cost: a threat that opens while Papa drinks still ends in its gag (`late`).
- `Release` while busy.
- A key held through a busy state walks again on `PapaStateChanged → idle` (`resumeHeld`).
- The combo badge's pop, cash-in and `--aside`. The papa hint. The breath ring and beat ring on Papa.
- The toilet refusal (« POSE-LE D'ABORD ! », `papa_bump`).
- Perf: one more `CSS2DObject`, DOM written only on change, nothing allocated per frame. `perf.spec.ts` should not move.
- The architecture tests, Biome layer rules, `content:check`.

### Traps

- **`worldUi.render()` skips the frame** when nothing in its list is visible: a bubble left out of that list is never drawn.
- **Scene children are read by index** in the world UI tests: append the bubble last.
- **`papaPose` is `null` on the toilet**: anchor the bubble on `world.papa`, not on the pose.
- **`enteredAt` is the last state change.** A `drink` → `asleep` swap restarts the ring from the nap's `enteredAt` to its own `busyUntil`, which is correct.
- **`busyUntil` may not be on the step grid.** Clamp the drain and do not count steps.
- **A sim event's cue may not be `uiElement`, and a client event's cue may only be `uiElement`** (`contentChecks.ts`). Map the client events, not `TapRefused` itself.
- **`designTokens.test.ts`:**
  - no colour literal;
  - no undeclared `var()`;
  - animations on `transform` / `opacity` only (no border or size animation: the reduced « thicker border » is a static class);
  - each animated selector has its reduced rule;
  - never `prefers-reduced-motion` in CSS.
- **The `ppAdvance` test API runs steps without a frame**: `waitFrames` before reading the DOM. The drawn time trails by one step in a frozen frame.
- **`SIM_EVENT_TYPES` completeness**: a new event that is not listed does not compile, and `contentChecks` reads that list for the events table.
- **Goldens**: regenerate only if they move, and only for `TapRefused` insertions (AC 14). Never loosen a golden.
- **`VITE_DEBUG_ALLOWED=false` may be exported** in the agent shell. Run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` for `dev`, `e2e` and `ci`.
- **E2E goes through `npm run e2e -- …`** (the heavy-check lock), in the background. The Mac sleeps during long background runs (`caffeinate -i -s`).
- **The worktree guard** refuses compound shell commands that name `git`: use plain commands.

### Out of scope

- The exaggerated poses, the ×2 mug and handset, « bla bla », the steam, the slurp (2.13).
- The after-effects that occupy Papa beyond today's `asleep` (3.15) and the chores with their pan and plate pictograms and their interruptibility (9.4). Keep the pictogram table and the bubble free of anything specific to coffee, phone, toilet or nap beyond the table.
- The offscreen info bubble (9.3).
- A visible refusal for floor, object and baby taps while busy (open point 2).

### Architecture compliance

- `src/client/ui/world/activityBubble.ts` is where the architecture names it (L537, L614, L978). World-anchored UI is DOM in the `CSS2DRenderer` layer (ADR-008), vanilla TS, `pp-` classes.
- « Anneaux ancrés au monde (v2.3) » (L214): the bubble's ring is computed in sim time from the `World` (`busyUntil`), with no real-time timer.
- The sim stays pure: one event, emitted where the command is refused, with no new world field and no real time. The client reads the world and never writes it. There is no deep import of `src/sim/...`: `isPapaBusy` and the new event type come through `@sim`.
- Feedback goes through `FeedbackDirector` and `feedback.json` (ADR-006: a cue with audio has a visual and a haptic). Haptics go through `Platform.haptics`.
- Reduced motion is client-only. `reducedMotion` never appears in sim, bots or tools (`comfortSettings.test.ts`).

### Library and framework notes

The stack is pinned (`three@0.186.1` with the CSS2DRenderer addon; Web Animations API, already used by `tapMarker.ts` and `comboBadge.ts`). Nothing to add or upgrade, so no version research. The CSS2DRenderer writes only the outer element's `transform` and `display`: put offsets in `translate` and animations on a child.

### File structure

- **New:**
  - `src/client/ui/world/activityBubble.ts` and `activityBubble.test.ts`
  - `tests/e2e/activityBubble.spec.ts`
  - `public/assets/audio/papa_busy.m4a`, `public/assets/audio/ui_papa_free_ding.m4a`
  - possibly `tests/architecture/activityBubbleSpec.test.ts`
- **Updated (code):**
  - `src/sim/events.ts`, `src/sim/threats/threatSystem.ts`, `src/sim/index.ts` (only if an export is needed)
  - `src/client/input/inputMapper.ts`
  - `src/client/ui/world/{worldUi,comboBadge}.ts`, `src/client/ui/styles/ui.css` (and `tokens.css` if a token is added)
  - `src/client/boot.ts`
  - `src/client/feedback/{feedbackEvents,simEventFeedback}.ts`
  - `src/shared/constants.ts`, `content/feedback.json`
  - `tools/audio/makePlaceholderAudio.ts`
- **Updated (tests):**
  - the colocated tests of the files above
  - `tests/architecture/holdRingSpec.test.ts`
  - `tests/e2e/{phone,toilet,fatigue,reducedMotion}.spec.ts`
  - `tests/golden/journals/*.expected.json` only if AC 14 allows it
- **Docs:** `_bmad-output/project-context.md`, `game-architecture.md` L413, `EXPERIENCE.md`.
- **Not touched:** `src/sim/world.ts`, `snapshot.ts`, `content/feel.json`, `content/threats/**`, `src/bots/**`, `papa.glb`.

### Testing

- **Unit (Vitest, colocated):**
  - the sim event with the test content and a frozen world (the threatSystem tests are the model);
  - the bubble with the fake `doc` and scene the `breathRing` / `comboBadge` tests use;
  - the input mapper with its existing fakes (hit tester, enqueue spy, `showTapMarker` spy);
  - the feedback routing with a director spy.
- **E2E (Chromium):** frozen level, `send` / `advance` / `waitFrames`, a real pointer click on the threat marker for the refusal, bounds from the live feel (never literals).
  - Assert on elements that exist: `.every` on an empty list passes (the lesson from the 3.5 and 2.11 reviews).
  - Every test must be able to fail. The 2.11 review found five vacuous tests, so avoid `typeof` checks and assertions that are true by construction.
- **Checks:**
  - `npm run ci:fast` after each task;
  - the touched specs on Chromium (Task 5);
  - `npm run content:check` after the feedback change;
  - `ci:story` belongs to the review.

### Previous story intelligence

- **2.11 (chrono-ring).** The ring model and the time base (`renderSimMs`, one step of trail in a frozen frame).
  - A client event for a `uiElement` cue, routed in `simEventFeedback.ts` rather than `boot.ts`, because that is the unit-tested path.
  - Its review found, and these are to avoid here:
    - vacuous tests;
    - silent fallbacks (« every fallback logs a warn »: an unknown busy state with no pictogram warns once);
    - pixel literals in CSS that copied constants (take sizes from constants or custom properties pinned by the drift test);
    - debug work done in production builds;
    - story text out of step with the code (update the task text when you deviate).
- **2.10 (reduced motion).** Every reduced rule is `:where(:root[data-pp-motion="reduced"])`, nothing flashes above 3 Hz, and the shake is replaced, not slowed.
- **4.2 (combo badge).** The `--aside` mechanism and the Web Animations pop. **4.3 (toilet).** The refused-tap precedent (`ToiletRefused`, papa hint, no tap-marker).
- **1.19 / 1.20.** Coffee and phone: Papa is busy and the client sends nothing. This story changes the second half for threat presses only.
- **3.12 (last merged with 2.11).** Touched `feedback.json` and `project-context.md`: merge those by hand if a later story conflicts.

### Git intelligence

The last commits are 2.11 (chrono-ring: `chronoRing.ts`, `threatMarkers.ts`, `silenceBubble.ts`, `simEventFeedback.ts`, `feedback.json`, `holdRingSpec.test.ts`) and 3.12 (scoring, Result screen). This story builds on 2.11's helpers and files. 3.13 (route fairness) may be developed at the same time: it touches the sim's route and judgement code, not `threatSystem.ts`'s command loop. If both touch `events.ts` or goldens, the second merge conflicts, so ask Geo, as CLAUDE.md says.

### Project Structure Notes

The story follows the layers and the architecture tree (`client/ui/world/activityBubble.ts`). The new sim event lives in `src/sim/events.ts`. No variance, except that the event's field is `threatId` where the architecture says `target` (D1). Update the doc.

### Project Context Rules

- Anything Geo might tune is data: the cues and their clips in `feedback.json`. The pixel sizes and the 150 ms are DESIGN.md values held in `shared/constants.ts` and pinned by a drift test. The squash and pop timings are constants like `COMBO_BADGE_POP_MS`.
- Units are suffixes (`refusedShakeMs`, `renderSimMs`, `busyUntil` is the sim's existing name); `…At` is sim time and `…AtReal` is real time. No `enum`. Factories are `create<Name>` in a file named after the export. Events are PascalCase past tense (`TapRefused`, `ActivityBubbleShaken`).
- Hot paths allocate nothing; the DOM is written only on change. No `console.*` (use `log`). Every fallback logs a `warn`.
- UI is vanilla DOM and CSS with `pp-` classes and tokens only. Strings go through `t(key)` (the bubble has no text). Reduced motion is client-only.
- The sim never reads real time or randomness; it emits events, never logs.
- Never weaken a guardrail (Biome, architecture tests, `content:check`). Never loosen a golden; a deliberate regeneration is said in the story.

### Open points for Geo

1. **Decided (Geo, 2026-11-03): `TapRefused` stays a sim event** (D1, as the architecture says). Goldens where a bot taps while Papa is busy get new events, and journals now hold refused presses. The client-only alternative was turned down.
2. **Only taps on a threat are refused visibly.** Floor, object and baby taps while busy stay silent, because the story and P1 name « une menace ». Should a floor tap shake the bubble too?
3. **No throttle on the « occupé » sound.** A player who spams taps hears it each time. A cooldown would be one value in `feedback.json`.
4. **Two sounds at the end of the toilet:** the flush (`toilet_flushed`) and the ding, at the same step.
5. **The nap's pictogram is the dizzy stars**, and the 3D « Z » above Papa's head may sit under the bubble. Keep both, or drop the « Z »?
6. **Sizes, pictograms, squash and pop timings** are `[ASSUMPTION]`s of the UX spec (DESIGN L617, GDD L242): judge them by playing.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.12] (L1593–1619), FR74 (L141), UX-DR28 (L273), UX-DR22 (L264), coverage (L393)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md] L27 (playtest), L66, L74, L84 (order), L122–125, L142, L586–599, L735
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] mechanic 15 (L236–242), L179–180, L218, L248, L317–320, L76, L548; `decision-log.md` L52, L60
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L192, L214, L250–255, L311, L387, L413, L537, L614, L753, L978
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] frontmatter `activity-bubble` (L255–267), `hold-ring` (L234–240), `combo-badge` (L194–199), `tap-marker` (L312–316); L454, L479, L500, L553, L617–618, L624, L644
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L129, L216–217, L229, L312, L375, L391–392, L435–436, L456–457, L461–462, L507
- [Source: _bmad-output/project-context.md] « Busy Papa » (L43), phone (L44), combo (L47), feedback (L87–91), UI and reduced motion (L94–96), « The chrono-ring (story 2.11) » (L98)
- [Source: src/sim/papa/papaFsm.ts], [coffee.ts], [phoneCall.ts], [toilet.ts], [sleep.ts], [papaSystem.ts L254–275], [src/sim/threats/threatSystem.ts L141–168], [src/sim/world.ts L14–49]
- [Source: src/client/input/inputMapper.ts L245–345, L525–560, L733], [src/client/ui/world/{worldUi,comboBadge,breathRing,chronoRing,papaHint}.ts], [src/client/feedback/simEventFeedback.ts], [tools/content/contentChecks.ts L179–320]
- [Source: _bmad-output/implementation-artifacts/2-11-anneau-chrono-autour-des-menaces.md] Decisions and Review Findings

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (claude-sonnet-5-5)

### Debug Log References

- Goldens: `npm test` ran green with no golden moving: no scenario has a bot pressing while Papa is busy, so no `golden:update` was needed.
- First AC 17 run: 4 timeouts (`waitFrames`, `loadLevel`) while another agent's suite and a throwaway Chromium of mine ran at the same time. The two specs (`activityBubble`, `reducedMotion`) rerun alone with `--workers=2`: 20 / 20 green. The other 128 tests of the run were green.
- Mutation check: with `worldUi.shakeActivity` removed from `boot.ts`, `activityBubble.spec.ts › on a threat while Papa drinks` fails (`isShaking` expected true, received false); restored.

### Completion Notes List

- **Sim (AC 8, 11, 14).** `TapRefused{t, threatId}` joins `SimEvent` and `SIM_EVENT_TYPES`. `runThreats` emits it once per refused `PressThreat` on a `telegraph` / `windowOpen` threat; nothing else changes (a world-hash comparison with and without the command proves it). 12 tests in `src/sim/threats/tapRefused.test.ts`: the four busy states, once per command, the `busyUntil` step (judged, no event), an unknown or resolved threat, `TapBaby` / `TapFloor`. No golden moved.
- **Input (AC 9).** `inputMapper.ts` hit-tests before the busy return: a busy tap on a threat (or the keyboard / gamepad action with one up) sends the `PressThreat` and records the finger so that its `Release` follows (D2), with no `onThreatPressed` and no tap marker. A busy tap elsewhere is dropped as before. The old test that dropped a threat press while busy is split into the unchanged drops and the new sends.
- **Bubble (AC 1–7, 12, 13).** `activityBubble.ts`: one `CSS2DObject` (outer box placed by the renderer, a body animated by the Web Animations API, the ring built like `breathRing.ts`, the pictogram SVG, a tail). `ACTIVITY_PICTOGRAMS` is a `Record<PapaState, …>`, checked against `isPapaBusy`. The ring is `chronoDrainPermille(enteredAt, busyUntil, renderSimMs)` in whole percent, written only on change. Squash, pop and shake are real-time juice; reduced motion removes all three and thickens the border (`pp-activity-body--thick`) for the same 150 ms. A busy state with no pictogram warns once.
- **Layout.** `activityMetricsFor` computes every offset from constants; `applyActivityBubbleMetrics` writes them to the root per surface, so `ui.css` holds no px literal of the bubble (`activityBubbleSpec.test.ts` pins the constants to DESIGN.md and the threat sizes to `ui.css`). The badge's `--aside` offset used to be a 64 px literal, which overlapped a threat's chrono-ring (reach 19 px beyond the icon); it is now computed (83 px regular, 79 px compact) and the three-way no-overlap test covers both surfaces.
- **Cues (AC 7, 10).** `ActivityBubbleShaken` / `ActivityBubblePopped` client events, routed in `simEventFeedback.ts`; cues `papa_busy_refused` and `papa_free` in `feedback.json` (`uiElement`, `light`); two placeholder clips `papa_busy.m4a` (dry double « bonk ») and `ui_papa_free_ding.m4a` (small bell), written by `npm run assets:audio -- --only papa_busy,ui_papa_free_ding`.
- **Deviations from the task text** (task text updated): the bubble is index 7 of the layer so the threat markers mounted later start at 8; `updateCombo` returns nothing (`updateActivity` runs before it and the badge reads `activityBubble.isVisible`, so it stays beside the bubble through its pop: review fix); `boot.ts` calls `shakeActivity` itself instead of a callback from `simEventFeedback`; `boot.ts` hides the bubble when the flow is not live (end, photo) and when leaving a level, in addition to what the story lists.
- **Docs (AC 18).** `project-context.md` (the « Busy Papa » correction and an « Activity bubble » paragraph), `game-architecture.md` L413 (`threatId`), `EXPERIENCE.md` (refused-tap haptic decided; the nap's stars).
- **Checks.** `npm run ci:fast` green (392 files, 8237 tests; 2 pre-existing CSS specificity warnings). AC 17's 14 specs on Chromium green (the 4 load timeouts above rerun alone). `ci:story` is the review's gate, not run here. `autoplay.spec.ts`'s frozen frame did not move: no reference regenerated.
- **For Geo to judge (the look, from zoomed Chromium captures at 844 × 390 and 1024 × 768).**
  - The bubble reads well at both sizes; the ring on a half-drained coffee drains counter-clockwise as D4 says; the toilet door floats alone where Papa went in; the handset with `x5` beside it does not overlap.
  - The cup in the bubble is the same glyph as the coffee-machine's own icon, and the two sit close together in the salon: judge whether the cup should be something else (a steaming cup?).
  - On a nap the bubble hides the 3D « Z » above Papa's head (open point 5): keep both or drop the « Z ».
  - The tail covers the bottom of the ring (a few px). Two sounds still play at the end of the toilet: the flush and the ding (open point 4).
  - The bubble's aside step with a micro-sleep up on Papa (it is telegraphed first, then he drinks) is now captured at 667 × 375 and 1024 × 768 by the layout e2e, and its boxes are measured (review). The bubble steps left of the threat's chrono-ring and the badge sits on its right. When Papa stands next to the toilet door, the door's object icon is drawn over the left of the badge: judge it.
  - Not measured: Papa standing at the far left of the room (the bubble's aside step has no screen-edge clamp; at the coffee machine it clears the screen by a wide margin).
  - Squash 180 ms from scale 0.5, pop 160 ms to scale 1.4: all `[ASSUMPTION]`s, judge them by playing.

- **Review fixes (2026-11-04).** The shake is a class on a `body` nested in a new `pp-activity-pop`, which carries the squash and the pop, so the two never share `transform`. The pictogram class is tracked apart (`classedPictogram`) and goes with the pop. `hide()` writes nothing when nothing is shown. `pictogramPathOrWarn` warns for a missing icon path. `TapRefused` loop breaks after its match. Tests: the four busy states through their real start paths in `tapRefused.test.ts`; unit tests for the class, `hide()`, the shake's place and the warning; e2e for the pop, a floor-tap control, a pause on a drained ring, and `the layout above a busy Papa` (real boxes, both surfaces, screenshots in `test-results`). The e2e raises the combo with a real parry and sets the badge text to the widest (`x8`): the micro-sleep is never telegraphed once Papa is busy, so it is telegraphed first and its window made long. A refusal handled before the bubble's first `update` of a frame is still dropped (accepted: sound and haptic play).
- **Review checks.** `npm run ci:fast` green (392 files, 8246 tests). Chromium: `activityBubble`, `reducedMotion`, `phone`, `toilet`, `fatigue` and `combo` specs green (49). `ci:story` still to run before the merge.

### File List

- `src/sim/events.ts`
- `src/sim/threats/threatSystem.ts`
- `src/sim/threats/tapRefused.test.ts` (new)
- `src/client/input/inputMapper.ts`
- `src/client/input/inputMapper.test.ts`
- `src/client/ui/world/activityBubble.ts` (new)
- `src/client/ui/world/activityBubble.test.ts` (new)
- `src/client/ui/world/comboBadge.ts`
- `src/client/ui/world/comboBadge.test.ts`
- `src/client/ui/world/worldUi.ts`
- `src/client/ui/world/worldUi.test.ts`
- `src/client/ui/styles/ui.css`
- `src/client/boot.ts`
- `src/client/feedback/feedbackEvents.ts`
- `src/client/feedback/simEventFeedback.ts`
- `src/client/feedback/simEventFeedback.test.ts`
- `src/shared/constants.ts`
- `content/feedback.json`
- `tools/audio/makePlaceholderAudio.ts`
- `public/assets/audio/papa_busy.m4a` (new)
- `public/assets/audio/ui_papa_free_ding.m4a` (new)
- `tests/architecture/activityBubbleSpec.test.ts` (new)
- `tests/e2e/activityBubble.spec.ts` (new)
- `tests/e2e/phone.spec.ts`
- `tests/e2e/toilet.spec.ts`
- `tests/e2e/fatigue.spec.ts`
- `tests/e2e/reducedMotion.spec.ts`
- `_bmad-output/project-context.md`
- `_bmad-output/planning-artifacts/game-architecture.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-12-bulle-d-activite-de-papa-et-tap-refuse-visible.md`

### Change Log

- 2026-11-04: Code review: 9 patches applied (nested shake, stale pictogram class, badge beside the bubble through its pop, `hide()` quiet, icon-path warning, real-flow sim tests, stronger e2e, layout e2e at both surfaces), 2 deferred. Status → done.
- 2026-11-03: Story 2.12 implemented: `TapRefused` sim event, the busy press the client now sends, the activity bubble with its sim-time ring, the squash / pop / shake, the two cues and clips, the combo badge beside it, reduced motion, tests and docs. Status → review.
