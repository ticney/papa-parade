import type { Feel } from '@content/schemas/feel';
import type { ThreatResponse } from '@content/schemas/threat';
import type { InvariantViolation } from '@shared/invariant';
import type { SimMs } from '@shared/time';
import type { BabyState } from './baby/babyFsm.ts';
import type { PapaState } from './papa/papaFsm.ts';
import type { GagId } from './threats/gags.ts';
import type { EffectiveWindow } from './timing/effectiveWindow.ts';

/**
 * What made noise: a row of `feel.noise.sources` (typed from the schema, so a new row cannot be
 * forgotten here), or `debug` for the `SetNoise` command (story 3.1).
 */
export type NoiseSource = keyof Feel['noise']['sources'] | 'debug';

/** How a response ended: `fail` is a gag. */
export type ResponseQuality = 'perfect' | 'success' | 'fail';

/**
 * Why a response failed: pressed before the window, never pressed in it, the wrong kind of press,
 * or (a Firmness) the finger came up before the end of the attack.
 */
export type FailReason = 'early' | 'late' | 'wrongResponse' | 'released';

/**
 * Why a ringing phone stopped: Papa picked up, it rang `ringMaxMs` for nothing, or the level ended
 * while it was still ringing (so every `PhoneRingStarted` gets exactly one `PhoneRingEnded`).
 */
export type PhoneRingEndReason = 'answered' | 'timedOut' | 'levelEnded';

/**
 * Why a suspicious silence ended: Papa found the baby, `findMaxMs` ran out and the surprise
 * mischief came, or the level ended first.
 */
export type SilenceEndReason = 'found' | 'timedOut' | 'levelEnded';

/** Why a level ended. `'timer'` so far; the early end on noise (`MamaWoke`, story 3.x) adds one. */
export type LevelEndReason = 'timer';

