import type { ThreatResponse } from '@content/schemas/threat';
import type { InvariantViolation } from '@shared/invariant';
import type { SimMs } from '@shared/time';
import type { BabyState } from './baby/babyFsm.ts';
import type { PapaState } from './papa/papaFsm.ts';
import type { GagId } from './threats/gags.ts';

/** How a response ended: `fail` is a gag. */
export type ResponseQuality = 'perfect' | 'success' | 'fail';

/** Why a response failed: pressed before the window, never pressed in it, or the wrong kind of press. */
export type FailReason = 'early' | 'late' | 'wrongResponse';

/** Domain events pushed by the systems into `ctx.events`; `t` is sim time. */
export type SimEvent =
  | { type: 'TimeScaleChanged'; t: SimMs; from: number; to: number }
  | { type: 'PapaStateChanged'; t: SimMs; from: PapaState; to: PapaState }
  /** A path to a tapped point was found: where it ends (after any snapping) and how many waypoints it has. */
  | { type: 'PapaPathPlanned'; t: SimMs; targetXM: number; targetZM: number; waypointCount: number }
  | { type: 'PapaArrived'; t: SimMs; xM: number; zM: number }
  /** A direction walk ran into an obstacle and cannot move at all (once per blockage). */
  | { type: 'PapaBlocked'; t: SimMs; xM: number; zM: number }
  | { type: 'BabyStateChanged'; t: SimMs; from: BabyState; to: BabyState }
  /** Papa set off to a pressed threat; he arrives by `arriveAt` (choreography: no judgement waits for it). */
  | {
      type: 'PapaGlideStarted';
      t: SimMs;
      threatId: number;
      toXM: number;
      toZM: number;
      arriveAt: SimMs;
    }
  /** The director targeted a threat: its window opens `telegraphDelayMs` later. `kind` is the def id. */
  | { type: 'ThreatTelegraphed'; t: SimMs; threatId: number; kind: string; anchorId: string }
  | { type: 'WindowOpened'; t: SimMs; threatId: number }
  /**
   * The threat was answered. `response` is what it asks for; `offsetMs` is the press's distance from
   * the window's centre, `null` when the window ran out with no press. `reason` only on a `fail`.
   */
  | {
      type: 'ResponseResolved';
      t: SimMs;
      threatId: number;
      response: ThreatResponse;
      quality: ResponseQuality;
      reason?: FailReason;
      offsetMs: number | null;
    }
  /** A failed response ends in a gag: a harmless comic consequence, never an injury (NFR9). */
  | { type: 'GagTriggered'; t: SimMs; threatId: number; gag: GagId; reason: FailReason }
  | { type: 'ThreatRearmed'; t: SimMs; threatId: number }
  | InvariantViolation;

/**
 * The name of every `SimEvent`, as data, sorted alphabetically (`events.test.ts` checks it; the
 * union above is in the order the systems emit them). The client checks the event names of
 * `content/feedback.json` against it. No system reads it, so no golden moves.
 */
export const SIM_EVENT_TYPES = [
  'BabyStateChanged',
  'GagTriggered',
  'InvariantViolated',
  'PapaArrived',
  'PapaBlocked',
  'PapaGlideStarted',
  'PapaPathPlanned',
  'PapaStateChanged',
  'ResponseResolved',
  'ThreatRearmed',
  'ThreatTelegraphed',
  'TimeScaleChanged',
  'WindowOpened',
] as const satisfies readonly SimEvent['type'][];

type UnlistedSimEventType = Exclude<SimEvent['type'], (typeof SIM_EVENT_TYPES)[number]>;

/**
 * Compile-time proof that the list holds every member of the union (`satisfies` above proves the
 * other direction): a new `SimEvent` that is not listed makes this assignment fail to typecheck,
 * and the error names the missing type.
 */
export const SIM_EVENT_TYPES_ARE_COMPLETE: [UnlistedSimEventType] extends [never]
  ? true
  : UnlistedSimEventType = true;
