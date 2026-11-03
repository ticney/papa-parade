import { SILENCE_SIMULTANEOUS_WEIGHT, STEP_MS } from '@shared/constants';
import type { StepContext } from '../context.ts';
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
 * The earliest instant at or after `openAt` where the window of the idle threat at `threatIndex` can
 * open without breaking the rule against any other frozen window (D4): `openAt` itself when nothing
 * is near, otherwise rounded up to the step grid. Another window opening at `open` forbids the open
 * interval `(open - S, open + S)`; a found silence's forbids `(open - S, open + windowMs +
 * toleranceMs + S)` (its parry's end plus the glide plus the margin, D3). Exactly `S` apart is
 * allowed. Pure and allocation-free: a fixed-point loop over `world.threats`; the instant only
 * grows and each threat moves it at most once, so it ends.
 */
export function fairWindowOpenAt(
  world: World,
  ctx: StepContext,
  threatIndex: number,
  openAt: number,
): number {
  const { threats } = world;
  const spacingMs = fairnessSpacingMs(ctx);
  let at = openAt;
  for (let pass = 0; pass <= threats.length; pass++) {
    let isMoved = false;
    for (let i = 0; i < threats.length; i++) {
      if (i === threatIndex) continue;
      const other = threats[i] as ThreatInstance;
      const frozen = other.responseWindow;
      if (frozen === null || !hasFrozenWindow(other)) continue;
      const openedAt = other.windowOpenAt;
      const isSilence = ctx.level.threats[i]?.def.target === 'hiddenZone';
      const guardEndAt = isSilence
        ? openedAt + frozen.windowMs + frozen.toleranceMs + spacingMs
        : openedAt + spacingMs;
      if (at > openedAt - spacingMs && at < guardEndAt) {
        at = Math.ceil(guardEndAt / STEP_MS) * STEP_MS;
        isMoved = true;
      }
    }
    if (!isMoved) break;
  }
  return at;
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
