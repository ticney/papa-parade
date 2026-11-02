# Audio sources

Where the shipped music (story 7.6) and babble (story 7.7) come from, so that a track can be redone and the licence question answered later. Everything else in `public/assets/audio/` is still a synthesized placeholder from `tools/audio/makePlaceholderAudio.ts`.

**Licence status:** Geo confirmed on 2026-11-01 that his ElevenLabs plan allows this music in a game he distributes. On 2026-11-02 he confirmed the same for the babble, which comes from the sound effects model. ElevenLabs refused several takes with "Free generations are busy" (`free_shared`), so check the plan again before a store release.

All takes: ElevenLabs, flow `oJxjnjQgAe66OVCVySXO`, generated on 2026-11-01. The music uses model `eleven_music_v2_5`, instrumental; the babble's model is in its section. `creative_get_generations` with the flow and generation id gives a fresh download link, at no cost.

Each file is cut with `tools/audio/cutMusicLoop.ts`. `npm run assets:audio` leaves them alone unless `--only` names one (`GENERATED_CLIPS`).

## Files

| File | Generation | Credits | Asked for | Cut | Gain | Encoded |
|---|---|---|---|---|---|---|
| `music_crawler_calm` | `4jIU6BkDhCy5goQUwyVp` | 900 | 60 s | `--bars 12 --bpm 80 --crossfade-ms 50` | -2 dB | Stereo, 96 kbps |
| `music_crawler_tense` | `xZkzmUctbANBZrH4gP1r` | 630 | 42 s (got 60 s) | `--bars 12 --bpm 80 --crossfade-ms 50` | -2 dB | Stereo, 96 kbps |
| `music_stay_awake` | `Lqr3Zknvp5u3pANoX0up` | 540 | 36 s | `--bars 8 --bpm 60 --crossfade-ms 50` | -4 dB | Mono, 64 kbps |
| `music_lullaby_pad` | `dm4ddngOUHoREJtQw4RQ` | 540 | 36 s | `--length-ms 26000 --start-ms 8000 --crossfade-ms 2000` | -1.5 dB | Mono, 64 kbps |
| `music_bedtime_hush` | `4LgJDnbNlNb3gCVEEFzY` | 540 | 36 s | `--length-ms 30000 --crossfade-ms 2000` | -12 dB | Mono, 64 kbps |
| `music_bomb_thriller` | `zEpRRBdv8tgsSSxapSiM` | 270 | 18 s | `--bars 3 --bpm 60 --crossfade-ms 50` | -15 dB | Mono, 64 kbps |
| `music_stealth` | `5671JpuRpmgoKpG0WT7g` | 540 | 36 s | `--bars 8 --bpm 60 --crossfade-ms 50` | -3 dB | Mono, 64 kbps |

Gains put each loop near the level of the placeholder it replaced, except the stems, which are set by the headroom of their mix (-1.04 dBFS at the game's 60/100). The level is a starting point for Geo's ear.

The mono files are true downmixes of both channels, made by the tool: `afconvert -c 1` keeps the left channel alone.

The calm take's end fades out and the lullaby pad's start fades in, whatever the prompt said; the cuts stay clear of both.

## The babble (story 7.7)

`baby_babble_loop`: generation `4rlt765QnXKUPFcIjCkA`, node `kHX97o3MkXGaJqajhXBE`, on the same flow, model `eleven_text_to_sound_v2` (sound effects, not music), 100 credits. Asked for 10 s with `loop: true` and `prompt_influence: 0.6`; the source is 10.000 s, stereo. Cut with `--length-ms 10000 --crossfade-ms 0 --gain-db 0 --bitrate-bps 64000 --channels 1`. Kept whole, because the model made it loop.

Prompt: Happy baby babbling continuously to itself, soft cute coos and gentle "ba-ba" and "da-da" syllables, no crying, no words, no pauses, close-mic, dry indoor room

The take has pauses despite the prompt, and a lull from 4.18 to 7.14 s where the babble sits at or under the music. Geo played it and kept it (story 7.7).

## Prompts

**`music_crawler_calm`:** Gentle, playful instrumental game underscore, soft and cosy with a quietly mischievous lightness. Felt piano, pizzicato strings, soft celesta and warm upright bass, sparse arrangement with plenty of space, steady 80 BPM in 4/4, in C major, low constant energy from start to finish. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same instruments and level throughout.

**`music_crawler_tense`** (with the calm take wired to the model's `audio` input): Tense, nervous instrumental game underscore that follows the same chords, melody shape and phrasing as the reference audio, a darker and more anxious arrangement of the same piece. Felt piano, urgent staccato pizzicato strings, tremolo strings, celesta and upright bass with a tight pulsing rhythm, steady 80 BPM in 4/4, in C major, constant high tension from start to finish. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same instruments and level throughout.

**`music_stay_awake`:** Slow, drowsy instrumental underscore, heavy and woozy, like nodding off and fighting it. Low felt piano, muffled upright bass and a warm sustained organ drone, gently swaying at a steady 60 BPM in 4/4, in A minor, hazy soft production, low constant energy. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same instruments and level throughout.

**`music_lullaby_pad`:** Beatless ambient pad, warm and tender, with no rhythm, no pulse and no percussion at all. Soft sustained strings and an airy synth pad holding an open C and G drone, strictly C major pentatonic, no melody, one very slow gentle swell, quiet and intimate. Seamless loop: no intro, no fade in, no fade out, no ending, same instruments and level throughout.

**`music_bedtime_hush`:** Beatless, very quiet dark ambient drone, suspended and holding its breath, with no rhythm, no pulse, no percussion and no melody at all. A low sustained bass tone under a soft breath of air noise, minimal and intimate, close dry production. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same sounds and level throughout.

**`music_bomb_thriller`:** Dark minimal thriller underscore, tense and held back. One deep heartbeat kick on every beat at a steady 60 BPM in 4/4, over a low two-note drone of bass and cello, with a thin high violin tone, in D minor, clean cinematic production, constant high tension. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same instruments and level throughout.

**`music_stealth`:** Minimal stealth underscore, very low and sparse, like a clock in a dark room. A very low sustained bass drone and one dry wooden tick every two beats at a steady 60 BPM in 4/4, an occasional soft pizzicato note, in A minor, close dry production, low constant energy. Seamless loop: no intro, no fade in, no fade out, no ending, no build-up, same instruments and level throughout.
