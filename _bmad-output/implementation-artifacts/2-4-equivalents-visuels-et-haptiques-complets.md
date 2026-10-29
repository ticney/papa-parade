---
baseline_commit: be2d38103bfccc582490082a681ec21a9c8e7350
---

# Story 2.4: Complete visual and haptic twins

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR57, FR59, NFR7 · **GDD:** Pilier 3 (« Chaque signal sonore a un équivalent visuel et haptique, car beaucoup de joueurs mobiles jouent sans le son »), Contrôles › Retour haptique (« vibration courte à chaque télégraphe, vibration marquée sur une réponse parfaite ») · **UX:** EXPERIENCE.md › Game Feel & Juice (Perfect response: « visual flash (story 2.4) », Heavy; Telegraph: Light), › Reduced motion (« Full-screen flash → Border glow », « Any flashing: never faster than 3Hz »), › States › Muted (« `mute.spec.ts`, story 2.4 »), › Journey L534-546 (a muted player gets « a visual flash standing in for the sound he cannot hear ») · **Architecture:** ADR-006, L250 (reduced motion replaces flashes with a glow), L954 (E2 › Haptique, équivalents visuels)

## Story

As a player who plays without sound,
I want every sound signal to have a visual equivalent and a vibration,
so that I miss nothing.

## Acceptance Criteria

### What already works (keep it, prove it, do not rebuild it)

Stories 1.9 to 2.3 built most of pillar 3. `content/feedback.json` gives each cue an optional `audio`, `layers`, `visual` (`soundWave` ring on the floor, or `uiElement`), `haptic` (`light` | `medium` | `heavy`) and `camera`. `tests/architecture/feedbackEquivalence.test.ts` already fails when a cue with an `audio` lacks a `visual` or a `haptic` (raw JSON, with fixtures that prove it bites). Every `tel_*` cue already vibrates `light` and every `*_perfect` cue `heavy`. `src/platform/web/webHaptics.ts` pulses `navigator.vibrate` (Safari iOS has none: silent, no cost). The director plays sound → layers → haptic → ring → camera → `onCue` in the call that receives the event. A level started without a gesture (autoplay, `__PP__.loadLevel`) is **silent by design** (`boot.ts › loadAudio`, `audio.state === 'none'`). This story adds what is missing: the **perfect's flash**, **telegraph waves that come from the source and tell the telegraphs apart**, **content rules** that pin the haptic kinds, a **record of the visuals actually drawn**, and the **muted e2e**.

### Triple equivalence (epics AC 1)

1. **Every cue of `feedback.json` that has an `audio` has a visual twin and a haptic twin**, and the test says what a visual twin is: a `visual` (`soundWave` or `uiElement`) **or** a `flash` (AC 4). `feedbackEquivalence.test.ts` keeps reading raw JSON; it gains the fixture `audio-with-flash-only.json` (must pass: a flash is a visual twin) and `audio-with-null-flash.json` (`"flash": null`, no `visual`: must fail on the visual). Update the fixture list in the test. The `haptic` stays one of `light`, `medium`, `heavy` (the schema enum already says so; do not add kinds). Never weaken the existing cases.
2. **Proof by enumeration, through the real director** (new `src/client/feedback/feedbackTwins.test.ts`): for **every** cue id of the live `content/feedback.json` that has an `audio`, `director.playCue(id, world, threatId, objectId)` with a recording fake `audio`, fake `haptics`, fake scene (`soundWave`, `shake`) and fake screen flash (AC 5) produces at least one drawn visual (a `soundWave` call, a flash call, or, for a `uiElement` cue, the `onVisual` report of AC 8) **and** exactly one `haptics.pulse` with the cue's kind. Build the `world` with one threat and use a real object id from the level for `object`-anchored cues, so no ring is skipped for a missing anchor. A cue added later is covered with no test change.

### Telegraphs: light vibration and waves from the source (epics AC 2)

