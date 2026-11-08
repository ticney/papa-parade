import type { Feel } from '@content/schemas/feel';
import { PAPA_TARGET_ANCHOR_ID } from '@shared/constants';
import type { SimEvent } from '@sim';

// The faces (story 7.10): which expression each character shows, from the sim's events (the moments)
// and a few flags the scene reads from the world (the lasting states). Pure, no Three, and no threat: the
// scene reads the world (`faceInputs.ts`) and passes booleans, so that nothing here can read a timing the
// player does not see. Times are sim ms: a moment starts at its event's `t`, a lasting state at the sim
// time of the frame that saw it begin, and a moment shows until the render's sim clock reaches its end,
// so a pause or a hitstop holds a face and a slow-mo slows it.

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
 * One character's face over time (D3): one slot for the current moment, one for a hold (Papa's Firmness
 * frown, which a later moment covers but does not end), and the lasting expression with the sim time it
 * began at. What shows: the later of the moment and the hold while it runs and started no earlier than
 * the lasting expression, else the lasting expression, else the rest.
 */
export interface FaceTrack<E extends string> {
  /** The current moment, or null. A new moment replaces it. */
  moment: E | null;
  startAt: number;
  /** When it ends, in sim ms. */
  untilAt: number;
  /** The expression a hold shows (Papa's `firm`), or null. */
  held: E | null;
  /** When the hold began, in sim ms: the press became a Firmness. */
  heldAt: number;
  /** When it ends: `Infinity` while its threat is held, then its resolution (+ `firmAfterMs` on a success). */
  heldUntilAt: number;
  /** The threat the hold waits for, or null once it is resolved, cancelled or cut. */
  heldThreatId: number | null;
  /** The lasting expression the last frame saw, or null. */
  lasting: E | null;
  /** The sim time at which the lasting expression last began (a rise, `setLasting`). */
  lastingAt: number;
  /** The guard of the signals (D5) held on the last frame: its end is a return, not a beginning. */
  wasGuarded: boolean;
}

export function createFaceTrack<E extends string>(): FaceTrack<E> {
  return {
    moment: null,
    startAt: 0,
    untilAt: 0,
    held: null,
    heldAt: 0,
    heldUntilAt: 0,
    heldThreatId: null,
    lasting: null,
    lastingAt: Number.NEGATIVE_INFINITY,
    wasGuarded: false,
  };
}

/** Back to the rest: no moment, no hold, no lasting state (a restart, a replay moment, a stopped loop). */
export function clearExpressions<E extends string>(track: FaceTrack<E>): void {
  dropMoment(track);
  track.startAt = 0;
  track.untilAt = 0;
  track.lasting = null;
  track.lastingAt = Number.NEGATIVE_INFINITY;
  track.wasGuarded = false;
}

/** Drops the current moment and the hold (the guard of D5): neither comes back after. */
export function dropMoment<E extends string>(track: FaceTrack<E>): void {
  track.moment = null;
  track.held = null;
  track.heldAt = 0;
  track.heldUntilAt = 0;
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
}

/** The press became a Firmness: the hold shows until its threat is resolved, cancelled or cut (D3). */
function startHold<E extends string>(
  track: FaceTrack<E>,
  expression: E,
  startAt: number,
  threatId: number,
): void {
  track.held = expression;
  track.heldAt = startAt;
  track.heldUntilAt = Number.POSITIVE_INFINITY;
  track.heldThreatId = threatId;
}

