import { expect, type Page, test } from '@playwright/test';
import {
  DRAW_CALLS_MAX,
  LOADING_LINE_INTERVAL_MS,
  RESUME_COUNTDOWN_MS,
  TRIANGLES_MAX,
} from '../../src/shared/constants.ts';
import {
  appHistory,
  collectConsoleErrors,
  collectLoadWarnings,
  collectProblems,
  distinctColours,
  FAILED_REQUEST,
  GEOMETRY_URL,
  GLB_URL,
  holdRequests,
  html,
  OVERRUN_MARGIN_MS,
  openGame,
  pauseButton,
  recordAppStates,
  sceneShot,
  setVisibility,
  startLevel,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

// The level pipeline end to end: the room shows, the loading screen, the background, a failed load,
// an uncaught exception, a restart. Visual quality (does the room look right?) is judged by hand
// (story 1.6, T9): these tests prove that something is drawn, within budget, and that the flows hold.

const LOADING_LINES = [
  STRINGS['loading.line_bottle'],
  STRINGS['loading.line_toys'],
  STRINGS['loading.line_keys'],
];
/** Frames the page gets to prove that nothing moves on: a bound, not a wait. */
const FRAMES_TO_PROVE_STILL = 60;
/** How long the forced throw of test 6a waits after the app enters `level`: more than `expect`'s longest poll gap (1000 ms). */
const LEVEL_HOLD_BEFORE_THROW_MS = 1500;
/** The level starts through the countdown, which only ends after this much real time. */
const LEVEL_TIMEOUT_MS = RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS;

const loadingScreen = (page: Page) => page.locator('.pp-loading-screen');
const oopsPanel = (page: Page) => page.locator('.pp-oops-screen .pp-panel');
const retryButton = (page: Page) =>
  page.getByRole('button', { name: STRINGS['oops.retry'], exact: true });

async function pressStart(page: Page): Promise<void> {
  await page.locator('.pp-start-screen').click();
}

async function expectRunning(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: LEVEL_TIMEOUT_MS,
  });
}

