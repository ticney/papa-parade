---
baseline_commit: 76c6517e16d1a22d14927727fd86af951f226a41
---

# Story 7.6: Musique générée du salon et des séquences

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want real music in place of the provisional synthesized loops,
so that the game sounds like a game from the next playtest on.

**Requirements covered:** FR60 (music quality; the behaviour is already built by story 2.6), part of FR70 (audio production).

**Scope:** an **asset swap with no change to game behaviour**: seven `music_*` files under the same names, the tool that cuts them, and the guard that keeps the placeholder tool from overwriting them.

**Not in this story:**
- Music per age and `content/music/` (7.5). `loops.music` stays one global pair of stems.
- The per-level audio manifest (deferred to 7.5 in `deferred-work.md`).
- The lullaby notes and tick (see D3), and every non-music clip.
- Any change to `adaptiveMusic.ts`'s mix, `content/feel.json` or the sim, unless Task 7's device check forces the loop fix of D7.

## Blocking gates (Geo)

These three are Geo's. An agent never assumes them and never works around them.

1. **Plan terms.** Geo has said he checks that his ElevenLabs plan allows music in a game he distributes. ElevenLabs' own error message spoke of "free generations", which suggests a free tier. **No merge until he has confirmed it in this story's completion notes.**
2. **Credits.** Every generation needs his OK on the stated cost first (AC 3). Never repeat a call to retry: a second call is charged again. A call refused with "busy" did not start and was not charged; it may be retried once he has asked for it.
3. **Ear.** The agent cannot hear. Geo judges each loop; the merge waits for his OK.

## Acceptance Criteria

1. **The stems Geo approved are the stems shipped.** Given the two takes Geo validated by ear on 2026-11-01 (D1), when `music_crawler_calm` and `music_crawler_tense` are replaced, then each is cut to 12 bars at 80 BPM (exactly 36.000 s, 1,587,600 frames at 44.1 kHz) with the same recipe, and their decoded lengths differ by no more than `MUSIC_STEM_LENGTH_TOLERANCE_MS`.
2. **The mix does not clip.** Given the game's tense mix (calm at `feel.music.tense.calmGainPct`, tense at 100 %), when both stems sound together, then the peak stays under -1 dBFS. The trial peaked at +0.6 dBFS with 56 clipped samples (D4).
3. **Five loops are replaced, and no credit is spent without OK.** Given `music_stay_awake`, `music_lullaby_pad`, `music_bedtime_hush`, `music_bomb_thriller` and `music_stealth`, when they are generated and cut (D2, D3), then each replaces the file of the same name, and the completion notes list each take's cost next to Geo's OK.
4. **The music does not lie about the game.** The lullaby pad and the duel's hush have no pulse, because a pulse would suggest a rhythm to read (`synthLullabyPad`, `synthBedtimeHush`). The lullaby pad sits on C major pentatonic under notes C5 D5 E5 G5. Measured by Task 3's onset check and confirmed by Geo's ear.
5. **Each loop loops.** No take's end fade is inside the cut. The seam has no click and no gap in Chromium, and Geo has heard each loop's seam at least once.
6. **The placeholder tool cannot overwrite a generated file.** `npm run assets:audio` with no `--only` leaves the seven files byte-identical; naming one with `--only` still regenerates it on purpose. Unit test.
7. **The budget holds.** `npm run dist:check -- --flavor playtest` passes with each level's payload ≤ 3 MiB, and the payload is reported in the completion notes.
8. **The music is ready in time, or arrives late without harm.** On a throttled 4G profile in Chromium, the completion notes state whether `preload` beat `AUDIO_LOAD_TIMEOUT_MS` (5000 ms). If it did not, the music must still start once decoded, and the level must not wait longer.
9. **The real device was checked.** On Geo's iPhone (Safari) with a playtest build: both stems loop, stay in sync across at least 3 loops, and the seam gap is judged. `deferred-work.md` says AAC padding survives `decodeAudioData` on WebKit, and this story is where that promise falls due (D7).
10. **Slow-mo and silence still work.** At `feel.music.slowMo.playbackRatePct` with the low-pass, and during a silence's cut, the new stems behave as before: `tests/e2e/adaptiveMusic.spec.ts` passes on Chromium, unchanged.
11. **Every file's origin is on record.** `docs/audio-sources.md` lists for each file the model, prompt, generation id, date, cut and bitrate, so that a track can be redone and the licence question answered later.
12. **Nothing else moves.** No file changes under `src/sim`, `src/bots`, `content/` or `tests/golden/`. `npm run ci:fast` passes with no golden regenerated. The story's single `npm run ci:story` runs after the review. `npm run content:check` still finds every clip.

