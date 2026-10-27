import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../../src/shared/constants.ts';

/** Slack on top of a countdown, for a loaded CI machine: it only catches a countdown that never ends. */
export const OVERRUN_MARGIN_MS = 2000;

export function html(page: Page): Locator {
  return page.locator('html');
}

/**
 * Opens the app and waits until it shows the start screen. `data-pp-app` and `data-pp-state` are
 * written by the composition root in dev and playtest builds only, once everything is up.
 */
export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
}

/** Opens the app, presses the start screen and waits for the level to be running (countdown included). */
export async function startLevel(page: Page): Promise<void> {
  await openGame(page);
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
}

/** Waits for `count` display frames inside the page: a bounded count, never a timeout. */
export function waitFrames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const onFrame = (): void => {
          remaining--;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      }),
    count,
  );
}

/** Headless browsers do not hide pages on demand: override the property and fire the event. */
export function setVisibility(page: Page, visibilityState: 'hidden' | 'visible'): Promise<void> {
  return page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibilityState);
}

/**
 * A screenshot of the canvas alone: the DOM layers (HUD, panels, countdown) are hidden while it is
 * taken, so "nothing moved" means the scene, not an animation of the interface.
 */
export function sceneShot(page: Page): Promise<Buffer> {
  return page.locator('#pp-canvas').screenshot({
    style: '#pp-hud, #pp-ui { visibility: hidden !important }',
    animations: 'disabled',
  });
}

export const pauseButton = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: label, exact: true });

/** Waits for every finite animation (a panel pop-in) to end, so boxes are measured at rest. */
export function settleAnimations(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        // A cancelled animation (a hidden digit) rejects `finished`: that is not a failure here.
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The warnings the app raises about its own bugs; the dev server's other warnings are not ours. */
const OWN_WARNINGS =
  /missing string key|no "[a-z]+" screen to show|cannot load \d+ font|setPointerCapture failed/;

/**
 * Collects what must fail a session: console errors, page errors, and the app's own warnings about
 * a missing string, a screen it could not build, a font that failed, a lost pointer capture.
 */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    else if (message.type() === 'warning' && OWN_WARNINGS.test(message.text())) {
      problems.push(`warning: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Requests for the level's `.glb` (served from `public/` by the dev server). */
export const GLB_URL = '**/assets/levels/*.glb';

/** Requests for the level's geometry (a Vite module in dev: `…/salon_crawler.geometry.json?…`). */
export const GEOMETRY_URL = /salon_crawler\.geometry\.json/;

export interface RequestGate {
  /** Lets every request held so far, and later ones, through. */
  release(): void;
}

/**
 * Holds the responses to requests matching `pattern` until `release()`, with a promise rather than a
 * timeout: a test decides when the network "arrives".
 */
export async function holdRequests(page: Page, pattern: string | RegExp): Promise<RequestGate> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

/** How many distinct colours a PNG holds: 1 for a flat image, a handful for a lit room. */
export function distinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colours.add(
        ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number),
      );
    }
    return colours.size;
  }, png.toString('base64'));
}

/** The level-load warnings the app logged (`level load failed`, with the level id in its data). */
export function collectLoadWarnings(page: Page): { ids: string[]; messages: string[] } {
  const found = { ids: [] as string[], messages: [] as string[] };
  page.on('console', (message) => {
    if (message.type() !== 'warning' || !message.text().includes('level load failed')) return;
    const data = message.args()[1];
    void data
      ?.evaluate((value: { id: string; error: { message: string } }) => ({
        id: value.id,
        message: value.error.message,
      }))
      .then(({ id, message: text }) => {
        found.ids.push(id);
        found.messages.push(text);
      });
  });
  return found;
}

/** `data-pp-app` values in the order they were written, from now on. Read them with `appHistory`. */
export function recordAppStates(page: Page): Promise<void> {
  return page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __ppAppHistory: string[] }).__ppAppHistory = seen;
    new MutationObserver(() => {
      seen.push(document.documentElement.dataset.ppApp ?? '');
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pp-app'] });
  });
}

export function appHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...(window as unknown as { __ppAppHistory: string[] }).__ppAppHistory,
  ]);
}
