import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { createRng, nextFloat, type RngState } from '@shared/rng';
import { ROOT } from '../assets/paths.ts';

// The provisional sounds of stories 1.9, 1.11, 1.16, 1.19 and 1.20 (the outlet's four cues, then the
// stairs' and the coffee table's telegraph and gag clips, then the micro-sleep's muffled swell and
// Papa's snore, then the phone's ring and Papa's pick-up click), synthesized so that the whole audio pipeline
// works end to end with no human (golden rule). Real sounds replace the `.m4a` files under the same
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

const TEL_LENGTH_MS = 300;
const TEL_PITCH_HZ = { from: 220, to: 660 };
/** Rate of the buzz's amplitude flutter, the electric part of the telegraph. */
const TEL_BUZZ_HZ = 55;
const TEL_BUZZ_DEPTH = 0.5;
const TEL_ATTACK_MS = 8;
const TEL_RELEASE_MS = 40;

const PARRY_LENGTH_MS = 150;
const PARRY_PITCH_HZ = { from: 520, to: 780 };
const PARRY_ATTACK_MS = 2;
const PARRY_DECAY_S = 0.04;
const PARRY_RELEASE_MS = 10;

const PERFECT_LENGTH_MS = 350;
/** The chime rings after the pop: two sines a fifth apart. */
const PERFECT_CHIME_HZ = [1046.5, 1568];
const PERFECT_CHIME_DELAY_MS = 60;
const PERFECT_CHIME_DECAY_S = 0.09;
const PERFECT_CHIME_GAIN = 0.7;
const PERFECT_RELEASE_MS = 25;

const GAG_LENGTH_MS = 500;
const GAG_CRACKLE_MS = 160;
/** Share of the crackle's samples that are a click, in percent. */
const GAG_CRACKLE_DENSITY_PCT = 6;
const GAG_BZZT_PITCH_HZ = { from: 420, to: 90 };
const GAG_BZZT_DECAY_S = 0.18;
const GAG_BZZT_RELEASE_MS = 40;

// Stairs telegraph: the baby's knees and hands pattering faster and faster (4 gaps, each shorter).
const TEL_STAIRS_LENGTH_MS = 400;
const TEL_STAIRS_KNOCKS_AT_MS: readonly number[] = [0, 110, 200, 270, 325];
const TEL_STAIRS_PITCH_HZ = { from: 120, to: 60 };
const TEL_STAIRS_KNOCK_DECAY_S = 0.025;
const TEL_STAIRS_CLICK_MS = 3;
const TEL_STAIRS_CLICK_GAIN = 0.5;
/** Each knock is a little louder than the one before: it is getting closer. */
const TEL_STAIRS_GROWTH = 1.12;

// Coffee table telegraph: a creak (a wobbling low tone) and the scrape of something dragged.
const TEL_TABLE_LENGTH_MS = 500;
const TEL_TABLE_PITCH_HZ = 200;
const TEL_TABLE_WOBBLE_HZ = 8;
const TEL_TABLE_WOBBLE_DEPTH = 0.25;
const TEL_TABLE_ATTACK_MS = 20;
const TEL_TABLE_RELEASE_MS = 80;
/** Weight of the one-pole low-passed noise (the scrape) against the tone. */
const TEL_TABLE_SCRAPE_GAIN = 2.2;
/** One-pole smoothing of the scrape noise: the share of the new sample, in percent. */
const TEL_TABLE_SCRAPE_SMOOTHING_PCT = 12;
const TEL_TABLE_SCRAPE_RATE_HZ = 6;

// Stairs gag: a bumpy slide down (five « bdoum »), ending in a delighted « hi! ».
const GAG_STAIRS_LENGTH_MS = 600;
const GAG_STAIRS_THUMPS_AT_MS: readonly number[] = [0, 90, 180, 270, 360];
/** Pitch of the first thump; each next one starts lower. */
const GAG_STAIRS_THUMP_START_HZ = 200;
const GAG_STAIRS_THUMP_STEP_HZ = 20;
const GAG_STAIRS_THUMP_DROP = 0.6;
const GAG_STAIRS_THUMP_DECAY_S = 0.04;
const GAG_STAIRS_CHIRP_AT_MS = 470;
const GAG_STAIRS_CHIRP_HZ: readonly number[] = [900, 1200];
/** The « hi! » comes in over this long, in ms (its own: the parry's attack is another clip's). */
const GAG_STAIRS_CHIRP_ATTACK_MS = 2;
const GAG_STAIRS_CHIRP_RISE = 1.25;
const GAG_STAIRS_CHIRP_DECAY_S = 0.05;
const GAG_STAIRS_CHIRP_GAIN = 0.6;