## Tasks / Subtasks

- [x] Task 1: The cutting tool (AC: 1, 2, 5)
  - [x] Add `tools/audio/cutMusicLoop.ts` (Node, `tsx`, macOS only, `afconvert` like `makePlaceholderAudio.ts`; `tools/` never imported by `src/`). In: a source file, `--bars`, `--bpm`, `--gain-db`, `--crossfade-ms`, `--bitrate`, `--channels`, out path. Pure functions for the cut and the crossfade, unit tested in `tests/tools/audio/`.
  - [x] Recipe of D5: decode to 16-bit 44.1 kHz WAV, keep `bars × 60 / bpm × 4` s, mix the audio just past the cut into the first 50 ms with an equal-power fade, gain, encode. Refuse a source too short for cut + crossfade.
  - [x] Log through `log` from `@shared/log`, return `Result`, exit 1 on failure, as the placeholder tool does.
- [x] Task 2: The placeholder guard (AC: 6)
  - [x] In `makePlaceholderAudio.ts`, add a `GENERATED_CLIPS` list. `only === null` selects the table minus that list; `--only` still accepts them. **Keep the synth functions and table entries**: `makePlaceholderAudio.test.ts` pins them (the tense entry right after the calm entry, same length), and `bedtimeClips`, `bombDropClips` and `stealthClips` read the table.
  - [x] Check `generatePlaceholderClips`'s default-run tests (`makePlaceholderAudio.test.ts:571`), and add the new test.
- [x] Task 3: Replace the stems (AC: 1, 2, 11)
  - [x] Fetch the two takes with `creative_get_generations` (free, D1). Download each to its own new, empty folder outside the repo's tracked files.
  - [x] Cut both with the same recipe. Measure both in a throwaway check: frame counts, peak of the 60/100 mix, tempo.
  - [x] Write them to `public/assets/audio/`. Have Geo hear them through the game.
- [x] Task 4: Generate the five loops (AC: 3, 4, 5, 11)
  - [x] State the cost and get Geo's OK (D2: 2,430 credits for one take each, confirm with `estimate_only` first).
  - [x] Use `creative_add_flow_node` with `duration_seconds`, `instrumental: true`, `lyrics_type: "instrumental"`, then `creative_run_flow_nodes` with `generations_count: 1`. `creative_generate_in_flow` has no way to pass those parameters. No audio reference: the length is only reliable without one (D6).
  - [x] Wait in the background, fetch each take, find where its end fade starts, pick the cut (D5), measure onsets for AC 4, and give Geo each loop twice over its seam.
  - [x] A take that fails by ear is Geo's call: new cost, new OK.
