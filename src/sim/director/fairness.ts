import type { ThreatDef } from '@content/schemas/threat';
import { SILENCE_SIMULTANEOUS_WEIGHT, STEP_MS } from '@shared/constants';
import { instinctWindowModifier } from '../assist/paternalInstinct.ts';
import type { StepContext } from '../context.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * The director's fairness rule (FR75, ADR-011, GDD mechanic 17, story 3.13): two windows of the
 * director never open closer than `S = movement.glideMaxMs + director.fairnessMarginMs`, so Papa
 * can glide from one threat to the next and still answer it. After a found silence the guard is
 * longer: nothing opens until the silence's parry has ended and Papa has glided away from it.
 *
 * It departs on purpose from the letter of ADR-011, which has the director read Papa's position and
 * occupations: the glide is bounded by `glideMaxMs` (the upper bound of every glide, `glide.ts`),
 * which is never less fair than the real one (the director can only wait a little longer), needs no
 * path search per draw (the director is allocation-free), and the one occupation the rule protects,
 * the silence search, is read from the silence itself, not from Papa. The director reads no Papa
 * state, position or occupation here: a coffee, the phone, a nap are choices or sequels, not
 * protected (AC 9).
 */

/** Whether `threat` holds a frozen window another window must keep away from (D4). */
function hasFrozenWindow(threat: ThreatInstance): boolean {
  if (threat.responseWindow === null) return false;
  const { state } = threat;
  return state === 'telegraph' || state === 'windowOpen' || state === 'resolved' || state === 'gag';
}

/**
 * `S`: the least distance between two window openings, in ms, from the effective feel (a `SetFeel`
 * applies at the next draw).
 */
export function fairnessSpacingMs(ctx: StepContext): number {
  return ctx.feel.movement.glideMaxMs + ctx.feel.director.fairnessMarginMs;
}

/**
 * How long a Firmness held on an anchor keeps Papa's finger down after its window opens, in ms: its
 * `holdUntilMs`, or the end of the window plus `holdMinMs` if that is later. 0 for any other threat
 * (a tap is over in a moment). With `windowMs`, `toleranceMs` and `holdMinMs` at 0, a def's own span.
 */
export function heldSpanMs(
  def: ThreatDef | undefined,
  windowMs: number,
  toleranceMs: number,
  holdMinMs: number,
): number {
  if (def === undefined || def.response !== 'firm' || def.holdUntilMs === undefined) return 0;
  return Math.max(def.holdUntilMs, windowMs + toleranceMs + holdMinMs);
}

/**
 * The longest `def`'s window can be once telegraphed now, in ms: its own `windowMs` (or the feel's) at the
 * player's tier and with the instinct's bonus while it is active, as `telegraphThreat` will freeze it,
 * but not the fatigue's penalty, which only shrinks it (the rules built on it err on the safe side).
 */
export function plannedWindowMs(world: World, ctx: StepContext, def: ThreatDef): number {
  return (
    (def.windowMs ?? ctx.feel.timing.windowMs) *
    activeDifficulty(world, ctx).windowMultiplier *
    instinctWindowModifier(world, ctx)
  );
}

/**
 * The shared search of {@link fairWindowOpenAt} and {@link heldFirmnessClearAt}. With
 * `isHeldFirmnessOnly`, only the held Firmnesses' guards count (the micro-sleep keeps clear of them and
 * of nothing else, so that a level with no such Firmness runs exactly as before).
 */
