---
baseline_commit: fc3e43757d00311eec4d4bec521722dcd7a5837e
---

# Story 2.3: Cult sounds, the baby's laugh and distinct telegraphs

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR58 · **GDD:** Direction artistique et audio › Audio et musique (« un son culte par réponse : couinement de jouet, claquement de placard, et un éclat de rire du bébé sur réponse parfaite (façon Sekiro) », « un son distinct par télégraphe ») · **UX:** EXPERIENCE.md › Inspirations (Sekiro: perfect-response audio, the baby's laugh)

## Story

As a player,
I want a recognisable sound for each danger and each success,
so that I hear what is happening before I even see it.

## Acceptance Criteria

### What already works (keep it, prove it, do not rebuild it)

Stories 1.9 to 1.21 built the whole pipeline. Today each threat def names its four cues (`feedback.telegraph/success/perfect/gag`, story 1.11 D3), the phone names `ring`/`answer` (story 1.20 D10), `threatCueOf` / `disruptionCueOf` pick the cue, and `boot.ts › onSimEvent` plays it through `FeedbackDirector.playCue` in the same call that receives the event. Six distinct `tel_*` clips and five `gag_*` clips exist (synthesized placeholders, `npm run assets:audio`). This story gives the **responses** their cult sounds and the **perfect** its laugh, and proves the four epic ACs with tests.

### Telegraphs (epics AC 1)

1. **Each of the six telegraphs plays its own clip**, named in `feedback.json` and pointed at by its def: `tel_outlet`, `tel_stairs`, `tel_coffee_table` (the three threats), `tel_silence_found` (the suspicious silence: its telegraph is `ThreatTelegraphed` after `SilenceEnded{found}`; `SilenceStarted` stays a vibration with **no** sound, on purpose: the cut of the babble and the music *is* the silence's signal, story 1.21), `tel_papa_microsleep` (the muffled swell, GDD « son cotonneux ») and `tel_phone_ring` (the phone's `feedback.ring`). No two of them name the same clip, and the generator test « no two clips are alike » (`tests/tools/audio/makePlaceholderAudio.test.ts`) keeps covering every `tel_*` clip. A content check enforces it (AC 9).

### Responses: one cult sound per response type (epics AC 2)

2. **A cue can layer sounds.** `CueSchema` (`src/content/schemas/feedback.ts`) gains an optional `layers`: an array of 1 to 3 `AudioCueSchema` entries (`clip`, `bus`, `gainPct`), « extra sounds played at the same moment as `audio` ». A cue with `layers` must have an `audio` (refine, with a clear message). `feedbackClips()` includes every layer's clip (so it is preloaded, checked by `content:check`, and measured by `tests/architecture/audioAssets.test.ts`). `content/_schemas/feedback.schema.json` is regenerated with `npm run content:schemas`, never edited by hand. (D1)
3. **The director plays a cue's layers right after its `audio`, in the same call, in array order**, each through `audio.playOneShot(clip, bus, gainPct)`, each guarded by `attempt` (a layer that throws is a `warn` and the other parts still play). Nothing else changes in the play order (audio, layers, haptic, ring, camera, `onCue`). `onCue` still reports the cue id once.
4. **The parry's cult sound is a toy squeak** (`resp_parry.m4a`, GDD « couinement de jouet »). Both `resp_parry` (success) and `resp_parry_perfect` (perfect) cues play **the same clip `resp_parry`** on `sfx`: the type of response is what you hear, the perfect is told apart by the laugh (AC 5), its bigger ring and its heavy haptic, which stay as they are. The old `resp_parry_perfect.m4a` (sparkle chime) is no longer referenced: delete the file and its synth (D2).
5. **On a perfect, the baby laughs.** The `resp_parry_perfect` cue gets `layers: [{ "clip": "baby_laugh_perfect", "bus": "voice", "gainPct": 100 }]`. `baby_laugh_perfect.m4a` is a new clip (« éclat de rire », ~700–900 ms). It plays on every perfect of a parry def, the micro-sleep's and the silence's included.
6. **The Firmness has its own cult sound** (`resp_firm.m4a`, GDD « claquement de placard »: a dry wooden clack). New cues `resp_firm` (success: ring `threat` 0.8 m / 350 ms, haptic `medium`, like `resp_parry`) and `resp_firm_perfect` (perfect: ring 1.2 m / 450 ms, haptic `heavy`, `layers` with `baby_laugh_perfect`), both on `sfx`. No live def is `firm` (story 1.23 D5): the test def `tests/threats/fixtures/test_firm.json` switches its `success`/`perfect` to them, so the content check of AC 9 and the catalogue test cover them.
7. **The cult sounds respect the existing rules:** every new or changed clip is mono AAC `.m4a` written by `afconvert` (`M4A ` brand, more than 1 KiB), peaks at or below −6 dBFS (`PEAK_LOUD`), starts and ends at zero, and is generated deterministically by `tools/audio/makePlaceholderAudio.ts` (D3). Every cue with an `audio` keeps a `visual` and a `haptic` (`feedbackEquivalence.test.ts`, pillar 3).

### Gags (epics AC 3)

8. **Each gag plays its threat's `gag_*` cue, once**: `gag_outlet`, `gag_stairs`, `gag_coffee_table`, `gag_silence_mischief`, `gag_papa_asleep` (the micro-sleep's), from `GagTriggered`; a `ResponseResolved{fail}` plays nothing (story 1.11 D3: the gag sounds once). Unchanged behaviour, covered by AC 11's test.

### Content checks

