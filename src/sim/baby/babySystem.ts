import { STEP_MS } from '@shared/constants';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { advanceAlongPath } from '../nav/followPath.ts';
import type { World } from '../world.ts';
import { enterBabyState } from './babyFsm.ts';
import { pickWanderCell, planWander } from './wander.ts';

/**
 * How long the next babble lasts, in ms. One `nextFloat` even when min = max, so that the number
 * of draws does not depend on the tuning.
 */
function drawBabbleMs(world: World, ctx: StepContext): number {
  const { babbleMinMs, babbleMaxMs } = ctx.feel.baby;
  return babbleMinMs + nextFloat(world.rng) * (babbleMaxMs - babbleMinMs);
}

/** Moves a baby that stands in a closed cell to the nearest open cell of any region (no event). */
function ensureOnOpenCell(world: World, ctx: StepContext): void {
  const { baby } = world;
  const grid = ctx.nav.baby;
  if (grid.isOpenAt(baby.xM, baby.zM)) return;
  const cell = grid.nearestOpenCell(baby.xM, baby.zM, -1);
  if (cell < 0) return;
  baby.xM = grid.centerXM(cell);
  baby.zM = grid.centerZM(cell);
}

/**
 * System: the baby. Remembers where it sat (for the view's interpolation); when its babble is
 * over (`wanderAt`) draws a destination and sets off, or, if none can be planned, babbles on for
 * another draw; while wandering crawls `crawlSpeedMps` for one step, its gaze following its heading,
 * and babbles again on arrival. The feel is read each step, so a changed one applies at once.
 */
export function runBaby(world: World, ctx: StepContext): void {
  const { baby } = world;
  const { baby: feel } = ctx.feel;
  baby.prevXM = baby.xM;
  baby.prevZM = baby.zM;

  if (baby.state === 'babble' && world.time.sim >= baby.wanderAt) {
    ensureOnOpenCell(world, ctx);
    const cell = pickWanderCell(
      ctx.nav.baby,
      baby.xM,
      baby.zM,
      feel.wanderMinDistM,
      feel.wanderMaxDistM,
      world.rng,
    );
    if (cell >= 0 && planWander(baby, ctx.nav.baby, cell)) {
      enterBabyState(world, ctx, 'wander');
    } else {
      baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
    }
  }

  if (baby.state === 'wander') {
    const isArrived = advanceAlongPath(baby, (feel.crawlSpeedMps * STEP_MS) / 1000);
    baby.gazeX = baby.headingX;
    baby.gazeZ = baby.headingZ;
    if (isArrived) {
      baby.path.length = 0;
      baby.pathIndex = 0;
      baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
      enterBabyState(world, ctx, 'babble');
    }
  }
}
