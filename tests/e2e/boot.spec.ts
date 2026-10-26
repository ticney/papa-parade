import { expect, test } from '@playwright/test';

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