9. **`npm run content:check` (`tools/content/contentChecks.ts › checkThreatReferences`) fails**, naming the file and the JSON path, when:
   - a threat's `feedback.success` or `feedback.perfect` cue has no `audio`, or its `audio.clip` is not `resp_<response>` (e.g. `resp_parry` for `response: "parry"`, `resp_firm` for `"firm"`): « one cult sound per response type » is a rule, not a habit (D4);
   - a threat's `feedback.telegraph` cue has no `audio`, or its clip is not a `tel_*` clip;
   - two threat defs (or a threat def and a disruption's `feedback.ring`) point at telegraph cues with the **same** clip;
   - a threat's `feedback.gag` cue has no `audio`, or its clip is not a `gag_*` clip.
   Each rule has a failing and a passing case in `tests/content/checkContent.test.ts`. The live content passes. The uniqueness rule is about the defs of one content tree (`content/`): the frozen test copies (`testOutlet`, `crying_outlet`, `test_firm`…) reuse `tel_outlet` on purpose and are never checked together with the live defs; if a test runs `checkContent` on a temp tree holding two of them, give one its own telegraph cue there rather than relaxing the rule. The test fixtures in `tests/support/*.threat.json`, `tests/threats/fixtures/*.json` and inline test defs stay valid (update them if a rule bites them, e.g. `test_firm.json`, AC 6).

### Latency: the sound fires at judgement (epics AC 4)

10. **The routing from a sim event to its cues moves out of `boot.ts`** into a pure, unit-testable `src/client/feedback/simEventFeedback.ts` (D5): `playSimEventFeedback(event, active, director)` does what `onSimEvent` does today (`director.handle(event.type, world)`, then the threat cue via `threatCueOf` + `playCue`, then the disruption cue via `disruptionCueOf` + `playCue`), with no behaviour change. `boot.ts` calls it at the same place.
11. **Unit tests** (`simEventFeedback.test.ts`, with the real `createFeedbackDirector`, the content's real `feedback.json`, a recording fake `audio` and fake `haptics`) prove:
    - a `ResponseResolved{success}` on a threat Papa is still gliding to (`world.papa.state === 'glide'`, `glide.threatId` = that threat) calls `audio.playOneShot('resp_parry', 'sfx', …)` **before `playSimEventFeedback` returns**, with no `PapaArrived` in between (the « same loop tick » of the epic AC: judgement at the press, pose at arrival, architecture P3);
    - a `ResponseResolved{perfect}` plays `resp_parry` then `baby_laugh_perfect` (`voice`), in that order, in that same call, and one `heavy` haptic;
    - a `ResponseResolved{fail}` plays nothing; its `GagTriggered` plays the def's `gag_*` once;
    - each of the five live threat defs' `ThreatTelegraphed` plays its own `tel_*` clip, and the phone's `PhoneRingStarted` plays `tel_phone_ring`;
    - a firm def (`test_firm.json`) plays `resp_firm` on success, and `resp_firm` + `baby_laugh_perfect` on perfect.
12. **Director tests** (`feedbackDirector.test.ts`): layers play after `audio` and before the haptic, in order; a throwing layer is one `warn` and the next layer, the haptic and the ring still play; `onCue` once per cue. **Schema tests** (`tests/content/feedbackSchema.test.ts`): `layers` accepted with 1–3 entries; refused when empty, with 4, with a bad clip name, or without `audio`. **`feedbackClips.test.ts`**: layer clips are listed, once, sorted.
13. **e2e stays green unchanged**: `tests/e2e/threat.spec.ts` already checks that the parry plays `def.feedback.success`/`perfect` and never the gag; `feedback.spec.ts` checks the audio lifecycle. The harness fails a session on any `warn` of the audio engine or the director: the new clips must decode in Chromium and WebKit (the e2e preload loads every clip of the table).

### Listening (golden rule: Geo judges the sound)

14. **Sound board in the debug overlay** (`src/debug/`, dev and `?debug=1` playtest only): a « Sons » folder lists every cue of `feedback.json` that has an `audio`, with a button that plays the cue's `audio` and its `layers` once (and nothing else: no ring, no haptic, no `onCue`, so no warning outside a level). It goes through a new `TestHost` method (e.g. `auditionCue(cueId): void`) implemented in `boot.ts` on top of `audio.playOneShot`; the debug module never imports the audio engine. If the audio context is not running (no gesture yet), the button does nothing and the folder says so in English (the debug overlay's labels are English literals: `'Debug'`, `'Set fatigue'`; it is not player UI, so no `strings.fr.json` key). Unit-tested with the existing fakes (`fakePane.ts`).

### Hygiene

15. **The generator regenerates only what you ask.** `npm run assets:audio -- --only resp_parry,resp_firm,baby_laugh_perfect` writes only those clips (an unknown name is an error listing the known ones; no `--only` keeps today's « all or none » behaviour). `afconvert` output is not byte-reproducible (`deferred-work.md` L291): commit only the clips this story meant to change (`resp_parry`, `resp_firm`, `baby_laugh_perfect`, and the deletion of `resp_parry_perfect.m4a`). Tested in `tests/tools/audio/makePlaceholderAudio.test.ts` with the injected `ConvertWav` fake.
16. **`deferred-work.md` is updated**: « Real sounds » (L150, L188), « silence's sounds » (L391), « per-level audio manifest » (L149) and « `PropImpact`/`PropBroken` have no sound » (L261) each get a dated line saying what 2.3 did or where it moves (D6). New open points from this story go at the end.
17. **No sim change.** The sim, the goldens and `npm run sim` results do not move. If a golden hash moves, stop and find out why: never run `golden:update` to make it pass.
18. **`(unset VITE_DEBUG_ALLOWED; npm run ci)` is green**, `dist:check` passes for both flavours (the payload of `salon_crawler`, `.glb` + clips, stays ≤ 3 MiB: today ≈ 0.24 MiB), `perf.spec.ts` within budget.

## Tasks / Subtasks

- [x] **T1. Schema and clips list** (AC 2, 12)
  - [x] `src/content/schemas/feedback.ts`: `layers` on `CueSchema` (`z.array(AudioCueSchema).min(1).max(3).optional()`, `.describe(...)`), and a second `.refine` (or extend the existing one into a `superRefine`) « a cue with `layers` needs an `audio` ». Keep `.strictObject`, no `.default()`/`.transform()` (the file's header rule).
  - [x] `src/content/feedbackClips.ts`: add the layer clips; update its doc comment.
  - [x] `npm run content:schemas`; schema tests; `feedbackClips.test.ts`.
- [x] **T2. Director** (AC 3, 12): in `feedbackDirector.ts › play`, after the `audio` block: `for (const layer of cue.layers ?? [])` → `attempt(name, 'sound layer', …, () => audio.playOneShot(layer.clip, layer.bus, layer.gainPct))`. Update the `handle` doc comment (« the sound, its layers, the vibration… »). Tests.
- [x] **T3. Sounds** (AC 4-7, 15) in `tools/audio/makePlaceholderAudio.ts` (or a new sibling `tools/audio/cultSounds.ts` exporting the three synths, imported by it: the file is 856 lines, a split is welcome):
  - [x] `synthParry` rewritten as a toy squeak (recipe in Dev Notes › Sound recipes); `synthFirm` (cupboard clack); `synthBabyLaugh`.
  - [x] `PLACEHOLDER_CLIPS`: drop `resp_parry_perfect`, add `resp_firm`, `baby_laugh_perfect`. Delete `synthParryPerfect` and its constants, and `public/assets/audio/resp_parry_perfect.m4a` (`git rm`).
  - [x] `--only <a,b,…>` in `main()` (`process.argv`, through a small exported `parseOnly(argv, known)` returning a `Result`), and `generatePlaceholderClips(outDir, convert, only?)`.
  - [x] Tests: lengths of the three clips (squeak 200–260 ms, clack 100–160 ms, laugh 700–900 ms), peak ≤ −6 dBFS, zero ends, no NaN, determinism; extend « no two clips are alike » to `/^(tel|gag|resp|baby)_/` (the squeak and the clack must not correlate); the laugh has 4 to 6 syllables (count energy bursts over a 10 ms RMS envelope); `--only` writes only the named clips and refuses an unknown one.
  - [ ] *(open on purpose, Geo's call after the merge, through the « Sons » board)* Run `npm run assets:audio -- --only resp_parry,resp_firm,baby_laugh_perfect` (macOS, `afconvert`), **listen to the three clips** (`afplay public/assets/audio/<clip>.m4a`) and describe what you heard in the Completion Notes; adjust the recipe until the squeak reads as a dog toy and the laugh as a baby, not as a beep.
- [x] **T4. Content** (AC 4-6): `feedback.json`: `resp_parry_perfect.audio.clip` → `resp_parry`, plus its `layers`; new cues `resp_firm`, `resp_firm_perfect`. `tests/threats/fixtures/test_firm.json` → `resp_firm` / `resp_firm_perfect`. Check `tests/support/testFeel.json`-style frozen copies of `feedback.json` if any test loads one (`grep -rn resp_parry_perfect tests src`), and update them.
- [x] **T5. Content checks** (AC 9): the four rules in `checkThreatReferences` (and the ring-vs-telegraph clip clash with `checkDisruptionReferences`' data: compute the set of telegraph clips across threats and disruptions once in `checkContent`), with tests in `tests/content/checkContent.test.ts`.
- [x] **T6. Event routing** (AC 10, 11): `src/client/feedback/simEventFeedback.ts` + test; `boot.ts › onSimEvent` calls it. The `choreography`, gag fx, noise alert and mirrors stay in `boot.ts`.
- [x] **T7. Sound board** (AC 14): `TestHost.auditionCue`, a « Sons » folder in the debug overlay's Tweakpane (see how `feelPanel.ts` builds folders), test with `fakePane.ts`.
- [x] **T8. Docs** (AC 16): `deferred-work.md`; the header comment of `makePlaceholderAudio.ts` (« story 2.3 replaced the parry, added the firm clack and the laugh »); `project-context.md` › Feedback gains one line: « a cue may `layers` extra sounds (the baby's laugh on a perfect); a threat's success/perfect clip is `resp_<response>` (content:check) ».
- [x] **T9. CI** (AC 17, 18): `env | grep VITE_` first, then `(unset VITE_DEBUG_ALLOWED; npm run ci)`. On a loaded machine rerun with `--maxWorkers=5` / `--workers=4` and say so.

## Dev Notes

### Decisions (D1-D6)

- **D1. `layers` on the cue, not a second cue nor a client event.** The laugh must play in the same call as the response sound, for every perfect, and its timing is the response's. Three options were weighed: (a) a client event `…Perfected` in `FEEDBACK_CLIENT_EVENTS` → refused by design, since a client event's cue cannot have a world visual (`contentChecks.ts` L157-172) and the laugh's twin would be a ring; (b) a second cue id on the threat def (`feedback.perfectLaugh`) → every def repeats it and a def can forget it; (c) `layers` on the cue → one cue = one moment, one visual twin, one haptic, and Geo tunes the laugh's gain in `feedback.json`. (c) keeps the triple-equivalence test meaningful (the cue has an `audio`, so it owes its twins) and touches the director in one loop. A `layers` entry is never a cue of its own: no ring, no haptic, no `onCue`.
- **D2. The perfect plays the same squeak as the success.** The epic AC is « le son culte du **type de réponse** » + « sur `perfect`, un éclat de rire s'y ajoute ». The current `resp_parry_perfect.m4a` (a squeak plus a chime) is a third sound per response, which blurs the « one cult sound per response » rule (GDD). The perfect still feels bigger: laugh, 1.2 m ring, heavy haptic, slow-mo (story 1.14), and later the flash and stamp (2.4, 2.5). The cue id `resp_parry_perfect` stays (defs, e2e and mirrors use it).
- **D3. The sounds are synthesized by the agent, provisional until E7.** The golden rule: everything runs end to end with no human, and CI never needs `afconvert` (the clips are committed). No asset library is added, nothing is downloaded (no licence to track, CSP untouched: clips are same-origin). Story 7.5 (« bibliothèque sonore ») or Geo's own recordings replace any clip **under the same name**, with no code change; `--only` (AC 15) lets a regeneration leave a recorded file alone. The squeak and the clack synthesize well; a synthesized laugh will sound like a toy, which fits the cartoon tone but is the weakest of the three: flag it for Geo (Open points).
- **D4. « One cult sound per response type » is a content check.** A new threat that copies another def and forgets to change its cues is the likely error; the clip-name rule (the clip is exactly `resp_<response>`) catches the opposite one, a parry def that plays the firm clack. The check reads the cue's `audio.clip`, not the cue id, because two cues (success, perfect) share one clip by D2. Same idea for `tel_*` and `gag_*`, plus uniqueness of telegraph clips (epics AC 1, « distinct »).
- **D5. Extract the routing to test the latency AC.** `boot.ts` (≈1250 lines) has no unit test; the « same loop tick » claim is today only true by reading the code. A pure function taking `(event, active, director)` is testable with the real director and a recording audio fake: the assertion « `playOneShot` was called before the function returned, while Papa is still gliding » is the AC. The e2e already proves the cue arrives in a real browser (`threat.spec.ts` L84-87). Do not add a frame-timing e2e: the 2.7 calibration and the 8.2 device pass own real latency.
- **D6. What 2.3 does not do** (record each in `deferred-work.md`):
  - *Per-level audio manifest* (moved here from 1.18): one level, ~20 clips, ≈ 220 KB; preloading every clip of the table is the same as a per-level list today. Move it to story 7.5 (several ages, several libraries), where it starts to matter.
  - *`PropImpact` / `PropBroken` sounds*: they need a world visual anchored on a prop, an anchor kind the schema lacks (`papa | baby | threat | object`). Move to story 2.5 (« effets de feeling », particles at the point of impact), with the « ring anchored on props » item.
  - *Telegraph and gag clips*: unchanged in this story (they are already distinct and characterful enough to be told apart, and the test proves it); Geo listens through the sound board and asks for changes clip by clip.
  - *The catastrophe gauge's alert sound and the chrono-ring's last-arc vibration* (GDD v2.2, not yet in `epics.md`): out of scope, they arrive through `gds-correct-course`.

### Current state of the files this story changes (read before editing)

- **`content/feedback.json`**: buses (`sfx` 90, `voice` 80), haptics, loops (`babble`, `music`), `resultScreen`, 21 cues, `events` (7 generic events). Threat/disruption cues are in `cues` but never in `events`. `resp_parry` (clip `resp_parry`, ring 0.8 m/350 ms, `medium`), `resp_parry_perfect` (clip `resp_parry_perfect`, ring 1.2 m/450 ms, `heavy`). Preserve every other cue.
- **`src/content/schemas/feedback.ts`**: `CLIP_PATTERN` (`tel|resp|gag|baby|papa|env|ui|music`), `AudioCueSchema`, `CueSchema` (audio?, visual?, haptic?, camera?, one refine « at least one »). Strict objects, no defaults.
- **`src/content/feedbackClips.ts`**: loops + each cue's `audio.clip`, deduplicated, sorted. Used by the client preload (`boot.ts › loadAudio`), `content:check` (file exists) and `tests/architecture/audioAssets.test.ts` (brand, size, payload).
- **`src/client/feedback/feedbackDirector.ts`**: `play(name, id, cue, world, threatId, objectId)`: audio → haptic → ring (world + scene) → camera (not under reduced motion) → `onCue`. Each part in `attempt` (frame loop is fail-stop). `handle` (events table) and `playCue` (by id). Preserve the order, the guards, `hasOwn` lookups.
- **`src/client/feedback/threatFeedback.ts`** (`threatCueOf`) and **`disruptionFeedback.ts`** (`disruptionCueOf`): pure, allocation-free. No change expected.
- **`src/client/boot.ts`** L754-770 (`onSimEvent`): `logSimEvent`, `director.handle`, then the threat cue, then the disruption cue, then choreography, gag fx, noise alert, mirrors, `resumeHeld`. Only the three cue lines move into `playSimEventFeedback`. `loadAudio` (L741-753) preloads `feedbackClips(feedbackTable)`: layer clips come for free.
- **`src/client/audio/audioEngine.ts`**: `playOneShot(clip, bus, gainPct)` starts a decoded buffer now (`source.start()`), skips silently (debug log) a clip not decoded and anything while the context is not `running`. No change.
- **`tools/audio/makePlaceholderAudio.ts`** (856 lines): constants per clip, one `synth*` per clip (deterministic: `createRng(SEED + n)` for noise), `normalize(out, PEAK_LOUD)`, `encodeWav`, `PLACEHOLDER_CLIPS`, `generatePlaceholderClips(outDir, convert)` (all-or-none through a temp dir), `main()`. Pure helpers to reuse: `samplesOf`, `normalize`, `strike`. Keep the « all or none » guarantee for the clips selected by `--only`.
- **`tests/tools/audio/makePlaceholderAudio.test.ts`**: determinism, −6 dBFS peak, zero ends, lengths per clip group, names match the table, « no two clips are alike » (normalised cross-correlation over ±`LAG_MAX_MS`, `CORRELATION_MAX`), no NaN, WAV header, `generatePlaceholderClips` with a fake converter. Remove the `resp_parry_perfect` length line (« 300, 150, 350 and 500 ms » → the outlet group loses the 350).
- **`tools/content/contentChecks.ts`**: `checkThreatReferences` (cue exists, not `object`-anchored, not `uiElement`), `checkDisruptionReferences` (cue exists, not `threat`-anchored, not `uiElement`), the events-table rules (L137-200). Add AC 9's rules next to the existing threat cue loop (L295-316).
- **`src/client/app/testHost.ts`** (`TestHost`) and **`src/debug/debugOverlay.ts`** / **`feelPanel.ts`**: the overlay is installed with `installDebugOverlay(testHost)` (`boot.ts` L1237); Tweakpane folders are built in `feelPanel.ts`. The debug layer may import anything, but no client module imports debug statically.

### Must not change

- The sim, its events, goldens and bots (AC 17). No new `SimEvent`.
- `threatCueOf`'s rule « a fail plays nothing, its gag plays once » (1.11 D3); `ResponseResolved` and `GagTriggered` order.
- The cue ids used by defs, e2e and mirrors (`resp_parry`, `resp_parry_perfect`, `tel_*`, `gag_*`, `tel_phone_ring`, `papa_phone_answer`, `silence_started`).
- `silence_started` stays haptic-only (the silence is heard by its absence).
- The feedback-equivalence test, its fixtures, the layer and purity guardrails. Never weaken them.
- The phone ring clip stays under 1000 ms (`PHONE_RINGING_EVERY_MS`; the test exists).

### Sound recipes (starting points; tune by ear, numbers as named constants)

All mono, 44.1 kHz, `normalize(out, PEAK_LOUD)`, first and last sample 0, attack/release ramps so nothing clicks. Noise from `createRng(SEED + n)` with a new `n` per clip (never `Math.random`: determinism is tested).

- **`resp_parry`, toy squeak (~220 ms).** A rubber squeaker is a reed whistle pushed by a squeeze: a bright tone with a fast pitch bend in two parts, a « squee » that rises then an « eek » that falls, a rough buzz and some air. Pitch 1700 → 2500 Hz over the first ~80 ms, then 2500 → 1500 Hz to the end (integrate the phase, as `synthTelegraphSilence` does). Tone = sine + 0.35 × 2nd harmonic + 0.15 × 3rd. Roughness: amplitude modulation at ~45 Hz, depth ~0.3. Air: high-passed noise (one-pole difference) at ~0.12 of the tone, mostly in the attack. Envelope: 4 ms attack, a dip at the turn (~70 % at 80 ms: the squeeze reverses), 30 ms release.
- **`resp_firm`, cupboard clack (~130 ms).** A dry wooden knock: a noise burst of ~5 ms through a two-pole resonator around 750 Hz (Q ≈ 6, decay ~25 ms) + a low body thump (sine 110 → 80 Hz, decay ~40 ms, gain 0.6) + a tiny second rebound click at ~45 ms (gain 0.35). No pitch rise: the clack is « firm », the squeak is « playful ».
- **`baby_laugh_perfect`, burst of laughter (~800 ms).** 5 « ha » syllables, accelerating then trailing: durations ~[110, 95, 90, 90, 140] ms, gaps ~[60, 50, 50, 70] ms. Each syllable: a glottal source (sum of harmonics 1..12 of f0 with 1/n gains, or a band-limited sawtooth) at f0 ≈ 480 Hz falling ~15 % across the laugh and rising-falling ~8 % inside each syllable, with jitter ±2 % per syllable from the rng; an « h » onset of aspiration noise (~25 ms); the sum through three parallel band-pass resonators for a child's /a/: F1 ≈ 1050 Hz, F2 ≈ 1850 Hz, F3 ≈ 3500 Hz (gains 1, 0.6, 0.25). A short breathy inhale at the end (~80 ms filtered noise, gain 0.2) sells it. If it sounds robotic, more jitter and a slight vibrato (~7 Hz, 3 %) help more than more harmonics.

Resonator: `y[n] = b0·x[n] − a1·y[n−1] − a2·y[n−2]` with `r = exp(−π·BW/fs)`, `a1 = −2r·cos(2π·f/fs)`, `a2 = r²`, `b0 = 1 − r` (BW = f/Q). Pure arithmetic, no library.

### Architecture compliance

- Layers: schema in `src/content` (zod, `@shared` only); director and routing in `src/client/feedback`; sound board in `src/debug` through `TestHost`; generator in `tools/` (Node only, never imported by `src/`). Cross-layer imports through `@content`, `@sim`, `@shared`, `@platform`.
- ADR-006: `feedback.json` is the only place where an event meets its sounds. No clip name in TS outside `tools/` and tests.
- No `console.*`: `log.warn('feedback' | 'audio' | 'assets', …)`. No silent `catch`: the director's `attempt` logs.
- I/O in the tool returns `Result` (`parseOnly`, `generatePlaceholderClips`).
- Performance: a layer is one more `createBufferSource` per perfect, an event not a frame (the director's comment already says events are not a hot path). `playSimEventFeedback` must not allocate beyond what `onSimEvent` does today.
- Naming: clips `<category>_<name>` (`baby_laugh_perfect` is the architecture's own example, `game-architecture.md` L646); units as suffixes in every new constant (`…Ms`, `…Hz`, `…Pct`).

### Library and framework notes

- No new dependency. Web Audio as used by `audioEngine.ts` (`AudioBufferSourceNode`, `GainNode`, `latencyHint: 'interactive'`); no time-stretching: the laugh plays at normal speed during the perfect slow-mo (the music's slow-mo effect is story 2.6).
- `afconvert` (macOS) is the encoder: `-f m4af -d aac -b 64000`. AAC adds encoder delay/padding at both ends (≈ 2112 samples at start): irrelevant for one-shots, which is all this story adds.
- Zod 4: `z.array(...).min(1).max(3).optional()`; the JSON Schema is emitted by `npm run content:schemas` (`tools/content/emitSchemas.ts`).
- Tweakpane is already a debug dependency (story 2.1): reuse its button blade, as the cheats do.
- Web research was not needed: nothing here depends on a recent API change (Web Audio and `afconvert` are stable; no version moves).

### File structure

New:
- `src/client/feedback/simEventFeedback.ts`, `simEventFeedback.test.ts`
- `public/assets/audio/resp_firm.m4a`, `public/assets/audio/baby_laugh_perfect.m4a`
- optionally `tools/audio/cultSounds.ts` (the three synths)
- a sound-board module in `src/debug/` (e.g. `soundBoard.ts` + test), or a folder inside an existing panel if that reads better

Changed:
- `src/content/schemas/feedback.ts`, `src/content/feedbackClips.ts` (+ test), `content/_schemas/feedback.schema.json` (generated)
- `content/feedback.json`, `tests/threats/fixtures/test_firm.json`
- `src/client/feedback/feedbackDirector.ts` (+ test), `src/client/boot.ts`, `src/client/app/testHost.ts`
- `tools/audio/makePlaceholderAudio.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`
- `tools/content/contentChecks.ts`, `tests/content/checkContent.test.ts`, `tests/content/feedbackSchema.test.ts`
- `public/assets/audio/resp_parry.m4a` (regenerated)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`

Deleted: `public/assets/audio/resp_parry_perfect.m4a`.

### Testing

- Vitest next to the code; content and tool tests under `tests/content`, `tests/tools`. Import `describe/it/expect` from `vitest`.
- Fakes: `tests/support/fakeAudioContext.ts` (audio engine), a hand-rolled recording `{ playOneShot }` for the director (see `feedbackDirector.test.ts`), `fakePane.ts` for Tweakpane, `tests/support/testContent.ts` / `simSupport.ts` to build a world with a gliding Papa (or a hand-made `World` slice: `threatCueOf` only reads `world.threats[].id/defId`; the director reads `papa`, `baby`, `threats`, `time.sim`).
- Run the generator test alone after editing synths: it is heavy (the correlation test has a 30 s timeout; `deferred-work.md` L330 notes local load failures, use `--maxWorkers=5` if needed).
- e2e: none new (D5). Run the full suite through `npm run ci`; the harness fails on audio/director warnings, which proves the new clips decode in both browsers.
- Screenshots are not affected (nothing visual changes outside the debug overlay).

### Previous story intelligence (1.9, 1.11, 1.20, 1.21, 1.23, 2.2)

- **1.9**: the audio engine never throws into the frame loop; every Web Audio call is caught and logged `warn`. The e2e harness turns any such `warn` into a failure: a clip that does not decode in WebKit shows up there first. A level started without a gesture is silent by design (`loadAudio` skips the preload): sound-board and unit tests must not rely on a running context.
- **1.11 D3**: threat cues come from the def; a fail plays nothing, its `GagTriggered` plays the gag once. The perfect/success choice is `threatCueOf`'s. Four tiny clips were added and the three existing ones restored from git to avoid binary churn: same discipline here (AC 15).
- **1.20 D10**: disruptions name their cues like threats; the ring clip must stay under 1000 ms.
- **1.21**: the silence's telegraph is the cut (babble + music), `silence_started` is haptic-only, `tel_silence_found` is the found « ah-ha ».
- **1.23 D5**: no live Firmness threat; `test_firm.json` is the frozen def that exercises it; adding a live one would move bot scores and `levelHash`. Do not add one.
- **2.2**: every rule the schema cannot see goes into `contentChecks.ts` with a failing and a passing test; frozen test copies of defs must be updated with the live ones; the review asked for the AC-by-AC Completion Notes with what was really verified (and what could not be).

### Git intelligence

Recent commits: `Story 2.2 : …` (verb labels, threat schema keys, `contentChecks` rules, e2e on `threats.spec.ts`), `Maintenance : suppression des références de capture Linux` (screenshots are darwin-only now, skipped on Linux CI). Commit style: French, « Story 2.3 : <titre> », then « Story 2.3 : corrections de la revue de code ». Work on `story/2-3-sons-cultes-rire-du-bebe-et-telegraphes-distincts` in its worktree; never commit on `main`.

### Project context rules (from `_bmad-output/project-context.md` and CLAUDE.md)

- Every `audio` feedback has a `visual` and a `haptic` (pillar 3, test-enforced); a `layers` entry is part of its cue's audio and is covered by the cue's twins.
- Response sound + haptic fire at judgement; the final pose plays at Papa's arrival.
- Audio is hand-rolled Web Audio, four buses, pre-decoded buffers, unlock on the first gesture; the whole level's audio is preloaded behind the loading screen, nothing loads during play; level payload ≤ 3 MB.
- Clips: `public/assets/audio/<category>_<name>.m4a`.
- Anything Geo might tweak is data: gains and layers live in `feedback.json`; synthesis constants live in the tool (sound design, not game feel).
- Units as suffixes, `create<Name>` factories, files `camelCase.ts`, no `enum`, `Result` for I/O, `log` not `console`.
- Check `env | grep VITE_` before `ci`/`e2e`/`dev`; the shell exports `VITE_DEBUG_ALLOWED=false`: run `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Open points for Geo (tune or decide after playing)

1. **Where the real sounds come from.** This story ships agent-synthesized clips (D3). Options for later: Geo records them (a real baby's laugh would be the strongest cult sound), a CC0 library (licence noted in `public/assets/audio/CREDITS`), or story 7.5. Same file names, no code change.
2. **The laugh**: on every perfect, or rarer (e.g. not twice in 5 s) to keep it special? Today: every perfect. A cooldown would be a `feel.json` value and a client rule; not done here.
3. Gains: `resp_parry` 100 on `sfx` (90), the laugh 100 on `voice` (80). Tune in `feedback.json` after listening on a phone speaker.
4. Telegraph and gag clips are unchanged placeholders: say which ones to redo after a session with the sound board.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3] (ACs), [#Story 2.4] (triple equivalence, next), [#Story 2.6] (music), [#Story 7.5] (sound library)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Audio et musique] (L436-446: cult sounds, laugh, distinct telegraphs), [#Pilier 3] (L76), [#Fatigue] (L171: « son cotonneux »)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L253 (FeedbackDirector), L306 (ADR-006), L516/L554 (audio folders), L646 (clip naming, `baby_laugh_perfect` example), L952 (E2 › sons cultes)
- [Source: _bmad-output/project-context.md] L69-75 (Feedback, audio), L113 (clip names), L158 (twins)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L149, L150, L188, L261, L291, L330, L387, L391
- [Source: _bmad-output/implementation-artifacts/1-11-parer-la-prise-electrique-au-tap.md] D3, Feedback routing; [1-23-fermete-optionnelle.md] D5; [2-2-verbe-affiche-et-icones-couleur-forme.md] (format, checks)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L295 (muted state), L464 (Sekiro reference)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Implementation Plan

Followed T1 → T9 in order. Tests first for T1-T5; T6 extracted the routing first and tested it after (so that test was green on its first run, not red). `layers` is a plain optional array on the cue (D1); the director plays it in `play` right after `audio`, each part under `attempt`. The three synths live in `tools/audio/cultSounds.ts`, the shared helpers (rate, seed, peak, `normalize`, the resonator) in `tools/audio/synthKit.ts`. The pane factory of the feel panel moved to `src/debug/paneFactory.ts` so the sound board reuses the CSP-safe Tweakpane creation.

### Debug Log References

- First CI run stopped at `lint`: one string quote in `checkContent.test.ts` (`biome check --write .` fixed it). Second run: `EXIT=0`.
- « no two clips are alike » failed once with the new clack (0.78 correlation with `tel_stairs`: both are a low knock). Fixed by moving the clack's body thump up and making it quieter (see Completion Notes).
- Two existing `checkContent` tests reacted to the new uniqueness rule (a copy of `outlet` in a temp tree; a cue anchored on the wrong kind reported twice). The first got `giveOwnTelegraph` (the story's instruction); the second is handled in the check itself (a wrongly anchored cue is not counted as a second telegraph), so that test is unchanged.

### Completion Notes List

- **AC 1, 8 (telegraphs, gags): verified.** `simEventFeedback.test.ts` plays each live threat's `ThreatTelegraphed` through the real director and the real `feedback.json`: one `tel_*` clip each, all different; the phone's `PhoneRingStarted` plays `tel_phone_ring`; a fail plays nothing and its `GagTriggered` plays the `gag_*` once. `content:check` enforces uniqueness (AC 9).
- **AC 2, 3, 12 (layers): verified.** `layers` (1-3 `AudioCueSchema`, needs an `audio`) in the schema, `feedbackClips` lists them, JSON Schema regenerated. Director tests: order audio → layers → haptic → ring → `onCue`; a throwing layer is one `sound layer` warn and the rest still plays.
- **AC 4-6 (content): verified.** `resp_parry_perfect` plays `resp_parry` + `baby_laugh_perfect` (voice); new `resp_firm` / `resp_firm_perfect`; `test_firm.json` points at them. `resp_parry_perfect.m4a` deleted.
- **AC 7, 15 (sounds, generator): verified by tests, NOT by ear.** Lengths (squeak 230 ms, clack 130 ms, laugh about 860 ms), peak ≤ -6 dBFS, zero ends, no NaN, determinism, no two clips alike; a pitch meter shows the squeak rising then falling; an RMS envelope counts 5 laugh syllables (4-6 accepted). `--only` and `parseOnly` tested, and run for real: only `resp_parry`, `resp_firm` and `baby_laugh_perfect` changed on disk. **I cannot hear audio, so the subtask « listen to the three clips and describe what you heard » is left unchecked on purpose.** Whether the squeak reads as a dog toy, the clack as a cupboard and the laugh as a baby is Geo's call (the laugh is the weakest, as D3 warned). The tuning knobs are the named constants at the top of `tools/audio/cultSounds.ts`; rerun with `npm run assets:audio -- --only resp_parry,resp_firm,baby_laugh_perfect`.
- **Departure from the recipe:** the clack's body thump is 160 → 120 Hz, decay 20 ms, gain 0.35 (recipe: 110 → 80 Hz, 40 ms, 0.6) because the recipe version correlated 0.78 with the stairs' knock and failed the « no two clips alike » test. Wood resonator Q is 12.
- **AC 9 (content checks): verified.** `checkThreatSounds` (success/perfect clip is exactly `resp_<response>`, telegraph `tel_*`, gag `gag_*`, each with an audio) and `checkTelegraphClips` (threats then disruptions, each by id; reports the later def and names the first). Failing and passing cases in `tests/content/checkContent.test.ts`; the live content passes. Copies of live defs in temp trees now get their own telegraph (`giveOwnTelegraph`).
- **AC 10, 11 (latency): verified at unit level.** `playSimEventFeedback` extracted from `boot.ts` with no behaviour change; the tests assert `playOneShot('resp_parry', 'sfx', …)` was called before it returned, with Papa still in `glide` and no `PapaArrived`. Real-device latency stays with 2.7 / 8.2 (D5).
- **AC 14 (sound board): verified with fakes, not seen in a browser.** « Sons » section in the debug overlay, one button per cue with a sound (`id +N` when it has N layers), through `TestHost.auditionCue(cueId): boolean` (returns `false` when the audio context is not running, and the status line says so in English). The story suggested `void`; a boolean was needed so the debug module can tell the user without importing the engine. Built once, on the first opening.
- **AC 13, 17, 18: verified by CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` exit 0: 4164 unit tests in 230 files, `src/sim` coverage above thresholds, 372 e2e (chromium + webkit, the new clips decode in both with no audio/director warning), `dist:check` playtest and prod, `e2e:dist` including `perf.spec.ts` (p95 16.7 ms, 34 draw calls max, 890 triangles max). Level payload 241 KiB (≤ 3 MiB). No golden, snapshot or sim file changed; `golden:update` was never run. The CI ran on one machine without load problems, no reduced workers.
- **AC 16 (docs): done.** `deferred-work.md` has a dated 2.3 line on the four items (manifest and props moved to 7.5 and 2.5) and new open points at the end; `project-context.md` › Feedback gained one line.
- **Heads-up for the merge:** this branch was cut before `main` received story 3.2 (`ba93bfe`), which touched `content/feedback.json` and `src/client/boot.ts` too. The review/merge step may need a merge of `main` into the branch first.

### File List

New:
- `src/client/feedback/simEventFeedback.ts`, `src/client/feedback/simEventFeedback.test.ts`
- `src/debug/soundBoard.ts`, `src/debug/soundBoard.test.ts`, `src/debug/paneFactory.ts`
- `tools/audio/cultSounds.ts`, `tools/audio/synthKit.ts`
- `public/assets/audio/resp_firm.m4a`, `public/assets/audio/baby_laugh_perfect.m4a`

Modified:
- `src/content/schemas/feedback.ts`, `src/content/feedbackClips.ts`, `src/content/feedbackClips.test.ts`, `content/_schemas/feedback.schema.json`
- `content/feedback.json`, `tests/threats/fixtures/test_firm.json`
- `src/client/feedback/feedbackDirector.ts`, `src/client/feedback/feedbackDirector.test.ts`, `src/client/boot.ts`, `src/client/app/testHost.ts`
- `src/debug/debugOverlay.ts`, `src/debug/feelPanel.ts`, `tests/support/fakeTestHost.ts`
- `tools/audio/makePlaceholderAudio.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`
- `tools/content/contentChecks.ts`, `tests/content/checkContent.test.ts`, `tests/content/feedbackSchema.test.ts`
- `public/assets/audio/resp_parry.m4a` (regenerated)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/project-context.md`

Deleted:
- `public/assets/audio/resp_parry_perfect.m4a`

### Change Log

- 2026-10-29: Story 2.3 implemented: cue `layers`, the toy squeak, the cupboard clack and the baby's laugh, content checks for one cult sound per response and distinct telegraphs, the extracted sim-event routing with its latency tests, the debug « Sons » board, `--only` for the audio generator.

### Review Findings

Code review of 2026-10-29 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 `decision_needed`, 6 `patch`, 4 `defer`, 14 dismissed as noise.

- [x] [Review][Decision] (resolved: option 1, applied) Nothing checks that a perfect keeps its laugh — `checkThreatSounds` only compares `audio.clip` to `resp_<response>` for both `success` and `perfect`. A `resp_parry_perfect` cue with no `layers` (or a success cue that wrongly carries the laugh) passes `content:check`, and the perfect then sounds like the success, which is what D2 says must not happen. The test « accepts a perfect cue that shares the success clip » locks the clip equality only. Options: (a) require a `layers` entry on every threat `perfect` cue and none on `success`; (b) require only a layer on `perfect`; (c) leave as is, since open point 2 (a laugh cooldown) may change the rule. [tools/content/contentChecks.ts:337]
- [x] [Review][Decision] (resolved: option 2, merge now and Geo judges through the « Sons » board; T3's listening subtask stays open on purpose) The three clips were never heard — T3's last subtask (« listen to the three clips ») is unchecked while T3 is `[x]`; AC 7 « reads as a toy squeak / a baby » is proven only by proxy tests. Options: (a) Geo listens now with `npm run assets:audio` output and the « Sons » board, before the merge; (b) merge now and judge afterwards through the board (the `deferred-work.md` entry already says so), T3 stays honest with a note. [_bmad-output/implementation-artifacts/2-3-…md T3]
- [x] [Review][Patch] Layer clips are not checked for existence by `content:check` — `clipPaths` lists the loops and `cue.audio.clip` only. `"layers":[{"clip":"baby_laugh_perfct"}]` passes the schema (regex) and `content:check`; at runtime the laugh is silently missing. Add `['cues', id, 'layers', i, 'clip']` entries, with a failing and a passing test. [tools/content/contentChecks.ts:199-207]
- [x] [Review][Patch] `auditionCue` while the audio is suspended — `audio.state !== 'running'` returns `false` and the board says « touch the game once », but a paused level or the Result screen never resumes on touch (`rescueAudio` resumes in `level` only), so the cue can never be heard there. The tap on the pane button is itself a gesture: resume the engine in `auditionCue` when suspended. The layer loop also calls `playOneShot` bare: guard it and log a `warn` on failure (project rule: every fallback logs). [src/client/boot.ts:1170-1180, src/debug/soundBoard.ts:46]
- [x] [Review][Patch] Sound board: a failed build leaves orphans — `container.append(paneHost, status)` runs before `paneFactory.create` and before the `feedback.cues` read; if either throws, `soundBoard` stays `null` and the next `show()` appends a second pair and leaks the first factory. Create the pane first or clean up on failure. `.pp-debug-sound-status` also has no rule in `debugOverlay.css` (the feel panel's status has one). [src/debug/soundBoard.ts:27-41, src/debug/debugOverlay.ts:463-470, src/debug/debugOverlay.css]
- [x] [Review][Patch] Merge `main` into the branch and fix the seed clash — story 3.2 (`ba93bfe`) is on `main`. `git merge-tree` reports two trivial conflicts: the header comment of `tools/audio/makePlaceholderAudio.ts` (L13-30) and one import line in `tests/tools/audio/makePlaceholderAudio.test.ts` (drop `synthParryPerfect`, keep `synthDoorSlam` and `synthStarLost`). After the merge `synthParry` (`SEED + 8`, `cultSounds.ts:33`) and main's `synthDoorSlam` draw the same rng stream, which `synthKit.ts` says never happens: give one a new seed offset (and regenerate nothing that is not yours: `--only` if the parry changes). Then rerun `content:check` on the merged tree. [tools/audio/cultSounds.ts:33, tools/audio/makePlaceholderAudio.ts]
- [x] [Review][Patch] D6 is only partly recorded in `deferred-work.md` — the catastrophe gauge's alert sound and the chrono-ring's last-arc vibration (GDD v2.2, via `gds-correct-course`) are missing, and « telegraph and gag clips unchanged, Geo asks clip by clip » is only inside the silence line. Add both to the 2.3 section. [_bmad-output/implementation-artifacts/deferred-work.md]
- [x] [Review][Patch] Two misleading comments — `soundBoard.ts` says « The labels are English literals » while the pane is titled `'Sons'` (the section is `'Sons'` too: drop the pane's own title or say so); `paneFactory.ts` says « one sheet per document » while each factory adopts its own sheet (the feel panel and the board each get one). [src/debug/soundBoard.ts:20-25, src/debug/paneFactory.ts]
- [x] [Review][Defer] Layers are ignored by the telegraph and gag sound rules — a telegraph cue that layers another threat's `tel_*` clip is not flagged; only `audio.clip` is compared. [tools/content/contentChecks.ts:344,400] — deferred, nothing layers a telegraph yet
- [x] [Review][Defer] The disruption `answer` cue has no sound rule, and a `uiElement`-anchored telegraph is entered into the owners map and can be reported twice — both only on content already reported as invalid. [tools/content/contentChecks.ts:398] — deferred, minor
- [x] [Review][Defer] The sound board says « played X » when the clip is not decoded (before the first level preload or after the preload timeout), because `playOneShot` skips silently. Needs a decoded-clip check or a boolean from the engine. [src/client/boot.ts:1171-1179] — deferred, beyond AC 14
- [x] [Review][Defer] The board is built once, on the first opening, from `feedback.json`: its buttons go stale if the content is hot-reloaded (the feel panel is rebuilt for that). [src/debug/debugOverlay.ts:465] — deferred, dev-only
