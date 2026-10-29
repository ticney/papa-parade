import { createRng, nextFloat, type RngState } from '@shared/rng';
import { normalize, PEAK_LOUD, resonate, SAMPLE_RATE_HZ, SEED, samplesOf } from './synthKit.ts';

// The cult sounds of story 2.3 (GDD › Audio et musique: « un son culte par réponse »): the toy
// squeak of the Parry, the cupboard clack of the Firmness and the baby's burst of laughter that
// joins them on a perfect. Synthesized and deterministic like every placeholder clip; real
// recordings replace the `.m4a` files under the same names (stories 7.5, or Geo's own). The numbers
// are sound design, named here, not game feel (nothing in `content/` reads them).

const TWO_PI = 2 * Math.PI;
const whiteNoise = (rng: RngState): number => nextFloat(rng) * 2 - 1;

// --- resp_parry: a rubber dog-toy squeak ------------------------------------------------------
// A reed whistle pushed by a squeeze: a bright tone whose pitch rises (« squee ») then falls
// (« eek »), a rough buzz and some air in the attack.
const PARRY_LENGTH_MS = 230;
const PARRY_TURN_MS = 80;
const PARRY_PITCH_HZ = { start: 1700, peak: 2500, end: 1500 };
/** Gains of the 2nd and 3rd harmonics, against a fundamental of 1. */
const PARRY_HARMONIC_GAINS = [0.35, 0.15];
const PARRY_BUZZ_HZ = 45;
const PARRY_BUZZ_DEPTH = 0.3;
const PARRY_AIR_GAIN = 0.12;
const PARRY_AIR_DECAY_S = 0.05;
const PARRY_ATTACK_MS = 4;
const PARRY_RELEASE_MS = 30;
/** The squeeze reverses at the turn: the level dips to this share, over this half-width. */
const PARRY_DIP = 0.7;
const PARRY_DIP_HALF_WIDTH_MS = 25;