/** Fails the load of the level and waits for the « Oups » screen. */
async function failTheLoad(page: Page): Promise<void> {
  await page.route(GLB_URL, (route) => route.abort());
  await openGame(page);
  await pressStart(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
}

test('1. the room shows, within the budget, and is not a single flat colour', async ({ page }) => {
  await startLevel(page);
  await expect(html(page)).toHaveAttribute('data-pp-level', 'salon_crawler');
  const drawCalls = Number(await html(page).getAttribute('data-pp-draw-calls'));
  const triangles = Number(await html(page).getAttribute('data-pp-triangles'));
  expect(drawCalls).toBeGreaterThan(0);
  expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  expect(triangles).toBeGreaterThan(0);
  expect(triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
  expect(await distinctColours(page, await sceneShot(page))).toBeGreaterThan(8);
});

test.describe('the loading screen', () => {
  test('2. stays up while the level loads: bottle, a flavour line, no number, opaque', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openGame(page);
    const glb = await holdRequests(page, GLB_URL);
    await pressStart(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'loading');
    const screen = loadingScreen(page);
    await expect(screen).toBeVisible();
    await expect(screen).toHaveAttribute('role', 'status');
    await expect(screen.locator('.pp-bottle')).toBeVisible();

    const text = (await screen.textContent()) ?? '';
    expect(LOADING_LINES).toContain(text.trim());
    expect(text).not.toMatch(/\d|%/);
    await expect(screen.locator('progress')).toHaveCount(0);
    expect(await screen.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      'rgb(255, 244, 227)',
    );

    // Opaque and full-surface: whatever is under the screen cannot be touched.
    const covered = await page.evaluate(() =>
      [
        [innerWidth / 2, innerHeight / 2],
        [4, 4],
        [innerWidth - 4, innerHeight - 4],
      ].every(
        ([x, y]) =>
          document.elementFromPoint(x as number, y as number)?.closest('.pp-loading-screen') !==
          null,
      ),
    );
    expect(covered).toBe(true);

    glb.release();
    await expectRunning(page);
    await expect(loadingScreen(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('3. the flavour lines rotate while it waits', async ({ page }) => {
    const problems = collectProblems(page);
    await openGame(page);
    const glb = await holdRequests(page, GLB_URL);
    await pressStart(page);
    const first = ((await loadingScreen(page).textContent()) ?? '').trim();
    await expect
      .poll(async () => ((await loadingScreen(page).textContent()) ?? '').trim(), {
        timeout: LOADING_LINE_INTERVAL_MS + OVERRUN_MARGIN_MS,
      })
      .not.toBe(first);
    expect(LOADING_LINES).toContain(((await loadingScreen(page).textContent()) ?? '').trim());
    glb.release();
    await expectRunning(page);
    expect(problems).toEqual([]);
  });

  test('4. in the background the load goes on and the level waits for the foreground', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openGame(page);
    const glb = await holdRequests(page, GLB_URL);
    await pressStart(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'loading');
    await setVisibility(page, 'hidden');
    glb.release();
    // The scene is built (the load went on) ...
    await expect(html(page)).toHaveAttribute('data-pp-level', 'salon_crawler');
    // ... and the app still waits, a bounded number of frames later.
    await waitFrames(page, FRAMES_TO_PROVE_STILL);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'loading');
    await expect(loadingScreen(page)).toBeVisible();

    await setVisibility(page, 'visible');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: LEVEL_TIMEOUT_MS,
    });
    expect(problems).toEqual([]);
  });
});

test.describe('a failed load', () => {
  test('5a. a cut network shows « Oups », logs a warning with the level id, and Réessayer reloads (touch)', async ({
    page,
  }) => {
    const warnings = collectLoadWarnings(page);
    const problems = collectProblems(page, { allowedErrors: FAILED_REQUEST });
    await failTheLoad(page);

    await expect(oopsPanel(page)).toBeVisible();
    await expect(oopsPanel(page)).toHaveAttribute('role', 'alertdialog');
    await expect(oopsPanel(page).locator('.pp-panel-title')).toHaveText(
      STRINGS['oops.message'] as string,
    );
    await expect(retryButton(page)).toBeFocused();
    await expect.poll(() => warnings.ids).toEqual(['salon_crawler']);
    expect(warnings.messages[0]).toContain('salon_crawler.glb');

    await page.unroute(GLB_URL);
    await retryButton(page).tap();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: LEVEL_TIMEOUT_MS,
    });
    await expect(oopsPanel(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('5b. Réessayer works with Enter too', async ({ page }) => {
    const problems = collectProblems(page, { allowedErrors: FAILED_REQUEST });
    await failTheLoad(page);
    await expect(retryButton(page)).toBeFocused();
    await page.unroute(GLB_URL);
    await page.keyboard.press('Enter');
    await expectRunning(page);
    expect(problems).toEqual([]);
  });

  test('5c. a 404 on the geometry is a failed load', async ({ page }) => {
    const warnings = collectLoadWarnings(page);
    const problems = collectProblems(page, { allowedErrors: FAILED_REQUEST });
    await page.route(GEOMETRY_URL, (route) => route.fulfill({ status: 404, body: 'nope' }));
    await openGame(page);
    await pressStart(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    await expect(retryButton(page)).toBeFocused();
    await expect.poll(() => warnings.messages.join(' ')).toContain('salon_crawler.geometry.json');
    await page.unroute(GEOMETRY_URL);
    await retryButton(page).click();
    await expectRunning(page);
    expect(problems).toEqual([]);
  });

  test('5d. an HTML page served as the glb (a SPA fallback) is a failed load', async ({ page }) => {
    const warnings = collectLoadWarnings(page);
    const problems = collectProblems(page, { allowedErrors: FAILED_REQUEST });
    await page.route(GLB_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>index</title>',
      }),
    );
    await openGame(page);
    await pressStart(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    await expect.poll(() => warnings.messages.join(' ')).toContain('not a glTF binary');
    await page.unroute(GLB_URL);
    await retryButton(page).click();
    await expectRunning(page);
    expect(problems).toEqual([]);
  });
});

test.describe('an uncaught exception', () => {
  test('6a. shows « Oups », and Réessayer restarts the level with a new seed', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    const logged = collectConsoleErrors(page);
    // `expect` polls at growing gaps (100, 250, 500, then 1000 ms): the app must stay in `level` for
    // longer than the longest gap, or a poll can fall between « loading » and « oops » and never see
    // `level` (it did on WebKit once the load took 350-550 ms).
    await page.goto(`/?throwAfterMs=${LEVEL_HOLD_BEFORE_THROW_MS}`);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
    await pressStart(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    const firstSeed = await html(page).getAttribute('data-pp-seed');

    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    expect(thrown).toEqual([expect.stringContaining('forced by ?throwAfterMs')]);
    // The global handler logged it as an error (AC 8), once.
    expect(logged.filter((text) => text.includes('uncaught error'))).toEqual([
      expect.stringContaining('forced by ?throwAfterMs'),
    ]);
    await expect(retryButton(page)).toBeFocused();

    await retryButton(page).click();
    await expectRunning(page);
    expect(await html(page).getAttribute('data-pp-seed')).not.toBe(firstSeed);
    // One throw per page load: the restarted level is not thrown at again.
    await waitFrames(page, FRAMES_TO_PROVE_STILL);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  });

  test('6b. a bad ?throwAfterMs is ignored', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto('/?throwAfterMs=abc');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
    await pressStart(page);
    await expectRunning(page);
    await waitFrames(page, FRAMES_TO_PROVE_STILL);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    expect(warnings.some((text) => text.includes('ignoring ?throwAfterMs=abc'))).toBe(true);
  });
});

test('7. « Recommencer » reloads behind the loading screen, with no scene left over, and logs no warning', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await startLevel(page);
  const drawCalls = await html(page).getAttribute('data-pp-draw-calls');
  const triangles = await html(page).getAttribute('data-pp-triangles');
  const geometries = await html(page).getAttribute('data-pp-geometries');
  const textures = await html(page).getAttribute('data-pp-textures');
  expect(Number(geometries)).toBeGreaterThan(0);
  await recordAppStates(page);

  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
  await pauseButton(page, STRINGS['pause.restart'] as string).click();
  await expectRunning(page);

  expect(await appHistory(page)).toEqual(['loading', 'level']);
  // The previous scene was disposed: the same room costs the same, not twice as much. The draw
  // calls only count the scene drawn last; the GPU memory is what shows a scene left behind.
  expect(await html(page).getAttribute('data-pp-draw-calls')).toBe(drawCalls);
  expect(await html(page).getAttribute('data-pp-triangles')).toBe(triangles);
  expect(await html(page).getAttribute('data-pp-geometries')).toBe(geometries);
  expect(await html(page).getAttribute('data-pp-textures')).toBe(textures);
  expect(problems).toEqual([]);
});

test('8. an exception while loading ends in « Oups » and the stale load does not start the level', async ({
  page,
}) => {
  await openGame(page);
  const glb = await holdRequests(page, GLB_URL);
  await pressStart(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'loading');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('x');
    });
  });
  await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');

  glb.release();
  await waitFrames(page, FRAMES_TO_PROVE_STILL);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
  await expect(html(page)).not.toHaveAttribute('data-pp-level', /.+/);
  await expect(oopsPanel(page)).toBeVisible();

  // And the retry that follows is not swallowed by the stale start's guard.
  await retryButton(page).click();
  await expectRunning(page);
});