- [x] Task 5: Budget and loading (AC: 7, 8)
  - [x] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`.
  - [x] Throttle to 4G in a Chromium page and read how long `preload` takes, and whether the `audio preload gave up` warning appears. Report it; do not raise the timeout without asking Geo.
- [x] Task 6: Records (AC: 11)
  - [x] Write `docs/audio-sources.md`. Update `deferred-work.md`: the "Real sounds" and "Looped `.m4a` clips" entries, with what this story settled and what it did not.
- [x] Task 7: Device check (AC: 9, 10)
  - [x] `npx playwright test tests/e2e/adaptiveMusic.spec.ts tests/e2e/feedback.spec.ts --project=chromium`, `npm run ci:fast`.
  - [x] Geo plays a playtest build on his iPhone and reports on the seam. If the gap is audible, apply D7 and say so in the notes.

### Review Findings

- [x] [Review][Decision] The five mono loops keep only the left channel — `afconvert -c 1` drops the right channel, with or without `--mix` (tested with hard-left and hard-right tones). L/R correlation of the takes: stay_awake 0.38, lullaby_pad 0.52, stealth 0.62, bedtime_hush 0.95, bomb_thriller 0.97. Geo approved by ear what shipped, so what he heard is the left channel. Recutting with a true downmix costs no credit but changes the sound he approved. **Geo chose to recut (2026-11-01):** done, and he approved the recut files by ear.
- [x] [Review][Patch] Downmix in PCM in the tool, not through `afconvert -c 1` [tools/audio/cutMusicLoop.ts]
- [x] [Review][Patch] The babble stays silent for the level if its clip lands after a preload gave up: `skippedLoops` is never cleared, and its stop is the silence telegraph [src/client/audio/audioEngine.ts:356]
- [x] [Review][Patch] A preload of unrelated clips (recalibration's beep) resets `hasPreloadGivenUp` while stems are in flight, and the music stays silent [src/client/audio/audioEngine.ts:514]
- [x] [Review][Patch] Every late clip, sound effects included, clears the skip and retries `start`, so a failed start warns once per clip: only a stem landing should [src/client/audio/audioEngine.ts:357]
- [x] [Review][Patch] A sequence's skip outlives its clip landing when the sequence is no longer wanted [src/client/audio/audioEngine.ts:361]
- [x] [Review][Patch] The late-music tests release every clip together and accept any number of starts: pin the stem order, an exact count and a failed stem [src/client/audio/audioEngine.test.ts]
- [x] [Review][Patch] The fix has no browser proof: on slow 4G the audio landed before the level started, so that run took the normal path. Add a spec that delays the stems past the timeout [tests/e2e/adaptiveMusic.spec.ts]
- [x] [Review][Patch] The crossfade clamps before the gain, so a take near 0 dBFS gets flat tops that the gain keeps: mix in floating point [tools/audio/cutMusicLoop.ts:115]
- [x] [Review][Patch] `parseArgs` accepts unknown flags, `--bars` dropped by `--length-ms`, zero or negative values, and an empty value [tools/audio/cutMusicLoop.ts:163]
- [x] [Review][Patch] The reported peak is measured before the channel reduction [tools/audio/cutMusicLoop.ts:263]
- [x] [Review][Patch] `parseWav` throws on a truncated `fmt ` chunk and does not check `WAVE` or the PCM tag [tools/audio/cutMusicLoop.ts:47]
- [x] [Review][Patch] "Never drift" in the header comment overclaims: it holds for frame counts, not for the browser's AAC decode [tools/audio/cutMusicLoop.ts:11]
- [x] [Review][Patch] Records: `deferred-work.md` still calls the iPhone seam and the hush open, and leaves the original entries untouched; the Change Log reads as all seven passing on iPhone; the licence line overstates `free_shared`; the File List omits `epics.md`; `--length-ms` is an unlisted departure; AC 9's "3 loops" is unrecorded; AC 4's key and AC 5's Chromium decode have no statement; `audio-listen/` must go before the merge [docs/audio-sources.md, deferred-work.md, this file]
- [x] [Review][Defer] Calm plays alone for the level when tense lands after the level started [src/client/audio/adaptiveMusic.ts:199] — deferred: joining mid-loop needs the running calm's position, or an audible restart
- [x] [Review][Defer] A tense decode that never settles keeps a decoded calm silent until an unmute [src/client/audio/audioEngine.ts:360] — deferred: `decodeAudioData` has no timeout anywhere in the engine
- [x] [Review][Defer] `data-pp-audio-clips` is stale after a preload gives up [src/client/audio/audioEngine.ts:538] — deferred, debug mirror only

## Dev Notes

### Decisions

- **D1. The stems are already made.** ElevenLabs flow `oJxjnjQgAe66OVCVySXO`, model `eleven_music_v2_5`: calm is node `DMXdpgMMXv0xPpPiyUeG`, generation `4jIU6BkDhCy5goQUwyVp` (900 credits); tense is node `bgk78jferOQ6G7LFg8eY`, generation `xZkzmUctbANBZrH4gP1r` (630 credits). Both are already paid for: do not regenerate. Signed URLs last 2 hours, so ask `creative_get_generations` again rather than storing one. Geo validated them by ear in the mix at the game's gains. The trial files are untracked in `.claude/worktrees/elegant-noyce-ffb870/audio-trial/`, which may be gone by then.
- **D2. The five loops.** Billed about 15 credits per second (900 for 60 s, 630 for 42 s). The extra margin is for the end fade, seen about 2 s from the end of the calm take.

  | Clip | Sequence lasts | Generate | Cut about | Credits | Needs |
  |---|---|---|---|---|---|
  | `music_stay_awake` | 30 s (3 × 10 s) | 36 s | 30 s | 540 | Drowsy, heavy, fighting sleep |
  | `music_lullaby_pad` | 40 s (beats 90 → 60 BPM) | 36 s | 30 s | 540 | **No pulse**, C major pentatonic |
  | `music_bedtime_hush` | 28 s + rests | 36 s | 30 s | 540 | **No pulse**, very quiet |
  | `music_bomb_thriller` | 6 s | 18 s | 12 s | 270 | Thriller, one heartbeat a second |
  | `music_stealth` | 60 s | 36 s | 30 s | 540 | Very low, a dry tick like a clock in a dark room |
  | **Total** | | 162 s | 132 s | **2,430** | About $0.24 at the rate shown; retakes are extra |

  Prompts describe sound, not story, in 1 to 3 sentences (`creative_get_model_guide`): genre, mood, instruments, tempo, production. Always end with "no intro, no fade in, no fade out, no ending, no build-up". Reuse the palette of felt piano, pizzicato, celesta and upright bass where it fits, so the game holds together.
- **D3. The lullaby notes and tick stay synthesized.** They last 0.52 s and 0.07 s and the music model's minimum is 3 s. The beat scheduler plans them one by one because a stem cannot slow from 90 to 60 BPM. The pad must therefore not carry a tempo.
- **D4. Level.** Stems at about -2 dB against the takes keep the 60/100 mix under -1 dBFS. Measure rather than trust this figure, and do not touch `feel.json`. The mix is Geo's to tune afterwards.
- **D5. Cuts.** Trial recipe: 12 bars (36.000 s) of the 3 s bars at 80 BPM, keeping the audio past the cut for a 50 ms equal-power fade into the start. The take's beat grid sat at phase 0 ms within 10 ms for the whole take; the loudness pattern over the opening 3 s matched best on even bars. Other tracks have their own tempo, so find it first. A loop with no pulse has no bars: cut where the level is steady and lengthen the crossfade, by ear.
- **D6. What the tool does not control.** Tempo and key are prompt requests only, and it has no loop setting. On the two takes: 80 BPM was hit both times; C major was hit on calm but tense came out C minor; "no fade out" was ignored by calm; 60 s requested gave 60.000 s without a reference, but 42 s with a reference gave 60 s (still charged for 42). The reference did not make tense follow calm's chords: bar similarity 0.40 against 0.35-0.42 when shifted. Geo accepted the result by ear.
- **D7. The WebKit loop.** AAC adds 2112 priming frames (48 ms at 44.1 kHz), and on WebKit they survive `decodeAudioData`. A gap there would be the same on both stems, so sync should hold, though the seam would dip. If Geo hears it, the smallest fix is `source.loopStart` / `source.loopEnd` in `addStem`. That changes `adaptiveMusic.ts` and needs a test: ask before widening the scope.
- **D8. Bitrate.** Stems stereo at 96 kbps (Geo judged them in stereo), the other five mono at 64 kbps (`AAC_BITRATE_BPS`). Estimate: 871 KiB + 1,070 KiB + 543 KiB for the rest of the audio and the bigger `.glb` = about 2.4 MiB, under 3 MiB (`LEVEL_PAYLOAD_MAX_BYTES`, counts all audio for each level). If AC 8 fails, mono stems save about 290 KiB and halve the 25 MB they take once decoded.

### What exists, and what must keep working

- **`src/client/audio/adaptiveMusic.ts`:** two looping `BufferSource`s started at one `startAtS`, same rate and low-pass, calm at 60 % in the tense state. Warns once if lengths differ by more than 2 ms. Do not change it unless D7 applies.
- **`src/client/audio/audioEngine.ts › preload`:** races decoding against `loadTimeoutMs`. On timeout the clips keep loading in the background and the level starts without them. Check that music starting late really starts: `isSkipped` is cleared only by `clearSkipped`, called at the end of `preload`, which could run before the late buffers land. **This is a possible bug under AC 8; test it, and report it rather than assume.**
- **`tools/build/inspectDist.ts`:** level payload = `.glb` + all audio, raw bytes.
- **`content/feedback.json`:** names the clips. Nothing to change, since the names stay.
- **`src/content/feedbackClips.test.ts`, `tools/content/contentChecks.ts`:** read names and that files exist, not lengths.
- **Audio at the start of this story:** 829 KiB in 68 files; the seven replaced come to 344 KiB. Largest `.glb`: 58 KiB.

### Testing

- `npm run ci:fast` after each task, plus only `adaptiveMusic.spec.ts` and `feedback.spec.ts` on Chromium. Check `env | grep VITE_` first: if `VITE_DEBUG_ALLOWED` is set, run as `(unset VITE_DEBUG_ALLOWED; …)`.
- Headless Chromium proves nothing about quality or iOS. Quality and seams are Geo's ear (AC 3, 4, 5, 9).
- The analysis of the trial was throwaway stdlib Python (RMS blocks, energy-flux autocorrelation for tempo, Goertzel for pitch classes). Its pitch detection is crude: treat it as a warning, not a verdict.

### Project Structure Notes

- `tools/audio/cutMusicLoop.ts` is new, next to `makePlaceholderAudio.ts` and `synthKit.ts`; tests go in `tests/tools/audio/`. `docs/audio-sources.md` is new. Downloaded takes are never committed; only the `.m4a` files are.
- **This story's key is on its branch only.** The agent that wrote it could not edit the main checkout, so `epics.md` and `sprint-status.yaml` carry it here. `npm run story:new -- 7-6` reads `main`'s status file and fails with "found 0 stories" until the line is there: commit that one line on `main` (allowed, it is under `_bmad-output/`) from the main checkout, or enter this worktree directly. A status-line conflict at merge is one the agent resolves itself. This worktree was created with no `npm ci`: run it first.

### Project Context Rules

- Audio files are `public/assets/audio/<category>_<name>.m4a`. No new dependency, and ffmpeg is not installed: `afconvert` and `afinfo` only.
- `tools/` is Node only, never imported by `src/`. No `console.*`: `log.<level>('assets', …)`. I/O returns `Result`. Units are name suffixes (`crossfadeMs`, `gainDb`). Anything Geo may tweak stays data.
- Never weaken a guardrail. Agents never handle Geo's credentials. No merge without his OK; `main` receives merges only.

### Previous story intelligence

- Story 7.1 was also an asset swap on a frozen game, and it set the shape of this one: gate on what must not move (AC 12), and wait for Geo's own check. It leaves the `.glb` files at 58 and 49 KiB, so art has not eaten the audio budget.
- Story 2.6 built the stems' mix; 4.4 to 4.9 built the sequences' loops and pinned why each sounds as it does (comments above each `synth*`). Read them before writing a prompt.

### Latest technical information

ElevenLabs tools as seen on 2026-11-01, through the session's MCP server: music node type with models `eleven_music_v1`, `v2`, `v2_5`; parameters `duration_seconds` (3 to 600), `instrumental`, `lyrics_type`, `lyrics`; an undocumented `audio` input port. Output is 48 kHz stereo MP3 at 192 kbps. Terms, prices and model ids may change: read `creative_get_flow_node_types` and `creative_get_model_schema` again rather than trusting this list.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` › Story 7.6]
- [Source: `gdd-papa-parade-2026-10-26/gdd.md` › Audio et musique]
- [Source: `_bmad-output/project-context.md` › adaptive music, audio paths, loading budget]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` › Looped `.m4a` clips, Real sounds, Per-level audio manifest]
- [Source: `src/client/audio/adaptiveMusic.ts`, `src/client/audio/audioEngine.ts`, `tools/audio/makePlaceholderAudio.ts`, `tools/build/inspectDist.ts`, `content/feel.json`]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`)

