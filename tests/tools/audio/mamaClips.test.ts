import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder clips of Mama's voice on the Result screen (story 3.7): a laugh, a sigh and a scream, on the
// `voice` bus with a visual and a haptic each, silent at both ends, short and loud enough, each its own stream
// and a file on disk.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  cues: Record<
    string,
    { audio?: { clip: string; bus: string }; visual?: { kind: string }; haptic?: string }
  >;
  events: Record<string, string>;
};
const MAMA = [
  { clip: 'mama_laugh', event: 'ResultMamaLaughed', haptic: 'light' },
  { clip: 'mama_sigh', event: 'ResultMamaSighed', haptic: 'light' },
  { clip: 'mama_scream', event: 'ResultMamaScreamed', haptic: 'medium' },
] as const;

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe.each(MAMA)('Mama’s clip $clip (story 3.7)', ({ clip, event, haptic }) => {
  const others = PLACEHOLDER_CLIPS.map((entry) => entry.clip).filter((name) => name !== clip);

  it('is listed once, and the cue of its event names it on the voice bus', () => {
    expect(PLACEHOLDER_CLIPS.filter((entry) => entry.clip === clip)).toHaveLength(1);
    expect(feedback.events[event]).toBe(clip);
    expect(feedback.cues[clip]?.audio).toMatchObject({ clip, bus: 'voice' });
  });

  it('is a cue with a visual and a haptic: no sound alone', () => {
    expect(feedback.cues[clip]?.visual).toEqual({ kind: 'uiElement' });
    expect(feedback.cues[clip]?.haptic).toBe(haptic);
  });

  it('makes the same bytes twice, unlike every other clip', () => {
    const samples = synthOf(clip) as Float32Array;
    expect(synthOf(clip)).toEqual(samples);
    for (const other of others) {
      expect(sameSamples(samples, synthOf(other) as Float32Array), `${clip} / ${other}`).toBe(
        false,
      );
    }
  });

  it('starts and ends on silence, under 1.5 s, and loud enough', () => {
    const samples = synthOf(clip) as Float32Array;
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples.length / SAMPLE_RATE_HZ).toBeLessThan(1.5);
    expect(peakOf(samples)).toBeGreaterThan(0.4);
  });

  it('is on disk, where the level loads it from', () => {
    expect(existsSync(new URL(`../../../public/assets/audio/${clip}.m4a`, import.meta.url))).toBe(
      true,
    );
  });
});
