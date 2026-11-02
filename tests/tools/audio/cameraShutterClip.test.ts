import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CLIPS, SAMPLE_RATE_HZ } from '../../../tools/audio/makePlaceholderAudio.ts';

// The placeholder clip of the end photo (story 3.6), seed `SEED + 49`: the shutter that plays with the
// flash. In the table by the name the content uses, with a stream of its own, silent at both ends,
// short and loud enough, and a file on disk.
const feedback = JSON.parse(
  readFileSync(new URL('../../../content/feedback.json', import.meta.url), 'utf8'),
) as {
  cues: Record<
    string,
    { audio?: { clip: string; bus: string }; visual?: { kind: string }; haptic?: string }
  >;
  events: Record<string, string>;
};
const CLIP = 'ui_camera_shutter';
const OTHER_CLIPS = PLACEHOLDER_CLIPS.map(({ clip }) => clip).filter((clip) => clip !== CLIP);

const synthOf = (clip: string) => PLACEHOLDER_CLIPS.find((entry) => entry.clip === clip)?.synth();
const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};
const sameSamples = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

describe('the end photo clip (story 3.6)', () => {
  it('is listed once, and the cue of PhotoTaken names it on the ui bus', () => {
    expect(PLACEHOLDER_CLIPS.filter(({ clip }) => clip === CLIP)).toHaveLength(1);
    expect(feedback.events.PhotoTaken).toBe('photo_taken');
    expect(feedback.cues.photo_taken?.audio).toMatchObject({ clip: CLIP, bus: 'ui' });
  });

  it('is a cue with a visual and a haptic: no sound alone', () => {
    expect(feedback.cues.photo_taken?.visual).toEqual({ kind: 'uiElement' });
    expect(feedback.cues.photo_taken?.haptic).toBe('medium');
  });

  it('makes the same bytes twice, unlike every other clip', () => {
    const samples = synthOf(CLIP) as Float32Array;
    expect(synthOf(CLIP)).toEqual(samples);
    for (const other of OTHER_CLIPS) {
      expect(sameSamples(samples, synthOf(other) as Float32Array), `${CLIP} / ${other}`).toBe(
        false,
      );
    }
  });

  it('starts and ends on silence, under a second, and loud enough', () => {
    const samples = synthOf(CLIP) as Float32Array;
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples.length / SAMPLE_RATE_HZ).toBeLessThan(1);
    expect(peakOf(samples)).toBeGreaterThan(0.4);
  });

  it('is on disk, where the level loads it from', () => {
    expect(existsSync(new URL(`../../../public/assets/audio/${CLIP}.m4a`, import.meta.url))).toBe(
      true,
    );
  });
});
