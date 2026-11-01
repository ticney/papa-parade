import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { SAMPLE_RATE_HZ } from './synthKit.ts';

// Turns a generated music take into a game loop (story 7.6): decode, keep whole bars (or a length, for
// a loop with no pulse), fold the audio just past the cut into the start with an equal-power fade, set
// the level, encode. The same recipe on two stems gives them the same number of frames, which is what
// keeps them together; a browser's AAC decode still has to be checked on a device. macOS only
// (`afconvert`), like `makePlaceholderAudio.ts`; CI never runs it.

const BEATS_PER_BAR = 4;
const MS_PER_S = 1000;
const INT16_MAX = 32_767;
const INT16_MIN = -32_768;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_CHUNK_MIN_BYTES = 16;
const WAV_FORMAT_PCM = 1;
const WAV_FORMAT_EXTENSIBLE = 0xfffe;
/** A peak this close to full scale may have been clamped. */
const CLIPPING_PEAK_DBFS = -0.01;

const fail = (message: string): Result<never, AppError> => err({ kind: 'assets', message });

export interface Pcm {
  readonly sampleRateHz: number;
  readonly channels: number;
  /** Interleaved. */
  readonly samples: Int16Array;
}

/** Reads a 16-bit PCM WAV, whatever other chunks `afconvert` wrote around its `data`. */
export function parseWav(bytes: Buffer): Result<Pcm, AppError> {
  if (
    bytes.length < RIFF_HEADER_BYTES ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WAVE'
  ) {
    return fail('not a RIFF WAV file');
  }
  let channels = 0;
  let sampleRateHz = 0;
  let bits = 0;
  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + CHUNK_HEADER_BYTES;
    if (id === 'fmt ') {
      if (size < FMT_CHUNK_MIN_BYTES || body + FMT_CHUNK_MIN_BYTES > bytes.length) {
        return fail('truncated fmt chunk in the WAV file');
      }
      const format = bytes.readUInt16LE(body);
      if (format !== WAV_FORMAT_PCM && format !== WAV_FORMAT_EXTENSIBLE) {
        return fail(`expected PCM, got WAV format ${String(format)}`);
      }
      channels = bytes.readUInt16LE(body + 2);
      sampleRateHz = bytes.readUInt32LE(body + 4);
      bits = bytes.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== BYTES_PER_SAMPLE * 8 || channels === 0) {
        return fail(`expected 16-bit PCM, got ${String(bits)} bits, ${String(channels)} channels`);
      }
      const end = Math.min(body + size, bytes.length);
      const samples = new Int16Array((end - body) / BYTES_PER_SAMPLE);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = bytes.readInt16LE(body + i * BYTES_PER_SAMPLE);
      }
      return ok({ sampleRateHz, channels, samples });
    }
    // RIFF chunks are padded to an even size.
    offset = body + size + (size % 2);
  }
  return fail('no data chunk in the WAV file');
}

export function encodePcmWav(pcm: Pcm): Buffer {
  const dataBytes = pcm.samples.length * BYTES_PER_SAMPLE;
  const out = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(WAV_HEADER_BYTES - CHUNK_HEADER_BYTES + dataBytes, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(pcm.channels, 22);
  out.writeUInt32LE(pcm.sampleRateHz, 24);
  out.writeUInt32LE(pcm.sampleRateHz * pcm.channels * BYTES_PER_SAMPLE, 28);
  out.writeUInt16LE(pcm.channels * BYTES_PER_SAMPLE, 32);
  out.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.samples.length; i += 1) {
    out.writeInt16LE(pcm.samples[i] ?? 0, WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE);
  }
  return out;
}

/** How many frames whole bars of 4/4 last. */
export function framesOfBars(bars: number, bpm: number, sampleRateHz: number): number {
  return Math.round(((bars * BEATS_PER_BAR * 60) / bpm) * sampleRateHz);
}

/**
 * Keeps `loopFrames` frames at `gainDb` and mixes the audio just past the cut into the start, with an
 * equal-power fade: the end of the loop runs on into its own continuation, so the seam has no step.
 * The fade can add 3 dB, so the mix and the gain happen before anything is rounded or clamped.
 */
