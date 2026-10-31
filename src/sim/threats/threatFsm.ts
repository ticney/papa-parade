import type { ThreatDef } from '@content/schemas/threat';
import { NEUTRAL_WINDOW_MODIFIER } from '@shared/constants';
import { invariant } from '@shared/invariant';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { instinctWindowModifier, recordMiss } from '../assist/paternalInstinct.ts';
import { startBabyCry } from '../baby/cry.ts';
import type { StepContext } from '../context.ts';
import { isLastOfWave } from '../director/waveState.ts';
import type { FailReason, ResponseQuality, ThreatCancelReason } from '../events.ts';
import { fatigueWindowModifier } from '../gauges/fatigue.ts';
import { addResponseToCombo, resetCombo } from '../scoring/combo.ts';
import { advanceSequenceOnResolve, failSequenceOnGag } from '../sequences/sequenceEnd.ts';
import { startSlowMo } from '../time/slowMo.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import { type EffectiveWindow, effectiveWindow } from '../timing/effectiveWindow.ts';
import type { ThreatInstance, World } from '../world.ts';
import { applyGag, type GagId, gagIdOf } from './gags.ts';

/**
 * `idle`: waiting for the director. `hidden`: a silent mischief picked by the director; no window
 * and no marker until the baby is found (story 1.21). `telegraph`: announced, the window opens `telegraphDelayMs`
 * later. `windowOpen`: the response is judged. `resolved` and `gag`: the result, until the cooldown
 * ends and the threat is `idle` again. (The architecture's `targeted` is not here: nothing enters
 * it; a threat that needs the baby in reach adds it.)
 */
export type ThreatState = 'idle' | 'hidden' | 'telegraph' | 'windowOpen' | 'resolved' | 'gag';

/** Every `ThreatState`, as data: a snapshot is checked against it. */
export const THREAT_STATES = [
  'idle',
  'hidden',
  'telegraph',
  'windowOpen',
  'resolved',
  'gag',
] as const satisfies readonly ThreatState[];

type UnlistedThreatState = Exclude<ThreatState, (typeof THREAT_STATES)[number]>;

/** Compile-time proof that `THREAT_STATES` holds every member of the union (see `SIM_EVENT_TYPES_ARE_COMPLETE`). */
export const THREAT_STATES_ARE_COMPLETE: [UnlistedThreatState] extends [never]
  ? true
  : UnlistedThreatState = true;

/**
 * The only writer of `threat.state` and `enteredAt`. It emits nothing: the helpers below do, each
 * with the data its transition owns.
 */
export function enterThreatState(world: World, threat: ThreatInstance, next: ThreatState): void {
  threat.state = next;
  threat.enteredAt = world.time.sim;
}

/**
 * How long after the telegraph delay a `wait` threat gives its signal (story 4.6, D1): drawn here,
 * once, with exactly one `nextFloat` between `minDelayMs` and `maxDelayMs`, so that the number of
 * draws never depends on the tuning. Any other def draws nothing (no existing journal moves).
 */
function signalDelayMs(world: World, def: ThreatDef): number {
  if (def.response !== 'wait') return 0;
  const { minDelayMs, maxDelayMs } = def;
  invariant(
    minDelayMs !== undefined && maxDelayMs !== undefined,
    `wait threat ${def.id} has no minDelayMs / maxDelayMs`,
  );
  return Math.round(minDelayMs + nextFloat(world.rng) * (maxDelayMs - minDelayMs));
}

/**
 * `idle → telegraph`. Freezes the window (D8: a buffered press is judged before the window opens, and a
 * window that moves while the player reads it would be unfair) and fixes the instant it opens.
 * `waveIndex` is the wave that drew the threat, -1 for a threat no wave planned.
 */
export function telegraphThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
  waveIndex: number,
): void {
  const { timing } = ctx.feel;
  threat.responseWindow = effectiveWindow(timing, def.windowMs ?? timing.windowMs, {
    tier: activeDifficulty(world, ctx).windowMultiplier,
    fatigue: fatigueWindowModifier(world, ctx),
    instinct: instinctWindowModifier(world, ctx),
  });
  const openAfterMs = def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs;
  threat.windowOpenAt = asSimMs(world.time.sim + openAfterMs + signalDelayMs(world, def));
  threat.press = null;
  threat.waveIndex = waveIndex;
  enterThreatState(world, threat, 'telegraph');
  ctx.events.push({
    type: 'ThreatTelegraphed',
    t: world.time.sim,
    threatId: threat.id,
    kind: threat.defId,
    anchorId: threat.anchorId,
    waveIndex,
  });
}

/**
 * `idle → hidden`: the director picked a suspicious silence (story 1.21). It has no window, no press
 * and no marker; the baby takes it (`runSilence`), and finding him reveals it with
 * {@link telegraphThreat}. `waveIndex` is the wave that drew it.
 */
export function hideThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  waveIndex: number,
): void {
  threat.press = null;
  threat.responseWindow = null;
  threat.windowOpenAt = asSimMs(0);
  threat.waveIndex = waveIndex;
  enterThreatState(world, threat, 'hidden');
  ctx.events.push({
    type: 'ThreatHidden',
    t: world.time.sim,
    threatId: threat.id,
    kind: threat.defId,
    anchorId: threat.anchorId,
    waveIndex,
  });
}

/** `telegraph → windowOpen`. A `wait` threat gives its signal first (`WaitSignalGiven`, story 4.6). */
export function openWindow(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
): void {
  enterThreatState(world, threat, 'windowOpen');
  if (def.response === 'wait') {
    ctx.events.push({ type: 'WaitSignalGiven', t: world.time.sim, threatId: threat.id });
  }
  ctx.events.push({ type: 'WindowOpened', t: world.time.sim, threatId: threat.id });
}

