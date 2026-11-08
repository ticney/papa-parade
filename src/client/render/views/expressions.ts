import type { Feel } from '@content/schemas/feel';
import { PAPA_TARGET_ANCHOR_ID } from '@shared/constants';
import type { SimEvent } from '@sim';

// The faces (story 7.10): which expression each character shows, from the sim's events (the moments)
// and a few flags the scene reads from the world (the lasting states). Pure, no Three, and no threat: the
// scene reads the world (`faceInputs.ts`) and passes booleans, so that nothing here can read a timing the
// player does not see. Times are sim ms: a moment starts at its event's `t`, and the frame's clock is the
// render's sim clock, so a pause or a hitstop holds a face and a slow-mo slows it.

/** Papa's four expressions, in the GDD's order (« Surprise, Fermeté, Fatigue, Fierté »). */
export const PAPA_EXPRESSIONS = ['surprised', 'firm', 'tired', 'proud'] as const;
/** The baby's four expressions, in the GDD's order (« joie, bouderie, concentration, sommeil »). */
export const BABY_EXPRESSIONS = ['delighted', 'sulky', 'focused', 'sleepy'] as const;

export type PapaExpression = (typeof PAPA_EXPRESSIONS)[number];
export type BabyExpression = (typeof BABY_EXPRESSIONS)[number];
/** What Papa's face shows: one of his expressions, or the rest. */
export type PapaFace = PapaExpression | 'neutral';
/** What the baby's face shows: one of his expressions, or the rest. */
export type BabyFace = BabyExpression | 'neutral';

/** `feel.json › characters.expressions`. */
export type ExpressionsFeel = Feel['characters']['expressions'];

/**
 * One character's face over time (D3): one slot for the current moment, and the lasting expression with
 * the clock it started at. A new moment replaces the current one; what shows is the moment while it runs
 * and started no earlier than the lasting expression, else the lasting expression, else the rest.
 */
export interface FaceTrack<E extends string> {
  /** The current moment, or null. */
  moment: E | null;
  startAt: number;
  /** When it ends, in sim ms: `Infinity` while Papa's frown waits for its threat's resolution. */
  untilAt: number;
  /** The threat Papa's held frown waits for, or null (D3). */
  heldThreatId: number | null;
  /** The lasting expression the last frame saw, or null. */
  lasting: E | null;
  /** The clock at which the lasting expression last changed to a non-null one. */
  lastingAt: number;
}

export function createFaceTrack<E extends string>(): FaceTrack<E> {
  return {
    moment: null,
    startAt: 0,
    untilAt: 0,
    heldThreatId: null,
    lasting: null,
    lastingAt: Number.NEGATIVE_INFINITY,
  };
}

/** Back to the rest: no moment, no lasting state (a restart, a replay moment, a stopped loop). */
export function clearExpressions<E extends string>(track: FaceTrack<E>): void {
  track.moment = null;
  track.startAt = 0;
  track.untilAt = 0;
  track.heldThreatId = null;
  track.lasting = null;
  track.lastingAt = Number.NEGATIVE_INFINITY;
}

/** Drops the current moment (the guard of D5): it does not come back after. */
export function dropMoment<E extends string>(track: FaceTrack<E>): void {
  track.moment = null;
  track.heldThreatId = null;
}

function startMoment<E extends string>(
  track: FaceTrack<E>,
  moment: E,
  startAt: number,
  durationMs: number,
): void {
  track.moment = moment;
  track.startAt = startAt;
  track.untilAt = startAt + durationMs;
  track.heldThreatId = null;
}

/**
 * What a sim event starts on Papa's face (D4, D15). `isPapaAsleep` is the world's `papa.state === 'asleep'`
 * after the step: his eyes are shut, he is surprised by nothing. Allocates nothing.
 */
