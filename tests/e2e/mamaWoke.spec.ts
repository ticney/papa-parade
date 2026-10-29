import { expect, type Page, test } from '@playwright/test';
import {
  advanceToEnd,
  collectProblems,
  cueCount,
  hapticPatternOf,
  html,
  liveFeedback,
  liveFeel,
  recordVibrations,
  vibrations,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  waitForTestApi,
} from './support/testApi.ts';

// Mama wakes (story 3.2) on the live level, driven by the test API on a frozen level: `SetNoise` takes
// the gauge to 100 % and one step ends the level, so nothing waits on a fixed delay. No score is
// pinned: the base stars are read from `LevelScored`. WebKit has no `navigator.vibrate`, so it checks
// the DOM only.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PANEL = '.pp-result-panel';
const HEADER = `${PANEL} .pp-result-reason`;
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
/** Five thresholds every game reaches: five base stars, so that the lost one has stars to come from. */
const EVERY_STAR = [1, 2, 3, 4, 5];
const SEQUENCE_TIMEOUT_MS = 15_000;
const GRACE_MARGIN_MS = 60;
/** A noise above `alertPct` taken first, so that the wake itself plays no alert cue. */
const LOUD_PCT = 85;

interface Scored {
  stars: number;
  lostStars: number;
  scorePoints: number;
}

const hasVibrate = (): boolean => test.info().project.name === 'chromium';

/**
 * Opens a frozen level and takes the noise to `LOUD_PCT` (the 80 % alert plays there, not later), then
 * returns the cue and vibration counts to compare with, just before the step that wakes Mama.
 */
async function openLoud(page: Page): Promise<{ cues: number; vibrationCount: number }> {
  await recordVibrations(page);
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await ppSetFeel(page, { mama: { starThresholdPoints: EVERY_STAR } });
  await ppSend(page, { type: 'SetNoise', pct: LOUD_PCT });
  await ppAdvance(page, 1);
  await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
  return {
    cues: await cueCount(page),
    vibrationCount: hasVibrate() ? (await vibrations(page)).length : 0,
  };
}

/** Wakes Mama: `SetNoise` 100, then one step. Returns the note of the level. */
async function wake(page: Page): Promise<Scored> {
  await ppSend(page, { type: 'SetNoise', pct: 100 });
  await ppAdvance(page, 1);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
  const scored = (await ppEvents(page)).find((event) => event.type === 'LevelScored');
  if (scored === undefined) throw new Error('no LevelScored after Mama woke');
  return scored as unknown as Scored;
}

const waitForInputGrace = (page: Page): Promise<void> =>
  page.waitForTimeout(liveFeedback.resultScreen.inputGraceMs + GRACE_MARGIN_MS);

async function waitForActions(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-result', 'actions', {
    timeout: SEQUENCE_TIMEOUT_MS,
  });
  await waitForInputGrace(page);
}

