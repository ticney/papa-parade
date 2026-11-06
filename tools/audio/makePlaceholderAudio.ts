import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { createRng, nextFloat, type RngState } from '@shared/rng';
import { ROOT } from '../assets/paths.ts';
import { synthBabyLaugh, synthFirm, synthParry } from './cultSounds.ts';
import { normalize, PEAK_LOUD, SAMPLE_RATE_HZ, SEED, samplesOf } from './synthKit.ts';

// The provisional sounds of stories 1.9, 1.11, 1.16, 1.19, 1.20, 1.21, 2.3, 2.9, 2.12, 2.13, 3.2, 4.1, 4.3 and 4.6 (the outlet's cues,
// then the stairs' and the coffee table's telegraph and gag clips, then the micro-sleep's muffled
// swell and Papa's snore, then the phone's ring and Papa's pick-up click, then the silence's « ah-ha »
// chirp and the baby's paper rustle, then story 4.1's cry in the arms, pick-up and put-down, story 4.3's need alarm, toilet door and flush, story 2.9's heartbeat, story 2.12's double « bonk » for a refused tap on a busy Papa and the bubble's ding, story 2.13's coffee slurp; story 2.3 replaced the parry's pop by a toy squeak, dropped the
// perfect's chime and added the Firmness's cupboard clack and the baby's laugh, in `cultSounds.ts`; story 3.2 added Mama's door slam and the lost star's cue),
// synthesized so that the whole audio pipeline works end to end with no human (golden rule). Real
// sounds replace the `.m4a` files under the same names (story 7.5, or Geo's recordings; `--only`
// regenerates some clips and leaves a recorded one alone). The tool is macOS only (`afconvert`) and
// CI never runs it.

export { SAMPLE_RATE_HZ, synthBabyLaugh, synthFirm, synthParry };
export const AAC_BITRATE_BPS = 64_000;

/** Fade at both ends of a loop so the loop point does not click, in ms. */
const LOOP_FADE_MS = 5;
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

const ARMS_TEL_LENGTH_MS = 450;
const ARMS_TEL_PITCH_HZ = { from: 380, to: 560 };
const ARMS_TEL_VIBRATO_HZ = 8;
const ARMS_TEL_VIBRATO_DEPTH = 0.05;
const ARMS_TEL_ATTACK_MS = 30;
const ARMS_TEL_RELEASE_MS = 120;

const ARMS_WAIL_LENGTH_MS = 1000;
const ARMS_WAIL_PITCH_HZ = { from: 460, peak: 720, to: 420 };
const ARMS_WAIL_VIBRATO_HZ = 6;
const ARMS_WAIL_VIBRATO_DEPTH = 0.04;
const ARMS_WAIL_ATTACK_MS = 40;
const ARMS_WAIL_RELEASE_MS = 200;
/** Level of the second harmonic against the first in the cries: a nasal, crying colour. */
const ARMS_HARMONIC_GAIN = 0.5;

const PICKUP_LENGTH_MS = 200;
const PICKUP_PITCH_HZ = { from: 260, to: 520 };
const PICKUP_ATTACK_MS = 15;
const PICKUP_RELEASE_MS = 60;

const PUTDOWN_LENGTH_MS = 260;
const PUTDOWN_PITCH_HZ = { from: 420, to: 160 };
const PUTDOWN_ATTACK_MS = 8;
const PUTDOWN_RELEASE_MS = 120;
const PUTDOWN_THUMP_HZ = 90;
const PUTDOWN_THUMP_DECAY_S = 0.05;

/**
 * The tense stem (story 2.6) plays twice as many steps as the calm one over the same 8 s, so its
 * notes land on the calm ones. A lower register on a scale with a flat second (Db against C) and a
 * tritone (F# against C): it sounds worse on purpose.
 */
const MUSIC_TENSE_STEPS = 2 * MUSIC_STEPS;
const MUSIC_TENSE_SCALE_HZ = [
  130.81, 138.59, 164.81, 185.0, 196.0, 220.0, 261.63, 277.18, 329.63, 369.99,
];
/** Level of the square wave against the sawtooth in the tense timbre: a buzzy edge. */
const MUSIC_TENSE_SQUARE_GAIN = 0.6;
const MUSIC_TENSE_DECAY_S = 0.12;

// Fatherly Instinct (story 2.9): about 3 s of low lub-dub, fading out (cue `instinct_triggered`).
const HEARTBEAT_LENGTH_MS = 3000;
/** One lub-dub per second. */
const HEARTBEAT_BEAT_EVERY_MS = 1000;
/** The dub follows the lub by this long. */
const HEARTBEAT_DUB_AFTER_MS = 280;
const HEARTBEAT_LUB_HZ = 55;
const HEARTBEAT_DUB_HZ = 70;
const HEARTBEAT_DUB_GAIN = 0.7;
/** Harmonics of a thump, so that a phone speaker, which cannot play 55 Hz, still renders it. */
const HEARTBEAT_HARMONIC_GAINS = [1, 0.5, 0.25];
const HEARTBEAT_ATTACK_MS = 8;
const HEARTBEAT_DECAY_S = 0.09;

// Pressing need (story 4.3): the alarm of a full bladder, the toilet door's click and thud, the flush.
const BLADDER_FULL_LENGTH_MS = 420;
const BLADDER_FULL_PITCH_HZ = { from: 330, to: 250 };
const BLADDER_FULL_PULSE_HZ = 9;
const BLADDER_FULL_BREATH_GAIN = 0.12;
const BLADDER_FULL_ATTACK_MS = 8;
const BLADDER_FULL_RELEASE_MS = 140;

const TOILET_DOOR_LENGTH_MS = 300;
const TOILET_DOOR_CLICK_GAP_MS = 130;
const TOILET_DOOR_CLICK_DECAY_S = 0.02;
const TOILET_DOOR_THUD_HZ = 95;
const TOILET_DOOR_THUD_DECAY_S = 0.07;

const FLUSH_LENGTH_MS = 1400;
const FLUSH_CUTOFF_HZ = { from: 2400, to: 700 };
const FLUSH_ATTACK_MS = 60;
const FLUSH_RELEASE_MS = 500;

// Combo cash-in (story 4.2): a bright rising arpeggio with a sparkle of noise on top.
const CASH_IN_LENGTH_MS = 520;
const CASH_IN_NOTES_HZ: readonly number[] = [523.25, 659.25, 783.99, 1046.5];
const CASH_IN_NOTE_GAP_MS = 80;
const CASH_IN_NOTE_DECAY_S = 0.14;
const CASH_IN_ATTACK_MS = 4;
const CASH_IN_RELEASE_MS = 120;
const CASH_IN_SPARKLE_GAIN = 0.18;
const CASH_IN_SPARKLE_DECAY_S = 0.18;

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

// Silence found: a short rising « ah-ha » (two chirps, the second higher).
const TEL_SILENCE_LENGTH_MS = 300;
const TEL_SILENCE_CHIRP_MS = 120;
const TEL_SILENCE_CHIRP_GAP_MS = 20;
const TEL_SILENCE_PITCHES_HZ = [
  { from: 420, to: 560 },
  { from: 560, to: 760 },
] as const;
const TEL_SILENCE_ATTACK_MS = 8;
const TEL_SILENCE_RELEASE_MS = 40;

// The surprise mischief: a paper rustle, bursts of noise rattling at about 18 Hz that fade away.
const GAG_SILENCE_LENGTH_MS = 500;
const GAG_SILENCE_RUSTLE_HZ = 18;
const GAG_SILENCE_SMOOTHING_PCT = 70;
const GAG_SILENCE_RELEASE_MS = 120;

/** A star stamped on the Result screen (story 1.22): a short bright blip, two partials. */
// Calibration beep (story 2.7): the player aligns a tap to its onset, so the attack is as sharp as a
// click-free start allows (1 ms), on a plain 1 kHz tone that any phone speaker reproduces.
const CALIBRATION_BEEP_LENGTH_MS = 90;
const CALIBRATION_BEEP_PITCH_HZ = 1000;
const CALIBRATION_BEEP_ATTACK_MS = 1;
const CALIBRATION_BEEP_DECAY_S = 0.06;
const CALIBRATION_BEEP_RELEASE_MS = 15;

const STAR_LENGTH_MS = 120;
const STAR_PITCH_HZ = 1318.5;
const STAR_OVERTONE_GAIN = 0.35;
const STAR_ATTACK_MS = 2;
const STAR_DECAY_S = 0.035;
const STAR_RELEASE_MS = 10;
/** The last star: lower and longer, a chord that rings out (« vibration marquée » in sound). */
const STAR_LAST_LENGTH_MS = 400;
const STAR_LAST_PITCHES_HZ = [523.25, 659.25, 783.99];
const STAR_LAST_ATTACK_MS = 4;
const STAR_LAST_DECAY_S = 0.14;
const STAR_LAST_RELEASE_MS = 40;

// Story 3.2: the door Mama slams when the noise wakes her, and the star she takes off.
const DOOR_SLAM_LENGTH_MS = 400;
const DOOR_SLAM_THUMP_HZ = { from: 110, to: 45 };
const DOOR_SLAM_THUMP_DECAY_S = 0.08;
/** The noise part of the slam: white noise through a one-pole low-pass, so it is a dull crack. */
const DOOR_SLAM_NOISE_SMOOTHING = 0.12;
const DOOR_SLAM_NOISE_DECAY_S = 0.04;
const DOOR_SLAM_NOISE_GAIN = 0.8;
const DOOR_SLAM_ATTACK_MS = 1;
const DOOR_SLAM_RELEASE_MS = 30;

const STAR_LOST_LENGTH_MS = 180;
const STAR_LOST_PITCH_HZ = { from: 440, to: 220 };
const STAR_LOST_SWEEP_S = 0.06;
const STAR_LOST_DECAY_S = 0.05;
const STAR_LOST_ATTACK_MS = 3;
const STAR_LOST_RELEASE_MS = 20;

/** A thump's ramp-up, in ms, and the level under which its tail is cut (a share of full scale). */
const THUMP_ATTACK_MS = 2;
const THUMP_AUDIBLE_FLOOR = 0.001;

const between = (rng: RngState, range: { min: number; max: number }): number =>
  range.min + nextFloat(rng) * (range.max - range.min);

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

/**
 * The nervous twin of `synthMusic`: exactly as long, on the same grid, a buzzy saw-and-square
 * timbre in a lower register with a flat second and a tritone. Same peak, same end fades.
 */
