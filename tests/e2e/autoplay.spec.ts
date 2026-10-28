import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { hashJson } from '../../src/shared/hash.ts';
import {
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  FIRST_WAVE_RESPONSE_MAX_MS,
  html,
  mirrorWrites,
  OVERRUN_MARGIN_MS,
  recordMirrorWrites,
  stepToFirstTelegraph,
  telegraphDelayMsOf,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppState,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// A bot plays in the real browser (story 1.13): `?autoplay=<bot>&seed=<n>&speed=<x>`. Every bound
// is derived from the live plan; nothing waits on a fixed delay.

const AUTOPLAY = '/?autoplay=perfect&seed=42&speed=4';
const SPEED = 4;
/** Real ms for the level to be running, then for the first threat to be answered at `speed`. */
const FIRST_RESPONSE_TIMEOUT_MS =
  RESUME_COUNTDOWN_MS +
  (FIRST_TELEGRAPH_MAX_MS + FIRST_WAVE_RESPONSE_MAX_MS) / SPEED +
  2 * OVERRUN_MARGIN_MS;

const isGood = (event: { type: string; quality?: string }): boolean =>
  event.type === 'ResponseResolved' && (event.quality === 'perfect' || event.quality === 'success');

test.describe('autoplay', () => {
  test('starts the level by itself and the perfect bot parries the first threat, with no problem', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordMirrorWrites(page, ['data-pp-app']);
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);

    await expect
      .poll(async () => (await ppEvents(page)).some(isGood), {
        timeout: FIRST_RESPONSE_TIMEOUT_MS,
      })
      .toBe(true);

    // No click: the app went start → loading → level on its own.
    const apps = (await mirrorWrites(page))
      .filter((write) => write.name === 'data-pp-app')
      .map((write) => write.value);
    expect(apps.slice(0, 3)).toEqual(['start', 'loading', 'level']);
    await expect(html(page)).toHaveAttribute('data-pp-seed', '42');
    expect((await ppEvents(page)).some((event) => event.type === 'GagTriggered')).toBe(false);
    expect(problems).toEqual([]);
  });

  test("is the same game as the headless one: a frozen frame has the CLI's world hash for its sim time", async ({
    page,
  }) => {
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    await expect
      .poll(async () => (await ppEvents(page)).some(isGood), {
        timeout: FIRST_RESPONSE_TIMEOUT_MS,
      })
      .toBe(true);
    await ppFreeze(page, true);
    const world = await ppWorld(page);
    expect(world.time.sim).toBeGreaterThan(0);

    const done = spawnSync(
      'npx',
      [
        'tsx',
        'tools/sim/runSim.ts',
        '--bot',
        'perfect',
        '--seed',
        '42',
        '--runs',
        '1',
        '--until-ms',
        String(world.time.sim),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(done.status, done.stderr).toBe(0);
    const report = JSON.parse(done.stdout) as { runList: { worldHash: string }[] };
    expect(hashJson(world)).toBe(report.runList[0]?.worldHash);
  });

  test('a frozen frame of the first threat, telegraphed, looks the same every time', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    // The autoplay level is loading: `loadLevel` would be ignored. Its countdown has not ended yet,
    // so nothing has been played when the freeze lands.
    await expect.poll(() => ppState(page), { timeout: OVERRUN_MARGIN_MS * 3 }).not.toBeNull();
    await ppFreeze(page, true);
    await ppLoadLevel(page, 'salon_crawler', 42);
    // The first threat is drawn by the PRNG: find it, then land half-way through its telegraph.
    const first = await stepToFirstTelegraph(page);
    const halfDelaySteps = Math.round(telegraphDelayMsOf(first.def) / 2 / STEP_MS);
    const elapsedSteps = Math.round(((await ppWorld(page)).time.sim - first.t) / STEP_MS);
    await ppAdvance(page, Math.max(0, halfDelaySteps - elapsedSteps));

    const world = await ppWorld(page);
    const live = world.threats.filter(
      (threat) => threat.state === 'telegraph' || threat.state === 'windowOpen',
    );
    expect(
      live,
      `no threat is telegraphed at ${world.time.sim} ms: ${JSON.stringify(world.threats)}`,
    ).toHaveLength(1);
    // The world UI follows the frozen world: wait for the icon, then for a few settled frames.
    await expect(page.locator('.pp-threat-icon')).toBeVisible();
    await waitFrames(page, 10);
    await expect(page).toHaveScreenshot('autoplay-frozen.png');
    expect(problems).toEqual([]);
  });

  test('ignores a bot it does not know with a warning that names the bots, and shows the start screen', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto('/?autoplay=nobody');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
    await waitFrames(page, 30);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
    expect(
      warnings.some((text) =>
        text.includes('unknown bot "nobody": choose perfect, human, random, idle'),
      ),
    ).toBe(true);
  });

  test('ignores a bad seed and a bad speed with a warning each, and still plays', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto('/?autoplay=idle&seed=abc&speed=99');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: OVERRUN_MARGIN_MS * 3,
    });
    expect(warnings.some((text) => text.includes('ignoring ?seed=abc'))).toBe(true);
    expect(warnings.some((text) => text.includes('ignoring ?speed=99'))).toBe(true);
    // A random seed, not "abc".
    await expect(html(page)).toHaveAttribute('data-pp-seed', /^\d+$/);
  });
});
