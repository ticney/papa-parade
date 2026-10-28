# Story 1.23: Firmness (optional)

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.23 « Fermeté (optionnelle) » (L1153-1182). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want a hold on a threat to mean « hold firm »,
so that I have a second response that the same gesture tells apart.

**Requirements covered:**
- **FR3 `[P]` (if time allows), Firmness:** hold on the threat for at least 0.4 s; the press lands in the 300 ms window and the hold lasts until the end of the attack (GDD § Les cinq réponses, L127).
- **UX-DR14, the `hold-ring`:** a 5 px ring around the pressed threat icon fills in `holdMinMs`; released before, it is a Parry; when it closes it turns solid `paper` with a pop and a medium haptic: Firmness (DESIGN.md L230-236 and L535, EXPERIENCE.md L215 and L418).
- **ADR-010:** one threshold, `holdMinMs` (400). A release before it is a Parry, a hold to it or past it is a Firmness, decided at the release or at `holdMinMs` (architecture L183, L222, L310, L732).

**What this story is not:**
- No live threat asks for Firmness yet. `salon_crawler` keeps its three threats, the micro-sleep and the silence, all `parry` (D5). The first live Firmness threats come with their age (« Tenir le bébé qui gigote pendant le change », E5; the crying baby, 5.5).
- No « Firmness forbidden while carrying the baby » (E4, story 4.1: `classifyPress.ts` and the « POSE-LE D'ABORD ! » verb).
- No sniff (1 s hold on the baby) and no breath-ring (story 4.9). They will reuse the ring built here.
- No verb label « TIENS ! » (story 2.2 adds verbs, shapes and colours to the def).

**Sources:**
- Epics `epics.md` L1153-1182 (the story), L408-410 (Epic 1).
- GDD `gdds/gdd-papa-parade-2026-10-26/gdd.md` L120-143 (the five responses and the input rules), L165 (one hand while carrying: E4).
- Architecture `game-architecture.md` L183 (tap / hold table), L222 (judgement), L310 (ADR-010), L408 (`reason: … 'released' …`), L578 (`src/sim/timing/`), L730-733 (edge cases: Firmness, wrong response), L1140.
- UX `DESIGN.md` L230-236 (`hold-ring` frontmatter), L387 (`ring-track`), L535 (prose); `EXPERIENCE.md` L123 (tier 1, full opacity), L215 (component), L361 (hold rule), L376 (world-anchored CSS2D), L418 (juice), L598 (open item: Firmness in E1).
- Project context `_bmad-output/project-context.md` L53 (one threshold), L165 (edge cases: « Firmness released before `holdUntilMs` = gag; wrong response type inside the window »).
- Deferred work `deferred-work.md` L204: « Bots know only Parry … story 1.23 (Firmness) fails to typecheck until the bots learn it ». This story closes it.

## Acceptance Criteria

Numbers in `feel.json` and the threat JSON are the live starting values. Tests use the frozen `tests/support/testFeel.json` (`holdMinMs` 400), never the live file.

### The Firmness judgement (sim)

1. **The def.** `ThreatDefSchema` accepts `response: "firm"`, and a `firm` def carries `holdUntilMs`: from the opening of its window to the end of the attack, in sim ms (D1, D2).
   - `holdUntilMs` is required when `response` is `firm` and refused otherwise (a `parry` def that has it fails, naming `holdUntilMs`).
   - `content:check` refuses a `firm` def whose `holdUntilMs` is not longer than its base window (`windowMs ?? feel.timing.windowMs`), naming the file and the key.
   - The JSON Schemas are regenerated (`npm run content:schemas`).

2. **Held to the end: success** (epics AC 1). Given a `firm` threat, when the press lands in the window (perfect or success, as `judgePress` rates it) and the finger stays down at least `holdMinMs` and until the attack ends (`windowOpenAt + holdUntilMs`), then the sim emits `ResponseResolved{response: "firm", quality, offsetMs}`. The quality and offset are the press's.
   - The threat resolves at the first step at or after `max(press.t + holdMinMs, windowOpenAt + holdUntilMs)`. No release is needed. A later `Release` changes nothing.
   - A release at or after that instant gives the same result, at the step that processes it.
   - The usual effects of a success follow, unchanged (`resolveThreat`): the hitstop, the perfect slow-mo, the last-of-wave slow-mo, Rire +1 on a perfect.

3. **Released too soon: gag** (epics AC 2). Given the same threat:
   - released before `holdMinMs`: that is a Parry, so `ResponseResolved{fail, reason: "wrongResponse"}` and `GagTriggered{reason: "wrongResponse"}`;
   - released at or after `holdMinMs` but before the attack ends: `ResponseResolved{fail, reason: "released"}` and `GagTriggered{reason: "released"}`, at the step that processes the release.
   - `offsetMs` is the press's in both cases. `FailReason` gains `'released'` (D3).

4. **Held on a Parry threat: gag** (epics AC 3). Given a `parry` threat, a press held `holdMinMs` or more is `wrongResponse`, at `press.t + holdMinMs`. This is today's behaviour: it must not change (`threatSystem.test.ts` L321-351 keeps passing untouched).

5. **The ring closes in the sim too.** When a pending press first reaches `holdMinMs` (the finger still down, or released at or after it), the sim sets `press.heldAt` and emits `ResponseHeld{t, threatId}`, once per press, before any result of the same step (D4).
   - This happens on both kinds of threat: on a `parry` threat, `ResponseHeld` is followed in the same step by the `wrongResponse` result.
   - A press that never reaches `holdMinMs` emits none. An early or late press emits none (it is never pending).
   - The snapshot goes to v11: `pressProblem` checks `heldAt` (null, or a finite number at or after `press.t + holdMinMs`).

6. **Nothing else moves.** The live content is untouched, so the six golden journals, their `levelHash` and `eventsHash`, stay byte-identical. `npm run golden:update` must not be needed. If a golden moves, stop and find out why before regenerating.

### The hold-ring (client)

7. **It fills** (epics AC 4). Given a press on a threat (touch, mouse, Space or pad A on the auto-target), while the sim holds that press with the finger down, a `hold-ring` fills around the threat icon from 0 to full over `feel.input.holdMinMs` of sim time (D6).
   - Look: a 5 px ring, `{colors.paper}` progress over a `{colors.ring-track}` track, a 2 px `{colors.ink}` outer outline. Never threat-coloured.
   - The ring reads the sim's pending press: `press.t` and the render sim time. A hitstop or a slow-mo slows it exactly as it slows the judgement.
   - It is world-anchored (CSS2D, inside the threat marker), tier 1 (full opacity, EXPERIENCE.md L123).
   - The DOM is written only when a value changes, and nothing allocates per frame.

8. **It closes.** When `press.heldAt` is set, the ring becomes solid `{colors.paper}` with a pop, and `ResponseHeld` plays the cue `hold_closed` through `content/feedback.json` (`events.ResponseHeld`): a `medium` haptic.
   - Under reduced motion, the pop is a fade (CSS only, like the star stamps of 1.22).
   - Released before it closes, the ring is gone (a Parry).
   - The ring disappears with the marker when the threat resolves or gags.

9. **Ring numbers come from DESIGN.md.** The stroke (5 px) and the outline (2 px) live in `shared/constants.ts` (`HOLD_RING_STROKE_PX`, `HOLD_RING_OUTLINE_PX`), and a drift test checks them against `DESIGN.md › components › hold-ring`, like `tapMarkerSpec.test.ts`. The fill duration is NOT a constant: it is `feel.input.holdMinMs`, which Geo tunes. The test checks that DESIGN's `durationMs` equals the frozen `testFeel.json` `holdMinMs` (D6).

### Bots, CLI and generated tests

10. **Bots learn Firmness** (closes deferred-work L204).
    - `BotResponse` now includes `'firm'` (it is derived from `@sim`).
    - On a `firm` threat, `perfect` and `human` press as they do today and keep the finger down until that threat is no longer `windowOpen` / `telegraph` with a pending press. Then they send `Release` at the next step (D7).
    - While they hold a Firmness, they press no other threat. `Release` names no threat, so another tap would end the hold too (one finger, like a player).
    - `random` is unchanged: its `maxHoldMs` already exceeds `holdMinMs`.
    - `perfect` resolves the test `firm` threat `perfect` on seeds 1-3.

11. **CLI.** `npm run sim` counts the new reason: `failReasons` gains `released`. `simReport.test.ts` follows.

12. **Generated tests** (epics AC 5). The threat catalogue (`tests/threats/threatCatalog.test.ts`) also reads the test-only defs of `tests/threats/fixtures/*.json` (D5), including `test_firm.json` (`response: "firm"`, `holdUntilMs` well above its window). Fixture defs are planned at an anchor of the frozen room that no live def uses. They are exempt from the « planned by a live level » check, which still covers every live def.
    - Every def runs today's four cases: perfect, success, too early, too late. A `firm` def holds to the end in the first two.
    - A `firm` def also runs « released early »: one case releases under `holdMinMs` (`wrongResponse`), one between `holdMinMs` and the attack's end (`released`).
    - A `parry` def also runs « held »: held `holdMinMs` → `wrongResponse`, preceded by `ResponseHeld`.
    - The `releaseOffsetMs` switch stays exhaustive: a new response still breaks the typecheck.

### End to end

13. **e2e** (`tests/e2e/holdRing.spec.ts`, chromium + webkit). The live level has only Parry threats, so the e2e proves the ring on the outlet (forced with `ForceThreat` through `window.__PP__`, as `silence.spec.ts` does).
    - **Short tap:** the ring appears and never closes, and the result is a Parry.
    - **Hold:** the ring fills, then closes. The closed state is a class or a `data-pp-*` mirror, never a pixel. Then `ResponseHeld` and the `wrongResponse` gag arrive in `__PP__.events()`. On chromium, the medium haptic pattern is recorded (the haptic recorder of `result.spec.ts`).
    - **Keyboard:** Space held on the auto-targeted threat closes the ring too.
    - Bounds come from the live feel (`holdMinMs`), never hard-coded.

14. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green: lint, typecheck, content check, unit, golden, architecture and e2e. `src/sim` coverage stays ≥ 90 %.

## Tasks / Subtasks

- [ ] **T0: Baseline** (AC 14)
  - [ ] `env | grep VITE_`; run `(unset VITE_DEBUG_ALLOWED; npm run ci)` on the fresh branch before the first edit, and write the counts in the Debug Log.
- [ ] **T1: Content** (AC 1)
  - [ ] `src/content/schemas/threat.ts`: `THREAT_RESPONSES = ['parry', 'firm']`. Add `holdUntilMs` (positive, sim ms, with a `.describe`) as an optional key of `baseShape`, then a `superRefine` (or `.check`) on the union: required iff `response === 'firm'`, with the path `['holdUntilMs']`. Update the doc comment on `THREAT_RESPONSES` (firm joined in 1.23).
  - [ ] `tools/content/contentChecks.ts`: `holdUntilMs > (def.windowMs ?? feel.timing.windowMs)` for every `firm` def, message naming file and key; test in `tests/content/checkContent.test.ts`.
  - [ ] `tests/content/threatSchema.test.ts`: firm with / without `holdUntilMs`, parry with it, non-positive value.
  - [ ] `npm run content:schemas`, then commit `content/_schemas/threat.schema.json`.
- [ ] **T2: Sim judgement** (AC 2-6)
  - [ ] `src/sim/events.ts`: `FailReason` adds `'released'`. Add `ResponseHeld{t, threatId}` to `SimEvent`, `SIM_EVENT_TYPES` (alphabetical order as the list keeps) and `events.test.ts`.
  - [ ] `src/sim/world.ts`: `PendingPress.heldAt: SimMs | null`. Set `heldAt: null` where presses are created (`pressThreat`).
  - [ ] `src/sim/timing/holdEnd.ts` (new, pure, with its test): `firmHoldOutcome(press, holdEndAt, now)`, which returns `'held' | 'released' | null`, where `holdEndAt = max(press.t + holdMinMs, windowOpenAt + holdUntilMs)`. The name is free, but it stays in `sim/timing/` (architecture L578).
  - [ ] `src/sim/threats/threatSystem.ts`, the per-threat loop (D4 order):
    1. `kind = classifyPress(...)`.
    2. If `kind === 'firm'` and `heldAt === null`, set `heldAt = now` and emit `ResponseHeld`, in any active state.
    3. Only in `windowOpen`:
       - `parry` def: today's code.
       - `firm` def: a `parry` kind is `wrongResponse`; a `firm` kind goes to `firmHoldOutcome`, where `held` resolves with `press.quality` / `press.offsetMs`, `released` gags with `'released'`, and `null` waits.
  - [ ] Keep « a threat with a pending press never expires ».
  - [ ] `src/sim/snapshot.ts`: v11, and `pressProblem` checks `heldAt`. Update the v10 fixtures and tests in `snapshot.test.ts` (search `version: 10`).
  - [ ] `src/sim/index.ts`: export anything new the client or bots need.
  - [ ] Unit tests in `threatSystem.test.ts` with an inline `firm` def (a test content variant). Cover:
    - held to the end (perfect and success), by the hold alone and by a release after the end;
    - released < `holdMinMs` (`wrongResponse`) and released in [`holdMinMs`, end) (`released`);
    - a late press (after `windowOpenAt + holdUntilMs - holdMinMs`), whose end is `press.t + holdMinMs`;
    - a buffered press made during `telegraph` and held;
    - `ResponseHeld` once, before the result, on both kinds;
    - a busy Papa, whose `Release` still passes;
    - hitstop and slow-mo at the resolving step (`timeEffects.test.ts`).
  - [ ] Run `npm test -- tests/golden`: it must pass unchanged (AC 6).
- [ ] **T3: Bots and CLI** (AC 10, 11)
  - [ ] `src/bots/threatTiming.ts`: replace `holdMsFor` with what a firm hold needs, keeping an exhaustive `switch` on `BotResponse` (a `never` default).
  - [ ] `perfectBot.ts` / `humanBot.ts`: hold a firm until the threat is no longer pressed, then `Release` at the next step, and press nothing else meanwhile.
  - [ ] Unit tests in `threatTiming.test.ts`, `tests/bots/perfectBot.test.ts` and `humanBot.test.ts`, on a test level with the fixture def.
  - [ ] `tools/sim/simReport.ts`: `FAIL_REASONS` adds `'released'`. Update `tests/tools/sim/simReport.test.ts`.
  - [ ] `deferred-work.md` L204: mark it closed by 1.23 (Firmness learned; `wait` / `nothing` still open).
- [ ] **T4: Generated tests** (AC 12)
  - [ ] `tests/threats/fixtures/test_firm.json`:
    - `target: "anchor"`, `response: "firm"`, `holdUntilMs` e.g. 1500;
    - reuse the outlet's gag (`outlet_hair`), icon (`bolt`) and cue ids;
    - `"$schema": "../../../content/_schemas/threat.schema.json"`.
  - [ ] Extend `threatCatalog.test.ts` (fixture defs, the anchor map, the new cases, the exhaustive `releaseOffsetMs` → maybe `answer(def)` returning press / release times).
- [ ] **T5: Hold-ring** (AC 7-9)
  - [ ] `DESIGN.md` is unchanged (it already specifies the ring). `HOLD_RING_STROKE_PX = 5` and `HOLD_RING_OUTLINE_PX = 2` go in `shared/constants.ts`. Add `tests/architecture/holdRingSpec.test.ts`, modelled on `tapMarkerSpec.test.ts`.
  - [ ] `src/client/ui/world/threatMarkers.ts`: one SVG ring per marker, built at `mount` (outline circle, track circle, progress circle with `stroke-dasharray` / `stroke-dashoffset`). Then extend `update`:
    - pass it the render sim time and `holdMinMs` (a new parameter, or a mount option for `holdMinMs`);
    - a progress per marker, from the instance's `press`: shown when `press !== null && press.releasedAt === null`;
    - `pp-threat-hold--closed` when `press.heldAt !== null`;
    - written only on change.
  - [ ] Unit tests in `threatMarkers.test.ts`.
  - [ ] `src/client/ui/styles/ui.css`: `.pp-threat-hold` (above the icon, below the highlight chevron), the closed state, and a `pp-hold-pop` keyframe (≤ 220 ms, overshoot). Under `prefers-reduced-motion` / the app's reduced-motion class, use the fade the 1.22 star stamps use. Colours only via `var(--pp-color-paper)`, `var(--pp-color-ring-track)`, `var(--pp-color-ink)`: `designTokens.test.ts` refuses literals.
  - [ ] `content/feedback.json`: cue `hold_closed` `{ "haptic": "medium" }` (a haptic-only cue is legal, see the `haptic-only.json` fixture), and `events.ResponseHeld: "hold_closed"`. Run `npm run content:check`.
  - [ ] Wire the call site in `levelSession.ts` / `loop.ts`: the markers' `update` is called with what it now needs. Check how `boot.ts` passes `feel`.
- [ ] **T6: e2e** (AC 13)
  - [ ] `tests/e2e/holdRing.spec.ts`: short tap, hold (touch or mouse), Space hold.
  - [ ] Mirror the ring's state if a class is not enough (`data-pp-hold="filling|closed"` on the marker, debug builds only, the 1.21 `ppSilence` pattern).
  - [ ] No new screenshot reference unless you decide one is needed. If you add one, look at it, say so, and do the Linux one too (story 1.13 › Screenshots).
- [ ] **T7: Finish** (AC 14)
  - [ ] `npm run sim -- --bot perfect --runs 3` and `--bot human --runs 3` on the live level: the scores are unchanged from 1.22 (perfect 90, human ≈ 84.6 mean on seed 1). Write them in the Debug Log.
  - [ ] Run the full `(unset VITE_DEBUG_ALLOWED; npm run ci)`.
  - [ ] Update the File List and the Completion Notes. Tick only what you ran.

## Dev Notes

### Decisions (D1-D8)

- **D1: `holdUntilMs` counts from the opening of the window.** « The end of the attack » is a moment of the threat, not of the press (GDD L127: « maintien jusqu'à la fin de l'attaque »; architecture L732).
  - So `attackEndAt = windowOpenAt + holdUntilMs`. It is not scaled by tier, fatigue or instinct: those scale the window to press in, not the attack.
  - The hold must also last `holdMinMs`, or it would not be a Firmness at all (ADR-010). So the success instant is `max(press.t + holdMinMs, attackEndAt)`. With `holdUntilMs` above the window (AC 1's check), the attack end wins for every press in the window except a very late one.
  - The epics' wording « entre 400 ms et `holdUntilMs` » reads naturally this way. If Geo prefers « held `holdUntilMs` from the press », it is a one-line change in `holdEnd.ts` (Open point 1).
- **D2: `holdUntilMs` exists only on `firm` defs.** The schema's convention is « a nullable key is always written ». But a key every `parry` file must carry as `null` would rewrite the five live defs and the five test fixtures. The fixtures are hashed into every golden's `levelHash`.
  - So the key is variant-specific, like `findMaxMs` on hidden-zone defs: required for `firm`, refused for the others.
  - `strictObject` stays strict. The refine names the key.
- **D3: the reasons.** On a `firm` threat, a release under `holdMinMs` is a Parry: `wrongResponse`. A release in [`holdMinMs`, end) is `released`. Architecture L408 already lists `'released'`; `'acted'` is story 4.9's, not this one's.
- **D4: `heldAt` and `ResponseHeld`.** The ring's pop and its medium haptic need a moment. The sim already decides it (`classifyPress` returns `'firm'`), so it says so as an event: deterministic, headless-testable, and fed to `feedback.json` like `SilenceStarted`. `heldAt` makes it fire once (a firm press stays pending for many steps).
  - Order within a step:
    1. the commands;
    2. `openWindow`;
    3. `ResponseHeld`;
    4. the result.
  - The snapshot bumps to v11, because `PendingPress` changed shape.
  - The goldens hold no press ≥ `holdMinMs` (`grep wrongResponse tests/golden/journals/*.expected.json` → 0), so their events and end-world hashes do not move.
- **D5: no live Firmness threat; a test fixture instead.** The story is optional (IRR M7; EXPERIENCE.md L598). Adding a `firm` threat to `salon_crawler` would change the level's feel and every bot score, and the epics ask for « une menace de test `firm` dans un niveau de test ».
  - The fixture lives in `tests/threats/fixtures/`, which `content:check` does not scan.
  - The catalogue plans it in the frozen room, at an anchor no live def uses. `door` is a candidate: check it exists in `tests/support/testLevel.geometry.json` and that `createSim` accepts it as a threat anchor. Otherwise pick another free one and say which.
- **D6: the ring is drawn from the sim, in sim time.** It shows the sim's pending press: `press.t`, `releasedAt`, `heldAt`, and the interpolated render sim time. It never shows the client's own pointer clock.
  - So what the player sees is what is judged, slow-mo and hitstop included.
  - It appears one step after the press, because the command is applied at the next step: ≤ 10 ms of sim time, invisible.
  - An early press gags at once and never shows a ring. A quick tap is judged at its release and may show a ring for a frame or two, which is fine.
  - The fill duration is `feel.input.holdMinMs`, read at mount, never DESIGN's `400`.
- **D7: bots hold until the threat is answered.** They are not told `holdUntilMs`: `BotSetup.responses` stays `defId → response`, and bots may not import `@content`. So they keep the finger down until the threat leaves the pressed state, and release at the next step.
  - This is exact, because the sim resolves a held Firmness without a release (AC 2).
  - « No other press while holding » mirrors one finger: `Release` ends every press (story 1.11 D6).
- **D8: what is reused, not rebuilt.**
  - `classifyPress` (story 1.11) already returns `'parry' | 'firm'` and is tested at the 400 ms bounds.
  - The `Release` command, the `ThreatPressTracker`, the keyboard / pad hold paths and the pause-time `Release` all exist.
  - `resolveThreat` / `gagThreat` already take `def.response`, a quality, a reason and an offset.
  - Do not add a new FSM state: a held Firmness is `windowOpen` with a pending press.

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatSystem.ts` (111 lines).**
  - `pressThreat` judges the press on its own `t`. `early` gags (with `earlyPress: 'fail'`) and `late` gags. Otherwise it stores `press = {t, quality, offsetMs, releasedAt: null}`.
  - `releasePresses` sets `releasedAt` on every pending press made at or before the release.
  - The per-threat loop:
    1. opens the window;
    2. if a press is pending, `classifyPress`. In `windowOpen` with a known kind, `kind === def.response` resolves; otherwise it is `wrongResponse`;
    3. otherwise it expires `late` after the window plus the tolerance;
    4. otherwise it re-arms after the cooldown.
  - A busy Papa ignores `PressThreat` but not `Release`.
  - Preserve all of it. Only the « press pending » branch grows.
- **`src/sim/timing/classifyPress.ts`:** pure, done, tested. Do not change its contract.
- **`src/sim/threats/threatFsm.ts`:** `resolveThreat` (hitstop, slow-mos, score) and `gagThreat` (`ResponseResolved{fail}` + `GagTriggered` + `applyGag`). Both clear `press`. No change expected.
- **`src/sim/world.ts` L82-88 `PendingPress`.** It gains `heldAt`. `ThreatInstance` keeps its shape.
- **`src/sim/snapshot.ts`:** v10 (story 1.22). `pressProblem` (L260) checks `t`, `quality`, `offsetMs`, `releasedAt`. Also check `isActive && press` (L409-424).
- **`src/content/schemas/threat.ts`:** a discriminated union on `target` (`AnchoredThreatDefSchema`, `HiddenZoneThreatDefSchema`) sharing `baseShape`. `THREAT_RESPONSES = ['parry']`, and its comment already promises `firm` for 1.23.
- **`src/bots/threatTiming.ts`:** `holdMsFor(response, tapMs)` is an exhaustive switch, built to break here. `perfectBot` and `humanBot` schedule press and release together through `createCommandScheduler`. The firm path cannot pre-schedule its release, so it needs per-threat « holding » memory checked each `act`.
- **`src/client/ui/world/threatMarkers.ts` (326 lines).** It mounts one CSS2D marker per threat (root, halo, highlight with chevron, icon), and `update(threats, highlightedId, targetedId, papa?)` once per frame, writing the DOM on change only. The ring goes inside the root, around the icon.
- **`content/feedback.json` `events`:** `PapaBlocked`, `CountdownTicked`, `SilenceStarted`, `ResultStarStamped`, `ResultLastStarStamped`. `haptics.medium` exists. `content:check` refuses a cue without a target event and an `audio` without twins.
- **`tests/threats/threatCatalog.test.ts`:** live defs only. Anchors come from live levels, and four cases per def. Its header says nothing knows a threat by name: keep that true for fixtures (iterate the folder).
- **`tools/sim/simReport.ts` L5:** `FAIL_REASONS = ['early', 'late', 'wrongResponse']`.

### Architecture compliance

- **Layers:** the judgement is in `src/sim` (no `three`, no `Date`, no `Math.random`, no log).
  - The ring is in `src/client/ui/world` and reads `@sim` types only.
  - The bots read `@sim` only.
  - The fixture is test data, never imported by `src/`.
- **System order** is unchanged (commands → … → threats → …). FSM writes stay in `enterThreatState`.
- **Events** are past tense, with `t` in sim time (`ResponseHeld`). The sim never knows about the ring or the haptic.
- **Everything tunable is data:** `holdMinMs` (feel), `holdUntilMs` (def), the cue (feedback.json). The only constants are DESIGN's pixel sizes, checked by a drift test.
- **No new library, no `enum`.** String-literal unions; exhaustive switches with `never`.

### Library and framework notes

- No new dependency, and no version-sensitive API.
- The ring is plain SVG through `svgElement` (`src/client/ui/svg.ts`) inside the existing CSS2D marker. Animate it with `stroke-dashoffset`; it works on WebKit and Chromium.
- The haptic goes through `@platform` (`webHaptics`: the Vibration API on Android Chrome, a no-op on iOS Safari, which is expected: the e2e checks the pattern on chromium only, as 1.22 does).
- Zod: `superRefine` is used in `feedback.ts` L193 and `level.ts` L149, `.check` in `strings.ts` L35. Follow their style for the `holdUntilMs` rule.

### File structure

New:
- `src/sim/timing/holdEnd.ts`, `src/sim/timing/holdEnd.test.ts`
- `tests/threats/fixtures/test_firm.json`
- `tests/architecture/holdRingSpec.test.ts`
- `tests/e2e/holdRing.spec.ts`

Changed (expected):
- `src/content/schemas/threat.ts`, `content/_schemas/threat.schema.json` (generated), `tools/content/contentChecks.ts`, `content/feedback.json`
- `src/sim/events.ts`, `src/sim/world.ts`, `src/sim/threats/threatSystem.ts`, `src/sim/snapshot.ts`, `src/sim/index.ts` (if needed)
- `src/bots/threatTiming.ts`, `src/bots/perfectBot.ts`, `src/bots/humanBot.ts`, `tools/sim/simReport.ts`
- `src/client/ui/world/threatMarkers.ts`, its caller(s), `src/client/ui/styles/ui.css`, `src/shared/constants.ts`
- Tests next to each, plus `tests/content/*`, `tests/bots/*`, `tests/threats/threatCatalog.test.ts`, `tests/tools/sim/simReport.test.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md` (L204)

### Testing

- **Unit (sim):** cover every AC 2-5 case at its bound, on the frozen feel. Write the bounds from `input.holdMinMs` and the def's `holdUntilMs`, never as literals. Cover the step order (`ResponseHeld` before `ResponseResolved` in the same drained batch).
- **Generated:** the catalogue (AC 12) is the epics' « tests générés ». Adding a fixture must add its cases with no edit to the test body.
- **Bots:** `perfect` gives `perfect` on the fixture, `human` mostly succeeds, `random` still produces `wrongResponse`.
- **Golden:** unchanged (AC 6). This is a regression check, not a chore.
- **Architecture:** `holdRingSpec`, `designTokens` (no colour literal in the new CSS), layer rules.
- **e2e:** `holdRing.spec.ts`. Earlier reviews punished e2e tests tied to live timings or ids, tautological assertions, and « verified » claims that were not run (1.15, 1.16). Read bounds from the live feel and threat ids from `__PP__.state()`.
- Coverage: `npm run test:coverage` (`src/sim` ≥ 90 %).

### Previous story intelligence (1.18-1.22)

- **1.22:**
  - snapshot v10, so yours is v11;
  - mirrors are written on events or changes only, and deleted at level start;
  - client-only feedback events go through `FEEDBACK_CLIENT_EVENTS`, but `ResponseHeld` is a sim event, so it goes through `SIM_EVENT_TYPES`;
  - a haptic recorder exists in `result.spec.ts`;
  - reduced motion is CSS only;
  - `content:check` refuses a `uiElement` visual on a sim event, so `hold_closed` stays haptic-only;
  - its Debug Log: rerun under load with `--maxWorkers=5` / `--workers=4` and say so.
- **1.21:**
  - `ForceThreat` lets the e2e force the outlet;
  - the `ppSilence` mirror pattern;
  - `TapBaby` sits in the hit-test order threat > baby > object > floor. A press on a threat icon still wins, so the ring only ever shows on threats.
- **1.20:**
  - a new world field means a snapshot bump and a `…Problem` per field;
  - bounds in e2e come from the live content.
- **1.19:**
  - beware import cycles (`runFatigue` had to move);
  - CSS state classes start with `pp-`;
  - a busy Papa ignores presses but not releases.
- **1.17:** keyboard Space and pad A press the auto-target and send `Release` on key-up (`inputMapper.ts` L219-244, L316-361). The ring must work for them with no extra code, since it reads the sim.
- **1.11:**
  - `Release` names no threat (D6);
  - the press tracker remembers one pointer;
  - a pause sends `Release` (`releaseAll`, `inputMapper.ts` L441-444). So pausing mid-Firmness releases it (Open point 3).

### Git intelligence

- Last commits: `659150d Story 1.22 : merge …`, `c057c4e Story 1.22 : corrections de la revue de code`, `9eacf92 Story 1.22 : note de maman et écran de fin`.
- Commits are in French, with a space before the colon. The implementation commit: `Story 1.23 : fermeté (optionnelle)`.
- Generated schemas go in the same commit as the code that changes them.
- Worktree `.claude/worktrees/1-23-fermete-optionnelle` on `story/1-23-fermete-optionnelle`. Never switch branches in the main checkout.
- 1.24 (playtest build) may run at the same time. It touches build config, not these files. A conflict would be in `sprint-status.yaml` only.

### Project Structure Notes

- `src/sim/timing/` is the architecture's home for « classification Parer / Fermeté » (L578), so the hold-end rule lives there, next to `classifyPress`.
- Test-only threat defs get a new folder, `tests/threats/fixtures/`. The existing `tests/support/test*.threat.json` are frozen copies of live defs for sim and golden tests, a different purpose. Do not mix them.
- No conflict with the unified structure was found.

### Project context rules (from `_bmad-output/project-context.md`)

- One threshold: `holdMinMs` (400). Below it is a Parry, at or above it is a Firmness, decided on release or at 400 ms held. `tapMaxMs` is unused (L53).
- Edge cases to handle (L165):
  - Firmness released before `holdUntilMs` = gag;
  - a wrong response type inside the window = gag;
  - several threats at once;
  - Papa already gliding: the press is still judged on its own `t`.
- Units are suffixes (`holdUntilMs`, `heldAt` is sim time: `…At`). Factories are `create…`. Files are camelCase. No `console`; the sim never logs.
- The sim emits events and never reads real time. Determinism rules: the replay of a journal with Firmness presses ends in the same state (add one replay test with a held press).
- Every feedback entry with `audio` has a `visual` and a `haptic`. `hold_closed` has no audio.
- No guardrail is weakened; goldens are regenerated only deliberately, and here not at all.
- Everything stays playable without a human: bots answer Firmness and the CLI reports `released`.

### Open points for Geo (tune or decide after playing)

1. **Where does « the end of the attack » count from?** D1 counts `holdUntilMs` from the window opening, so the end is the same instant for every press. The alternative is « held `holdUntilMs` from the press ». It is a one-line change in `holdEnd.ts`.
2. **No live Firmness threat in E1** (D5). If you want to feel it in the living room before E5, a fourth def (e.g. « tenir le bébé qui gigote ») is a JSON plus a wave entry. It would move the bot scores and the goldens' `levelHash`.
3. **Pausing mid-Firmness releases it** (story 1.11's pause-time `Release`), so it ends in a `released` gag after the countdown. It is fair for a Parry but harsh for a long hold. A fix would keep the press across a pause, which touches `inputMapper` and the sim's `Release`. That is a separate story if you want it.
4. **Every press shows the ring, Parry included** (UX: « starts filling on press over a threat »). On a quick tap it flashes for a frame or two. If that looks noisy, a short delay before showing it is a CSS change.
5. **The medium haptic fires on the ring's close even on a Parry threat**, just before its `wrongResponse` gag. That follows the UX (ring closes = Fermeté gesture).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.23 : Fermeté (optionnelle)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Les cinq réponses] (L120-143)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Chaîne d'entrées] (L215-225), ADR-010 (L310), events (L408), timing edge cases (L730-733)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] hold-ring (L230-236, L535), ring-track (L387)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L123, L215, L361, L418, L598
- [Source: _bmad-output/project-context.md] L53, L165
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L204
- [Source: _bmad-output/implementation-artifacts/1-22-note-de-maman-et-ecran-de-fin.md] Dev Notes, Debug Log

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

### Change Log

- 2026-10-28: story created (gds-create-story).