export function synthMusicTense(): Float32Array {
  const rng = createRng(SEED + 9);
  const out = new Float32Array(samplesOf(MUSIC_LENGTH_S * 1000));
  const calmStep = Math.floor(out.length / MUSIC_STEPS);
  const step = Math.floor(calmStep / 2);
  let degree = 0;
  for (let n = 0; n < MUSIC_TENSE_STEPS; n++) {
    // A jumpier walk than the calm one: leaps are as likely as steps.
    const roll = nextFloat(rng);
    degree += roll < 0.3 ? 1 : roll < 0.6 ? -1 : roll < 0.8 ? 3 : -3;
    degree = Math.max(0, Math.min(MUSIC_TENSE_SCALE_HZ.length - 1, degree));
    const frequencyHz = MUSIC_TENSE_SCALE_HZ[degree] as number;
    // Even steps start on a calm step, odd ones half a calm step later.
    const start = Math.floor(n / 2) * calmStep + (n % 2) * step;
    const end = n === MUSIC_TENSE_STEPS - 1 ? out.length : start + step;
    const length = end - start;
    const attack = samplesOf(MUSIC_ATTACK_MS);
    const release = samplesOf(MUSIC_RELEASE_MS);
    for (let i = 0; i < length; i++) {
      const cycle = (i * frequencyHz) / SAMPLE_RATE_HZ;
      const saw = 2 * (cycle - Math.floor(cycle + 0.5));
      const square = cycle - Math.floor(cycle) < 0.5 ? 1 : -1;
      const envelope =
        Math.min(1, i / attack, (length - i) / release) *
        Math.exp(-i / SAMPLE_RATE_HZ / MUSIC_TENSE_DECAY_S);
      out[start + i] = (saw + MUSIC_TENSE_SQUARE_GAIN * square) * envelope;
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

/** The silence is found: a short rising « ah-ha », two sine chirps (the silence's telegraph). */
export function synthTelegraphSilence(): Float32Array {
  const out = new Float32Array(samplesOf(TEL_SILENCE_LENGTH_MS));
  const chirp = samplesOf(TEL_SILENCE_CHIRP_MS);
  const gap = samplesOf(TEL_SILENCE_CHIRP_GAP_MS);
  const attack = samplesOf(TEL_SILENCE_ATTACK_MS);
  const release = samplesOf(TEL_SILENCE_RELEASE_MS);
  TEL_SILENCE_PITCHES_HZ.forEach((pitch, c) => {
    const start = c * (chirp + gap);
    let phase = 0;
    for (let i = 0; i < chirp && start + i < out.length; i++) {
      const frequencyHz = pitch.from + (pitch.to - pitch.from) * (i / chirp);
      phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      out[start + i] = Math.sin(phase) * Math.min(1, i / attack, (chirp - i) / release);
    }
  });
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A paper rustle: smoothed noise chopped by a fast rattle, then fading (the surprise mischief's gag). */
export function synthGagSilence(): Float32Array {
  const rng = createRng(SEED + 7);
  const out = new Float32Array(samplesOf(GAG_SILENCE_LENGTH_MS));
  const release = samplesOf(GAG_SILENCE_RELEASE_MS);
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    noise += ((100 - GAG_SILENCE_SMOOTHING_PCT) / 100) * (nextFloat(rng) * 2 - 1 - noise);
    const rattle = 0.5 + 0.5 * Math.sin(2 * Math.PI * GAG_SILENCE_RUSTLE_HZ * seconds);
    out[i] = noise * rattle * Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A struck chord of `pitchesHz`, decaying from a short attack, with a release to zero. */
function strike(
  lengthMs: number,
  pitchesHz: readonly { frequencyHz: number; gain: number }[],
  attackMs: number,
  decayS: number,
  releaseMs: number,
): Float32Array {
  const out = new Float32Array(samplesOf(lengthMs));
  const attack = samplesOf(attackMs);
  const release = samplesOf(releaseMs);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let tone = 0;
    for (const { frequencyHz, gain } of pitchesHz) {
      tone += gain * Math.sin(2 * Math.PI * frequencyHz * seconds);
    }
    const envelope =
      Math.exp(-seconds / decayS) * Math.min(1, i / attack, (out.length - i) / release);
    out[i] = tone * envelope;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A star stamped on the Result screen: a short bright blip (cue `result_star`). */
export function synthStarStamp(): Float32Array {
  return strike(
    STAR_LENGTH_MS,
    [
      { frequencyHz: STAR_PITCH_HZ, gain: 1 },
      { frequencyHz: STAR_PITCH_HZ * 2, gain: STAR_OVERTONE_GAIN },
    ],
    STAR_ATTACK_MS,
    STAR_DECAY_S,
    STAR_RELEASE_MS,
  );
}

/** The beep of the latency calibration: a short sharp 1 kHz tone (feedback `calibration.beep`). */
export function synthCalibrationBeep(): Float32Array {
  return strike(
    CALIBRATION_BEEP_LENGTH_MS,
    [{ frequencyHz: CALIBRATION_BEEP_PITCH_HZ, gain: 1 }],
    CALIBRATION_BEEP_ATTACK_MS,
    CALIBRATION_BEEP_DECAY_S,
    CALIBRATION_BEEP_RELEASE_MS,
  );
}

/** The last star stamped: a lower, longer chord (cue `result_star_last`). */
export function synthStarStampLast(): Float32Array {
  return strike(
    STAR_LAST_LENGTH_MS,
    STAR_LAST_PITCHES_HZ.map((frequencyHz) => ({ frequencyHz, gain: 1 })),
    STAR_LAST_ATTACK_MS,
    STAR_LAST_DECAY_S,
    STAR_LAST_RELEASE_MS,
  );
}

/** A door slammed: a low thump with a dull noise crack on top, loud and gone in 400 ms (cue `mama_woke`). */
export function synthDoorSlam(): Float32Array {
  const rng = createRng(SEED + 8);
  const out = new Float32Array(samplesOf(DOOR_SLAM_LENGTH_MS));
  const attack = samplesOf(DOOR_SLAM_ATTACK_MS);
  const release = samplesOf(DOOR_SLAM_RELEASE_MS);
  let phase = 0;
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      DOOR_SLAM_THUMP_HZ.to +
      (DOOR_SLAM_THUMP_HZ.from - DOOR_SLAM_THUMP_HZ.to) *
        Math.exp(-seconds / DOOR_SLAM_THUMP_DECAY_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    smoothed += DOOR_SLAM_NOISE_SMOOTHING * (nextFloat(rng) * 2 - 1 - smoothed);
    const thump = Math.sin(phase) * Math.exp(-seconds / DOOR_SLAM_THUMP_DECAY_S);
    const crack = smoothed * DOOR_SLAM_NOISE_GAIN * Math.exp(-seconds / DOOR_SLAM_NOISE_DECAY_S);
    out[i] = (thump + crack) * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The star Mama takes off: a dull blip that falls, lower than the stamp (cue `result_star_lost`). */
export function synthStarLost(): Float32Array {
  const out = new Float32Array(samplesOf(STAR_LOST_LENGTH_MS));
  const attack = samplesOf(STAR_LOST_ATTACK_MS);
  const release = samplesOf(STAR_LOST_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      STAR_LOST_PITCH_HZ.to +
      (STAR_LOST_PITCH_HZ.from - STAR_LOST_PITCH_HZ.to) * Math.exp(-seconds / STAR_LOST_SWEEP_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] =
      Math.sin(phase) *
      Math.exp(-seconds / STAR_LOST_DECAY_S) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/**
 * A crying voice: a sine and its second harmonic whose pitch follows `contour` (0..1 over the clip),
 * with a vibrato, an attack and a release. The cry in the arms' telegraph and gag use it.
 */
function cryVoice(
  lengthMs: number,
  contour: (progress: number) => number,
  vibrato: { hz: number; depth: number },
  attackMs: number,
  releaseMs: number,
): Float32Array {
  const out = new Float32Array(samplesOf(lengthMs));
  const attack = samplesOf(attackMs);
  const release = samplesOf(releaseMs);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      contour(i / out.length) * (1 + vibrato.depth * Math.sin(2 * Math.PI * vibrato.hz * seconds));
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] =
      (Math.sin(phase) + ARMS_HARMONIC_GAIN * Math.sin(2 * phase)) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A whimper that rises (the cry in the arms' telegraph: « BERCE ! »). */
export function synthTelegraphArmsCry(): Float32Array {
  return cryVoice(
    ARMS_TEL_LENGTH_MS,
    (progress) =>
      ARMS_TEL_PITCH_HZ.from + (ARMS_TEL_PITCH_HZ.to - ARMS_TEL_PITCH_HZ.from) * progress,
    { hz: ARMS_TEL_VIBRATO_HZ, depth: ARMS_TEL_VIBRATO_DEPTH },
    ARMS_TEL_ATTACK_MS,
    ARMS_TEL_RELEASE_MS,
  );
}

/** A full wail: up to a peak, then down (the cry in the arms' gag). */
export function synthGagArmsWail(): Float32Array {
  const { from, peak, to } = ARMS_WAIL_PITCH_HZ;
  return cryVoice(
    ARMS_WAIL_LENGTH_MS,
    (progress) =>
      progress < 0.35
        ? from + (peak - from) * (progress / 0.35)
        : peak + (to - peak) * ((progress - 0.35) / 0.65),
    { hz: ARMS_WAIL_VIBRATO_HZ, depth: ARMS_WAIL_VIBRATO_DEPTH },
    ARMS_WAIL_ATTACK_MS,
    ARMS_WAIL_RELEASE_MS,
  );
}

/** A soft « hup »: a short sine that rises (Papa lifts the baby, cue `baby_picked_up`). */
export function synthBabyPickup(): Float32Array {
  const out = new Float32Array(samplesOf(PICKUP_LENGTH_MS));
  const attack = samplesOf(PICKUP_ATTACK_MS);
  const release = samplesOf(PICKUP_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const frequencyHz =
      PICKUP_PITCH_HZ.from + (PICKUP_PITCH_HZ.to - PICKUP_PITCH_HZ.from) * (i / out.length);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] = Math.sin(phase) * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A soft landing: a sine that falls with a low thump under it (Papa sets the baby down, cue `baby_put_down`). */
export function synthBabyPutdown(): Float32Array {
  const out = new Float32Array(samplesOf(PUTDOWN_LENGTH_MS));
  const attack = samplesOf(PUTDOWN_ATTACK_MS);
  const release = samplesOf(PUTDOWN_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      PUTDOWN_PITCH_HZ.from + (PUTDOWN_PITCH_HZ.to - PUTDOWN_PITCH_HZ.from) * (i / out.length);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const thump =
      Math.sin(2 * Math.PI * PUTDOWN_THUMP_HZ * seconds) *
      Math.exp(-seconds / PUTDOWN_THUMP_DECAY_S);
    out[i] = (0.6 * Math.sin(phase) + thump) * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The combo cashed in at a safe drop: four rising notes and a sparkle of noise (cue `combo_cashed_in`). */
export function synthComboCashIn(): Float32Array {
  const rng = createRng(SEED + 10);
  const out = new Float32Array(samplesOf(CASH_IN_LENGTH_MS));
  const attack = samplesOf(CASH_IN_ATTACK_MS);
  const release = samplesOf(CASH_IN_RELEASE_MS);
  let sparkle = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let tone = 0;
    for (const [index, frequencyHz] of CASH_IN_NOTES_HZ.entries()) {
      const sinceNoteS = seconds - (index * CASH_IN_NOTE_GAP_MS) / 1000;
      if (sinceNoteS < 0) continue;
      tone +=
        Math.sin(2 * Math.PI * frequencyHz * sinceNoteS) *
        Math.exp(-sinceNoteS / CASH_IN_NOTE_DECAY_S);
    }
    // First difference of white noise: the highs only, the glitter.
    const white = nextFloat(rng) * 2 - 1;
    const glitter = white - sparkle;
    sparkle = white;
    const air = glitter * CASH_IN_SPARKLE_GAIN * Math.exp(-seconds / CASH_IN_SPARKLE_DECAY_S);
    out[i] = (tone + air) * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/**
 * A heartbeat: three lub-dubs a second apart, a low thump (55 Hz, then 70 Hz and weaker) with two
 * harmonics, each decaying fast, the whole fading out. Deterministic, no noise (cue `instinct_triggered`).
 */
export function synthHeartbeat(): Float32Array {
  const out = new Float32Array(samplesOf(HEARTBEAT_LENGTH_MS));
  const attack = samplesOf(HEARTBEAT_ATTACK_MS);
  const thump = (sinceSamples: number, frequencyHz: number, gain: number): number => {
    if (sinceSamples < 0) return 0;
    const seconds = sinceSamples / SAMPLE_RATE_HZ;
    let tone = 0;
    HEARTBEAT_HARMONIC_GAINS.forEach((harmonicGain, index) => {
      tone += harmonicGain * Math.sin(2 * Math.PI * frequencyHz * (index + 1) * seconds);
    });
    return (
      gain * tone * Math.exp(-seconds / HEARTBEAT_DECAY_S) * Math.min(1, sinceSamples / attack)
    );
  };
  const beatEvery = samplesOf(HEARTBEAT_BEAT_EVERY_MS);
  const dubAfter = samplesOf(HEARTBEAT_DUB_AFTER_MS);
  for (let i = 0; i < out.length; i++) {
    const sinceBeat = i % beatEvery;
    const fade = 1 - i / out.length;
    out[i] =
      (thump(sinceBeat, HEARTBEAT_LUB_HZ, 1) +
        thump(sinceBeat - dubAfter, HEARTBEAT_DUB_HZ, HEARTBEAT_DUB_GAIN)) *
      fade;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** The need is full: urgent low pulses that sag, with a breath of noise (cue `bladder_full`). */
export function synthBladderFull(): Float32Array {
  const rng = createRng(SEED + 13);
  const out = new Float32Array(samplesOf(BLADDER_FULL_LENGTH_MS));
  const attack = samplesOf(BLADDER_FULL_ATTACK_MS);
  const release = samplesOf(BLADDER_FULL_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      BLADDER_FULL_PITCH_HZ.from +
      (BLADDER_FULL_PITCH_HZ.to - BLADDER_FULL_PITCH_HZ.from) * (i / out.length);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * BLADDER_FULL_PULSE_HZ * seconds - Math.PI / 2);
    const breath = (nextFloat(rng) * 2 - 1) * BLADDER_FULL_BREATH_GAIN;
    out[i] =
      (Math.sin(phase) + breath) * pulse * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A latch clicks, then the door thuds shut: Papa goes in (cue `toilet_entered`). */
export function synthToiletDoor(): Float32Array {
  const rng = createRng(SEED + 14);
  const out = new Float32Array(samplesOf(TOILET_DOOR_LENGTH_MS));
  const gap = samplesOf(TOILET_DOOR_CLICK_GAP_MS);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const click = (nextFloat(rng) * 2 - 1) * Math.exp(-seconds / TOILET_DOOR_CLICK_DECAY_S);
    const sinceThud = i - gap;
    const thud =
      sinceThud < 0
        ? 0
        : Math.sin(2 * Math.PI * TOILET_DOOR_THUD_HZ * (sinceThud / SAMPLE_RATE_HZ)) *
          Math.exp(-(sinceThud / SAMPLE_RATE_HZ) / TOILET_DOOR_THUD_DECAY_S);
    out[i] = 0.5 * click + thud;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A flush: low-passed noise whose cutoff sweeps down, like water leaving (cue `toilet_flushed`). */
export function synthToiletFlush(): Float32Array {
  const rng = createRng(SEED + 12);
  const out = new Float32Array(samplesOf(FLUSH_LENGTH_MS));
  const attack = samplesOf(FLUSH_ATTACK_MS);
  const release = samplesOf(FLUSH_RELEASE_MS);
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const cutoffHz =
      FLUSH_CUTOFF_HZ.from + (FLUSH_CUTOFF_HZ.to - FLUSH_CUTOFF_HZ.from) * (i / out.length);
    // One-pole low-pass: alpha from the cutoff.
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE_HZ);
    low += alpha * (nextFloat(rng) * 2 - 1 - low);
    out[i] = low * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// Story 4.4: « Rester éveillé ». The music is a drone that sways (two close sines beat 0.5 Hz, with a
// slow tremolo), short of the 8 s of the level's stems. Every other clip has its own seed.
const SEQUENCE_MUSIC_LENGTH_S = 6;
const SEQUENCE_MUSIC_HZ = [110, 110.5, 165];
const SEQUENCE_MUSIC_SWAY_HZ = 0.5;
const SEQUENCE_MUSIC_BREATH_GAIN = 0.05;
const SNORE_CYCLE_MS = 700;
const SNORE_CYCLES = 2;
const SNORE_PITCH_HZ = { from: 60, to: 85 };
const SNORE_RATTLE_GAIN = 0.5;
const SNORE_INHALE_PCT = 50;
const WOKE_LENGTH_MS = 700;
const WOKE_PITCH_HZ = { from: 420, peak: 820, to: 600 };
const WOKE_WOBBLE_HZ = 9;
const WOKE_BREATH_GAIN = 0.25;
const WOKE_ATTACK_MS = 20;
const WOKE_RELEASE_MS = 200;
const CHIME_ATTACK_MS = 6;
const CHIME_DECAY_S = 0.18;
const CHIME_RELEASE_MS = 40;
const CHIME_BREATH_GAIN = 0.02;
const SEQUENCE_STARTED_NOTES_HZ = [392, 523.25];
const SEQUENCE_SUCCEEDED_NOTES_HZ = [523.25, 659.25, 783.99];
const SEQUENCE_FAILED_NOTES_HZ = [392, 311.13, 233.08];
const CHIME_NOTE_GAP_MS = 110;
const CHIME_TAIL_MS = 260;

/** The sequence's music: a low drone that sways, a loop with faded ends (loop `sequenceMusic.stay_awake`). */
export function synthSequenceMusic(): Float32Array {
  const rng = createRng(SEED + 15);
  const out = new Float32Array(samplesOf(SEQUENCE_MUSIC_LENGTH_S * 1000));
  let breath = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let tone = 0;
    for (const frequencyHz of SEQUENCE_MUSIC_HZ)
      tone += Math.sin(2 * Math.PI * frequencyHz * seconds);
    // Heavily smoothed noise: a sleepy breath under the drone.
    breath += 0.002 * (nextFloat(rng) * 2 - 1 - breath);
    const sway = 0.7 + 0.3 * Math.sin(2 * Math.PI * SEQUENCE_MUSIC_SWAY_HZ * seconds);
    out[i] = (tone / SEQUENCE_MUSIC_HZ.length + breath * SEQUENCE_MUSIC_BREATH_GAIN * 20) * sway;
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC);
  return out;
}

/** A loud snore: two breaths of a low saw under a rattle of noise, swelling in and falling out (cue `papa_snored`). */
export function synthPapaSnore(): Float32Array {
  const rng = createRng(SEED + 16);
  const cycle = samplesOf(SNORE_CYCLE_MS);
  const out = new Float32Array(cycle * SNORE_CYCLES);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const within = (i % cycle) / cycle;
    const inhale = SNORE_INHALE_PCT / 100;
    const breath = within < inhale ? within / inhale : (1 - within) / (1 - inhale);
    const frequencyHz = SNORE_PITCH_HZ.from + (SNORE_PITCH_HZ.to - SNORE_PITCH_HZ.from) * breath;
    phase += frequencyHz / SAMPLE_RATE_HZ;
    const saw = 2 * (phase - Math.floor(phase)) - 1;
    const rattle = (nextFloat(rng) * 2 - 1) * SNORE_RATTLE_GAIN;
    out[i] = (saw + rattle) * breath * breath;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A startled whimper: a pitch that jumps up, wobbles and sags, with a breath of noise (cue `baby_woke`). */
export function synthBabyWoke(): Float32Array {
  const rng = createRng(SEED + 17);
  const out = new Float32Array(samplesOf(WOKE_LENGTH_MS));
  const attack = samplesOf(WOKE_ATTACK_MS);
  const release = samplesOf(WOKE_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      progress < 0.3
        ? WOKE_PITCH_HZ.from + (WOKE_PITCH_HZ.peak - WOKE_PITCH_HZ.from) * (progress / 0.3)
        : WOKE_PITCH_HZ.peak + (WOKE_PITCH_HZ.to - WOKE_PITCH_HZ.peak) * ((progress - 0.3) / 0.7);
    const wobble = 1 + 0.04 * Math.sin((2 * Math.PI * WOKE_WOBBLE_HZ * i) / SAMPLE_RATE_HZ);
    phase += (2 * Math.PI * frequencyHz * wobble) / SAMPLE_RATE_HZ;
    const breath = (nextFloat(rng) * 2 - 1) * WOKE_BREATH_GAIN;
    out[i] =
      (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + breath) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** Soft bell notes, one after the other, each dying inside the clip. */
function synthChime(seed: number, notesHz: readonly number[]): Float32Array {
  const rng = createRng(SEED + seed);
  const gap = samplesOf(CHIME_NOTE_GAP_MS);
  const out = new Float32Array(
    gap * (notesHz.length - 1) + samplesOf(CHIME_NOTE_GAP_MS + CHIME_TAIL_MS),
  );
  const attack = samplesOf(CHIME_ATTACK_MS);
  const release = samplesOf(CHIME_RELEASE_MS);
  for (const [index, frequencyHz] of notesHz.entries()) {
    const start = index * gap;
    for (let i = 0; start + i < out.length; i++) {
      const seconds = i / SAMPLE_RATE_HZ;
      const tone =
        Math.sin(2 * Math.PI * frequencyHz * seconds) +
        0.4 * Math.sin(2 * Math.PI * frequencyHz * 2 * seconds);
      out[start + i] =
        (out[start + i] as number) +
        (tone + (nextFloat(rng) * 2 - 1) * CHIME_BREATH_GAIN) *
          Math.min(1, i / attack) *
          Math.exp(-seconds / CHIME_DECAY_S);
    }
  }
  for (let i = 0; i < release; i++) {
    const index = out.length - 1 - i;
    out[index] = (out[index] as number) * (i / release);
  }
  out[0] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** Two rising notes: the sequence begins (cue `sequence_started`). */
export function synthSequenceStarted(): Float32Array {
  return synthChime(18, SEQUENCE_STARTED_NOTES_HZ);
}

/** Three rising notes: the sequence is won (cue `sequence_succeeded`). */
export function synthSequenceSucceeded(): Float32Array {
  return synthChime(19, SEQUENCE_SUCCEEDED_NOTES_HZ);
}

/** Three falling notes: the sequence is lost (cue `sequence_failed`). */
export function synthSequenceFailed(): Float32Array {
  return synthChime(20, SEQUENCE_FAILED_NOTES_HZ);
}

// Story 4.5: « Les 100 pas en rythme ». Seeds 21 to 26 are this story's (cultSounds.ts takes 9 to 11,
// this file 0 to 20): one clip, one stream. Every note is shorter than the shortest beat interval of
// the lullaby (667 ms at 90 BPM), so two notes never overlap.
const LULLABY_NOTES_HZ = [523.25, 587.33, 659.25, 783.99];
const LULLABY_NOTE_LENGTH_MS = 520;
const LULLABY_NOTE_ATTACK_MS = 8;
const LULLABY_NOTE_DECAY_S = 0.14;
const LULLABY_NOTE_RELEASE_MS = 60;
const LULLABY_NOTE_BREATH_GAIN = 0.01;
const LULLABY_NOTE_PEAK = 0.3;
const LULLABY_TICK_LENGTH_MS = 70;
const LULLABY_TICK_HZ = 1800;
const LULLABY_TICK_DECAY_S = 0.012;
const LULLABY_COO_LENGTH_MS = 380;
const LULLABY_COO_PITCH_HZ = { from: 500, peak: 650, to: 540 };
const LULLABY_COO_VIBRATO_HZ = 5;
const LULLABY_COO_ATTACK_MS = 60;
const LULLABY_COO_RELEASE_MS = 140;
const LULLABY_STEP_LENGTH_MS = 190;
const LULLABY_STEP_HZ = { from: 150, to: 70 };
const LULLABY_STEP_DECAY_S = 0.05;
/** The smoothed noise is a small signal (a few hundredths), so its gain is above 1 to be heard against the thump. */
const LULLABY_STEP_NOISE_GAIN = 1.4;
const LULLABY_STEP_NOISE_SMOOTHING = 0.15;
const LULLABY_STIR_LENGTH_MS = 340;
const LULLABY_STIR_PITCH_HZ = { from: 340, peak: 470, to: 380 };
const LULLABY_STIR_BREATH_GAIN = 0.3;
const LULLABY_STIR_ATTACK_MS = 25;
const LULLABY_STIR_RELEASE_MS = 120;
const LULLABY_PAD_LENGTH_S = 6;
const LULLABY_PAD_HZ = [130.81, 196, 261.63];
const LULLABY_PAD_SWAY_HZ = 1 / 6;

/** One soft bell note of the lullaby, dying inside the clip (clips `music_lullaby_note_1` to `_4`). */
function synthLullabyNote(seed: number, frequencyHz: number): Float32Array {
  const rng = createRng(SEED + seed);
  const out = new Float32Array(samplesOf(LULLABY_NOTE_LENGTH_MS));
  const attack = samplesOf(LULLABY_NOTE_ATTACK_MS);
  const release = samplesOf(LULLABY_NOTE_RELEASE_MS);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const tone =
      Math.sin(2 * Math.PI * frequencyHz * seconds) +
      0.3 * Math.sin(2 * Math.PI * frequencyHz * 2 * seconds);
    out[i] =
      (tone + (nextFloat(rng) * 2 - 1) * LULLABY_NOTE_BREATH_GAIN) *
      Math.min(1, i / attack, (out.length - i) / release) *
      Math.exp(-seconds / LULLABY_NOTE_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, LULLABY_NOTE_PEAK);
  return out;
}

export const synthLullabyNote1 = (): Float32Array =>
  synthLullabyNote(21, LULLABY_NOTES_HZ[0] as number);
export const synthLullabyNote2 = (): Float32Array =>
  synthLullabyNote(22, LULLABY_NOTES_HZ[1] as number);
export const synthLullabyNote3 = (): Float32Array =>
  synthLullabyNote(23, LULLABY_NOTES_HZ[2] as number);
export const synthLullabyNote4 = (): Float32Array =>
  synthLullabyNote(24, LULLABY_NOTES_HZ[3] as number);

/** A dry wooden tick: the count-in beats, which are only heard (clip `music_lullaby_tick`). */
export function synthLullabyTick(): Float32Array {
  const out = new Float32Array(samplesOf(LULLABY_TICK_LENGTH_MS));
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    out[i] =
      Math.sin(2 * Math.PI * LULLABY_TICK_HZ * seconds) * Math.exp(-seconds / LULLABY_TICK_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A soft « ooh »: a rounded rise and fall with a slow vibrato, the decoy on the off-beat (clip `baby_lullaby_coo`). */
export function synthLullabyCoo(): Float32Array {
  const out = new Float32Array(samplesOf(LULLABY_COO_LENGTH_MS));
  const attack = samplesOf(LULLABY_COO_ATTACK_MS);
  const release = samplesOf(LULLABY_COO_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      progress < 0.5
        ? LULLABY_COO_PITCH_HZ.from +
          (LULLABY_COO_PITCH_HZ.peak - LULLABY_COO_PITCH_HZ.from) * (progress / 0.5)
        : LULLABY_COO_PITCH_HZ.peak +
          (LULLABY_COO_PITCH_HZ.to - LULLABY_COO_PITCH_HZ.peak) * ((progress - 0.5) / 0.5);
    const vibrato =
      1 + 0.03 * Math.sin((2 * Math.PI * LULLABY_COO_VIBRATO_HZ * i) / SAMPLE_RATE_HZ);
    phase += (2 * Math.PI * frequencyHz * vibrato) / SAMPLE_RATE_HZ;
    out[i] =
      (Math.sin(phase) + 0.2 * Math.sin(2 * phase)) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A felt footstep: a low thud that sags in pitch under a puff of smoothed noise (cue `beat_hit`). */
export function synthLullabyStep(): Float32Array {
  const rng = createRng(SEED + 25);
  const out = new Float32Array(samplesOf(LULLABY_STEP_LENGTH_MS));
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      LULLABY_STEP_HZ.to +
      (LULLABY_STEP_HZ.from - LULLABY_STEP_HZ.to) * Math.exp(-seconds / LULLABY_STEP_DECAY_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    noise += LULLABY_STEP_NOISE_SMOOTHING * (nextFloat(rng) * 2 - 1 - noise);
    out[i] =
      (Math.sin(phase) + noise * LULLABY_STEP_NOISE_GAIN) *
      Math.exp(-seconds / LULLABY_STEP_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A small stir in the cot: a short, breathy whimper that does not quite wake (cue `baby_stirred`). */
export function synthBabyStir(): Float32Array {
  const rng = createRng(SEED + 26);
  const out = new Float32Array(samplesOf(LULLABY_STIR_LENGTH_MS));
  const attack = samplesOf(LULLABY_STIR_ATTACK_MS);
  const release = samplesOf(LULLABY_STIR_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      progress < 0.4
        ? LULLABY_STIR_PITCH_HZ.from +
          (LULLABY_STIR_PITCH_HZ.peak - LULLABY_STIR_PITCH_HZ.from) * (progress / 0.4)
        : LULLABY_STIR_PITCH_HZ.peak +
          (LULLABY_STIR_PITCH_HZ.to - LULLABY_STIR_PITCH_HZ.peak) * ((progress - 0.4) / 0.6);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const breath = (nextFloat(rng) * 2 - 1) * LULLABY_STIR_BREATH_GAIN;
    out[i] =
      (Math.sin(phase) + 0.5 * Math.sin(3 * phase) + breath) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/**
 * The lullaby's pad: a quiet drone that swells once per loop and has no pulse, so the planned notes
 * carry the tempo alone (loop `sequenceMusic.lullaby_walk`). Only the 196 Hz tone and the swell make
 * whole cycles over the loop; the other two do not, so the seam is hidden by the fade at both ends
 * (a dip once per loop, like the other loops), not absent.
 */
export function synthLullabyPad(): Float32Array {
  const out = new Float32Array(samplesOf(LULLABY_PAD_LENGTH_S * 1000));
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let tone = 0;
    for (const frequencyHz of LULLABY_PAD_HZ) tone += Math.sin(2 * Math.PI * frequencyHz * seconds);
    const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * LULLABY_PAD_SWAY_HZ * seconds);
    out[i] = (tone / LULLABY_PAD_HZ.length) * swell;
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC);
  return out;
}

// Story 4.6: « Duel du coucher ». Seeds 27 to 31 are this story's, one clip one stream.
const BEDTIME_TEL_LENGTH_MS = 700;
const BEDTIME_TEL_HZ = { from: 220, to: 180 };
const BEDTIME_TEL_NOISE_GAIN = 0.15;
const BEDTIME_TEL_ATTACK_MS = 120;
const BEDTIME_TEL_RELEASE_MS = 300;

/** A held breath: a soft low tone sinking under a puff of noise, the baby's eyes watching (cue `tel_bedtime_eyes`). */
export function synthTelegraphBedtimeEyes(): Float32Array {
  const rng = createRng(SEED + 27);
  const out = new Float32Array(samplesOf(BEDTIME_TEL_LENGTH_MS));
  const attack = samplesOf(BEDTIME_TEL_ATTACK_MS);
  const release = samplesOf(BEDTIME_TEL_RELEASE_MS);
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const frequencyHz =
      BEDTIME_TEL_HZ.from + (BEDTIME_TEL_HZ.to - BEDTIME_TEL_HZ.from) * (i / out.length);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    noise += 0.05 * (nextFloat(rng) * 2 - 1 - noise);
    out[i] =
      (Math.sin(phase) + noise * BEDTIME_TEL_NOISE_GAIN * 10) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const BEDTIME_WAIT_LENGTH_MS = 380;
const BEDTIME_WAIT_NOTES_HZ = [392, 587.33];
const BEDTIME_WAIT_ATTACK_MS = 4;
const BEDTIME_WAIT_DECAY_S = 0.12;

/** Two quick soft notes, tiptoeing away: the duel is won (cue `resp_wait`). */
export function synthRespWait(): Float32Array {
  const rng = createRng(SEED + 28);
  const out = new Float32Array(samplesOf(BEDTIME_WAIT_LENGTH_MS));
  const attack = samplesOf(BEDTIME_WAIT_ATTACK_MS);
  const noteSamples = Math.floor(out.length / BEDTIME_WAIT_NOTES_HZ.length);
  BEDTIME_WAIT_NOTES_HZ.forEach((frequencyHz, n) => {
    for (let i = 0; i < noteSamples; i++) {
      const seconds = i / SAMPLE_RATE_HZ;
      const click = i < attack ? (nextFloat(rng) * 2 - 1) * 0.3 : 0;
      out[n * noteSamples + i] =
        (Math.sin(2 * Math.PI * frequencyHz * seconds) + click) *
        Math.min(1, i / attack) *
        Math.exp(-seconds / BEDTIME_WAIT_DECAY_S);
    }
  });
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const BEDTIME_CLOSE_LENGTH_MS = 450;
const BEDTIME_CLOSE_HZ = { from: 880, to: 440 };
const BEDTIME_CLOSE_ATTACK_MS = 6;
const BEDTIME_CLOSE_DECAY_S = 0.14;

/** A small glassy « tink » that falls: the eyelids close, the signal to go (cue `bedtime_eyes_closed`). */
export function synthBabyEyesClose(): Float32Array {
  const rng = createRng(SEED + 29);
  const out = new Float32Array(samplesOf(BEDTIME_CLOSE_LENGTH_MS));
  const attack = samplesOf(BEDTIME_CLOSE_ATTACK_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      BEDTIME_CLOSE_HZ.to +
      (BEDTIME_CLOSE_HZ.from - BEDTIME_CLOSE_HZ.to) * Math.exp(-seconds / BEDTIME_CLOSE_DECAY_S);
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const click = i < attack ? (nextFloat(rng) * 2 - 1) * 0.4 : 0;
    out[i] =
      (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + click) *
      Math.min(1, i / attack) *
      Math.exp(-seconds / BEDTIME_CLOSE_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const BEDTIME_REOPEN_LENGTH_MS = 600;
const BEDTIME_REOPEN_HZ = { from: 300, to: 520 };
const BEDTIME_REOPEN_ATTACK_MS = 20;
const BEDTIME_REOPEN_RELEASE_MS = 200;
const BEDTIME_REOPEN_VIBRATO_HZ = 7;

/** A sleepy « huh? » rising: the eyes snap open again, the gag (cue `gag_baby_eyes_reopened`). */
export function synthGagBabyEyesReopened(): Float32Array {
  const rng = createRng(SEED + 30);
  const out = new Float32Array(samplesOf(BEDTIME_REOPEN_LENGTH_MS));
  const attack = samplesOf(BEDTIME_REOPEN_ATTACK_MS);
  const release = samplesOf(BEDTIME_REOPEN_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      (BEDTIME_REOPEN_HZ.from + (BEDTIME_REOPEN_HZ.to - BEDTIME_REOPEN_HZ.from) * progress) *
      (1 + 0.04 * Math.sin(2 * Math.PI * BEDTIME_REOPEN_VIBRATO_HZ * seconds));
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const breath = (nextFloat(rng) * 2 - 1) * 0.15;
    out[i] =
      (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + breath) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const FAKE_SLEEP_TEL_LENGTH_MS = 800;
const FAKE_SLEEP_TEL_HZ = { from: 165, to: 135 };
const FAKE_SLEEP_TEL_BREATHS = 2;
const FAKE_SLEEP_TEL_NOISE_GAIN = 1;

/** Two slow soft breaths, the baby sleeping, or so it seems (cue `tel_fake_sleep`): a swell twice, no attack at all. */
export function synthTelegraphFakeSleep(): Float32Array {
  const rng = createRng(SEED + 32);
  const out = new Float32Array(samplesOf(FAKE_SLEEP_TEL_LENGTH_MS));
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      FAKE_SLEEP_TEL_HZ.from + (FAKE_SLEEP_TEL_HZ.to - FAKE_SLEEP_TEL_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    noise += 0.04 * (nextFloat(rng) * 2 - 1 - noise);
    const swell = Math.sin(Math.PI * ((progress * FAKE_SLEEP_TEL_BREATHS) % 1)) ** 2;
    out[i] = (Math.sin(phase) + noise * FAKE_SLEEP_TEL_NOISE_GAIN) * swell;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const EYE_PEEK_LENGTH_MS = 380;
const EYE_PEEK_HZ = { from: 440, to: 740 };
const EYE_PEEK_ATTACK_MS = 12;
const EYE_PEEK_DECAY_S = 0.13;

/**
 * A soft glassy « tink » that rises at its end, close kin to `baby_eyes_close` (which falls): a careless
 * ear takes it for the signal, a listening one does not (cue `fake_sleep_eye_peeks`, story 4.7).
 */
export function synthBabyEyePeek(): Float32Array {
  const rng = createRng(SEED + 33);
  const out = new Float32Array(samplesOf(EYE_PEEK_LENGTH_MS));
  const attack = samplesOf(EYE_PEEK_ATTACK_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const progress = i / out.length;
    const frequencyHz = EYE_PEEK_HZ.from + (EYE_PEEK_HZ.to - EYE_PEEK_HZ.from) * progress ** 2;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const click = i < attack ? (nextFloat(rng) * 2 - 1) * 0.2 : 0;
    out[i] =
      (Math.sin(phase) + 0.2 * Math.sin(2 * phase) + click) *
      Math.min(1, i / attack) *
      Math.exp(-seconds / EYE_PEEK_DECAY_S);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const SAT_UP_LENGTH_MS = 700;
const SAT_UP_STEPS_HZ = [340, 520];
const SAT_UP_ATTACK_MS = 15;
const SAT_UP_RELEASE_MS = 220;
const SAT_UP_WOBBLE_HZ = 9;

/** A startled « oh! » in two rising steps: the baby sits up, wide awake, the gag (cue `gag_baby_sat_up`). */
export function synthGagBabySatUp(): Float32Array {
  const rng = createRng(SEED + 34);
  const out = new Float32Array(samplesOf(SAT_UP_LENGTH_MS));
  const attack = samplesOf(SAT_UP_ATTACK_MS);
  const release = samplesOf(SAT_UP_RELEASE_MS);
  const stepSamples = Math.floor(out.length / SAT_UP_STEPS_HZ.length);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const stepIndex = Math.min(SAT_UP_STEPS_HZ.length - 1, Math.floor(i / stepSamples));
    const frequencyHz =
      (SAT_UP_STEPS_HZ[stepIndex] as number) *
      (1 + 0.05 * Math.sin(2 * Math.PI * SAT_UP_WOBBLE_HZ * seconds));
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const stepAttack = Math.min(1, (i % stepSamples) / attack);
    const breath = (nextFloat(rng) * 2 - 1) * 0.1;
    out[i] =
      (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + breath) *
      stepAttack *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const BEDTIME_HUSH_LENGTH_S = 8;
const BEDTIME_HUSH_HZ = [98, 147];
const BEDTIME_HUSH_SWAY_HZ = 1 / 8;
const BEDTIME_HUSH_BREATH_GAIN = 0.25;

/**
 * The duel's hush (loop `sequenceMusic.bedtime_duel`): a very quiet low drone under a breath of noise,
 * with no pulse at all, because a pulse would suggest a rhythm to read. Both tones and the swell make
 * whole cycles over the loop.
 */
export function synthBedtimeHush(): Float32Array {
  const rng = createRng(SEED + 31);
  const out = new Float32Array(samplesOf(BEDTIME_HUSH_LENGTH_S * 1000));
  let breath = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let tone = 0;
    for (const frequencyHz of BEDTIME_HUSH_HZ)
      tone += Math.sin(2 * Math.PI * frequencyHz * seconds);
    breath += 0.002 * (nextFloat(rng) * 2 - 1 - breath);
    const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * BEDTIME_HUSH_SWAY_HZ * seconds);
    out[i] = (tone / BEDTIME_HUSH_HZ.length + breath * BEDTIME_HUSH_BREATH_GAIN * 20) * swell;
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC * 0.5);
  return out;
}

const BOMB_DROP_TEL_LENGTH_MS = 900;
const BOMB_DROP_TEL_HZ = { from: 230, to: 105 };
const BOMB_DROP_TEL_CREAK_HZ = 23;
const BOMB_DROP_TEL_ATTACK_MS = 40;
const BOMB_DROP_TEL_RELEASE_MS = 260;

/**
 * A slow wooden creak that sinks in pitch, « on le descend » (cue `tel_bomb_drop`, story 4.8): a falling
 * tone shaken by a fast amplitude flutter, and a thread of noise. No kin to the other telegraphs.
 */
export function synthTelegraphBombDrop(): Float32Array {
  const rng = createRng(SEED + 35);
  const out = new Float32Array(samplesOf(BOMB_DROP_TEL_LENGTH_MS));
  const attack = samplesOf(BOMB_DROP_TEL_ATTACK_MS);
  const release = samplesOf(BOMB_DROP_TEL_RELEASE_MS);
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const progress = i / out.length;
    const frequencyHz =
      BOMB_DROP_TEL_HZ.from + (BOMB_DROP_TEL_HZ.to - BOMB_DROP_TEL_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    noise += 0.08 * (nextFloat(rng) * 2 - 1 - noise);
    const creak = 0.65 + 0.35 * Math.sin(2 * Math.PI * BOMB_DROP_TEL_CREAK_HZ * seconds);
    out[i] =
      (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + noise * 0.6) *
      creak *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const MATTRESS_TOUCH_LENGTH_MS = 450;
const MATTRESS_TOUCH_HZ = 68;
const MATTRESS_TOUCH_DECAY_S = 0.09;
const MATTRESS_TOUCH_PUFF_MS = 120;

/** A soft thud and a puff of air, the baby touching the mattress (cue `bomb_drop_touchdown`): « LÂCHE ! ». */
export function synthBabyMattressTouch(): Float32Array {
  const rng = createRng(SEED + 36);
  const out = new Float32Array(samplesOf(MATTRESS_TOUCH_LENGTH_MS));
  const puff = samplesOf(MATTRESS_TOUCH_PUFF_MS);
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    noise += 0.05 * (nextFloat(rng) * 2 - 1 - noise);
    const thud =
      Math.sin(2 * Math.PI * MATTRESS_TOUCH_HZ * seconds) *
      Math.exp(-seconds / MATTRESS_TOUCH_DECAY_S);
    const air = i < puff ? noise * (1 - i / puff) * 1.5 : 0;
    out[i] = thud + air;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const WOKE_ON_DROP_LENGTH_MS = 800;
const WOKE_ON_DROP_HZ = { from: 380, peak: 690, to: 460 };
const WOKE_ON_DROP_ATTACK_MS = 20;
const WOKE_ON_DROP_RELEASE_MS = 240;
const WOKE_ON_DROP_WOBBLE_HZ = 11;

/** A shocked wail that jumps up and sags, the baby waking as he is laid down (cue `gag_baby_woke_on_drop`). */
export function synthGagBabyWokeOnDrop(): Float32Array {
  const rng = createRng(SEED + 37);
  const out = new Float32Array(samplesOf(WOKE_ON_DROP_LENGTH_MS));
  const attack = samplesOf(WOKE_ON_DROP_ATTACK_MS);
  const release = samplesOf(WOKE_ON_DROP_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const progress = i / out.length;
    const base =
      progress < 0.3
        ? WOKE_ON_DROP_HZ.from + (WOKE_ON_DROP_HZ.peak - WOKE_ON_DROP_HZ.from) * (progress / 0.3)
        : WOKE_ON_DROP_HZ.peak +
          (WOKE_ON_DROP_HZ.to - WOKE_ON_DROP_HZ.peak) * ((progress - 0.3) / 0.7);
    const frequencyHz =
      base * (1 + 0.04 * Math.sin(2 * Math.PI * WOKE_ON_DROP_WOBBLE_HZ * seconds));
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const breath = (nextFloat(rng) * 2 - 1) * 0.12;
    out[i] =
      (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + breath) *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const BOMB_THRILLER_LENGTH_S = 4;
const BOMB_THRILLER_DRONE_HZ = [55, 78];
const BOMB_THRILLER_BEAT_PERIOD_S = 1;
const BOMB_THRILLER_THUMP_HZ = 62;
const BOMB_THRILLER_THUMP_DECAY_S = 0.07;
const BOMB_THRILLER_SECOND_THUMP_S = 0.28;
const BOMB_THRILLER_TENSION_HZ = 440;

/**
 * The drop's thriller loop (loop `sequenceMusic.bomb_drop`): a heartbeat every second over a dark
 * two-tone drone, and a thin tone that swells once over the loop. Short on purpose (the level's audio
 * budget); the drone and the swell make whole cycles over the loop so that it does not click.
 */
export function synthBombThriller(): Float32Array {
  const rng = createRng(SEED + 38);
  const out = new Float32Array(samplesOf(BOMB_THRILLER_LENGTH_S * 1000));
  let breath = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let drone = 0;
    for (const frequencyHz of BOMB_THRILLER_DRONE_HZ) {
      drone += Math.sin(2 * Math.PI * frequencyHz * seconds);
    }
    drone /= BOMB_THRILLER_DRONE_HZ.length;
    const sinceBeat = seconds % BOMB_THRILLER_BEAT_PERIOD_S;
    const thump =
      Math.sin(2 * Math.PI * BOMB_THRILLER_THUMP_HZ * sinceBeat) *
        Math.exp(-sinceBeat / BOMB_THRILLER_THUMP_DECAY_S) +
      (sinceBeat >= BOMB_THRILLER_SECOND_THUMP_S
        ? 0.7 *
          Math.sin(
            2 * Math.PI * BOMB_THRILLER_THUMP_HZ * (sinceBeat - BOMB_THRILLER_SECOND_THUMP_S),
          ) *
          Math.exp(-(sinceBeat - BOMB_THRILLER_SECOND_THUMP_S) / BOMB_THRILLER_THUMP_DECAY_S)
        : 0);
    const swell = Math.sin((Math.PI * seconds) / BOMB_THRILLER_LENGTH_S) ** 2;
    const tension = Math.sin(2 * Math.PI * BOMB_THRILLER_TENSION_HZ * seconds) * swell * 0.12;
    breath += 0.002 * (nextFloat(rng) * 2 - 1 - breath);
    out[i] = drone * 0.5 + thump + tension + breath * 4;
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC * 0.6);
  return out;
}

// The infiltration's placeholders (story 4.9), seeds `SEED + 39` to `+ 46`: the baby's sigh and his real
// wake-up, the soft « all is well », the two ways to wake him, a creaking board, a breath let out and
// a short loop of held-breath tension.

const SIGH_TEL_LENGTH_MS = 700;
const SIGH_TEL_HZ = { from: 250, to: 150 };
const SIGH_TEL_ATTACK_MS = 120;
const SIGH_TEL_RELEASE_MS = 300;

/** A long, soft breath out with a falling hum under it: the false alarm's telegraph (cue `tel_false_alarm_sigh`). */
export function synthTelegraphFalseAlarmSigh(): Float32Array {
  const rng = createRng(SEED + 39);
  const out = new Float32Array(samplesOf(SIGH_TEL_LENGTH_MS));
  const attack = samplesOf(SIGH_TEL_ATTACK_MS);
  const release = samplesOf(SIGH_TEL_RELEASE_MS);
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz = SIGH_TEL_HZ.from + (SIGH_TEL_HZ.to - SIGH_TEL_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    noise += 0.2 * (nextFloat(rng) * 2 - 1 - noise);
    out[i] =
      (0.6 * Math.sin(phase) + 0.9 * noise) *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const REAL_WAKE_TEL_PULSE_MS = 170;
const REAL_WAKE_TEL_GAP_MS = 60;
const REAL_WAKE_TEL_HZ = [540, 720];
const REAL_WAKE_TEL_ATTACK_MS = 6;
const REAL_WAKE_TEL_RELEASE_MS = 70;
const REAL_WAKE_TEL_VIBRATO_HZ = 14;

/** Two quick, rising whimpers: the real wake's telegraph (cue `tel_real_wake`), sharp where the sigh is soft. */
export function synthTelegraphRealWake(): Float32Array {
  const pulse = samplesOf(REAL_WAKE_TEL_PULSE_MS);
  const gap = samplesOf(REAL_WAKE_TEL_GAP_MS);
  const out = new Float32Array(
    pulse * REAL_WAKE_TEL_HZ.length + gap * (REAL_WAKE_TEL_HZ.length - 1),
  );
  const attack = samplesOf(REAL_WAKE_TEL_ATTACK_MS);
  const release = samplesOf(REAL_WAKE_TEL_RELEASE_MS);
  REAL_WAKE_TEL_HZ.forEach((baseHz, index) => {
    const start = index * (pulse + gap);
    let phase = 0;
    for (let i = 0; i < pulse; i++) {
      const seconds = i / SAMPLE_RATE_HZ;
      const frequencyHz =
        baseHz *
        (1 + 0.25 * (i / pulse)) *
        (1 + 0.05 * Math.sin(2 * Math.PI * REAL_WAKE_TEL_VIBRATO_HZ * seconds));
      phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      out[start + i] =
        (Math.sin(phase) + 0.45 * Math.sin(2 * phase)) *
        Math.min(1, i / attack) *
        Math.min(1, (pulse - i) / release);
    }
  });
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const RESP_NOTHING_LENGTH_MS = 380;
const RESP_NOTHING_HZ = 196;
const RESP_NOTHING_ATTACK_MS = 60;
const RESP_NOTHING_RELEASE_MS = 200;

/** A low, round « mm »: all is well (cue `resp_nothing`), the quietest of the responses. */
export function synthRespNothing(): Float32Array {
  const out = new Float32Array(samplesOf(RESP_NOTHING_LENGTH_MS));
  const attack = samplesOf(RESP_NOTHING_ATTACK_MS);
  const release = samplesOf(RESP_NOTHING_RELEASE_MS);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    out[i] =
      (Math.sin(2 * Math.PI * RESP_NOTHING_HZ * seconds) +
        0.3 * Math.sin(2 * Math.PI * RESP_NOTHING_HZ * 1.5 * seconds)) *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const WOKE_BY_TOUCH_LENGTH_MS = 650;
const WOKE_BY_TOUCH_HZ = { from: 880, to: 520 };
const WOKE_BY_TOUCH_ATTACK_MS = 8;
const WOKE_BY_TOUCH_RELEASE_MS = 220;
const WOKE_BY_TOUCH_JITTER = 0.2;

/** A sharp little shriek that falls away: the baby woken by a touch (cue `gag_baby_woke_by_touch`). */
export function synthGagBabyWokeByTouch(): Float32Array {
  const rng = createRng(SEED + 42);
  const out = new Float32Array(samplesOf(WOKE_BY_TOUCH_LENGTH_MS));
  const attack = samplesOf(WOKE_BY_TOUCH_ATTACK_MS);
  const release = samplesOf(WOKE_BY_TOUCH_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      (WOKE_BY_TOUCH_HZ.from + (WOKE_BY_TOUCH_HZ.to - WOKE_BY_TOUCH_HZ.from) * progress ** 0.5) *
      (1 + WOKE_BY_TOUCH_JITTER * 0.1 * (nextFloat(rng) * 2 - 1));
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] =
      (Math.sign(Math.sin(phase)) * 0.35 + Math.sin(phase)) *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const WOKE_CRYING_LENGTH_MS = 950;
const WOKE_CRYING_HZ = { from: 330, peak: 590, to: 300 };
const WOKE_CRYING_SOBS = 3;
const WOKE_CRYING_ATTACK_MS = 30;
const WOKE_CRYING_RELEASE_MS = 260;

/** A long wail in three sobs: the baby woken for real and left crying (cue `gag_baby_woke_crying`). */
export function synthGagBabyWokeCrying(): Float32Array {
  const out = new Float32Array(samplesOf(WOKE_CRYING_LENGTH_MS));
  const attack = samplesOf(WOKE_CRYING_ATTACK_MS);
  const release = samplesOf(WOKE_CRYING_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const base =
      progress < 0.4
        ? WOKE_CRYING_HZ.from + (WOKE_CRYING_HZ.peak - WOKE_CRYING_HZ.from) * (progress / 0.4)
        : WOKE_CRYING_HZ.peak +
          (WOKE_CRYING_HZ.to - WOKE_CRYING_HZ.peak) * ((progress - 0.4) / 0.6);
    phase += (2 * Math.PI * base) / SAMPLE_RATE_HZ;
    const sob = 0.55 + 0.45 * Math.sin(2 * Math.PI * WOKE_CRYING_SOBS * progress) ** 2;
    out[i] =
      (Math.sin(phase) + 0.6 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) *
      sob *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const CREAK_LENGTH_MS = 420;
const CREAK_HZ = { from: 95, to: 160 };
const CREAK_STICK_HZ = 37;
const CREAK_ATTACK_MS = 15;
const CREAK_RELEASE_MS = 140;

/** A board giving under a foot: a rough, stick-slip groan that slides up (cue `floor_creak`, clip `env_floor_creak`). */
export function synthFloorCreak(): Float32Array {
  const rng = createRng(SEED + 44);
  const out = new Float32Array(samplesOf(CREAK_LENGTH_MS));
  const attack = samplesOf(CREAK_ATTACK_MS);
  const release = samplesOf(CREAK_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const progress = i / out.length;
    const frequencyHz = CREAK_HZ.from + (CREAK_HZ.to - CREAK_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const stick = Math.sin(2 * Math.PI * CREAK_STICK_HZ * seconds) > -0.3 ? 1 : 0.25;
    const saw = ((phase / (2 * Math.PI)) % 1) * 2 - 1;
    out[i] =
      (saw * 0.8 + (nextFloat(rng) * 2 - 1) * 0.25) *
      stick *
      Math.min(1, i / attack) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const GASP_LENGTH_MS = 320;
const GASP_ATTACK_MS = 20;
const GASP_RELEASE_MS = 150;
const GASP_SMOOTHING = 0.35;

/** A breath let out too soon: a short burst of airy noise (cue `breath_gasped`, clip `papa_breath_gasp`). */
export function synthBreathGasp(): Float32Array {
  const rng = createRng(SEED + 45);
  const out = new Float32Array(samplesOf(GASP_LENGTH_MS));
  const attack = samplesOf(GASP_ATTACK_MS);
  const release = samplesOf(GASP_RELEASE_MS);
  let noise = 0;
  for (let i = 0; i < out.length; i++) {
    noise += GASP_SMOOTHING * (nextFloat(rng) * 2 - 1 - noise);
    out[i] = noise * Math.min(1, i / attack) * Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// The final rush's placeholders (story 3.5), seeds `SEED + 47` and `+ 48`: the key in the door's lock
// and the soft pop of a prop put back.
const DOOR_KEY_LENGTH_MS = 620;
/** A key turning: two metal clicks (the bolt, then the latch), a scrape between them. */
const DOOR_KEY_CLICKS_S = [0.02, 0.34];
const DOOR_KEY_CLICK_DECAY_S = 0.018;
const DOOR_KEY_CLICK_HZ = 1850;
const DOOR_KEY_SCRAPE_FROM_S = 0.08;
const DOOR_KEY_SCRAPE_TO_S = 0.3;
const DOOR_KEY_SCRAPE_GAIN = 0.18;
const DOOR_KEY_SMOOTHING = 0.5;

/** A key turning in a lock, then the door giving way (cue `final_rush_started`, clip `env_door_key`). */
export function synthDoorKey(): Float32Array {
  const rng = createRng(SEED + 47);
  const out = new Float32Array(samplesOf(DOOR_KEY_LENGTH_MS));
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    smoothed += DOOR_KEY_SMOOTHING * (nextFloat(rng) * 2 - 1 - smoothed);
    let value = 0;
    for (const clickAt of DOOR_KEY_CLICKS_S) {
      const age = seconds - clickAt;
      if (age < 0) continue;
      const decay = Math.exp(-age / DOOR_KEY_CLICK_DECAY_S);
      value += (Math.sin(2 * Math.PI * DOOR_KEY_CLICK_HZ * age) * 0.7 + smoothed * 0.5) * decay;
    }
    if (seconds > DOOR_KEY_SCRAPE_FROM_S && seconds < DOOR_KEY_SCRAPE_TO_S) {
      value += smoothed * DOOR_KEY_SCRAPE_GAIN;
    }
    out[i] = value;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TIDIED_LENGTH_MS = 200;
const TIDIED_PITCH_HZ = { from: 360, to: 620 };
const TIDIED_ATTACK_MS = 6;
const TIDIED_RELEASE_MS = 90;

/** A prop set back in its place: a short, soft rising pop (cue `prop_tidied`, clip `env_prop_tidied`). */
export function synthPropTidied(): Float32Array {
  const rng = createRng(SEED + 48);
  const out = new Float32Array(samplesOf(TIDIED_LENGTH_MS));
  const attack = samplesOf(TIDIED_ATTACK_MS);
  const release = samplesOf(TIDIED_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const frequencyHz =
      TIDIED_PITCH_HZ.from + (TIDIED_PITCH_HZ.to - TIDIED_PITCH_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    out[i] =
      (Math.sin(phase) + (nextFloat(rng) * 2 - 1) * 0.04) *
      Math.exp(-progress * 3) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// The end photo's shutter (story 3.6), seed `SEED + 49`: a camera taking the picture.
const SHUTTER_LENGTH_MS = 260;
/** Two clicks, the mirror then the curtain, close together like a small camera's. */
const SHUTTER_CLICKS_S = [0.015, 0.105];
const SHUTTER_CLICK_DECAY_S = 0.014;
const SHUTTER_CLICK_HZ = 2400;
const SHUTTER_THUMP_HZ = 140;
const SHUTTER_THUMP_DECAY_S = 0.05;
const SHUTTER_THUMP_GAIN = 0.55;
const SHUTTER_SMOOTHING = 0.6;
/** The little whir of the flash charging, after the clicks. */
const SHUTTER_WHIR_FROM_S = 0.13;
const SHUTTER_WHIR_PITCH_HZ = { from: 900, to: 2600 };
const SHUTTER_WHIR_GAIN = 0.16;

/** A camera shutter: two crisp clicks over a soft thump, then a faint rising whir (cue `photo_taken`, clip `ui_camera_shutter`). */
export function synthCameraShutter(): Float32Array {
  const rng = createRng(SEED + 49);
  const out = new Float32Array(samplesOf(SHUTTER_LENGTH_MS));
  const lengthS = SHUTTER_LENGTH_MS / 1000;
  let smoothed = 0;
  let whirPhase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    smoothed += SHUTTER_SMOOTHING * (nextFloat(rng) * 2 - 1 - smoothed);
    let value = 0;
    for (const clickAt of SHUTTER_CLICKS_S) {
      const age = seconds - clickAt;
      if (age < 0) continue;
      value +=
        (Math.sin(2 * Math.PI * SHUTTER_CLICK_HZ * age) * 0.6 + smoothed * 0.6) *
        Math.exp(-age / SHUTTER_CLICK_DECAY_S);
    }
    const thumpAge = seconds - (SHUTTER_CLICKS_S[0] as number);
    if (thumpAge >= 0) {
      value +=
        Math.sin(2 * Math.PI * SHUTTER_THUMP_HZ * thumpAge) *
        SHUTTER_THUMP_GAIN *
        Math.exp(-thumpAge / SHUTTER_THUMP_DECAY_S);
    }
    if (seconds > SHUTTER_WHIR_FROM_S) {
      const progress = (seconds - SHUTTER_WHIR_FROM_S) / (lengthS - SHUTTER_WHIR_FROM_S);
      const frequencyHz =
        SHUTTER_WHIR_PITCH_HZ.from +
        (SHUTTER_WHIR_PITCH_HZ.to - SHUTTER_WHIR_PITCH_HZ.from) * progress;
      whirPhase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      value += Math.sin(whirPhase) * SHUTTER_WHIR_GAIN * (1 - progress);
    }
    out[i] = value;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const STEALTH_LOOP_LENGTH_S = 4;
const STEALTH_DRONE_HZ = [49, 73.5];
const STEALTH_TICK_PERIOD_S = 2;
const STEALTH_TICK_HZ = 1320;
const STEALTH_TICK_DECAY_S = 0.012;

/**
 * The infiltration's loop (loop `sequenceMusic.stealth_exit`): a very low drone and one dry tick every
 * two seconds, like a clock in a dark room. Short on purpose (the level's audio budget); both parts
 * make whole cycles over the loop so that it does not click.
 */
export function synthStealthLoop(): Float32Array {
  const rng = createRng(SEED + 46);
  const out = new Float32Array(samplesOf(STEALTH_LOOP_LENGTH_S * 1000));
  let air = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    let drone = 0;
    for (const frequencyHz of STEALTH_DRONE_HZ)
      drone += Math.sin(2 * Math.PI * frequencyHz * seconds);
    drone /= STEALTH_DRONE_HZ.length;
    const sinceTick = seconds % STEALTH_TICK_PERIOD_S;
    const tick =
      Math.sin(2 * Math.PI * STEALTH_TICK_HZ * sinceTick) *
      Math.exp(-sinceTick / STEALTH_TICK_DECAY_S);
    air += 0.004 * (nextFloat(rng) * 2 - 1 - air);
    out[i] = drone * 0.6 + tick * 0.5 + air * 3;
  }
  fadeEnds(out, LOOP_FADE_MS);
  normalize(out, PEAK_MUSIC * 0.6);
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

// Story 2.12: the refused tap on a busy Papa, and the bubble's ding when he is free again.
const BUSY_REFUSED_BONK_MS = 90;
const BUSY_REFUSED_GAP_MS = 110;
const BUSY_REFUSED_LENGTH_MS = 260;
const BUSY_REFUSED_PITCH_HZ = { from: 150, to: 90 };
const BUSY_REFUSED_DECAY_S = 0.035;
const BUSY_REFUSED_ATTACK_MS = 2;
const FREE_DING_LENGTH_MS = 420;
const FREE_DING_PITCH_HZ = 1568;
const FREE_DING_OVERTONE_RATIO = 2.76;
const FREE_DING_OVERTONE_GAIN = 0.25;
const FREE_DING_DECAY_S = 0.11;
const FREE_DING_ATTACK_MS = 3;
const FREE_DING_RELEASE_MS = 30;

/**
 * A dry low double « bonk »: two short dropping sines, a beat apart, a « nope » that is not alarming and
 * unlike the toilet's single `papa_bump` (cue `papa_busy_refused`, clip `papa_busy`).
 */
export function synthBusyRefused(): Float32Array {
  const out = new Float32Array(samplesOf(BUSY_REFUSED_LENGTH_MS));
  const attack = samplesOf(BUSY_REFUSED_ATTACK_MS);
  const bonk = samplesOf(BUSY_REFUSED_BONK_MS);
  const gap = samplesOf(BUSY_REFUSED_GAP_MS);
  for (const start of [0, gap]) {
    let phase = 0;
    for (let n = 0; n < bonk && start + n < out.length; n++) {
      const seconds = n / SAMPLE_RATE_HZ;
      const frequencyHz =
        BUSY_REFUSED_PITCH_HZ.to +
        (BUSY_REFUSED_PITCH_HZ.from - BUSY_REFUSED_PITCH_HZ.to) *
          Math.exp(-seconds / BUSY_REFUSED_DECAY_S);
      phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      const envelope =
        Math.min(1, n / attack, (bonk - n) / attack) * Math.exp(-seconds / BUSY_REFUSED_DECAY_S);
      out[start + n] = (out[start + n] ?? 0) + Math.sin(phase) * envelope;
    }
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** A small bell: a high sine and a bright inharmonic overtone, dying fast (cue `papa_free`, clip `ui_papa_free_ding`). */
export function synthFreeDing(): Float32Array {
  const out = new Float32Array(samplesOf(FREE_DING_LENGTH_MS));
  const attack = samplesOf(FREE_DING_ATTACK_MS);
  const release = samplesOf(FREE_DING_RELEASE_MS);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const tone =
      Math.sin(2 * Math.PI * FREE_DING_PITCH_HZ * seconds) +
      FREE_DING_OVERTONE_GAIN *
        Math.sin(2 * Math.PI * FREE_DING_PITCH_HZ * FREE_DING_OVERTONE_RATIO * seconds);
    const envelope =
      Math.min(1, i / attack, (out.length - i) / release) * Math.exp(-seconds / FREE_DING_DECAY_S);
    out[i] = tone * envelope;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// Story 2.13, seed `SEED + 50`: Papa's slurp at the first sip of his coffee (cue `papa_coffee_slurp`).
const SLURP_LENGTH_MS = 350;
const SLURP_ATTACK_MS = 40;
const SLURP_RELEASE_MS = 90;
/** The airy hiss of the sip, smoothed by a one-pole filter whose cutoff opens as he draws in. */
const SLURP_SMOOTHING = { from: 0.08, to: 0.45 };
const SLURP_HISS_GAIN = 0.9;
/** The liquid gurgle under it: a sine that glides up while it wobbles. */
const SLURP_GURGLE_PITCH_HZ = { from: 260, to: 620 };
const SLURP_GURGLE_WOBBLE_HZ = 38;
const SLURP_GURGLE_WOBBLE_DEPTH = 0.55;
const SLURP_GURGLE_GAIN = 0.4;

/**
 * A short rising sip: a hiss that brightens as it draws in over a wobbling gurgle, unlike the dry
 * double « bonk » of `papa_busy` (cue `papa_coffee_slurp`, clip `papa_coffee_slurp`).
 */
export function synthCoffeeSlurp(): Float32Array {
  const rng = createRng(SEED + 50);
  const out = new Float32Array(samplesOf(SLURP_LENGTH_MS));
  const attack = samplesOf(SLURP_ATTACK_MS);
  const release = samplesOf(SLURP_RELEASE_MS);
  let smoothed = 0;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const smoothing = SLURP_SMOOTHING.from + (SLURP_SMOOTHING.to - SLURP_SMOOTHING.from) * progress;
    smoothed += smoothing * (nextFloat(rng) * 2 - 1 - smoothed);
    const frequencyHz =
      SLURP_GURGLE_PITCH_HZ.from +
      (SLURP_GURGLE_PITCH_HZ.to - SLURP_GURGLE_PITCH_HZ.from) * progress;
    phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
    const wobble =
      1 -
      SLURP_GURGLE_WOBBLE_DEPTH *
        (0.5 + 0.5 * Math.sin((2 * Math.PI * SLURP_GURGLE_WOBBLE_HZ * i) / SAMPLE_RATE_HZ));
    const envelope = Math.min(1, i / attack, (out.length - i) / release) * (0.4 + 0.6 * progress);
    out[i] = (smoothed * SLURP_HISS_GAIN + Math.sin(phase) * SLURP_GURGLE_GAIN * wobble) * envelope;
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

/** Length of the pot's telegraph (story 9.5), in ms. */
const TEL_POT_LENGTH_MS = 800;
/** The pot's simmer: the starting pitch of the bubbles in Hz, and how far they rise over the clip. */
const TEL_POT_BUBBLE_HZ = 220;
const TEL_POT_BUBBLE_RISE_HZ = 260;
/** The bubbles pop this many times a second. */
const TEL_POT_BUBBLE_RATE_HZ = 9;
/** The hiss of the steam under the bubbles: the share of the noise in the mix, in percent. */
const TEL_POT_HISS_PCT = 35;
const TEL_POT_ATTACK_MS = 15;
const TEL_POT_RELEASE_MS = 120;

/** A pot coming to the boil (cue `tel_pot_on_stove`, story 9.5): rising bubbling pops over a thin hiss. */
export function synthTelegraphPot(): Float32Array {
  const rng = createRng(SEED + 51);
  const out = new Float32Array(samplesOf(TEL_POT_LENGTH_MS));
  const attack = samplesOf(TEL_POT_ATTACK_MS);
  const release = samplesOf(TEL_POT_RELEASE_MS);
  let phase = 0;
  let hiss = 0;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    const seconds = i / SAMPLE_RATE_HZ;
    // Each bubble is a short swell of a sine that climbs a little, like a bubble rising.
    const bubble = (seconds * TEL_POT_BUBBLE_RATE_HZ) % 1;
    const pop = Math.exp(-bubble * 7);
    phase +=
      (2 * Math.PI * (TEL_POT_BUBBLE_HZ + TEL_POT_BUBBLE_RISE_HZ * progress * (1 - bubble))) /
      SAMPLE_RATE_HZ;
    hiss += 0.3 * (nextFloat(rng) * 2 - 1 - hiss);
    out[i] =
      (pop * Math.sin(phase) + (TEL_POT_HISS_PCT / 100) * progress * hiss) *
      Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_DISHWASHER_LENGTH_MS = 700;
/** The door's latch letting go: a low thud at the start, how long it rings and its pitch in Hz. */
const TEL_DISHWASHER_THUD_HZ = 95;
const TEL_DISHWASHER_THUD_MS = 130;
/** The plates in the rack rattling after it: three clinks, each with its start (ms from the clip start) and pitch in Hz. */
const TEL_DISHWASHER_CLINKS: readonly { atMs: number; hz: number }[] = [
  { atMs: 210, hz: 1850 },
  { atMs: 360, hz: 2430 },
  { atMs: 500, hz: 2970 },
];
/** How fast a clink dies away: the larger, the drier. */
const TEL_DISHWASHER_CLINK_DECAY = 38;
/** The clinks sit this far under the thud, in percent of its level. */
const TEL_DISHWASHER_CLINK_GAIN_PCT = 55;
const TEL_DISHWASHER_RELEASE_MS = 100;

/** A dishwasher door swinging open (cue `tel_dishwasher_open`, story 9.6): a latch thud, then plates rattling in the rack. */
export function synthTelegraphDishwasherOpen(): Float32Array {
  const rng = createRng(SEED + 52);
  const out = new Float32Array(samplesOf(TEL_DISHWASHER_LENGTH_MS));
  const release = samplesOf(TEL_DISHWASHER_RELEASE_MS);
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    // The thud: a sine that sags in pitch as it dies, with a click of noise at its very start.
    const thudProgress = (seconds * 1000) / TEL_DISHWASHER_THUD_MS;
    const thud =
      thudProgress < 1
        ? Math.exp(-thudProgress * 5) *
          (Math.sin(2 * Math.PI * TEL_DISHWASHER_THUD_HZ * seconds * (1 - 0.3 * thudProgress)) +
            0.5 * (nextFloat(rng) * 2 - 1) * Math.exp(-thudProgress * 30))
        : 0;
    let clinks = 0;
    for (const clink of TEL_DISHWASHER_CLINKS) {
      const since = seconds - clink.atMs / 1000;
      if (since < 0) continue;
      clinks +=
        Math.exp(-since * TEL_DISHWASHER_CLINK_DECAY) * Math.sin(2 * Math.PI * clink.hz * since);
    }
    out[i] =
      (thud + (TEL_DISHWASHER_CLINK_GAIN_PCT / 100) * clinks) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_TABLECLOTH_LENGTH_MS = 750;
/** The cloth being pulled: a swish of noise whose cutoff opens, over this many ms, and how soft it starts. */
const TEL_TABLECLOTH_SWISH_MS = 380;
const TEL_TABLECLOTH_SMOOTHING = { from: 0.05, to: 0.5 };
/** The dishes sliding after it: four rattles, each with its start (ms from the clip start) and pitch in Hz. */
const TEL_TABLECLOTH_RATTLES: readonly { atMs: number; hz: number }[] = [
  { atMs: 330, hz: 1500 },
  { atMs: 410, hz: 2150 },
  { atMs: 500, hz: 1750 },
  { atMs: 590, hz: 2600 },
];
const TEL_TABLECLOTH_RATTLE_DECAY = 45;
const TEL_TABLECLOTH_RATTLE_GAIN_PCT = 50;
const TEL_TABLECLOTH_RELEASE_MS = 90;

/** A tablecloth pulled with the dishes on it (cue `tel_tablecloth_pull`, story 9.7): a cloth swish, then plates rattling. */
export function synthTelegraphTablecloth(): Float32Array {
  const rng = createRng(SEED + 53);
  const out = new Float32Array(samplesOf(TEL_TABLECLOTH_LENGTH_MS));
  const release = samplesOf(TEL_TABLECLOTH_RELEASE_MS);
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const swishProgress = (seconds * 1000) / TEL_TABLECLOTH_SWISH_MS;
    const noise = nextFloat(rng) * 2 - 1;
    let swish = 0;
    if (swishProgress < 1) {
      const smoothing =
        TEL_TABLECLOTH_SMOOTHING.from +
        (TEL_TABLECLOTH_SMOOTHING.to - TEL_TABLECLOTH_SMOOTHING.from) * swishProgress;
      smoothed += smoothing * (noise - smoothed);
      swish = smoothed * Math.sin(Math.PI * swishProgress);
    }
    let rattles = 0;
    for (const rattle of TEL_TABLECLOTH_RATTLES) {
      const since = seconds - rattle.atMs / 1000;
      if (since < 0) continue;
      rattles +=
        Math.exp(-since * TEL_TABLECLOTH_RATTLE_DECAY) * Math.sin(2 * Math.PI * rattle.hz * since);
    }
    out[i] =
      (swish * 1.6 + (TEL_TABLECLOTH_RATTLE_GAIN_PCT / 100) * rattles) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_CABINET_LENGTH_MS = 650;
/** The door's creak: a saw-ish tone that glides up over the first part of the clip, in Hz and ms. */
const TEL_CABINET_CREAK_HZ = { from: 150, to: 310 };
const TEL_CABINET_CREAK_MS = 320;
const TEL_CABINET_CREAK_WOBBLE_HZ = 31;
/** The pans knocking inside, each with its start (ms from the clip start) and pitch in Hz. */
const TEL_CABINET_CLINKS: readonly { atMs: number; hz: number }[] = [
  { atMs: 360, hz: 740 },
  { atMs: 470, hz: 980 },
];
const TEL_CABINET_CLINK_DECAY = 22;
const TEL_CABINET_CLINK_GAIN_PCT = 70;
const TEL_CABINET_RELEASE_MS = 90;

/** A low cabinet door creaking open on the pans (cue `tel_low_cabinet_open`, story 9.7): a rising creak, then two metallic clinks. */
export function synthTelegraphCabinet(): Float32Array {
  const rng = createRng(SEED + 54);
  const out = new Float32Array(samplesOf(TEL_CABINET_LENGTH_MS));
  const release = samplesOf(TEL_CABINET_RELEASE_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const creakProgress = (seconds * 1000) / TEL_CABINET_CREAK_MS;
    let creak = 0;
    if (creakProgress < 1) {
      const frequencyHz =
        TEL_CABINET_CREAK_HZ.from +
        (TEL_CABINET_CREAK_HZ.to - TEL_CABINET_CREAK_HZ.from) * creakProgress;
      phase += (2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ;
      // A sawtooth with a little grit: the hinge.
      const saw = ((phase / (2 * Math.PI)) % 1) * 2 - 1;
      const wobble = 0.55 + 0.45 * Math.sin(2 * Math.PI * TEL_CABINET_CREAK_WOBBLE_HZ * seconds);
      creak =
        (0.7 * saw + 0.3 * (nextFloat(rng) * 2 - 1)) * wobble * Math.sin(Math.PI * creakProgress);
    }
    let clinks = 0;
    for (const clink of TEL_CABINET_CLINKS) {
      const since = seconds - clink.atMs / 1000;
      if (since < 0) continue;
      clinks +=
        Math.exp(-since * TEL_CABINET_CLINK_DECAY) * Math.sin(2 * Math.PI * clink.hz * since);
    }
    out[i] =
      (creak * 0.8 + (TEL_CABINET_CLINK_GAIN_PCT / 100) * clinks) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_BIN_LENGTH_MS = 800;
/** The lid flapping open: a hollow plastic « tonk » (two partials, in Hz) and how fast it dies. */
const TEL_BIN_FLAP_HZ = [290, 430] as const;
const TEL_BIN_FLAP_DECAY = 20;
/** The rustling of paper and peelings: bursts of noise at this rate, smoothed, in percent of the thump's level. */
const TEL_BIN_RUSTLE_RATE_HZ = 13;
const TEL_BIN_RUSTLE_SMOOTHING = 0.35;
const TEL_BIN_RUSTLE_GAIN_PCT = 80;
const TEL_BIN_RUSTLE_START_MS = 120;
const TEL_BIN_RELEASE_MS = 120;

/** A bin lid flapping open on a rummage (cue `tel_bin_rummage`, story 9.7): a hollow lid « tonk », then rustling. */
export function synthTelegraphBin(): Float32Array {
  const rng = createRng(SEED + 55);
  const out = new Float32Array(samplesOf(TEL_BIN_LENGTH_MS));
  const release = samplesOf(TEL_BIN_RELEASE_MS);
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const flap =
      Math.exp(-seconds * TEL_BIN_FLAP_DECAY) *
      (Math.sin(2 * Math.PI * TEL_BIN_FLAP_HZ[0] * seconds) +
        0.6 * Math.sin(2 * Math.PI * TEL_BIN_FLAP_HZ[1] * seconds));
    smoothed += TEL_BIN_RUSTLE_SMOOTHING * (nextFloat(rng) * 2 - 1 - smoothed);
    let rustle = 0;
    const rustleSeconds = seconds - TEL_BIN_RUSTLE_START_MS / 1000;
    if (rustleSeconds > 0) {
      // Each burst swells and dies, so it reads as a hand digging, not a hiss.
      const burst = (rustleSeconds * TEL_BIN_RUSTLE_RATE_HZ) % 1;
      rustle = smoothed * Math.sin(Math.PI * burst) ** 2;
    }
    out[i] =
      (flap + (TEL_BIN_RUSTLE_GAIN_PCT / 100) * rustle) * Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_PLANT_LENGTH_MS = 700;
/** The leaves brushed aside: noise through a one-pole filter, in bursts at this rate, and its smoothing. */
const TEL_PLANT_LEAF_RATE_HZ = 7;
const TEL_PLANT_LEAF_SMOOTHING = 0.6;
/** The soft dig under it: dull thuds with their start (ms from the clip start) and pitch in Hz. */
const TEL_PLANT_DIGS: readonly { atMs: number; hz: number }[] = [
  { atMs: 280, hz: 190 },
  { atMs: 430, hz: 165 },
  { atMs: 560, hz: 175 },
];
const TEL_PLANT_DIG_DECAY = 34;
const TEL_PLANT_DIG_GAIN_PCT = 70;
const TEL_PLANT_RELEASE_MS = 100;

/** A baby digging in the plant pot (cue `tel_plant_dig`, story 9.7): leaves rustling, then soft digs in the soil. */
export function synthTelegraphPlant(): Float32Array {
  const rng = createRng(SEED + 56);
  const out = new Float32Array(samplesOf(TEL_PLANT_LENGTH_MS));
  const release = samplesOf(TEL_PLANT_RELEASE_MS);
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    smoothed += TEL_PLANT_LEAF_SMOOTHING * (nextFloat(rng) * 2 - 1 - smoothed);
    const leaves =
      seconds < 0.45 ? smoothed * Math.sin(Math.PI * ((seconds * TEL_PLANT_LEAF_RATE_HZ) % 1)) : 0;
    let digs = 0;
    for (const dig of TEL_PLANT_DIGS) {
      const since = seconds - dig.atMs / 1000;
      if (since < 0) continue;
      digs += Math.exp(-since * TEL_PLANT_DIG_DECAY) * Math.sin(2 * Math.PI * dig.hz * since);
    }
    out[i] =
      (leaves * 0.9 + (TEL_PLANT_DIG_GAIN_PCT / 100) * digs) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

const TEL_MUG_LENGTH_MS = 600;
/** A cup scraping on wood: a rough, low-passed noise whose pitch-like grit slides, and how long the scrape lasts. */
const TEL_MUG_SCRAPE_MS = 420;
const TEL_MUG_SCRAPE_SMOOTHING = { from: 0.18, to: 0.07 };
const TEL_MUG_SCRAPE_GRIT_HZ = 52;
/** The little knock when it stops at the edge: its start (ms from the clip start), pitch in Hz and decay. */
const TEL_MUG_KNOCK = { atMs: 440, hz: 520, decay: 40 };
const TEL_MUG_KNOCK_GAIN_PCT = 80;
const TEL_MUG_RELEASE_MS = 80;

/** A mug scraped to the edge of the floor (cue `tel_papa_mug_low`, story 9.7): a rough wooden scrape, then a knock. */
export function synthTelegraphMug(): Float32Array {
  const rng = createRng(SEED + 57);
  const out = new Float32Array(samplesOf(TEL_MUG_LENGTH_MS));
  const release = samplesOf(TEL_MUG_RELEASE_MS);
  let smoothed = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const scrapeProgress = (seconds * 1000) / TEL_MUG_SCRAPE_MS;
    let scrape = 0;
    if (scrapeProgress < 1) {
      const smoothing =
        TEL_MUG_SCRAPE_SMOOTHING.from +
        (TEL_MUG_SCRAPE_SMOOTHING.to - TEL_MUG_SCRAPE_SMOOTHING.from) * scrapeProgress;
      smoothed += smoothing * (nextFloat(rng) * 2 - 1 - smoothed);
      const grit = 0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * TEL_MUG_SCRAPE_GRIT_HZ * seconds));
      scrape =
        smoothed *
        (0.4 + 0.6 * grit) *
        Math.min(1, scrapeProgress * 8) *
        (1 - 0.4 * scrapeProgress);
    }
    const since = seconds - TEL_MUG_KNOCK.atMs / 1000;
    const knock =
      since < 0
        ? 0
        : Math.exp(-since * TEL_MUG_KNOCK.decay) * Math.sin(2 * Math.PI * TEL_MUG_KNOCK.hz * since);
    out[i] =
      (scrape * 2.2 + (TEL_MUG_KNOCK_GAIN_PCT / 100) * knock) *
      Math.min(1, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

export const PLACEHOLDER_CLIPS: readonly { clip: string; synth: () => Float32Array }[] = [
  { clip: 'baby_babble_loop', synth: synthBabble },
  { clip: 'music_crawler_calm', synth: synthMusic },
  { clip: 'music_crawler_tense', synth: synthMusicTense },
  { clip: 'papa_bump', synth: synthBump },
  { clip: 'tel_outlet', synth: synthTelegraph },
  { clip: 'resp_parry', synth: synthParry },
  { clip: 'resp_firm', synth: synthFirm },
  { clip: 'baby_laugh_perfect', synth: synthBabyLaugh },
  { clip: 'gag_outlet', synth: synthGagOutlet },
  { clip: 'tel_stairs', synth: synthTelegraphStairs },
  { clip: 'gag_stairs', synth: synthGagStairs },
  { clip: 'tel_coffee_table', synth: synthTelegraphCoffeeTable },
  { clip: 'gag_coffee_table', synth: synthGagCoffeeTable },
  { clip: 'tel_papa_microsleep', synth: synthTelegraphMicroSleep },
  { clip: 'gag_papa_asleep', synth: synthGagPapaAsleep },
  { clip: 'tel_phone_ring', synth: synthTelegraphPhone },
  { clip: 'papa_phone_answer', synth: synthPhoneAnswer },
  { clip: 'tel_silence_found', synth: synthTelegraphSilence },
  { clip: 'gag_silence_mischief', synth: synthGagSilence },
  { clip: 'ui_star_stamp', synth: synthStarStamp },
  { clip: 'ui_star_stamp_last', synth: synthStarStampLast },
  { clip: 'env_door_slam', synth: synthDoorSlam },
  { clip: 'ui_star_lost', synth: synthStarLost },
  { clip: 'tel_arms_cry', synth: synthTelegraphArmsCry },
  { clip: 'gag_arms_wail', synth: synthGagArmsWail },
  { clip: 'baby_pickup', synth: synthBabyPickup },
  { clip: 'baby_putdown', synth: synthBabyPutdown },
  { clip: 'ui_combo_cash_in', synth: synthComboCashIn },
  { clip: 'papa_bladder_full', synth: synthBladderFull },
  { clip: 'papa_toilet_door', synth: synthToiletDoor },
  { clip: 'papa_heartbeat', synth: synthHeartbeat },
  { clip: 'env_toilet_flush', synth: synthToiletFlush },
  { clip: 'ui_calibration_beep', synth: synthCalibrationBeep },
  { clip: 'music_stay_awake', synth: synthSequenceMusic },
  { clip: 'papa_snore', synth: synthPapaSnore },
  { clip: 'baby_woke', synth: synthBabyWoke },
  { clip: 'env_sequence_started', synth: synthSequenceStarted },
  { clip: 'env_sequence_succeeded', synth: synthSequenceSucceeded },
  { clip: 'env_sequence_failed', synth: synthSequenceFailed },
  { clip: 'music_lullaby_note_1', synth: synthLullabyNote1 },
  { clip: 'music_lullaby_note_2', synth: synthLullabyNote2 },
  { clip: 'music_lullaby_note_3', synth: synthLullabyNote3 },
  { clip: 'music_lullaby_note_4', synth: synthLullabyNote4 },
  { clip: 'music_lullaby_tick', synth: synthLullabyTick },
  { clip: 'baby_lullaby_coo', synth: synthLullabyCoo },
  { clip: 'papa_lullaby_step', synth: synthLullabyStep },
  { clip: 'baby_stir', synth: synthBabyStir },
  { clip: 'music_lullaby_pad', synth: synthLullabyPad },
  { clip: 'tel_bedtime_eyes', synth: synthTelegraphBedtimeEyes },
  { clip: 'resp_wait', synth: synthRespWait },
  { clip: 'baby_eyes_close', synth: synthBabyEyesClose },
  { clip: 'gag_baby_eyes_reopened', synth: synthGagBabyEyesReopened },
  { clip: 'music_bedtime_hush', synth: synthBedtimeHush },
  { clip: 'tel_fake_sleep', synth: synthTelegraphFakeSleep },
  { clip: 'baby_eye_peek', synth: synthBabyEyePeek },
  { clip: 'gag_baby_sat_up', synth: synthGagBabySatUp },
  { clip: 'tel_bomb_drop', synth: synthTelegraphBombDrop },
  { clip: 'baby_mattress_touch', synth: synthBabyMattressTouch },
  { clip: 'gag_baby_woke_on_drop', synth: synthGagBabyWokeOnDrop },
  { clip: 'music_bomb_thriller', synth: synthBombThriller },
  { clip: 'tel_false_alarm_sigh', synth: synthTelegraphFalseAlarmSigh },
  { clip: 'tel_real_wake', synth: synthTelegraphRealWake },
  { clip: 'tel_pot_on_stove', synth: synthTelegraphPot },
  { clip: 'tel_dishwasher_open', synth: synthTelegraphDishwasherOpen },
  { clip: 'tel_tablecloth_pull', synth: synthTelegraphTablecloth },
  { clip: 'tel_low_cabinet_open', synth: synthTelegraphCabinet },
  { clip: 'tel_bin_rummage', synth: synthTelegraphBin },
  { clip: 'tel_plant_dig', synth: synthTelegraphPlant },
  { clip: 'tel_papa_mug_low', synth: synthTelegraphMug },
  { clip: 'resp_nothing', synth: synthRespNothing },
  { clip: 'gag_baby_woke_by_touch', synth: synthGagBabyWokeByTouch },
  { clip: 'gag_baby_woke_crying', synth: synthGagBabyWokeCrying },
  { clip: 'env_floor_creak', synth: synthFloorCreak },
  { clip: 'papa_breath_gasp', synth: synthBreathGasp },
  { clip: 'music_stealth', synth: synthStealthLoop },
  { clip: 'env_door_key', synth: synthDoorKey },
  { clip: 'env_prop_tidied', synth: synthPropTidied },
  { clip: 'ui_camera_shutter', synth: synthCameraShutter },
  { clip: 'papa_busy', synth: synthBusyRefused },
  { clip: 'ui_papa_free_ding', synth: synthFreeDing },
  { clip: 'papa_coffee_slurp', synth: synthCoffeeSlurp },
];

/**
 * The real sounds of stories 7.6 and 7.7 (`docs/audio-sources.md`), cut by `cutMusicLoop.ts`. Their synths
 * stay, but only naming one with `--only` writes it again. The babble's real file no longer matches its
 * synth in length, pauses or level.
 */
export const GENERATED_CLIPS: readonly string[] = [
  'baby_babble_loop',
  'music_crawler_calm',
  'music_crawler_tense',
  'music_stay_awake',
  'music_lullaby_pad',
  'music_bedtime_hush',
  'music_bomb_thriller',
  'music_stealth',
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

const KNOWN_CLIPS: readonly string[] = PLACEHOLDER_CLIPS.map(({ clip }) => clip);

const unknownClips = (
  names: readonly string[],
  known: readonly string[],
): Result<null, AppError> => {
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length === 0) return ok(null);
  return err({
    kind: 'assets',
    message: `unknown clip${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}; the known clips are ${known.join(', ')}`,
  });
};

/**
 * Reads `--only a,b,c` (or `--only=a,b,c`) from `argv`: the clips to regenerate. `null` when the
 * flag is absent (every clip, as before). A missing value, an empty name or a name that is not in
 * `known` is an `err` that lists the known names.
 */
export function parseOnly(
  argv: readonly string[],
  known: readonly string[],
): Result<string[] | null, AppError> {
  let value: string | undefined;
  let isGiven = false;
  for (const [index, arg] of argv.entries()) {
    if (arg === '--only') {
      isGiven = true;
      value = argv[index + 1];
    } else if (arg.startsWith('--only=')) {
      isGiven = true;
      value = arg.slice('--only='.length);
    }
  }
  if (!isGiven) return ok(null);
  const names = value?.split(',') ?? [];
  if (value === undefined || value.startsWith('--') || names.some((name) => name === '')) {
    return err({
      kind: 'assets',
      message: `--only needs a comma-separated list of clips, without empty names; the known clips are ${known.join(', ')}`,
    });
  }
  const checked = unknownClips(names, known);
  return checked.ok ? ok(names) : checked;
}

/**
 * Synthesizes the placeholder clips (all but `GENERATED_CLIPS`, or the `only` ones) and writes the `.m4a` files
 * into `outDir`, all or none of the selected clips: each clip is converted into a temporary
 * directory first, and `outDir` is touched only when every conversion has succeeded, so a failure
 * never leaves a mix of fresh, stale and truncated files (which `content:check` would accept, since
 * it only looks that a file exists). A clip outside `only` is never touched: a recorded file stays.
 */
export async function generatePlaceholderClips(
  outDir: string,
  convert: ConvertWav = afconvert,
  only: readonly string[] | null = null,
): Promise<Result<string[], AppError>> {
  if (only !== null) {
    const checked = unknownClips(only, KNOWN_CLIPS);
    if (!checked.ok) return checked;
  }
  const selected =
    only === null
      ? PLACEHOLDER_CLIPS.filter(({ clip }) => !GENERATED_CLIPS.includes(clip))
      : PLACEHOLDER_CLIPS.filter(({ clip }) => only.includes(clip));
  const work = await mkdtemp(join(tmpdir(), 'pp-audio-'));
  try {
    for (const { clip, synth } of selected) {
      const wavPath = join(work, `${clip}.wav`);
      await writeFile(wavPath, encodeWav(synth()));
      const converted = await convert(wavPath, join(work, `${clip}.m4a`));
      if (!converted.ok) {
        return err({ ...converted.error, message: `${clip}: ${converted.error.message}` });
      }
    }
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    for (const { clip } of selected) {
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
  const only = parseOnly(process.argv.slice(2), KNOWN_CLIPS);
  if (!only.ok) {
    log.error('assets', only.error.message);
    process.exitCode = 1;
    return;
  }
  const result = await generatePlaceholderClips(
    join(ROOT, 'public', 'assets', 'audio'),
    afconvert,
    only.value,
  );
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