test.describe('Mama wakes', () => {
  test('ends the level on the noise: mamaWoke, the header, the base stars minus the penalty, one lost star after the earned ones', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openLoud(page);
    const scored = await wake(page);
    const events = await ppEvents(page);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'MamaWoke')).toHaveLength(1);
    expect(types.indexOf('MamaWoke')).toBe(types.indexOf('LevelEnded') - 1);
    expect(events.find((event) => event.type === 'LevelEnded')).toMatchObject({
      reason: 'mamaWoke',
    });

    const base = scored.stars + scored.lostStars;
    expect(base).toBeGreaterThanOrEqual(1);
    expect(scored.lostStars).toBe(Math.min(liveFeel.mama.earlyWakePenaltyStars, base));
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'mamaWoke');
    await expect(html(page)).toHaveAttribute('data-pp-stars', String(scored.stars));
    await expect(html(page)).toHaveAttribute('data-pp-lost-stars', String(scored.lostStars));

    await expect(page.locator(HEADER)).toBeVisible();
    await expect(page.locator(HEADER)).toHaveText(STRINGS['result.mama_woke'] as string);
    await waitForActions(page);
    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(scored.stars);
    await expect(page.locator(`${PANEL} .pp-star-lost`)).toHaveCount(scored.lostStars);
    await expect(page.locator(`${PANEL} .pp-star-lost-chip`)).toHaveText(
      Array.from({ length: scored.lostStars }, () => STRINGS['result.star_lost'] as string),
    );
    // Five slots, the lost ones right after the earned ones; a lost slot is never an earned one.
    const slots = await page.locator(`${PANEL} .pp-stars > svg`).evaluateAll((nodes) =>
      nodes.map((node) => {
        if (node.classList.contains('pp-star-earned')) return 'earned';
        return node.classList.contains('pp-star-lost') ? 'lost' : 'empty';
      }),
    );
    expect(slots).toEqual([
      ...Array.from({ length: scored.stars }, () => 'earned'),
      ...Array.from({ length: scored.lostStars }, () => 'lost'),
      ...Array.from({ length: 5 - base }, () => 'empty'),
    ]);
    await expect(page.locator(`${PANEL} .pp-stars`)).toHaveAttribute(
      'aria-label',
      (STRINGS['result.stars_lost_label'] as string)
        .replace('{count}', String(scored.stars))
        .replace('{max}', '5')
        .replace('{lost}', String(scored.lostStars)),
    );
    await expect(page.locator(REPLAY)).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('plays the cues in order: the door slam, the earned stars (the last heavy), then the lost star', async ({
    page,
  }) => {
    const before = await openLoud(page);
    const scored = await wake(page);
    await waitForActions(page);
    // The door-slam cue, each earned star, each lost star: no other cue between the two screens.
    expect(await cueCount(page)).toBe(before.cues + 1 + scored.stars + scored.lostStars);
    if (hasVibrate()) {
      const slam = hapticPatternOf('ResultMamaWokeShown');
      const light = hapticPatternOf('ResultStarStamped');
      const heavy = hapticPatternOf('ResultLastStarStamped');
      const lostLight = hapticPatternOf('ResultStarLost');
      expect(slam).not.toBeNull();
      expect(lostLight).not.toBeNull();
      expect((await vibrations(page)).slice(before.vibrationCount)).toEqual([
        slam,
        ...Array.from({ length: scored.stars - 1 }, () => light),
        heavy,
        ...Array.from({ length: scored.lostStars }, () => lostLight),
      ]);
    }
  });

  test('a skip places the lost star silently: no lost-star cue, no stamp', async ({ page }) => {
    const before = await openLoud(page);
    const scored = await wake(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    // The door slam plays when the header comes up; nothing after it on a skip.
    const cuesAfterOpen = await cueCount(page);
    expect(cuesAfterOpen).toBe(before.cues + 1);
    const vibrationsAfterOpen = hasVibrate() ? (await vibrations(page)).length : 0;
    await waitForInputGrace(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars/);
    await page.locator(`${PANEL} .pp-score-card`).click();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(scored.stars);
    await expect(page.locator(`${PANEL} .pp-star-lost`)).toHaveCount(scored.lostStars);
    await expect(page.locator(`${PANEL} .pp-star-lost-chip`)).toHaveCount(scored.lostStars);
    await expect(page.locator(`${PANEL} .pp-star-stamped`)).toHaveCount(0);
    expect(await cueCount(page)).toBe(cuesAfterOpen);
    if (hasVibrate()) expect((await vibrations(page)).length).toBe(vibrationsAfterOpen);
  });

  test('the header slams once; under reduced motion it shows at rest, and the underline is there either way', async ({
    page,
  }) => {
    await openLoud(page);
    await wake(page);
    const read = () =>
      page.locator(HEADER).evaluate((node) => ({
        name: getComputedStyle(node).animationName,
        shadow: getComputedStyle(node).boxShadow,
      }));
    const animated = await read();
    expect(animated.name).toBe('pp-result-slam');
    // The `mama-scream` underline, resolved from the token.
    const scream = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--pp-color-mama-scream)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(animated.shadow).toContain(scream);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await read();
    expect(still.name).toBe('none');
    expect(still.shadow).toContain(scream);
  });

  test('the lost star is dashed, in ink-soft, with no fill', async ({ page }) => {
    await openLoud(page);
    await wake(page);
    await waitForActions(page);
    const lost = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--pp-color-ink-soft)';
      document.body.append(probe);
      const soft = getComputedStyle(probe).color;
      probe.remove();
      const shape = document.querySelector('.pp-star-lost .pp-star-shape');
      if (shape === null) return null;
      const style = getComputedStyle(shape);
      return { soft, stroke: style.stroke, fill: style.fill, dash: style.strokeDasharray };
    });
    expect(lost).not.toBeNull();
    expect(lost?.stroke).toBe(lost?.soft);
    expect(lost?.fill).toBe('none');
    expect(lost?.dash).not.toBe('none');
  });

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 750, height: 340 },
  ]) {
    test(`fits ${viewport.width} × ${viewport.height} with the header, without scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openLoud(page);
      await wake(page);
      await waitForActions(page);
      const fit = await page.locator(PANEL).evaluate((panel) => ({
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        top: panel.getBoundingClientRect().top,
        bottom: panel.getBoundingClientRect().bottom,
      }));
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
      expect(fit.top).toBeGreaterThanOrEqual(0);
      expect(fit.bottom).toBeLessThanOrEqual(viewport.height);
      // The chip hangs off the stars: it stays inside the panel.
      const chip = await page.locator(`${PANEL} .pp-star-lost-chip`).first().boundingBox();
      const box = await page.locator(PANEL).boundingBox();
      expect(chip).not.toBeNull();
      expect((chip?.x ?? 0) + (chip?.width ?? 0)).toBeLessThanOrEqual(
        (box?.x ?? 0) + (box?.width ?? 0),
      );
    });
  }

  test('a timer end has no header, no lost star and the reason timer', async ({ page }) => {
    await page.goto('/');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await advanceToEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'timer');
    await expect(html(page)).toHaveAttribute('data-pp-lost-stars', '0');
    await expect(page.locator(HEADER)).toHaveCount(0);
    await waitForActions(page);
    await expect(page.locator(`${PANEL} .pp-star-lost`)).toHaveCount(0);
    await expect(page.locator(`${PANEL} .pp-star-lost-chip`)).toHaveCount(0);
  });

  test('the next level forgets the reason: « Rejouer » clears the mirrors', async ({ page }) => {
    await openLoud(page);
    await wake(page);
    await waitForActions(page);
    await page.locator(REPLAY).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).not.toHaveAttribute('data-pp-end-reason', /.*/);
    await expect(html(page)).not.toHaveAttribute('data-pp-lost-stars', /.*/);
  });
});