// Coffee table gag: the object falls with a whistle. No crash: the break sound is PropBroken's (2.3).
const GAG_TABLE_LENGTH_MS = 350;
const GAG_TABLE_PITCH_HZ = { from: 1200, to: 400 };
const GAG_TABLE_ATTACK_MS = 10;
const GAG_TABLE_RELEASE_MS = 40;

// Micro-sleep telegraph: a muffled swell, low-passed noise over a soft low hum, as if the room went cottony.
const TEL_SLEEP_LENGTH_MS = 600;
const TEL_SLEEP_HUM_HZ = 110;
const TEL_SLEEP_HUM_GAIN = 0.6;
/** One-pole smoothing of the swell's noise: the share of the new sample, in percent (heavy: muffled). */
const TEL_SLEEP_SMOOTHING_PCT = 3;
const TEL_SLEEP_NOISE_GAIN = 6;
const TEL_SLEEP_RELEASE_MS = 120;

// Papa's snore (the gag of a missed micro-sleep): two cycles of a low saw with a fast tremolo (a rattle, 28 Hz).
const GAG_SLEEP_CYCLE_MS = 600;
const GAG_SLEEP_CYCLES = 2;
const GAG_SLEEP_PITCH_HZ = { from: 70, to: 95 };
const GAG_SLEEP_TREMOLO_HZ = 28;
const GAG_SLEEP_TREMOLO_DEPTH = 0.6;
/** Share of each cycle spent breathing in (swelling); the rest breathes out. */
const GAG_SLEEP_INHALE_PCT = 55;

// Phone ring: two bursts of a 440 + 480 Hz pair (the classic ring tone) with a fast tremolo. The
// whole clip stays under 1000 ms, so that two rings one second apart (PHONE_RINGING_EVERY_MS) never overlap.
const TEL_PHONE_BURST_MS = 350;
const TEL_PHONE_BURST_GAP_MS = 150;
const TEL_PHONE_BURSTS = 2;
const TEL_PHONE_PITCHES_HZ: readonly number[] = [440, 480];
const TEL_PHONE_TREMOLO_HZ = 25;
const TEL_PHONE_TREMOLO_DEPTH = 0.4;
const TEL_PHONE_ATTACK_MS = 8;
const TEL_PHONE_RELEASE_MS = 30;

// Pick-up click: a few ms of noise and a short low tick, like a handset leaving its cradle.
const PAPA_PHONE_ANSWER_LENGTH_MS = 150;
const PAPA_PHONE_ANSWER_NOISE_MS = 6;
const PAPA_PHONE_ANSWER_TICK_HZ = 900;
const PAPA_PHONE_ANSWER_TICK_AT_MS = 70;
const PAPA_PHONE_ANSWER_TICK_DECAY_S = 0.012;
const PAPA_PHONE_ANSWER_TICK_GAIN = 0.8;

/** A thump's ramp-up, in ms, and the level under which its tail is cut (a share of full scale). */
const THUMP_ATTACK_MS = 2;
const THUMP_AUDIBLE_FLOOR = 0.001;

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

