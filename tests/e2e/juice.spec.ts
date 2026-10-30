import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { PARRY_RELEASE_AFTER_MS } from '../support/timeEffects.ts';
import {
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  FIRST_WAVE_RESPONSE_MAX_MS,
  html,
  liveFeedback,
  OVERRUN_MARGIN_MS,
  stepToFirstTelegraph,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Story 2.5: the picture reacts. Everything is read from the live content (`feel.json`,
// `feedback.json`), never typed here: which cue plays which preset, how long the slow-mo holds, how
// far the camera goes. The bot runs are bounded by the live plan, not by a fixed sleep.

const LEVEL = 'salon_crawler';
const SEED = 42;
const SPEED = 4;

const live = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  timing: { slowMoPerfect: { timeScale: number; durationMs: number; returnMs: number } };
  fx: { perfectCamera: { zoomPct: number; yawDeg: number; focusPct: number; zoomInMs: number } };
};
const { perfectCamera } = live.fx;
const cues = liveFeedback.cues as Record<string, { fx?: 'success' | 'perfect' | 'gag' }>;
const cueIdsOf = (preset: 'success' | 'perfect' | 'gag'): string[] =>
  Object.entries(cues)
    .filter(([, cue]) => cue.fx === preset)
    .map(([id]) => id);

/** Real ms the bot needs to get its first response (a generous bound from the live plan). */
const FIRST_RESPONSE_TIMEOUT_MS =
  RESUME_COUNTDOWN_MS +
  (FIRST_TELEGRAPH_MAX_MS + FIRST_WAVE_RESPONSE_MAX_MS) / SPEED +
  2 * OVERRUN_MARGIN_MS;
/** A whole level of a human bot: enough for it to succeed without a perfect at least once. */
const SOME_RESPONSES_TIMEOUT_MS = 8 * FIRST_RESPONSE_TIMEOUT_MS;

async function firstRecordOf(page: Page, presets: string[], timeoutMs: number) {
  let found: Awaited<ReturnType<typeof ppCueLog>>[number] | undefined;
  await expect
    .poll(
      async () => {
        found = (await ppCueLog(page)).find((record) => presets.includes(record.cueId));
        return found?.cueId ?? null;
      },
      { timeout: timeoutMs, message: `no cue of ${presets.join(', ')} in __PP__.cueLog()` },
    )
    .not.toBeNull();
  if (found === undefined) throw new Error('unreachable: the poll found a record');
  return found;
}

/**
 * On a frozen level: steps to the first telegraph, to its window, and answers it with a perfect
 * Parry. Returns the `perfect` slow-mo the sim started.
 */
async function perfectParry(page: Page) {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  const first = await stepToFirstTelegraph(page);
  const telegraphed = await ppWorld(page);
  const threat = telegraphed.threats.find((one) => one.id === first.threatId);
  if (threat === undefined || threat.responseWindow === null) throw new Error('no window');
  await ppAdvance(page, Math.ceil((threat.windowOpenAt - telegraphed.time.sim) / STEP_MS));
  const centerMs = threat.windowOpenAt + threat.responseWindow.windowMs / 2;
  const resolvedAt = centerMs + PARRY_RELEASE_AFTER_MS;
  await ppSend(page, { type: 'PressThreat', t: centerMs as never, threatId: threat.id });
  await ppSend(page, { type: 'Release', t: resolvedAt as never });
  const before = await ppWorld(page);
  await ppAdvance(page, Math.ceil((resolvedAt - before.time.sim) / STEP_MS) + 2);
  const slowMo = (await ppWorld(page)).time.slowMos.find((one) => one.source === 'perfect');
  if (slowMo === undefined) throw new Error('the perfect did not start its slow-mo');
  return slowMo;
}

/** Advances the frozen level in small chunks until its sim clock reaches `simMs`. */
async function advanceToSim(page: Page, simMs: number): Promise<void> {
  const chunkSteps = 3;
  for (let i = 0; i < 2000; i++) {
    if ((await ppWorld(page)).time.sim >= simMs) return;
    await ppAdvance(page, chunkSteps);
  }
  throw new Error(`the sim clock never reached ${simMs} ms`);
}

test.describe('the picture reacts (story 2.5)', () => {
  test('a perfect shakes, bursts and stamps; the stamp never takes a tap', async ({ page }) => {
    test.setTimeout(FIRST_RESPONSE_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto(`/?autoplay=perfect&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    const record = await firstRecordOf(page, cueIdsOf('perfect'), FIRST_RESPONSE_TIMEOUT_MS);
    expect(record.visuals).toEqual(expect.arrayContaining(['particles', 'shake', 'stamp']));
    // The mirror counts every stamp (a poll of the element could miss an 800 ms fade at speed 4).
    const count = Number(await html(page).getAttribute('data-pp-stamp-count'));
    expect(count).toBeGreaterThanOrEqual(1);
    const stamp = page.locator('.pp-epic-stamp');
    await expect(stamp).toHaveCount(1);
    await expect(stamp).toHaveCSS('pointer-events', 'none');
    expect((await ppFx(page)).stampCount).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test('a success shakes and bursts, and has no stamp', async ({ page }) => {
    test.setTimeout(SOME_RESPONSES_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto(`/?autoplay=human&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    const record = await firstRecordOf(page, cueIdsOf('success'), SOME_RESPONSES_TIMEOUT_MS);
    expect(record.visuals).toEqual(expect.arrayContaining(['particles', 'shake']));
    expect(record.visuals).not.toContain('stamp');
    expect(problems).toEqual([]);
  });

  test('a gag shakes and puffs', async ({ page }) => {
    test.setTimeout(FIRST_RESPONSE_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto(`/?autoplay=idle&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    const record = await firstRecordOf(page, cueIdsOf('gag'), FIRST_RESPONSE_TIMEOUT_MS);
    expect(record.visuals).toEqual(expect.arrayContaining(['particles', 'shake']));
    expect(record.visuals).not.toContain('stamp');
    expect(problems).toEqual([]);
  });

  test('the camera zooms and turns during the perfect slow-mo, and is back on the iso framing after', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const slowMo = await perfectParry(page);
    // Inside the hold: past the zoom-in, before the return.
    await advanceToSim(page, slowMo.startedAt + perfectCamera.zoomInMs + 4 * STEP_MS);
    expect((await ppWorld(page)).time.sim).toBeLessThan(slowMo.holdUntil);
    await expect
      .poll(async () => (await ppFx(page)).cameraZoom, { message: 'the zoom of the perfect' })
      .toBeCloseTo(1 + perfectCamera.zoomPct / 100, 6);
    const held = await ppFx(page);
    expect(held.cameraYawDeg).toBeCloseTo(perfectCamera.yawDeg, 6);

    // The slow-mo is over: the exact framing is back.
    await advanceToSim(page, slowMo.endsAt + STEP_MS);
    expect((await ppWorld(page)).time.slowMos.some((one) => one.source === 'perfect')).toBe(false);
    await expect.poll(async () => (await ppFx(page)).cameraZoom).toBe(1);
    expect((await ppFx(page)).cameraYawDeg).toBe(0);
    expect(problems).toEqual([]);
  });

  test('the stamp does not block a tap: it falls through to the game', async ({ page }) => {
    const problems = collectProblems(page);
    await perfectParry(page);
    await page.waitForFunction(() => Number(document.documentElement.dataset.ppStampCount) >= 1);
    const stamp = page.locator('.pp-epic-stamp');
    const box = await stamp.boundingBox();
    if (box === null) throw new Error('the stamp has no box');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // The element under the finger is never the stamp.
    const under = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.className ?? '',
      centre,
    );
    expect(String(under)).not.toContain('pp-epic-stamp');
    // And a real tap there lands on the game, not on the stamp.
    await page.evaluate(() => {
      (window as unknown as { __tapTargets: string[] }).__tapTargets = [];
      document.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target as HTMLElement;
          (window as unknown as { __tapTargets: string[] }).__tapTargets.push(
            `${target.id}|${String(target.className)}`,
          );
        },
        { capture: true },
      );
    });
    const eventsBefore = (await ppEvents(page)).length;
    await page.mouse.click(centre.x, centre.y);
    const targets = await page.evaluate(
      () => (window as unknown as { __tapTargets: string[] }).__tapTargets,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toContain('pp-epic-stamp');
    // The game got the tap: the level is frozen, so one step lets the sim take what was sent.
    await ppAdvance(page, 2);
    const fresh = (await ppEvents(page, eventsBefore)).map((event) => event.type);
    expect(fresh).toEqual(expect.arrayContaining(['PapaPathPlanned']));
    expect(problems).toEqual([]);
  });
});

test.describe('reduced motion (story 2.5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('a perfect still bursts and stamps, but does not shake', async ({ page }) => {
    test.setTimeout(FIRST_RESPONSE_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto(`/?autoplay=perfect&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    const record = await firstRecordOf(page, cueIdsOf('perfect'), FIRST_RESPONSE_TIMEOUT_MS);
    expect(record.visuals).toEqual(expect.arrayContaining(['particles', 'stamp']));
    expect(record.visuals).not.toContain('shake');
    const log = await ppCueLog(page);
    expect(log.some((one) => one.visuals.includes('shake'))).toBe(false);
    expect((await ppFx(page)).cameraYawDeg).toBe(0);
    expect(problems).toEqual([]);
  });

  test('the camera does not turn and zooms at most half as far', async ({ page }) => {
    const problems = collectProblems(page);
    const slowMo = await perfectParry(page);
    await advanceToSim(page, slowMo.startedAt + perfectCamera.zoomInMs + 4 * STEP_MS);
    await expect
      .poll(async () => (await ppFx(page)).cameraZoom, { message: 'the zoom of the perfect' })
      .toBeGreaterThan(1);
    const held = await ppFx(page);
    expect(held.cameraYawDeg).toBe(0);
    expect(held.cameraZoom).toBeLessThanOrEqual(1 + perfectCamera.zoomPct / 200 + 1e-9);
    expect(held.shakeOffsetM).toBe(0);
    expect(problems).toEqual([]);
  });
});