3. **A telegraph sends a short `light` vibration and visual waves from the source of the sound.**
   - The source is the cue's anchor: `threat` for the three threats, the micro-sleep and the silence's found telegraph (`world.threats[i].xM/zM`, the threat's anchor point), `object` for the phone's ring. Verify in `feedbackTwins.test.ts` that each telegraph's ring is drawn at its anchor's `xM`/`zM` (the outlet ring at the outlet threat, the phone ring at the phone object), not at Papa.
   - **A wave can pulse.** `SoundWaveSchema` gains optional `pulses` (int, 2 to 3) and `pulseIntervalMs` (positive), both or neither (refine, clear message, `path: ['pulses']`); no `pulses` means one ring, as today. The director draws `pulses` rings at `startAt = world.time.sim + i × pulseIntervalMs` (`i = 0…pulses-1`) through the existing `scene.soundWave` (`soundWaves.update` already hides a wave whose `startAt` is in the future, L88-91). Sim clock: a pause freezes them, a slow-mo slows them.
   - **Each telegraph gets its own wave in data** (D2), so a muted player tells them apart beyond the icon and the verb (closes `deferred-work.md` L289/L299). Starting values (Geo tunes them in `feedback.json`): `tel_outlet` 3 quick pulses (crackle: 0.6 m, 300 ms, interval 120 ms); `tel_stairs` 2 pulses (0.8 m, 450 ms, interval 200 ms); `tel_coffee_table` 1 ring (0.7 m, 500 ms); `tel_papa_microsleep` 1 slow ring (1.0 m, 900 ms, the « cotonneux » swell); `tel_silence_found` 2 pulses (0.8 m, 400 ms, interval 150 ms); `tel_phone_ring` 2 pulses (0.8 m, 400 ms, interval 250 ms, the « dring-dring »; it plays every second while ringing, so the last pulse must end before the next ring: `(pulses − 1) × pulseIntervalMs + durationMs` ≤ 1000 ms, content check of AC 7).
   - `SOUND_WAVE_POOL_SIZE` (`src/shared/constants.ts`, today 4) goes to 8 so that a 3-pulse telegraph does not steal the ring of a response a moment later. Each visible ring is one draw call: `perf.spec.ts` (≤ 100 draw calls) must stay green; report the measured maximum.
   - The haptic stays **one `light` pulse per telegraph cue** (FR57: « vibration courte »), not one per wave pulse.

### Perfect: heavy vibration and a flash (epics AC 3)

4. **A cue can flash the screen.** `CueSchema` gains an optional `flash`: `{ peakOpacityPct: 1…60, durationMs: positive int (real ms) }`, `.strictObject`, described (« a full-screen paper-white flash that fades, in real ms; under reduced motion a border glow instead; never more often than 3 Hz »). It counts toward the « at least one of » refine. It is a **screen** effect, not a world one: `content:check` allows it on a client event's cue too (it does not need a world). `content/_schemas/feedback.schema.json` is regenerated with `npm run content:schemas`, never by hand.
5. **The flash is drawn by a small DOM module**, `src/client/ui/hud/screenFlash.ts` (`createScreenFlash(root, options)`): one `div.pp-screen-flash` created once in the HUD root, `position: fixed; inset: 0; pointer-events: none`, `{colors.paper}` (`var(--color-paper)` or the token `tokens.css` names), above the world UI and below the pause panel (check the stacking in `ui.css`). `flash(peakOpacityPct, durationMs)` restarts a fade from the peak to 0 over `durationMs` **real** ms with the Web Animations API (`element.animate`, cancel the previous one first; no allocation beyond the animation itself, an event not a frame). It never blocks a tap (`pointer-events: none`, test it) and never takes focus.
   - **3 Hz rule** (EXPERIENCE.md L439, DESIGN.md `maxFlashHz: 3`): a `flash` requested less than `SCREEN_FLASH_MIN_INTERVAL_MS = 334` real ms (`src/shared/constants.ts`: a safety rule, not a feel value, so not in `feel.json`) after the previous one started is skipped and returns `false`. Real time comes from an injected `nowReal()` (boot passes `performance.now`), so the test is deterministic.
   - **Reduced motion** (`prefersReducedMotion()`, the same query the director uses): the same call shows a border glow instead (class `pp-screen-flash--glow`: transparent centre, an inset `box-shadow` in `{colors.paper}` at the same peak opacity, same duration). Story 2.10's in-game setting will feed the same function.
   - Real time, not sim time (D3): the perfect starts a hitstop then a ×0.3 slow-mo; a sim-clocked flash would freeze at full white during the hitstop and last three times longer. A pause during the 150 ms fade lets it finish: harmless.
6. **The director plays the flash** after the ring and before the camera: `deps.flash?(peakOpacityPct, durationMs, isMotionReduced): boolean`, guarded by `attempt` like every part, played **with or without a world** (a client event may flash): it plays whenever the director has a `flash` dep and the cue has a `flash`; the cue's author decides where it belongs. A failing motion query counts as reduced motion (the glow), as for the camera. `resp_parry_perfect` and `resp_firm_perfect` get `"flash": { "peakOpacityPct": 35, "durationMs": 180 }` and keep their 1.2 m ring and `heavy` haptic. No other cue flashes in this story.

### Content rules (pin the kinds)

7. **`npm run content:check` fails**, naming the file and the JSON path, when (`tools/content/contentChecks.ts`, next to `checkThreatSounds`; a failing and a passing case each in `tests/content/checkContent.test.ts`):
   - a threat's `feedback.telegraph` cue, or a disruption's `feedback.ring` cue, has a `haptic` other than `light`;
   - a threat's `feedback.perfect` cue has a `haptic` other than `heavy`, or has no `flash`;
   - a threat's `feedback.success` cue has a `flash` (the flash is the perfect's mark);
   - a disruption's `feedback.ring` cue's waves outlast the ring tick: `((pulses ?? 1) − 1) × (pulseIntervalMs ?? 0) + durationMs > PHONE_RINGING_EVERY_MS` (`src/shared/constants.ts` L357).
   The live content passes; the frozen test defs (`tests/threats/fixtures/test_firm.json`, `tests/support/*.threat.json`, inline defs) stay valid (update them if a rule bites).

