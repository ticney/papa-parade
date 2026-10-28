import { expect, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  anchorMirror,
  collectProblems,
  FAILED_REQUEST,
  html,
  liveFeel,
  THREATS_OFF,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  ppState,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// `window.__PP__` (story 1.13), method by method. The room is quiet (`?threats=off`) unless a test
// needs the outlet. A level loaded while frozen waits at sim time 0 for `advance`.

const LEVEL = 'salon_crawler';
const SEED = 7;
const SIM_STEP_S = STEP_MS / 1000;

/** Opens the quiet room with the test API and starts the level frozen at sim time 0. */
async function openFrozenLevel(page: Parameters<typeof waitForTestApi>[0], seed = SEED) {
  await page.goto(`/${THREATS_OFF}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, seed);
}

/** A far point of the room for Papa to walk to: the phone's anchor, a long way from the spawn. */
const FAR = anchorMirror('phone');

test.describe('window.__PP__', () => {
  test('exists in dev without ?debug=1, with its eight methods', async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    const methods = await page.evaluate(() => Object.keys(window.__PP__ ?? {}).sort());
    expect(methods).toEqual([
      'advance',
      'events',
      'freeze',
      'loadLevel',
      'perf',
      'send',
      'setFeel',
      'state',
    ]);
    expect(problems).toEqual([]);
  });

  test('state() is null on the start screen and a copy of the world once a level runs', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    expect(await ppState(page)).toBeNull();

    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    const world = await ppWorld(page);
    expect(world.time.sim).toBe(0);
    expect(world.papa.state).toBe('idle');
    // A copy: changing it in the page changes nothing in the game.
    const after = await page.evaluate(() => {
      const copy = window.__PP__?.state();
      if (copy) copy.time.sim = 123456 as never;
      return window.__PP__?.state()?.time.sim;
    });
    expect(after).toBe(0);
    expect(problems).toEqual([]);
  });

  test('freeze(true) stops the sim while frames go on, freeze(false) lets it run again', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await expect.poll(async () => (await ppWorld(page)).time.sim).toBeGreaterThan(0);

    await ppFreeze(page, true);
    const frozenAt = (await ppWorld(page)).time.sim;
    await waitFrames(page, 10);
    expect((await ppWorld(page)).time.sim).toBe(frozenAt);

    await ppFreeze(page, false);
    await expect.poll(async () => (await ppWorld(page)).time.sim).toBeGreaterThan(frozenAt);
    expect(problems).toEqual([]);
  });

  test('advance(n) from a frozen level moves the sim time by exactly n steps and the events follow', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppSend(page, { type: 'TapFloor', xM: FAR.x, zM: FAR.z });
    await ppAdvance(page, 10);

    expect((await ppWorld(page)).time.sim).toBe(10 * STEP_MS);
    const events = await ppEvents(page);
    const walk = events.find((event) => event.type === 'PapaStateChanged');
    expect(walk).toMatchObject({ type: 'PapaStateChanged', from: 'idle', to: 'walkPath' });
    // Frozen after the advance: more frames change nothing.
    await waitFrames(page, 10);
    expect((await ppWorld(page)).time.sim).toBe(10 * STEP_MS);
    expect(problems).toEqual([]);
  });

  test('events(since) returns only the newer events, and starts over at a new level', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppSend(page, { type: 'TapFloor', xM: FAR.x, zM: FAR.z });
    await ppAdvance(page, 5);
    const seen = await ppEvents(page);
    expect(seen.length).toBeGreaterThan(0);
    await ppSend(page, { type: 'MoveStop' });
    await ppSend(page, { type: 'TapFloor', xM: FAR.x + 0.5, zM: FAR.z });
    await ppAdvance(page, 30);
    const all = await ppEvents(page);
    expect(all.length).toBeGreaterThanOrEqual(seen.length);
    expect(all.slice(0, seen.length)).toEqual(seen);
    expect(await ppEvents(page, seen.length)).toEqual(all.slice(seen.length));
    expect(await ppEvents(page, all.length)).toEqual([]);

    await ppLoadLevel(page, LEVEL, SEED);
    expect(await ppEvents(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("send() of a malformed command rejects with the sim's message, and the game goes on", async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await expect(ppSend(page, { type: 'Move', dirX: 0, dirZ: 0 })).rejects.toThrow(
      /__PP__\.send:.*the direction must not be \(0, 0\)/,
    );
    await ppAdvance(page, 3);
    expect((await ppWorld(page)).time.sim).toBe(3 * STEP_MS);
    expect(problems).toEqual([]);
  });

  test('setFeel() sends the journaled SetFeel: no restart, the new value in the world after one step, and Papa walks faster', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppAdvance(page, 5);
    const before = await ppWorld(page);
    const fasterMps = 2 * liveFeel.movement.walkSpeedMps;
    await ppSetFeel(page, { movement: { walkSpeedMps: fasterMps } });
    // Same level, same clock: nothing restarted, and the command waits for the next step.
    const queued = await ppWorld(page);
    expect(queued.time.sim).toBe(5 * STEP_MS);
    expect(queued.nextId).toBe(before.nextId);
    expect(queued.feel.movement.walkSpeedMps).toBe(liveFeel.movement.walkSpeedMps);
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).feel.movement.walkSpeedMps).toBe(fasterMps);

    // A walk after the change covers about twice the way the old speed would in the same steps.
    const spawn = (await ppWorld(page)).papa;
    const distanceM = Math.hypot(FAR.x - spawn.xM, FAR.z - spawn.zM);
    const steps = Math.floor((0.8 * distanceM) / (fasterMps * SIM_STEP_S));
    expect(steps).toBeGreaterThan(10);
    await ppSend(page, { type: 'TapFloor', xM: FAR.x, zM: FAR.z });
    await ppAdvance(page, steps);
    const after = (await ppWorld(page)).papa;
    const walkedM = Math.hypot(after.xM - spawn.xM, after.zM - spawn.zM);
    expect(after.state).toBe('walkPath');
    expect(walkedM).toBeGreaterThan(1.5 * steps * liveFeel.movement.walkSpeedMps * SIM_STEP_S);
    expect(walkedM).toBeLessThanOrEqual(steps * fasterMps * SIM_STEP_S + 1e-6);
    expect(problems).toEqual([]);
  });

  test('a restart keeps the value tuned with setFeel()', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    const tunedMs = liveFeel.timing.windowMs + 40;
    await ppSetFeel(page, { timing: { windowMs: tunedMs } });
    await ppAdvance(page, 1);
    await ppLoadLevel(page, LEVEL, SEED);
    expect((await ppWorld(page)).feel.timing.windowMs).toBe(tunedMs);
    expect(problems).toEqual([]);
  });

  test('setFeel() with an invalid patch rejects, naming the path, and sends nothing', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppAdvance(page, 5);
    await expect(ppSetFeel(page, { timing: { windowMs: -1 } })).rejects.toThrow(
      /__PP__\.setFeel.*timing\.windowMs/,
    );
    expect((await ppWorld(page)).time.sim).toBe(5 * STEP_MS);
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).feel.timing.windowMs).toBe(liveFeel.timing.windowMs);
    expect(problems).toEqual([]);
  });

  test('loadLevel() starts that level with that seed and resolves with the game running', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await expect(html(page)).toHaveAttribute('data-pp-seed', String(SEED));
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');

    // And again from a running level, with another seed.
    await ppLoadLevel(page, LEVEL, 99);
    await expect(html(page)).toHaveAttribute('data-pp-seed', '99');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running');
    expect(problems).toEqual([]);
  });

  test('loadLevel() of an unknown level rejects naming it, and the app shows « Oups »', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: FAILED_REQUEST });
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    await expect(ppLoadLevel(page, 'nowhere', 1)).rejects.toThrow(/__PP__\.loadLevel.*nowhere/);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    expect(problems).toEqual([]);
  });

  test('loadLevel() with a bad seed rejects without leaving the level', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await expect(ppLoadLevel(page, LEVEL, -1)).rejects.toThrow(/__PP__\.loadLevel.*seed/);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    expect((await ppWorld(page)).time.sim).toBe(0);
    expect(problems).toEqual([]);
  });
});
