import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { createRng, nextFloat, type RngState } from '@shared/rng';
import { ROOT } from '../assets/paths.ts';

// The three provisional sounds of story 1.9, synthesized so that the whole audio pipeline works
// end to end with no human (golden rule). Real sounds replace the `.m4a` files under the same
// names (stories 2.3 and 7.5). The tool is macOS only (`afconvert`) and CI never runs it.

export const SAMPLE_RATE_HZ = 44_100;
export const AAC_BITRATE_BPS = 64_000;
const SEED = 0x9a9a;

/** Fade at both ends of a loop so the loop point does not click, in ms. */
const LOOP_FADE_MS = 5;
/** Loudest sample of the babble and the bump, as a share of full scale (-6 dBFS is 0.501). */
const PEAK_LOUD = 0.45;
/** Loudest sample of the music: around -12 dBFS. */
const PEAK_MUSIC = 0.25;

const BABBLE_LENGTH_S = 6;
const BABBLE_BURST_MS = { min: 120, max: 220 };
const BABBLE_GAP_MS = { min: 30, max: 140 };
const BABBLE_PITCH_HZ = { min: 300, max: 450 };
const BABBLE_VIBRATO_HZ = 6;
const BABBLE_VIBRATO_DEPTH = 0.03;
const BABBLE_ATTACK_MS = 10;
const BABBLE_RELEASE_MS = 40;
/** Level of the second harmonic against the first: a vowel-ish colour. */
const BABBLE_HARMONIC_GAIN = 0.4;

const MUSIC_LENGTH_S = 8;
/** 21 eighth notes in 8 s: a quarter note lasts 0.76 s, about 79 BPM. */
const MUSIC_STEPS = 21;
/** C major pentatonic from C4: C D E G A, then the same an octave up. */
const MUSIC_SCALE_HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0];
const MUSIC_ATTACK_MS = 5;
const MUSIC_DECAY_S = 0.22;
const MUSIC_RELEASE_MS = 30;

const BUMP_LENGTH_MS = 150;
const BUMP_PITCH_HZ = { from: 180, to: 80 };
const BUMP_ATTACK_MS = 2;
const BUMP_DECAY_S = 0.05;
const BUMP_RELEASE_MS = 5;

const samplesOf = (ms: number): number => Math.round((ms / 1000) * SAMPLE_RATE_HZ);
const between = (rng: RngState, range: { min: number; max: number }): number =>
  range.min + nextFloat(rng) * (range.max - range.min);

/** Scales `samples` so that the loudest one is `peak`. */
function normalize(samples: Float32Array, peak: number): void {
  let loudest = 0;
  for (const value of samples) loudest = Math.max(loudest, Math.abs(value));
  if (loudest === 0) return;
  const gain = peak / loudest;
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] as number) * gain;
}

/** Linear fade in over the first and out over the last `fadeMs`: the buffer starts and ends at zero. */
function fadeEnds(samples: Float32Array, fadeMs: number): void {
  const fade = samplesOf(fadeMs);
  for (let i = 0; i < fade && i < samples.length; i++) {
    const gain = i / fade;
    samples[i] = (samples[i] as number) * gain;
    const last = samples.length - 1 - i;
    samples[last] = (samples[last] as number) * gain;
  }
  samples[0] = 0;
  samples[samples.length - 1] = 0;
}

/** Playful « ba-ba-da-ga » syllables, never more than a short gap apart: the loop is not a silence. */
export function synthBabble(): Float32Array {
  const rng = createRng(SEED);
  const out = new Float32Array(samplesOf(BABBLE_LENGTH_S * 1000));
  let cursor = samplesOf(10);
  while (cursor < out.length - samplesOf(BABBLE_BURST_MS.min)) {
    const burst = Math.min(
      samplesOf(between(rng, BABBLE_BURST_MS)),
      out.length - samplesOf(10) - cursor,
    );
    const pitchHz = between(rng, BABBLE_PITCH_HZ);
    const glide = 0.9 + nextFloat(rng) * 0.2;
    const attack = samplesOf(BABBLE_ATTACK_MS);
    const release = samplesOf(BABBLE_RELEASE_MS);
    let phase = 0;
    for (let i = 0; i < burst; i++) {
      const progress = i / burst;
      const vibrato =
        1 + BABBLE_VIBRATO_DEPTH * Math.sin((2 * Math.PI * BABBLE_VIBRATO_HZ * i) / SAMPLE_RATE_HZ);
      const frequencyHz = pitchHz * (1 + (glide - 1) * progress) * vibrato;
      phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      const envelope = Math.min(1, i / attack, (burst - i) / release);
      out[cursor + i] = envelope * (Math.sin(phase) + BABBLE_HARMONIC_GAIN * Math.sin(2 * phase));
    }
    cursor += burst + samplesOf(between(rng, BABBLE_GAP_MS));
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_LOUD);
  return out;
}

