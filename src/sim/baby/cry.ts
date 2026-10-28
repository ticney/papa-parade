import { BABY_CRYING_EVERY_MS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * The baby starts to cry for `gagCryMs` sim ms (story 3.1 D9): a gag whose def declares it calls
 * this. A gag during a cry extends it, `cryEndsAt = max(cryEndsAt ?? now, now + gagCryMs)`, and
 * keeps the tick grid (`cryStartedAt` does not move). The baby's state does not change: a cry is a
 * parallel timer, and a baby that cries still wanders.
 */
export function startBabyCry(world: World, _ctx: StepContext, gagCryMs: number): void {
  const { baby } = world;
  const now = world.time.sim;
  const endsAt = baby.cryEndsAt ?? now;
  if (baby.cryStartedAt === null) baby.cryStartedAt = now;
  baby.cryEndsAt = asSimMs(Math.max(endsAt, now + gagCryMs));
}

/**
 * One step of a crying baby, run first by `runBaby`: a `BabyCrying` for each
 * `cryStartedAt + k × BABY_CRYING_EVERY_MS` (k ≥ 1) that falls in this step, up to `cryEndsAt`
 * included, with no drift (the `PhoneRinging` contract), so a cry of `gagCryMs` gives
 * `floor(gagCryMs / BABY_CRYING_EVERY_MS)` events. Once `now ≥ cryEndsAt` the cry is over and both
 * fields go back to `null`. Stateless between steps: the grid is `cryStartedAt` and the step size.
 */
export function runBabyCry(world: World, ctx: StepContext): void {
  const { baby } = world;
  if (baby.cryStartedAt === null || baby.cryEndsAt === null) return;
  const now = world.time.sim;
  const sinceStartMs = now - baby.cryStartedAt;
  const ticksNow = Math.floor(
    Math.min(sinceStartMs, baby.cryEndsAt - baby.cryStartedAt) / BABY_CRYING_EVERY_MS,
  );
  const ticksBefore = Math.floor(
    Math.min(sinceStartMs - STEP_MS, baby.cryEndsAt - baby.cryStartedAt) / BABY_CRYING_EVERY_MS,
  );
  for (let k = ticksBefore; k < ticksNow; k++) {
    ctx.events.push({ type: 'BabyCrying', t: now });
  }
  if (now >= baby.cryEndsAt) {
    baby.cryStartedAt = null;
    baby.cryEndsAt = null;
  }
}
