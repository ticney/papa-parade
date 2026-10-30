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
  parseOnly,
  SAMPLE_RATE_HZ,
  synthBabble,
  synthBabyLaugh,
  synthBump,
  synthCalibrationBeep,
  synthComboCashIn,
  synthDoorSlam,
  synthFirm,
  synthGagCoffeeTable,
  synthGagOutlet,
  synthGagPapaAsleep,
  synthGagSilence,
  synthGagStairs,
  synthHeartbeat,
  synthMusic,
  synthMusicTense,
  synthParry,
  synthPhoneAnswer,
  synthStarLost,
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
  // Every clip is synthesized twice: the time grows with each clip added to the table, and a CI run
  // under coverage on a busy machine went past the default 5 s.
  it('is deterministic', () => {
    for (const { synth } of PLACEHOLDER_CLIPS) expect(synth()).toEqual(synth());
  }, 30_000);

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

  it('has the lengths of the outlet clips: 300 and 500 ms', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthTelegraph())).toBeCloseTo(300, 0);
    expect(ms(synthGagOutlet())).toBeCloseTo(500, 0);
  });

  it('lists the outlet clips and the cult sounds by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of [
      'tel_outlet',
      'gag_outlet',
      'resp_parry',
      'resp_firm',
      'baby_laugh_perfect',
    ]) {
      expect(names, clip).toContain(clip);
    }
    // Story 2.3 D2: the perfect plays the success's clip, its sparkle chime is gone.
    expect(names).not.toContain('resp_parry_perfect');
  });

  describe('the cult sounds (story 2.3)', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;

    it('has the lengths of the recipes: a 200-260 ms squeak, a 100-160 ms clack, a 700-900 ms laugh', () => {
      expect(ms(synthParry())).toBeGreaterThanOrEqual(200);
      expect(ms(synthParry())).toBeLessThanOrEqual(260);
      expect(ms(synthFirm())).toBeGreaterThanOrEqual(100);
      expect(ms(synthFirm())).toBeLessThanOrEqual(160);
      expect(ms(synthBabyLaugh())).toBeGreaterThanOrEqual(700);
      expect(ms(synthBabyLaugh())).toBeLessThanOrEqual(900);
    });

    it('makes the squeak rise then fall: it spends more time above 2 kHz-ish pitch in the middle than at the ends', () => {
      // Zero crossings per window are a cheap pitch meter: the squeak turns at about a third of its length.
      const samples = synthParry();
      const rate = (from: number, to: number): number => {
        let crossings = 0;
        for (let i = Math.max(1, from); i < to; i++) {
          if ((samples[i - 1] as number) < 0 !== (samples[i] as number) < 0) crossings++;
        }
        return crossings / ((to - from) / SAMPLE_RATE_HZ) / 2;
      };
      const window = Math.round(0.03 * SAMPLE_RATE_HZ);
      const start = rate(
        Math.round(0.01 * SAMPLE_RATE_HZ),
        Math.round(0.01 * SAMPLE_RATE_HZ) + window,
      );
      const turn = rate(
        Math.round(0.07 * SAMPLE_RATE_HZ),
        Math.round(0.07 * SAMPLE_RATE_HZ) + window,
      );
      const end = rate(
        samples.length - Math.round(0.06 * SAMPLE_RATE_HZ),
        samples.length - Math.round(0.03 * SAMPLE_RATE_HZ),
      );
      expect(turn).toBeGreaterThan(start);
      expect(turn).toBeGreaterThan(end);
    });

    it('laughs in 4 to 6 syllables: bursts of energy over a 10 ms RMS envelope', () => {
      const samples = synthBabyLaugh();
      const window = Math.round(0.01 * SAMPLE_RATE_HZ);
      const rms: number[] = [];
      for (let from = 0; from + window <= samples.length; from += window) {
        let sum = 0;
        for (let i = from; i < from + window; i++) sum += (samples[i] as number) ** 2;
        rms.push(Math.sqrt(sum / window));
      }
      const loudest = Math.max(...rms);
      // A burst starts when the envelope rises above 35 % of the loudest window and ends under 15 %,
      // so the breathy inhale at the end (a fifth of the voice) and ripples inside a syllable do not count.
      let bursts = 0;
      let isLoud = false;
      for (const value of rms) {
        if (!isLoud && value > 0.35 * loudest) {
          isLoud = true;
          bursts++;
        } else if (isLoud && value < 0.15 * loudest) {
          isLoud = false;
        }
      }
      expect(bursts).toBeGreaterThanOrEqual(4);
      expect(bursts).toBeLessThanOrEqual(6);
    });
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

  describe('the calibration beep (story 2.7)', () => {
    it('is in the table once, by the name the feedback table uses', () => {
      const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
      expect(names.filter((name) => name === 'ui_calibration_beep')).toHaveLength(1);
    });

    it('is short, and its onset is sharp: full level within 2 ms', () => {
      const beep = synthCalibrationBeep();
      expect((beep.length / SAMPLE_RATE_HZ) * 1000).toBeCloseTo(90, 0);
      const early = beep.slice(0, Math.round((2 * SAMPLE_RATE_HZ) / 1000));
      expect(peakOf(early)).toBeGreaterThan(0.6 * peakOf(beep));
    });

    it('starts and ends on silence, and gives the same bytes on two runs', () => {
      const beep = synthCalibrationBeep();
      expect(beep[0]).toBe(0);
      expect(beep[beep.length - 1]).toBe(0);
      expect(encodeWav(beep).equals(encodeWav(synthCalibrationBeep()))).toBe(true);
    });
  });

  it('has the lengths of the Mama-woke clips: a 400 ms door slam and a 180 ms falling blip', () => {
    const ms = (samples: Float32Array): number => (samples.length / SAMPLE_RATE_HZ) * 1000;
    expect(ms(synthDoorSlam())).toBeCloseTo(400, 0);
    expect(ms(synthStarLost())).toBeCloseTo(180, 0);
    expect(synthStarLost()).not.toEqual(synthStarStamp());
  });

  it('lists the two Mama-woke clips by the names the feedback table uses', () => {
    const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
    for (const clip of ['env_door_slam', 'ui_star_lost']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('has a 520 ms combo cash-in clip, listed by the name the feedback table uses', () => {
    expect(synthComboCashIn().length / SAMPLE_RATE_HZ).toBeCloseTo(0.52, 2);
    expect(PLACEHOLDER_CLIPS.map(({ clip }) => clip)).toContain('ui_combo_cash_in');
    expect(synthComboCashIn()).not.toEqual(
      synthStarStampLast().slice(0, synthComboCashIn().length),
    );
  });

  describe('the heartbeat (story 2.9)', () => {
    it('is in the table once, as a papa_ clip, right after the toilet door', () => {
      const clips = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
      expect(clips.filter((clip) => clip === 'papa_heartbeat')).toHaveLength(1);
      expect(clips.indexOf('papa_heartbeat')).toBe(clips.indexOf('papa_toilet_door') + 1);
    });

    it('lasts about 3 s, fades out, starts and ends on silence and gives the same bytes twice', () => {
      const beat = synthHeartbeat();
      expect(beat.length / SAMPLE_RATE_HZ).toBeCloseTo(3, 1);
      expect(beat[0]).toBe(0);
      expect(beat[beat.length - 1]).toBe(0);
      expect(synthHeartbeat()).toEqual(beat);
      expect(peakOf(beat)).toBeLessThanOrEqual(0.45 + 1e-6);
      // Each second is quieter than the one before.
      const third = Math.floor(beat.length / 3);
      const peaks = [0, 1, 2].map((part) => peakOf(beat.slice(part * third, (part + 1) * third)));
      expect(peaks[0]).toBeGreaterThan(peaks[1] as number);
      expect(peaks[1]).toBeGreaterThan(peaks[2] as number);
    });

    it('thumps twice in each one-second beat: a lub, a quieter dub, then silence', () => {
      const beat = synthHeartbeat();
      const windowOf = (fromMs: number, toMs: number) =>
        peakOf(
          beat.slice(
            Math.round((fromMs / 1000) * SAMPLE_RATE_HZ),
            Math.round((toMs / 1000) * SAMPLE_RATE_HZ),
          ),
        );
      const lub = windowOf(0, 200);
      const dub = windowOf(280, 480);
      const rest = windowOf(700, 990);
      expect(lub).toBeGreaterThan(dub);
      expect(dub).toBeGreaterThan(rest * 5);
    });
  });

  it('makes each telegraph and each gag sound unlike the others (no two clips are alike)', () => {
    // The largest normalised dot product between two clips, over their common length and for every
    // shift of one against the other up to `LAG_MAX_MS`: a clip that sounded like another, or like
    // a copy of it started a little later, would correlate with it. Two unrelated sounds stay far from 1.
    const lagMax = Math.round((LAG_MAX_MS * SAMPLE_RATE_HZ) / 1000);
    // Story 2.3: the responses and the laugh too (the squeak and the clack must not correlate). The
    // babble loop is 6 s long and is no cue sound: it would make the sweep slow for nothing.
    const clips = PLACEHOLDER_CLIPS.filter(
      ({ clip }) => /^(tel|gag|resp|baby)_/.test(clip) && !clip.endsWith('_loop'),
    ).map(({ clip, synth }) => ({ clip, samples: synth() }));
    expect(clips.map(({ clip }) => clip)).toEqual(
      expect.arrayContaining([
        'resp_parry',
        'resp_firm',
        'baby_laugh_perfect',
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

  describe('the tense music stem (story 2.6)', () => {
    it('is in the table once, right after the calm stem', () => {
      const names = PLACEHOLDER_CLIPS.map(({ clip }) => clip);
      expect(names.filter((name) => name === 'music_crawler_tense')).toHaveLength(1);
      expect(names.indexOf('music_crawler_tense')).toBe(names.indexOf('music_crawler_calm') + 1);
    });

    it('is exactly as long as the calm stem, in samples: the loops never drift', () => {
      expect(synthMusicTense().length).toBe(synthMusic().length);
    });

    it('is not the calm stem, and is normalised to the same peak', () => {
      const tense = synthMusicTense();
      expect(tense).not.toEqual(synthMusic());
      expect(peakOf(tense)).toBeCloseTo(peakOf(synthMusic()), 5);
    });

    it('gives the same bytes on two runs', () => {
      expect(encodeWav(synthMusicTense()).equals(encodeWav(synthMusicTense()))).toBe(true);
    });

    it('plays its notes on the calm stem grid: a note starts on every calm step', () => {
      const calm = synthMusic();
      const tense = synthMusicTense();
      const calmStep = Math.floor(calm.length / 21);
      for (let n = 1; n < 21; n++) {
        // The attack is a ramp from silence: the sample just before a step is quiet, the one a few
        // samples in is not.
        const before = Math.abs(tense[n * calmStep - 1] as number);
        const after = Math.abs(tense[n * calmStep + 40] as number);
        expect(after, `step ${n}`).toBeGreaterThan(before);
      }
    });
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

describe('parseOnly', () => {
  const known = ['resp_parry', 'resp_firm', 'baby_laugh_perfect'];

  it('returns null when there is no --only: today\'s "all or none" behaviour', () => {
    expect(parseOnly(['node', 'makePlaceholderAudio.ts'], known)).toEqual(ok(null));
  });

  it('reads a comma-separated list, as `--only a,b` or `--only=a,b`', () => {
    expect(parseOnly(['node', 'x', '--only', 'resp_parry,resp_firm'], known)).toEqual(
      ok(['resp_parry', 'resp_firm']),
    );
    expect(parseOnly(['node', 'x', '--only=baby_laugh_perfect'], known)).toEqual(
      ok(['baby_laugh_perfect']),
    );
  });

  it('refuses an unknown name and lists the known ones', () => {
    const result = parseOnly(['node', 'x', '--only', 'resp_parry,resp_nope'], known);
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('resp_nope') },
    });
    if (!result.ok) for (const name of known) expect(result.error.message).toContain(name);
  });

  it.each([
    ['no value', ['node', 'x', '--only']],
    ['an empty value', ['node', 'x', '--only=']],
    ['an empty name', ['node', 'x', '--only', 'resp_parry,,resp_firm']],
  ])('refuses %s', (_name, argv) => {
    expect(parseOnly(argv, known).ok).toBe(false);
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

  it('writes only the clips it is asked for with `only`, and leaves the others alone (story 2.3 AC 15)', async () => {
    const out = await tempDir();
    const other = join(out, 'tel_outlet.m4a');
    await writeFile(other, 'recorded by Geo');
    const result = await generatePlaceholderClips(out, converter(), ['resp_parry', 'resp_firm']);
    expect(result.ok).toBe(true);
    expect((await readdir(out)).sort()).toEqual([
      'resp_firm.m4a',
      'resp_parry.m4a',
      'tel_outlet.m4a',
    ]);
    expect(await readFile(other, 'utf8')).toBe('recorded by Geo');
  });

  it('refuses an unknown clip name in `only`, lists the known ones and writes nothing', async () => {
    const out = await tempDir();
    const result = await generatePlaceholderClips(out, converter(), ['resp_parry', 'resp_nope']);
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('resp_nope') },
    });
    if (!result.ok) expect(result.error.message).toContain('baby_laugh_perfect');
    expect(await readdir(out)).toEqual([]);
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
