import { BABY_CRYING_EVERY_MS, MS_PER_S, PHONE_RINGING_EVERY_MS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { addNoise, decayNoise, propImpactNoisePct } from './noise.ts';

/** The index of a prop in `world.props`, or -1. */
function propIndexOf(world: World, propId: string): number {
  for (let i = 0; i < world.props.length; i++) {
    if (world.props[i]?.id === propId) return i;
  }
  return -1;
}

/**
 * The noise gauge for one step (story 3.1; architecture's `noise.ts`). A level with no noise gauge
 * does nothing. Otherwise, in order:
 *
 * 1. the decay, `decayPerSec` for one step of sim time (silent: no event);
 * 2. the sources: the events of **this step** (`t === now`, scanned from the end like
 *    `isBabyFoundNow`, then applied in emission order, with no allocation), because `ctx.events`
 *    is drained by the caller, not per step: a scan from 0 would count an impact twice.
 *    `PropImpact` (by impulse, once per `samePropCooldownMs` per prop), `PhoneRinging` and
 *    `BabyCrying` (`perSec` for one period of their contract).
 *
 * It reads events only, never the phone's, the props' or the baby's state (epics, story 3.1 AC 3).
 */
export function runNoise(world: World, ctx: StepContext): void {
  if (!ctx.level.hasNoise) return;
  const { decayPerSec, sources } = ctx.feel.noise;
  decayNoise(world, ctx, (-decayPerSec * STEP_MS) / MS_PER_S);

  const now = world.time.sim;
  const { events } = ctx;
  // `NoiseChanged` events pushed below sit past `end` and are never scanned.
  const end = events.length;
  let start = end;
  while (start > 0 && events[start - 1]?.t === now) start--;
  for (let i = start; i < end; i++) {
    const event = events[i];
    if (event === undefined) continue;
    if (event.type === 'PropImpact') {
      const index = propIndexOf(world, event.propId);
      if (index < 0) continue;
      const last = world.gauges.propNoiseAt[index] ?? null;
      if (last !== null && now - last < sources.propImpact.samePropCooldownMs) continue;
      world.gauges.propNoiseAt[index] = asSimMs(now);
      addNoise(world, ctx, propImpactNoisePct(ctx.feel, event.impulseNs), 'propImpact');
    } else if (event.type === 'PhoneRinging') {
      const pct = (sources.phoneRinging.perSec * PHONE_RINGING_EVERY_MS) / MS_PER_S;
      addNoise(world, ctx, pct, 'phoneRinging');
    } else if (event.type === 'BabyCrying') {
      const pct = (sources.babyCrying.perSec * BABY_CRYING_EVERY_MS) / MS_PER_S;
      addNoise(world, ctx, pct, 'babyCrying');
    }
  }
}