### Debug Log References

- Throwaway stdlib Python measures, and a throwaway Playwright spec for 4G, not committed.
- ElevenLabs refused takes several times with `free_shared` ("Free generations are busy"), never charged. Takes ran one at a time, on Geo's say-so.

### Completion Notes List

**Geo's gates:**
- Plan terms: **not confirmed, and they block the merge.** The takes came through the shared free generations.
- Ear (AC 3, 4, 5): Geo approved all seven on 2026-11-01 from listening files. The five mono ones were left-channel only at first (see Review Findings); they were recut, and he approved the recut files the same day. The stems did not change. Listening files are decoded by `afconvert`, so they do not show a WebKit gap, and they are not the game itself.
- iPhone (AC 9): Geo played the playtest build served on the LAN on his iPhone on 2026-11-01: the stems stay in sync and he hears no gap at the seam, so D7 was not applied. His report covers those two points on the stems; it does not say whether he reached the slow-mo, the silence or the sequence loops there, or whether he heard the "at least 3 loops" AC 9 asks for. That report predates the recut, which did not touch the stems.

**Credits:** 2,430 approved by Geo, 2,430 spent, one take each: stay_awake 540, lullaby_pad 540, bedtime_hush 540, bomb_thriller 270, stealth 540. The stems were paid for during the trial (900 + 630). Total 3,960.

