---
baseline_commit: 231d5deb280c82adfe34cc7c0d67f1c71ad0a7b7
---

# Story 2.11: Anneau-chrono autour des menaces

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see how much time I have left and when to tap,
so that I can land a perfect parry on purpose.

Requirement: FR71 `[P]`, FR53, UX-DR27, UX-DR10. Second story of the v2.3 catch-up (sprint change proposal 2026-11-03, §3): « the main cause » of Geo's playtest, where nobody could land a perfect on purpose (no cue of the 0.8–1.5 s delay before a 100 ms perfect zone). Story 3.14 (realistic `human` bot) and 9.3 (offscreen bubble) reuse this ring; 9.4 (chores) draws it on chore beats.

## Acceptance Criteria

### The ring on a threat

1. **Which threats.** A `chrono-ring` is drawn around the icon of every threat whose def's `response` has one: `parry` and `firm` today (`dodge` when story 5.1 adds it). Never on `wait` (so never on a feint, which only a `wait` def carries) and never on `nothing`. The rule is one table typed on `ThreatResponse` (`Record<ThreatResponse, boolean>`), so a new response cannot compile without saying whether it has a ring. It holds whatever the threat stands on: an anchor, Papa (the micro-sleep, the cry in the arms), the baby (`real_wake`), a hidden zone once found. The bomb drop (`bomb_drop_lay`, a `firm` with `release`) has one (D1, open point 1).
2. **When it shows.** Only while its threat is `telegraph` or `windowOpen`. A marker kept up one more frame after a quick tap (`isPressed` on a resolved threat) shows no ring. A `hidden` silence shows no marker and no ring.
3. **The fill.** In sim time, from the telegraph instant (0) to the end of the shown window, `windowOpenAt + responseWindow.windowMs` (full). Clockwise from 12 o'clock. The hidden tolerance (`toleranceMs`), the buffer and `lagMs` are **not** drawn: the ring stays full from the end of the window until the threat leaves `telegraph` / `windowOpen` (gag or resolution). The ring's start is the telegraph instant as D3 defines it.
4. **The final arc.** The arc from `windowOpenAt` to the end of the window is the response window as frozen at the telegraph (`threat.responseWindow`, which already holds the tier, the fatigue and the instinct: `effectiveWindow`). It is drawn as track until the window opens, then **lights**: `{colors.alert}`, 8 px thick, growing outward so it never covers the hold-ring (DESIGN.md › chrono-ring). It lights when the drawn sim time reaches `windowOpenAt`.
5. **The notch.** A 2 px `{colors.ink}` tick across the final arc at the centre of the window (the perfect zone is centred: `judgePress`), visible from the telegraph on (D4). Its angle is fixed for the whole telegraph.
6. **The vibration.** When the window of a threat with a ring opens (`WindowOpened`), a short vibration plays once: a new client event `ChronoArcLit` in `FEEDBACK_CLIENT_EVENTS`, mapped in `feedback.json › events` to a new cue `chrono_arc_lit` (`visual: { kind: 'uiElement' }`, `haptic: 'light'`, no audio, no flash, no `fx`). A `wait` signal, a `nothing` and any threat with no ring play nothing new. A ring def that has its own signal cue (`feedback.signal`: the bomb drop's « LÂCHE ! », which already vibrates at that very step) plays no `ChronoArcLit` either: one moment, one vibration. `content:check` passes unchanged (a client event with a `uiElement` twin, as `noise_alert`).
7. **Look.** Paper progress over a `{colors.ring-track}` track, 5 px band, 2 px ink outer outline, outside the hold-ring with a 2 px gap; never `parry` or `dodge` coloured; colour-blind safe by the 8 px thickness of the lit arc, not its hue (GDD › Accessibilité). Every pixel size is a constant in `shared/constants.ts` (the two hold-ring constants reused for the band and the outline, plus `CHRONO_RING_GAP_PX`, `CHRONO_RING_FINAL_ARC_STROKE_PX`, `CHRONO_RING_NOTCH_PX`), and a drift test pins them, the tokens and `direction: clockwise` to DESIGN.md's `chrono-ring` frontmatter (beside `holdRingSpec.test.ts`).
8. **Nothing overlaps.** At both surfaces (`--pp-threat-size` 56 and 64 px), the hold-ring, the chrono-ring (lit arc and its outline included), the target-highlight (its 4 px border and both ink shadows included) and the verb stack do not overlap: the highlight and `--pp-verb-gap` move out by what the ring adds (D9). A unit test pins the radii from the constants; a look at a screenshot confirms it.

### Time

9. **Game time only.** The ring is computed each frame from the world and the drawn sim time (`renderSimMs`, the value the hold-ring already gets: `world.time.sim − STEP_MS × (1 − alpha)`), never from real time and never from events. So it slows with a slow-mo (perfect, last threat, instinct, sequence), freezes in a hitstop (no step runs) and stops in the pause, with no code for any of them. No `performance.now()`, no timer, no CSS transition or animation on it.
10. **Reduced motion.** Unchanged (EXPERIENCE.md: « Unchanged, because it is gameplay timing »). It has no animation, so it needs no `:where(:root[data-pp-motion="reduced"])` rule; `designTokens.test.ts` must stay green.

### Firmness

11. **The hold drains.** On a `firm` def with `holdUntilMs`, while its press is down (`threat.press !== null && press.releasedAt === null`), the chrono-ring **drains** from full at `press.t` to empty at the end of the attack, `holdEndAt(press.t, windowOpenAt, holdUntilMs, holdMinMs)` (`src/sim/timing/holdEnd.ts`, exported through `@sim` so the client and the sim share one definition). The lit arc and the notch are not drawn during the drain (class `pp-chrono-ring--hold`); the hold-ring fills inside as today. On release the ring goes with its threat (resolved or gag). A `firm` with `release` (the bomb drop) does not drain: its window is the release, so the ring keeps filling (D5).

### The suspicious silence

12. **A ring beside the bubble.** While the `silence-bubble` shows, a ring of the same look (paper over `ring-track`, 5 px band, 2 px ink outline; no lit arc, no notch, no vibration) sits beside it on the side of the screen centre, and fills from `world.silence.startedAt` to `startedAt + findMaxMs` (the silence def's `findMaxMs`, the same instant `runSilence` times out on), in drawn sim time. It does not blink with the bubble (it is a sibling, not a child). It hides with the bubble (found, timed out, level end, pause, restart).
13. **Then the usual ring.** Once the baby is found (`SilenceEnded{found}`, then `telegraphThreat`), the threat's own marker shows with its ring (AC 1–5), from its telegraph.
14. **HUD budget.** The silence ring lives in `#pp-hud`, so it counts against `HUD_MAX_DOM_NODES` (40): at most 3 nodes, and `silence.spec.ts` asserts the budget with the bubble and the ring up.

### Mirrors and the perfect bot

15. **The judged mirror.** On a `ResponseResolved` of a threat with a ring whose `offsetMs` is not null, the client mirrors `data-pp-chrono-judged` (`ppChronoJudged`, debug and playtest builds only) as `<t>:<threatId>:<pressPermille>:<arcFromPermille>:<notchFromPermille>:<notchToPermille>`, where the press instant is `windowOpenAt + windowMs / 2 + offsetMs` and every per-mille comes from **the same pure function that draws the ring**, on the ring geometry the marker holds for that threat. `notchFrom` / `notchTo` are the perfect zone (`± perfectMs / 2` around the centre). `<t>` keeps two identical judgements distinct. `ppChronoJudged` joins the debug markers of `tools/build/inspectDist.ts`, so `dist:check --flavor prod` refuses it.
16. **Every perfect press is in the notch.** New `tests/e2e/chronoRing.spec.ts`: `?autoplay=perfect` on `salon_crawler` collects `data-pp-chrono-judged` with a mutation recorder (as `photo.spec.ts` does) until at least 5 ring judgements, and checks each one: `arcFrom ≤ press ≤ 1000` and `notchFrom ≤ press ≤ notchTo`.

### Tests and docs

17. **E2E (Chromium, the spec above, frozen level through the test API).** On the forced outlet: no ring before the telegraph; ring visible at the telegraph with a progress near 0; after `n` steps its progress matches `n × STEP_MS / (delay + window)` from the live def and feel, to the per-mille's rounding; not lit before `windowOpenAt`, lit (`pp-chrono-ring--lit`) at the step that opens the window; full at the end of the window; gone after the threat resolves. Frozen frames (no step) leave it unchanged, and a real pause (the pause button, as `pauseResume.spec.ts` does, on a running level) too. With `ForceInstinct` and with `SetDifficultyTier assistance`, the lit arc's share grows as `responseWindow.windowMs` says. `cueLog()` holds `chrono_arc_lit` once at the opening, and a `light` vibration is recorded (Chromium). Served as a Firmness (`holdRing.spec.ts`'s route), a held press switches the ring to `--hold` and its progress falls. The silence (in `silence.spec.ts`): the side ring shows on `SilenceStarted`, its progress grows with the steps to full at `findMaxMs`, and after a find the marker's ring takes over; the HUD node budget holds. No ring on the bedtime duel's `wait` threats, on the fake sleep's feint and on the stealth false alarm (one assertion added to `bedtimeDuel.spec.ts`, `fakeSleep.spec.ts`, `stealthExit.spec.ts`).
18. **The frozen screenshot.** `autoplay.spec.ts`'s frozen frame shows a threat half-way through its telegraph, so its ring is now in it: regenerate the two macOS references deliberately (`npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`), look at them, and say so in the Completion Notes. Nothing else may move in them.
19. **No sim change.** `src/sim` changes only by one export in `index.ts`. No feel key, no world field, no event, no command: `npm test` passes with **no golden regenerated**. If a golden moves, it is a bug.
20. **Docs.** `project-context.md` gets a « The chrono-ring (story 2.11) » paragraph (which threats, the geometry, the time base, the drain, the silence ring, the client event, the mirror). `EXPERIENCE.md` › chrono-ring row: the notch shows from the telegraph, the bomb drop has a ring, the hold drains from full (if the decisions stand). `game-architecture.md` L977 is already right; check it.

## Tasks / Subtasks

- [ ] Task 1: The pure geometry (AC: 1, 3, 4, 5, 11, 15)
  - [ ] New `src/client/ui/world/chronoRing.ts`: `hasChronoRing(response)` (the typed table), `chronoRingStartAt(...)` (D3), `chronoRingOf(startAt, windowOpenAt, window)` → `{ startAt, closeAt, arcFromPermille, notchPermille, notchFromPermille, notchToPermille }`, `chronoProgressPermille(ring, simMs)` (clamped 0–1000, whole), `chronoDrainPermille(pressT, endAt, simMs)`
  - [ ] `export { holdEndAt } from './timing/holdEnd.ts'` in `src/sim/index.ts` (public API, pure)
  - [ ] Unit tests: 0 at the start, `delay / (delay + window)` at the opening, 1000 at the close and after it, before-start clamp, notch at the centre and its range, a window stretched by each modifier (tier, fatigue, instinct, through a frozen `responseWindow`), the start fallback, the drain (full at the press, 0 at the end, `holdMinMs` wins when later), the table (`wait`, `nothing` false)
- [ ] Task 2: The ring in the threat marker (AC: 1–5, 7–11)
  - [ ] Constants in `shared/constants.ts`; the drift test beside `holdRingSpec.test.ts` (D9)
  - [ ] `ThreatMarkerDef` and `ThreatMarkerEntry` gain what the ring needs (has a ring, the telegraph delay, `holdUntilMs`), set once in `threatMarkerEntries`
  - [ ] The ring element in `createMarker` (only for entries with a ring), drawn by an `updateChronoRing` beside `updateHoldRing`, from `renderSimMs` and `holdMinMs` already passed to `update`: geometry written once per telegraph, progress only when the per-mille changes, `--lit` and `--hold` only when they flip; zero allocation per frame
  - [ ] CSS in `ui.css`: the ring, the lit arc, the notch, `--hold`; the highlight and `--pp-verb-gap` moved out (AC 8); declare every custom property it reads (`designTokens.test.ts`)
  - [ ] `threatMarkers.test.ts`: ring present per response kind and absent on `wait` / `nothing` / a feint def, hidden outside `telegraph` / `windowOpen` and on the resolved press frame, progress and lit state from `renderSimMs`, DOM written only on change, the drain on a `holdUntilMs` def and not on a `release` def, the radii do not overlap at both sizes
- [ ] Task 3: Vibration and mirror (AC: 6, 15)
  - [ ] `ChronoArcLit` in `FEEDBACK_CLIENT_EVENTS`; `chrono_arc_lit` cue and the `events` row in `content/feedback.json`
  - [ ] `boot.ts`: on `WindowOpened` of a ring def with no `feedback.signal`, `director.handle('ChronoArcLit', null)` (the `InstinctVignetteShown` pattern); on `ResponseResolved`, `ppChronoJudged` from `worldUi`'s ring geometry (a getter that allocates nothing per frame; per event is fine)
  - [ ] `ppChronoJudged` in the `mirror()` name union and in `tools/build/inspectDist.ts`; `feedbackDirector.test.ts` / `feedbackTwins.test.ts` as needed
- [ ] Task 4: The silence ring (AC: 12, 13, 14)
  - [ ] Extend `silenceBubble.ts` (or a sibling `silenceRing` in `ui/hud/` built from `chronoRing.ts`'s helpers): placed beside the bubble on the centre side, filled from `startedAt` over the def's `findMaxMs` at `renderSimMs`; written only on change
  - [ ] `boot.ts` passes the drawn sim time and the silence def's `findMaxMs` (from the level's threat defs, by `world.silence.threatId`)
  - [ ] `silenceBubble.test.ts`: placement on both sides, fill, hidden with the bubble
- [ ] Task 5: E2E and screenshots (AC: 16, 17, 18)
  - [ ] New `tests/e2e/chronoRing.spec.ts`; additions to `silence.spec.ts`, `bedtimeDuel.spec.ts`, `fakeSleep.spec.ts`, `stealthExit.spec.ts`
  - [ ] Regenerate and look at the two `autoplay-frozen-*-darwin.png`
  - [ ] Run the specs the change touches on Chromium: `chronoRing`, `holdRing`, `silence`, `threat`, `threats`, `autoTarget`, `ui`, `reducedMotion`, `feedback`, `juice`, `testApi`, `autoplay`, `bedtimeDuel`, `fakeSleep`, `bombDrop`, `stealthExit`, `carry`, `fatigue`
- [ ] Task 6: Docs and checks (AC: 19, 20)
  - [ ] `project-context.md`, `EXPERIENCE.md`; `npm run ci:fast` after each task; `npm run build` + `npm run dist:check -- --flavor prod` once (the new marker)
  - [ ] Look at the ring in play on both levels (screenshots: a telegraph, a lit arc, two threats, the micro-sleep on Papa, the silence ring) and say in the notes what Geo should judge

## Dev Notes

### Decisions

- **D1. The ring follows the response, nothing else.** FR71 and the GDD name Parer, Fermeté and Esquiver; the exclusions are Attendre, Ne rien faire and the feints, which are all `wait` or `nothing` defs today (a `feint` is refused on any other def). So one typed table on `ThreatResponse` says it, and the target (anchor, Papa, baby, hidden zone) does not matter. The micro-sleep has a ring (the GDD's threat table lists « anneau-chrono » for it). **The bomb drop has one too:** it is a Fermeté, its descent is visible anyway (the baby is lowered), and its window is the release. If Geo wants the pose read without help, a `hasChronoRing` override on the def would be the next step, not a rule in code (open point 1).
- **D2. What the ring shows.** Start = the telegraph, full = the end of the window (`threatCloseAt`, `client/input/urgency.ts`, already the one definition). The tolerance (60 ms) and `lagMs` are not drawn (GDD: « la tolérance cachée n'est pas dessinée »). The ring stays full until the sim settles the threat, so a press in the tolerance looks « just in time », which is the point of a hidden tolerance.
- **D3. The start instant.** `ThreatInstance` has no `telegraphedAt` and **must not get one** (a world field moves the snapshot version and every golden for a client need). In `telegraph`, the start is `threat.enteredAt` (exact). The marker remembers it with the `windowOpenAt` it saw; in `windowOpen` (where `enteredAt` is the opening step), it uses the remembered start when `windowOpenAt` is the same, and otherwise (a marker that first sees the threat open, after a `loadLevel` or a snapshot restore) `windowOpenAt − (def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs)`. That fallback is exact for every def with a ring: `telegraphThreat` adds a signal delay only for a `wait` (`signalDelayMs`), and a release draws nothing.
- **D4. The notch shows from the start.** It is the target: seeing it only when the arc lights would leave 150 ms to aim. The lit arc is the « now » cue, the notch the « here » cue. DESIGN draws the notch as one tick; the perfect zone's width is in the mirror for the test, not on screen (open point 2).
- **D5. The drain.** EXPERIENCE: « During a Fermeté hold, the hold-ring fills inside while the chrono-ring drains to the end of the attack. » The end of the attack is `holdEndAt` (story 1.23 D1), so the client imports it rather than re-deriving it. The drain starts full at the press (the tap that started it is already judged: the old fill means nothing after it) and the lit arc and notch go, since the window they marked is behind. A `release` Firmness (story 4.8) is the opposite case: the press opens it and the release is judged in the window, so it keeps the normal fill. No live content has a `holdUntilMs` def: test through the fixtures and `holdRing.spec.ts`'s served Firmness.
- **D6. The vibration goes through a client event.** `WindowOpened` cannot be mapped in `feedback.json › events` as is: it would vibrate for every `wait` and `nothing` too, and a sim event's cue may not have a `uiElement` visual (`contentChecks.ts`). `boot.ts` filters on the def (a ring, and no `feedback.signal`) and sends `ChronoArcLit`, as it sends `InstinctVignetteShown` for `InstinctTriggered`. `light` (15 ms) is « courte »; telegraphs are `light` too, and they are told apart by their moment, which is the information. The vibration is an event (exact step); the lit arc is state (the drawn frame): they can differ by a frame, which is fine.
- **D7. The mirror is computed, not read off the DOM.** At `speed=4` a frame is about 64 ms of sim time and the perfect zone is 100 ms wide: a drawn frame can miss the press by more than half the notch. The e2e therefore checks the per-mille the ring **would draw** at the press instant, with the same function that draws it every frame (AC 15). The drawing itself is pinned by the frozen e2e (AC 17) and the unit tests.
- **D8. The silence ring is in the HUD, not in the world.** The bubble is screen-anchored (it points at a zone the player may not see); its ring must be next to it. No lit arc and no notch: finding the baby has no window, only a deadline. No vibration: `SilenceStarted` already vibrates.
- **D9. The marker's footprint grows.** Today, from the icon's centre (R = 32 px at 64, 28 at 56): hold band R → R+5, its outline to R+7; with a 2 px gap the chrono band is R+9 → R+14, outline to R+16; the lit arc R+9 → R+17, outline to R+19. The highlight (`inset: size × −0.3`, a 4 px border and 2 px ink shadows inside and out) spans about R+15.2 → R+21.2 at 64 px and R+12.8 → R+18.8 at 56: **it overlaps the ring**. The verb stack's bottom is `--pp-verb-gap` (`size × 0.3 + 2px`) above the icon: R+21.2 at 64, 2 px clear of the lit arc's outline, but under the moved highlight. Move the highlight out past the ring (with a gap) and push `--pp-verb-gap` out by the same amount, both derived from the constants (an inline custom property written once, as the hold-ring's `inset`), not from new literals. The glyph chip hangs from `--pp-verb-gap` and follows.
- **D10. Rendering.** Recommended: one inline SVG per marker (`aria-hidden`, `overflow: visible`, centred on the icon, `pointer-events: none`): an ink outline circle, the track, the lit-arc circle (`stroke-dasharray` over the arc, radius moved out so it grows outward), the progress circle (`stroke-dashoffset`), the notch (a short line, rotated). The radii depend on `--pp-threat-size`: read the size when the marker refits (a surface change), never per frame, and write the radii then. Progress in per-mille through a prebuilt table of strings (the hold-ring's `HOLD_PROGRESS_PCT` pattern: no per-frame concatenation). Draw order: the paper progress must not hide the lit arc entirely (the outer 3 px of the 8 px arc stay `alert` as it fills); check it on a screenshot. A conic-gradient build like the hold-ring is acceptable if it meets AC 4–8 on WebKit too; the notch is the hard part there.

### Current state of the files this story changes

- **`client/ui/world/threatMarkers.ts`.** `createMarker` builds halo, hold, highlight, verb stack, icon (that order is the stacking order). `update` is the per-frame loop: visibility from `telegraph | windowOpen | isPressed`, the carried verb, the signal / feint swap, Papa / baby following, `updateHoldRing(marker, threat, renderSimMs, holdMinMs)`, the highlight. `updateHoldRing` is the model to copy: whole-percent strings, `HOLD_HIDDEN`, writes only on change. `threatMarkerEntries` builds one entry per threat from its def (`ThreatMarkerDef` is the slice a marker reads: add the ring's fields there). `refit` runs on mount, resize, fonts and surface change (`layout` detects the surface): the place to recompute the radii.
- **`client/ui/world/worldUi.ts`.** Passes `updateThreats` through to the markers; `threatEntries` is read by `boot.ts`'s mirrors. Add the read-only access the mirror needs (D7).
- **`client/ui/hud/silenceBubble.ts`.** Screen-anchored, placed on `left` / `right` from the zone's projection, `top` clamped under the HUD row and above the bottom third; `update(isSilent, world)` once per frame, `relayout()` on resize; the bubble's blink is CSS on the element itself (so the ring must be a sibling).
- **`client/boot.ts`.** The frame loop calls `worldUi.updateThreats(world.threats, highlightedThreatId, targetedId, papaPose, world.time.sim − STEP_MS × (1 − alpha), holdMinMs, isCarried)` (≈ L1240): the ring needs nothing more there. `silenceBubble.update(isSilent && pause.state === 'running', babbleWorld)` (≈ L1189): it needs the drawn sim time and the def's `findMaxMs`. Sim events go through the handler around L1400–1430 (`InstinctTriggered` → `director.handle('InstinctVignetteShown', null)`): `WindowOpened` and `ResponseResolved` go there. `mirrorThreatEvent` (≈ L826) is where the threat mirrors live. `mirror()`'s name union (≈ L290) and the mirror reset list (≈ L733) need the new name.
- **`client/feedback/feedbackEvents.ts`.** `FEEDBACK_CLIENT_EVENTS`; `tools/content/contentChecks.ts` reads it (a client event's cue may only have a `uiElement` visual).
- **`src/sim/index.ts`.** Public API; `holdEndAt` is not exported yet.
- **`src/client/ui/styles/ui.css`.** `.pp-threat` (L1848) and its size tokens (L1839–1845), `.pp-threat-halo` (`inset: size × −0.55`), `.pp-threat-highlight` (`inset: size × −0.3`), `.pp-threat-hold` (conic fill), `.pp-threat-verb-stack` (`--pp-verb-gap`), the glyph chip (`--pp-chip-half`, `--pp-verb-gap`), `.pp-silence-bubble` (L2212, `z-index: 35`, 76 × 58, blink 2 Hz).

### What must keep working

- The hold-ring, the highlight's 50 ms latency mark (`update` returns true on a press's rising edge), the verb layout and the glyph chip, the signal / feint swap of `wait` markers, the carried verb, the markers that follow Papa or the baby.
- `threatCloseAt` stays the one definition of urgency (auto-target, verb order).
- **No file in `render/views/` reads `windowOpenAt`** (project-context, 7.2). The ring is in `ui/world/`, like the urgency; it is still a read of `windowOpenAt`, so it must stay off every `wait` def (AC 1): the GDD's pillar 1 and the 4.6 rule (« the client must never read `windowOpenAt` of a `wait` threat for anything visible »). A unit test pins that a `wait` entry has no ring element at all.
- The music, the instinct vignette, the silence bubble's placement and blink, the HUD row.
- Perf: at most a handful of rings at once; DOM writes only on change; nothing allocated per frame. `perf.spec.ts` should not move.

### Traps

- **`enteredAt` is the last state change**, not the telegraph: in `windowOpen` it is the opening step (D3).
- **`windowOpenAt` may be off the step grid**; the lit test is `renderSimMs >= windowOpenAt`, not a step count.
- **The pressed marker survives its threat by a frame** (`isPressed` on a resolved threat): hide the ring on state, not on `isShown`.
- **A `firm` def's press is a Parry until `holdMinMs`** (ADR-010): the drain starts at the press anyway (D5), on `holdUntilMs` defs only. On a `parry` def a held finger is a `wrongResponse` at `holdMinMs`; no drain there.
- **`designTokens.test.ts`** refuses an undeclared `var()`, a colour literal, a transition or keyframe on sizes or borders, and an animation without its reduced rule. The ring has no animation: keep it that way (the « lights up » is a class flip).
- **`content:check`**: the new cue has no audio, a `uiElement` visual and a haptic; `feedbackTwins.test.ts` checks the twin. Run `npm run content:check`.
- **The HUD node budget** (`#pp-hud *` ≤ 40) is asserted by several specs (`ui`, `sequence`, `carry`, `fatigue`, `noise`, `timer`, `toilet`); a silence never coexists with a sequence (`sequenceRefusal`), but measure with the bubble up.
- **`autoplay.spec.ts`'s screenshot moves** (AC 18): regenerate on purpose, on macOS, both browsers. Do not touch Linux (there are no Linux references: Geo's call).
- **The silence bubble hides during the pause** (`isSilent && pause.state === 'running'`): its ring hides with it. AC 12 is about the bubble's lifetime; the pause AC (9) is about the threat rings.
- **The test API's `ppAdvance` runs steps with no frame in between**: let a frame render (`waitFrames`) before reading the DOM.
- **`VITE_DEBUG_ALLOWED=false` may be exported** in the agent shell: `env | grep VITE_` first, `(unset VITE_DEBUG_ALLOWED; …)` for `dev`, `e2e`, `ci` (it was not set when this story was created).
- **The worktree guard** refuses compound shell commands that name `git` and commands with a computed program or a shell variable in an option position: plain commands and the edit tools.
- **The Mac sleeps during long background runs**: `caffeinate -i -s` for `ci:story`.

### Out of scope

- The offscreen bubble (9.3) and chore beats (9.4): they reuse `chronoRing.ts` later; keep its helpers free of threat-marker details.
- The `human` bot's read error with and without the ring (3.14).
- Longer telegraph delays « now that the ring shows them » (GDD note for the designer): a playtest call, `feel.json` only.
- The activity bubble's draining ring (2.12): a different ring on Papa; nothing to share yet beyond the constants.
- The debug timeline (2.1): nothing to add; it already shows the window and the perfect zone.

### Architecture compliance

- `src/client/ui/world/chronoRing.ts` is where the architecture names it (L537, L614, L977); world-anchored UI is DOM in the `CSS2DRenderer` layer (ADR-008), vanilla TS, `pp-` classes.
- « Anneaux ancrés au monde (v2.3) » (architecture L214): computed in `simTime` from the `World` (telegraph, effective window); no real-time timer. That is AC 9.
- The client only reads the world; the sim is untouched except one export of a pure function through `@sim`. No deep import of `src/sim/...`.
- Feedback goes through `FeedbackDirector` and `feedback.json`; the haptic goes through `Platform.haptics` (no `navigator.vibrate` outside `src/platform`).
- Debug mirrors only behind `isMirrored`; the prod build must not contain `ppChronoJudged` (`dist:check`).

### Library and framework notes

Stack pinned (`three@0.186.1`, CSS2DRenderer addon); nothing to add or upgrade, so no version research. Web facts the implementation relies on: SVG `stroke-dasharray` / `stroke-dashoffset` on a `<circle>` start at 3 o'clock, so rotate the SVG (or the circle) by −90° for 12 o'clock and keep the direction clockwise; CSS2DRenderer writes only the outer element's `transform` and `display`, so the ring can be a child of the marker element.

### File structure

- **New:** `src/client/ui/world/chronoRing.ts` and `chronoRing.test.ts`, `tests/e2e/chronoRing.spec.ts`.
- **Updated:** `src/client/ui/world/{threatMarkers,worldUi}.ts` and their tests, `src/client/ui/hud/silenceBubble.ts` and its test, `src/client/boot.ts`, `src/client/ui/styles/ui.css`, `src/client/feedback/feedbackEvents.ts`, `src/client/app/levelSession.ts` (only if the entries need the live feel's default delay), `src/shared/constants.ts`, `src/sim/index.ts`, `content/feedback.json`, `tools/build/inspectDist.ts`, `tests/architecture/holdRingSpec.test.ts`, `tests/e2e/{silence,bedtimeDuel,fakeSleep,stealthExit}.spec.ts`, `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-{chromium,webkit}-darwin.png`, `_bmad-output/project-context.md`, `EXPERIENCE.md`.
- **Not touched:** `src/sim/**` (except `index.ts`), `content/feel.json`, `content/threats/**`, `tests/golden/**`.

### Testing

- **Unit (Vitest, colocated):** the pure functions of `chronoRing.ts` with literal windows and a frozen `EffectiveWindow`; `threatMarkers.test.ts` with the existing fake `doc` and fake threats (the hold-ring tests are the model); `silenceBubble.test.ts`; the drift test on DESIGN.md.
- **E2E (Chromium):** frozen level, `ForceThreat`, `ppAdvance`, `waitFrames`, then read the ring's custom properties and classes; the perfect bot through the mirror (AC 16). Bounds from the live def and feel, never literals. Tests that can fail: assert on elements that exist (the 3.5 review's lesson: `.every` on an empty list passes).
- **Checks:** `npm run ci:fast` per task, plus the touched specs on Chromium (Task 5). `ci:story` belongs to the review.

### Previous story intelligence

- **2.10:** reduced motion is client-only and every reduced rule is `:where(:root[data-pp-motion="reduced"])`; nothing flashes above 3 Hz (`flashRate.test.ts`); verbs can be shifted sideways (`--pp-verb-shift-x`): the ring is on the icon, not on the verb, so it does not shift. Its review deferred « E2E compares two real-time autoplay runs » as a flake risk: the perfect-bot spec here checks each judgement on its own, not two runs against each other.
- **3.6 (last story):** tests that could not fail were the review's main topic (an empty-canvas check that passed on a blank capture); read mirrors with a mutation recorder rather than polling; a new client event goes with `FEEDBACK_CLIENT_EVENTS`, the `events` row and `content:check`; a new mirror goes into `inspectDist.ts`.
- **1.23 (hold-ring) and 4.9 (breath ring):** the ring model to copy (progress strings built once, `-1` hidden, write on change, sizes from `constants.ts` pinned by `holdRingSpec.test.ts`). `holdRing.spec.ts` serves the outlet as a Firmness with a Playwright route: reuse it for the drain.
- **4.6 / 4.7:** the client must never use `windowOpenAt` or `feintAt` of a `wait` for anything visible. The marker reads `isFeintGiven` only. AC 1 keeps the ring off them by construction.
- **4.8:** a `release` def has no `carriedVerb` and its verb swaps at the signal; the ring adds the fill under it.

### Git intelligence

The last commits are the v2.3 course correction (`epics.md`, sprint status, UX and architecture updates) and the merges of 3.6 and 7.3. 7.3 restyled the halo (`alert` reserved hue); nothing in it touches the marker's DOM. 3.12 (note on five rows) comes first in the delivery order and touches scoring and the Result screen, not the markers: no file conflict expected beyond `content/feedback.json`, `project-context.md` and `sprint-status.yaml` (merge those by hand).

### Project Structure Notes

Follows the layers and the architecture tree (`client/ui/world/chronoRing.ts`). The silence ring sits in `client/ui/hud/` because the bubble does. No variance.

### Project Context Rules

- Anything Geo might tune is data: the cue in `feedback.json`; the pixel sizes are DESIGN.md values held in `shared/constants.ts` and pinned by a drift test (not tunables).
- Units are suffixes (`arcFromPermille`, `findMaxMs`, `renderSimMs`); `…At` is sim time; no `enum`; factories `create<Name>`; files named after their export.
- Hot paths allocate nothing; DOM writes only on change; no `console.*` (use `log`); every fallback logs a `warn`.
- UI is vanilla DOM + CSS, `pp-` classes, tokens only (no colour literal); reduced motion client-only; nothing faster than 3 Hz.
- The sim stays pure; the client reads the world and never writes it.
- Never weaken a guardrail (Biome, architecture tests, `content:check`); never loosen a golden; screenshots regenerated only on purpose and said.

### Open points for Geo

1. **The bomb drop gets a ring** (D1). Its pose is the cue « LÂCHE ! »; the ring may make it too easy. Say if it should be read without help.
2. **The notch is visible from the telegraph** (D4), as a single tick at the centre. The perfect zone (100 ms) has no width on screen.
3. **Telegraph delays.** The GDD asks whether to lengthen them (0.8–1.5 s → 1.5–2.5 s) now that the ring shows them: to play and tune in `content/threats/*.json` after this story.
4. **The silence ring's place and size** (beside the bubble, its height): an `[ASSUMPTION]` of the UX spec; judge it by playing.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.11], FR71, FR53, UX-DR27, UX-DR10
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md] §1 (playtest evidence), §3 (order), §4.3, §4.8, §4.9
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] mechanic 12 « Anneau-chrono » (L198–213), haptics (L300), threat table (L317–322), Accessibilité (L427); `decision-log.md` L40, L51
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L192, L214, L537, L614, L977
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] frontmatter `chrono-ring` (L241–254), colour rules (L454, L461, L479, L500–501, L567), component (L615), Do / Don't (L641)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L127, L224, L433–434, L462, L538
- [Source: _bmad-output/project-context.md] « Time & input judgement », « The suspicious silence », « The Wait response », « The fake sleep », « The bomb drop », « Fatherly Instinct », « Feedback, rendering, UI »
- [Source: src/sim/threats/threatFsm.ts] `telegraphThreat`; [src/sim/timing/effectiveWindow.ts], [judge.ts], [holdEnd.ts]; [src/sim/baby/silence.ts] L130
- [Source: _bmad-output/implementation-artifacts/1-23-fermete-optionnelle.md], [4-9-sortie-en-infiltration-reponse-ne-rien-faire.md] (breath ring), [3-6-photo-de-fin-figee.md] Review Findings

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
