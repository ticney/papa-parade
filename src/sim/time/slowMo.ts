import type { Feel } from '@content/schemas/feel';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { SlowMo, SlowMoSource, World } from '../world.ts';
import { setTimeScale } from './timeScale.ts';

/** The feel of one slow-mo (`feel.timing.slowMoPerfect`, `slowMoLastThreat`). */
type SlowMoFeel = Feel['timing']['slowMoPerfect'];

/** Smoothstep on `[0, 1]`: a polynomial of `+ − ×` (with the one IEEE division of its caller), the same bits on every platform. */
function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * The factor of one slow-mo at sim time `t`: `scale` while `t < holdUntil`, a smoothstep back to 1
 * for `holdUntil <= t < endsAt`, 1 from `endsAt` on. With `returnMs = 0` (`endsAt === holdUntil`)
 * the return is empty: the slow-mo is over at `holdUntil` itself.
 */
export function slowMoFactorAt(slowMo: Readonly<SlowMo>, t: number): number {
  if (t < slowMo.holdUntil) return slowMo.scale;
  if (t >= slowMo.endsAt) return 1;
  const u = (t - slowMo.holdUntil) / (slowMo.endsAt - slowMo.holdUntil);
  return slowMo.scale + (1 - slowMo.scale) * smoothstep(u);
}

/**
 * Starts the slow-mo of `source` at the current sim time, or extends the one already running (the
 * slower scale and the later end win, `startedAt` is kept), then republishes the scale.
 */
export function startSlowMo(
  world: World,
  ctx: StepContext,
  source: SlowMoSource,
  feel: SlowMoFeel,
): void {
  const now = world.time.sim;
  const holdUntil = asSimMs(now + feel.durationMs);
  const endsAt = asSimMs(holdUntil + feel.returnMs);
  const running = world.time.slowMos.find((slowMo) => slowMo.source === source);
  if (running === undefined) {
    world.time.slowMos.push({ source, scale: feel.timeScale, startedAt: now, holdUntil, endsAt });
  } else {
    running.scale = Math.min(running.scale, feel.timeScale);
    running.holdUntil = asSimMs(Math.max(running.holdUntil, holdUntil));
    running.endsAt = asSimMs(Math.max(running.endsAt, endsAt));
  }
  updateTimeScale(world, ctx);
}

/**
 * Drops the slow-mos that ended by now, then publishes min(baseScale, every factor) through
 * `setTimeScale`, the only writer of `world.time.scale`.
 */
export function updateTimeScale(world: World, ctx: StepContext): void {
  const { slowMos } = world.time;
  const now = world.time.sim;
  let kept = 0;
  let scale = world.time.baseScale;
  for (let i = 0; i < slowMos.length; i++) {
    const slowMo = slowMos[i] as SlowMo;
    if (now >= slowMo.endsAt) continue;
    slowMos[kept++] = slowMo;
    scale = Math.min(scale, slowMoFactorAt(slowMo, now));
  }
  slowMos.length = kept;
  setTimeScale(world, ctx, scale);
}