/**
 * The window to put on a `ResponseResolved`: a copy of the one the threat was judged against. A
 * hidden silence that timed out was never judged, so it gets its def's window with no modifier.
 */
function judgedWindow(ctx: StepContext, threat: ThreatInstance, def: ThreatDef): EffectiveWindow {
  const { responseWindow } = threat;
  if (responseWindow !== null) return { ...responseWindow };
  const { timing } = ctx.feel;
  return effectiveWindow(timing, def.windowMs ?? timing.windowMs, {
    tier: NEUTRAL_WINDOW_MODIFIER,
    fatigue: NEUTRAL_WINDOW_MODIFIER,
    instinct: NEUTRAL_WINDOW_MODIFIER,
  });
}

/**
 * `→ resolved`: a perfect or successful response of the right kind. It also owns the time effects
 * of a success (story 1.14, decided here from `feel.json`): a hitstop, and for a perfect the
 * slow-mo, both at the step that emits `ResponseResolved`; and, when it was the last threat of its
 * wave (story 1.18), the `lastThreat` slow-mo after the perfect one (the slowest scale wins, each
 * keeps its own timer).
 */
export function resolveThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
  quality: Exclude<ResponseQuality, 'fail'>,
  offsetMs: number,
): void {
  const judged = judgedWindow(ctx, threat, def);
  threat.press = null;
  enterThreatState(world, threat, 'resolved');
  ctx.events.push({
    type: 'ResponseResolved',
    t: world.time.sim,
    threatId: threat.id,
    response: def.response,
    quality,
    offsetMs,
    responseWindow: judged,
  });
  // Mama's « Rire » counts every perfect, the micro-sleep's included (story 1.22).
  if (quality === 'perfect') world.score.perfects += 1;
  ctx.requestFreezeRealMs(ctx.feel.timing.hitstopMs);
  if (quality === 'perfect') startSlowMo(world, ctx, 'perfect', ctx.feel.timing.slowMoPerfect);
  if (isLastOfWave(world, ctx, threat)) {
    startSlowMo(world, ctx, 'lastThreat', ctx.feel.timing.slowMoLastThreat);
  }
  // The combo climbs on every response, perfect or success, the baby in the arms or not (story 4.2).
  addResponseToCombo(world, ctx);
  // In a `retreats` sequence a response wins the round (story 4.6); a no-op anywhere else.
  advanceSequenceOnResolve(world, ctx, threat);
}

/**
 * The gag a failed threat ends in. A hidden-zone def draws one of its `surpriseGags` with exactly one
 * `nextFloat` (story 1.21 D5: the number of draws never depends on the tuning); any other def
 * draws nothing, so levels without a silence keep their rng.
 */
function gagOf(world: World, def: ThreatDef): GagId {
  if (def.target !== 'hiddenZone') return gagIdOf(def.gag);
  const { surpriseGags } = def;
  const index = Math.min(
    surpriseGags.length - 1,
    Math.floor(nextFloat(world.rng) * surpriseGags.length),
  );
  return gagIdOf(surpriseGags[index] as string);
}

/**
 * `→ gag`: a failed response. `ResponseResolved{fail}`, `GagTriggered`, then the gag's own
 * consequences (`applyGag`: a `NearMiss`, a pushed prop, or Papa falling asleep; NFR9: never an injury), with no hitstop
 * and no slow-mo. `offsetMs` is `null` when no press ever came.
 */
export function gagThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
  reason: FailReason,
  offsetMs: number | null,
): void {
  const judged = judgedWindow(ctx, threat, def);
  threat.press = null;
  enterThreatState(world, threat, 'gag');
  const gag = gagOf(world, def);
  ctx.events.push(
    {
      type: 'ResponseResolved',
      t: world.time.sim,
      threatId: threat.id,
      response: def.response,
      quality: 'fail',
      reason,
      offsetMs,
      responseWindow: judged,
    },
    { type: 'GagTriggered', t: world.time.sim, threatId: threat.id, gag, reason },
  );
  applyGag(world, ctx, threat, gag);
  // The cry belongs to the def, not to the gag id: many defs share a gag (story 3.1 D9).
  if (def.gagCryMs !== undefined) startBabyCry(world, ctx, def.gagCryMs);
  // A missed threat loses the combo, nothing is cashed (story 4.2).
  resetCombo(world, ctx, 'gag');
  // Every failure is a miss for Fatherly Instinct, the timed-out silence and the micro-sleep too (story 2.9).
  recordMiss(world, ctx);
  // In a special sequence a gag ends it (story 4.4); a no-op anywhere else.
  failSequenceOnGag(world, ctx, threat, reason);
}

/** `resolved | gag → idle`, once the cooldown is over. */
export function rearmThreat(world: World, ctx: StepContext, threat: ThreatInstance): void {
  threat.press = null;
  threat.responseWindow = null;
  threat.windowOpenAt = asSimMs(0);
  threat.waveIndex = -1;
  enterThreatState(world, threat, 'idle');
  ctx.events.push({ type: 'ThreatRearmed', t: world.time.sim, threatId: threat.id });
}

/**
 * `telegraph | windowOpen → idle` with no result (story 4.1): `ThreatCancelled`, and nothing else. No
 * `ResponseResolved`, no gag, no `ThreatRearmed`, no slow-mo, no hitstop and no cooldown: it was
 * never answered or missed. A pending press on it is dropped.
 */
export function cancelThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  reason: ThreatCancelReason,
): void {
  threat.press = null;
  threat.responseWindow = null;
  threat.windowOpenAt = asSimMs(0);
  threat.waveIndex = -1;
  enterThreatState(world, threat, 'idle');
  ctx.events.push({ type: 'ThreatCancelled', t: world.time.sim, threatId: threat.id, reason });
}
