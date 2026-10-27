import { describe, expect, it } from 'vitest';
import {
  encodeWav,
  PLACEHOLDER_CLIPS,
  SAMPLE_RATE_HZ,
  synthBabble,
  synthBump,
  synthMusic,
} from '../../../tools/audio/makePlaceholderAudio.ts';

const peakOf = (samples: Float32Array): number =>
  samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);

/** The longest run of samples quieter than -50 dBFS, in seconds. */
function longestSilenceS(samples: Float32Array): number {
  let longest = 0;
  let run = 0;
  for (const value of samples) {
    run = Math.abs(value) < 0.003 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest / SAMPLE_RATE_HZ;
}

describe('placeholder audio', () => {
  it('is deterministic', () => {
    for (const { synth } of PLACEHOLDER_CLIPS) expect(synth()).toEqual(synth());
  });

  it('keeps every clip at or below -6 dBFS and never silent', () => {
    for (const { clip, synth } of PLACEHOLDER_CLIPS) {
      const peak = peakOf(synth());
      expect(peak, clip).toBeGreaterThan(0.1);
      expect(peak, clip).toBeLessThanOrEqual(10 ** (-6 / 20));
    }
  });

  it('starts and ends every clip at zero, so a loop does not click', () => {
    for (const { clip, synth } of PLACEHOLDER_CLIPS) {
      const samples = synth();
      expect(samples[0], clip).toBe(0);
      expect(samples[samples.length - 1], clip).toBe(0);
    }
  });

  it('has the lengths of the table: 6 s babble, 8 s music, ~150 ms bump', () => {
    expect(synthBabble().length).toBe(6 * SAMPLE_RATE_HZ);
    expect(synthMusic().length).toBe(8 * SAMPLE_RATE_HZ);
    expect(synthBump().length / SAMPLE_RATE_HZ).toBeCloseTo(0.15, 2);
  });

  it('never lets the babble fall silent for 0.4 s, loop point included', () => {
    const babble = synthBabble();
    expect(longestSilenceS(babble)).toBeLessThan(0.4);
    // Across the loop point: the silence at the end plus the silence at the start.
    const doubled = new Float32Array(babble.length * 2);
    doubled.set(babble);
    doubled.set(babble, babble.length);
    expect(longestSilenceS(doubled)).toBeLessThan(0.4);
  });

  it('keeps the music quiet, around -12 dBFS', () => {
    expect(peakOf(synthMusic())).toBeLessThanOrEqual(10 ** (-11 / 20));
  });

  it('writes a mono 16-bit PCM WAV of the right size', () => {
    const wav = encodeWav(synthBump());
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE_HZ);
    expect(wav.length).toBe(44 + synthBump().length * 2);
  });
});
