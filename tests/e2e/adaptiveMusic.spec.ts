import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { PARRY_RELEASE_AFTER_MS } from '../support/timeEffects.ts';
import {
  collectProblems,
  html,
  liveFeel,
  liveSilence,
  startLevel,
  stepToFirstTelegraph,
  WALK_BOUND_MS,
} from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The adaptive music (story 2.6). The mirrors prove the intent (which mood the music is asked to
// be in); the mixing graph itself is proven with fakes in `adaptiveMusic.test.ts`. What no spec can
// check is how it SOUNDS: Geo listens. Every bound comes from the live `content/feel.json`.
// Chromium and WebKit both run it.

const LEVEL = 'salon_crawler';
const SEED = 42;
const AUTOPLAY_SEED = 42;
const SPEED = 4;
/** A bot's first telegraph and first perfect, in real time at speed 4, with a margin. */
const AUTOPLAY_TIMEOUT_MS = 60_000;

const { slowMoPerfect } = JSON.parse(readFileSync('content/feel.json', 'utf8')).timing as {
  slowMoPerfect: { timeScale: number; durationMs: number; returnMs: number };
};

const stepsTo = (fromMs: number, toMs: number): number => Math.ceil((toMs - fromMs) / STEP_MS);

const attribute = (page: Page, name: string) => html(page).getAttribute(name);
const count = async (page: Page, name: string): Promise<number> =>
  Number(await attribute(page, name));

/** Starts the game for real (audio unlocked, music playing), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** The mood the world asks for, computed from the live world the way the game does. */
async function wantedMood(page: Page): Promise<{ tense: 'on' | 'off'; slow: 'on' | 'off' }> {
  const world = await ppWorld(page);
  const isTense = world.threats.some(
    (threat) => threat.state === 'telegraph' || threat.state === 'windowOpen',
  );
  const isSlowed = world.time.scale < liveFeel.music.slowMo.belowScale;
  return { tense: isTense ? 'on' : 'off', slow: isSlowed ? 'on' : 'off' };
}

test.describe('the music follows the game (story 2.6)', () => {
  test('a bot playing perfectly raises the tension at each threat and the slow-mo at each perfect', async ({
    page,
  }) => {
    test.setTimeout(AUTOPLAY_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto(`/?autoplay=perfect&seed=${AUTOPLAY_SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    // An autoplay run has no start gesture, so no audio context: the game is silent and
    // `data-pp-music` stays `off`. The mood mirrors report the intent all the same.
    await expect(html(page)).toHaveAttribute('data-pp-music-tense-count', /^[0-9]+$/);
    // The counts, not the states: a mood can be shorter than a poll at speed 4.
    await expect
      .poll(() => count(page, 'data-pp-music-tense-count'), { timeout: AUTOPLAY_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => count(page, 'data-pp-music-slow-count'), { timeout: AUTOPLAY_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test('calm at the start, tense while a threat is on, slowed through a perfect, calm again after', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-music-slow', 'off');

    // Up to the first telegraph of the live plan, then to the opening of its window.
    const first = await stepToFirstTelegraph(page);
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music-slow', 'off');
    const telegraphed = await ppWorld(page);
    const threat = telegraphed.threats.find((candidate) => candidate.id === first.threatId);
    if (threat === undefined || threat.responseWindow === null) throw new Error('no window');
    await ppAdvance(page, stepsTo(telegraphed.time.sim, threat.windowOpenAt));
    expect((await ppWorld(page)).threats.find((t) => t.id === threat.id)?.state).toBe('windowOpen');
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'on');

    // A perfect parry: the press at the centre of the window, the release shortly after.
    const centerMs = threat.windowOpenAt + threat.responseWindow.windowMs / 2;
    const resolvedAt = centerMs + PARRY_RELEASE_AFTER_MS;
    await ppSend(page, { type: 'PressThreat', t: centerMs as never, threatId: threat.id });
    await ppSend(page, { type: 'Release', t: resolvedAt as never });
    const beforeResolve = await ppWorld(page);
    const slowCountBefore = await count(page, 'data-pp-music-slow-count');
    await ppAdvance(page, stepsTo(beforeResolve.time.sim, resolvedAt) + 2);

    // Inside the slow-mo's hold: the scale is down, and so is the music.
    const slowed = await ppWorld(page);
    expect(slowed.time.scale).toBe(slowMoPerfect.timeScale);
    expect(slowed.time.scale).toBeLessThan(liveFeel.music.slowMo.belowScale);
    await expect(html(page)).toHaveAttribute('data-pp-music-slow', 'on');
    expect(await count(page, 'data-pp-music-slow-count')).toBeGreaterThan(slowCountBefore);
    // The threat the perfect resolved is no tension any more (the next one has not come yet).
    const resolvedThreat = slowed.threats.find((candidate) => candidate.id === threat.id);
    expect(resolvedThreat?.state).toBe('resolved');
    expect(await wantedMood(page)).toEqual({ tense: 'off', slow: 'on' });
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');

    // Past the hold and the return: the scale is back to 1 and the music with it.
    await ppAdvance(
      page,
      stepsTo(slowed.time.sim, resolvedAt + slowMoPerfect.durationMs + slowMoPerfect.returnMs) + 2,
    );
    expect((await ppWorld(page)).time.scale).toBe(1);
    await expect(html(page)).toHaveAttribute('data-pp-music-slow', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    expect(problems).toEqual([]);
  });

  test('a silence cuts the music while it lasts, and the music returns in the mood of the world', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const world = await ppWorld(page);
    const silence = world.threats.find((candidate) => candidate.defId === liveSilence.id);
    if (silence === undefined) throw new Error('the level does not plan the silence');
    await ppSend(page, { type: 'ForceThreat', threatId: silence.id });
    // The crawl to the zone, the quiet that follows, with a margin for the path's detours.
    const crawlBoundMs =
      WALK_BOUND_MS * Math.max(1, liveFeel.movement.walkSpeedMps / liveFeel.baby.sneakSpeedMps) +
      liveFeel.baby.silenceAlertMs;
    const chunks = Math.ceil(crawlBoundMs / (25 * STEP_MS));
    let isSilent = false;
    for (let i = 0; i <= chunks && !isSilent; i++) {
      await ppAdvance(page, 25);
      isSilent = (await ppEvents(page)).some((event) => event.type === 'SilenceStarted');
    }
    expect(isSilent).toBe(true);

    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    // The silence's own threat is `hidden`: not a tension.
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');

    // Left alone, the silence times out into a late gag, and the music is back.
    await ppAdvance(page, Math.ceil(liveSilence.findMaxMs / STEP_MS) + 2);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    const mood = await wantedMood(page);
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', mood.tense);
    await expect(html(page)).toHaveAttribute('data-pp-music-slow', mood.slow);
    expect(problems).toEqual([]);
  });
});
