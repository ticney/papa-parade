import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import { cspProblems } from '../../tools/deploy/checkDeployment.ts';
import { headersFor, parseHeaders } from '../../tools/serve/headers.ts';
import {
  audioState,
  collectProblems,
  html,
  LEVEL_DURATION_MS,
  LEVEL_REAL_TIME_FACTOR_MAX,
  OVERRUN_MARGIN_MS,
  openGame,
  startLevel,
  waitFrames,
} from '../e2e/support/game.ts';
import { ppEvents } from '../e2e/support/testApi.ts';

// The BUILT playtest bundle, served like the host serves it (`npm run e2e:dist`), or the deployed
// one (`PP_DIST_URL`). Story 1.24: it plays end to end, it breaks no CSP and calls no other origin,
// `?debug=1` shows the FPS counter, and without it there is no test API. Dev-mode behaviour is the
// job of `tests/e2e`; here only what a tester's browser gets.

const SPEED = 4;
/**
 * Chromium's own line when a pulse comes before any tap. An autoplay run has no gesture, and the
 * perfect bot lets the phone ring (noise past the 80 % alert, story 3.2's tuning), so the alert's
 * haptic is refused: `webHaptics` already treats that as a one-time `warn`, not a game error.
 */
const VIBRATE_WITHOUT_TAP = /Blocked call to navigator\.vibrate/;
/** Slack for a cold network start (the host, 4G): the level fetch, Rapier's wasm, the audio decode. */
const LOAD_MARGIN_MS = 30_000;

/** The CSP `public/_headers` promises for `/`: the host must send exactly it. */
function expectedCsp(): string {
  const rules = parseHeaders(readFileSync('public/_headers', 'utf8'));
  if (!rules.ok) throw new Error(rules.error);
  const csp = headersFor(rules.value, '/')['content-security-policy'];
  if (csp === undefined) throw new Error('public/_headers has no Content-Security-Policy');
  return csp;
}

test.describe('the built playtest bundle', () => {
  test('plays a level end to end, with no CSP violation and no other origin', async ({
    page,
    baseURL,
  }) => {
    const levelMs =
      (LEVEL_DURATION_MS / SPEED) * LEVEL_REAL_TIME_FACTOR_MAX +
      RESUME_COUNTDOWN_MS +
      OVERRUN_MARGIN_MS;
    test.setTimeout(levelMs + LOAD_MARGIN_MS + 30_000);
    const problems = collectProblems(page, { allowedErrors: VIBRATE_WITHOUT_TAP });
    // Records what the browser blocks: an empty list is the proof that the CSP lets the game run.
    await page.addInitScript(() => {
      const violations: string[] = [];
      (window as unknown as { ppCspViolations: string[] }).ppCspViolations = violations;
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(
          `${event.violatedDirective}: ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} "${event.sample}"`,
        );
      });
    });
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    const response = await page.goto(`/?autoplay=perfect&seed=1&speed=${SPEED}&debug=1`);
    // The host (or our server) sends the policy of `public/_headers`, and the type sniffing guard.
    // Same rule as `deploy:check`: the promised directives, a host may add its own.
    expect(
      cspProblems(expectedCsp(), response?.headers()['content-security-policy'] ?? null),
    ).toEqual([]);
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');

    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: levelMs + LOAD_MARGIN_MS,
    });
    expect((await ppEvents(page)).some((event) => event.type === 'LevelScored')).toBe(true);

    const violations = await page.evaluate(
      () => (window as unknown as { ppCspViolations: string[] }).ppCspViolations,
    );
    expect(violations).toEqual([]);
    const origin = new URL(baseURL ?? page.url()).origin;
    const foreign = requested.filter((url) => {
      const { protocol, origin: from } = new URL(url);
      // `data:` and `blob:` never leave the page: three.js decodes with them.
      return protocol !== 'data:' && protocol !== 'blob:' && from !== origin;
    });
    expect(foreign).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('?debug=1 shows the FPS counter once the level runs', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page, '?debug=1');
    const counter = page.locator('.pp-debug-perf');
    await expect(counter).toBeVisible();
    await waitFrames(page, 10);
    await expect(counter).toHaveText(/\d+ FPS/, { timeout: 10_000 });
    await expect(counter).toHaveText(/\d+(\.\d)? ms/);
    await expect(counter).toHaveText(/^[1-9]\d* FPS/, { timeout: 10_000 });
    expect(problems).toEqual([]);
  });

  test('without ?debug=1 there is no test API and no FPS counter', async ({ page }) => {
    const problems = collectProblems(page);
    await openGame(page);
    await waitFrames(page, 30);
    expect(await page.evaluate(() => window.__PP__)).toBeUndefined();
    await expect(page.locator('.pp-debug-perf')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a human start works with no test API: a tap on the start screen runs the level, audio on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    expect(await page.evaluate(() => window.__PP__)).toBeUndefined();
    expect(await audioState(page)).toBe('running');
    expect(problems).toEqual([]);
  });
});
