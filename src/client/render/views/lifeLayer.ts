import type { Feel } from '@content/schemas/feel';
import { createSpring, resetSpring, type Spring, stepSpring } from './characterSpring.ts';
import { createPapaGazeSight, type PapaGazeSight } from './papaGaze.ts';

/** `feel.json › characters` (story 7.8): read from `world.feel` every frame, so the feel panel shows at once. */
export type CharactersFeel = Feel['characters'];

/**
 * What a frame of the life layer reads from the world and the screen, filled by the scene each frame
 * into one scratch object (nothing allocated).
 */
export interface LifeInputs {
  /** `world.gauges.fatigue`, 0 to 100. */
  fatigue: number;
  /** The catastrophe gauge is above `feel.catastrophe.alertPct`: the breath quickens. */
  isAlert: boolean;
  /** Papa holds his breath (the stealth exit, `world.sequence.stealth.breathHeldAt`). */
  isBreathHeld: boolean;
  isMotionReduced: boolean;
  /** Papa is responding: a glide, or a `respond_*` pose. */
  isResponding: boolean;
  /** What the screen shows (boot, one frame late: cosmetic). */
  readonly gazeSight: PapaGazeSight;
  /** Where the baby is drawn. */
  babyXM: number;
  babyZM: number;
  characters: CharactersFeel;
}

export function createLifeInputs(characters: CharactersFeel): LifeInputs {
  return {
    fatigue: 0,
    isAlert: false,
    isBreathHeld: false,
    isMotionReduced: false,
    isResponding: false,
    gazeSight: createPapaGazeSight(),
    babyXM: 0,
    babyZM: 0,
    characters,
  };
}

// The life layer's offsets over the clips (story 7.8, D6, D7, D9): the lean, the breath and the stoop,
// in degrees of the `spine` bone. Pure, no Three: the views turn them into rotations. Only the sim
// clock's `dtMs` and the world drive them, never real time or a PRNG (D12).

const MS_PER_S = 1000;
const RAD_TO_DEG = 180 / Math.PI;
/** The breath's envelope covers 0 to 1 in a quarter of a breath (D7). */
const BREATH_ENVELOPE_PERIODS = 4;
const BREATH_ENVELOPE_SNAP = 1e-9;
/** A drawn speed below this, in m/s, is standing still: no noise from the last few millimetres. */
const LEAN_SPEED_EPSILON_MPS = 1e-4;

/** `feel.json › characters.lean`. */
export interface LeanConfig {
  readonly maxAccelDeg: number;
  readonly maxTurnDeg: number;
  readonly fullAccelMps2: number;
  readonly fullTurnDegPerSec: number;
  readonly reachMs: number;
}

/** `feel.json › characters.breath`. */
export interface BreathConfig {
  readonly periodMs: number;
  readonly alertPeriodMs: number;
  readonly papaAmplitudeDeg: number;
  readonly babyAmplitudeDeg: number;
}

/** Papa's lean, smoothed: his drawn speed (whose rate of change is the acceleration), the pitch, the roll. */
export interface LeanState {
  readonly speed: Spring;
  readonly pitch: Spring;
  readonly roll: Spring;
  /** The last frame's offsets, in degrees: positive pitch leans forward, positive roll toward his right. */
  pitchDeg: number;
  rollDeg: number;
}

export function createLeanState(): LeanState {
  return {
    speed: createSpring(0),
    pitch: createSpring(0),
    roll: createSpring(0),
    pitchDeg: 0,
    rollDeg: 0,
  };
}

