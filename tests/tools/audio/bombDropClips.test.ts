import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder clips of the bomb drop (story 4.8), seeds `SEED + 35` to `+ 38`: in the table by the
// names the content uses, each with a stream of its own, silent at both ends, and a short loop (the
// level's audio budget is 3 MiB).
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  loops: { sequenceMusic: Record<string, { clip: string }> };
  cues: Record<string, { audio?: { clip: string } }>;
};
const ONE_SHOTS = ['tel_bomb_drop', 'baby_mattress_touch', 'gag_baby_woke_on_drop'];
const LOOP = 'music_bomb_thriller';
const NEW_CLIPS = [...ONE_SHOTS, LOOP];
const OLDER_CLIPS = PLACEHOLDER_CLIPS.map(({ clip }) => clip).filter(
  (clip) => !NEW_CLIPS.includes(clip),
);

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const seconds = (samples: Float32Array | undefined) =>
  (samples?.length ?? Number.NaN) / SAMPLE_RATE_HZ;
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe('the bomb drop clips (story 4.8)', () => {
  it('lists the four clips once each', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of NEW_CLIPS) {
      expect(
        names.filter((name) => name === clip),
        clip,
      ).toHaveLength(1);
    }
  });

  it('lists every clip the drop’s cues and its music loop name', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const cue of ['tel_bomb_drop', 'bomb_drop_touchdown', 'gag_baby_woke_on_drop']) {
      expect(names, cue).toContain(feedback.cues[cue]?.audio?.clip);
    }
    expect(names).toContain(feedback.loops.sequenceMusic.bomb_drop?.clip);
    expect(feedback.loops.sequenceMusic.bomb_drop?.clip).toBe(LOOP);
  });

  it('shares its telegraph with no other cue', () => {
    const users = Object.entries(feedback.cues)
      .filter(([, cue]) => cue.audio?.clip === 'tel_bomb_drop')
      .map(([id]) => id);
    expect(users).toEqual(['tel_bomb_drop']);
  });

  it('makes clips unlike each other and the older ones, and the same bytes twice', () => {
    for (const clip of NEW_CLIPS) {
      const samples = synthOf(clip) as Float32Array;
      expect(synthOf(clip)).toEqual(samples);
      for (const other of [...NEW_CLIPS.filter((name) => name !== clip), ...OLDER_CLIPS]) {
        expect(sameSamples(samples, synthOf(other) as Float32Array), `${clip} / ${other}`).toBe(
          false,
        );
      }
    }
  });

  it('starts and ends every one-shot on silence, under a second, and loud enough', () => {
    for (const clip of ONE_SHOTS) {
      const samples = synthOf(clip) as Float32Array;
      expect(samples[0], clip).toBe(0);
      expect(samples[samples.length - 1], clip).toBe(0);
      expect(seconds(samples), clip).toBeLessThan(1);
      expect(peakOf(samples), clip).toBeGreaterThan(0.4);
    }
  });

  it('keeps the thriller short and quiet, and its loop point clean', () => {
    const loop = synthOf(LOOP) as Float32Array;
    expect(seconds(loop)).toBeLessThanOrEqual(8);
    expect(peakOf(loop)).toBeLessThan(0.25);
    expect(peakOf(loop)).toBeGreaterThan(0.05);
    expect(Math.abs(loop[0] as number)).toBeLessThan(0.02);
    expect(Math.abs(loop[loop.length - 1] as number)).toBeLessThan(0.02);
  });

  it('beats like a heart: the loud part of the loop comes round once a second', () => {
    const loop = synthOf(LOOP) as Float32Array;
    const secondLength = SAMPLE_RATE_HZ;
    const peakOfSecond = (index: number) =>
      peakOf(loop.slice(index * secondLength, index * secondLength + secondLength / 4));
    const quietOfSecond = (index: number) =>
      peakOf(
        loop.slice(index * secondLength + secondLength / 2, (index + 1) * secondLength - 1000),
      );
    for (const index of [1, 2]) {
      expect(peakOfSecond(index)).toBeGreaterThan(quietOfSecond(index) * 1.5);
    }
  });
});
