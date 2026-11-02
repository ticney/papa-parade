import { describe, expect, it } from 'vitest';
import {
  cutLoop,
  encodePcmWav,
  framesOfBars,
  type Pcm,
  parseArgs,
  parseWav,
  peakDbfs,
  skipStart,
  toChannels,
} from '../../../tools/audio/cutMusicLoop.ts';

// The tool that turns a generated take into a game loop (story 7.6).
const stereo = (frames: number, value: (frame: number) => number): Pcm => {
  const samples = new Int16Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    samples[frame * 2] = value(frame);
    samples[frame * 2 + 1] = -value(frame);
  }
  return { sampleRateHz: 1000, channels: 2, samples };
};

describe('framesOfBars', () => {
  it('gives the 36 s of the trial for 12 bars at 80 BPM', () => {
    expect(framesOfBars(12, 80, 44_100)).toBe(1_587_600);
  });
});

describe('cutLoop', () => {
  it('keeps exactly the frames asked for, so that two stems cut alike never drift', () => {
    const cut = cutLoop(
      stereo(200, () => 100),
      150,
      10,
    );
    expect(cut.ok && cut.value.samples.length).toBe(300);
  });

  it('starts on the audio just past the cut and ends the fade on the take', () => {
    const cut = cutLoop(
      stereo(200, (frame) => (frame < 150 ? 1000 : 2000)),
      150,
      10,
    );
    if (!cut.ok) throw new Error(cut.error.message);
    expect(cut.value.samples[0]).toBe(2000);
    expect(cut.value.samples[1]).toBe(-2000);
    expect(cut.value.samples[20]).toBe(1000);
    expect(cut.value.samples[299]).toBe(-1000);
  });

  it('refuses a take too short for the cut plus its crossfade', () => {
    const cut = cutLoop(
      stereo(155, () => 1),
      150,
      10,
    );
    expect(cut.ok).toBe(false);
    if (!cut.ok) expect(cut.error.message).toContain('too short');
  });

  it('does not change the source', () => {
    const pcm = stereo(200, (frame) => frame);
    const before = pcm.samples.slice();
    cutLoop(pcm, 150, 10);
    expect(pcm.samples).toEqual(before);
  });
});

describe('skipStart', () => {
  it('starts the take later, on a whole frame, for a take that fades in', () => {
    const pcm = skipStart(
      stereo(10, (frame) => frame),
      3,
    );
    expect(pcm.samples.length).toBe(14);
    expect(pcm.samples[0]).toBe(3);
    expect(pcm.samples[1]).toBe(-3);
  });

  it('leaves too little for the cut, which then refuses', () => {
    const cut = cutLoop(
      skipStart(
        stereo(200, () => 1),
        100,
      ),
      150,
      10,
    );
    expect(cut.ok).toBe(false);
  });
});

describe('the gain of cutLoop', () => {
  it('lowers the level by the gain', () => {
    const cut = cutLoop(
      stereo(100, () => 16_384),
      50,
      0,
      -6,
    );
    expect(cut.ok && peakDbfs(cut.value.samples)).toBeCloseTo(-12, 0);
  });

  it('clamps rather than wraps', () => {
    const cut = cutLoop(
      stereo(100, () => 30_000),
      50,
      0,
      12,
    );
    if (!cut.ok) throw new Error(cut.error.message);
    expect(cut.value.samples[0]).toBe(32_767);
    expect(cut.value.samples[1]).toBe(-32_768);
  });

  it('leaves room for the +3 dB of the fade: a later gain keeps no flat top', () => {
    const cut = cutLoop(
      stereo(400, () => 30_000),
      200,
      100,
      -6,
    );
    if (!cut.ok) throw new Error(cut.error.message);
    const peak = Math.max(...cut.value.samples);
    // 30000 × √2 × 0.5 at the middle of the fade, not 32767 × 0.5.
    expect(peak).toBeGreaterThan(21_000);
    expect(peak).toBeLessThan(21_300);
  });
});

