import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ISO_YAW_DEG, STEP_MS } from '../../../src/shared/constants.ts';
import { appUrl, WALK_BOUND_MS, waitFrames } from './game.ts';
import {
  ppAdvance,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './testApi.ts';

// Papa busy, in the real game (story 2.13): the coffee, the call, which way his body faces and what his
// props do. Shared by `characters.spec.ts` and `reducedMotion.spec.ts`. The side effects' timings are read
// from the live `content/feedback.json`, never typed: Geo retunes them.

const SALON = 'salon_crawler';
const SEED = 42;
const CHUNK_STEPS = 25;

const live = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
  characters: {
    busyProps: {
      steamSwayDeg: number;
      steamPeriodMs: number;
      blablaTiltDeg: number;
      blablaPeriodMs: number;
    };
  };
};
export const busyProps = live.characters.busyProps;

/** The yaw that faces the camera, in radians (Papa's convention: 0 faces +z, positive toward +x). */
export const CAMERA_YAW_RAD = (ISO_YAW_DEG * Math.PI) / 180;
/** How close a body's yaw must be to the one it was asked to take, in radians. */
export const YAW_TOLERANCE_RAD = 0.05;

const liveFeel = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  characters: { turn: { reachMs: number } };
};
/**
 * How long his body takes to settle on a new facing, in sim ms (story 7.8): it turns on a spring that
 * swings past and comes back. Five reach times leave about 0.002 rad of a half turn at the shipped
 * damping of 0.6, well under `YAW_TOLERANCE_RAD` (a damping under about 0.45 would need longer). Read
 * from the live feel: Geo retunes it.
 */
export const TURN_SETTLE_MS = 5 * liveFeel.characters.turn.reachMs;

/** `angleRad` wrapped to the half turn around 0. */
export const wrapRad = (angleRad: number): number =>
  Math.atan2(Math.sin(angleRad), Math.cos(angleRad));

/** The salon on a frozen sim at the test seed: the sim moves only when a test advances it. */
export async function freezeSalon(page: Page): Promise<void> {
  await page.goto(appUrl('/'));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, SALON, SEED);
}

/** Steps the sim until `isDone` holds on the world; fails when `boundMs` of sim time went by. */
export async function advanceUntil(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
): Promise<void> {
  for (let steps = 0; steps * STEP_MS <= boundMs; steps += CHUNK_STEPS) {
    if (isDone(await ppWorld(page))) return;
    await ppAdvance(page, CHUNK_STEPS);
  }
  if (isDone(await ppWorld(page))) return;
  throw new Error(`${what} did not happen within ${boundMs} ms of sim time`);
}

/** Taps the coffee machine and steps until Papa drinks. */
export async function startDrinking(page: Page): Promise<void> {
  await ppSend(page, { type: 'SetFatigue', points: 80 });
  await ppAdvance(page, 2);
  await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
  await advanceUntil(page, 'Papa drinking', WALK_BOUND_MS, (world) => world.papa.state === 'drink');
}

/** Rings the phone, answers it, and steps until Papa is on it. */
export async function startCall(page: Page): Promise<void> {
  await ppAdvance(page, 2);
  await ppSend(page, { type: 'StartDisruption', index: 0 });
  await ppAdvance(page, 1);
  await ppSend(page, { type: 'TapObject', objectId: 'phone' });
  await advanceUntil(
    page,
    'Papa on the phone',
    WALK_BOUND_MS,
    (world) => world.papa.state === 'onPhone',
  );
}

/** The way the sim says Papa heads, as the view's yaw. */
export const headingYawRad = (world: Awaited<ReturnType<typeof ppWorld>>): number =>
  Math.atan2(world.papa.headingX, world.papa.headingZ);

/** Steps by `steps`, lets the frames draw, and reads what the view shows. */
export async function advanceAndRead(page: Page, steps: number) {
  await ppAdvance(page, steps);
  await waitFrames(page, 3);
  return ppFx(page);
}
