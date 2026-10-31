import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder clips of the bedtime duel (story 4.6): in the table by the names the content uses,
// each with a stream of its own, and a hush with no pulse.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  loops: { sequenceMusic: Record<string, { clip: string }> };
  cues: Record<string, { audio?: { clip: string }; layers?: { clip: string }[] }>;
};
const NEW_CLIPS = [
  'tel_bedtime_eyes',
  'resp_wait',
  'baby_eyes_close',
  'gag_baby_eyes_reopened',
  'music_bedtime_hush',
];
const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const seconds = (samples: Float32Array | undefined) =>
  (samples?.length ?? Number.NaN) / SAMPLE_RATE_HZ;

describe('the bedtime duel clips (story 4.6)', () => {
  it('lists the five new clips, each once', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of NEW_CLIPS)
      expect(
        names.filter((name) => name === clip),
        clip,
      ).toHaveLength(1);
  });

  it('lists every clip the duel’s cues and its music loop name, in the table', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    const wanted = [
      feedback.cues.tel_bedtime_eyes?.audio?.clip,
      feedback.cues.bedtime_eyes_closed?.audio?.clip,
      feedback.cues.resp_wait?.audio?.clip,
      feedback.cues.resp_wait_perfect?.audio?.clip,
      feedback.cues.gag_baby_eyes_reopened?.audio?.clip,
      feedback.loops.sequenceMusic.bedtime_duel?.clip,
    ];
    for (const clip of wanted) expect(names, String(clip)).toContain(clip);
  });

  it('makes five clips unlike each other and the same bytes twice', () => {
    const synths = NEW_CLIPS.map((clip) => synthOf(clip) as Float32Array);
    for (let a = 0; a < synths.length; a++) {
      expect(synthOf(NEW_CLIPS[a] as string)).toEqual(synths[a]);
      for (let b = a + 1; b < synths.length; b++) {
        expect(
          synths[a]?.length === synths[b]?.length &&
            synths[a]?.every((v, i) => v === synths[b]?.[i]),
        ).toBe(false);
      }
    }
  });

  it('starts and ends every one-shot on silence, and keeps them under a second', () => {
    for (const clip of NEW_CLIPS.filter((name) => name !== 'music_bedtime_hush')) {
      const samples = synthOf(clip) as Float32Array;
      expect(samples[0], clip).toBe(0);
      expect(samples[samples.length - 1], clip).toBe(0);
      expect(seconds(samples), clip).toBeLessThan(1);
    }
  });

  it('makes the hush a long loop with no pulse: its loudness never jumps from one tenth of a second to the next', () => {
    const hush = synthOf('music_bedtime_hush') as Float32Array;
    expect(seconds(hush)).toBeGreaterThanOrEqual(4);
    const windowSamples = SAMPLE_RATE_HZ / 10;
    const rms: number[] = [];
    // Skip the first and last second: the fade at the loop point is not a pulse. The slow swell
    // (one per loop) moves the loudness by a few percent per tenth of a second; a pulse would not.
    for (
      let from = SAMPLE_RATE_HZ;
      from + windowSamples < hush.length - SAMPLE_RATE_HZ;
      from += windowSamples
    ) {
      let sum = 0;
      for (let i = from; i < from + windowSamples; i++) sum += (hush[i] as number) ** 2;
      rms.push(Math.sqrt(sum / windowSamples));
    }
    for (let i = 1; i < rms.length; i++) {
      const a = rms[i - 1] as number;
      const b = rms[i] as number;
      expect(Math.abs(a - b) / Math.max(a, b), `window ${i}`).toBeLessThan(0.15);
    }
    // And it is quieter than the lullaby's pad.
    const pad = synthOf('music_lullaby_pad') as Float32Array;
    expect(peakOf(hush)).toBeLessThan(peakOf(pad));
  });
});