function clearOpenAt(
  world: World,
  ctx: StepContext,
  threatIndex: number,
  openAt: number,
  isHeldFirmnessOnly: boolean,
): number {
  const { threats } = world;
  const spacingMs = fairnessSpacingMs(ctx);
  // A held Firmness drawn now must also end, and Papa glide away, before the window it would shut out: its
  // span is read as the other windows' are, from its longest window (a tier, the instinct) and `holdMinMs`.
  const ownDef = isHeldFirmnessOnly ? undefined : ctx.level.threats[threatIndex]?.def;
  const ownHoldMs =
    ownDef === undefined
      ? 0
      : heldSpanMs(
          ownDef,
          plannedWindowMs(world, ctx, ownDef),
          ctx.feel.timing.toleranceMs,
          ctx.feel.input.holdMinMs,
        );
  let at = openAt;
  for (let pass = 0; pass <= threats.length; pass++) {
    let isMoved = false;
    for (let i = 0; i < threats.length; i++) {
      if (i === threatIndex) continue;
      const other = threats[i] as ThreatInstance;
      const frozen = other.responseWindow;
      if (frozen === null || !hasFrozenWindow(other)) continue;
      const openedAt = other.windowOpenAt;
      const otherDef = ctx.level.threats[i]?.def;
      const holdMs = heldSpanMs(
        otherDef,
        frozen.windowMs,
        frozen.toleranceMs,
        ctx.feel.input.holdMinMs,
      );
      if (isHeldFirmnessOnly && holdMs === 0) continue;
      const isSilence = otherDef?.target === 'hiddenZone';
      const guardEndAt = isSilence
        ? openedAt + frozen.windowMs + frozen.toleranceMs + spacingMs
        : openedAt + holdMs + spacingMs;
      if (at > openedAt - spacingMs - ownHoldMs && at < guardEndAt) {
        at = Math.ceil(guardEndAt / STEP_MS) * STEP_MS;
        isMoved = true;
      }
    }
    if (!isMoved) break;
  }
  return at;
}

/**
 * The earliest instant at or after `openAt` where the window of the idle threat at `threatIndex` can
 * open without breaking the rule against any other frozen window (D4): `openAt` itself when nothing
 * is near, otherwise rounded up to the step grid. Another window opening at `open` forbids the open
 * interval `(open - S, open + S)`; a found silence's forbids `(open - S, open + windowMs +
 * toleranceMs + S)` (its parry's end plus the glide plus the margin, D3). Exactly `S` apart is
 * allowed. A Firmness held on an anchor keeps Papa's finger down for `hold` after its window opens
 * ({@link heldSpanMs}, story 9.7: the first Firmness in a wave), so its window forbids `(open - S, open +
 * hold + S)`, and a held Firmness being drawn forbids the `hold` before another window too. No other
 * threat has a `hold`: a level with no Firmness in a wave runs exactly as before. Pure and
 * allocation-free: a fixed-point loop over `world.threats`; the instant only grows and each threat moves
 * it at most once, so it ends.
 */
export function fairWindowOpenAt(
  world: World,
  ctx: StepContext,
  threatIndex: number,
  openAt: number,
): number {
  return clearOpenAt(world, ctx, threatIndex, openAt, false);
}

/**
 * The earliest instant at or after `openAt` where a window that no wave draws (the micro-sleep, which
 * the fatigue gauge starts) can open without landing in a held Firmness's guard (story 9.7): `openAt`
 * itself unless a Firmness is held near it. It keeps clear of nothing else, as before.
 */
export function heldFirmnessClearAt(world: World, ctx: StepContext, openAt: number): number {
  return clearOpenAt(world, ctx, -1, openAt, true);
}

/**
 * How many places the threat at `index` takes against a wave's `maxSimultaneous` while it is
 * active: a silence (`hiddenZone`) counts for {@link SILENCE_SIMULTANEOUS_WEIGHT}, any other
 * wave-planned threat for one, a threat no wave plans (the micro-sleep, story 1.19) for none.
 */
export function simultaneousWeightOf(ctx: StepContext, index: number): number {
  const planned = ctx.level.threats[index];
  if (planned === undefined || planned.firstWaveIndex < 0) return 0;
  return planned.def.target === 'hiddenZone' ? SILENCE_SIMULTANEOUS_WEIGHT : 1;
}

/**
 * What is wrong with a wave that plans a `hiddenZone` threat while its `maxSimultaneous` is below
 * the silence's weight: it could never be drawn there (story 3.13 AC 8). A sentence for the
 * planned entry, or null. `simLevelOf` and `content:check` both call it, so they refuse it with
 * the same words. Pure: no zod and no `@content` runtime import.
 *
 * It checks the wave that plans the silence only. The pool is cumulative, so a later wave with a
 * `maxSimultaneous` below the weight still never draws it, and nothing refuses that (Geo's call,
 * review of story 3.13: AC 8 stays as written).
 */
export function silenceLimitProblem(
  waveIndex: number,
  defId: string,
  maxSimultaneous: number,
): string | null {
  if (maxSimultaneous >= SILENCE_SIMULTANEOUS_WEIGHT) return null;
  return `wave ${waveIndex} plans the silence "${defId}" (target "hiddenZone"), which counts for ${SILENCE_SIMULTANEOUS_WEIGHT} against maxSimultaneous, but allows ${maxSimultaneous}: it could never be drawn there`;
}