/** A short rising electric buzz: a saw sweeping up, flickering in amplitude. */
export function synthTelegraph(): Float32Array {
  const out = new Float32Array(samplesOf(TEL_LENGTH_MS));
  const attack = samplesOf(TEL_ATTACK_MS);
  const release = samplesOf(TEL_RELEASE_MS);
  let cycle = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz = TEL_PITCH_HZ.from + (TEL_PITCH_HZ.to - TEL_PITCH_HZ.from) * progress;
    cycle += frequencyHz / SAMPLE_RATE_HZ;
    const saw = 2 * (cycle - Math.floor(cycle + 0.5));
    const flutter =
      1 - TEL_BUZZ_DEPTH * (0.5 + 0.5 * Math.sin((2 * Math.PI * TEL_BUZZ_HZ * i) / SAMPLE_RATE_HZ));
    out[i] = saw * flutter * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A bright « pop »: a sine that jumps up in pitch and dies fast. */
export function synthParry(): Float32Array {
  const out = new Float32Array(samplesOf(PARRY_LENGTH_MS));
  const attack = samplesOf(PARRY_ATTACK_MS);
  const release = samplesOf(PARRY_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      PARRY_PITCH_HZ.to -
      (PARRY_PITCH_HZ.to - PARRY_PITCH_HZ.from) * Math.exp(-seconds / PARRY_DECAY_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const envelope =
      Math.min(1, i / attack, (out.length - i) / release) * Math.exp(-seconds / PARRY_DECAY_S);
    out[i] = Math.sin(phase) * envelope;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The pop plus a higher chime that rings after it. */
export function synthParryPerfect(): Float32Array {
  const out = new Float32Array(samplesOf(PERFECT_LENGTH_MS));
  const pop = synthParry();
  out.set(pop.subarray(0, Math.min(pop.length, out.length)));
  const start = samplesOf(PERFECT_CHIME_DELAY_MS);
  for (let i = start; i < out.length; i++) {
    const seconds = (i - start) / SAMPLE_RATE_HZ;
    let chime = 0;
    for (const frequencyHz of PERFECT_CHIME_HZ)
      chime += Math.sin(2 * Math.PI * frequencyHz * seconds);
    const attack = Math.min(1, (i - start) / samplesOf(PARRY_ATTACK_MS));
    out[i] =
      (out[i] as number) +
      PERFECT_CHIME_GAIN * attack * chime * Math.exp(-seconds / PERFECT_CHIME_DECAY_S);
  }
  fadeEnds(out, PERFECT_RELEASE_MS);
  normalize(out, PEAK_LOUD);
  return out;
}

/** A crackle, then a descending « bzzt ». */
export function synthGagOutlet(): Float32Array {
  const rng = createRng(SEED + 2);
  const out = new Float32Array(samplesOf(GAG_LENGTH_MS));
  const crackle = samplesOf(GAG_CRACKLE_MS);
  for (let i = 0; i < crackle; i++) {
    if (nextFloat(rng) * 100 < GAG_CRACKLE_DENSITY_PCT)
      out[i] = (nextFloat(rng) * 2 - 1) * (1 - i / crackle);
  }
  const release = samplesOf(GAG_BZZT_RELEASE_MS);
  let cycle = 0;
  for (let i = crackle; i < out.length; i++) {
    const seconds = (i - crackle) / SAMPLE_RATE_HZ;
    const progress = (i - crackle) / (out.length - crackle);
    const frequencyHz =
      GAG_BZZT_PITCH_HZ.from + (GAG_BZZT_PITCH_HZ.to - GAG_BZZT_PITCH_HZ.from) * progress;
    cycle += frequencyHz / SAMPLE_RATE_HZ;
    const square = Math.sin(2 * Math.PI * cycle) > 0 ? 1 : -1;
    out[i] =
      0.6 *
      square *
      Math.min(1, (out.length - i) / release) *
      Math.exp(-seconds / GAG_BZZT_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A decaying sine that drops in pitch, added into `out` from `startMs`: one « bdoum » or one knock. */
function addThump(
  out: Float32Array,
  startMs: number,
  pitchHz: { from: number; to: number },
  decayS: number,
  gain: number,
): void {
  const start = samplesOf(startMs);
  let phase = 0;
  for (let i = start; i < out.length; i++) {
    const seconds = (i - start) / SAMPLE_RATE_HZ;
    const frequencyHz = pitchHz.to + (pitchHz.from - pitchHz.to) * Math.exp(-seconds / decayS);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const decay = Math.exp(-seconds / decayS);
    if (decay < THUMP_AUDIBLE_FLOOR) break;
    const envelope = Math.min(1, (i - start) / samplesOf(THUMP_ATTACK_MS)) * decay;
    out[i] = (out[i] as number) + gain * Math.sin(phase) * envelope;
  }
}

/** Quick pattering that speeds up: five knocks (a low thump with a click), closer and closer. */
export function synthTelegraphStairs(): Float32Array {
  const rng = createRng(SEED + 3);
  const out = new Float32Array(samplesOf(TEL_STAIRS_LENGTH_MS));
  TEL_STAIRS_KNOCKS_AT_MS.forEach((startMs, knock) => {
    const gain = TEL_STAIRS_GROWTH ** knock;
    addThump(out, startMs, TEL_STAIRS_PITCH_HZ, TEL_STAIRS_KNOCK_DECAY_S, gain);
    const click = samplesOf(TEL_STAIRS_CLICK_MS);
    for (let i = 0; i < click; i++) {
      const at = samplesOf(startMs) + i;
      out[at] =
        (out[at] as number) +
        gain * TEL_STAIRS_CLICK_GAIN * (nextFloat(rng) * 2 - 1) * (1 - i / click);
    }
  });
  fadeEnds(out, 2);
  normalize(out, PEAK_LOUD);
  return out;
}

/** A creak and a wobble: a slow pitch-modulated low tone over the scrape of filtered noise. */
export function synthTelegraphCoffeeTable(): Float32Array {
  const rng = createRng(SEED + 4);
  const out = new Float32Array(samplesOf(TEL_TABLE_LENGTH_MS));
  const attack = samplesOf(TEL_TABLE_ATTACK_MS);
  const release = samplesOf(TEL_TABLE_RELEASE_MS);
  let phase = 0;
  let scrape = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const wobble = Math.sin(2 * Math.PI * TEL_TABLE_WOBBLE_HZ * seconds);
    phase +=
      (2 * Math.PI * TEL_TABLE_PITCH_HZ * (1 + TEL_TABLE_WOBBLE_DEPTH * wobble)) / SAMPLE_RATE_HZ;
    scrape += (TEL_TABLE_SCRAPE_SMOOTHING_PCT / 100) * (nextFloat(rng) * 2 - 1 - scrape);
    // The scrape comes in strokes: its level swells and fades a few times a second.
    const stroke = 0.5 + 0.5 * Math.sin(2 * Math.PI * TEL_TABLE_SCRAPE_RATE_HZ * seconds);
    const tone = Math.sin(phase) + 0.4 * Math.sin(2 * phase);
    out[i] =
      (tone + TEL_TABLE_SCRAPE_GAIN * stroke * scrape) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A bumpy slide: five descending « bdoum » thumps, then a short high « hi! » of two sines. */
export function synthGagStairs(): Float32Array {
  const out = new Float32Array(samplesOf(GAG_STAIRS_LENGTH_MS));
  GAG_STAIRS_THUMPS_AT_MS.forEach((startMs, thump) => {
    const fromHz = GAG_STAIRS_THUMP_START_HZ - GAG_STAIRS_THUMP_STEP_HZ * thump;
    addThump(
      out,
      startMs,
      { from: fromHz, to: fromHz * GAG_STAIRS_THUMP_DROP },
      GAG_STAIRS_THUMP_DECAY_S,
      1,
    );
  });
  const start = samplesOf(GAG_STAIRS_CHIRP_AT_MS);
  const phases = GAG_STAIRS_CHIRP_HZ.map(() => 0);
  for (let i = start; i < out.length; i++) {
    const seconds = (i - start) / SAMPLE_RATE_HZ;
    const progress = (i - start) / (out.length - start);
    const envelope =
      Math.min(1, (i - start) / samplesOf(GAG_STAIRS_CHIRP_ATTACK_MS)) *
      Math.exp(-seconds / GAG_STAIRS_CHIRP_DECAY_S);
    GAG_STAIRS_CHIRP_HZ.forEach((baseHz, voice) => {
      const frequencyHz = baseHz * (1 + (GAG_STAIRS_CHIRP_RISE - 1) * progress);
      phases[voice] = (phases[voice] as number) + (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      out[i] =
        (out[i] as number) + GAG_STAIRS_CHIRP_GAIN * Math.sin(phases[voice] as number) * envelope;
    });
  }
  fadeEnds(out, 2);
  normalize(out, PEAK_LOUD);
  return out;
}

/** A falling whistle: a sine gliding down from `GAG_TABLE_PITCH_HZ.from` to `.to`. */
export function synthGagCoffeeTable(): Float32Array {
  const out = new Float32Array(samplesOf(GAG_TABLE_LENGTH_MS));
  const attack = samplesOf(GAG_TABLE_ATTACK_MS);
  const release = samplesOf(GAG_TABLE_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      GAG_TABLE_PITCH_HZ.from + (GAG_TABLE_PITCH_HZ.to - GAG_TABLE_PITCH_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] = Math.sin(phase) * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A muffled swell: heavily low-passed noise and a low hum that rise slowly, then fade (the micro-sleep's telegraph). */
export function synthTelegraphMicroSleep(): Float32Array {
  const rng = createRng(SEED + 5);
  const out = new Float32Array(samplesOf(TEL_SLEEP_LENGTH_MS));
  const release = samplesOf(TEL_SLEEP_RELEASE_MS);
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const progress = i / out.length;
    noise += (TEL_SLEEP_SMOOTHING_PCT / 100) * (nextFloat(rng) * 2 - 1 - noise);
    const hum = Math.sin(2 * Math.PI * TEL_SLEEP_HUM_HZ * seconds);
    // Slow rise (a sine quarter wave), then the release.
    const swell = Math.sin((Math.PI / 2) * progress);
    out[i] =
      (TEL_SLEEP_NOISE_GAIN * noise + TEL_SLEEP_HUM_GAIN * hum) *
      swell *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A snore: two breaths of a low sawtooth with a slow tremolo, swelling in then falling out (Papa's gag). */
export function synthGagPapaAsleep(): Float32Array {
  const cycle = samplesOf(GAG_SLEEP_CYCLE_MS);
  const out = new Float32Array(cycle * GAG_SLEEP_CYCLES);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const within = (i % cycle) / cycle;
    const inhale = GAG_SLEEP_INHALE_PCT / 100;
    const breath = within < inhale ? within / inhale : (1 - within) / (1 - inhale);
    const frequencyHz =
      GAG_SLEEP_PITCH_HZ.from + (GAG_SLEEP_PITCH_HZ.to - GAG_SLEEP_PITCH_HZ.from) * breath;
    phase += frequencyHz / SAMPLE_RATE_HZ;
    const saw = 2 * (phase - Math.floor(phase)) - 1;
    const tremolo =
      1 -
      GAG_SLEEP_TREMOLO_DEPTH *
        (0.5 + 0.5 * Math.sin(2 * Math.PI * GAG_SLEEP_TREMOLO_HZ * seconds));
    out[i] = saw * tremolo * breath * breath;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The phone's ring: two bursts of a 440 + 480 Hz pair with a fast tremolo (the disruption's `feedback.ring`). */
export function synthTelegraphPhone(): Float32Array {
  const burst = samplesOf(TEL_PHONE_BURST_MS);
  const gap = samplesOf(TEL_PHONE_BURST_GAP_MS);
  const out = new Float32Array((burst + gap) * TEL_PHONE_BURSTS - gap);
  const attack = samplesOf(TEL_PHONE_ATTACK_MS);
  const release = samplesOf(TEL_PHONE_RELEASE_MS);
  for (let b = 0; b < TEL_PHONE_BURSTS; b++) {
    const start = b * (burst + gap);
    for (let i = 0; i < burst; i++) {
      const seconds = i / SAMPLE_RATE_HZ;
      let tone = 0;
      for (const frequencyHz of TEL_PHONE_PITCHES_HZ) {
        tone += Math.sin(2 * Math.PI * frequencyHz * seconds);
      }
      const tremolo =
        1 -
        TEL_PHONE_TREMOLO_DEPTH *
          (0.5 + 0.5 * Math.sin(2 * Math.PI * TEL_PHONE_TREMOLO_HZ * seconds));
      out[start + i] = tone * tremolo * Math.min(1, i / attack, (burst - i) / release);
    }
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The pick-up: a click of noise, then a short tick (the disruption's `feedback.answer`). */
export function synthPhoneAnswer(): Float32Array {
  const rng = createRng(SEED + 6);
  const out = new Float32Array(samplesOf(PAPA_PHONE_ANSWER_LENGTH_MS));
  const noiseLength = samplesOf(PAPA_PHONE_ANSWER_NOISE_MS);
  const tickAt = samplesOf(PAPA_PHONE_ANSWER_TICK_AT_MS);
  for (let i = 0; i < out.length; i++) {
    const noise = i < noiseLength ? (nextFloat(rng) * 2 - 1) * (1 - i / noiseLength) : 0;
    const sinceTick = (i - tickAt) / SAMPLE_RATE_HZ;
    const tick =
      sinceTick < 0
        ? 0
        : PAPA_PHONE_ANSWER_TICK_GAIN *
          Math.sin(2 * Math.PI * PAPA_PHONE_ANSWER_TICK_HZ * sinceTick) *
          Math.exp(-sinceTick / PAPA_PHONE_ANSWER_TICK_DECAY_S);
    out[i] = noise + tick;
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
  { clip: 'tel_outlet', synth: synthTelegraph },
  { clip: 'resp_parry', synth: synthParry },
  { clip: 'resp_parry_perfect', synth: synthParryPerfect },
  { clip: 'gag_outlet', synth: synthGagOutlet },
  { clip: 'tel_stairs', synth: synthTelegraphStairs },
  { clip: 'gag_stairs', synth: synthGagStairs },
  { clip: 'tel_coffee_table', synth: synthTelegraphCoffeeTable },
  { clip: 'gag_coffee_table', synth: synthGagCoffeeTable },
  { clip: 'tel_papa_microsleep', synth: synthTelegraphMicroSleep },
  { clip: 'gag_papa_asleep', synth: synthGagPapaAsleep },
  { clip: 'tel_phone_ring', synth: synthTelegraphPhone },
  { clip: 'papa_phone_answer', synth: synthPhoneAnswer },
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