### Muted play (epics AC 4)

8. **The director reports what it drew.** `FeedbackDirectorDeps` gains `onVisual?(cueId: string, kind: 'soundWave' | 'flash' | 'uiElement'): void`, called once per visual part that actually ran: after each ring `scene.soundWave` call that did not throw (once per cue for a pulsing wave, not once per pulse), after a flash that returned `true`, and for a `uiElement` visual (the director draws nothing, the screen element is the twin). A skipped ring (no anchor, no scene) or a skipped flash (3 Hz rule) is not reported. Guarded by `attempt`. Director tests cover each case.
9. **The visuals reach `window.__PP__`.** `TestHost` gains `onCuePlayed(listener: (record: { cueId: string; visuals: readonly string[]; haptic: string | null }) => void): () => void`, fed by `boot.ts` from `onCue` + `onVisual` (collect the kinds of the cue being played, emit on `onCue`, which the director calls last). `src/debug/testApi.ts` keeps the last 200 records and exposes `__PP__.cueLog()` (a copy). Do **not** prove this with `recordMirrorWrites` on `data-pp-cue`: a `MutationObserver` record reads the attribute's value when the callback runs, so two cues in one sim step show the second value twice. The existing `ppCue`/`ppCueCount` mirrors stay as they are. Unit-test the testApi part with `tests/support/fakeTestHost.ts`.
10. **`tests/e2e/mute.spec.ts`** (Chromium and WebKit, the default projects):
    - `?autoplay=perfect&seed=<n>&speed=4`, no gesture, so the audio context is `none` (assert `data-pp-audio="none"` and that no clip was decoded: `data-pp-audio-clips="0"`): the game is muted for real. `recordVibrations(page)` before the load.
    - Run until the log holds at least one `tel_*` cue of each live threat def planned in the first two waves **and** at least one perfect (`resp_parry_perfect`), or a bounded time derived from the live plan (`FIRST_TELEGRAPH_MAX_MS`, `telegraphDelayMsOf`, as `autoplay.spec.ts` does; no fixed sleep).
    - For **every** record in `__PP__.cueLog()` whose live cue has an `audio`: `visuals` is not empty, and its kinds match the live cue (`soundWave` when the cue has a `visual` of that kind, `flash` when it has a `flash` and is not within 334 ms of a previous flash). For each perfect: `visuals` contains `flash`, the `.pp-screen-flash` element exists and has run an animation (`getAnimations()` while it runs, or a `data-pp-flash-count` mirror if a poll is too slow at speed 4: say which in the Completion Notes).
    - Haptics: in Chromium, the recorded patterns include the live `light` pattern for each telegraph record and the `heavy` pattern for each perfect (`hapticPatternOfCue`, never typed in the spec; Chromium records the call even without user activation). In WebKit there is no `vibrate`: assert `data-pp-haptics="false"` and skip the pattern check (the visuals carry the signal).
    - A second test with `?autoplay=idle` covers the gags: the first `GagTriggered` plays its def's `gag_*` cue with a `soundWave` visual and a `heavy` pattern (Chromium).
    - `collectProblems(page)` stays empty (no `warn` from the director or the audio engine).

### Hygiene

11. **No sim change.** The sim, its events, the goldens, the bots and `npm run sim` results do not move. If a golden hash moves, stop and find out why; never run `golden:update` to make it pass.
12. **Screenshots**: the perfect's flash and the telegraph pulses are short and the screenshot specs freeze the frame before them; if a darwin reference still moves, look at it, say so in the Completion Notes and regenerate only that one deliberately.
13. **`deferred-work.md` is updated** (dated 2.4 lines): « More visual kinds (`flash`, `bubble`, `zoom`) » (L147: flash done; `bubble` not needed, the silence bubble is a HUD element; `zoom` is 2.5), « Distinct haptics and visuals per telegraph » (L289, L299: visuals done by pulses, haptics stay `light` by FR57), the phone's ring twins (L367, L382: two pulses per ring, one light vibration per second kept, see Open points). New open points at the end.
14. **`(unset VITE_DEBUG_ALLOWED; npm run ci)` is green**, `dist:check` passes for both flavours (the prod bundle must not contain `cueLog`: it lives in `src/debug`; add `cueLog` to the debug-marker list of `tools/build/inspectDist.ts`, next to `copyLog`), `perf.spec.ts` within budget.

## Tasks / Subtasks

- [x] **T1. Schema** (AC 1, 3, 4)
  - [x] `src/content/schemas/feedback.ts`: `pulses` + `pulseIntervalMs` on `SoundWaveSchema` (both or neither); `FlashSchema` and `flash` on `CueSchema`; extend the « at least one » refine. Keep `.strictObject`, no `.default()`/`.transform()` (header rule). Export `FeedbackFlash` type if the client needs it.
  - [x] `npm run content:schemas`; `tests/content/feedbackSchema.test.ts`: pulses accepted (2, 3), refused (1, 4, without interval, interval without pulses); flash accepted, refused (opacity 0 or 61, duration 0, unknown key); a cue with only a `flash` is valid.