/** Domain events pushed by the systems into `ctx.events`; `t` is sim time. */
export type SimEvent =
  | { type: 'TimeScaleChanged'; t: SimMs; from: number; to: number }
  | { type: 'PapaStateChanged'; t: SimMs; from: PapaState; to: PapaState }
  /** A path to a tapped point was found: where it ends (after any snapping) and how many waypoints it has. */
  | { type: 'PapaPathPlanned'; t: SimMs; targetXM: number; targetZM: number; waypointCount: number }
  | { type: 'PapaArrived'; t: SimMs; xM: number; zM: number }
  /**
   * Papa set off to an interactive object the player asked for (`TapObject`). Every accepted tap
   * says it, one per command, also when Papa already stands at the anchor (a walk of no length, then
   * `PapaArrived`) or is already walking there: the object (stories 1.19, 1.20) decides what a repeat
   * means. Nothing consumes this yet.
   */
  | { type: 'ObjectTapped'; t: SimMs; objectId: string }
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
  /** The director entered a wave (the first at its `fromMs`, the next ones as their time comes). */
  | { type: 'WaveStarted'; t: SimMs; waveIndex: number }
  /**
   * The director targeted a threat: its window opens `telegraphDelayMs` later. `kind` is the def id;
   * `waveIndex` the wave that drew it, -1 for a threat no wave planned.
   */
  | {
      type: 'ThreatTelegraphed';
      t: SimMs;
      threatId: number;
      kind: string;
      anchorId: string;
      waveIndex: number;
    }
  /**
   * The director picked a suspicious silence (story 1.21): the threat is `hidden`, not telegraphed.
   * Same fields as `ThreatTelegraphed`.
   */
  | {
      type: 'ThreatHidden';
      t: SimMs;
      threatId: number;
      kind: string;
      anchorId: string;
      waveIndex: number;
    }
  /**
   * The hidden baby has been quiet in his zone for `feel.baby.silenceAlertMs`: the music cuts, the
   * « … » bubble shows and the device vibrates (the client follows `world.silence.startedAt`).
   */
  | { type: 'SilenceStarted'; t: SimMs; threatId: number }
  /**
   * The silence is over, for the `reason`. `found` is followed by the threat's `ThreatTelegraphed`;
   * `timedOut` by its `ResponseResolved{fail}` and `GagTriggered` (the surprise mischief).
   */
  | { type: 'SilenceEnded'; t: SimMs; threatId: number; reason: SilenceEndReason }
  | { type: 'WindowOpened'; t: SimMs; threatId: number }
  /**
   * A press on the threat has been held `feel.input.holdMinMs` (story 1.23): the hold-ring closes.
   * Once per press, on a Parry threat too (its `wrongResponse` follows in the same step).
   */
  | { type: 'ResponseHeld'; t: SimMs; threatId: number }
  /**
   * The threat was answered. `response` is what it asks for; `offsetMs` is the press's distance from
   * the window's centre, `null` when the window ran out with no press. `reason` only on a `fail`.
   * `responseWindow` is the effective window the threat was judged against (a copy of its `responseWindow`
   * as frozen at the telegraph, story 2.1): a silence nobody found had none, and gets the window its
   * def would have had with no modifier.
   */
  | {
      type: 'ResponseResolved';
      t: SimMs;
      threatId: number;
      response: ThreatResponse;
      quality: ResponseQuality;
      reason?: FailReason;
      offsetMs: number | null;
      responseWindow: EffectiveWindow;
    }
  /** A failed response ends in a gag: a harmless comic consequence, never an injury (NFR9). */
  | { type: 'GagTriggered'; t: SimMs; threatId: number; gag: GagId; reason: FailReason }
  /**
   * A gag that was nearly an accident, emitted right after its `GagTriggered` (same `t`). Mama's
   * « Hurlement » (story 1.22) counts these; it is never an injury (NFR9).
   */
  | { type: 'NearMiss'; t: SimMs; threatId: number; gag: GagId }
  | { type: 'ThreatRearmed'; t: SimMs; threatId: number }
  /**
   * Papa's fatigue crossed the threshold (strictly above it: `isAbove`), once per crossing, in each
   * direction. Above it, windows shrink and micro-sleeps come (story 1.19).
   */
  | { type: 'FatigueThresholdCrossed'; t: SimMs; isAbove: boolean }
  /** Papa arrived at a coffee machine and starts drinking; he is busy until `untilAt`. */
  | { type: 'CoffeeStarted'; t: SimMs; objectId: string; untilAt: SimMs }
  /** Papa finished his coffee: the fatigue it left (`fatigue`, in points) and he is idle again. */
  | { type: 'CoffeeDrunk'; t: SimMs; fatigue: number }
  /** A planned phone started to ring at this object; it gives up at `untilAt` if nobody answers. */
  | { type: 'PhoneRingStarted'; t: SimMs; objectId: string; untilAt: SimMs }
  /**
   * The phone rang for one more `PHONE_RINGING_EVERY_MS`: one event, one second of ringing, counted
   * from the start without drift. Story 3.1 adds « +2 % de bruit par seconde » for each. (Not past
   * tense: the epic and story 3.1 name it so.)
   */
  | { type: 'PhoneRinging'; t: SimMs; objectId: string }
  /**
   * The baby cried for one more `BABY_CRYING_EVERY_MS` (story 3.1): one event, one second of crying,
   * counted from the start of the cry without drift, like `PhoneRinging`. Each is +`feel.noise`'s
   * `babyCrying.perSec` noise. (Not past tense: the epic names it so.)
   */
  | { type: 'BabyCrying'; t: SimMs }
  /** The phone stopped ringing, for the `reason`; `timedOut` and `levelEnded` are a missed call. */
  | { type: 'PhoneRingEnded'; t: SimMs; objectId: string; reason: PhoneRingEndReason }
  /**
   * Papa picked up (right after `PhoneRingEnded{answered}`): he is on the phone until `untilAt` and
   * his fatigue is now `fatigue`, in points, after the call's cost.
   */
  | { type: 'PhoneAnswered'; t: SimMs; objectId: string; untilAt: SimMs; fatigue: number }
  /**
   * A prop took a hit of `impulseNs` (N·s) or more, at most once per `feel.physics.impactCooldownMs`.
   * `otherPropId` is the prop it hit, null for the floor, a wall or furniture; a hit between two
   * props gives one event for each. The noise gauge (3.1) reads only this event.
   */
  | { type: 'PropImpact'; t: SimMs; propId: string; impulseNs: number; otherPropId: string | null }
  /**
   * The noise gauge moved by a source event (story 3.1): `deltaPct` is the change after the clamp
   * (never 0) and `noisePct` the value after it, in % of the gauge. The decay is silent: read
   * `world.gauges.noisePct` for the exact value. `source` is a row of `feel.noise.sources`, or
   * `debug` for `SetNoise`.
   */
  | { type: 'NoiseChanged'; t: SimMs; source: NoiseSource; noisePct: number; deltaPct: number }
  /** A breakable prop took a hit of `impulseNs` or more, once; it stays in the world, broken. */
  | { type: 'PropBroken'; t: SimMs; propId: string; impulseNs: number }
  /** The level is over, once: from here the sim only keeps its clock (the client shows the result). */
  | { type: 'LevelEnded'; t: SimMs; reason: LevelEndReason }
  /**
   * Mama's note (story 1.22), right after `LevelEnded` and at the same `t`, once per level: the
   * four rows (`sighPoints` and `screamPoints` are what she takes off), the score out of 100 and the
   * stars. The same values are in `world.score.final`.
   */
  | {
      type: 'LevelScored';
      t: SimMs;
      laughPoints: number;
      babyStatePoints: number;
      sighPoints: number;
      screamPoints: number;
      scorePoints: number;
      stars: number;
    }
  | InvariantViolation;

/**
 * The name of every `SimEvent`, as data, sorted alphabetically (`events.test.ts` checks it; the
 * union above is in the order the systems emit them). The client checks the event names of
 * `content/feedback.json` against it. No system reads it, so no golden moves.
 */
export const SIM_EVENT_TYPES = [
  'BabyCrying',
  'BabyStateChanged',
  'CoffeeDrunk',
  'CoffeeStarted',
  'FatigueThresholdCrossed',
  'GagTriggered',
  'InvariantViolated',
  'LevelEnded',
  'LevelScored',
  'NearMiss',
  'NoiseChanged',
  'ObjectTapped',
  'PapaArrived',
  'PapaBlocked',
  'PapaGlideStarted',
  'PapaPathPlanned',
  'PapaStateChanged',
  'PhoneAnswered',
  'PhoneRingEnded',
  'PhoneRingStarted',
  'PhoneRinging',
  'PropBroken',
  'PropImpact',
  'ResponseHeld',
  'ResponseResolved',
  'SilenceEnded',
  'SilenceStarted',
  'ThreatHidden',
  'ThreatRearmed',
  'ThreatTelegraphed',
  'TimeScaleChanged',
  'WaveStarted',
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
