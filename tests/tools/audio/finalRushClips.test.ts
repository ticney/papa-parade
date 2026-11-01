import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The two placeholder clips of the final rush (story 3.5), seeds `SEED + 47` and `+ 48`: the key in the
// door's lock and the soft pop of a prop put back. In the table by the names the content uses, each with a
// stream of its own, silent at both ends, short and loud enough.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  cues: Record<string, { audio?: { clip: string } }>;
  events: Record<string, string>;
};
const NEW_CLIPS = ['env_door_key', 'env_prop_tidied'];
const OTHER_CLIPS = PLACEHOLDER_CLIPS.map(({ clip }) => clip).filter(
  (clip) => !NEW_CLIPS.includes(clip),
);

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe('the final rush clips (story 3.5)', () => {
  it('lists the two clips once each, and the cues of the two events name them', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of NEW_CLIPS) {
      expect(
        names.filter((name) => name === clip),
        clip,
      ).toHaveLength(1);
    }
    expect(feedback.events.FinalRushStarted).toBe('final_rush_started');
    expect(feedback.events.PropTidied).toBe('prop_tidied');
    expect(feedback.cues.final_rush_started?.audio?.clip).toBe('env_door_key');
    expect(feedback.cues.prop_tidied?.audio?.clip).toBe('env_prop_tidied');
  });

  it('makes clips unlike each other and the older ones, and the same bytes twice', () => {
    for (const clip of NEW_CLIPS) {
      const samples = synthOf(clip) as Float32Array;
      expect(synthOf(clip)).toEqual(samples);
      for (const other of [...NEW_CLIPS.filter((name) => name !== clip), ...OTHER_CLIPS]) {
        expect(sameSamples(samples, synthOf(other) as Float32Array), `${clip} / ${other}`).toBe(
          false,
        );
      }
    }
  });

  it('starts and ends each on silence, under a second, and loud enough', () => {
    for (const clip of NEW_CLIPS) {
      const samples = synthOf(clip) as Float32Array;
      expect(samples[0], clip).toBe(0);
      expect(samples[samples.length - 1], clip).toBe(0);
      expect(samples.length / SAMPLE_RATE_HZ, clip).toBeLessThan(1);
      expect(peakOf(samples), clip).toBeGreaterThan(0.4);
    }
  });
});
