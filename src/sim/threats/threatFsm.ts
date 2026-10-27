import type { ThreatDef } from '@content/schemas/threat';
import { NEUTRAL_WINDOW_MODIFIER } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { FailReason, ResponseQuality } from '../events.ts';
import { startSlowMo } from '../time/slowMo.ts';
import { effectiveWindow } from '../timing/effectiveWindow.ts';
import type { ThreatInstance, World } from '../world.ts';
import { applyGag, gagIdOf } from './gags.ts';

/**
 * `idle`: waiting for the director. `telegraph`: announced, the window opens `telegraphDelayMs`
 * later. `windowOpen`: the response is judged. `resolved` and `gag`: the result, until the cooldown
 * ends and the threat is `idle` again. (The architecture's `targeted` is not here: nothing enters
 * it; a threat that needs the baby in reach adds it.)
 */
export type ThreatState = 'idle' | 'telegraph' | 'windowOpen' | 'resolved' | 'gag';

/** Every `ThreatState`, as data: a snapshot is checked against it. */
export const THREAT_STATES = [
  'idle',
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
 * `idle → telegraph`. Freezes the window (D8: a buffered press is judged before the window opens, and a
 * window that moves while the player reads it would be unfair) and fixes the instant it opens.
 */
export function telegraphThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
): void {
  const { timing, difficulty } = ctx.feel;
  threat.responseWindow = effectiveWindow(timing, def.windowMs ?? timing.windowMs, {
    // The default tier until story 2.8 lets the player pick; fatigue and instinct do not exist yet.
    tier: difficulty.normal.windowMultiplier,
    fatigue: NEUTRAL_WINDOW_MODIFIER,
    instinct: NEUTRAL_WINDOW_MODIFIER,
  });
  threat.windowOpenAt = asSimMs(
    world.time.sim + (def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs),
  );
  threat.press = null;
  enterThreatState(world, threat, 'telegraph');
  ctx.events.push({
    type: 'ThreatTelegraphed',
    t: world.time.sim,
    threatId: threat.id,
    kind: threat.defId,
    anchorId: threat.anchorId,
  });
}

/** `telegraph → windowOpen`. */
export function openWindow(world: World, ctx: StepContext, threat: ThreatInstance): void {
  enterThreatState(world, threat, 'windowOpen');
  ctx.events.push({ type: 'WindowOpened', t: world.time.sim, threatId: threat.id });
}

/**
 * `→ resolved`: a perfect or successful response of the right kind. It also owns the time effects
 * of a success (story 1.14, decided here from `feel.json`): a hitstop, and for a perfect the
 * slow-mo, both at the step that emits `ResponseResolved`.
 */
export function resolveThreat(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef,
  quality: Exclude<ResponseQuality, 'fail'>,
  offsetMs: number,
): void {
  threat.press = null;
  enterThreatState(world, threat, 'resolved');
  ctx.events.push({
    type: 'ResponseResolved',
    t: world.time.sim,
    threatId: threat.id,
    response: def.response,
    quality,
    offsetMs,
  });
  ctx.requestFreezeRealMs(ctx.feel.timing.hitstopMs);
  if (quality === 'perfect') startSlowMo(world, ctx, 'perfect', ctx.feel.timing.slowMoPerfect);
}

/**
 * `→ gag`: a failed response. `ResponseResolved{fail}`, `GagTriggered`, then the gag's own
 * consequences (`applyGag`: a `NearMiss`, a pushed prop; NFR9: never an injury), with no hitstop
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
  threat.press = null;
  enterThreatState(world, threat, 'gag');
  const gag = gagIdOf(def.gag);
  ctx.events.push(
    {
      type: 'ResponseResolved',
      t: world.time.sim,
      threatId: threat.id,
      response: def.response,
      quality: 'fail',
      reason,
      offsetMs,
    },
    { type: 'GagTriggered', t: world.time.sim, threatId: threat.id, gag, reason },
  );
  applyGag(world, ctx, threat, gag);
}

/** `resolved | gag → idle`, once the cooldown is over. */
export function rearmThreat(world: World, ctx: StepContext, threat: ThreatInstance): void {
  threat.press = null;
  threat.responseWindow = null;
  threat.windowOpenAt = asSimMs(0);
  enterThreatState(world, threat, 'idle');
  ctx.events.push({ type: 'ThreatRearmed', t: world.time.sim, threatId: threat.id });
}
