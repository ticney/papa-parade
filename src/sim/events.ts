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

/**
 * Why a level ended: the clock reached the level's `durationMs` (`timer`), or the noise reached 100 %
 * in a Sieste level and woke Mama (`mamaWoke`, story 3.2).
 */
export type LevelEndReason = 'timer' | 'mamaWoke';

/** Every `LevelEndReason`, as data: the report and the client key their records by it. */
export const LEVEL_END_REASONS = ['timer', 'mamaWoke'] as const satisfies readonly LevelEndReason[];

type UnlistedLevelEndReason = Exclude<LevelEndReason, (typeof LEVEL_END_REASONS)[number]>;

/** Compile-time proof that `LEVEL_END_REASONS` holds every member of the union (see `FLOW_STATES_ARE_COMPLETE`). */
export const LEVEL_END_REASONS_ARE_COMPLETE: [UnlistedLevelEndReason] extends [never]
  ? true
  : UnlistedLevelEndReason = true;

/**
 * Why Fatherly Instinct ended (story 2.9): its `durationMs` ran out (`timer`), or the level ended
 * first (`levelEnded`), so every `InstinctTriggered` gets exactly one `InstinctEnded`.
 */
export type InstinctEndReason = 'timer' | 'levelEnded';

/**
 * Why a threat was cancelled with no result (story 4.1): Papa took the baby in his arms
 * (`carried`: the threats aimed at the baby's mischief go away), or put him down (`putDown`: the
 * cry in the arms goes with the arms), or a special sequence started (`sequence`, story 4.4: a clean
 * slate for the sequence's own cadence, the threats on Papa included).
 */
export type ThreatCancelReason = 'carried' | 'putDown' | 'sequence';

/** Every `ThreatCancelReason`, as data: the client keys by it. */
export const THREAT_CANCEL_REASONS = [
  'carried',
  'putDown',
  'sequence',
] as const satisfies readonly ThreatCancelReason[];

type UnlistedThreatCancelReason = Exclude<
  ThreatCancelReason,
  (typeof THREAT_CANCEL_REASONS)[number]
>;

/** Compile-time proof that `THREAT_CANCEL_REASONS` holds every member of the union (see `FLOW_STATES_ARE_COMPLETE`). */
export const THREAT_CANCEL_REASONS_ARE_COMPLETE: [UnlistedThreatCancelReason] extends [never]
  ? true
  : UnlistedThreatCancelReason = true;

/**
 * How a special sequence ended (story 4.4): won (`succeeded`), lost to a gag (`failed`), or the
 * level ended first (`levelEnded`, no resume).
 */
export type SequenceOutcome = 'succeeded' | 'failed' | 'levelEnded';

/** Every `SequenceOutcome`, as data: the report and the client key their records by it. */
export const SEQUENCE_OUTCOMES = [
  'succeeded',
  'failed',
  'levelEnded',
] as const satisfies readonly SequenceOutcome[];

type UnlistedSequenceOutcome = Exclude<SequenceOutcome, (typeof SEQUENCE_OUTCOMES)[number]>;

/** Compile-time proof that `SEQUENCE_OUTCOMES` holds every member of the union (see `LEVEL_END_REASONS_ARE_COMPLETE`). */
export const SEQUENCE_OUTCOMES_ARE_COMPLETE: [UnlistedSequenceOutcome] extends [never]
  ? true
  : UnlistedSequenceOutcome = true;

/**
 * What woke the baby a little during a `beats` step (story 4.5): a judged beat nobody tapped
 * (`missed`), a tap on a decoy (`decoy`), or a tap on no beat and no decoy (`stray`).
 */
export type BabyStirReason = 'missed' | 'decoy' | 'stray';

/** Every `BabyStirReason`, as data: the report and the client key their records by it. */
export const BABY_STIR_REASONS = [
  'missed',
  'decoy',
  'stray',
] as const satisfies readonly BabyStirReason[];

type UnlistedBabyStirReason = Exclude<BabyStirReason, (typeof BABY_STIR_REASONS)[number]>;

/** Compile-time proof that `BABY_STIR_REASONS` holds every member of the union (see `LEVEL_END_REASONS_ARE_COMPLETE`). */
export const BABY_STIR_REASONS_ARE_COMPLETE: [UnlistedBabyStirReason] extends [never]
  ? true
  : UnlistedBabyStirReason = true;

/**
 * Why the combo's multiplier moved (story 4.2): a successful `response`, a `carryTick`, a `gag`
 * that reset it, or a `cashIn` that banked it.
 */
export type ComboChangeReason = 'response' | 'carryTick' | 'gag' | 'cashIn';