/** Ends the hold at `untilAt` if it waits for `threatId`; another threat's end changes nothing. */
function releaseHold<E extends string>(
  track: FaceTrack<E>,
  threatId: number,
  untilAt: number,
): void {
  if (track.heldThreatId !== threatId) return;
  track.heldUntilAt = untilAt;
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
      // The press became a Firmness: the frown holds until that threat is resolved. A later moment shows
      // over it and the frown comes back after, while the threat is still held.
      startHold(track, 'firm', event.t, event.threatId);
      return;
    case 'ResponseResolved':
      if (event.quality === 'perfect') {
        // The hold of this threat ends with it: his pride shows instead.
        releaseHold(track, event.threatId, event.t);
        startMoment(track, 'proud', event.t, feel.proudMs);
        return;
      }
      releaseHold(
        track,
        event.threatId,
        event.quality === 'success' ? event.t + feel.firmAfterMs : event.t,
      );
      return;
    case 'ChoreBeatJudged':
      if (event.quality === 'perfect') startMoment(track, 'proud', event.t, feel.proudMs);
      return;
    case 'ThreatCancelled':
      releaseHold(track, event.threatId, event.t);
      return;
    case 'GagTriggered':
      // His gag clip carries the reaction: a proud or surprised brow over it would read wrong (D15).
      if (track.moment !== null && track.untilAt > event.t) track.untilAt = event.t;
      if (track.heldUntilAt > event.t) track.heldUntilAt = event.t;
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

/**
 * Sets the lasting expression seen this frame. `isRise` is a lasting state that begins (D3): it covers the
 * moments that started before `simMs`. A state that falls back to a lower one, or ends, begins nothing, and
 * neither does the first frame after the guard (`restFace` dated it): it is a return.
 */
function setLasting<E extends string>(
  track: FaceTrack<E>,
  lasting: E | null,
  isRise: boolean,
  simMs: number,
): void {
  track.lasting = lasting;
  if (isRise && !track.wasGuarded) track.lastingAt = simMs;
  track.wasGuarded = false;
}

/**
 * Only the signals count (D5): the face rests, the moment and the hold are dropped, the lasting state is
 * forgotten and dated with this frame. Its return when the guard ends then begins nothing: a moment noted
 * in the frame the guard ends (the last result of a duel, when the baby laughs) is later than the date and
 * shows.
 */
function restFace<E extends string>(track: FaceTrack<E>, simMs: number): 'neutral' {
  dropMoment(track);
  track.lasting = null;
  track.lastingAt = simMs;
  track.wasGuarded = true;
  return 'neutral';
}

function faceOf<E extends string>(track: FaceTrack<E>, nowMs: number): E | 'neutral' {
  const { moment, held } = track;
  const isMomentShown =
    moment !== null && nowMs < track.untilAt && track.startAt >= track.lastingAt;
  const isHoldShown = held !== null && nowMs < track.heldUntilAt && track.heldAt >= track.lastingAt;
  if (isMomentShown && isHoldShown) {
    // The later one shows; at the same time, the moment.
    return track.startAt >= track.heldAt ? moment : held;
  }
  if (isMomentShown) return moment;
  if (isHoldShown) return held;
  return track.lasting ?? 'neutral';
}

/**
 * Papa's face at `nowMs` (the frame's sim clock, interpolated), given the sim time `simMs` of the world the
 * frame reads (what a lasting state that begins is dated with, the clock of the events), whether he is tired
 * now (D7) and whether only the signals count (D5: then the rest, the moment and the hold dropped, the
 * lasting state forgotten so that it begins again when the guard ends). Updates the track's lasting state.
 * Allocates nothing.
 */
export function papaExpressionAt(
  track: FaceTrack<PapaExpression>,
  nowMs: number,
  simMs: number,
  isTired: boolean,
  isSignalOnly: boolean,
): PapaFace {
  if (isSignalOnly) return restFace(track, simMs);
  const lasting = isTired ? 'tired' : null;
  setLasting(track, lasting, lasting !== null && track.lasting === null, simMs);
  return faceOf(track, nowMs);
}

/**
 * The baby's face at `nowMs`: `focused` (D6) over `sleepy` (D8) when both hold, the guard of D5 over
 * everything. `simMs` dates a lasting state that begins, as for Papa. Focus begins from anything else;
 * sleep only from nothing: when the focus ends and the bedtime sleep shows again, nothing begins, so
 * the moment that ended the focus (a perfect, a Firmness) still shows. Allocates nothing.
 */
export function babyExpressionAt(
  track: FaceTrack<BabyExpression>,
  nowMs: number,
  simMs: number,
  isFocused: boolean,
  isSleepy: boolean,
  isSignalOnly: boolean,
): BabyFace {
  if (isSignalOnly) return restFace(track, simMs);
  const lasting: BabyExpression | null = isFocused ? 'focused' : isSleepy ? 'sleepy' : null;
  const isRise =
    lasting === 'focused'
      ? track.lasting !== 'focused'
      : lasting === 'sleepy' && track.lasting === null;
  setLasting(track, lasting, isRise, simMs);
  return faceOf(track, nowMs);
}
