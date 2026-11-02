---
baseline_commit: d6ef5be
---

# Story 7.7: Babillage généré

Status: review

## Story

As a player,
I want the baby's babble to sound like a baby,
so that the voice stops hiding the rest of the game's sound.

**Requirements covered:** part of FR70 (audio production). **Why:** after story 7.6, Geo still heard "the old sound": the synthetic babble, about 10 dB over the music in the game's mix, hid the new music.

**Scope:** an asset swap on one file. The cue's name, the bus and every `content/` value stay.

## Acceptance Criteria

1. **The take Geo chose is the file shipped.** `baby_babble_loop.m4a` comes from generation `4rlt765QnXKUPFcIjCkA`, mono, a true downmix, and `docs/audio-sources.md` records it.
2. **A default run of the placeholder tool leaves it alone.** `baby_babble_loop` is in `GENERATED_CLIPS`; naming it with `--only` still rewrites it.
3. **The silence still reads.** The take has pauses (11, the longest 500 ms, 34 % of the time: 50 ms windows, a pause being 25 dB under the 90th percentile). In the game, the babble's stop must still read as the silence telegraph, and its pauses must not read as false alarms. **Geo judges this by playing.**
4. **The rest of the sound is no longer hidden.** Geo judges this by playing. No mix value changes in this story; `loops.babble.gainPct` and the buses are his to tune afterwards.
5. **Nothing else moves.** No file changes under `src/`, `content/` or `tests/golden/`. `npm run ci:fast` and the specs that pin the babble pass. The review runs `ci:story` before the merge.

## Tasks / Subtasks

- [x] Cut the take with `tools/audio/cutMusicLoop.ts` (AC 1)
- [x] Add it to `GENERATED_CLIPS` and record its origin (AC 1, 2)
- [x] Run the checks and the specs (AC 5)
- [x] Geo plays a build (AC 3, 4)

### Review Findings

- [x] [Review][Decision] Resolved 2026-11-02: Geo kept the take; asked whether the lull made him believe in a silence while playing, he answered « Non, on garde ». The take has a 3 s lull — from 4.18 to 7.14 s of each 10 s loop the babble sits at or under the music, longer than the 2 s the real silence's sound-only warning lasts, and a real stop landing there has little audible edge. Geo reported noticing the stop, not whether the lull reads as one. The old test rule (under 0.4 s of silence) only checks the synth, and this file measures 0.52 s at -45 dB.
- [ ] [Review][Decision] Geo's plan confirmation named the music — the babble comes from the sound effects model, so the licence line does not cover it yet.
- [x] [Review][Patch] A test no longer tests anything on its stale file: `PLACEHOLDER_CLIPS[0]` is now out of a default run [tests/tools/audio/makePlaceholderAudio.test.ts:635]
- [x] [Review][Patch] The comment calls the synths documentation of what each loop must do, false for the babble (length, pauses, level) [tools/audio/makePlaceholderAudio.ts:2192]
- [x] [Review][Patch] Docs: "All takes" names the music model; the cut lacks `--bitrate-bps` and `--channels`; the source's real shape (10.000 s, stereo) is unrecorded; the prompt says "no pauses" while the pauses were accepted [docs/audio-sources.md]
- [x] [Review][Patch] Story record: AC 3 and 4 are ticked past what Geo reported; AC 2 overstates (`--only` rewrites it); AC 5 has no results; the pause figures have no method; the 0.4 s rule's trade is unwritten [this file]
- [x] [Review][Defer] Every restart replays from the head, so the clip's loudest moment comes 1.7 s after a silence that was found [src/client/audio/audioEngine.ts:222] — deferred: timing against the revealed telegraph not traced, for Geo's ear
- [x] [Review][Defer] No limiter on the output: babble and calm can sum to about 1.09 at coinciding peaks, a rare transient, computed and not observed [src/client/audio/buses.ts:39] — deferred: a mix decision
- [x] [Review][Defer] `constants.ts:118` says two characters at their limit still fit the level payload: already false before this story (3,169,619 B over 3,145,728 B) — deferred, pre-existing

## Dev Notes

- The take is one of the four variations Geo approved (400 credits). ElevenLabs was busy and only one ran, for 100 credits. Geo listened to it and chose it, so the other three were not generated.
- It uses the sound effects model's `loop` option, so it is kept whole, with no crossfade.
- Levels in the game: babble about -24.4 dB (-22.5 dB, voice bus at 80 %), calm music about -26.2 dB (-20.2 dB, music bus at 50 %). The old babble was about -15.7 dB. Its loud moments still reach about -2.7 dB at their peak.
- The rule that the babble never falls silent for 0.4 s (`makePlaceholderAudio.test.ts:110`) only checks the synth. The shipped file breaks it, at 0.52 s under -45 dB. That is the trade of a real take: nothing tests the file's pauses, and Geo's ear replaces the rule.
- **This story's key is on its branch only**, like 7.6's was: `npm run story:new -- 7-7` fails until the line is on `main`. Stay in this worktree.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`)

### Completion Notes List

- Cut and installed; 84,680 bytes against 23,809. 10.000 s, mono, peak -0.7 dB.
- AC 3: Geo played the build on 2026-11-01 and clearly notices the babble stopping. On 2026-11-02 he said the lull did not make him believe in a silence. Where a real stop lands in the loop varies, and his report does not say he heard one land in the lull.
- AC 4: he reported that the music comes through. He did not report on the other sounds.
- AC 5: no file changed under `src/`, `content/` or `tests/golden/`. Before the review, the 18 specs of `feedback`, `adaptiveMusic` and `silence` passed on Chromium. `ci:fast` after the review fixes: see the Change Log.

### File List

- `public/assets/audio/baby_babble_loop.m4a`
- `tools/audio/makePlaceholderAudio.ts`
- `docs/audio-sources.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/7-7-babillage-genere.md`

### Change Log

- 2026-11-01: Generated babble in place of the synthetic one.
- 2026-11-02: Review fixes. `ci:fast` passes: 7,802 tests, 3 skipped.