/** Every `ComboChangeReason`, as data: the client keys by it. */
export const COMBO_CHANGE_REASONS = [
  'response',
  'carryTick',
  'gag',
  'cashIn',
] as const satisfies readonly ComboChangeReason[];

type UnlistedComboChangeReason = Exclude<ComboChangeReason, (typeof COMBO_CHANGE_REASONS)[number]>;

/** Compile-time proof that `COMBO_CHANGE_REASONS` holds every member of the union (see `FLOW_STATES_ARE_COMPLETE`). */
export const COMBO_CHANGE_REASONS_ARE_COMPLETE: [UnlistedComboChangeReason] extends [never]
  ? true
  : UnlistedComboChangeReason = true;

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
  /** Papa took the baby in his arms (story 4.1). `BabyStateChanged{→ carried}` comes first. */
  | { type: 'BabyPickedUp'; t: SimMs }
  /**
   * Papa set the baby down (story 4.1). `safe` is whether Papa stood in a `kind: "safe"` zone;
   * `BabyStateChanged{carried → babble}` comes first. A `safe` put-down above the minimum
   * multiplier then cashes the combo in (story 4.2): `ThreatCancelled` if any, `ComboCashedIn`, `ComboChanged{cashIn}`.
   */
  | { type: 'BabyPutDown'; t: SimMs; safe: boolean }
  /**
   * The combo's multiplier changed (story 4.2), only on a real change: `multiplier` is the new
   * value and `reason` what moved it. Never emitted in a level with no `carry`.
   */
  | { type: 'ComboChanged'; t: SimMs; multiplier: number; reason: ComboChangeReason }
  /**
   * The combo was cashed in at a safe put-down (story 4.2): `points = multiplier * basePoints`, added
   * to the Rire of Mama's note. It follows `BabyPutDown` (and `ThreatCancelled`) and precedes
   * `ComboChanged{cashIn}`.
   */
  | { type: 'ComboCashedIn'; t: SimMs; multiplier: number; basePoints: number; points: number }
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
  /**
   * Fatherly Instinct started (story 2.9): enough misses in a short time with enough threats up.
   * The slow-mo (`TimeScaleChanged`) follows in the same step. It lasts until `untilAt` (sim time),
   * where `InstinctEnded{timer}` comes.
   */
  | { type: 'InstinctTriggered'; t: SimMs; untilAt: SimMs }
  /** Fatherly Instinct is over, for the `reason`; the recharge starts (silently) at this `t`. */
  | { type: 'InstinctEnded'; t: SimMs; reason: InstinctEndReason }
  | { type: 'ThreatRearmed'; t: SimMs; threatId: number }
  /**
   * An active threat was dropped with no result, no gag and no rearm (story 4.1): it goes straight
   * back to `idle`. Papa's carrying causes it, for the `reason`.
   */
  | { type: 'ThreatCancelled'; t: SimMs; threatId: number; reason: ThreatCancelReason }
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
  /**
   * The need reached `feel.bladder.slowFromPct` (story 4.3): from now on Papa's walks are slower,
   * until a visit to the toilet. Once per upward crossing.
   */
  | { type: 'BladderFilled'; t: SimMs }
  /** Papa reached the toilet `objectId`: he is out of the room until `untilAt`, and the need is frozen meanwhile. */
  | { type: 'ToiletStarted'; t: SimMs; objectId: string; untilAt: SimMs }
  /** Papa is back in the room, the need at 0 (right after the visit's reset, so `BladderFilled` can fire again). */
  | { type: 'ToiletFinished'; t: SimMs }
  /** A tap on the toilet while the baby is carried: Papa does not move (he must put the baby down first). */
  | { type: 'ToiletRefused'; t: SimMs; objectId: string }
  /**
   * A special sequence started (story 4.4). Follows `ThreatCancelled`s and the baby's pick-up, and
   * precedes `SequenceStepStarted{0}`.
   */
  | { type: 'SequenceStarted'; t: SimMs; id: string }
  /** The sequence entered its step number `stepIndex` (0 right after `SequenceStarted`). */
  | { type: 'SequenceStepStarted'; t: SimMs; id: string; stepIndex: number }
  /** The sequence is over, for the `outcome`; `levelEnded` is followed by no resume. */
  | { type: 'SequenceEnded'; t: SimMs; id: string; outcome: SequenceOutcome }
  /**
   * Papa snored after a missed micro-sleep of a sequence whose failure `hasSnore` (story 4.4); the
   * noise gauge reads it (`feel.noise.sources.snore`). `BabyWoke` follows. Never outside a sequence.
   */
  | { type: 'PapaSnored'; t: SimMs }
  /** The baby woke at the snore: an event and a cue, not a state or a cry (story 4.4, D4). */
  | { type: 'BabyWoke'; t: SimMs }
  /**
   * The note of a `beats` step number `entryIndex` of the timeline fell (story 4.5), at its time: the
   * count-in's (`judgedIndex` null) and the judged beats'. It fires even for a beat that was tapped
   * early: the cue is the tempo, not the answer.
   */
  | { type: 'BeatCued'; t: SimMs; entryIndex: number; judgedIndex: number | null }
  /** The decoy number `entryIndex` of the timeline fell, between two beats (story 4.5). */
  | { type: 'DecoyCued'; t: SimMs; entryIndex: number }
  /**
   * A tap settled the judged beat `judgedIndex` (story 4.5), `offsetMs` from its centre (negative:
   * early). Perfect or not, a step earns nothing (D6).
   */
  | { type: 'BeatHit'; t: SimMs; judgedIndex: number; offsetMs: number }
  /**
   * The judged beat `judgedIndex` was settled with no tap on it (story 4.5): the miss window closed,
   * or a tap came too late. `BabyStirred{missed}` follows (unless the miss costs 0).
   */
  | { type: 'BeatMissed'; t: SimMs; judgedIndex: number }
  /** A tap landed on the decoy number `entryIndex` (story 4.5). `BabyStirred{decoy}` follows (unless it costs 0). */
  | { type: 'DecoyTapped'; t: SimMs; entryIndex: number }
  /** A tap landed on no beat and no decoy (story 4.5). `BabyStirred{stray}` follows (unless it costs 0). */
  | { type: 'BeatStrayTapped'; t: SimMs }
  /**
   * The baby stirred (story 4.5): `wakePct` is his wake after the step, `deltaPct` what this one
   * added (always above 0: a cost of 0 stirs nobody and emits nothing). At 100 `BabyWoke` follows.
   */
  | { type: 'BabyStirred'; t: SimMs; wakePct: number; deltaPct: number; reason: BabyStirReason }
  /** A breakable prop took a hit of `impulseNs` or more, once; it stays in the world, broken. */
  | { type: 'PropBroken'; t: SimMs; propId: string; impulseNs: number }
  /**
   * Mama was woken by the noise (story 3.2): the noise reached 100 % in a Sieste level. Right before
   * `LevelEnded{mamaWoke}`, at the same `t`.
   */
  | { type: 'MamaWoke'; t: SimMs }
  /** The level is over, once: from here the sim only keeps its clock (the client shows the result). */
  | { type: 'LevelEnded'; t: SimMs; reason: LevelEndReason }
  /**
   * Mama's note (story 1.22), right after `LevelEnded` and at the same `t`, once per level: the
   * four rows (`sighPoints` and `screamPoints` are what she takes off), the score out of 100 and the
   * stars (after the `lostStars` she took off for being woken, story 3.2). The same values are in
   * `world.score.final`.
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
      lostStars: number;
    }
  | InvariantViolation;

/**
 * The name of every `SimEvent`, as data, sorted alphabetically (`events.test.ts` checks it; the
 * union above is in the order the systems emit them). The client checks the event names of
 * `content/feedback.json` against it. No system reads it, so no golden moves.
 */
