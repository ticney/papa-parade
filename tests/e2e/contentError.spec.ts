import { expect, test } from '@playwright/test';

// Dev server only: the error screen is not part of any build. Vite serves each content file as a
// JS module (`/content/feel.json?import&raw`), so a broken file is a replaced module.
const FEEL_MODULE = /\/content\/feel\.json\?/;

test('shows a detailed error screen when a content file is invalid', async ({ page }) => {
  await page.route(FEEL_MODULE, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export default ${JSON.stringify('{ "timing": { "windowMs": "x" } }')};`,
    }),
  );

  await page.goto('/');

  const screen = page.locator('.pp-content-error');
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute('role', 'alert');
  await expect(screen).toContainText('content/feel.json');
  await expect(screen).toContainText('timing.windowMs');
});

test('shows no error screen with the real content', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto('/');

  await expect(page.locator('#pp-canvas')).toBeVisible();
  await expect(page.locator('.pp-content-error')).toHaveCount(0);
  expect(problems).toEqual([]);
});
