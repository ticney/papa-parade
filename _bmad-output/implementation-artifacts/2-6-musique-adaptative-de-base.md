# Story 2.6: Basic adaptive music

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR60 (base: « douce au calme, nerveuse quand une menace approche ; elle bascule en ralenti sur réponse parfaite et se coupe pendant un silence suspect ») · **Architecture:** L75 (« Audio adaptatif (coupure, bascule au ralenti) »), **L189** (« Web Audio maison : bus musique / sfx / voix / UI, buffers pré-décodés, **stems synchronisés**, déverrouillage au premier tap »), L516 (`src/client/audio/adaptiveMusic.ts`), L544 (`content/music/` is E7), L646 (`music_crawler_calm.m4a`), L784 (the silence cuts the music) · **GDD:** L87, L182, L483-491 (« Musique adaptative ») · **UX:** EXPERIENCE.md L410 (adaptive music is owned by `feel.json` and `feedback.json`; « the numbers there win »)

## Story

As a player,
I want the music to follow the tension of the moment,
so that I feel the threat coming and the slow-mo settling in.

## Acceptance Criteria

### What already works (keep it, build on it)

`src/client/audio/audioEngine.ts` owns the one `AudioContext`, the four bus gains (`buses.ts`), the decoded buffers and two loops, `babble` and `music` (`LoopName`). Today the **music is one clip** (`loops.music.clip` = `music_crawler_calm`) looped through one gain: `startLevelLoops()` starts it (fade in `loops.music.fadeMs`) when `appFsm` enters `level` (`boot.ts` L391-395), `stopLevelLoops()` fades it out, and `setMusicMuted(isSilent)` (called every frame from `onLevelFrame`, `boot.ts` L709-718) stops it while `world.silence.startedAt !== null` and restarts it when the silence ends (story 1.21: **state, not events**, so a pause, a restart or the level's end can never leave the music off). `data-pp-music` (`on|off`, `onLoopChange`) mirrors it, and `feedback.spec.ts` / `silence.spec.ts` read that mirror. The context is suspended with every pause and the countdown (`audio.suspend()` / `resume()`), which freezes the audio clock, so gain ramps and filter sweeps also freeze. This story replaces the one clip by **two synchronized stems** and lets the game's state drive their mix.

### Content: the stems and their tunables (epics « durée dans `feel.json` », « réglables »)

1. **`feedback.json › loops.music` names two stems.** In `src/content/schemas/feedback.ts` the `music` loop gets its own schema (the `babble` loop keeps `LoopSchema`): `{ stems: { calm: clip, tense: clip }, bus, gainPct, fadeMs }` (`.strictObject`, every member described; `clip` is the existing `CLIP_PATTERN`; `fadeMs` keeps its meaning: fade in at the loop's start, fade out at its stop and at a mute). `calm` and `tense` must differ (a `refine`, with a message). `content/feedback.json`: `"stems": { "calm": "music_crawler_calm", "tense": "music_crawler_tense" }`, `bus` `music`, `gainPct` 100, `fadeMs` 400 (the current values). `feedbackClips` (`src/content/feedbackClips.ts`) lists **both** stems; `content:check` (`tools/content/contentChecks.ts` L215) looks for both files, with the JSON path `loops.music.stems.calm|tense`, and fails when a stem is not in the `music` category (`music_*`; add a failing and a passing case in `tests/content/checkContent.test.ts`, and update its existing `loops.music.clip` case, L377). Update the fixtures that build a table: `tests/support/testContent.ts` L52, `src/client/feedback/feedbackDirector.test.ts` L50, `src/content/feedbackClips.test.ts`, `tests/content/feedbackSchema.test.ts` (L88, L184), `tests/e2e/support/game.ts` L23, `tests/architecture/fixtures/feedback/*.json` if they carry `loops`. Regenerate `content/_schemas/feedback.schema.json` with `npm run content:schemas` (never by hand).

2. **`FeelSchema` gains `music`** (`src/content/schemas/feel.ts`, next to `fx`; `.strictObject` everywhere, every number bounded and described, no `.default()`), so that Geo tunes the mix live in the Tweakpane panel (story 2.1 builds its folders from `FeelSchema`: nothing to add there). All durations are **real** ms (they ride the audio clock, not the sim clock):
   - `tense`: `{ fadeInMs (int 0…5000), fadeOutMs (int 0…5000), calmGainPct (number 0…100) }`: how long the tense stem takes to come up and to go away, and the level the **calm** stem ducks to while the tense one plays (100 = no ducking).
   - `slowMo`: `{ belowScale (number 0.1…1), lowpassHz (number 200…20000), playbackRatePct (number 25…100), inMs (int 0…2000), outMs (int 0…2000) }`: the effect is on while the effective `world.time.scale` is **below** `belowScale`; the music is low-passed at `lowpassHz` and played at `playbackRatePct` / 100 of its speed (pitch drops with it: the « tape slowing down » the epic means), swept in over `inMs` and back over `outMs`.
   - Starting values (Geo retunes them): `tense` 600 / 1500 / 60; `slowMo` `belowScale` **1** (the epic's « `timeScale` inférieur à 1 », literally), `lowpassHz` 900, `playbackRatePct` 80, `inMs` 150, `outMs` 500.
   - `content/feel.json`, **`tests/support/testFeel.json`** (the frozen copy the tests read) and `tests/tools/vite/fixtures/feelSample.json` get the block; `npm run content:schemas` regenerates `content/_schemas/feel.schema.json`. `tests/content/feelSchema.test.ts` covers a valid block and each bound refused.
   - The sim never reads `feel.music` (client-only presentation, like `feel.fx`). It still lives in `world.feel`, so a `SetFeel` on it is journaled and replays like any other (story 2.1), and **it moves the goldens' `feelHash` / `worldHash`**: see AC 13.
   - Two physical limits are constants, not feel (`src/shared/constants.ts`): `MUSIC_START_LEAD_MS` = 50 (AC 4) and `MUSIC_FILTER_OPEN_HZ` = 20000 (the low-pass when the effect is off: wide open, under the Nyquist frequency of 44.1 kHz).

3. **The placeholder tense stem** `public/assets/audio/music_crawler_tense.m4a` (the real music is story 7.5; this one makes the whole pipeline work with no human, golden rule). In `tools/audio/makePlaceholderAudio.ts`: `synthMusicTense()` (exported, deterministic: `createRng(SEED + n)`, no `Math.random`), added to `PLACEHOLDER_CLIPS` right after `music_crawler_calm`. It must be **exactly as long as the calm stem in samples** (`MUSIC_LENGTH_S` × the sample rate: the two loops must never drift) and sit on the same grid (the calm stem has `MUSIC_STEPS` = 21 steps in 8 s; the tense one plays twice as many steps, so its notes land on the calm ones). It must sound *worse* on purpose: a brighter, buzzier timbre (square or sawtooth rather than the calm triangle), a lower register, a flat second or a tritone against the calm scale, normalised to the same `PEAK_MUSIC`, with the same 5 ms end fades. Constants at the top of the file, like the others. Run `npm run assets:audio -- --only music_crawler_tense` (macOS, `afconvert`) and commit **only** that new `.m4a` (a full run rewrites the other clips, which `afconvert` does not reproduce byte for byte: `deferred-work.md` L291). `makePlaceholderAudio.test.ts`: same sample count as the calm stem, not equal to it, normalised to `PEAK_MUSIC`, same bytes on two runs, and the clip is in `PLACEHOLDER_CLIPS` once. The level payload stays under `LEVEL_PAYLOAD_MAX_BYTES` (`tests/architecture/audioAssets.test.ts` measures it; 8 s at 64 kbps is ~64 kB).

### Two stems that start together and stay together (epics AC 1)

4. **`src/client/audio/adaptiveMusic.ts`** (the file the architecture names, L516; `createAdaptiveMusic(deps)`; Web Audio calls go through the `*Like` interfaces of `webAudio.ts`, so it runs in Node tests). The engine keeps the context, the bus graph and the decoded buffers and **delegates the `music` loop to it**; `babble` is unchanged. Graph while the music plays: `calmSource → calmGain` and `tenseSource → tenseGain`, both into one `BiquadFilter` (`lowpass`), then one fade gain (the loop's `gainPct` and `fadeMs`), then `graph.gains.music`. Both sources are `loop = true`, both `start(startAtS)` with **the same** `startAtS = context.currentTime + MUSIC_START_LEAD_MS / 1000` (two `start(0)` calls could land in two render quanta), both stop at the same time, and they always get the same `playbackRate` at the same instant.
   - At rest (no threat, no slow-mo): calm gain 1, **tense gain 0**, filter at `MUSIC_FILTER_OPEN_HZ`, rate 1: only the calm stem is audible.
   - **Guards.** A stem whose buffer is missing: the calm one missing → no music (the preload already warned: no new `warn`, skipped once like a missing loop clip); only the tense one missing → the calm stem plays alone and the mood changes do nothing. Two buffers whose `duration` differ by more than one sample (`1 / buffer sample rate` is not on `AudioBufferLike`: use a small constant tolerance in ms, say 2 ms) → one `warn` on the `audio` channel (« stems differ in length: they will drift »), the music plays anyway. Anything that throws (`createBiquadFilter`, `connect`, `start`...) is caught, `warn`ed once, and the loop is skipped for the level, exactly like `startLoop` today; nothing throws into the frame loop.
   - `webAudio.ts` grows to what the music needs, and nothing else: `BufferSourceLike.playbackRate: AudioParamLike`, `BiquadFilterNodeLike` (`type`, `frequency: AudioParamLike`; declare `type` wide enough for the real node, `tsc` will say) and `AudioContextLike.createBiquadFilter()`. `tests/support/fakeAudioContext.ts` follows (`filters`, a recording `playbackRate` on every source, a `createBiquadFilter` failure switch).
   - Unit tests (`adaptiveMusic.test.ts`, fake context): both sources are created, both started with the same `when`, strictly after `currentTime`; at rest the tense gain is 0 and the calm one 1; the fade-in ramp reaches `gainPct / 100` after `fadeMs`; a stop schedules the same `stop` time on both; a missing tense stem plays the calm one alone; a missing calm stem plays nothing; a length mismatch warns once; a throwing node is skipped with one `warn` and does not throw.

### Tension: the nervous stem comes up with the threats (epics AC 2)

5. **Tension is state, not events** (the model is story 1.21's silence and 2.5's camera). `adaptiveMusic.ts` also exports two **pure, allocation-free** functions the frame loop calls: `isTensionActive(threats)` is `true` when any threat is in `telegraph` or `windowOpen` (a plain `for` loop over `world.threats`, no `some`/`filter`; `hidden`, `resolved`, `gag` and `idle` are calm: a silence's hidden threat is not tension, the music is cut anyway) and `isSlowMoActive(world, belowScale)` is `world.time.scale < belowScale`. They are unit-tested on hand-built worlds (`ThreatState` is exported by `@sim`; use the sim's own test factories for a `World`, not a cast of `{}`).
   - Engine: `setMusicMood(isTense: boolean, isSlowed: boolean)`, edge-triggered and cheap enough for every frame (a boolean compare when nothing changed, like `setBabbling` and `setMusicMuted`). The engine takes a new option `getMusicFeel(): Feel['music']`, read **at each transition** (boot passes `levelFeel().music`, so a Tweakpane change applies to the next transition; a ramp already scheduled keeps its numbers). It remembers the wanted mood even while the music is stopped (muted by a silence, or between levels), so that a restart begins in the right mood. `stopLevelLoops()` resets the mood to calm.
   - **Tense up:** on `isTense` turning `true` the tense gain ramps from where it is to `gainPct`-relative 1 over `tense.fadeInMs` and the calm gain ducks to `tense.calmGainPct / 100` over the same time. **Tense down:** when no threat is active any more, tense goes back to 0 and calm back to 1 over `tense.fadeOutMs`. A ramp starts from the **current** value: `cancelScheduledValues(now)`, `setValueAtTime(param.value, now)`, `linearRampToValueAtTime(target, now + durationS)`, the pattern `stopLoop` already uses (`durationMs` 0 sets the value at once).
   - A level start or an unmute **restarts the stems from their beginning, together**, with the gains/filter/rate already set for the wanted mood (no ramp for them, only the fade-in of the whole music).
   - Unit tests: calm → tense ramps the tense gain to 1 and the calm one to `calmGainPct / 100` over `fadeInMs`; tense → calm ramps back over `fadeOutMs`; a change mid-ramp starts from the current value; the same mood twice schedules nothing; the mood set while muted or between levels applies at the restart; a `getMusicFeel` change between two transitions is read at the second.

### Slow-mo: the music slows down with the game (epics AC 3)

6. **While `isSlowed`** (`world.time.scale < feel.music.slowMo.belowScale`, evaluated per frame by `isSlowMoActive`): the filter's `frequency` ramps to `slowMo.lowpassHz` and **both** stems' `playbackRate` to `slowMo.playbackRatePct / 100`, over `slowMo.inMs`; when `isSlowed` turns `false` they ramp back to `MUSIC_FILTER_OPEN_HZ` and 1 over `slowMo.outMs`. Same current-value-first ramps as AC 5, same remembered mood. Tension and slow-mo are independent (a perfect parry happens while the threat it resolved may still be `resolved`, the next one `telegraph`: both can be on).
   - **Why `scale`, not an event** (`1-14` D10 suggested starting on `ResponseResolved{perfect}`): the effective `timeScale` already carries every slow-mo (`perfect`, `lastThreat`, and story 2.9's `instinct`), the hitstop does not change it (the music must not duck for 80 ms), a pause or a restart cannot leave the effect stuck, and the return follows the sim's own smoothstep (`outMs` adds a short tail after the scale is back to 1; Geo can set 0). Record in the Completion Notes that the instinct's ×0.8 will also trigger it at `belowScale` 1; story 2.9 or Geo raises the bound down (e.g. 0.7) if that is not wanted.
   - Unit tests: slow-mo on ramps the filter and both rates together over `inMs`; off ramps them back over `outMs`; both stems always receive identical rate events; `playbackRate` is never set on one stem alone.

### The silence still cuts the music (epics AC 4)

7. **`setMusicMuted` keeps its contract** (story 1.21): while `world.silence.startedAt !== null` the music is faded out (`loops.music.fadeMs`) and **both stems stopped**; it restarts on `SilenceEnded` (state), again from the beginning, both together, in the wanted mood. `data-pp-music` stays `on|off` and reports the music as a whole (`onLoopChange('music', …)` fires once per start/stop of the pair, not per stem). The existing engine tests of the mute and of the level loops (`audioEngine.test.ts`, the « music mute » and « level loops » describes, L425 on) are updated to two sources and still pass in spirit: nothing to weaken. `silence.spec.ts` and `feedback.spec.ts` pass **unchanged**.

### Wiring and the debug mirrors

8. **`boot.ts`**: in `onLevelFrame`, next to `setMusicMuted`, compute `isTense` and `isSlowed` from the live world (`babbleWorld`, only while `flow.state === 'playing'`; both `false` otherwise) and call `audio.setMusicMood(isTense, isSlowed)`; `createAudioEngine` gets `getMusicFeel: () => levelFeel().music`. Zero allocation per frame.
   - Debug mirrors (`isMirrored` builds only; the `ppMusic*` keys join the union at `boot.ts` L240-262): `data-pp-music-tense` and `data-pp-music-slow` (`on|off`, the **target** mood, from an `onMusicMoodChange` callback of the engine) and `data-pp-music-tense-count` / `data-pp-music-slow-count` (incremented on each entry into the mood: polling misses a short slow-mo at speed 4, 2.4's lesson with the flash). Reset to `off`/`0` where `ppMusic` is reset (L382). `tools/build/inspectDist.ts`: these are `data-pp-*` mirrors like the others; check the prod bundle still holds none of them (`npm run dist:check -- --flavor prod`).
   - The music is **not a cue**: no visual or haptic twin is owed (`feedbackEquivalence.test.ts` covers cues; the telegraph that raises the tension already has its ring, vibration and sound). It is **not** a motion effect either: no reduced-motion variant (state it in the Completion Notes so 2.10 does not look for one).

### Tests (epics: there is none, but the golden rule asks for them)

9. **Engine tests** (`audioEngine.test.ts`): the music is now two sources and a filter; every assertion about « the music loop » is rewritten for the pair (start, fade-in, stop, mute, unmute, failure of a clip, a failed `start`). Add: `setMusicMood` before `unlock`/with no level loops is a no-op that is remembered; `stopLevelLoops` resets the mood; one `onMusicMoodChange` per edge.
10. **`tests/e2e/adaptiveMusic.spec.ts`** (Chromium and WebKit, the default projects; driven like `silence.spec.ts` and `timeEffects.spec.ts`: no fixed sleep, bounds from the live feel):
    - `?autoplay=perfect&seed=<n>&speed=4`: `data-pp-music-tense-count` ≥ 1 once the first threat telegraphs, `data-pp-music-slow-count` ≥ 1 after the first perfect, `data-pp-music` `on` throughout.
    - Deterministic, frozen (`__PP__.freeze(true)` + `__PP__.advance(n)`): calm at the start (`tense` `off`); step to the first `ThreatTelegraphed` → `data-pp-music-tense` `on`; step through the parry → `off` once no threat is `telegraph|windowOpen`; after a perfect, `data-pp-music-slow` `on` inside the slow-mo's hold and `off` once `world.time.scale` is back to 1 (compute `n` from the live `feel.timing.slowMoPerfect`, never typed in the spec).
    - A silence (the `silence.spec.ts` setup): `data-pp-music` `off` while it lasts, `on` after, and the mood mirrors agree with the world at the restart.
    - `collectProblems(page)` stays empty (no `warn` from the audio channel: the harness fails a session on one).
    - What no spec can check, and the Completion Notes must say: **how it sounds** (the audible graph is proven with fakes, the mirrors prove the intent). Geo listens.

### Hygiene

11. **Specs that pin shared contracts**, run on Chromium while developing (`npx playwright test <files> --project=chromium`, `VITE_DEBUG_ALLOWED` unset): `feedback.spec.ts`, `silence.spec.ts`, `mute.spec.ts`, `timeEffects.spec.ts`, `testApi.spec.ts`, `debugOverlay.spec.ts` (the new `music` folder of the feel panel).
12. **No sim behaviour change.** No sim file changes except through `FeelSchema` (the sim never reads `music`). `npm run sim` results do not move.
13. **Goldens**: the new keys of `testFeel.json` move `feelHash` and `worldHash`: `npm run golden:update`, **deliberately**, and check that the diff of `tests/golden/journals/` holds **only hash lines** (no event moves), as in 2.5. Say so in the Completion Notes, with the files that moved.
14. **Docs**: `deferred-work.md` gets a dated 2.6 section (AC 15); `_bmad-output/project-context.md` › Feedback gets one line: « The level music is two synchronized stems (`feedback.json › loops.music.stems`) mixed by `client/audio/adaptiveMusic.ts` from the world's state each frame: the tense stem while a threat is `telegraph|windowOpen`, a low-pass and a lower `playbackRate` while `world.time.scale` is under `feel.music.slowMo.belowScale`, a cut while a silence lasts. Tunables are `feel.music`. »
15. **Deferred, to record** in `deferred-work.md`: music tightening above 70 % noise with an alert sound (GDD L229, L491; FR60 complete, `[V1]`; not in this story's ACs); `content/music/` and a per-age stem set (story 7.5, which swaps the two stem names for a set); more than two stems; the gapless loop of `.m4a` on WebKit (L158) now concerns **two** loops and a drift between them if the encoder pads them differently (this story warns on a length mismatch; judge on a device, story 8.2); `ramp` behaviour of `param.value` read mid-ramp on Safari (the existing `stopLoop` pattern relies on it too); the instinct's ×0.8 also triggering the slow-mo effect (AC 6); no debug « Sons » audition of a mood (Geo tunes by playing, or `ForceThreat`); the shared music fade (`fadeMs`) covers level start, stop and mute alike.
16. **`(unset VITE_DEBUG_ALLOWED; npm run ci)` is green** once, before the review (`env | grep VITE_` first), `dist:check` for both flavours, `e2e:dist` with `perf.spec.ts` within budget (the per-frame cost is one loop over a handful of threats and two comparisons; say the measured p95, draw calls and triangles in the Completion Notes next to 2.5's: 16.7 ms, 40, 1466). `npm run ci:fast` after each task.

## Tasks / Subtasks

- [ ] **T1. Content schemas and files** (AC 1, 2): `loops.music.stems` in `feedback.ts` + `feedback.json`; `feel.music` in `feel.ts` + `feel.json` + `testFeel.json` + `feelSample.json`; `MUSIC_START_LEAD_MS`, `MUSIC_FILTER_OPEN_HZ`; `feedbackClips`; `npm run content:schemas`; schema tests and every fixture of AC 1.
- [ ] **T2. Content checks** (AC 1): both stem files, `music_*` category; failing and passing cases.
- [ ] **T3. Placeholder tense stem** (AC 3): `synthMusicTense`, `PLACEHOLDER_CLIPS`, the `.m4a` through `--only`, tests.
- [ ] **T4. Web Audio surface** (AC 4): `webAudio.ts`, `fakeAudioContext.ts` (+ its own test).
- [ ] **T5. `adaptiveMusic.ts`** (AC 4-7): stems, mood, slow-mo, mute, guards; `isTensionActive`, `isSlowMoActive`; unit tests.
- [ ] **T6. Engine integration** (AC 5, 7, 9): delegate the `music` loop, `setMusicMood`, `getMusicFeel`, `onMusicMoodChange`; rewrite `audioEngine.test.ts`.
- [ ] **T7. Boot wiring and mirrors** (AC 8): per-frame call, mirrors, resets; `dist:check` prod.
- [ ] **T8. e2e** (AC 10, 11): `adaptiveMusic.spec.ts`; the pinned specs on Chromium.
- [ ] **T9. Goldens** (AC 12, 13): `npm run golden:update`; hashes only.
- [ ] **T10. Docs** (AC 14, 15): `deferred-work.md`, `project-context.md`.
- [ ] **T11. CI** (AC 16): `ci:fast` after each task; the full CI once at the end; report the perf numbers. On a loaded machine rerun with `--maxWorkers=5` / `--workers=4` and say so.

## Dev Notes

### Decisions (D1-D7)

- **D1. Mix values in `feel.json`, stem names in `feedback.json`.** The epic puts the fade and the slow-mo effect in `feel.json` / « réglables »; that is where Geo tunes them live (the panel is generated from `FeelSchema`). `loops.music` stays in `feedback.json` because it already names the clip, the bus and the fade, and ADR-006 keeps every « which sound » there. Story 7.5 moves the stems to `content/music/` per age; do not build that now.
- **D2. State, not events.** The mood is recomputed from the world every frame and applied on the edge. A pause, a restart, a hitstop or a level end cannot leave the music tense or slowed, exactly as 1.21 did for the silence. The cost is a short `for` over `world.threats` and one comparison.
- **D3. `world.time.scale`, not `ResponseResolved{perfect}`** (AC 6). It follows every slow-mo and the sim's return curve for free, and ignores the hitstop. The price (the instinct also triggers it) is recorded for 2.9.
- **D4. Tension = `telegraph` or `windowOpen`** (the epic's words). `hidden` (the silence's threat) is not tension; `resolved` and `gag` end it at once, which is the epic's « redescend quand plus aucune menace n'est active ».
- **D5. The tense stem ducks the calm one** (`tense.calmGainPct`, start 60) rather than only adding to it: two full-volume stems sum to a loud, muddy mix. At 100 the calm stem is untouched and the epic's literal « le stem nerveux monte en fondu » holds. Open point 2 for Geo.
- **D6. A mute restarts the stems; it does not mute their gain.** Behaviour kept from 1.21 (`data-pp-music` `off` during a silence, `on` after, the e2e specs read it). Restarting from the beginning also resyncs the two stems for free.
- **D7. One filter, one rate, shared by both stems.** The effect is on the music as a whole, so a single `BiquadFilter` after the stem gains and the same `playbackRate` on both sources. Setting a rate on one stem alone would desynchronise the loop.

### Current state of the files this story changes (read before editing)

- **`src/client/audio/audioEngine.ts`** (372 lines): `startLoop(name)` builds source + gain from `table.loops[name]` (single `clip`), skips a loop whose clip is not decoded (`skippedLoops`, cleared by each preload) and one whose start threw; `stopLoop(name)` fades out with the `cancelScheduledValues` / `setValueAtTime(gain.value)` / `linearRamp` / `stop(now + fade)` pattern, with a frozen-clock branch (`context.state !== 'running'` → `stop(0)`); `startLevelLoops` / `stopLevelLoops` / `setMusicMuted` / `setBabbling` are all idempotent and every-frame cheap; `LoopHandle = { source, gain }`. The `music` branch moves to `adaptiveMusic.ts`; `babble` keeps this code. Keep: never throws into the caller, `warn` once, `onLoopChange`.
- **`src/client/audio/audioEngine.test.ts`** (662 lines) + **`tests/support/fakeAudioContext.ts`**: the fake counts `sources` and `gains` and records `startCalls` / `stopCalls`; music assertions assume one source and are rewritten (AC 9). A fake source must refuse a second `start` (it does) so the « same `when` » test is meaningful.
- **`src/client/audio/webAudio.ts`**, **`buses.ts`**: unchanged except AC 4's additions.
- **`src/client/boot.ts`**: `createAudioEngine` L300 (add `getMusicFeel`, `onMusicMoodChange`), `AppStateChanged` → loops L391-395, `onLevelFrame` L700-718 (`babbleWorld`, `isSilent`, `setMusicMuted`), `levelFeel()` L1048, the mirror key union L240-262 and its resets L378-384.
- **`src/content/schemas/feedback.ts`** L62-81 (`LoopSchema`, `LoopsSchema`), **`feel.ts`** L509-575 (`FxSchema` is the style model; `FeelSchema` L563), **`src/content/feedbackClips.ts`**, **`tools/content/contentChecks.ts`** L213-230 (`clipPaths`).
- **`tools/audio/makePlaceholderAudio.ts`**: `synthMusic` L256-282 (the calm stem: seeded RNG `SEED + 1`, triangle wave, 21 steps over 8 s, `PEAK_MUSIC`), `PLACEHOLDER_CLIPS` L722-745, `parseOnly` for `--only`.
- **`src/sim`** is read-only here: `world.threats[].state` (`ThreatState`: `idle|hidden|telegraph|windowOpen|resolved|gag`), `world.time.scale` / `baseScale` / `slowMos` (`slowMo.ts`: `min(baseScale, every slow-mo's factor)`, smoothstep return), `world.silence.startedAt`, `world.flow.state`.

### Must not change

- Sim behaviour, events, judgements, bots, `npm run sim` results; only goldens' hash lines move.
- The silence's contract (`setMusicMuted`, `data-pp-music` on/off, the bubble) and `feedback.spec.ts` / `silence.spec.ts`.
- The babble loop and its code path; the four buses and their gains; `suspend()` / `resume()` on pause and countdown; the unlock on the first gesture; `AUDIO_LOAD_TIMEOUT_MS` (the preload now loads one more clip).
- Every cue id and the 2.3 sound rules (`checkThreatSounds`, `checkTelegraphClips`); the CSP.

### Architecture compliance

- Layers: schemas in `src/content` (zod only); the mixer in `src/client/audio` (may import `@sim` types, `@content` types, `@shared`; **never `three`**; never imports `debug` or `bots`); the stem files and checks in `tools/` and `public/assets/audio/`. Aliases across layers only; relative imports inside `src/client/audio`.
- The sim never imports the music and never reads `feel.music`. No `window`/`performance`/`Date` in the mixer: time comes from the context (`currentTime`), and the engine already has no real-time dependency in these paths.
- No `console.*`: `log.warn('audio', …)`, once per failure. I/O returns `Result` (the clip loader already does).
- Naming: `create<Name>` in a file named after it (`createAdaptiveMusic` in `adaptiveMusic.ts`); units as suffixes (`fadeInMs`, `lowpassHz`, `playbackRatePct`, `calmGainPct`, `belowScale`, `startAtS`); constants `UPPER_SNAKE` in `shared/constants.ts`; no `enum`; clip names `music_<name>` in `lower_snake_case`; events/commands untouched.
- Zero allocation per frame: the two pure functions and the engine's edge compare allocate nothing; ramps allocate only on an edge.

### Library and framework notes

- No new dependency. Native Web Audio: `AudioBufferSourceNode.playbackRate` (an `AudioParam`, `k-rate`, also changes pitch), `BiquadFilterNode` (`type = 'lowpass'`, `frequency`, `Q` left at its default), `AudioParam.linearRampToValueAtTime`, `cancelScheduledValues`, `setValueAtTime`. Sources are one-shot: a restart builds new ones (as today).
- A frequency swept linearly is audible as uneven (the ear is logarithmic); linear ramps are what the fake and the existing code use, and the sweep is 150-500 ms. If Geo finds it clumsy, `exponentialRampToValueAtTime` is the one-line change (it needs a value > 0: the bounds already guarantee it).
- WebKit (Safari, iOS) decodes `.m4a` with an encoder delay: both stems carry the same padding because they have the same length and encoder, which is why AC 3 pins the sample count.

### File structure

New:
- `src/client/audio/adaptiveMusic.ts`, `adaptiveMusic.test.ts`
- `public/assets/audio/music_crawler_tense.m4a`
- `tests/e2e/adaptiveMusic.spec.ts`

Changed:
- `src/content/schemas/feedback.ts`, `src/content/schemas/feel.ts`, `src/content/feedbackClips.ts` (+ test), `content/feedback.json`, `content/feel.json`, `content/_schemas/feedback.schema.json` and `feel.schema.json` (generated), `tests/support/testFeel.json`, `tests/support/testContent.ts`, `tests/tools/vite/fixtures/feelSample.json`
- `src/shared/constants.ts`
- `src/client/audio/audioEngine.ts` (+ test), `src/client/audio/webAudio.ts`, `src/client/boot.ts`, `tests/support/fakeAudioContext.ts` (+ test)
- `tools/audio/makePlaceholderAudio.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`, `tools/content/contentChecks.ts`, `tests/content/checkContent.test.ts`, `tests/content/feedbackSchema.test.ts`, `tests/content/feelSchema.test.ts`, `src/client/feedback/feedbackDirector.test.ts`, `tests/e2e/support/game.ts`, `tests/architecture/fixtures/feedback/*.json` (if they carry `loops`)
- `tests/golden/journals/*` (hashes only, via `golden:update`)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Testing

- Vitest next to the code; `describe/it/expect` from `vitest`. Tests read `testFeel.json` and `createTestFeedback()` (`tests/support/testContent.ts`), never the live `feel.json` / `feedback.json`.
- The fake context is a recorder, not an audio clock: a ramp test asserts the `ramp` events (`value`, `timeS`) on the right params and the `startCalls` / `stopCalls`; it cannot say how the music sounds.
- e2e: mirrors and the frozen `advance` loop, never a fixed sleep; at speed 4 rely on the `*-count` mirrors for short states. `collectProblems(page)` must stay empty.
- Run `env | grep VITE_` before `dev` / `e2e` / `ci`; if `VITE_DEBUG_ALLOWED` is set, run them as `(unset VITE_DEBUG_ALLOWED; …)`.

### Previous story intelligence (1.9, 1.14, 1.21, 2.3, 2.4, 2.5)

- **1.9**: the engine never throws into its caller; every Web Audio call that can fail is caught and `warn`ed once on `audio`; a loop whose clip is not decoded is skipped once, not retried each frame (`skippedLoops`, cleared by a preload). The new music keeps all of it.
- **1.14 D10**: « camera and music under slow-mo: start on `ResponseResolved{perfect}`, end when `timeScale` returns to its base ». 2.5 derived the camera from the `perfect` slow-mo entry; this story derives the music from the effective `timeScale` (D3), which also covers `lastThreat`.
- **1.21**: `setMusicMuted` is fed by `world.silence.startedAt`, not by `SilenceStarted`; the deferred note says 2.6's stems « keep reading `world.silence.startedAt` and replace the loop ». `silence.spec.ts` L102-119, L210, L275 read `data-pp-music`.
- **2.3**: clip names are `<category>_<name>`; regenerate placeholders with `--only` and commit only what you meant to change (`afconvert` is not byte-reproducible); the agent cannot hear a sound, so the Completion Notes say what was verified (mirrors, fakes) and what only Geo can judge.
- **2.4**: short states are missed by polling at speed 4: add `*-count` mirrors; bound every new number in the schema; guard each sub-part so one throw does not hide the rest.
- **2.5**: a client-only `feel` section (`fx`) moves the golden hashes: regenerate **deliberately** and check the diff is hashes only; the feel panel needs no code; real-time vs sim-time was decided per effect (here: real, the audio clock); review findings to avoid repeating: weak tests that compare a thing to itself, an allocation hidden in a hot path, a missing reset between levels (here: `stopLevelLoops` resets the mood), live retuning ignored while a state is held (here: read `getMusicFeel` at each transition, and say that a held mood keeps its numbers until the next edge).

### Git intelligence

Recent commits on `main`: « Story 2.5 : merge de story/2-5-effets-de-feeling-a-l-ecran » (`81877ca`), its review fixes (`d0db8d9`), « Story 2.5 : effets de feeling à l'écran » (`9a48fd7`), « Story 3.3 : merge de story/3-3-journal-de-partie-exportable » (`485906a`). Commit style: French, « Story 2.6 : <titre> », then « Story 2.6 : corrections de la revue de code ». Work on `story/2-6-musique-adaptative-de-base` in `.claude/worktrees/2-6-musique-adaptative-de-base`; never commit on `main`. The main checkout currently has a merge in progress (`deferred-work.md` unmerged, story 3.4 staged): that is not this story's concern, and this worktree starts from the committed `main`.

### Project context rules (from `_bmad-output/project-context.md` and CLAUDE.md)

- Anything Geo might tweak is data: the fades, the low-pass, the rate and the ducking are `feel.music`; the stem names are `feedback.json`. Only the two physical limits (`MUSIC_START_LEAD_MS`, `MUSIC_FILTER_OPEN_HZ`) are constants.
- Everything stays playable without a human: the tense stem is a synthesized placeholder, the e2e reads mirrors, no step needs an ear.
- The sim never logs, never reads real time; `client` may import `@sim` types but not sim internals; no `console.*`.
- Audio: hand-rolled Web Audio, pre-decoded buffers, unlock on the first tap, the context suspended with every pause. Level payload ≤ 3 MB.
- `create<Name>` factories, files `camelCase.ts`, units as suffixes, no `enum`, `log` not `console`, `Result` for I/O.

### Open points for Geo (tune or decide after playing)

1. **Every starting value of `feel.music`** is a guess: `tense` 600 / 1500 ms, `slowMo` 900 Hz, 80 %, 150 / 500 ms. Tune them in the feel panel (folder `music`), then « Enregistrer ». Does 80 % read as « slow-mo » or just « out of tune »?
2. **Ducking the calm stem** (`calmGainPct` 60) or letting both play at full volume (100)?
3. **The instinct's ×0.8** will also low-pass the music at `belowScale` 1. Want it only for the perfect and the last-threat slow-mos (set `belowScale` to ~0.7 once story 2.9 exists)?
4. **The placeholder tense stem** is a buzzy synthesized loop that only proves the pipeline. Judge it, then record or order the real one (story 7.5 for the final set).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] (ACs), [#Story 7.5] (per-age stems in `content/music/`), [#Story 2.9] (instinct slow-mo), [#Story 2.10]; FR60 (L124)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L75, L189, L516, L544, L646, L784
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] L87, L182, L229, L483-491
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L410
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L158 (gapless `.m4a` loops), L246 (camera and music under slow-mo), L291 (`assets:audio` not reproducible), L391-392 (the music cut and the stems), L553
- [Source: _bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md] D10
- [Source: _bmad-output/implementation-artifacts/1-21-le-silence-suspect.md] (the music cut as state)
- [Source: _bmad-output/implementation-artifacts/2-5-effets-de-feeling-a-l-ecran.md] D1-D6, Review Findings (the `feel` section pattern, goldens, mirrors)
- [Source: _bmad-output/project-context.md] › Engine-Specific Rules (audio), › Performance Rules, › Feedback

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