**Measured:**
- Stems: 1,587,600 frames each, stereo 96 kbps. The 60/100 mix peaks at -1.04 dBFS (AC 2).
- Payload: 2,481.9 KiB against 3,072 KiB, `dist:check --flavor playtest` OK (AC 7).
- 4G, built playtest, Chromium, cache off (AC 8). Fast (9 Mbps, 60 ms): no timeout, 68 clips decoded, music on. Slow (1.6 Mbps, 150 ms): preload gave up at 5 s, audio landed by about 13 s, level at about 36 s for reasons other than audio, music on. That slow run took the normal start path, since the audio landed before the level. The late path has its own proof: a Chromium spec of `adaptiveMusic.spec.ts` holds the stems 12 s, and the music turns on after they land.
- After the recut, pulse at musical rates: `lullaby_pad` none (0.20 at most); `bedtime_hush` none (0.01; the wobble measured earlier on the left channel is gone); `bomb_thriller` 60 BPM, strong; `stealth` a 4 s pattern; `stay_awake` 60 BPM, faint (0.27).
- AC 4 key: a crude pitch-class check on the first cut of `lullaby_pad` found C, E and G and almost nothing else, consistent with the pentatonic; not repeated on the recut.
- AC 5 in Chromium: `decodeAudioData` gave exact lengths with no leading or trailing silence on the first cut, from the review's sample check, not listening; not repeated on the recut.

