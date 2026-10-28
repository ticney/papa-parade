import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PHONE_RINGING_EVERY_MS } from '@shared/constants';
import { err, ok } from '@shared/result';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeWav,
  generatePlaceholderClips,
  PLACEHOLDER_CLIPS,
  SAMPLE_RATE_HZ,
  synthBabble,
  synthBump,
  synthGagCoffeeTable,
  synthGagOutlet,
  synthGagPapaAsleep,
  synthGagSilence,
  synthGagStairs,
  synthMusic,
  synthParry,
  synthParryPerfect,
  synthPhoneAnswer,
  synthStarStamp,
  synthStarStampLast,
  synthTelegraph,
  synthTelegraphCoffeeTable,
  synthTelegraphMicroSleep,
  synthTelegraphPhone,
  synthTelegraphSilence,
  synthTelegraphStairs,
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

/** Two clips are alike above this normalised correlation. */
const CORRELATION_MAX = 0.5;
/** The shifts tried between two clips, in ms, and the step between them, in samples. */
const LAG_MAX_MS = 50;
const LAG_STEP_SAMPLES = 8;

/** The normalised dot product of `first` and `second` shifted by `lag` samples, over what they share. */
function correlation(first: Float32Array, second: Float32Array, lag: number): number {
  const from = Math.max(0, -lag);
  const to = Math.min(first.length, second.length - lag);
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = from; i < to; i++) {
    const x = first[i] as number;
    const y = second[i + lag] as number;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b);
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

  it('has the lengths of the outlet clips: 300, 150, 350 and 500 ms', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthTelegraph())).toBeCloseTo(300, 0);
    expect(ms(synthParry())).toBeCloseTo(150, 0);
    expect(ms(synthParryPerfect())).toBeCloseTo(350, 0);
    expect(ms(synthGagOutlet())).toBeCloseTo(500, 0);
  });

  it('lists the four outlet clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['tel_outlet', 'resp_parry', 'resp_parry_perfect', 'gag_outlet']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has the lengths of the stairs and coffee-table clips: 400, 500, 600 and 350 ms', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthTelegraphStairs())).toBeCloseTo(400, 0);
    expect(ms(synthTelegraphCoffeeTable())).toBeCloseTo(500, 0);
    expect(ms(synthGagStairs())).toBeCloseTo(600, 0);
    expect(ms(synthGagCoffeeTable())).toBeCloseTo(350, 0);
  });

  it('lists the four stairs and coffee-table clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['tel_stairs', 'gag_stairs', 'tel_coffee_table', 'gag_coffee_table']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has the lengths of the micro-sleep clips: 600 ms and two 600 ms snores', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthTelegraphMicroSleep())).toBeCloseTo(600, 0);
    expect(ms(synthGagPapaAsleep())).toBeCloseTo(1200, 0);
  });

  it('lists the two micro-sleep clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['tel_papa_microsleep', 'gag_papa_asleep']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has the lengths of the phone clips: a ring under 1000 ms (two never overlap) and a 150 ms click', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    // PHONE_RINGING_EVERY_MS is one second: a ring of that length or more would overlap the next.
    expect(ms(synthTelegraphPhone())).toBeCloseTo(850, 0);
    expect(ms(synthTelegraphPhone())).toBeLessThan(PHONE_RINGING_EVERY_MS);
    expect(ms(synthPhoneAnswer())).toBeCloseTo(150, 0);
  });

  it('lists the two phone clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['tel_phone_ring', 'papa_phone_answer']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has the lengths of the silence clips: a 300 ms chirp and a 500 ms rustle', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthTelegraphSilence())).toBeCloseTo(300, 0);
    expect(ms(synthGagSilence())).toBeCloseTo(500, 0);
  });

  it('lists the two silence clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['tel_silence_found', 'gag_silence_mischief']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has the lengths of the star stamps: a short blip, and a longer last one', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthStarStamp())).toBeCloseTo(120, 0);
    expect(ms(synthStarStampLast())).toBeCloseTo(400, 0);
    expect(synthStarStamp()).not.toEqual(synthStarStampLast().slice(0, synthStarStamp().length));
  });

  it('lists the two star stamps by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['ui_star_stamp', 'ui_star_stamp_last']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('makes each telegraph and each gag sound unlike the others (no two clips are alike)', () => {
    // The largest normalised dot product between two clips, over their common length and for every
    // shift of one against the other up to `LAG_MAX_MS`: a clip that sounded like another, or like
    // a copy of it started a little later, would correlate with it. Two unrelated sounds stay far from 1.
    const lagMax = Math.round((LAG_MAX_MS * SAMPLE_RATE_HZ) / 1000);
    const clips = PLACEHOLDER_CLIPS.filter(({ clip }) => /^(tel|gag)_/.test(clip)).map(
      ({ clip, synth }) => ({ clip, samples: synth() }),
    );
    expect(clips.map(({ clip }) => clip)).toEqual(
      expect.arrayContaining([
        'tel_stairs',
        'gag_stairs',
        'tel_coffee_table',
        'gag_coffee_table',
        'tel_papa_microsleep',
        'gag_papa_asleep',
        'tel_phone_ring',
        'tel_silence_found',
        'gag_silence_mischief',
      ]),
    );
    for (const [index, first] of clips.entries()) {
      for (const second of clips.slice(index + 1)) {
        let best = 0;
        for (let lag = -lagMax; lag <= lagMax; lag += LAG_STEP_SAMPLES) {
          best = Math.max(best, Math.abs(correlation(first.samples, second.samples, lag)));
        }
        expect(best, `${first.clip} / ${second.clip}`).toBeLessThan(CORRELATION_MAX);
      }
    }
  }, 30_000);

  it('never gives a NaN, in any clip', () => {
    for (const { clip, synth } of PLACEHOLDER_CLIPS) {
      expect(synth().every(Number.isFinite), clip).toBe(true);
    }
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

describe('generatePlaceholderClips', () => {
  const dirs: string[] = [];
  const tempDir = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-audio-test-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  /** A converter that "encodes" by copying the WAV, and fails for the clip named `failing`. */
  const converter = (failing?: string) => async (wavPath: string, m4aPath: string) => {
    if (failing !== undefined && wavPath.includes(failing)) {
      return err({ kind: 'assets', message: 'afconvert failed (exit 1): boom' });
    }
    await writeFile(m4aPath, await readFile(wavPath));
    return ok(undefined);
  };

  it('writes every clip, named after its id, when every conversion succeeds', async () => {
    const out = await tempDir();
    const result = await generatePlaceholderClips(out, converter());
    expect(result.ok).toBe(true);
    expect((await readdir(out)).sort()).toEqual(
      PLACEHOLDER_CLIPS.map(({ clip }) => `${clip}.m4a`).sort(),
    );
  });

  it('touches nothing in the output directory when a conversion fails, and names the clip', async () => {
    const out = await tempDir();
    const stale = join(out, `${PLACEHOLDER_CLIPS[0]?.clip}.m4a`);
    await writeFile(stale, 'stale but whole');
    const second = PLACEHOLDER_CLIPS[1]?.clip as string;
    const result = await generatePlaceholderClips(out, converter(second));
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(second) },
    });
    expect(await readdir(out)).toEqual([`${PLACEHOLDER_CLIPS[0]?.clip}.m4a`]);
    expect(await readFile(stale, 'utf8')).toBe('stale but whole');
  });
});
