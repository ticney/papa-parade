import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder telegraph of the pot on the stove (story 9.5), seed `SEED + 51`: in the table once, played
// by its cue alone, a stream of its own (no other synth starts from its seed), silent at both ends, short.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as { cues: Record<string, { audio?: { clip: string } }> };
const synthSource = readFileSync(
  new URL('../../../tools/audio/makePlaceholderAudio.ts', import.meta.url),
  'utf8',
);
const CLIP = 'tel_pot_on_stove';
const OLDER_CLIPS = PLACEHOLDER_CLIPS.map(({ clip }) => clip).filter((clip) => clip !== CLIP);

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe('the pot telegraph clip (story 9.5)', () => {
  it('is listed once and played by the pot telegraph alone', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    expect(names.filter((name) => name === CLIP)).toHaveLength(1);
    const users = Object.entries(feedback.cues)
      .filter(([, cue]) => cue.audio?.clip === CLIP)
      .map(([id]) => id);
    expect(users).toEqual(['tel_pot_on_stove']);
  });

  it('draws every synth from a seed of its own', () => {
    const seeds = [...synthSource.matchAll(/createRng\(SEED \+ (\d+)\)/g)].map((match) => match[1]);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.filter((seed, i) => seeds.indexOf(seed) !== i)).toEqual([]);
  });

  it('is unlike every other clip, and the same bytes twice', () => {
    const samples = synthOf(CLIP) as Float32Array;
    expect(synthOf(CLIP)).toEqual(samples);
    for (const other of OLDER_CLIPS) {
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
