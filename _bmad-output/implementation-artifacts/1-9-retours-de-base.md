---
baseline_commit: c1fcde8f1541ad3a8ff62e3562063e75968d70ff
---

# Story 1.9: Basic Feedback

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.9 « Retours de base ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to hear the baby and feel the game's events, even with the sound off,
so that every signal reaches me one way or another.

**Requirements covered:** FR63 (audio unlocks on the first gesture), FR59 base (the data-driven feedback path, with every sound twinned by a visual and a haptic), NFR7 (playable without sound: the twin rule is a test), FR15 / P4 groundwork (the babble loops while `world.baby.babbling`, so story 1.21's silence has something to stop), FR66 (nothing here needs a human: the e2e reads mirrors, not ears). It is the first story of `src/client/audio/`, `src/client/feedback/`, `src/platform/` and `content/feedback.json`: stories 1.11 (telegraph sound), 1.21 (silence), 2.3 to 2.6 (sounds, twins, juice, music) and 2.8 (volumes, vibration toggle) all plug into what this story builds.

## Precondition (check first, stop if it fails)

Story 1.8 is `done` (`0d320e3`, review fixes committed). `git status` must be clean apart from `_bmad-output/`, and `npm run ci` green before the first edit, so any later failure is yours.

## Acceptance Criteria

From the epic (1 to 7), then derived from the architecture, the UX spec and the deferred work (8 to 10).

1. **Unlock.** Given `src/client/audio/` (`AudioEngine`, buses `music`, `sfx`, `voice`, `ui`), when the player makes the first gesture on the start screen (story 1.5), then an `AudioContext` with `latencyHint: 'interactive'` is created and unlocked **synchronously inside that gesture's handler** (D3). A browser without Web Audio, or a failed unlock, gives a `warn` and a silent game that plays on.
2. **Pause.** On every `PauseRequested` the `AudioContext` is suspended; it is resumed on `GameResumed` (the end of the countdown), never earlier: the countdown is silent (D3).
3. **Preload.** The level's `.m4a` buffers are fetched and decoded during `loading`, before the countdown; nothing is fetched or decoded during play. A clip that cannot be had is a `warn`, its sound is skipped, and the level still starts (D4).
4. **Loops.** Given `world.baby.babbling` is `true` and the level is in play, a provisional babble loop is audible on the `voice` bus, and a calm music loop on the `music` bus (D5).
5. **Director.** Given `content/feedback.json` (`FeedbackTableSchema`) and `src/client/feedback/feedbackDirector.ts`, when the sim emits an event listed in the table, the director plays the cue's `audio`, `visual` and `haptic`, and `camera` if the cue has one (D1, D6, D7).
6. **Twin rule.** `tests/architecture/feedbackEquivalence.test.ts` fails if a cue has an `audio` without a `visual` or without a `haptic` (D10).
7. **Haptics.** Given `src/platform/web/webHaptics.ts`, when a haptic cue is played on a browser without `navigator.vibrate` (Safari iOS, WebKit), the call does nothing, without error, and `platform.capabilities.haptics` is `false` (D8).
8. **Deferred to this story.** Each countdown digit (`CountdownTicked`) fires a light haptic through the table; the start screen starts only on a `pointerup` whose `pointerdown` it saw while mounted (D12); emitter listener isolation is decided (D11).
9. **Sim untouched.** No sim behaviour changes: no feel key is added, `SYSTEMS` is unchanged, every golden journal passes **without** `golden:update` (the only sim edit is the `SIM_EVENT_TYPES` list, D9).
10. **Quality gates.** `npm run ci` passes. `biome.json` and the existing `tests/architecture/*.test.ts` are untouched (the new architecture tests are new files). No new npm dependency. `src/sim` coverage stays ≥ 90 %.

## Tasks / Subtasks

- [x] **T0: Precondition (all ACs)** — check the Precondition section.
- [x] **T1: Content (AC 5, 6, 9)**
  - [x] `src/content/schemas/feedback.ts`: `FeedbackTableSchema` exactly as Dev Notes › Feedback table, `.describe` on every key with its unit, `z.strictObject` everywhere, the clip-name regex, the « at least one member » refine on a cue. Export `FeedbackTable`, `FeedbackCue`, `AudioBus`, `HapticKind` via `z.infer`.
  - [x] `src/content/feedbackClips.ts` (+ test): `feedbackClips(table): string[]`, every distinct clip of `loops` and `cues`, sorted. Used by the client preload, `content:check` and the audio-assets test.
  - [x] `contentFiles.ts`: `FEEDBACK_FILE` (`feedback.json`, schema name `feedback`) in `CONTENT_FILES`; `ContentBundle.feedback`; `loadContent` loads it alongside feel and strings (still explicit; see Dev Notes › Deferred items this story touches).
  - [x] `content/feedback.json` with the starting values of Dev Notes › Feedback table, first key `"$schema": "./_schemas/feedback.schema.json"` like `feel.json` (`parseContentFile` drops it). `npm run content:schemas` (generates `content/_schemas/feedback.schema.json`; never by hand), then `npm run content:check`.
  - [x] `tests/support/testContent.ts`: `createTestContent()` returns a minimal valid `feedback` (typed `FeedbackTable`, inline). The sim ignores it; `feelHash` is unchanged, so no golden moves.
  - [x] `tests/content/feedbackSchema.test.ts`: the live file parses; refused: an unknown bus, `gainPct` 101 or −1, an unknown haptic kind, an empty `patternMs`, a cue with no member, an unknown key at any level, a clip `bump` (no category) or `noise_bump` (unknown category), a `soundWave` with `maxRadiusM` 0. Unit-suffix rule on every numeric key (`Pct`, `Ms`, `M`), same spirit as `feelSchema.test.ts`.
  - [x] Fix `tests/content/loadContent.test.ts` and `tests/content/checkContent.test.ts` where their in-memory sources or fixture roots now lack `feedback.json` (deliberate edits; list them).
- [x] **T2: Event names and clip files in `content:check` (AC 5, D9)**
  - [x] `src/sim/events.ts`: `export const SIM_EVENT_TYPES = [...] as const` listing every `SimEvent['type']`, with a compile-time check that the list and the union are equal both ways (Dev Notes › SIM_EVENT_TYPES). Export it from `src/sim/index.ts`. A small test next to it (`events.test.ts`): no duplicate, sorted or in union order (your pick, state it).
  - [x] `src/client/feedback/feedbackEvents.ts`: `FEEDBACK_CLIENT_EVENTS = ['CountdownTicked'] as const` (the client events the director listens to) and the type `FeedbackEventName = SimEvent['type'] | (typeof FEEDBACK_CLIENT_EVENTS)[number]`.
  - [x] `tools/content/contentChecks.ts`: a feedback check run when `feedback.json` parsed: every `events` key is in `SIM_EVENT_TYPES` or `FEEDBACK_CLIENT_EVENTS`; every `events` value is a key of `cues`; every clip of `feedbackClips` exists as `public/assets/audio/<clip>.m4a`. Problems name the file and the JSON path (`events.PapaBlockd`, `cues.papa_bump.audio.clip`). Cases in `tests/content/checkContent.test.ts`, each with a failing fixture. **Trap:** that test copies only `content/` into a temp root (`beforeEach`), so the clip-file check fails there until the `beforeEach` also copies `public/assets/audio/`; the « on the real repository » case uses the repo itself.
- [x] **T3: Placeholder audio (AC 3, 4, 5, D14)**
  - [x] `tools/audio/makePlaceholderAudio.ts` + `npm run assets:audio`: synthesizes the three clips of Dev Notes › Placeholder clips into WAV in a temp dir (deterministic: `@shared/rng` with a fixed seed), then `afconvert -f m4af -d aac -b <kbps>` each into `public/assets/audio/<clip>.m4a`. On a machine without `afconvert` it exits ≠ 0 with a clear message (macOS only; CI never runs it). Commit the `.m4a` files, not the WAVs.
  - [x] `tests/architecture/audioAssets.test.ts` (new file): every clip of the live `feedback.json` exists, starts with an MP4 `ftyp` box (bytes 4 to 7), and the level's `.glb` plus every clip stay within `LEVEL_PAYLOAD_MAX_BYTES` (NFR3).
  - [ ] Listen to each clip once (built-in browser or `afplay`): the loops loop without an audible click or gap. Say in the Completion Notes what you heard.
- [x] **T4: Platform (AC 7, D8)**
  - [x] `src/platform/platform.ts`: `Platform`, `Haptics`, `PlatformCapabilities` (Dev Notes › Platform). `src/platform/createPlatform.ts` (+ test): `createPlatform({ target, hapticPatternsMs, env? })`. `src/platform/web/webHaptics.ts` (+ test). Delete `src/platform/.gitkeep`.
  - [x] `.env`: add `VITE_TARGET=web` (the three `.env*` files are read by Vite; `.env` is the shared base). Boot passes `import.meta.env.VITE_TARGET`.
  - [x] `tests/architecture/platformApis.test.ts` (new file, with a failing fixture under `tests/architecture/fixtures/platformApis/`): `navigator.vibrate` appears in `src/` only under `src/platform/` (comments ignored). It turns a project-context rule into a test; it edits no existing guard.
- [x] **T5: Audio engine (AC 1 to 4, D3 to D5, D11)**
  - [x] `src/client/audio/audioUnlock.ts` (+ test), `audioEngine.ts` (+ test), `buses.ts` if you split the bus graph out. `src/client/assets/audioAssets.ts` (+ test): fetch (reuse `fetchBytesWithTimeout`), `ftyp` check, decode. All per Dev Notes › Audio engine; all tests in Node with a fake context (no Web Audio in Vitest).
  - [x] Every Web Audio call that can throw or reject is caught there and logged (`warn`, channel `audio`): the engine never throws into an emitter listener or the frame loop (D11).
- [x] **T6: Feedback director and diegetic visuals (AC 5, 8, D6, D7, D13)**
  - [x] `src/client/feedback/feedbackDirector.ts` (+ test) per Dev Notes › Feedback director.
  - [x] `src/client/render/vfx/soundWaves.ts` (+ test): the pooled sound-wave rings. `levelScene.ts`: owns them and the shake (Dev Notes › Diegetic visuals); `LevelScene` gains `fx`; `update(world, alpha)` drives them on the interpolated sim clock; `dispose` frees their geometry and material. Extend `levelScene.test.ts` (fx present, hidden at rest, freed on dispose, a wave started at `t` grows with sim time and is hidden after `durationMs`).
- [x] **T7: Wiring (AC 1 to 5, 8, D3 to D6, D12, D15)**
  - [x] `boot.ts` per Dev Notes › Wiring: platform, audio engine, director; unlock in `onStart` (before `StartGestureReceived`), suspend / resume on the pause events, loops on `AppStateChanged`, babble per frame, sim and client events to the director. Replace the « Story 1.9 replaces this » comment of `logSimEvent` (keep the `InvariantViolated` warn and the debug log).
  - [x] `levelSession.ts` (+ test): optional dep `loadAudio(): Promise<void>`, run in parallel with `loadAssets` and awaited before the sim is created; it never rejects (the engine logs); a stale start still returns after it. Tests: called once per start, in parallel (both pending at once), a slow `loadAudio` delays `level`, a rejecting fake is not possible by contract but is still caught (log, carry on).
  - [x] `startScreen.ts`: D12. `StartTarget` gains `pointerdown`; remove both listeners on dispose.
  - [x] Debug mirrors (D15), behind `VITE_DEBUG_ALLOWED === 'true'`, event-driven, added to the `mirror` union.
- [x] **T8: Architecture guard (AC 6, D10)**
  - [x] `tests/architecture/feedbackEquivalence.test.ts` (new file): reads the live `content/feedback.json` as raw JSON and every file of `tests/architecture/fixtures/feedback/`; a cue with `audio` and no `visual`, or no `haptic`, fails with a message naming the cue. Fixtures: `audio-without-visual.json`, `audio-without-haptic.json` (must fail), `haptic-only.json`, `visual-only.json` (must pass). Same style as the other scanners: the test proves each fixture fails or passes as declared.
- [x] **T9: End-to-end (AC 1 to 5, 7, 8)**
  - [x] `tests/e2e/feedback.spec.ts` (new, chromium + webkit) per Dev Notes › E2E script. Helpers in `support/game.ts` (`audioState`, `cueCount`, live `feedback.json` read like `liveFeel`).
  - [x] `support/game.ts`: add the engine's own warnings to `OWN_WARNINGS` (`audio unlock failed`, `audio clip \S+ unavailable`), so a broken clip fails every spec.
  - [x] `ui.spec.ts` start-screen test: add « a lone `pointerup` does not start, a full click does » (D12). Keep its three existing ways to start.
- [x] **T10: Docs and verification (AC 9, 10)**
  - [x] `deferred-work.md`: mark resolved what Dev Notes › Deferred items this story touches says; add Dev Notes › Deferred by this story.
  - [x] Run `npm run lint`, `npm run typecheck`, `npm test` after T2, after T5 and after T7, not only at the end; then `npm run ci` end to end. `npm test` must show every golden green **without** `golden:update` (AC 9); if one moves, you changed the sim: find out why before anything else.
  - [x] Manual check in the built-in browser pane on `npm run dev` (844 × 390): silence before the first tap; after it, the babble and the music during play; silence during pause and the countdown, sound back on « 1 »'s end; Papa walking into a wall gives the bump, a ring on the floor at Papa (and, on a phone with vibration, a short buzz); « Recommencer » restarts the loops once (not twice). Screenshots plus the mirrors are the evidence; say what was **not** checked (a real iPhone: unlock on `pointerup` and `keydown`, resume outside a gesture, the silent switch; a real Android vibration).
  - [x] Break things to prove the guards bite, then restore: remove `haptic` from `papa_bump` → `feedbackEquivalence` fails; rename the clip to `papa_bonk` → `content:check` fails (missing file); key `events.PapaBlockd` → `content:check` fails; a `navigator.vibrate` call in `boot.ts` → `platformApis` fails; a new `SimEvent` member without updating `SIM_EVENT_TYPES` → `npm run typecheck` fails.
  - [x] `git status`: only the files of the File List changed; nothing committed.

## Dev Notes

### What exists today (stories 1.1 to 1.8)

- **Client events** (`src/client/app/clientEvents.ts`): `PauseRequested{reason}` (reasons `visibilityHidden`, `user`, `portrait`, `gamepadDisconnected`, `levelStart`), `ResumeRequested`, `GameResumed`, `AppStateChanged{from, to}`, `StartGestureReceived` (emitted in `boot.ts`'s start `onStart`, « synchronous, inside the gesture: story 1.9 unlocks the AudioContext on this event »), `CountdownTicked{step}` (emitted by `ui/hud/countdown.ts` on each digit change, the first « 3 » included). **Nothing subscribes to the last two yet.** The countdown digit already pulses by CSS: that is the tick's visual twin.
- **Emitter** (`@shared/emitter`): synchronous, copy-on-write, no isolation: a throwing listener skips the next ones (story 1.4 D4 fail-stop; deferred « decide with story 1.9 »).
- **Pause** (`app/pauseController.ts`): `requestPause` emits `PauseRequested` only from `running`/`resuming` (already paused: nothing). `GameResumed` is emitted from `pause.update`, called by the loop at the start of a frame (rAF), **not** inside a user gesture. `bindVisibilityPause` pauses on `hidden` in any app state.
- **Level start** (`app/levelSession.ts`): `loading` → `loadAssets` → `createSim` (needs the geometry) → scene → `waitForForeground` → `requestPause('levelStart')` and, if possible, `requestResume()` in the same tick → `active` set → `appFsm.enter('level')` → `loop.start()`. Generation token on every await; « Recommencer » calls `start()` again (from `paused`, so `levelStart`'s `requestPause` emits nothing).
- **Loop** (`client/loop.ts`): calls `onSimEvent(event)` synchronously right after each step, then `render(alpha)`; `onLevelFrame` (boot) runs once per rendered frame, paused or not. Nothing in it allocates per frame.
- **Start screen** (`ui/screens/startScreen.ts`): listens on `window` for `pointerup` (primary, left button for a mouse) and `keydown` (`isStartKey`), fires `onStart` once. It never checks that the pointer went down while it was mounted (deferred from the 1.5 review to this story).
- **Content**: `CONTENT_FILES = [FEEL_FILE, STRINGS_FILE]`; `ContentBundle = { feel, strings }`; `loadContent` loads both explicitly; `browserContentSource` inlines every `content/**/*.json` but `_schemas/` and `*.geometry.json`, so a new `feedback.json` reaches the browser with no change there. `content:check` (`tools/content/contentChecks.ts`) validates every file against its registered schema, string references, and the generated JSON Schemas.
- **Assets**: `fetchBytesWithTimeout(url, LEVEL_FETCH_TIMEOUT_MS)` and the `import.meta.env.BASE_URL` rule (never `/assets/…`) in `assets/loadLevelAssets.ts`; `LEVEL_PAYLOAD_MAX_BYTES` (3 MB) checked on the `.glb` alone by `tests/architecture/levelAssets.test.ts`. `public/assets/audio/` does not exist yet.
- **Platform**: `src/platform/` holds only `.gitkeep`. The alias `@platform/*`, Biome's and `layerBoundaries`' rules for it exist (platform imports only `@shared` and `@capacitor/*`; nobody but the client imports it). No `VITE_TARGET` anywhere yet.
- **Render**: `levelScene.ts` builds Papa and the baby views; `update(world, alpha)` updates both; `dispose()` frees everything (geometries/textures counts must match after « Recommencer », `level.spec.ts`). Draw calls capped at 100. `PALETTE` has `cream`, `ink`, `paper`, `primary`.
- **E2E**: mirrors are `data-pp-*` on `<html>`, written on events only; `collectProblems` fails on console errors and on the app's own warnings (`OWN_WARNINGS`); `sceneShot` compares the canvas with the DOM layers hidden, and several specs assert « nothing moved while paused ».
- **Measured on this machine (2026-10-27)**: Playwright's Chromium (HeadlessChrome 156) and WebKit (Safari 27.2) both decode an `afconvert` AAC `.m4a` with `decodeAudioData` (a 2.000 s clip decodes to exactly 2.000 s: no padding gap). A fresh `AudioContext` is `running` in headless Chromium without any gesture and `suspended` in WebKit. `navigator.vibrate` is a function in Chromium and `undefined` in WebKit. Use these facts in the e2e; GitHub's ubuntu runner is not measured (see Deferred by this story).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | `content/feedback.json` holds five sections: `buses` (gain per bus), `haptics` (vibration pattern per kind), `loops` (`babble`, `music`), `cues` (id → `{audio?, visual?, haptic?, camera?}`), `events` (event name → cue id). Threats (1.10/1.11) will point at cue ids from their JSON (`ThreatDef.feedback.* → cues`). It is **client-only**: no feel key is added, so `feelHash` and every golden stay as they are. | One table Geo edits for every multimodal mapping (architecture › Contenu et feeling, ADR-006); the event → cue indirection lets several events and threats share one cue; keeping feel out keeps the sim and the goldens still (AC 9). |
| D2 | The two loops are **state-driven, not cues**: they are not in `events` and the twin rule does not apply to them. The babble's visual twin is the baby itself on screen, and its absence (the silence) gets the `silence-bubble` in 1.21 (P4). The music is mood, not a signal (FR60, story 2.6). | The twin rule is about signals (GDD › pillar 3: « chaque signal sonore »). A vibration that lasts as long as the babble would be absurd. |
| D3 | **Context life cycle.** Created and unlocked inside the start gesture: `new AudioContext({ latencyHint: 'interactive' })`, `resume()` (not awaited in the handler; its promise is caught and logged), and one 1-sample silent buffer started at once (the classic iOS unlock). Suspended on **every** `PauseRequested` (any reason, `levelStart` and `visibilityHidden` included); resumed on `GameResumed` only. The countdown is therefore silent: the tick is a haptic (D13), its visual is the existing CSS pulse. Do **not** set `navigator.audioSession.type`: the iOS silent switch must keep muting the game (EXPERIENCE.md › Julien's journey). | The epic is literal: « suspendu, puis repris à la fin du décompte ». Suspending the context (rather than muting buses) freezes the loops at their exact position, which matches the exact pause (NFR5). A tick sound would need the context running during the countdown: Open point 2. |
| D4 | **Preload.** In `loading`, `loadAudio()` runs in parallel with `loadAssets` and both are awaited before `createSim`. The manifest is `feedbackClips(content.feedback)` (every clip of `loops` and `cues`): there is no level JSON before story 1.10, which may narrow it per level. Each clip is fetched from `${BASE_URL}assets/audio/<clip>.m4a`, checked for an MP4 `ftyp` box at bytes 4 to 7 (a single-page fallback answers a missing file with HTML and 200), and decoded once per page; decoded buffers are kept across restarts. A failed clip is one `warn` (`audio clip <clip> unavailable: <reason>`) and is skipped; with no context (unlock failed) the preload logs one `warn` and resolves. Never `oops` for audio. | NFR7: the game is complete without sound, so a missing sound must not cost the player the level. Decoding once keeps « Recommencer » fast (story 1.6 reloads the `.glb` every time already). |
| D5 | **Loops.** `startLevelLoops()` on `AppStateChanged → level`; `stopLevelLoops()` (fade-out of the loop's `fadeMs`) on any `AppStateChanged` from `level`. Music plays for the whole level. Babble is edge-triggered from `world.baby.babbling`, read once per rendered frame in `onLevelFrame` (a boolean compare, no allocation): `false → true` starts a new looping source with a fade-in, `true → false` fades it out and stops it. Starting a loop while the context is suspended (the `levelStart` pause) is fine: it sounds when the context resumes. Each loop is an `AudioBufferSourceNode` with `loop = true` into its own gain node into its bus. | « Recommencer » goes `level → loading → level`: stopping on exit and starting on entry gives exactly one pair of loops per level. Story 1.21 only has to set `babbling = false` in the sim. |
| D6 | **Director.** One `handle(name, world)` path for sim events (from `onSimEvent`) and the client events of `FEEDBACK_CLIENT_EVENTS` (`CountdownTicked`). For a listed event, in this order and in the same call stack: `audio` one-shot (P3: sound at judgement, never deferred), `haptic`, `visual`, `camera`. A part that cannot play (clip not decoded, no scene, no vibration) is skipped; the others still play. An unlisted event does nothing. The cue lookup is a `Map` built once; `handle` allocates nothing but the Web Audio nodes of a one-shot (event-driven, not per frame). `camera` is skipped while `prefers-reduced-motion: reduce` matches (architecture › Retours multimodaux; the in-game setting is story 2.10). | P3 and story 2.3's « same loop turn » rule start here. |
| D7 | **Diegetic visuals on the sim clock.** The `soundWave` (an ink ring on the floor that grows to `maxRadiusM` and fades over `durationMs`) and the `shake` are owned by the level scene and driven by `clock = world.time.sim + alpha × STEP_MS` in `update(world, alpha)`. Pause freezes them, slow-mo slows them, a restart disposes them. The shake moves the scene's content root, not the camera (same picture under the orthographic iso camera; the camera framing and the world UI layer stay untouched). Waves come from a pool of `SOUND_WAVE_POOL_SIZE` (4) meshes sharing one geometry and one material, hidden at rest (no draw call); a fifth wave reuses the oldest. | EXPERIENCE.md › HUD & Diegetic UI puts « visual sound waves and bubbles » in the 3D world, not the DOM. A real-time animation would keep moving behind the pause panel and break the « nothing moved while paused » `sceneShot` checks. |
| D8 | **Platform.** `Platform = { haptics, capabilities }` today; `storage` (stories 2.7/2.8) and `lifecycle` (E8; deferred since 1.4) are added by the stories that use them. `createPlatform({ target, hapticPatternsMs })`: `web` (and an unset target) → the web implementation; `ios` / `android` → the web implementation with one `warn` (« native platform arrives in E8 »). `webHaptics.pulse(kind)` calls `navigator.vibrate(pattern)` only when it is a function; `capabilities.haptics = typeof navigator.vibrate === 'function'`; `capabilities.touch = navigator.maxTouchPoints > 0`. A `vibrate` that throws or returns `false` (no sticky activation) is caught and logged once per session (`warn`, channel `platform`), never per pulse. Patterns come from `feedback.json` `haptics` through boot (the platform may not import content). No UA sniffing. | Architecture › Contrats d'API (`haptics.pulse(kind)`, « no-op si non supporté »), project-context › Platform & Build Rules. Desktop Chrome has `vibrate` and no motor: it reports `true` (Open point 4). |
| D9 | **Event names are checked.** `SIM_EVENT_TYPES` (a runtime list in `src/sim/events.ts`, exported by `@sim`, proved equal to the union at compile time) and `FEEDBACK_CLIENT_EVENTS` are the only valid `events` keys; `content:check` refuses any other. Adding a `SimEvent` without its name breaks `typecheck`. | A typo (`PapaBlockd`) would otherwise be a cue that never plays, silently. The list is data only: no system reads it, so no golden changes. |
| D10 | **The twin rule is an architecture test**, on raw JSON (the live file and fixtures), not a schema refine. | AC 6 names the test; it must be able to load a bad fixture that the schema would never let through; one named guard (architecture › Règles de cohérence). |
| D11 | **Emitter isolation: no change.** The emitter stays fail-stop; instead every listener that does I/O (audio, haptics, director) catches its own Web Audio / `vibrate` exceptions and promise rejections and logs a `warn`. | Resolves the 1.4 deferral without touching `@shared/emitter`: a broken speaker must not stop the pause from reaching the loop, and an isolating emitter would hide real bugs elsewhere. |
| D12 | **Start gesture.** The start screen remembers the `pointerId` of a primary `pointerdown` seen while it is mounted, and starts only on a `pointerup` of that pointer (left button for a mouse). Keys are unchanged (`keydown` is an activation-triggering event). | Resolves the 1.5 review deferral: the tail of a gesture begun before the screen existed must not be the gesture that unlocks audio (iOS may refuse it, and the player did not mean it). |
| D13 | **Seeded table** (provisional, Geo tunes or deletes): `PapaBlocked → papa_bump` (sfx bump, a sound wave at Papa, `light` haptic) and `CountdownTicked → countdown_tick` (`light` haptic only: no audio, so no twin is required). Nothing else: threat cues arrive with their threats. | The director must be provable end to end in this story, and `PapaBlocked` is the only gameplay event that already fires once per occurrence and has a place (story 1.7: « once per blockage »). |
| D14 | **Placeholder audio is generated.** `tools/audio/makePlaceholderAudio.ts` is the source of the three clips (no WAV committed; the `.m4a` files are). Real sounds replace them in stories 2.3 / 7.5 under the same names. | The golden rule: the AI builds the pipeline end to end; Geo swaps the sounds without code. `afconvert` (macOS, present) is the encoder measured above; no npm dependency. |
| D15 | **Debug mirrors** (event-driven): `data-pp-audio` (context state: `none` before the unlock, then the context's `state` on each `statechange`), `data-pp-audio-clips` (number of decoded clips, after each preload), `data-pp-babble` and `data-pp-music` (`on`/`off`, on each loop start/stop), `data-pp-haptics` (`true`/`false`, once at boot), `data-pp-cue` (last cue id played) and `data-pp-cue-count` (cues played since boot). | Playwright cannot hear; story 1.13's `window.__PP__` comes later. |

### Feedback table (`content/feedback.json`)

Schema (`src/content/schemas/feedback.ts`, all `z.strictObject`, `.describe` on every key):

```ts
const AUDIO_BUSES = ['music', 'sfx', 'voice', 'ui'] as const;      // AudioBus
const HAPTIC_KINDS = ['light', 'medium', 'heavy'] as const;          // HapticKind
// <category>_<name>, categories from the architecture (Conventions › Audio)
const CLIP = /^(tel|resp|gag|baby|papa|env|ui|music)_[a-z0-9]+(_[a-z0-9]+)*$/;
const CUE_ID = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;                      // lower_snake_case

buses:   { music|sfx|voice|ui: { gainPct: 0..100 } }                 // all four required
haptics: { light|medium|heavy: { patternMs: int[1..1000], 1 to 8 items } } // navigator.vibrate pattern: on, off, on…
loops:   { babble: Loop, music: Loop }   Loop = { clip, bus, gainPct: 0..100, fadeMs: >= 0 }
cues:    record(CUE_ID, Cue)             Cue  = { audio?: { clip, bus, gainPct }, visual?: SoundWave,
                                                  haptic?: HapticKind, camera?: Shake }  // refine: at least one member
         SoundWave = { kind: 'soundWave', anchor: 'papa' | 'baby', maxRadiusM: (0, 3], durationMs: > 0 }
         Shake     = { kind: 'shake', amplitudeM: (0, 0.5], durationMs: > 0 }
events:  record(string, CUE_ID)          // names checked by content:check (D9)
```

`visual` and `camera` are discriminated by `kind` so stories 2.4 / 2.5 add kinds (`flash`, `bubble`, `zoom`) without breaking the file. The schema's description cites ADR-006 and architecture › Retours multimodaux.

Starting values (guesses, Open point 1):

```json
{
  "$schema": "./_schemas/feedback.schema.json",
  "buses": { "music": { "gainPct": 50 }, "sfx": { "gainPct": 90 }, "voice": { "gainPct": 80 }, "ui": { "gainPct": 80 } },
  "haptics": { "light": { "patternMs": [15] }, "medium": { "patternMs": [30] }, "heavy": { "patternMs": [60] } },
  "loops": {
    "babble": { "clip": "baby_babble_loop", "bus": "voice", "gainPct": 100, "fadeMs": 80 },
    "music": { "clip": "music_crawler_calm", "bus": "music", "gainPct": 100, "fadeMs": 400 }
  },
  "cues": {
    "papa_bump": {
      "audio": { "clip": "papa_bump", "bus": "sfx", "gainPct": 100 },
      "visual": { "kind": "soundWave", "anchor": "papa", "maxRadiusM": 0.6, "durationMs": 350 },
      "haptic": "light"
    },
    "countdown_tick": { "haptic": "light" }
  },
  "events": { "PapaBlocked": "papa_bump", "CountdownTicked": "countdown_tick" }
}
```

Gains are linear (`gainPct / 100`); a cue gain multiplies its bus gain. The architecture's example name `music_crawler_calm` is kept so story 2.6 adds `music_crawler_tense` beside it.

### SIM_EVENT_TYPES (`src/sim/events.ts`)

```ts
export const SIM_EVENT_TYPES = [
  'TimeScaleChanged', 'PapaStateChanged', 'PapaPathPlanned', 'PapaArrived', 'PapaBlocked',
  'BabyStateChanged', 'InvariantViolated',
] as const satisfies readonly SimEvent['type'][];
// Every member of the union is listed (the `satisfies` above proves the other direction):
type Unlisted = Exclude<SimEvent['type'], (typeof SIM_EVENT_TYPES)[number]>;
export type SimEventTypesAreComplete = [Unlisted] extends [never] ? true : never;
const _complete: SimEventTypesAreComplete = true;
```

Pick whichever exhaustiveness idiom Biome accepts without a suppression (an unused `const` may be flagged: an exported type alias assigned from a helper is fine); prove it bites in T10. `InvariantViolated` comes from `@shared/invariant`'s type: check its `type` literal is exactly that.

### Audio engine (`src/client/audio/`)

Interfaces are yours to shape; the behaviour is pinned:

- **Environment injected**: `createAudioEngine({ table: FeedbackTable, createContext?: () => AudioContextLike, fetchBytes?, baseUrl? })`. `AudioContextLike` is the slice of `AudioContext` you use (`state`, `currentTime`, `destination`, `createGain`, `createBufferSource`, `createBuffer`, `decodeAudioData`, `resume`, `suspend`, `addEventListener('statechange')`). Default `createContext`: `() => new AudioContext({ latencyHint: 'interactive' })`, and if `typeof AudioContext !== 'function'` the unlock is an `err` (`warn` once: `audio unlock failed: no Web Audio`).
- **`unlock(): Result<void, AppError>`** — synchronous; idempotent (a second call does nothing and returns `ok`); creates the context, the graph (four bus gains → master → destination, bus gains from `table.buses`), calls `resume()` (promise caught → `warn`), starts a 1-sample silent buffer. A throwing constructor is an `err` with a `warn`; the engine then stays silent and every other method is a no-op.
- **`suspend()` / `resume()`** — call the context's methods when it exists and is not `closed`; promises caught → `warn`. Keep them idempotent in effect (calling `suspend` on a suspended context is harmless; do not track a separate « desired » flag unless a test shows a race).
- **`preload(clips): Promise<void>`** — never rejects; skips clips already decoded; fetches in parallel; per clip: fetch → `ftyp` check → `decodeAudioData` (pass a copy of the bytes' `ArrayBuffer`: decoding detaches it) → cache; a failure is one `warn` naming the clip. After it settles, the mirror callback reports the count.
- **`playOneShot(clip, bus, gainPct): void`** — no-op if no context or clip not decoded (`debug` log at most, it is not a new failure: the preload already warned); otherwise `createBufferSource` → gain → bus → `start(0)`; nodes disconnect themselves on `ended`.
- **`startLevelLoops()` / `stopLevelLoops()` / `setBabbling(isOn)`** — D5. Idempotent: starting twice gives one source; `setBabbling(true)` every frame starts once. Fades with `setValueAtTime` + `linearRampToValueAtTime` over `fadeMs`, then `stop(now + fadeMs / 1000)`.
- **State reporting**: an `onStateChange(state)` callback (for the mirror and an `info` log `audio state <state>` with `baseLatency` once at unlock).
- **Tests (Node, fake context)**: unlock creates one context with `latencyHint: 'interactive'`, calls `resume`, starts a silent buffer; second unlock no-op; constructor throws → `err` + warn, later calls no-op; suspend / resume call through, rejections warned not thrown; preload decodes each clip once across two calls, warns and skips an HTML body, a 404, a decode rejection, and still loads the others; one-shot routes through the right bus gain; loops: one source each after two starts, babble on/off/on gives two sources and one fade-out, stop fades then stops; nothing throws out of any method when the fake throws.

### Feedback director (`src/client/feedback/feedbackDirector.ts`)

```ts
createFeedbackDirector({
  table: FeedbackTable,
  audio: { playOneShot(clip, bus, gainPct): void },
  haptics: Haptics,                       // from the platform
  getScene: () => LevelFx | null,         // the current level scene's fx, null outside a level
  prefersReducedMotion: () => boolean,    // matchMedia('(prefers-reduced-motion: reduce)').matches in boot
  onCue?: (cueId: string) => void,        // debug mirror
}) → { handle(name: FeedbackEventName, world: Readonly<World> | null): void }
```

- `handle` order per D6. `visual.anchor: 'papa'` reads `world.papa.xM/zM`, `'baby'` reads `world.baby`; no world or no scene → the visual is skipped. Start time is `world.time.sim`. A `CountdownTicked` has no world need unless its cue has a visual (it does not).
- Tests: a listed event plays audio (clip, bus, gain), haptic (kind), visual (position, radius, duration, start time) and camera; an unlisted event touches nothing; a cue with only a haptic plays only that; a clip the audio cannot play does not stop the haptic and the visual (fake audio that throws: still the others, and a `warn`); camera skipped under reduced motion; no scene → audio and haptic still play.

### Diegetic visuals (`src/client/render/vfx/soundWaves.ts`, `levelScene.ts`)

- `createSoundWaves(parent, palette)` → `{ play(xM, zM, maxRadiusM, durationMs, startAt), update(clockMs), dispose() }`. One `RingGeometry` (inner/outer radius ratio and segment count are art constants at the top of the file, with units), one `MeshBasicMaterial` in `PALETTE.ink`, `transparent`, `depthWrite: false`, lying flat a few mm above the floor (`SOUND_WAVE_LIFT_M`). `update` sets scale `= maxRadiusM × progress`, opacity `= 1 − progress`, hides a finished wave; allocates nothing. `SOUND_WAVE_POOL_SIZE = 4` in `shared/constants.ts`.
- Shake: `fx.shake(amplitudeM, durationMs, startAt)` offsets the scene's content root by a decaying, deterministic pattern (no `Math.random` needed: e.g. `amplitude × (1 − p) × sin(p × 2π × SHAKE_CYCLES)` on x and a phase-shifted one on z), back to exactly 0 at the end.
- `LevelScene.fx: LevelFx = { soundWave(...), shake(...) }`; `update(world, alpha)` computes the clock once and updates the views, then the waves, then the shake.
- Tests (Node, no WebGL): a wave at `t = 1000` with 350 ms is hidden at rest, visible and growing at `clock 1100`, hidden at `1350`; five plays reuse the oldest mesh; shake offset is 0 before, non-zero during, exactly 0 after; `dispose` frees the ring geometry and material.

### Platform (`src/platform/`)

```ts
export type HapticKind = 'light' | 'medium' | 'heavy';   // same literals as the content schema; platform cannot import content
export interface Haptics { pulse(kind: HapticKind): void }  // never throws; no-op when unsupported
export interface PlatformCapabilities { readonly touch: boolean; readonly haptics: boolean; readonly target: 'web' | 'ios' | 'android' }
export interface Platform { readonly haptics: Haptics; readonly capabilities: PlatformCapabilities }
createPlatform({ target: string | undefined, hapticPatternsMs: Record<HapticKind, readonly number[]>, nav?: NavigatorLike }): Platform
createWebHaptics(nav: NavigatorLike, patternsMs): { haptics: Haptics; isSupported: boolean }
```

`NavigatorLike = { vibrate?: (pattern: number[]) => boolean; maxTouchPoints?: number }`; default `globalThis.navigator`. Boot passes `content.feedback.haptics` mapped to `patternMs`. Tests: no `vibrate` → `pulse` is silent, `haptics: false`, no warn; with `vibrate` → called with the kind's pattern; `vibrate` throws, then returns `false` → one warn each at most over many pulses, never a throw; `target` `undefined`/`'web'` → `web`; `'ios'` → web with one warn; an unknown target → web with a warn.

### Wiring (`boot.ts`)

- After content: `const platform = createPlatform({ target: import.meta.env.VITE_TARGET, hapticPatternsMs: … })`; `const audio = createAudioEngine({ table: content.value.feedback, … })`; mirror `ppHaptics`, `ppAudio = 'none'`.
- Start `onStart`: `audio.unlock()` **first**, then `events.emit('StartGestureReceived', {})`, then `levelSession.start()`. (Subscribing the unlock to `StartGestureReceived` is equivalent; calling it directly keeps the « inside the gesture » path obvious. Keep the event: other listeners may need it.)
- `events.on('PauseRequested', () => audio.suspend())`; `events.on('GameResumed', () => audio.resume())`.
- `events.on('AppStateChanged', ({ from, to }) => …)`: entering `level` → `audio.startLevelLoops()`; leaving `level` → `audio.stopLevelLoops()`.
- `onLevelFrame`: `audio.setBabbling(levelSession.active?.sim.world.baby.babbling ?? false)`.
- `onSimEvent`: `director.handle(event.type, levelSession.active?.sim.world ?? null)` after `logSimEvent`; `events.on('CountdownTicked', () => director.handle('CountdownTicked', null))`.
- `getScene: () => currentLevel?.fx ?? null` — but only while the app is in `level` (a scene behind the loading screen must not play waves for a dead sim).
- `createLevelSession({ …, loadAudio: () => audio.preload(feedbackClips(content.value.feedback)) })`.

### E2E script (`tests/e2e/feedback.spec.ts`)

Helpers from `support/game.ts`; live `content/feedback.json` read in the test, never copied; no `waitForTimeout` (bounded `expect.poll`); `collectProblems` and expect none; `test.info().project.name` (or `browserName`) for the two haptics expectations.

1. **Unlock.** `openGame`: `data-pp-audio` is `none`. Click the start screen; once `data-pp-app` is `level`: `data-pp-audio-clips` equals `feedbackClips(live table).length`; once `data-pp-state` is `running`: `data-pp-audio` is `running`, `data-pp-babble` and `data-pp-music` are `on`.
2. **Pause.** Escape: `data-pp-audio` becomes `suspended`. Escape again (resume): while `data-pp-state` is `resuming` it is still `suspended`; once `running`, `running` again.
3. **Background.** `setVisibility(page, 'hidden')` → `suspended`; back to `visible`, resume through the panel → `running` after the countdown.
4. **Haptics.** `data-pp-haptics` is `true` in Chromium and `false` in WebKit. An init script (test code) wraps `navigator.vibrate` when it exists and records the patterns. Walk Papa into a wall the way `move.spec.ts` « Papa stops against a wall » does: `data-pp-cue` becomes `papa_bump` and `data-pp-cue-count` grows; in Chromium the recorded patterns include the live `haptics.light.patternMs`; in WebKit nothing is recorded and no problem is collected.
5. **Countdown ticks.** Over one pause → resume, `data-pp-cue-count` grows by exactly three with `data-pp-cue = countdown_tick` at the end of the countdown (one per digit), and in Chromium three more light patterns are recorded.
6. **Restart.** « Recommencer »: after the new countdown, `data-pp-babble` / `data-pp-music` are `on`, the decoded count is unchanged (no second decode: assert it never went down), and no problem is collected.

### Placeholder clips (`tools/audio/makePlaceholderAudio.ts`)

| Clip | Bus | Length | Sound (provisional) | Encode |
|---|---|---|---|---|
| `baby_babble_loop` | voice | 6 s, loops | Playful « ba-ba-da-ga » syllables: 120–220 ms bursts of a pitched tone (300–450 Hz, a little vibrato, a fast attack and soft release), irregular short gaps, never more than 0.4 s of silence (the silence is 1.21's telegraph: the loop itself must never sound like one). | mono, 44.1 kHz, AAC 64 kbps |
| `music_crawler_calm` | music | 8 s, loops | Soft triangle-wave arpeggio on a major pentatonic, ~80 BPM, quiet (peak around −12 dBFS). | mono, AAC 64 kbps |
| `papa_bump` | sfx | ~150 ms | A soft low « bonk »: a pitch-dropping sine (180 → 80 Hz) with a fast decay. | mono, AAC 64 kbps |

Loop files: whole number of samples, start and end at zero amplitude with 5 ms fades, so the loop point does not click. Peaks at or below −6 dBFS. Deterministic (seeded `@shared/rng`). The tool lives in `tools/` (Node only, may import anything; never imported by `src/`). Total size well under 200 kB.

### Previous story intelligence (1.5 to 1.8 and their reviews)

- Hot paths allocate nothing: `onLevelFrame` (the babble read), `director.handle` (bar the one-shot's nodes), `soundWaves.update`, `levelScene.update`. No template string in a per-frame `log` or `invariant` call; guard `debug` logs with `log.enabled('debug')`.
- Vitest runs in Node without a DOM or Web Audio: every module takes its environment as parameters (fake context, fake navigator, fake scene). DOM and real audio behaviour is Playwright's.
- Mirrors are written on events, never per frame (1.8). `data-pp-*` names follow the `ppCamelCase` dataset keys of the `mirror` union.
- Playwright: no `waitForTimeout`; bounds from live data; both projects run; `collectProblems` everywhere. `sceneShot` hides the DOM layers but not the 3D scene, hence D7.
- Biome lints TS and CSS; follow the import order it wants; fix code, never `biome.json` (and its `noRestrictedImports` rules already cover `src/platform`).
- A story that adds a content file also: registers it in `CONTENT_FILES`, adds the bundle field, regenerates `_schemas/`, updates `createTestContent`, and fixes the content tests' in-memory sources (1.2 pattern).
- 1.8 review: name every art number as a constant at the top of the file, with its unit; comments must describe what the code does (the cone comment was wrong).
- The dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.9 : …`, by Geo.

### Architecture guardrails and traps (read before coding)

- **Layers:** `src/platform` imports only `@shared` (no `@content`: the haptic literal union is repeated, D8); `src/client` imports `@platform/platform` and `@platform/createPlatform` (the interface and its factory), `@content/*`, `@sim` (`SIM_EVENT_TYPES` is not needed in the client; the type `SimEvent` is). `tools/` may import `@sim` for `SIM_EVENT_TYPES`. `src/content` must not import `@sim` or `@client`.
- **The sim is not touched** beyond `SIM_EVENT_TYPES` (data only). The director reads the world, never writes it; feedback never alters sim time (hitstop and slow-mo stay sim decisions, story 1.14).
- **Iron rule:** every cue with `audio` has `visual` and `haptic` (project-context « ❌ Adding an audio feedback without visual + haptic »).
- **No `console.*`**: `log.<level>('audio' | 'feedback' | 'platform', …)`. No silent `catch`: each logs. `Result` for the unlock and the clip loads.
- **Autoplay:** never create or resume the context before the start gesture (Chrome warns « AudioContext was not allowed to start » in a real browser; WebKit refuses). `decodeAudioData` works on a suspended context.
- **iOS:** the unlock must be in the same task as the gesture's event handler: no `await` before `audio.unlock()` in `onStart`. `resume()` on `GameResumed` runs outside a gesture: allowed once the context has been started by a gesture, but unverified on a real iPhone (Deferred by this story). An `interrupted` state (a phone call) is resumed by the next `GameResumed` (the app pauses on `visibilityHidden` anyway).
- **Chromium headless** runs a context without a gesture and **WebKit** does not (measured): an e2e assertion that the context is `none` before the first gesture is about *our* code creating it, which is what D3 requires.
- **`decodeAudioData` detaches its buffer**: pass `bytes.slice().buffer` (or the exact `ArrayBuffer` range) and never reuse it.
- **Draw calls:** hidden waves cost nothing; at most 4 visible at once (≤ 100 cap, `level.spec.ts`). « Recommencer » must leave the same geometry/texture counts: the waves' geometry and material are freed in `dispose`.
- **Existing tests that must keep passing unchanged:** everything in `tests/architecture/*.test.ts` (the new ones are new files), all golden tests (AC 9), every sim test, `boot.spec.ts`, `level.spec.ts`, `contentError.spec.ts`, `move.spec.ts`, `baby.spec.ts`, `pauseResume.spec.ts`. Deliberate edits: `loadContent.test.ts` and `checkContent.test.ts` (feedback.json in their sources), `jsonSchema.test.ts` if it lists schemas, `levelScene.test.ts` (fx), `levelSession.test.ts` (`loadAudio`), `ui.spec.ts` (D12 case), `support/game.ts` (helpers, `OWN_WARNINGS`), `tests/support/testContent.ts`. List every edited existing test in the Completion Notes with the reason.

### Project Structure Notes

- New (all in the architecture tree): `content/feedback.json`, `content/_schemas/feedback.schema.json` (generated), `src/content/schemas/feedback.ts`, `src/content/feedbackClips.ts` (+ test), `src/platform/{platform,createPlatform}.ts` (+ test), `src/platform/web/webHaptics.ts` (+ test), `src/client/audio/{audioEngine,audioUnlock}.ts` (+ tests; `buses.ts` optional), `src/client/assets/audioAssets.ts` (+ test), `src/client/feedback/{feedbackDirector,feedbackEvents}.ts` (+ director test), `src/client/render/vfx/soundWaves.ts` (+ test), `src/sim/events.test.ts`, `public/assets/audio/{baby_babble_loop,music_crawler_calm,papa_bump}.m4a`, `tools/audio/makePlaceholderAudio.ts`, `tests/architecture/{feedbackEquivalence,audioAssets,platformApis}.test.ts` + `fixtures/feedback/*.json` + `fixtures/platformApis/…`, `tests/content/feedbackSchema.test.ts`, `tests/e2e/feedback.spec.ts`.
- Modified: `src/sim/{events,index}.ts`, `src/content/{contentFiles,contentBundle,loadContent}.ts`, `src/client/boot.ts`, `src/client/app/levelSession.ts` (+ test), `src/client/render/levelScene.ts` (+ test), `src/client/ui/screens/startScreen.ts`, `src/shared/constants.ts`, `tools/content/contentChecks.ts`, `package.json` (`assets:audio` script only), `.env`, `tests/support/testContent.ts`, `tests/content/{loadContent,checkContent}.test.ts`, `tests/e2e/support/game.ts`, `tests/e2e/ui.spec.ts`, `deferred-work.md`, `sprint-status.yaml`. Deleted: `src/platform/.gitkeep`.
- Not in this story: `adaptiveMusic.ts` and the tense stem (2.6), `hapticCues.ts` / `visualCues.ts` as separate files (fold them into the director unless it grows), settings and volumes (2.8), `window.__PP__` (1.13), any threat (1.10), `mute.spec.ts` (2.4), Capacitor (E8).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** every number Geo might tweak (gains, fades, vibration patterns, wave size and duration, which event plays what) is in `content/feedback.json`; art constants of the provisional ring sit at the top of `soundWaves.ts`. The game stays fully playable with no sound and no vibration, by humans and bots.
- **Audio** (project-context › Feedback, rendering, UI): hand-rolled Web Audio, buses music/sfx/voice/ui, pre-decoded buffers, unlock on first tap; the babble loops continuously while `baby.babbling` — its stop *is* the silence telegraph. Howler is forbidden; no audio library.
- **Feedback:** sim emits events → client drains them after each step → `FeedbackDirector` → `feedback.json`; response sound and haptic fire at judgement (P3). Time-altering effects are sim decisions, never feedback.
- **Platform:** `navigator.vibrate` only inside `src/platform`; haptics are a no-op when unsupported; never branch on the user agent; no Capacitor before E8.
- **Lifecycle:** background = pause, and audio suspends with it; audio is never assumed to play before the first tap.
- **Performance:** zero allocation in hot paths; level payload ≤ 3 MB (glb + audio); ≤ 100 draw calls.
- **Errors:** `Result` for I/O (unlock, clip load); every fallback logs a `warn`; no `console.*`; uncaught errors still reach the global handler.
- **Naming:** `…Ms`, `…Pct`, `…M` suffixes; `…AtReal` for real time (the engine's `currentTime` is the audio clock: name any stored value `…AtAudioS` or keep it local); clips `<category>_<name>.m4a`; factories `create<Name>` in a file of that name.
- **Stack pinned:** no new dependency (Web Audio and `navigator.vibrate` are native; `afconvert` is a macOS tool, not a package). Web research: the codec and autoplay facts that matter were measured directly in the pinned Playwright browsers (see « What exists today »); nothing else from outside the pinned stack is needed.
- **Tests:** unit tests colocated; architecture guards are new files with failing fixtures; e2e on both browsers; goldens unchanged; `src/sim` coverage ≥ 90 %.

### Deferred items this story touches (update `deferred-work.md`)

- 1.5 implementation, « Countdown tick sound and vibration, audio unlock »: **resolved in 1.9** for the unlock (in the start gesture) and the vibration (`countdown_tick`); the tick **sound** stays open (D3, Open point 2); the real-iPhone check of `pointerup` / `keydown` unlocking stays open (below).
- 1.5 review, « The start screen starts on any window `pointerup` »: **resolved in 1.9** (D12).
- 1.4 review, « No listener isolation in `Emitter.emit` »: **resolved in 1.9: no change** (D11).
- 1.2 review, « `loadContent` does not loop over `CONTENT_FILES` »: **revisited in 1.9**: the third file is loaded explicitly too (a typed bundle of three fields reads better than a heterogeneous loop); still open for the threat files, where a loop over a pattern will pay off.
- 1.4 implementation, « `Platform.lifecycle` replacing the direct `visibilitychange` listener »: **still open** (`src/platform` exists now with `haptics` and `capabilities` only; lifecycle is E8's).

### Deferred by this story

- **Real-device audio check** (iPhone Safari): unlock on `pointerup` and on `keydown` (a Bluetooth keyboard), `resume()` on `GameResumed` outside a gesture, the `interrupted` state after a call, the silent switch muting everything. Story 1.24's device pass, or before if the playtest needs sound.
- **AAC decoding on GitHub's ubuntu runner** (Linux WebKit uses GStreamer, which may lack AAC). If a project cannot decode there, report the exact warning here and keep the test active for the other project (same policy as WebGL in CI, 1.4).
- **Countdown tick sound**: needs the context running during the countdown with the game buses held silent (Open point 2).
- **Volumes and the « Vibrations » toggle** (`save.settings.volumes`, `settings.haptics`): story 2.8. The bus gains of `feedback.json` are the mix, the player's volumes will multiply them.
- **More visual and camera kinds** (`flash`, `bubble`, `zoom`) and the full twins: stories 2.4, 2.5. The in-game reduced-motion setting: story 2.10 (today the OS query only).
- **Sound waves as final art**, waves anchored on threats or props (`anchor` gains values with 1.11 / 1.15): E7 and those stories.
- **Per-level audio manifest** (only the clips a level uses): with `LevelSchema`, story 1.10 or later.

### Open points for Geo (do not block the dev)

1. Every value of `feedback.json` is a guess: the bus mix (music 50, voice 80…), 15/30/60 ms vibrations, the 0.6 m / 350 ms ring. And whether the bump on a wall should exist at all (it is there to prove the pipeline).
2. The countdown is silent (the epic resumes audio at its end). Want a tick sound? Then the context resumes at the start of the countdown with music, babble and effects held silent until « 1 » ends.
3. The placeholder babble and music are synthesized beeps: replace the three `.m4a` files under the same names whenever real sounds exist (stories 2.3, 7.5).
4. Desktop Chrome reports vibration as supported (it has the API, not the motor): the « Vibrations » row of story 2.8 will show on a laptop.
5. The music plays for the whole level and the babble whenever the baby babbles (always, until 1.21). If it is too much over 3 minutes, lower `buses.music.gainPct`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.9 : Retours de base], and for what comes next [#Story 1.11] (telegraph sound via `feedback.json`, response sound at judgement), [#Story 1.21] (`babbling = false`, music cut), [#Story 2.3], [#Story 2.4] (twins, `mute.spec.ts`), [#Story 2.5] (shake, zoom), [#Story 2.6] (stems), [#Story 2.8] (volumes, vibration), [#Exigences fonctionnelles › FR59, FR60, FR63], [#Exigences non fonctionnelles › NFR7]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Retours multimodaux], [#Synthèse des décisions] (Audio: Web Audio maison, bus, pré-décodés, déverrouillage au premier tap), [#Gestion des assets] (préchargement complet), [#P3 — Jugement à l'appui, chorégraphie ensuite], [#P4 — Le silence comme télégraphe], [#Système d'événements], [#Gestion des erreurs] (`Result` for audio unlock and haptics), [#Configuration] (`VITE_TARGET`), [#Contrats d'API (internes)] (`Platform`), [#Arborescence] (`client/audio/`, `client/feedback/`, `platform/web/webHaptics.ts`, `render/vfx/`), [#Conventions de nommage › Assets de jeu] (audio names), [#Règles de cohérence], [#Performances] (payload 3 MB)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Piliers] (3: « chaque signal sonore a un équivalent visuel et haptique »), [#Mécaniques principales › 8. Le silence comme télégraphe], [#Direction artistique et audio › Audio et musique], [#Plateformes] (« l'audio se déverrouille au premier tap »)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#App Flow] (first gesture unlocks audio), [#State Patterns] (Start muted; Level muted / haptics unsupported / background), [#HUD & Diegetic UI] (sound waves are diegetic), [#Component Behaviour › countdown] (tick, haptic, pulse; « The AudioContext resumes at the end (story 1.9) »), [#Platform notes] (Safari iOS: no haptics; silent switch)
- [Source: _bmad-output/project-context.md] (Feedback, rendering, UI; Platform & Build Rules; Critical Don't-Miss Rules)
- [Source: _bmad-output/implementation-artifacts/1-8-le-bebe-vit-dans-le-salon.md] (`babbling` field, D10 test filters, mirror pattern, review findings on art constants), [1-5-…md] (start screen, countdown, `StartGestureReceived`), [deferred-work.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Code desktop.

### Debug Log References

- Precondition: `git status` clean, `npm run ci` green at `c1fcde8` (baseline_commit).
- `afinfo` on the three clips: 6.000 s, 8.000 s and 0.150 s exactly (`valid frames` match the synthesized lengths), so AAC priming does not move a loop point.
- Guards proved by breaking them, then restoring (git diff of those three files shows only this story's edits): `haptic` removed from `papa_bump` → `feedbackEquivalence` fails naming the cue; clip renamed `papa_bonk` → `content:check` (and `audioAssets`) fail; `events.PapaBlockd` → `content:check` fails at `events.PapaBlockd`; `navigator.vibrate` appended to `boot.ts` → `platformApis` fails on `client/boot.ts`; a `BabyLaughed` member added to `SimEvent` → `typecheck` fails (`Type 'true' is not assignable to type '"BabyLaughed"'`).
- Manual check in the built-in browser (dev server, 844 × 390), reading the debug mirrors: before the tap `data-pp-audio` = `none`, `clips` = 0, loops `off`, `haptics` = `true` (Chromium); right after the tap `running` (loading), then `clips` = 3; entering the level it is `suspended` through the whole countdown (`resuming/suspended` sampled while `data-pp-cue-count` went 3 → 6, one tick per digit) and `running/running` when it ends, with `babble` and `music` `on`. Escape: `paused/suspended`. Walking into a wall: `data-pp-cue` = `papa_bump`, cue count +1, and the live scene showed the ring (4 pooled meshes, one visible, scale 0.115 → 0.529 and opacity 0.81 → 0.12 over ~300 ms, hidden afterwards, position = Papa's). A frozen frame (pause mid-ring) showed the ring at Papa's feet. A temporary `window.__dbg` hook used for that was removed (`grep TEMP DEBUG` = 0).
- The Browser pane must be visible for `requestAnimationFrame` to run: while it was hidden the game paused itself (`visibilityHidden`) and the scene froze; showing the pane fixed it. Not a game bug.

### Completion Notes List

- **Content (T1, T2).** `FeedbackTableSchema` (`src/content/schemas/feedback.ts`), `content/feedback.json` with the Dev Notes' starting values, generated `content/_schemas/feedback.schema.json`, `feedbackClips`, `FEEDBACK_FILE` in `CONTENT_FILES`, `ContentBundle.feedback`, `loadContent` loads it explicitly (and checks its string references with feel's). `content:check` gained the feedback check (event names, cue ids, clip files) with failing fixtures. `SIM_EVENT_TYPES` + `SIM_EVENT_TYPES_ARE_COMPLETE` (a `true` that only typechecks when the list is complete; no suppression needed) in `src/sim/events.ts`, exported by `@sim`; `events.test.ts` checks **no duplicate and PascalCase** (my pick: the list follows the union's order by convention, which the compiler cannot check). `FEEDBACK_CLIENT_EVENTS = ['CountdownTicked']`.
- **Placeholder audio (T3).** `tools/audio/makePlaceholderAudio.ts` (+ `npm run assets:audio`, macOS only) synthesizes the babble (6 s, irregular 120–220 ms syllables, longest silence < 0.4 s including across the loop point), the music (8 s, 21 eighth notes on a C pentatonic, about 79 BPM, peak ≈ −12 dBFS) and the bump (150 ms), with the seeded `@shared/rng`; WAV → `afconvert` AAC 64 kbps. Committed: three `.m4a`, 95 kB in total. `tests/tools/audio/` proves determinism, peaks ≤ −6 dBFS, zero at both ends, lengths, the no-long-silence rule. **I did not listen to the clips** (I cannot hear): the « Listen to each clip once » subtask is left unchecked for Geo. What I verified instead is in the Debug Log (exact decoded durations, zero crossings at the ends, both browsers decode them).
- **Platform (T4).** `Platform`, `Haptics`, `PlatformCapabilities`, `createPlatform`, `createWebHaptics`; a missing `vibrate` is silent and `capabilities.haptics` is `false`; a throw or a `false` answer is one `warn` each per session. `.env` gains `VITE_TARGET=web`. `platformApis.test.ts` + four failing fixtures and a clean one.
- **Audio engine (T5).** `webAudio.ts` (the slice of Web Audio as interfaces), `buses.ts`, `audioUnlock.ts`, `audioEngine.ts`, `client/assets/audioAssets.ts`. Everything is tested in Node with `tests/support/fakeAudioContext.ts`. Two behaviours beyond the Dev Notes: (1) a loop stopped while the context is not `running` stops at once (`stop(0)`) instead of fading, because a frozen clock never reaches the end of the fade and the old loop would sound over the new level when the context resumes; (2) a loop whose clip is not decoded is skipped once per preload, not retried every frame.
- **Director and visuals (T6).** `feedbackDirector.ts`, `render/vfx/soundWaves.ts`, `render/vfx/shake.ts` (split from `levelScene.ts` so it is unit-testable), `LevelScene.fx`. The scene now has a `content_root` group (model, blob shadows, Papa, baby, waves) that the shake moves; the lights stay outside. Deviation from D7: each pooled ring has **its own material** (shared geometry only), because opacity is per material and each wave must fade on its own. `papaView`, `babyView` and `addBlobShadows` now take an `Object3D` parent instead of a `Scene` (type widening only). Ring art constants at the top of `soundWaves.ts`; I raised `RING_INNER_RATIO` from 0.86 to 0.65 after seeing the ring at 1 px thick on screen.
- **Wiring (T7).** `boot.ts`: platform, engine, director, mirrors (`data-pp-audio`, `-audio-clips`, `-babble`, `-music`, `-haptics`, `-cue`, `-cue-count`); `audio.unlock()` first in `onStart`; suspend on `PauseRequested`, resume on `GameResumed`; loops on `AppStateChanged`; `setBabbling` per frame; sim events and `CountdownTicked` to the director; `getScene` only while the app is in `level`. `levelSession` has the optional `loadAudio` (parallel with `loadAssets`, awaited before the sim, never fatal). `startScreen` uses the new `createStartGesture` (D12; `StartTarget` gained `pointerdown`).
- **Guard and e2e (T8, T9).** `feedbackEquivalence.test.ts` with four fixtures; `tests/e2e/feedback.spec.ts` (5 tests × 2 browsers) covering unlock, pause, background, haptics, the bump, three countdown ticks per resume, restart; `ui.spec.ts` gained the D12 case. I dropped the planned « the ring is visible » e2e: the ring is a scene object, not DOM, so the only honest assertion was « the game kept running » (vacuous). It is covered by `soundWaves`/`levelScene` unit tests and the manual check above.
- **Chromium vs WebKit (measured here, Playwright 1.64.1).** Both decode the AAC files, both start the context `running` from the start click; Chromium has `navigator.vibrate` (3 light patterns recorded over one countdown), WebKit has none and records nothing.
- **Edited existing tests, and why:** `tests/content/loadContent.test.ts` (feedback in the bundle; broken and unreadable feedback file cases), `tests/content/checkContent.test.ts` (the temp root now also copies `public/assets/audio/`, otherwise the clip check fails there; invalid-feedback and five reference cases), `tests/content/jsonSchema.test.ts` (feedback `$schema` pointer), `src/client/render/levelScene.test.ts` (fx cases), `src/client/app/levelSession.test.ts` (`NO_FX` in the fake scenes, the `loadAudio` cases), `tests/e2e/ui.spec.ts` (D12 case; its three ways of starting are untouched), `tests/e2e/support/game.ts` (helpers, `OWN_WARNINGS`), `tests/support/testContent.ts` (`createTestFeedback`). `tests/architecture/*.test.ts`, `biome.json`, every golden journal: untouched.
- **Result.** `npm run ci` green: typecheck, lint, `content:check`, 105 test files / 1444 tests with `src/sim` coverage 96.29 % lines (≥ 90), 124 e2e tests on chromium + webkit, `build:playtest`. No `golden:update`; the goldens pass as they were. No new dependency.
- **Not checked:** a real iPhone (unlock on `pointerup` and `keydown`, `resume()` outside a gesture, the silent switch, the `interrupted` state), a real Android vibration, GitHub's Linux runner decoding AAC (all in `deferred-work.md`), and the sound itself (nobody heard it).

### File List

New:
- `content/feedback.json`, `content/_schemas/feedback.schema.json`
- `public/assets/audio/baby_babble_loop.m4a`, `music_crawler_calm.m4a`, `papa_bump.m4a`
- `src/content/schemas/feedback.ts`, `src/content/feedbackClips.ts`, `src/content/feedbackClips.test.ts`
- `src/sim/events.test.ts`
- `src/platform/platform.ts`, `createPlatform.ts`, `createPlatform.test.ts`, `src/platform/web/webHaptics.ts`, `webHaptics.test.ts`
- `src/client/audio/webAudio.ts`, `buses.ts`, `audioUnlock.ts`, `audioUnlock.test.ts`, `audioEngine.ts`, `audioEngine.test.ts`
- `src/client/assets/audioAssets.ts`, `audioAssets.test.ts`
- `src/client/feedback/feedbackEvents.ts`, `feedbackDirector.ts`, `feedbackDirector.test.ts`
- `src/client/render/vfx/soundWaves.ts`, `soundWaves.test.ts`, `shake.ts`, `shake.test.ts`
- `src/client/ui/startGesture.ts`, `startGesture.test.ts`
- `tools/audio/makePlaceholderAudio.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`
- `tests/architecture/feedbackEquivalence.test.ts`, `audioAssets.test.ts`, `platformApis.test.ts`
- `tests/architecture/fixtures/feedback/{audio-without-visual,audio-without-haptic,haptic-only,visual-only}.json`
- `tests/architecture/fixtures/platformApis/{vibrate-in-client,vibrate-bracket,vibrate-destructure,vibrate-optional-chain,clean}/…`
- `tests/content/feedbackSchema.test.ts`, `tests/support/fakeAudioContext.ts`, `tests/e2e/feedback.spec.ts`

Modified:
- `.env`, `package.json` (`assets:audio`), `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`
- `src/sim/events.ts`, `src/sim/index.ts`, `src/shared/constants.ts`
- `src/content/contentFiles.ts`, `contentBundle.ts`, `loadContent.ts`, `tools/content/contentChecks.ts`
- `src/client/boot.ts`, `src/client/app/levelSession.ts`, `levelSession.test.ts`
- `src/client/render/levelScene.ts`, `levelScene.test.ts`, `blobShadow.ts`, `views/papaView.ts`, `views/babyView.ts`
- `src/client/ui/screens/startScreen.ts`
- `tests/support/testContent.ts`, `tests/content/loadContent.test.ts`, `checkContent.test.ts`, `jsonSchema.test.ts`, `tests/e2e/support/game.ts`, `tests/e2e/ui.spec.ts`

Deleted: `src/platform/.gitkeep`

## Change Log

- 2026-10-27: Story 1.9 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
- 2026-10-27: Story 1.9 implemented (review): feedback table and schema, placeholder audio, platform haptics, audio engine, feedback director, sound-wave rings and shake, start-gesture rule, debug mirrors, architecture guards and e2e. One subtask (listening to the clips) left for Geo.
- 2026-10-27: Story 1.9 code review, group 1 of 3 (audio, platform, start gesture, boot): decision and 7 patches applied. The audio wait is capped (`AUDIO_LOAD_TIMEOUT_MS`); a loop that cannot start or stop is skipped once instead of retried every frame; `unlock` closes the context it created when the bus graph fails; one-shots are dropped while the context is not running; the start gesture forgets a cancelled pointer; tests added for the default context (`latencyHint`), the timeout and each guard. Groups 2 (content, feedback, render) and 3 (tests) not reviewed yet.
- 2026-10-27: Story 1.9 code review, groups 2 and 3, all 17 patches applied and `npm run ci` green. Director: `Object.hasOwn`, a `warn` for a dangling event, every call guarded (`handle` never throws into the loop); `FeedbackTableSchema` refuses an event whose cue does not exist (`loadContent` too); `content:check` refuses a visual or camera on a client event's cue; `resetFx()` ends rings and shake when the loop stops; the shake zeroes its offset when the clock is before its start; the placeholder tool writes all clips or none; `SIM_EVENT_TYPES` sorted and tested. Tests: `platformApis` (cast, alias, `window.navigator[…]`, `in`, `Reflect.get`, every script extension, non-empty scan), `feedbackEquivalence` (not vacuous, `null` is absent), `audioAssets` (`M4A ` brand, not a stub), stricter fake `AudioContext` (own test), `feedbackSchema` (exact failing paths, accept bounds, every level's unknown keys), e2e (live cue ids and haptics, `RESUME_COUNTDOWN_DIGITS`, one bump per blockage, context made in the gesture's task, silent countdowns from the mirror history, every `[audio]` and `[feedback]` warning fails a session). Status: done.

### Review Findings

Code review of 2026-10-27 (diff `c1fcde8..6861598`, chunked: this pass covers **group 1 of 3**, the audio engine, platform, assets, start gesture, boot and level session, 2 015 lines). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (none failed). The Acceptance Auditor found AC 1 to 4 and 7, 8 and D3, D4, D5, D8, D11, D12, D15 implemented; it did not run `npm run ci`. Groups 2 and 3 follow below. Group 1: 1 decision_needed (resolved), 7 patch (fixed), 1 defer, 9 dismissed.

- [x] [Review][Decision] (decided 2026-10-27: option 1, cap the whole audio wait; applied as `AUDIO_LOAD_TIMEOUT_MS` = 5 000 ms in `shared/constants.ts`, raced inside `preload`, a `warn` and a silent start on timeout) How long may the audio hold the loading screen? — `fetchBytesWithTimeout` bounds the fetch (20 s) but nothing bounds `decodeAudioData`, and `levelSession` awaits `audioLoad` before creating the sim. A decode that never settles (Safari, a suspended or `interrupted` context, a bad AAC file) freezes the game on `loading` with no Oups screen, which contradicts AC 3 (« the level still starts »). Separately, a failed clip is never cached negatively, so a missing file or a bad network costs the full fetch timeout on every level start (the test at `levelSession.test.ts` asserts the retry). Options: (1) cap the whole audio wait at a few seconds (value in `feedback.json` or `shared/constants.ts`), race decode and fetch against it, the level starts silent and logs a `warn`; (2) do not wait at all: the level starts at once and the loops start when the clips are decoded (changes D4, « nothing is decoded during play »); (3) keep 20 s for the fetch only, add a decode timeout of the same size, and cache failed clips for the session. [src/client/audio/audioEngine.ts:157-171, src/client/app/levelSession.ts:140-154]
- [x] [Review][Patch] A babble loop that fails to start is retried and warned on every frame — `startLoop`'s `catch` does not add the loop to `skippedLoops` (the « not decoded » branch does), and `setBabbling` is called each rendered frame, so a persistent throw (closed context, too many sources) logs about 60 `warn` per second and floods the ring buffer. Treat a thrown start like a missing clip (skip once per level), and add a test that calls `setBabbling(true)` several times and counts one warning. [src/client/audio/audioEngine.ts:129-131,290-298]
- [x] [Review][Patch] `unlock()` leaves a live `AudioContext` behind when the bus graph fails — `unlockAudioContext` has already created, resumed and started the silent buffer when `createBusGraph` or `addEventListener` throws; `context` stays `null`, `unlockError` blocks any retry, and the context is never closed (it counts toward the browser's limit). Close it in the `catch` (and warn if closing fails). [src/client/audio/audioEngine.ts:203-212]
- [x] [Review][Patch] `playOneShot` plays into a context that is not `running` — only `context === null || graph === null` is guarded, so while the context is `suspended` or `interrupted` each cue creates a source whose `onended` never fires; they pile up and all sound at once on `resume()`. `stopLoop` already branches on `context.state === 'running'`: skip the cue (debug log) when it is not. [src/client/audio/audioEngine.ts:257]
- [x] [Review][Patch] `stopLoop` forgets the handle before it has stopped the source, and `startLoop` can leave a connected gain node — `setLoop(name, null)` runs before the `try`; if `cancelScheduledValues` or `stop` throws, the source keeps looping with no reference left, and the next `startLevelLoops` plays a second music layer on top. In `startLoop`, a throw from `source.start` after `gain.connect` leaves the gain connected to the bus. Clear the handle after the stop succeeds (or in a `finally` that also disconnects), and disconnect the nodes in the `catch` of `startLoop`. [src/client/audio/audioEngine.ts:104-131,133-155]
- [x] [Review][Patch] The start gesture ignores `pointercancel` — `downPointerId` is only cleared on a matching `pointerup`. A mouse `pointerId` is constant, so a `pointerdown` whose `pointerup` was lost (cancelled gesture, focus change) followed by a later `pointerup` anywhere starts the game. Clear it on `pointercancel` (add the listener to `StartTarget`) and test it. [src/client/ui/startGesture.ts, src/client/ui/screens/startScreen.ts]
- [x] [Review][Patch] `defaultCreateContext` is never executed by a test — every unit test injects its own `createContext`, so neither the `typeof AudioContext !== 'function'` branch nor `new AudioContext({ latencyHint: 'interactive' })` is asserted; dropping the hint would pass the whole chunk (AC 1; Dev Notes › Tests « unlock creates one context with `latencyHint: 'interactive'` »). Stub `globalThis.AudioContext` and assert both. [src/client/audio/audioEngine.ts:66-70, src/client/audio/audioEngine.test.ts]
- [x] [Review][Patch] Weak assertions in the new tests — (a) the fade-out test compares `fadedGain?.gain.value` with itself, so it passes whatever the gain is (`audioEngine.test.ts`); (b) the « idempotent » unlock test builds a second engine and never uses the `s.engine` it just created; (c) « loads them once per start, in parallel with the assets » holds only `loadAudio` pending and `loadAssets` resolves at once, so it proves both loads started, not that they overlap (T7); (d) warnings read with `log.buffer().slice(before)` are only valid until the ring buffer is full: use a counter or a dedicated sink. [src/client/audio/audioEngine.test.ts, src/client/app/levelSession.test.ts]
- [x] [Review][Defer] A held Enter or Space still starts the game from the start screen — `onKeyDown` does not look at `event.repeat`, so an auto-repeating `keydown` from the previous screen (« Recommencer ») starts at once; only the pointer path got the D12 protection. [src/client/ui/screens/startScreen.ts:55-58] — deferred, pre-existing (story 1.5's key path; D12 is about pointers)

#### Group 2 of 3 (content, feedback director, render vfx, sim events, tools; 1 739 lines)

Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (none failed). The Acceptance Auditor ran `content:check`, `tsc` and Biome (clean) and found AC 5, 6, 9 and 10 holding, goldens and `feelHash` untouched. 0 decision_needed, 8 patch, 3 defer, 13 dismissed.

- [x] [Review][Patch] A dangling event→cue entry is dropped silently at runtime, and the director's lookup ignores `Object.hasOwn` — `byEvent` skips an event whose cue is missing with no `warn` (CLAUDE.md: every fallback logs one), and `table.cues['constructor']` or `['toString']` (both match `CUE_ID_PATTERN`) resolve to `Object.prototype` members, so a bogus cue is registered and `onCue` fires for it. `loadContent` has no cross-reference check, only the Node `content:check` does, so a playtest build with a typo plays nothing and says nothing. Use `Object.hasOwn` and `log.warn('feedback', …)` in the director, and add a `superRefine` to `FeedbackTableSchema` (every `events` value is an own key of `cues`) so `loadContent` refuses the table. [src/client/feedback/feedbackDirector.ts:48-51, src/content/schemas/feedback.ts, tools/content/contentChecks.ts]
- [x] [Review][Patch] `director.handle` can throw out of the game loop — only the audio, haptic, ring and shake calls go through `part()`; `deps.prefersReducedMotion()` (`matchMedia`), `deps.getScene()`, the `world.papa` read and `deps.onCue` (a DOM mirror write) run bare inside `onSimEvent`, which `createGameLoop` calls inside its frame, so an exception stops the loop. Run them through `part()` too, and test one that throws. [src/client/feedback/feedbackDirector.ts:55-85, src/client/boot.ts:233-243]
- [x] [Review][Patch] « Allocates nothing » comment is false, `getScene()` is called twice per event, and a dead cast — `handle` creates up to four closures per event (one per part) and the comment above `byEvent` says it allocates nothing but what Web Audio makes (D6 / previous-stories note); it is event-driven, not per frame, so say so instead. Resolve the scene once. In `soundWaves.ts` `(wave.material as Material).dispose()` casts a `MeshBasicMaterial` for nothing (and the `Material` import exists only for it). [src/client/feedback/feedbackDirector.ts:44-45,289-325, src/client/render/vfx/soundWaves.ts:956]
- [x] [Review][Patch] A cue on a client event can carry a `visual` or `camera` that never plays — boot calls `handle('CountdownTicked', null)`, so `world === null` and the ring and shake are skipped without a warning; neither the schema nor `content:check` links client events to cues that need a world, and `feedbackEquivalence` only checks cues with audio. Add a `content:check` rule: a cue reached by a client event (`FEEDBACK_CLIENT_EVENTS`) has neither `visual` nor `camera`, with a fixture and a test. [tools/content/contentChecks.ts (`checkFeedbackReferences`), src/client/boot.ts:261]
- [x] [Review][Patch] A shake keeps its last offset when `progress < 0` — `update` returns early and leaves `content_root` displaced (a new `start()` whose `startAt` is ahead of the clock, or a clock that goes back). Latent today (the director starts at `world.time.sim`, never ahead), but one line: zero the offset and return. Test it. [src/client/render/vfx/shake.ts:34]
- [x] [Review][Patch] A running ring or shake stays frozen on screen when the level is left — `shake.update` and `waves.update` only run from `level.update`, i.e. from the game loop; when `start()` enters `loading`, `stop()` is called, or a restart fails into `oops`, `drawStatic` renders the old scene (a failed restart keeps it for good) with the ring and the offset at their mid-animation values. Add `resetFx()` to `LevelScene` (rings hidden and inactive, shake offset zero), call it from `levelSession` on `start()` and `stop()`, and update the fakes and a test. [src/client/render/levelScene.ts, src/client/app/levelSession.ts:121-140]
- [x] [Review][Patch] The placeholder tool can leave a mix of fresh and truncated files — it converts straight onto `public/assets/audio/<clip>.m4a`; if `afconvert` fails on clip 2, clip 1 is new, clip 2 is truncated or stale and the command returns with exit code 1, yet `content:check` only tests that the file exists and passes. Convert into the temp directory, and move the files into place only when every clip succeeded. [tools/audio/makePlaceholderAudio.ts:204-232]
- [x] [Review][Patch] Weak or misleading tests — (a) `SIM_EVENT_TYPES_ARE_COMPLETE` is the literal `true`, so `expect(…).toBe(true)` cannot fail (only `tsc` guards it), and T2 asked for « sorted or in union order » to be checked: sort the list and assert it is sorted, or drop the runtime assertion and say the compiler proves it; (b) « freezes the effects with the sim (pause) » calls `update` twice with the same clock, which proves purity, not a freeze: rename it, and add the real case (the clock stops while `update` is called again); (c) « ignores an event that points at a cue that does not exist » asserts only `not.toThrow()`: assert nothing played and one `warn`; the throwing-scene and vibration-throw tests check no warning; `JSON.stringify(world)` misses Maps and typed arrays (use `structuredClone` + `toEqual`); `warnings().slice(before)` reads the capped log buffer (use a spy, as in `audioEngine.test.ts`). [src/sim/events.test.ts:6-22, src/client/render/levelScene.test.ts:443-453, src/client/feedback/feedbackDirector.test.ts:201-230]
- [x] [Review][Defer] Shake frequency is tied to `durationMs` and aliases at 60 fps — the wobble is `SHAKE_CYCLES / durationMs`, z at 1.5×: with the table's 200 ms and 4 cycles, x is 20 Hz and z 30 Hz, exactly Nyquist at 60 fps, so the z amplitude flickers with the frame phase. Frequency should be a Hz value in the data. [src/client/render/vfx/shake.ts:3-4,36-37] — deferred, latent: no cue in `feedback.json` uses `camera` yet; story 2.5 (juice) introduces the first one and tunes it
- [x] [Review][Defer] Taps and the tap marker ignore the shake offset — the shake moves `content_root` by up to `amplitudeM` (0.5 m) but `pickFloor` intersects the camera ray with y = 0 in unshaken space and the world UI projects from sim coordinates. [src/client/input/hitTest.ts:30-37, src/client/render/levelScene.ts] — deferred, latent: same as above, with story 2.5
- [x] [Review][Defer] Looped `.m4a` clips will not loop gaplessly — AAC adds encoder delay and padding (about 2 112 samples), which `decodeAudioData` on WebKit keeps, so the 5 ms fades at the loop ends do not hide a gap or click. [tools/audio/makePlaceholderAudio.ts:1597-1606, content/feedback.json loops] — deferred: the clips are placeholders; the real music and babble (stories 2.3, 7.5) must be checked for seamless looping on a device, and the container reconsidered if not

#### Group 3 of 3 (tests/: architecture guards, content, e2e, fake context, placeholder tool; 1 294 lines)

Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (none failed). The Acceptance Auditor found every AC 1 to 10 proved by some test and every checked T1 to T10 test file present, in the right place, with no `console` and no missing `vitest` import. 0 decision_needed, 9 patch, 0 defer, 15 dismissed. The group 1 fix to `tests/support/fakeAudioContext.ts` (`close()`) is in the working tree, not yet committed.

- [x] [Review][Patch] `platformApis` misses common ways to reach `vibrate`, and scans little — the `NAVIGATOR_BRACKET` lookbehind forbids a `.` before `navigator`, so `window.navigator['vibrate'](30)` and `globalThis.navigator['vibrate']?.(1)` pass (verified on the regexes); `(navigator as any)['vibrate']`, an alias (`const n = navigator; n['vibrate']`), `'vibrate' in navigator` and `Reflect.get(navigator, 'vibrate')` pass too. `SOURCE_FILE` is `/\.(?:ts|mts|tsx)$/` (no `.js`, `.mjs`, `.jsx`, `.cts`), a symlinked directory is skipped, and nothing asserts that the live scan found a file. Drop the `.` from the lookbehind, cover the cast form and `in navigator`, scan every script extension, assert a non-empty scan, and add one fixture per newly caught form (and one where only the bracket rule can fire). [tests/architecture/platformApis.test.ts:260-292, tests/architecture/fixtures/platformApis/]
- [x] [Review][Patch] `feedbackEquivalence` can pass vacuously — `table?.cues ?? {}` yields no problem when `cues` is renamed or lost, the live test never asserts that it examined at least one cue with `audio`, and `"visual": null` or `"haptic": null` count as present twins (`=== undefined`). Assert the live file has at least one audio cue, treat `null` as absent, and add the two missing fixtures (both twins missing: two messages; a complete audio cue: passes). [tests/architecture/feedbackEquivalence.test.ts:75-95]
- [x] [Review][Patch] Tests pin live cue ids and haptic kinds that Geo may retune — the e2e hard-codes `'countdown_tick'` and expects `LIGHT_PATTERN` for both the bump and the tick (D13: « Geo tunes or deletes »), and `three` ticks; `checkContent.test.ts` removes `music_crawler_calm.m4a` by name instead of `loops.music.clip`, and its « accepts a client event name » case uses `PapaArrived`, a sim event, so emptying `FEEDBACK_CLIENT_EVENTS` would not fail it. Read the ids from `events.PapaBlocked` / `events.CountdownTicked`, the pattern from `haptics[cues[id].haptic]`, the digit count from the countdown constant, and use `CountdownTicked` for the client-event case. [tests/e2e/feedback.spec.ts:774-811, tests/content/checkContent.test.ts:364-405]
- [x] [Review][Patch] `OWN_WARNINGS` covers two of the app's warnings — only `audio unlock failed` and `audio clip … unavailable` fail an e2e run; `audio resume failed`, `audio suspend failed`, `audio loop … failed to start`, `audio one-shot … failed`, `audio preload gave up`, and the platform's `navigator.vibrate refused` / `threw` pass unseen. Match every warning of the `audio` and `platform` channels (check that no e2e run emits one legitimately in WebKit before keeping it), and add a unit test of the pattern. [tests/e2e/support/game.ts:939-941]
- [x] [Review][Patch] The e2e does not prove the unlock is inside the gesture, nor that the countdown stays silent — `data-pp-audio` is read once, `suspended`, after the click (AC 1, D3: the unlock would also pass if it ran later, since `GameResumed` resumes outside any gesture), and once at `resuming` (a context that resumed briefly mid-countdown would pass). Record `navigator.userActivation.isActive` when the page's `AudioContext` is constructed (`addInitScript` wrapper) and assert it was `true`; record the history of `data-pp-audio` with the `MutationObserver` technique of the restart test and assert `running` never appears before `data-pp-state=running`. [tests/e2e/feedback.spec.ts:696-757, tests/e2e/support/game.ts]
- [x] [Review][Patch] Two small e2e gaps — the bump is asserted with `toBeGreaterThan(before)`, not once per blockage (the countdown test already asserts an exact `+3`); and `liveClipCount` rebuilds the clip set from `loops` and `cues[*].audio` instead of calling `feedbackClips` (the E2E script says `feedbackClips(live table).length`), so a new clip source diverges silently. Assert exactly one more cue after the blockage settles, and import `feedbackClips` from `src/content/feedbackClips.ts`. [tests/e2e/feedback.spec.ts:783, tests/e2e/support/game.ts:880-884]
- [x] [Review][Patch] The fake `AudioContext` diverges from Web Audio in cheap-to-fix ways — `start()` twice and `stop()` before `start()` never throw (`InvalidStateError` in browsers), and `resume()` on a `closed` context resolves to `running` (it rejects). Make the fake throw and reject like the real thing, and fix the engine tests this exposes. (Not changed: synchronous `statechange`, `AudioParam.value` not following automation: documented limits of the double.) [tests/support/fakeAudioContext.ts]
- [x] [Review][Patch] `feedbackSchema.test.ts` is weaker than it looks — refusal cases only `expect(failed).toContain(path)` (a blanket failure still passes), the camera refusals assert only `ok: false`, only rejections are tested (no accept case for 8 pattern items, 1 and 1000 ms, radius exactly 3, `gainPct` 0 and 100, `fadeMs` 0; non-integer `patternMs` and a cue `gainPct` of -1 are missing), unknown-key cases skip `haptics`, `loops`, `audio`, `camera` and `events`, the unit-suffix walker ignores arrays (`patternMs: [15]`) and accepts any key ending in `M`, the emitted-JSON-Schema description walker ignores `$ref`/`$defs`, `allOf` and `items` and has no floor on how many properties it visited, and nothing parses `createTestFeedback()` through `FeedbackTableSchema`. Assert the exact failed paths, the camera path, the accept boundaries, the extra unknown keys, spell the unit suffixes out (`RadiusM`, `DistM`… as `feelSchema.test.ts` does), follow refs and arrays with a minimum count, and parse the test table. [tests/content/feedbackSchema.test.ts:470-603, tests/support/testContent.ts]
- [x] [Review][Patch] `audioAssets` checks only `ftyp` — any MP4 brand passes, and a 12-byte stub with a valid header is « audio » (it decodes to silence: green tests, silent music). Check the `M4A ` brand (bytes 8-11) and a minimum size. [tests/architecture/audioAssets.test.ts:38-42]