export function notePapaEvent(
  track: FaceTrack<PapaExpression>,
  event: Readonly<SimEvent>,
  isPapaAsleep: boolean,
  feel: Readonly<ExpressionsFeel['papa']>,
): void {
  switch (event.type) {
    case 'ThreatTelegraphed':
      // A threat on Papa is the micro-sleep, whose telegraph is his own lids.
      if (event.anchorId === PAPA_TARGET_ANCHOR_ID || isPapaAsleep) return;
      startMoment(track, 'surprised', event.t, feel.surprisedMs);
      return;
    case 'ResponseHeld':
      // The press became a Firmness: the frown holds until that threat is resolved.
      startMoment(track, 'firm', event.t, 0);
      track.untilAt = Number.POSITIVE_INFINITY;
      track.heldThreatId = event.threatId;
      return;
    case 'ResponseResolved':
      if (event.quality === 'perfect') {
        startMoment(track, 'proud', event.t, feel.proudMs);
        return;
      }
      if (track.moment !== 'firm' || track.heldThreatId !== event.threatId) return;
      track.untilAt = event.quality === 'success' ? event.t + feel.firmAfterMs : event.t;
      track.heldThreatId = null;
      return;
    case 'ChoreBeatJudged':
      if (event.quality === 'perfect') startMoment(track, 'proud', event.t, feel.proudMs);
      return;
    case 'ThreatCancelled':
      if (track.moment === 'firm' && track.heldThreatId === event.threatId) {
        track.untilAt = event.t;
        track.heldThreatId = null;
      }
      return;
    case 'GagTriggered':
      // His gag clip carries the reaction: a proud or surprised brow over it would read wrong (D15).
      if (track.moment !== null && track.untilAt > event.t) track.untilAt = event.t;
      track.heldThreatId = null;
      return;
    default:
      return;
  }
}

/**
 * What a sim event starts on the baby's face (D4). « Quand il rit » is every event whose cue layers his
 * laugh (`content/feedback.json`, `baby_laugh_perfect`): a perfect, a combo cashed in. Allocates nothing.
 */
export function noteBabyEvent(
  track: FaceTrack<BabyExpression>,
  event: Readonly<SimEvent>,
  feel: Readonly<ExpressionsFeel['baby']>,
): void {
  switch (event.type) {
    case 'BabyPickedUp':
    case 'GagTriggered':
    case 'ComboCashedIn':
      startMoment(track, 'delighted', event.t, feel.delightedMs);
      return;
    case 'ResponseResolved':
      if (event.quality === 'perfect') {
        startMoment(track, 'delighted', event.t, feel.delightedMs);
      } else if (event.response === 'firm' && event.quality === 'success') {
        startMoment(track, 'sulky', event.t, feel.sulkyMs);
      }
      return;
    case 'ChoreBeatJudged':
      if (event.quality === 'perfect') startMoment(track, 'delighted', event.t, feel.delightedMs);
      return;
    default:
      return;
  }
}

/** The lasting expression seen this frame: a change to a non-null one is the latest thing that happened (D3). */
function noteLasting<E extends string>(
  track: FaceTrack<E>,
  lasting: E | null,
  nowMs: number,
): void {
  if (lasting === track.lasting) return;
  track.lasting = lasting;
  if (lasting !== null) track.lastingAt = nowMs;
}

function faceOf<E extends string>(track: FaceTrack<E>, nowMs: number): E | 'neutral' {
  if (track.moment !== null && nowMs < track.untilAt && track.startAt >= track.lastingAt) {
    return track.moment;
  }
  return track.lasting ?? 'neutral';
}

/**
 * Papa's face at `nowMs` (the frame's sim clock), given whether he is tired now (D7) and whether only the
 * signals count (D5: then the rest, the moment dropped, the lasting state forgotten so that it starts again
 * when the guard ends). Updates the track's lasting state. Allocates nothing.
 */
export function papaExpressionAt(
  track: FaceTrack<PapaExpression>,
  nowMs: number,
  isTired: boolean,
  isSignalOnly: boolean,
): PapaFace {
  if (isSignalOnly) {
    dropMoment(track);
    noteLasting(track, null, nowMs);
    return 'neutral';
  }
  noteLasting(track, isTired ? 'tired' : null, nowMs);
  return faceOf(track, nowMs);
}

/**
 * The baby's face at `nowMs`: `focused` (D6) over `sleepy` (D8) when both hold, the guard of D5 over
 * everything. Updates the track's lasting state. Allocates nothing.
 */
export function babyExpressionAt(
  track: FaceTrack<BabyExpression>,
  nowMs: number,
  isFocused: boolean,
  isSleepy: boolean,
  isSignalOnly: boolean,
): BabyFace {
  if (isSignalOnly) {
    dropMoment(track);
    noteLasting(track, null, nowMs);
    return 'neutral';
  }
  noteLasting(track, isFocused ? 'focused' : isSleepy ? 'sleepy' : null, nowMs);
  return faceOf(track, nowMs);
}
