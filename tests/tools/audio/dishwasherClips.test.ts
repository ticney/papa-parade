import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder telegraph of the open dishwasher (story 9.6), seed `SEED + 52`: in the table once, played
// by its cue alone, a stream of its own (`potClips.test.ts` proves that no two synths share a seed), silent
// at both ends, short. `checkTelegraphClips` wants each telegraph to have a sound of its own, and every
// older `tel_*` clip is taken.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as { cues: Record<string, { audio?: { clip: string } }> };
const synthSource = readFileSync(
  new URL('../../../tools/audio/makePlaceholderAudio.ts', import.meta.url),
  'utf8',
);
const CLIP = 'tel_dishwasher_open';
const OTHER_CLIPS = PLACEHOLDER_CLIPS.map(({ clip }) => clip).filter((clip) => clip !== CLIP);

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe('the open dishwasher telegraph clip (story 9.6)', () => {
  it('is listed once and played by the dishwasher telegraph alone', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    expect(names.filter((name) => name === CLIP)).toHaveLength(1);
    const users = Object.entries(feedback.cues)
      .filter(([, cue]) => cue.audio?.clip === CLIP)
      .map(([id]) => id);
    expect(users).toEqual(['tel_dishwasher_open']);
  });

  it('draws from the seed SEED + 52, which no other synth uses', () => {
    const seeds = [...synthSource.matchAll(/createRng\(SEED \+ (\d+)\)/g)].map((match) => match[1]);
    expect(seeds.filter((seed) => seed === '52')).toHaveLength(1);
  });

  it('is unlike every other clip, and the same bytes twice', () => {
    const samples = synthOf(CLIP) as Float32Array;
    expect(synthOf(CLIP)).toEqual(samples);
    for (const other of OTHER_CLIPS) {
      expect(sameSamples(samples, synthOf(other) as Float32Array), other).toBe(false);
    }
  });

  it('starts and ends on silence, under a second, and loud enough', () => {
    const samples = synthOf(CLIP) as Float32Array;
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples.length / SAMPLE_RATE_HZ).toBeLessThan(1);
    expect(peakOf(samples)).toBeGreaterThan(0.4);
  });
});