**Departures from the story, each deliberate:**
- `audioEngine.ts` changed. AC 8's suspected bug was real: after a preload gave up, the music stayed silent for the whole level even once decoded (`isSkipped`, cleared only before the clips landed). `resumeAfterLateClip` now clears the skips of a late clip (the babble's and the sequences' too) and starts the stems once neither is in flight. Unit tests pin the order, an exact count and a failed stem; one spec proves it in Chromium.
- `--length-ms` added to the tool, for the loops with no pulse (D5).
- `--start-ms` added to the tool: `lullaby_pad` fades in over about 6 s despite the prompt.
- Cuts: `stay_awake` and `stealth` 32 s (8 bars), not 30; `lullaby_pad` 26 s, not 30.
- Bitrate flag named `--bitrate-bps`, for the units rule.
- A test of `makePlaceholderAudio.test.ts` changed clip: the table's second clip is now out of a default run.

`ci:fast` and 12 specs of `adaptiveMusic.spec.ts` and `feedback.spec.ts` on Chromium pass. `ci:story` has not run: that is the review's.

### File List

- `docs/audio-sources.md` (new)
- `tools/audio/cutMusicLoop.ts` (new)
- `tests/tools/audio/cutMusicLoop.test.ts` (new)
- `tools/audio/makePlaceholderAudio.ts`
- `tests/tools/audio/makePlaceholderAudio.test.ts`
- `src/client/audio/audioEngine.ts`
- `src/client/audio/audioEngine.test.ts`
- `tests/e2e/adaptiveMusic.spec.ts`
- `public/assets/audio/music_crawler_calm.m4a`
- `public/assets/audio/music_crawler_tense.m4a`
- `public/assets/audio/music_stay_awake.m4a`
- `public/assets/audio/music_lullaby_pad.m4a`
- `public/assets/audio/music_bedtime_hush.m4a`
- `public/assets/audio/music_bomb_thriller.m4a`
- `public/assets/audio/music_stealth.m4a`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/7-6-musique-generee-du-salon-et-des-sequences.md`

### Change Log

- 2026-11-01: Seven generated music files, the cutting tool, the placeholder guard, and the late-music fix. Geo reported no gap and stems in sync on his iPhone; he approved the first cuts by ear.
- 2026-11-01: Code review: 13 patches applied, 3 deferred. The five mono loops recut with a true downmix, and Geo approved them by ear. The plan terms are still to confirm, and they block the merge.
