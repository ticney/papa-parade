import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder telegraphs of the five new mischiefs of the big salon (story 9.7), seeds `SEED + 53` to
// `SEED + 57`: each in the table once, played by its cue alone, a stream of its own, silent at both ends,
// short. `checkTelegraphClips` wants each telegraph to have a sound of its own, and every older `tel_*`
// clip is taken.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as { cues: Record<string, { audio?: { clip: string } }> };
const synthSource = readFileSync(
  new URL('../../../tools/audio/makePlaceholderAudio.ts', import.meta.url),
  'utf8',
);

const NEW_CLIPS = [
  { clip: 'tel_tablecloth_pull', seed: '53' },
  { clip: 'tel_low_cabinet_open', seed: '54' },
  { clip: 'tel_bin_rummage', seed: '55' },
  { clip: 'tel_plant_dig', seed: '56' },
  { clip: 'tel_papa_mug_low', seed: '57' },
] as const;

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe.each(NEW_CLIPS)('the telegraph clip $clip (story 9.7)', ({ clip, seed }) => {
  const otherClips = PLACEHOLDER_CLIPS.map((entry) => entry.clip).filter((name) => name !== clip);

  it('is listed once and played by its own telegraph cue alone', () => {
    const names = PLACEHOLDER_CLIPS.map((entry) => entry.clip);
    expect(names.filter((name) => name === clip)).toHaveLength(1);
    const users = Object.entries(feedback.cues)
      .filter(([, cue]) => cue.audio?.clip === clip)
      .map(([id]) => id);
    expect(users).toEqual([clip]);
  });

  it(`draws from the seed SEED + ${seed}, which no other synth uses`, () => {
    const seeds = [...synthSource.matchAll(/createRng\(SEED \+ (\d+)\)/g)].map((match) => match[1]);
    expect(seeds.filter((found) => found === seed)).toHaveLength(1);
  });

  it('is unlike every other clip, and the same bytes twice', () => {
    const samples = synthOf(clip) as Float32Array;
    expect(synthOf(clip)).toEqual(samples);
    for (const other of otherClips) {
      expect(sameSamples(samples, synthOf(other) as Float32Array), other).toBe(false);
    }
  });

  it('starts and ends on silence, under a second, and loud enough', () => {
    const samples = synthOf(clip) as Float32Array;
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples.length / SAMPLE_RATE_HZ).toBeLessThan(1);
    expect(peakOf(samples)).toBeGreaterThan(0.4);
  });
});
