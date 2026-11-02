import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  emulateReducedMotion,
  liveFeel,
  liveSilence,
  sceneShot,
  startLevel,
  WALK_BOUND_MS,
  waitFrames,
} from './support/game.ts';
import { ppAdvance, ppEvents, ppFreeze, ppFx, ppSend, ppWorld } from './support/testApi.ts';

// The final look in the real game (story 7.3): the alert glow on the room's dangers, the depth test
// of the outlines. How it looks is Geo's call: nothing here judges the art.

const OUTLET_DEF = 'outlet';
const CHUNK_STEPS = 25;
/** Unanswered, a threat is long over by then. */
const THREAT_OVER_BOUND_MS = 15_000;
const CRAWL_BOUND_MS =
  WALK_BOUND_MS * Math.max(1, liveFeel.movement.walkSpeedMps / liveFeel.baby.sneakSpeedMps);

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppAdvance(page, 5);
}

async function force(page: Page, defId: string): Promise<number> {
  const world = await ppWorld(page);
  const threat = world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`the level does not plan ${defId}`);
  await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
  return threat.id;
}

const tintsShown = async (page: Page): Promise<number> => {
  await waitFrames(page, 2);
  return (await ppFx(page)).dangerTintsShown;
};

test('a forced anchor threat raises the glow, which goes once it is over', async ({ page }) => {
  const problems = collectProblems(page);
  await openFrozen(page);
  expect(await tintsShown(page)).toBe(0);
  const id = await force(page, OUTLET_DEF);
  await ppAdvance(page, 2);
  expect(await tintsShown(page)).toBe(1);

  const boundSteps = Math.ceil(THREAT_OVER_BOUND_MS / STEP_MS);
  for (let i = 0; i * CHUNK_STEPS < boundSteps; i++) {
    const state = (await ppWorld(page)).threats.find((one) => one.id === id)?.state;
    if (state !== 'telegraph' && state !== 'windowOpen') break;
    await ppAdvance(page, CHUNK_STEPS);
  }
  const over = (await ppWorld(page)).threats.find((one) => one.id === id)?.state;
  expect(['telegraph', 'windowOpen']).not.toContain(over);
  expect(await tintsShown(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('a threat on another target leaves it at 0: the hidden silence is a secret', async ({
  page,
}) => {
  await openFrozen(page);
  await force(page, liveSilence.id);
  for (let i = 0; i < 40; i++) {
    await ppAdvance(page, CHUNK_STEPS);
    expect(await tintsShown(page)).toBe(0);
  }
});

test('the glow still stands under reduced motion', async ({ page }) => {
  await openFrozen(page);
  await emulateReducedMotion(page);
  await force(page, OUTLET_DEF);
  await ppAdvance(page, 2);
  expect(await tintsShown(page)).toBe(1);
});

test('a baby hidden behind the sofa shows no outline over the sofa (AC 3)', async ({
  page,
}, testInfo) => {
  await openFrozen(page);
  await force(page, liveSilence.id);
  const chunks = Math.ceil(
    (CRAWL_BOUND_MS + liveFeel.baby.silenceAlertMs) / (CHUNK_STEPS * STEP_MS),
  );
  for (let i = 0; i <= chunks; i++) {
    if ((await ppEvents(page)).some((event) => event.type === 'SilenceStarted')) break;
    await ppAdvance(page, CHUNK_STEPS);
  }
  expect((await ppEvents(page)).some((event) => event.type === 'SilenceStarted')).toBe(true);
  await waitFrames(page, 3);
  // Geo looks at this one: the depth test itself is pinned by `levelScene.test.ts`.
  await testInfo.attach('baby-behind-sofa', {
    body: await sceneShot(page),
    contentType: 'image/png',
  });
});