export function resetLean(state: LeanState): void {
  resetSpring(state.speed, 0);
  resetSpring(state.pitch, 0);
  resetSpring(state.roll, 0);
  state.pitchDeg = 0;
  state.rollDeg = 0;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

/**
 * Steps Papa's lean by `dtMs` of sim time (D6). `speedMps` is his drawn speed along his heading
 * (`stepSpeedMpsOf`): a glide starts and stops at once in the sim, so it goes through a spring of
 * `reachMs` first, and the acceleration is that spring's own rate of change, not a 10 ms spike.
 * `turnRateRadPerMs` is the body spring's speed (positive toward +x, his left): he leans into the
 * turn, toward its inside. Each target goes through a spring of `reachMs` with no overshoot. Under
 * reduced motion both are 0 at once (D11). Writes `state.pitchDeg` and `state.rollDeg`.
 */
export function stepLean(
  state: LeanState,
  speedMps: number,
  turnRateRadPerMs: number,
  dtMs: number,
  lean: Readonly<LeanConfig>,
  isMotionReduced: boolean,
): void {
  if (isMotionReduced) {
    resetLean(state);
    return;
  }
  if (!(dtMs > 0)) return;
  const speed = speedMps > LEAN_SPEED_EPSILON_MPS ? speedMps : 0;
  stepSpring(state.speed, speed, dtMs, lean.reachMs, 1, Number.POSITIVE_INFINITY);
  const accelMps2 = state.speed.velocityPerMs * MS_PER_S;
  const turnDegPerSec = turnRateRadPerMs * MS_PER_S * RAD_TO_DEG;
  const pitchTargetDeg = clampUnit(accelMps2 / lean.fullAccelMps2) * lean.maxAccelDeg;
  // Turning toward his left (a positive yaw rate) leans him to his left: a negative roll.
  const rollTargetDeg = -clampUnit(turnDegPerSec / lean.fullTurnDegPerSec) * lean.maxTurnDeg;
  state.pitchDeg = stepSpring(
    state.pitch,
    pitchTargetDeg,
    dtMs,
    lean.reachMs,
    1,
    Number.POSITIVE_INFINITY,
  );
  state.rollDeg = stepSpring(
    state.roll,
    rollTargetDeg,
    dtMs,
    lean.reachMs,
    1,
    Number.POSITIVE_INFINITY,
  );
}

/** One character's breath: an accumulated phase (D7) and an envelope that fades it in and out. */
export interface BreathState {
  /** Where in the breath, 0 to 1: it only accumulates, so a change of period never jumps it. */
  phase: number;
  /** 0 (held, or reduced motion) to 1 (breathing). */
  envelope: number;
  /** The last frame's factor, -1 to 1: `sin(2π phase) × envelope`. */
  factor: number;
}

export function createBreathState(): BreathState {
  return { phase: 0, envelope: 1, factor: 0 };
}

export function resetBreath(state: BreathState): void {
  state.phase = 0;
  state.envelope = 1;
  state.factor = 0;
}

/**
 * Steps a breath by `dtMs` of sim time (D7): one cycle per `periodMs` (the caller picks the calm or the
 * alarmed one each frame), held when `isHeld` (Papa's breath of the stealth exit), the envelope moving
 * toward 1 or 0 at `4 / periodMs` per ms. Under reduced motion it is 0 at once. A `dtMs` of 0 holds it.
 * Returns the factor, -1 to 1, that the caller scales by its amplitude.
 */
export function stepBreath(
  state: BreathState,
  dtMs: number,
  periodMs: number,
  isHeld: boolean,
  isMotionReduced: boolean,
): number {
  if (isMotionReduced) {
    state.envelope = 0;
    state.factor = 0;
    return 0;
  }
  if (!(dtMs > 0)) return state.factor;
  state.phase = (state.phase + dtMs / periodMs) % 1;
  const step = (BREATH_ENVELOPE_PERIODS * dtMs) / periodMs;
  const envelope = isHeld ? state.envelope - step : state.envelope + step;
  // Snapped at both ends: sums of small steps leave crumbs (1e-15), and a held breath is still.
  state.envelope =
    envelope < BREATH_ENVELOPE_SNAP ? 0 : envelope > 1 - BREATH_ENVELOPE_SNAP ? 1 : envelope;
  state.factor = Math.sin(2 * Math.PI * state.phase) * state.envelope;
  return state.factor;
}

/** The breath's period now: the alarmed one while the catastrophe gauge is above `alertPct` (D7). */
export function breathPeriodMsOf(breath: Readonly<BreathConfig>, isAlert: boolean): number {
  return isAlert ? breath.alertPeriodMs : breath.periodMs;
}

/** Papa's stoop, in degrees forward: `maxDeg × fatigue / 100`, the fatigue clamped to 0..100 (D9). */
export function stoopDegOf(fatigue: number, maxDeg: number): number {
  return (maxDeg * Math.min(100, Math.max(0, fatigue))) / 100;
}