export const SIM_EVENT_TYPES = [
  'BabyCrying',
  'BabyPickedUp',
  'BabyPutDown',
  'BabyStateChanged',
  'BabyStirred',
  'BabyWoke',
  'BeatCued',
  'BeatHit',
  'BeatMissed',
  'BeatStrayTapped',
  'BladderFilled',
  'CoffeeDrunk',
  'CoffeeStarted',
  'ComboCashedIn',
  'ComboChanged',
  'DecoyCued',
  'DecoyTapped',
  'FatigueThresholdCrossed',
  'GagTriggered',
  'InstinctEnded',
  'InstinctTriggered',
  'InvariantViolated',
  'LevelEnded',
  'LevelScored',
  'MamaWoke',
  'NearMiss',
  'NoiseChanged',
  'ObjectTapped',
  'PapaArrived',
  'PapaBlocked',
  'PapaGlideStarted',
  'PapaPathPlanned',
  'PapaSnored',
  'PapaStateChanged',
  'PhoneAnswered',
  'PhoneRingEnded',
  'PhoneRingStarted',
  'PhoneRinging',
  'PropBroken',
  'PropImpact',
  'ResponseHeld',
  'ResponseResolved',
  'SequenceEnded',
  'SequenceStarted',
  'SequenceStepStarted',
  'SilenceEnded',
  'SilenceStarted',
  'ThreatCancelled',
  'ThreatHidden',
  'ThreatRearmed',
  'ThreatTelegraphed',
  'TimeScaleChanged',
  'ToiletFinished',
  'ToiletRefused',
  'ToiletStarted',
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