export function cutLoop(
  pcm: Pcm,
  loopFrames: number,
  crossfadeMs: number,
  gainDb = 0,
): Result<Pcm, AppError> {
  const { channels, samples, sampleRateHz } = pcm;
  const crossfadeFrames = Math.round((crossfadeMs / MS_PER_S) * sampleRateHz);
  const framesNeeded = loopFrames + crossfadeFrames;
  if (loopFrames <= 0 || crossfadeFrames < 0 || crossfadeFrames > loopFrames) {
    return fail(`bad cut: ${String(loopFrames)} frames, ${String(crossfadeFrames)} of crossfade`);
  }
  if (samples.length < framesNeeded * channels) {
    return fail(
      `the take is too short: ${String(samples.length / channels)} frames, the cut needs ${String(framesNeeded)}`,
    );
  }
  const gain = 10 ** (gainDb / 20);
  const out = new Int16Array(loopFrames * channels);
  for (let frame = 0; frame < loopFrames; frame += 1) {
    const phase =
      frame < crossfadeFrames ? (0.5 * Math.PI * frame) / crossfadeFrames : 0.5 * Math.PI;
    for (let channel = 0; channel < channels; channel += 1) {
      const head = samples[frame * channels + channel] ?? 0;
      const tail =
        frame < crossfadeFrames ? (samples[(loopFrames + frame) * channels + channel] ?? 0) : 0;
      out[frame * channels + channel] = clampInt16(
        (head * Math.sin(phase) + tail * Math.cos(phase)) * gain,
      );
    }
  }
  return ok({ sampleRateHz, channels, samples: out });
}

/**
 * Mixes down or copies to the channels asked for. `afconvert -c 1` is no downmix: it keeps the left
 * channel, with or without `--mix` (found in the review of story 7.6).
 */
export function toChannels(pcm: Pcm, channels: 1 | 2): Pcm {
  if (pcm.channels === channels) return pcm;
  const frames = Math.floor(pcm.samples.length / pcm.channels);
  const out = new Int16Array(frames * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < pcm.channels; channel += 1) {
      sum += pcm.samples[frame * pcm.channels + channel] ?? 0;
    }
    const mixed = clampInt16(sum / pcm.channels);
    for (let channel = 0; channel < channels; channel += 1) out[frame * channels + channel] = mixed;
  }
  return { sampleRateHz: pcm.sampleRateHz, channels, samples: out };
}

/** Drops the start of a take: the model may fade in, whatever the prompt asks. */
export function skipStart(pcm: Pcm, startMs: number): Pcm {
  const frames = Math.round((startMs / MS_PER_S) * pcm.sampleRateHz);
  return { ...pcm, samples: pcm.samples.subarray(frames * pcm.channels) };
}

const clampInt16 = (value: number): number =>
  Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value)));

export function peakDbfs(samples: Int16Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(peak / -INT16_MIN);
}

export interface CutOptions {
  readonly source: string;
  readonly out: string;
  /** Whole bars of 4/4 at `bpm`, or `lengthMs` for a loop with no pulse. */
  readonly bars?: number;
  readonly bpm?: number;
  readonly lengthMs?: number;
  /** Where in the take the loop begins; 0 when absent. */
  readonly startMs?: number;
  readonly crossfadeMs: number;
  readonly gainDb: number;
  readonly bitrateBps: number;
  readonly channels: 1 | 2;
}

const USAGE =
  'usage: tsx tools/audio/cutMusicLoop.ts <source> <out.m4a> (--bars <n> --bpm <n> | --length-ms <n>) [--start-ms <n>] --crossfade-ms <n> --gain-db <n> --bitrate-bps <n> --channels <1|2>';

const NUMERIC_FLAGS = [
  '--bars',
  '--bpm',
  '--length-ms',
  '--start-ms',
  '--crossfade-ms',
  '--gain-db',
  '--bitrate-bps',
  '--channels',
];