describe('toChannels', () => {
  it('mixes both channels down: `afconvert -c 1` would keep the left one alone', () => {
    const pcm: Pcm = {
      sampleRateHz: 1000,
      channels: 2,
      samples: new Int16Array([1000, 0, 0, 1000, 500, 500, 1000, -1000]),
    };
    expect([...toChannels(pcm, 1).samples]).toEqual([500, 500, 500, 0]);
  });

  it('copies a mono source to both channels', () => {
    const pcm: Pcm = { sampleRateHz: 1000, channels: 1, samples: new Int16Array([7, 8]) };
    expect([...toChannels(pcm, 2).samples]).toEqual([7, 7, 8, 8]);
  });

  it('leaves the right layout alone', () => {
    const pcm = stereo(4, (frame) => frame);
    expect(toChannels(pcm, 2)).toBe(pcm);
  });
});

describe('the WAV round trip', () => {
  it('reads what it writes', () => {
    const pcm = stereo(8, (frame) => frame * 100);
    const parsed = parseWav(encodePcmWav(pcm));
    expect(parsed).toEqual({ ok: true, value: pcm });
  });

  it('skips the chunks around the data, padding included', () => {
    const wav = encodePcmWav(stereo(2, () => 7));
    const extra = Buffer.from('LIST\x03\x00\x00\x00abc\x00', 'latin1');
    const parsed = parseWav(Buffer.concat([wav.subarray(0, 36), extra, wav.subarray(36)]));
    expect(parsed.ok && parsed.value.samples.length).toBe(4);
  });

  it('refuses a file that is not a WAV', () => {
    expect(parseWav(Buffer.from('not audio at all')).ok).toBe(false);
    expect(parseWav(Buffer.from('RIFF\0\0\0\0AVI LIST', 'latin1')).ok).toBe(false);
  });

  it('refuses a truncated format chunk with an error, not a throw', () => {
    const wav = encodePcmWav(stereo(2, () => 7));
    expect(parseWav(wav.subarray(0, 24)).ok).toBe(false);
  });

  it('refuses a format that is not PCM', () => {
    const wav = Buffer.from(encodePcmWav(stereo(2, () => 7)));
    wav.writeUInt16LE(3, 20);
    expect(parseWav(wav).ok).toBe(false);
  });
});

describe('parseArgs', () => {
  const common = ['--crossfade-ms', '50', '--gain-db', '-2', '--bitrate-bps', '96000'];

  it('takes bars and a tempo', () => {
    const parsed = parseArgs([
      'in.mp3',
      'out.m4a',
      '--bars',
      '12',
      '--bpm',
      '80',
      ...common,
      '--channels',
      '2',
    ]);
    expect(parsed.ok && parsed.value.bars).toBe(12);
  });

  it('takes a length, for a loop with no pulse', () => {
    const parsed = parseArgs([
      'in.mp3',
      'out.m4a',
      '--length-ms',
      '30000',
      ...common,
      '--channels',
      '1',
    ]);
    expect(parsed.ok && parsed.value.lengthMs).toBe(30_000);
  });

  it('refuses what would silently give a wrong cut', () => {
    const ok = ['--length-ms', '30000', ...common, '--channels', '1'];
    const refused = (...extra: string[]) => parseArgs(['a', 'b', ...ok, ...extra]).ok;
    expect(parseArgs(['a', 'b', ...ok]).ok).toBe(true);
    expect(refused('--start_ms', '8000')).toBe(false);
    expect(refused('--start-ms', '-1000')).toBe(false);
    expect(refused('--start-ms', '')).toBe(false);
    expect(refused('--bars', '12')).toBe(false);
    expect(refused('--gain-db', '-3')).toBe(false);
    const bars = (b: string, bpm: string) =>
      parseArgs(['a', 'b', '--bars', b, '--bpm', bpm, ...common, '--channels', '1']).ok;
    expect(bars('12', '80')).toBe(true);
    expect(bars('12', '0')).toBe(false);
    expect(bars('-4', '-80')).toBe(false);
    expect(bars('1.5', '80')).toBe(false);
  });

  it('refuses both a length and bars, neither, and a bad channel count', () => {
    const both = ['--bars', '12', '--bpm', '80', '--length-ms', '30000'];
    expect(parseArgs(['a', 'b', ...both, ...common, '--channels', '1']).ok).toBe(false);
    expect(parseArgs(['a', 'b', ...common, '--channels', '1']).ok).toBe(false);
    expect(parseArgs(['a', 'b', '--length-ms', '1', ...common, '--channels', '3']).ok).toBe(false);
  });
});
