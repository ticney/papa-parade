import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder clips of the stealth exit (story 4.9), seeds `SEED + 39` to `+ 46`: in the table by the
// names the content uses (a floor creak is an `env_` clip and a breath a `papa_` one: `content:check` wants
// a category), each with a stream of its own, silent at both ends, and a short loop (the level's audio
// budget is 3 MiB).
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  loops: { sequenceMusic: Record<string, { clip: string }> };
  cues: Record<string, { audio?: { clip: string } }>;
  events: Record<string, string>;
};
const ONE_SHOTS = [
  'tel_false_alarm_sigh',
  'tel_real_wake',
  'resp_nothing',
  'gag_baby_woke_by_touch',
  'gag_baby_woke_crying',
  'env_floor_creak',
  'papa_breath_gasp',
];
const LOOP = 'music_stealth';
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

describe('the stealth exit clips (story 4.9)', () => {
  it('lists the eight clips once each', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of NEW_CLIPS) {
      expect(
        names.filter((name) => name === clip),
        clip,
      ).toHaveLength(1);
    }
  });

  it('lists every clip the stealth cues and its music loop name', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const cue of [
      'tel_false_alarm_sigh',
      'tel_real_wake',
      'resp_nothing',
      'gag_baby_woke_by_touch',
      'gag_baby_woke_crying',
      'floor_creak',
      'breath_gasped',
    ]) {
      expect(names, cue).toContain(feedback.cues[cue]?.audio?.clip);
    }
    expect(feedback.loops.sequenceMusic.stealth_exit?.clip).toBe(LOOP);
    expect(names).toContain(LOOP);
  });

  it('plays the creak on a creaking board and the gasp on a gasp, and nothing on the hold and release', () => {
    expect(feedback.events.FloorCreaked).toBe('floor_creak');
    expect(feedback.events.BreathGasped).toBe('breath_gasped');
    expect(feedback.events.BreathHeld).toBeUndefined();
    expect(feedback.events.BreathReleased).toBeUndefined();
  });

  it('gives the two telegraphs a clip of their own, so they are not twins', () => {
    for (const clip of ['tel_false_alarm_sigh', 'tel_real_wake']) {
      const users = Object.entries(feedback.cues)
        .filter(([, cue]) => cue.audio?.clip === clip)
        .map(([id]) => id);
      expect(users, clip).toHaveLength(1);
    }
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

  it('keeps the loop short and quiet, and its loop point clean', () => {
    const loop = synthOf(LOOP) as Float32Array;
    expect(seconds(loop)).toBeLessThanOrEqual(8);
    expect(peakOf(loop)).toBeLessThan(0.25);
    expect(peakOf(loop)).toBeGreaterThan(0.05);
    expect(Math.abs(loop[0] as number)).toBeLessThan(0.02);
    expect(Math.abs(loop[loop.length - 1] as number)).toBeLessThan(0.02);
  });
});