/** A soft triangle-wave arpeggio on a major pentatonic. Each note dies inside its own step. */
export function synthMusic(): Float32Array {
  const rng = createRng(SEED + 1);
  const out = new Float32Array(samplesOf(MUSIC_LENGTH_S * 1000));
  const step = Math.floor(out.length / MUSIC_STEPS);
  let degree = 0;
  for (let n = 0; n < MUSIC_STEPS; n++) {
    // A walk on the scale: mostly one degree up or down, now and then a leap.
    const roll = nextFloat(rng);
    degree += roll < 0.4 ? 1 : roll < 0.8 ? -1 : roll < 0.9 ? 2 : -2;
    degree = Math.max(0, Math.min(MUSIC_SCALE_HZ.length - 1, degree));
    const frequencyHz = MUSIC_SCALE_HZ[degree] as number;
    const length = n === MUSIC_STEPS - 1 ? out.length - n * step : step;
    const attack = samplesOf(MUSIC_ATTACK_MS);
    const release = samplesOf(MUSIC_RELEASE_MS);
    for (let i = 0; i < length; i++) {
      const cycle = (i * frequencyHz) / SAMPLE_RATE_HZ;
      const triangle = 4 * Math.abs(cycle - Math.floor(cycle + 0.5)) - 1;
      const envelope =
        Math.min(1, i / attack, (length - i) / release) *
        Math.exp(-i / SAMPLE_RATE_HZ / MUSIC_DECAY_S);
      out[n * step + i] = triangle * envelope;
    }
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC);
  return out;
}

/** A soft low « bonk »: a sine that drops in pitch and dies fast. */
export function synthBump(): Float32Array {
  const out = new Float32Array(samplesOf(BUMP_LENGTH_MS));
  const attack = samplesOf(BUMP_ATTACK_MS);
  const release = samplesOf(BUMP_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      BUMP_PITCH_HZ.to +
      (BUMP_PITCH_HZ.from - BUMP_PITCH_HZ.to) * Math.exp(-seconds / BUMP_DECAY_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const envelope =
      Math.min(1, i / attack, (out.length - i) / release) * Math.exp(-seconds / BUMP_DECAY_S);
    out[i] = Math.sin(phase) * envelope;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A 16-bit mono PCM WAV file. */
export function encodeWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); // PCM header size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  wav.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28); // bytes per second
  wav.writeUInt16LE(2, 32); // bytes per frame
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] as number));
    wav.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return wav;
}

export const PLACEHOLDER_CLIPS: readonly { clip: string; synth: () => Float32Array }[] = [
  { clip: 'baby_babble_loop', synth: synthBabble },
  { clip: 'music_crawler_calm', synth: synthMusic },
  { clip: 'papa_bump', synth: synthBump },
];

function run(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (cause) => resolve({ code: null, output: cause.message }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** Turns one WAV file into one `.m4a`; `err` carries what to tell the user. */
export type ConvertWav = (wavPath: string, m4aPath: string) => Promise<Result<void, AppError>>;

const afconvert: ConvertWav = async (wavPath, m4aPath) => {
  const result = await run('afconvert', [
    '-f',
    'm4af',
    '-d',
    'aac',
    '-b',
    String(AAC_BITRATE_BPS),
    wavPath,
    m4aPath,
  ]);
  if (result.code === 0) return ok(undefined);
  return err({
    kind: 'assets',
    message: `afconvert failed (exit ${String(result.code)}): ${result.output.trim()}. This tool needs macOS, which ships afconvert.`,
  });
};

/**
 * Synthesizes every placeholder clip and writes the `.m4a` files into `outDir`, all or none: each
 * clip is converted into a temporary directory first, and `outDir` is touched only when every
 * conversion has succeeded, so a failure never leaves a mix of fresh, stale and truncated files
 * (which `content:check` would accept, since it only looks that a file exists).
 */
export async function generatePlaceholderClips(
  outDir: string,
  convert: ConvertWav = afconvert,
): Promise<Result<string[], AppError>> {
  const work = await mkdtemp(join(tmpdir(), 'pp-audio-'));
  try {
    for (const { clip, synth } of PLACEHOLDER_CLIPS) {
      const wavPath = join(work, `${clip}.wav`);
      await writeFile(wavPath, encodeWav(synth()));
      const converted = await convert(wavPath, join(work, `${clip}.m4a`));
      if (!converted.ok) {
        return err({ ...converted.error, message: `${clip}: ${converted.error.message}` });
      }
    }
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    for (const { clip } of PLACEHOLDER_CLIPS) {
      const target = join(outDir, `${clip}.m4a`);
      await copyFile(join(work, `${clip}.m4a`), target);
      written.push(target);
    }
    return ok(written);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const result = await generatePlaceholderClips(join(ROOT, 'public', 'assets', 'audio'));
  if (!result.ok) {
    log.error('assets', result.error.message);
    process.exitCode = 1;
    return;
  }
  for (const m4a of result.value) log.info('assets', 'placeholder clip written', { m4a });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
