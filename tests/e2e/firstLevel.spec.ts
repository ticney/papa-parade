import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import { hashJson } from '../../src/shared/hash.ts';
import {
  collectProblems,
  html,
  OVERRUN_MARGIN_MS,
  OWN_WARNINGS,
  waitFrames,
} from './support/game.ts';
import { ppFreeze, ppFx, ppWorld, waitForTestApi } from './support/testApi.ts';

// The big room is the game's first level (story 9.8): a start with no `?level=` plays it, with its
// follow camera. Every other spec names its room (`appUrl` adds the salon to a bare URL); these are the
// ones that do not, on purpose.
const FIRST_LEVEL = 'salon_kitchen';
const SEED = 42;
const SPEED = 4;
const AUTOPLAY_TIMEOUT_MS = 180_000;

/** The screen `content/bots.json › human.view` plays on: the e2e viewport (844 × 390). */
const bots = JSON.parse(readFileSync('content/bots.json', 'utf8')) as {
  human: { view: { widthPx: number; heightPx: number; hudBottomPx: number } };
};

test('a start with no ?level= loads the big room and its follow camera', async ({ page }) => {
  await page.goto('/');
  await waitForTestApi(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
  await expect(html(page)).toHaveAttribute('data-pp-level', FIRST_LEVEL);
  await waitFrames(page, 3);
  expect((await ppFx(page)).cameraMode).toBe('follow');
});

test('an autoplay human game with no ?level= plays the big room to the Result, with no problem', async ({
  page,
}) => {
  test.setTimeout(AUTOPLAY_TIMEOUT_MS + 30_000);
  const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
  await page.goto(`/?autoplay=human&seed=${SEED}&speed=${SPEED}`);
  await expect(html(page)).toHaveAttribute('data-pp-level', FIRST_LEVEL, {
    timeout: OVERRUN_MARGIN_MS * 3,
  });
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
    timeout: AUTOPLAY_TIMEOUT_MS,
  });
  expect(problems).toEqual([]);
});

test('the human bot’s screen is the client’s: the HUD row bottom in bots.json matches the page at 844 × 390', async ({
  page,
}) => {
  const { widthPx, heightPx, hudBottomPx } = bots.human.view;
  await page.setViewportSize({ width: widthPx, height: heightPx });
  await page.goto('/?level=salon_kitchen');
  await waitForTestApi(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
  // What the off-screen layer measures (boot.ts `measure`): `hudBottomPx − canvasTopPx`, in CSS px. The row
  // has no size for the first frames, so poll until it has one.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const row = document.querySelector('.pp-hud-row')?.getBoundingClientRect();
        const canvas = document.querySelector('#pp-canvas')?.getBoundingClientRect();
        if (row === undefined || canvas === undefined || row.height === 0) return Number.NaN;
        return row.bottom - canvas.top;
      }),
    )
    .toBeGreaterThan(0);
  const measuredPx = await page.evaluate(() => {
    const row = document.querySelector('.pp-hud-row')?.getBoundingClientRect();
    const canvas = document.querySelector('#pp-canvas')?.getBoundingClientRect();
    return (row?.bottom ?? Number.NaN) - (canvas?.top ?? Number.NaN);
  });
  expect(Math.abs(measuredPx - hudBottomPx)).toBeLessThanOrEqual(2);
});

test('a human autoplay game on the big room is the CLI’s game: a frozen frame has its world hash (the bot’s screen is data, not the canvas)', async ({
  page,
}) => {
  await page.goto(`/?autoplay=human&seed=${SEED}&speed=${SPEED}`);
  await waitForTestApi(page);
  // Past the first telegraphs, where the bot has seen threats through the frame and through bubbles.
  await expect
    .poll(() => page.evaluate(() => window.__PP__?.state()?.time.sim ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(20_000);
  await ppFreeze(page, true);
  const world = await ppWorld(page);
  const done = spawnSync(
    'npx',
    [
      'tsx',
      'tools/sim/runSim.ts',
      '--bot',
      'human',
      '--seed',
      String(SEED),
      '--runs',
      '1',
      '--until-ms',
      String(world.time.sim),
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  expect(done.status, done.stderr).toBe(0);
  const report = JSON.parse(done.stdout) as { level: string; runList: { worldHash: string }[] };
  expect(report.level).toBe(FIRST_LEVEL);
  expect(hashJson(world)).toBe(report.runList[0]?.worldHash);
});
