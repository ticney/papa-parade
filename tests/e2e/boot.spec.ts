import { expect, type Page, test } from '@playwright/test';
import { MAX_PIXEL_RATIO } from '../../src/shared/constants.ts';

// `data-pp-state` is written by the composition root in dev and playtest builds only.
async function waitForGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-pp-state', 'running');
}

interface BackingStore {
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

function readBackingStore(page: Page): Promise<BackingStore> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#pp-canvas');
    if (canvas === null) throw new Error('no #pp-canvas');
    return {
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      width: canvas.width,
      height: canvas.height,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
}

function expectedBackingStore(state: BackingStore): Pick<BackingStore, 'width' | 'height'> {
  const ratio = Math.min(state.devicePixelRatio, MAX_PIXEL_RATIO);
  return {
    width: Math.round(state.cssWidth * ratio),
    height: Math.round(state.cssHeight * ratio),
  };
}

test('boots a full-screen canvas without console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto('/');

  const canvas = page.locator('#pp-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box).toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });
  expect(problems).toEqual([]);
});

test('draws with a live WebGL context', async ({ page }) => {
  await waitForGame(page);
  const context = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#pp-canvas');
    const gl = canvas?.getContext('webgl2') ?? null;
    return { exists: gl !== null, isLost: gl?.isContextLost() ?? null };
  });
  expect(context).toEqual({ exists: true, isLost: false });
});

test('sizes the backing store to the CSS size times min(devicePixelRatio, 2), through resizes', async ({
  page,
}) => {
  await waitForGame(page);
  const first = await readBackingStore(page);
  expect(first).toMatchObject(expectedBackingStore(first));

  const ratio = Math.min(first.devicePixelRatio, MAX_PIXEL_RATIO);
  for (const size of [
    { width: 700, height: 320 },
    { width: 390, height: 844 }, // portrait: the canvas still follows (the overlay is story 1.5)
    { width: 1024, height: 500 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() => readBackingStore(page))
      .toMatchObject({
        cssWidth: size.width,
        cssHeight: size.height,
        width: Math.round(size.width * ratio),
        height: Math.round(size.height * ratio),
      });
  }
});

test.describe('on a 3x screen', () => {
  test.use({ deviceScaleFactor: 3 });

  test('caps the pixel ratio at MAX_PIXEL_RATIO', async ({ page }) => {
    await waitForGame(page);
    const state = await readBackingStore(page);
    expect(state.devicePixelRatio).toBe(3);
    expect(state.width).toBe(state.cssWidth * MAX_PIXEL_RATIO);
    expect(state.height).toBe(state.cssHeight * MAX_PIXEL_RATIO);
  });
});
