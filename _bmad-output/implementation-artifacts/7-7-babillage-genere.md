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
2. **The placeholder tool cannot overwrite it.** `baby_babble_loop` is in `GENERATED_CLIPS`.
3. **The silence still reads.** The take has pauses (11, the longest 500 ms, 34 % of the time). In the game, the babble's stop must still read as the silence telegraph, and its pauses must not read as false alarms. **Geo judges this by playing.**
4. **The rest of the sound is no longer hidden.** Geo judges this by playing. No mix value changes in this story; `loops.babble.gainPct` and the buses are his to tune afterwards.
5. **Nothing else moves.** No file changes under `src/`, `content/` or `tests/golden/`. `npm run ci:fast` and the specs that pin the babble pass. The review runs `ci:story` before the merge.

## Tasks / Subtasks

- [x] Cut the take with `tools/audio/cutMusicLoop.ts` (AC 1)
- [x] Add it to `GENERATED_CLIPS` and record its origin (AC 1, 2)
- [x] Run the checks and the specs (AC 5)
- [ ] Geo plays a build (AC 3, 4)

## Dev Notes

- The take is one of the four variations Geo approved (400 credits). ElevenLabs was busy and only one ran, for 100 credits. Geo listened to it and chose it, so the other three were not generated.
- It uses the sound effects model's `loop` option, so it is kept whole, with no crossfade.
- Levels in the game: babble about -24.4 dB (-22.5 dB, voice bus at 80 %), calm music about -26.2 dB (-20.2 dB, music bus at 50 %). The old babble was about -15.7 dB. Its loud moments still reach about -2.7 dB at their peak.
- **This story's key is on its branch only**, like 7.6's was: `npm run story:new -- 7-7` fails until the line is on `main`. Stay in this worktree.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`)

### Completion Notes List

- Cut and installed; 84,680 bytes against 23,809. 10.000 s, mono, peak -0.7 dB.
- AC 3 and 4 wait on Geo's play.

### File List

- `public/assets/audio/baby_babble_loop.m4a`
- `tools/audio/makePlaceholderAudio.ts`
- `docs/audio-sources.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/7-7-babillage-genere.md`

### Change Log

- 2026-11-01: Generated babble in place of the synthetic one.