/** A rubber toy squeak: « squee » up, « eek » down. */
export function synthParry(): Float32Array {
  const rng = createRng(SEED + 8);
  const out = new Float32Array(samplesOf(PARRY_LENGTH_MS));
  const turn = samplesOf(PARRY_TURN_MS);
  const attack = samplesOf(PARRY_ATTACK_MS);
  const release = samplesOf(PARRY_RELEASE_MS);
  const dipHalfWidth = samplesOf(PARRY_DIP_HALF_WIDTH_MS);
  let phase = 0;
  let previousNoise = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const frequencyHz =
      i < turn
        ? PARRY_PITCH_HZ.start + ((PARRY_PITCH_HZ.peak - PARRY_PITCH_HZ.start) * i) / turn
        : PARRY_PITCH_HZ.peak +
          ((PARRY_PITCH_HZ.end - PARRY_PITCH_HZ.peak) * (i - turn)) / (out.length - turn);
    phase += (TWO_PI * frequencyHz) / SAMPLE_RATE_HZ;
    let tone = Math.sin(phase);
    for (const [index, gain] of PARRY_HARMONIC_GAINS.entries()) {
      tone += gain * Math.sin((index + 2) * phase);
    }
    const rough = 1 - PARRY_BUZZ_DEPTH * (0.5 + 0.5 * Math.sin(TWO_PI * PARRY_BUZZ_HZ * seconds));
    // Air: white noise through a one-pole difference (a crude high-pass), loudest in the attack.
    const noise = whiteNoise(rng);
    const air = (noise - previousNoise) * PARRY_AIR_GAIN * Math.exp(-seconds / PARRY_AIR_DECAY_S);
    previousNoise = noise;
    const dip = Math.max(0, 1 - Math.abs(i - turn) / dipHalfWidth);
    const level = 1 - (1 - PARRY_DIP) * dip;
    out[i] = (tone * rough + air) * level * Math.min(1, i / attack, (out.length - i) / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// --- resp_firm: a dry wooden cupboard clack ---------------------------------------------------
// A short noise burst through a resonator around 750 Hz (the wood), a low body thump under it and
// a tiny rebound click: firm, not playful, so no pitch rise.
const FIRM_LENGTH_MS = 130;
const FIRM_BURST_MS = 5;
const FIRM_WOOD_HZ = 750;
const FIRM_WOOD_Q = 12;
const FIRM_WOOD_DECAY_S = 0.025;
const FIRM_THUMP_HZ = { from: 160, to: 120 };
const FIRM_THUMP_DECAY_S = 0.02;
const FIRM_THUMP_GAIN = 0.35;
const FIRM_REBOUND_AT_MS = 45;
const FIRM_REBOUND_GAIN = 0.35;
const FIRM_RELEASE_MS = 15;

/** A cupboard door shutting: a dry wooden clack with a little rebound. */
export function synthFirm(): Float32Array {
  const rng = createRng(SEED + 9);
  const out = new Float32Array(samplesOf(FIRM_LENGTH_MS));
  const burstLength = samplesOf(FIRM_BURST_MS);
  const burst = new Float32Array(out.length);
  for (let i = 0; i < burstLength; i++) burst[i] = whiteNoise(rng) * (1 - i / burstLength);
  const wood = resonate(burst, FIRM_WOOD_HZ, FIRM_WOOD_Q);
  for (let i = 0; i < wood.length; i++) {
    wood[i] = (wood[i] as number) * Math.exp(-i / SAMPLE_RATE_HZ / FIRM_WOOD_DECAY_S);
  }
  normalize(wood, 1);
  const reboundAt = samplesOf(FIRM_REBOUND_AT_MS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const seconds = i / SAMPLE_RATE_HZ;
    const thumpHz =
      FIRM_THUMP_HZ.to +
      (FIRM_THUMP_HZ.from - FIRM_THUMP_HZ.to) * Math.exp(-seconds / FIRM_THUMP_DECAY_S);
    phase += (TWO_PI * thumpHz) / SAMPLE_RATE_HZ;
    const thump = FIRM_THUMP_GAIN * Math.sin(phase) * Math.exp(-seconds / FIRM_THUMP_DECAY_S);
    const rebound = i >= reboundAt ? FIRM_REBOUND_GAIN * (wood[i - reboundAt] as number) : 0;
    out[i] = (wood[i] as number) + thump + rebound;
  }
  const release = samplesOf(FIRM_RELEASE_MS);
  for (let i = 0; i < release; i++) {
    const last = out.length - 1 - i;
    out[last] = (out[last] as number) * (i / release);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}

// --- baby_laugh_perfect: a burst of baby laughter ---------------------------------------------
// Five « ha » syllables, quickening then trailing, from a glottal source (harmonics of a high f0)
// shaped by the three formants of a child's /a/, with an aspirated « h » at each onset and a breathy
// inhale at the end. Jitter and a slight vibrato keep it from sounding like a beep.
const LAUGH_SYLLABLE_MS = [110, 95, 90, 90, 140];
const LAUGH_GAP_MS = [60, 50, 50, 70];
const LAUGH_SYLLABLE_GAIN = [1, 0.92, 0.85, 0.8, 0.72];
const LAUGH_F0_HZ = 480;
/** The pitch falls by this share across the whole laugh. */
const LAUGH_F0_FALL = 0.15;
/** Each syllable rises and falls by this share of its pitch (an arch). */
const LAUGH_ARCH = 0.08;
/** Each syllable's pitch is off by up to this share, drawn from the rng. */
const LAUGH_JITTER = 0.02;
const LAUGH_VIBRATO_HZ = 7;
const LAUGH_VIBRATO_DEPTH = 0.03;
const LAUGH_HARMONICS = 12;
const LAUGH_ASPIRATION_MS = 25;
const LAUGH_ASPIRATION_GAIN = 0.5;
const LAUGH_ATTACK_MS = 12;
const LAUGH_RELEASE_MS = 30;
/** Formants of a child's /a/: frequency, gain against F1, and the quality shared by the three. */
const LAUGH_FORMANTS = [
  { frequencyHz: 1050, gain: 1 },
  { frequencyHz: 1850, gain: 0.6 },
  { frequencyHz: 3500, gain: 0.25 },
];
const LAUGH_FORMANT_Q = 8;
const LAUGH_INHALE_GAP_MS = 25;
const LAUGH_INHALE_MS = 80;
const LAUGH_INHALE_HZ = 2200;
const LAUGH_INHALE_Q = 1.5;
/** The inhale against the voiced part (a fifth): it must never read as a sixth syllable. */
const LAUGH_INHALE_GAIN = 0.2;
const LAUGH_INHALE_SWELL_MS = 50;

/** A baby's burst of laughter: « ha-ha-ha-ha-ha » and a breath in. */
export function synthBabyLaugh(): Float32Array {
  const rng = createRng(SEED + 10);
  const syllables = LAUGH_SYLLABLE_MS.map(samplesOf);
  const gaps = LAUGH_GAP_MS.map(samplesOf);
  const voicedLength =
    syllables.reduce((sum, length) => sum + length, 0) +
    gaps.reduce((sum, length) => sum + length, 0);
  const inhaleGap = samplesOf(LAUGH_INHALE_GAP_MS);
  const inhaleLength = samplesOf(LAUGH_INHALE_MS);
  const out = new Float32Array(voicedLength + inhaleGap + inhaleLength);

  // The voiced source, syllable after syllable.
  const voiced = new Float32Array(voicedLength);
  const attack = samplesOf(LAUGH_ATTACK_MS);
  const release = samplesOf(LAUGH_RELEASE_MS);
  const aspiration = samplesOf(LAUGH_ASPIRATION_MS);
  let cursor = 0;
  for (const [index, length] of syllables.entries()) {
    const jitter = 1 + (nextFloat(rng) * 2 - 1) * LAUGH_JITTER;
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const position = cursor + i;
      const seconds = position / SAMPLE_RATE_HZ;
      const fall = 1 - (LAUGH_F0_FALL * position) / voicedLength;
      const arch = 1 + LAUGH_ARCH * Math.sin((Math.PI * i) / length);
      const vibrato = 1 + LAUGH_VIBRATO_DEPTH * Math.sin(TWO_PI * LAUGH_VIBRATO_HZ * seconds);
      const frequencyHz = LAUGH_F0_HZ * fall * arch * vibrato * jitter;
      phase += (TWO_PI * frequencyHz) / SAMPLE_RATE_HZ;
      let source = 0;
      for (let harmonic = 1; harmonic <= LAUGH_HARMONICS; harmonic++) {
        if (harmonic * frequencyHz >= SAMPLE_RATE_HZ / 2) break;
        source += Math.sin(harmonic * phase) / harmonic;
      }
      if (i < aspiration) {
        source += LAUGH_ASPIRATION_GAIN * whiteNoise(rng) * (1 - i / aspiration);
      }
      const envelope = Math.min(1, i / attack, (length - i) / release);
      voiced[position] = source * envelope * (LAUGH_SYLLABLE_GAIN[index] as number);
    }
    cursor += length + (gaps[index] ?? 0);
  }
  // The throat and mouth: three formants in parallel, then back to a known level.
  const shaped = new Float32Array(voicedLength);
  for (const { frequencyHz, gain } of LAUGH_FORMANTS) {
    const band = resonate(voiced, frequencyHz, LAUGH_FORMANT_Q);
    for (let i = 0; i < shaped.length; i++)
      shaped[i] = (shaped[i] as number) + gain * (band[i] as number);
  }
  normalize(shaped, 1);
  out.set(shaped);

  // The breath in: band-passed noise that swells, then stops.
  const breath = new Float32Array(inhaleLength);
  const swell = samplesOf(LAUGH_INHALE_SWELL_MS);
  for (let i = 0; i < inhaleLength; i++) {
    breath[i] =
      whiteNoise(rng) * Math.min(1, i / swell, (inhaleLength - i) / (inhaleLength - swell));
  }
  const breathy = resonate(breath, LAUGH_INHALE_HZ, LAUGH_INHALE_Q);
  normalize(breathy, LAUGH_INHALE_GAIN);
  const inhaleAt = voicedLength + inhaleGap;
  for (let i = 0; i < inhaleLength; i++) out[inhaleAt + i] = breathy[i] as number;

  out[0] = 0;
  out[out.length - 1] = 0;
  normalize(out, PEAK_LOUD);
  return out;
}