export function parseArgs(args: readonly string[]): Result<CutOptions, AppError> {
  const [source, out, ...flags] = args;
  if (source === undefined || out === undefined) return fail(USAGE);
  const values = new Map<string, number>();
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i] ?? '';
    const text = flags[i + 1];
    if (!NUMERIC_FLAGS.includes(flag)) return fail(`unknown flag ${flag}. ${USAGE}`);
    if (values.has(flag)) return fail(`${flag} is given twice. ${USAGE}`);
    if (text === undefined || text.trim() === '' || !Number.isFinite(Number(text))) {
      return fail(`${flag} needs a number. ${USAGE}`);
    }
    values.set(flag, Number(text));
  }
  const crossfadeMs = values.get('--crossfade-ms');
  const gainDb = values.get('--gain-db');
  const bitrateBps = values.get('--bitrate-bps');
  const channels = values.get('--channels');
  const bars = values.get('--bars');
  const bpm = values.get('--bpm');
  const lengthMs = values.get('--length-ms');
  const startMs = values.get('--start-ms');
  const hasBars = bars !== undefined && bpm !== undefined;
  const hasLength = lengthMs !== undefined;
  if (
    crossfadeMs === undefined ||
    gainDb === undefined ||
    bitrateBps === undefined ||
    (channels !== 1 && channels !== 2) ||
    hasBars === hasLength ||
    (hasLength && (bars !== undefined || bpm !== undefined))
  ) {
    return fail(USAGE);
  }
  const isBadCut = hasBars
    ? !Number.isInteger(bars) || bars <= 0 || bpm <= 0
    : (lengthMs ?? 0) <= 0;
  if (isBadCut || crossfadeMs < 0 || bitrateBps <= 0 || (startMs !== undefined && startMs < 0)) {
    return fail(
      `a length, tempo or bitrate must be positive, whole bars, no negative time. ${USAGE}`,
    );
  }
  return ok({
    source,
    out,
    crossfadeMs,
    gainDb,
    bitrateBps,
    channels,
    ...(hasBars ? { bars, bpm } : {}),
    ...(hasLength ? { lengthMs } : {}),
    ...(startMs !== undefined ? { startMs } : {}),
  });
}

function run(args: readonly string[]): Promise<Result<void, AppError>> {
  return new Promise((resolve) => {
    const child = spawn('afconvert', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (cause) => resolve(fail(`afconvert failed: ${cause.message}`)));
    child.on('close', (code) =>
      resolve(
        code === 0
          ? ok(undefined)
          : fail(`afconvert failed (exit ${String(code)}): ${output.trim()}. It needs macOS.`),
      ),
    );
  });
}

export async function cutMusicLoop(
  options: CutOptions,
): Promise<Result<{ frames: number; peakDbfs: number }, AppError>> {
  const work = await mkdtemp(join(tmpdir(), 'pp-music-'));
  try {
    const decodedPath = join(work, 'decoded.wav');
    const decoded = await run([
      '-f',
      'WAVE',
      '-d',
      `LEI16@${String(SAMPLE_RATE_HZ)}`,
      options.source,
      decodedPath,
    ]);
    if (!decoded.ok) return decoded;
    const pcm = parseWav(await readFile(decodedPath));
    if (!pcm.ok) return pcm;
    const loopFrames =
      options.lengthMs !== undefined
        ? Math.round((options.lengthMs / MS_PER_S) * SAMPLE_RATE_HZ)
        : framesOfBars(options.bars ?? 0, options.bpm ?? 1, SAMPLE_RATE_HZ);
    const cut = cutLoop(
      skipStart(toChannels(pcm.value, options.channels), options.startMs ?? 0),
      loopFrames,
      options.crossfadeMs,
      options.gainDb,
    );
    if (!cut.ok) return cut;
    const loop = cut.value;
    const loopPath = join(work, 'loop.wav');
    await writeFile(loopPath, encodePcmWav(loop));
    const encoded = await run([
      '-f',
      'm4af',
      '-d',
      'aac',
      '-b',
      String(options.bitrateBps),
      loopPath,
      options.out,
    ]);
    if (!encoded.ok) return encoded;
    // Of the samples sent to the encoder: AAC can overshoot it a little.
    const peak = peakDbfs(loop.samples);
    if (peak >= CLIPPING_PEAK_DBFS) {
      log.warn('assets', 'the loop reaches full scale and may be clipped: lower --gain-db', {
        out: options.out,
      });
    }
    return ok({ frames: loopFrames, peakDbfs: peak });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.ok) {
    log.error('assets', options.error.message);
    process.exitCode = 1;
    return;
  }
  const result = await cutMusicLoop(options.value);
  if (!result.ok) {
    log.error('assets', result.error.message);
    process.exitCode = 1;
    return;
  }
  log.info('assets', 'music loop written', { out: options.value.out, ...result.value });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