- [x] **T2. Equivalence test** (AC 1): `isVisualTwin = isPresent(cue.visual) || isPresent(cue.flash)`; message unchanged (« has an audio but no visual twin »); two new fixtures and the declared list.
- [x] **T3. Screen flash** (AC 5): `src/client/ui/hud/screenFlash.ts` + test (jsdom/happy-dom as the other HUD tests do; stub `animate` if the DOM lib lacks it): peak and duration passed to `animate`, glow class under reduced motion, 334 ms rule with an injected clock, `pointer-events: none`, one element whatever the number of flashes. CSS in `src/client/ui/styles/ui.css` with tokens only (no hex in CSS outside `tokens.css`).
- [x] **T4. Director** (AC 3, 6, 8): pulses loop, `flash` part, `onVisual`; order sound → layers → haptic → ring(s) → flash → camera → `onCue`. Update the `handle` doc comment. Tests in `feedbackDirector.test.ts`: pulse start times, one haptic for a pulsing telegraph, a throwing flash is one `warn` and the camera and `onCue` still run, a skipped flash is not reported, `onVisual` once per pulsing ring.
- [x] **T5. Content** (AC 3, 6): `feedback.json` telegraph waves (starting values of AC 3) and the two perfect flashes. `SOUND_WAVE_POOL_SIZE` → 8.
- [x] **T6. Content checks** (AC 7) + tests.
- [x] **T7. Wiring** (AC 5, 8, 9): `boot.ts` creates the flash in the HUD root and passes `flash` and `onVisual` to the director; `TestHost.onCuePlayed`; `testApi.ts › cueLog`; `tests/support/fakeTestHost.ts`.
- [x] **T8. Twins test** (AC 2, 3): `src/client/feedback/feedbackTwins.test.ts`.
- [x] **T9. e2e** (AC 10): `tests/e2e/mute.spec.ts`; helpers in `tests/e2e/support/testApi.ts` (`ppCueLog`).
- [x] **T10. Docs** (AC 13): `deferred-work.md`; `project-context.md` › Feedback gains one line: « a cue may `flash` the screen (the perfect's mark; real time, glow under reduced motion, ≤ 3 Hz); a wave may `pulses`; telegraph cues vibrate `light`, perfect cues `heavy` (content:check) ».
- [x] **T11. CI** (AC 11, 12, 14): `env | grep VITE_` first, then `(unset VITE_DEBUG_ALLOWED; npm run ci)`. On a loaded machine rerun with `--maxWorkers=5` / `--workers=4` and say so.

## Dev Notes

### Decisions (D1-D6)

- **D1. `flash` is a cue member of its own, not a new `visual` kind.** The perfect must keep its 1.2 m ring (story 2.3 D2: the perfect « feels bigger » by its ring, laugh and heavy haptic) **and** gain the flash, and `visual` holds one effect. Turning `visual` into an array would touch every cue, the schema tests (`feedbackSchema.test.ts` L57-225), `contentChecks.ts` (L125-191, L314, L461) and the director's narrowing for a gain of nothing. A separate `flash` member, like `camera`, is additive. The equivalence test counts it as a visual twin (AC 1), because a flash alone *is* a visual equivalent.
- **D2. Telegraphs differ by their waves, not by their vibration.** `deferred-work.md` assigned « distinct haptics and visuals per telegraph » to 2.4, but the epic AC and FR57 want a short `light` vibration on every telegraph, Safari iOS has no vibration at all, and phones render short patterns too coarsely to be told apart. So the haptic stays `light` (pinned by `content:check`), and the visuals carry the identity: pulse count, radius and duration, on top of the icon and verb of story 2.2. All in `feedback.json`, Geo tunes them.
- **D3. The flash runs on real time; the rings stay on sim time.** Rings are diegetic and follow the world (pause, slow-mo). The flash is a screen overlay at the instant of judgement; during the hitstop the sim clock stops, so a sim-clocked flash would hold full white for 80 ms, then crawl at ×0.3. Real time keeps it a 180 ms blink in every case and makes the 3 Hz rule measurable.
- **D4. The 3 Hz guard is code, not data.** It is an accessibility rule (EXPERIENCE.md L439, DESIGN.md `maxFlashHz: 3`), not a feel value: `SCREEN_FLASH_MIN_INTERVAL_MS = 334` in `src/shared/constants.ts`, never in `feel.json`.
- **D5. The muted proof reads a log, not a mirror.** `recordMirrorWrites` uses a `MutationObserver` that reads the attribute's current value in the callback, so several cues in one step collapse. A bounded log behind `__PP__` (debug only, stripped from prod) records each cue with the visual kinds actually drawn: that is « vérifié via … `window.__PP__` » of the epic AC. The unit test of AC 2 is the exhaustive proof (every cue of the table); the e2e proves it in two real browsers with the sound truly off.
- **D6. What 2.4 does not do** (record each in `deferred-work.md`):
  - *The « Vibrations » toggle and volumes*: story 2.8. *Native haptics* (`@capacitor/haptics`): E8; the `Haptics` interface already isolates it.
  - *The epic stamp « PARADE PARFAITE », shake, particles, zoom*: story 2.5 (it will sit above the flash, both non-blocking).
  - *The reduced-motion setting in the game*: story 2.10 (the OS query only today, as the director already does).
  - *A persistent « ringing » marker on the phone* (deferred L368): not an AC; the two pulses every second already show the ring. Geo decides after playing (Open points).
  - *The chrono-ring's last-arc vibration and the catastrophe gauge's alert* (GDD v2.2 of 2026-10-29, uncommitted on `main`, not in `epics.md`): out of scope, they arrive through `gds-correct-course`. The `pulses`/`flash` members will serve them.

### Current state of the files this story changes (read before editing)

- **`content/feedback.json`**: buses, `haptics` (`light` 15 ms, `medium` 30 ms, `heavy` 60 ms), loops, `resultScreen`, 25 cues, `events` (9 entries). Every `tel_*` ring today is the same 0.6 m / 400 ms (`tel_phone_ring` 0.8 m / 900 ms: **900 ms already eats the whole tick**, AC 3 shortens it); `resp_*_perfect` ring 1.2 m / 450 ms, `heavy`, `layers` with the laugh. `silence_started` and `countdown_tick` are haptic-only, `noise_alert` is `uiElement` + `medium` with no audio: none owes a twin (no audio). Preserve every id (defs, e2e, mirrors use them).
- **`src/content/schemas/feedback.ts`**: `SoundWaveSchema` (kind, anchor, maxRadiusM ≤ 3, durationMs), `UiElementSchema`, `ShakeSchema`, `CueSchema` (two refines: at least one part; layers need audio). Strict objects, no defaults.
- **`src/client/feedback/feedbackDirector.ts`**: `play()` L122-176; `attempt` guards every part; `anchorOf` warns once per skipped ring; world visuals only when `world !== null` and `getScene()` non-null. Keep `hasOwn` lookups, the order, the guards.
- **`src/client/render/vfx/soundWaves.ts`**: pool of `SOUND_WAVE_POOL_SIZE` meshes (`name = 'sound_wave'`), one material each, `pick()` takes a free slot or the oldest `startAt`; `update` hides a wave with `elapsedMs < 0`, so future-start pulses already work. No change expected beyond the pool size.
- **`src/client/boot.ts`** (≈1250 lines): director built L304-322 (`onCue` mirrors `ppCue`, `ppCueCount`); `onSimEvent` L766 calls `playSimEventFeedback`; `prefersReducedMotion` L299; `testHost` L1170-1210 (`auditionCue`). The HUD is created through `createHudLayer` (`src/client/ui/hud/hudLayer.ts`, root `#pp-hud`).
- **`tests/architecture/feedbackEquivalence.test.ts`**: raw JSON, `MUST_FAIL` / `MUST_PASS` fixture maps, « has exactly the fixtures this test declares ».
- **`tools/content/contentChecks.ts`**: `checkThreatSounds` (2.3), `checkTelegraphClips`, events-table rules L137-200 (a client event's cue may only have a `uiElement` visual: a `flash` must be allowed there, AC 4), threat cue loop L295-320, disruption cue loop L450-470.
- **`src/debug/testApi.ts`**: subscribes `host.onSimEvent` (L83) for `ppEvents`; add `cueLog` the same way.
- **`tests/e2e/support/game.ts`**: `recordVibrations` (L364), `hapticPatternOfCue` (L232), `collectProblems`, `FIRST_TELEGRAPH_MAX_MS`, `telegraphDelayMsOf`; `testApi.ts` support has `ppEvents`, `waitForTestApi`.

### Must not change

- The sim, its events, goldens and bots (AC 11). No new `SimEvent`.
- Every cue id; `threatCueOf` / `disruptionCueOf` rules (a fail plays nothing, its gag plays once); the director's order for the existing parts.
- `silence_started` stays haptic-only (the silence is heard by its absence; its visual is the HUD bubble of story 1.21).
- The equivalence test's existing fixtures and cases, the layer and purity guardrails, the CSP (the flash is DOM + CSS, same origin).
- The phone ring clip stays under 1000 ms.

### Architecture compliance

- Layers: schema in `src/content` (zod only); director, flash and routing in `src/client`; `cueLog` in `src/debug` through `TestHost`; checks in `tools/`. Cross-layer imports through aliases only.
- ADR-006: `feedback.json` is the only place where an event meets its sound, ring, flash and vibration. No cue id or clip name in TS outside tests and `tools/`.
- No `console.*`: `log.warn('feedback' | 'ui', …)`. Every fallback logs; the director's `attempt` covers the flash.
- Performance: no allocation per frame; the flash allocates only its `Animation` per perfect (an event). Ring pool 8. `perf.spec.ts` budgets (p95 ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles).
- Naming: units as suffixes (`peakOpacityPct`, `durationMs`, `pulseIntervalMs`, `SCREEN_FLASH_MIN_INTERVAL_MS`); `create<Name>` factories in a file named after the export; real time named `…AtReal` where stored.

### Library and framework notes

- No new dependency. Web Animations API (`Element.animate`, `Animation.cancel`): Chromium and WebKit (Safari ≥ 13.1) support it; the unit DOM may not, so stub it in the test.
- Vibration API: Chromium (Android) honours `navigator.vibrate` only after a user activation (it returns `false` before: `webHaptics.ts` already warns once); Safari iOS has no `vibrate` (`capabilities.haptics = false`); Firefox removed it in 2024 (v129), so desktop Firefox is also silent. None of this changes code: the visual twins are why the game stays playable (NFR7). Native haptics are E8 (Capacitor 8.5 `@capacitor/haptics`, architecture L150).
- Zod 4: `z.int().min(2).max(3).optional()`, `.refine` with `path`; JSON Schema via `npm run content:schemas`.

### File structure

New:
- `src/client/ui/hud/screenFlash.ts`, `screenFlash.test.ts`
- `src/client/feedback/feedbackTwins.test.ts`
- `tests/e2e/mute.spec.ts`
- `tests/architecture/fixtures/feedback/audio-with-flash-only.json`, `audio-with-null-flash.json`

Changed:
- `src/content/schemas/feedback.ts`, `content/_schemas/feedback.schema.json` (generated), `content/feedback.json`
- `src/client/feedback/feedbackDirector.ts` (+ test), `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/ui/styles/ui.css`
- `src/shared/constants.ts` (`SOUND_WAVE_POOL_SIZE`, `SCREEN_FLASH_MIN_INTERVAL_MS`)
- `src/debug/testApi.ts` (+ test), `tests/support/fakeTestHost.ts`, `tests/e2e/support/testApi.ts`
- `tests/architecture/feedbackEquivalence.test.ts`, `tests/content/feedbackSchema.test.ts`, `tools/content/contentChecks.ts`, `tests/content/checkContent.test.ts`
- `tools/build/inspectDist.ts` (debug marker list), `tests/threats/fixtures/test_firm.json` (if a rule bites)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`

### Testing

- Vitest next to the code; content tests under `tests/content`, architecture under `tests/architecture`. `describe/it/expect` from `vitest`.
- Fakes: the recording `audio`/`haptics`/scene fakes of `feedbackDirector.test.ts` and `simEventFeedback.test.ts` (story 2.3), `tests/support/fakeTestHost.ts`, `tests/support/testContent.ts` for the live content.
- e2e: `mute.spec.ts` only; run the whole suite through `npm run ci`. At speed 4 a 180 ms flash lasts 180 ms real (real time): a poll on `getAnimations()` can still miss it, hence the log of AC 9.
- The harness fails a session on any `warn` of the director or the audio engine: a ring skipped for a missing anchor would show there.

### Previous story intelligence (1.9, 1.11, 1.20, 1.21, 1.22, 2.2, 2.3)

- **1.9**: the director never throws into the frame loop; every part is in `attempt`. A level without a gesture is silent: that is the muted run this story tests, for free. `navigator.vibrate` returning `false` is one `warn` per session, not per pulse: an autoplay run in Chromium will log it once; `feedback.spec.ts` L260 shows the harness does not count a `platform` warning as an audio problem; check how `collectProblems` treats it before relying on that.
- **1.11 D3 / 1.20 D10**: threat and disruption cues come from their defs (`feedback.telegraph/success/perfect/gag`, `feedback.ring/answer`), never from `events`.
- **1.21**: the silence's telegraph is the cut, `silence_started` haptic-only, its visual twin the HUD bubble.
- **1.22 D6**: `uiElement` visuals are the stamped stars and Mama's header: allowed only on client events (`contentChecks.ts` L159-181).
- **2.2**: every rule the schema cannot see goes into `contentChecks.ts` with a failing and a passing test; frozen test copies of defs are updated with the live ones.
- **2.3**: `layers`, `simEventFeedback.ts` (pure routing, latency proof), the « Sons » board (`TestHost.auditionCue`, `src/debug/soundBoard.ts`). The review insisted on AC-by-AC Completion Notes saying what was really verified and what could not be (the agent cannot hear; here it cannot feel a vibration: say so). Main received story 3.2 meanwhile; this branch is cut from `main` after both.

### Git intelligence

Recent commits: `Story 2.3 : sons cultes…` (layers, cult sounds, `checkThreatSounds`, sound board), its review fixes and merge; story 3.2 (`ba93bfe`, Sieste variant, `mama_woke`, `result_star_lost` cues with `uiElement`). Commit style: French, « Story 2.4 : <titre> », then « Story 2.4 : corrections de la revue de code ». Work on `story/2-4-equivalents-visuels-et-haptiques-complets` in its worktree; never commit on `main`.

### Project context rules (from `_bmad-output/project-context.md` and CLAUDE.md)

- Every `audio` feedback has a `visual` and a `haptic` (pillar 3, test-enforced; never weaken the guard).
- Response sound and haptic fire at judgement; the final pose plays at Papa's arrival.
- Anything Geo might tweak is data (`feedback.json`): pulses, radii, durations, flash opacity and duration. Accessibility limits (3 Hz) are constants, not tweakables.
- Units as suffixes, `create<Name>` factories, files `camelCase.ts`, no `enum`, `Result` for I/O, `log` not `console`; no hex colour outside the tokens.
- Check `env | grep VITE_` before `ci`/`e2e`/`dev`; the shell exports `VITE_DEBUG_ALLOWED=false`: run `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Open points for Geo (tune or decide after playing)

1. **The flash's strength**: 35 % paper-white over 180 ms is a guess. Too weak on a bright phone, too strong at night? Tune `peakOpacityPct` / `durationMs` in `feedback.json`.
2. **Telegraph waves**: are the six patterns (AC 3) told apart with the sound off? Retune pulses and sizes in `feedback.json`.
3. **The phone**: one light vibration per second, up to 15 in a row, plus two pulses each ring. Keep, vibrate only on the first ring, or add a persistent « ringing » marker on the phone?
4. **Vibration lengths** (`light` 15 ms, `medium` 30 ms, `heavy` 60 ms): many Android motors barely render 15 ms. Check on Geo's device during the 1.24 device pass.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] (ACs), [#Story 2.5] (stamp, shake, particles), [#Story 2.8] (Vibrations toggle), [#Story 2.10] (reduced motion setting); FR57, FR59, NFR7 (L121-147)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] Pilier 3, Contrôles › Retour haptique
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L36, L74, L185, L250 (reduced motion: flash → glow, ≤ 3 Hz), L306 (ADR-006), L768-774 (P3), L954
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L214 (threat-icon telegraph), L295 (Muted), L410-440 (Game Feel & Juice, Reduced motion), L453, L534-546 (muted journey); DESIGN.md L251 (`maxFlashHz: 3`), colors (`paper` #FFFFFF)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L147, L289, L299, L367, L382
- [Source: _bmad-output/implementation-artifacts/2-3-sons-cultes-rire-du-bebe-et-telegraphes-distincts.md] D1, D2, D5, Review Findings
- [Source: _bmad-output/project-context.md] › Feedback

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (claude-sonnet-5-5)

### Debug Log References

- Adding `onVisual` to the shared test setup put `visual:` lines in the trace of the story 1.20-2.3 director tests; the setup now keeps them in a `visuals` array and puts them in the trace only with `traceVisuals`.
- `ui.css`: `designTokens.test.ts` refuses a blurred `box-shadow` (sticker depth is hard), so the reduced-motion glow is a hard inset frame (`inset 0 0 0 20px`), not a blurred glow.
- The older story 2.3 sound tests of `checkContent.test.ts` point a role at cues that now break the haptic/flash rules too; they read `soundProblems()` (the problems about sounds), and the new `describe` covers the new rules.
- `ui.spec.ts` (HUD node budget, free bottom third) counted the full-screen flash overlay as a HUD element; the measure now skips `.pp-screen-flash`. `testApi.spec.ts` lists `cueLog` (nine methods).
- `checkDist.test.ts`: the fake playtest bundle carries the `cueLog` marker (the check is not vacuous).

### Completion Notes List

- **AC 1** (triple equivalence in the test): `feedbackEquivalence.test.ts` counts `visual` or `flash` as the visual twin; fixtures `audio-with-flash-only.json` (passes) and `audio-with-null-flash.json` (fails on the visual) added and declared. Verified by the test run.
- **AC 2** (proof by enumeration through the real director): `feedbackTwins.test.ts` plays every cue of the live `feedback.json` that has an audio with recording fakes: at least one drawn visual, exactly one `haptics.pulse` of the cue's kind, no warning. A cue added later is covered with no change. Verified.
- **AC 3** (telegraphs): `SoundWaveSchema` has `pulses` (2-3) and `pulseIntervalMs` (both or neither, `path: ['pulses']`); the director draws the pulses at `world.time.sim + i × pulseIntervalMs` through `scene.soundWave`. The six telegraph waves of the story are in `feedback.json` as starting values; the twins test checks each telegraph ring is drawn at its anchor (threat or phone object), not at Papa, with one `light` pulse; another test checks that no two telegraphs share pulses, radius, duration and interval. `SOUND_WAVE_POOL_SIZE` is 8. `perf.spec.ts` (built playtest, whole level at speed 1): p95 16.7 ms, **40 draw calls max**, 1466 triangles max.
- **AC 4-6** (flash): `CueSchema.flash` (`peakOpacityPct` 1-60, `durationMs`), counted by the « at least one » refine; `content/_schemas/feedback.schema.json` regenerated with `npm run content:schemas`. `src/client/ui/hud/screenFlash.ts` is the DOM module (one `div.pp-screen-flash` in `#pp-hud`, Web Animations API, real time via an injected `nowReal`, border-glow class under reduced motion, `SCREEN_FLASH_MIN_INTERVAL_MS = 334` in `constants.ts`, `pointer-events: none` in `ui.css`, tested through the CSS text and a fake element). The director plays it after the ring and before the camera, with or without a world, a throwing flash is one `warn`. `resp_parry_perfect` and `resp_firm_perfect` flash 35 % / 180 ms and keep the 1.2 m ring and `heavy`.
- **AC 7** (content rules): `checkThreatTwins` and `checkDisruptionRing` in `tools/content/contentChecks.ts`: telegraph and ring `light`, perfect `heavy` with a `flash`, success without `flash`, ring waves ending within `PHONE_RINGING_EVERY_MS`. A failing and a passing case each in `tests/content/checkContent.test.ts` (the boundary 1000 ms passes, 1200 ms fails). The live content passes; no frozen test def needed a change.
- **AC 8-9** (visual report): `onVisual` once per part that ran (once for all pulses of a wave; a skipped ring, a skipped flash and a failed ring are not reported); `TestHost.onCuePlayed` fed by `boot.ts`; `__PP__.cueLog()` keeps the last 200 records (unit-tested with `fakeTestHost`). No `recordMirrorWrites` on `data-pp-cue`.
- **AC 10** (muted e2e): `tests/e2e/mute.spec.ts`, **chromium and webkit both pass**: `?autoplay=perfect`, no gesture (`data-pp-audio="none"`, `data-pp-audio-clips="0"`), run until the log holds the telegraph of every def of the first two waves and a perfect; every cue with an audio drew something of the live kinds; the perfect flashes. A poll of `getAnimations()` would miss a 180 ms fade at speed 4, so I added a `data-pp-flash-count` mirror (`ppFlashCount`) and the spec compares it with the number of records that include `flash`, and checks the overlay exists and has `pointer-events: none`. Chromium: the `light`/`heavy` patterns of the live table were recorded for each record; WebKit: `data-pp-haptics="false"`. The second test (`?autoplay=idle`) checks the first gag's cue has a `soundWave` visual and a `heavy` pattern. The 3 Hz rule can skip a flash at speed 4 (two perfects close in real time): the spec allows a flash-less perfect only after a flash that happened.
- **AC 11**: no sim file, event, golden, bot or `npm run sim` result changed (`git status` shows none; the goldens ran green with no update).
- **AC 12**: no screenshot reference moved (the darwin screenshot specs passed unchanged).
- **AC 13-14**: `deferred-work.md` has a dated 2.4 section; `project-context.md` › Feedback has the new line; `cueLog` is in the debug-marker list of `tools/build/inspectDist.ts`. `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green end to end (4303 unit tests, `src/sim` coverage thresholds, e2e chromium + webkit, `dist:check` for both flavours, `e2e:dist` including `perf.spec.ts`).
- **What I could not verify**: the agent cannot feel a vibration or judge the flash's strength; the haptic proof is that `navigator.vibrate` was called with the live pattern (Chromium) and that the visuals carry the signal elsewhere. The 35 % / 180 ms flash and the six telegraph waves are starting values for Geo to tune (Open points 1-2 of the story).

### File List

- `src/content/schemas/feedback.ts`, `content/_schemas/feedback.schema.json` (generated), `content/feedback.json`
- `src/client/feedback/feedbackDirector.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/client/feedback/feedbackTwins.test.ts` (new)
- `src/client/ui/hud/screenFlash.ts` (new), `src/client/ui/hud/screenFlash.test.ts` (new), `src/client/ui/styles/ui.css`
- `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/render/vfx/soundWaves.test.ts`
- `src/shared/constants.ts`
- `src/debug/testApi.ts`, `src/debug/testApi.test.ts`, `tests/support/fakeTestHost.ts`
- `tools/content/contentChecks.ts`, `tools/build/inspectDist.ts`
- `tests/architecture/feedbackEquivalence.test.ts`, `tests/architecture/fixtures/feedback/audio-with-flash-only.json` (new), `tests/architecture/fixtures/feedback/audio-with-null-flash.json` (new)
- `tests/content/feedbackSchema.test.ts`, `tests/content/checkContent.test.ts`, `tests/tools/build/checkDist.test.ts`
- `tests/e2e/mute.spec.ts` (new), `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`, `tests/e2e/ui.spec.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file

### Change Log

- 2026-10-29: Story 2.4 implemented: cue `flash` and wave `pulses` in the schema and content, the `screenFlash` HUD module (real time, glow under reduced motion, 3 Hz rule), director flash and `onVisual`, `__PP__.cueLog()`, content rules for haptics and flashes, per-telegraph waves, twins test and muted e2e. Status: review.
