import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { DEBUG_TIMELINE_ROWS, RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  html,
  liveFeedback,
  liveFeel,
  OVERRUN_MARGIN_MS,
  shiftedFeelValue,
  stepToFirstTelegraph,
  threatIconPoint,
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

// The debug overlay (story 2.1): F1 / three fingers, the timing timeline, the cheats, the feel
// panel and the isolation of its fields from the game. The level is driven with the test API
// (frozen, `advance`), never with waits. Bounds come from the live content. No screenshot: the
// overlay is hidden at boot, which is what keeps the existing references as they are. The
// « Enregistrer » endpoint is unit tested, not hit here (it would rewrite the live feel.json).

const LEVEL = 'salon_crawler';
const SEED = 42;
const OVERLAY = '.pp-debug-overlay';
const FRAME_MS_UPPER = 20;
/** `skipToEnd` plays a whole level in chunks of steps, one per display frame: far more than the default 5 s on a loaded browser. */
const SKIP_TIMEOUT_MS = 60_000;

const levelHasFatigue =
  (
    JSON.parse(readFileSync(`content/levels/${LEVEL}.json`, 'utf8')) as {
      gauges?: { fatigue?: unknown };
    }
  ).gauges?.fatigue !== undefined;

/** The live room, read here and never copied: what the scene views must have built from. */
const liveRoom = JSON.parse(readFileSync(`content/levels/${LEVEL}.geometry.json`, 'utf8')) as {
  colliders: unknown[];
  zones: unknown[];
  anchors: unknown[];
  nav: { rows: string[] };
};
/** Vertices of a box drawn as edges: 12 edges of 2 points. */
const BOX_EDGE_VERTICES = 24;
/** Vertices of a walkable grid cell: 2 triangles. */
const CELL_VERTICES = 6;

/** Opens the app with the test API and starts the level frozen at sim time 0. */
async function openFrozenLevel(page: Page, seed = SEED): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, seed);
}

const section = (page: Page, id: string) => page.locator(`[data-debug-section="${id}"]`);

async function openSection(page: Page, id: string): Promise<void> {
  const details = section(page, id);
  if ((await details.getAttribute('open')) === null) await details.locator('> summary').click();
}

async function openFeelField(page: Page, folder: string, label: string) {
  await openSection(page, 'feel');
  const pane = section(page, 'feel');
  const title = pane.locator('.tp-fldv_t', { hasText: new RegExp(`^${folder}$`) }).first();
  const root = title.locator('xpath=ancestor::div[contains(@class,"tp-fldv")][1]');
  if ((await root.getAttribute('class'))?.includes('tp-fldv-expanded') !== true) {
    await title.click();
  }
  return root.locator('.tp-lblv', { hasText: new RegExp(`^${label}`) }).first();
}

test.describe('the debug overlay › opening', () => {
  test('is hidden at boot, and in the level', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await expect(page.locator(OVERLAY)).toBeHidden();
    // Not even in the DOM until it is first opened: nothing for the page's own audits to count.
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator('.pp-debug-button')).toHaveCount(0);
    await page.keyboard.press('F1');
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toHaveAttribute('data-debug-overlay', 'closed');
    expect(problems).toEqual([]);
  });

  test('F1 toggles it, and the close button hides it', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    // The browser's own F1 (help) is cancelled, whether the overlay opens, closes or ignores a repeat.
    const f1 = (repeat: boolean) =>
      page.evaluate((isRepeat) => {
        const event = new KeyboardEvent('keydown', {
          code: 'F1',
          repeat: isRepeat,
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }, repeat);
    expect(await f1(false)).toBe(true);
    await expect(page.locator(OVERLAY)).toBeVisible();
    // A held key repeats keydown: it must not flicker the overlay shut.
    expect(await f1(true)).toBe(true);
    await expect(page.locator(OVERLAY)).toBeVisible();
    expect(await f1(false)).toBe(true);
    await expect(page.locator(OVERLAY)).toBeHidden();
    // Toggling sent no command to the game: Papa has not moved, nothing is pressed.
    await ppAdvance(page, 2);
    const world = await ppWorld(page);
    expect(world.time.sim).toBe(2 * STEP_MS);
    expect(world.papa.state).toBe('idle');
    expect(world.threats.every((threat) => threat.press === null)).toBe(true);
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY)).toHaveAttribute('data-debug-overlay', 'open');
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeHidden();
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeVisible();
    await page.locator(`${OVERLAY} .pp-debug-header button`).click();
    await expect(page.locator(OVERLAY)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('three fingers down at once toggle it; two do not, and a lifted finger does not count', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    const touch = (type: 'pointerdown' | 'pointerup', pointerId: number, isPrimary = false) =>
      page.evaluate(
        ([kind, id, primary]) => {
          document.querySelector('canvas')?.dispatchEvent(
            new PointerEvent(kind as string, {
              pointerType: 'touch',
              pointerId: id as number,
              isPrimary: primary as boolean,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        [type, pointerId, isPrimary] as const,
      );
    await touch('pointerdown', 11, true);
    await touch('pointerdown', 12);
    await expect(page.locator(OVERLAY)).toBeHidden();
    await touch('pointerup', 12);
    await touch('pointerdown', 13);
    await expect(page.locator(OVERLAY)).toBeHidden();
    await touch('pointerdown', 14);
    await expect(page.locator(OVERLAY)).toBeVisible();
    // Everything is lifted, then three more: it toggles back.
    for (const id of [11, 13, 14]) await touch('pointerup', id);
    for (const id of [21, 22, 23]) await touch('pointerdown', id);
    await expect(page.locator(OVERLAY)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('a lost pointerup does not count: a new gesture starts the count again, and a fourth finger does not toggle', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    const touch = (id: number, isPrimary: boolean) =>
      page.evaluate(
        ([pointerId, primary]) => {
          document.querySelector('canvas')?.dispatchEvent(
            new PointerEvent('pointerdown', {
              pointerType: 'touch',
              pointerId: pointerId as number,
              isPrimary: primary as boolean,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        [id, isPrimary] as const,
      );
    // Two fingers whose pointerup never came ...
    await touch(31, true);
    await touch(32, false);
    // ... then a new gesture: its first finger is a primary one, the count starts at one.
    await touch(41, true);
    await touch(42, false);
    await expect(page.locator(OVERLAY)).toBeHidden();
    await touch(43, false);
    await expect(page.locator(OVERLAY)).toBeVisible();
    // A fourth finger and the same finger again are not a new « three at once ».
    await touch(44, false);
    await touch(43, false);
    await expect(page.locator(OVERLAY)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a mouse pointer never counts as a finger', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.evaluate(() => {
      for (const id of [1, 2, 3]) {
        document
          .querySelector('canvas')
          ?.dispatchEvent(
            new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: id, bubbles: true }),
          );
      }
    });
    await expect(page.locator(OVERLAY)).toBeHidden();
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › performance and views', () => {
  test('shows FPS, the loop timings, draw calls and triangles while open', async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await page.keyboard.press('F1');
    const text = section(page, 'perf').locator('.pp-debug-perf-panel');
    await expect(text).toContainText(/\d+ FPS/);
    await expect(text).toContainText(/work \d+\.\d ms = sim \d+\.\d+ ms \+ render \d+\.\d ms/);
    await expect(text).toContainText(/[1-9]\d* draw calls · [1-9]\d* triangles/);
    // The numbers are numbers (the budget of a frame is perf.spec.ts's, on a built level).
    const work = Number(/work (\d+\.\d) ms/.exec((await text.textContent()) ?? '')?.[1]);
    expect(Number.isFinite(work)).toBe(true);
    expect(problems).toEqual([]);
  });

  test('draws the views in the scene and on the page, off by default, and clears them with the level', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'views');
    const box = (view: string) => page.locator(`[data-debug-view="${view}"]`);
    for (const view of ['grid', 'path', 'colliders', 'anchors', 'zones', 'touchRadii']) {
      await expect(box(view)).not.toBeChecked();
    }
    const drawn = async (): Promise<string[]> =>
      ((await page.locator(OVERLAY).getAttribute('data-debug-views')) ?? '')
        .split(',')
        .filter((name) => name !== '')
        .sort();
    expect(await drawn()).toEqual([]);
    await box('colliders').check();
    await box('zones').check();
    await box('grid').check();
    await box('anchors').check();
    expect(await drawn()).toEqual(['anchors', 'colliders', 'grid', 'zones']);
    // What was built is what the room holds, not just « something »: vertices per view.
    const sizes = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        (((await page.locator(OVERLAY).getAttribute('data-debug-view-sizes')) ?? '') || 'none:0')
          .split(',')
          .map((entry) => entry.split(':') as [string, string])
          .map(([name, count]) => [name, Number(count)]),
      );
    const walkableCells = liveRoom.nav.rows.join('').split('1').length - 1;
    expect(walkableCells).toBeGreaterThan(0);
    expect(await sizes()).toEqual({
      anchors: liveRoom.anchors.length,
      colliders: liveRoom.colliders.length * BOX_EDGE_VERTICES,
      grid: walkableCells * CELL_VERTICES,
      zones: liveRoom.zones.length * BOX_EDGE_VERTICES,
    });
    await expect(page.locator('.pp-debug-radii')).toBeHidden();
    await box('touchRadii').check();
    await expect(page.locator('.pp-debug-radii')).toBeVisible();
    // One circle per planned threat, as wide as the live touch radius.
    const world = await ppWorld(page);
    await expect(page.locator('.pp-debug-radius')).toHaveCount(world.threats.length);
    const diameterPx = 2 * world.feel.input.touchRadiusPx;
    await expect(page.locator('.pp-debug-radius').first()).toHaveCSS('width', `${diameterPx}px`);
    // Papa's path is drawn while he walks one.
    await ppSend(page, { type: 'TapFloor', xM: 1, zM: 1 });
    await ppAdvance(page, 3);
    await box('path').check();
    expect(await drawn()).toContain('path');
    await box('colliders').uncheck();
    expect(await drawn()).not.toContain('colliders');
    // A new level starts with every view off again.
    await ppLoadLevel(page, LEVEL, SEED + 1);
    await expect(box('grid')).not.toBeChecked();
    await expect(box('touchRadii')).not.toBeChecked();
    await expect(page.locator('.pp-debug-radii')).toBeHidden();
    expect(await drawn()).toEqual([]);
    // Hiding the overlay takes the views off the scene and the page.
    await box('grid').check();
    await box('touchRadii').check();
    expect(await drawn()).toEqual(['grid']);
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(page.locator('.pp-debug-radii')).toBeHidden();
    await page.keyboard.press('F1');
    expect(await drawn()).toEqual(['grid']);
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › the timing timeline', () => {
  test('adds a row for a perfect parry with its offset, the newest on top', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const first = await stepToFirstTelegraph(page);
    const telegraphed = await ppWorld(page);
    const threat = telegraphed.threats.find((candidate) => candidate.id === first.threatId);
    if (threat === undefined || threat.responseWindow === null) throw new Error('no window');
    const stepsTo = (toMs: number): number => Math.ceil((toMs - telegraphed.time.sim) / STEP_MS);
    await ppAdvance(page, stepsTo(threat.windowOpenAt));
    // A press at the centre of the window, shifted by a known offset inside the live perfect zone
    // (a quarter of it: the zone is centred, so half of it is allowed on each side), released at once.
    const shiftMs = Math.max(1, Math.floor(liveFeel.timing.perfectMs / 4));
    const pressAt = threat.windowOpenAt + threat.responseWindow.windowMs / 2 + shiftMs;
    await ppSend(page, { type: 'PressThreat', t: pressAt as never, threatId: threat.id });
    await ppSend(page, { type: 'Release', t: (pressAt + 50) as never });
    const now = (await ppWorld(page)).time.sim;
    await ppAdvance(page, Math.ceil((pressAt + 50 - now) / STEP_MS) + 2);

    const resolved = (await ppEvents(page)).find((event) => event.type === 'ResponseResolved');
    if (resolved?.type !== 'ResponseResolved') throw new Error('no ResponseResolved');
    expect(resolved.offsetMs).toBe(shiftMs);
    expect(resolved.quality).toBe('perfect');
    const row = page.locator('.pp-debug-tl-row:not([hidden])').first();
    await expect(row).toHaveAttribute('data-quality', resolved.quality);
    await expect(row).toHaveAttribute('data-offset', `+${shiftMs} ms`);
    await expect(row.locator('.pp-debug-tl-label')).toHaveText(
      new RegExp(`^\\+${shiftMs} ms · ${resolved.quality}$`),
    );
    // The marker sits right of the window's centre, inside the axis.
    const marker = await row.locator('.pp-debug-tl-marker').evaluate((node) => node.style.left);
    const windowBar = await row.locator('.pp-debug-tl-window').evaluate((node) => ({
      left: node.style.left,
      width: node.style.width,
    }));
    const centrePct = Number.parseFloat(windowBar.left) + Number.parseFloat(windowBar.width) / 2;
    expect(Number.parseFloat(marker)).toBeGreaterThan(centrePct);
    expect(Number.parseFloat(marker)).toBeLessThanOrEqual(100);
    expect(problems).toEqual([]);
  });

  test('shows « no press » for a window nobody answered, and keeps ten rows', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await stepToFirstTelegraph(page);
    // Let the level run unanswered: threats time out one after another, past ten responses.
    const resolutions = async (): Promise<number> =>
      (await ppEvents(page)).filter((event) => event.type === 'ResponseResolved').length;
    let resolved = 0;
    for (let i = 0; i < 400 && resolved <= DEBUG_TIMELINE_ROWS; i++) {
      await ppAdvance(page, 100);
      resolved = await resolutions();
    }
    expect(resolved, 'the level resolves more responses than the timeline holds').toBeGreaterThan(
      DEBUG_TIMELINE_ROWS,
    );
    const rows = page.locator('.pp-debug-tl-row:not([hidden])');
    await expect(rows.first()).toHaveAttribute('data-quality', 'fail');
    await expect(rows.first().locator('.pp-debug-tl-label')).toHaveText(
      /^no press · fail \(late\)/,
    );
    await expect(rows.first().locator('.pp-debug-tl-marker')).toBeHidden();
    // Exactly the last ten are shown (not fewer, not more), in the ten rows built once.
    await expect(rows).toHaveCount(Math.min(resolved, DEBUG_TIMELINE_ROWS));
    await expect(page.locator('.pp-debug-tl-row')).toHaveCount(DEBUG_TIMELINE_ROWS);
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › time controls and cheats', () => {
  test('pauses, steps and resumes through the level session', async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const pause = page.locator('[data-debug="pause"]');
    await pause.click();
    await expect(pause).toHaveText('Resume');
    const frozenAt = (await ppWorld(page)).time.sim;
    await waitFrames(page, 10);
    expect((await ppWorld(page)).time.sim).toBe(frozenAt);
    await page.locator('[data-debug="step"]').click();
    expect((await ppWorld(page)).time.sim).toBe(frozenAt + STEP_MS);
    await pause.click();
    await expect(pause).toHaveText('Pause');
    await expect
      .poll(async () => (await ppWorld(page)).time.sim)
      .toBeGreaterThan(frozenAt + STEP_MS);
    expect(problems).toEqual([]);
  });

  test('closing the overlay puts the pause back as it was when it opened, not frozen by a Step', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="step"]').click();
    const frozenAt = (await ppWorld(page)).time.sim;
    await waitFrames(page, 10);
    expect((await ppWorld(page)).time.sim).toBe(frozenAt);
    // Shut: the level was running when the overlay opened, so it runs again.
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect.poll(async () => (await ppWorld(page)).time.sim).toBeGreaterThan(frozenAt);
    expect(problems).toEqual([]);
  });

  test('closing the overlay puts the timeScale back too, and a new level has the slider at its own scale', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const slider = page.locator('[data-debug="timeScale"]');
    await slider.evaluate((node: HTMLInputElement) => {
      node.value = '0.5';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).time.baseScale).toBe(0.5);
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toBeHidden();
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).time.baseScale).toBe(1);
    // A scale set again, then a new level: the slider shows the new sim's scale (1).
    await page.keyboard.press('F1');
    await slider.evaluate((node: HTMLInputElement) => {
      node.value = '0.3';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(slider).toHaveValue('0.3');
    await ppLoadLevel(page, LEVEL, SEED + 1);
    await expect(slider).toHaveValue('1');
    expect(problems).toEqual([]);
  });

  test('forces the timeScale with a SetTimeScale, and « 1 » puts it back', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const slider = page.locator('[data-debug="timeScale"]');
    await slider.evaluate((node: HTMLInputElement) => {
      node.value = '0.5';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).time.baseScale).toBe(0.5);
    await page.locator('[data-debug="timeScaleReset"]').click();
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).time.baseScale).toBe(1);
    expect(
      (await ppEvents(page)).filter((event) => event.type === 'TimeScaleChanged'),
    ).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test('launches a threat of the level with ForceThreat', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const select = page.locator('[data-debug="threatSelect"]');
    await expect(select.locator('option').first()).toBeAttached();
    const options = await select.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: Number((node as HTMLOptionElement).value),
        label: node.textContent,
      })),
    );
    expect(options.length).toBeGreaterThan(0);
    const picked = options[0] as { id: number; label: string };
    await select.selectOption(String(picked.id));
    await page.locator('[data-debug="launchThreat"]').click();
    await ppAdvance(page, 2);
    const forced = (await ppEvents(page)).find(
      (event) =>
        (event.type === 'ThreatTelegraphed' || event.type === 'ThreatHidden') &&
        event.threatId === picked.id,
    );
    expect(forced).toBeDefined();
    expect(forced?.t).toBeLessThanOrEqual(2 * STEP_MS);
    expect(problems).toEqual([]);
  });

  test('keeps the picked threat while the list follows the threats’ states', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const select = page.locator('[data-debug="threatSelect"]');
    const options = select.locator('option');
    await expect(options.first()).toBeAttached();
    const count = await options.count();
    expect(count, 'the live level plans at least two threats').toBeGreaterThan(1);
    const ids = await options.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    const picked = ids[1] as string;
    await select.selectOption(picked);
    // The first threat changes state: its option’s text follows, the pick stays on the second.
    await ppSend(page, { type: 'ForceThreat', threatId: Number(ids[0]) });
    await ppAdvance(page, 2);
    await expect(options.first()).toContainText('(telegraph)');
    await expect(select).toHaveValue(picked);
    await expect(options).toHaveCount(count);
    // « Launch » therefore fires the picked one.
    await page.locator('[data-debug="launchThreat"]').click();
    await ppAdvance(page, 2);
    const forced = (await ppEvents(page)).find(
      (event) =>
        (event.type === 'ThreatTelegraphed' || event.type === 'ThreatHidden') &&
        event.threatId === Number(picked),
    );
    expect(forced).toBeDefined();
    expect(problems).toEqual([]);
  });

  test('sets the fatigue with a SetFatigue, in a level that has the gauge', async ({ page }) => {
    // Not a skip: a level without the gauge would silently drop the check.
    expect(levelHasFatigue, `${LEVEL} must have a fatigue gauge for this check`).toBe(true);
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const row = page.locator('[data-cheat="setFatigue"]');
    await expect(row).toBeVisible();
    const target = 77;
    await row.locator('input').fill(String(target));
    await row.locator('button').click();
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).gauges.fatigue).toBeCloseTo(target, 0);
    // A blank field is refused, not read as 0; a value past the gauge is held at its maximum.
    const status = page.locator('[data-debug="status"]');
    await row.locator('input').fill('');
    await row.locator('button').click();
    await expect(status).toContainText('empty');
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).gauges.fatigue).toBeCloseTo(target, 0);
    await row.locator('input').fill('250');
    await row.locator('button').click();
    await expect(row.locator('input')).toHaveValue('100');
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).gauges.fatigue).toBeCloseTo(100, 0);
    expect(problems).toEqual([]);
  });

  test('skips to the end: the level is played through and scored, and the Result screen shows', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="skipToEnd"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: SKIP_TIMEOUT_MS,
    });
    const types = (await ppEvents(page)).map((event) => event.type);
    expect(types).toContain('LevelEnded');
    expect(types).toContain('LevelScored');
    expect((await ppWorld(page)).flow.state).toBe('ended');
    // The level is over: a cheat says so instead of reporting « sent ».
    const status = page.locator('[data-debug="status"]');
    await page.locator('[data-debug="timeScaleReset"]').click();
    await expect(status).toContainText('the level has ended');
    await page.locator('[data-debug="step"]').click();
    await expect(status).toContainText('Step: the level has ended');
    expect(problems).toEqual([]);
  });

  test('a skip leaves nothing frozen: the next level runs', async ({ page }) => {
    test.setTimeout(SKIP_TIMEOUT_MS + RESUME_COUNTDOWN_MS + 30_000);
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppLoadLevel(page, LEVEL, SEED);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="skipToEnd"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: SKIP_TIMEOUT_MS,
    });
    await page.locator('[data-debug="seed"]').fill('5');
    await page.locator('[data-debug="restartSeed"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-seed', '5');
    await expect
      .poll(async () => (await ppState(page))?.time.sim ?? 0, {
        timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS + 10_000,
      })
      .toBeGreaterThan(0);
    const sim = (await ppWorld(page)).time.sim;
    await expect.poll(async () => (await ppWorld(page)).time.sim).toBeGreaterThan(sim);
    expect(problems).toEqual([]);
  });

  test('a new level in the middle of a skip stops it: the new level is not fast-forwarded', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="skipToEnd"]').click();
    // Not the overlay's own restart button (which cancels the skip itself): a start from anywhere.
    await ppLoadLevel(page, LEVEL, 6);
    await expect(html(page)).toHaveAttribute('data-pp-seed', '6');
    // The new level is frozen (the wish was kept) at sim time 0, and nothing runs it on.
    await waitFrames(page, 20);
    const world = await ppWorld(page);
    expect(world.flow.state).toBe('playing');
    expect(world.time.sim).toBe(0);
    expect(problems).toEqual([]);
  });

  test('restarts with another seed', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const seed = page.locator('[data-debug="seed"]');
    const status = page.locator('[data-debug="status"]');
    // A blank field is not the seed 0, and a seed the generator cannot take is refused with a
    // message, not sent (it would send the app to its error screen).
    await seed.fill('');
    await page.locator('[data-debug="restartSeed"]').click();
    await expect(status).toContainText('empty');
    await seed.fill('4294967296');
    await page.locator('[data-debug="restartSeed"]').click();
    await expect(status).toContainText('whole number');
    await expect(html(page)).toHaveAttribute('data-pp-seed', String(SEED));
    await seed.fill('9');
    await page.locator('[data-debug="restartSeed"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-seed', '9');
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › the world inspector', () => {
  test('summarises the world and shows a slice as JSON when it is opened, without changing it', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppAdvance(page, 5);
    await page.keyboard.press('F1');
    await openSection(page, 'inspector');
    const summary = section(page, 'inspector').locator('.pp-debug-inspector-summary');
    await expect(summary).toContainText(`t ${5 * STEP_MS} ms`);
    await expect(summary).toContainText(/flow playing · papa idle · baby /);
    const slice = section(page, 'inspector')
      .locator('.pp-debug-slice', { hasText: 'papa' })
      .first();
    await slice.locator('> summary').click();
    const before = await ppWorld(page);
    await expect(slice.locator('pre')).toContainText('"state": "idle"');
    expect(await ppWorld(page)).toEqual(before);
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › the feel panel', () => {
  test('changing timing.windowMs sends a SetFeel: the world has it at the next step, the level goes on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppAdvance(page, 5);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'windowMs');
    const widenedMs = shiftedFeelValue(['timing', 'windowMs'], 120);
    const input = field.locator('input').first();
    await input.fill(String(widenedMs));
    await input.press('Enter');
    await expect(page.locator('.pp-debug-feel-status')).toContainText(
      `timing.windowMs = ${widenedMs}`,
    );
    // Queued, not applied yet; one step applies it. The clock was not restarted.
    expect((await ppWorld(page)).time.sim).toBe(5 * STEP_MS);
    await ppAdvance(page, 1);
    const after = await ppWorld(page);
    expect(after.feel.timing.windowMs).toBe(widenedMs);
    expect(after.time.sim).toBe(6 * STEP_MS);
    // Only that leaf moved.
    expect(after.feel.timing.perfectMs).toBe(liveFeel.timing.perfectMs);
    expect(problems).toEqual([]);
  });

  test('refuses a value the schema refuses, puts the field back and sends nothing', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'perfectMs');
    const input = field.locator('input').first();
    // A perfect zone wider than the window breaks `perfectMs <= windowMs`.
    await input.fill(String(liveFeel.timing.windowMs + 500));
    await input.press('Enter');
    await expect(page.locator('.pp-debug-feel-status')).toContainText('perfectMs');
    // Tweakpane shows two decimals (« 100.00 »): compare the number.
    await expect.poll(async () => Number(await input.inputValue())).toBe(liveFeel.timing.perfectMs);
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).feel.timing.perfectMs).toBe(liveFeel.timing.perfectMs);
    expect(problems).toEqual([]);
  });

  test('marks the keys the sim reads at the next level, and offers « Enregistrer » on the dev server', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const radius = await openFeelField(page, 'movement', 'papaRadiusM');
    await expect(radius).toContainText('⏭');
    const speed = await openFeelField(page, 'movement', 'walkSpeedMps');
    await expect(speed).not.toContainText('⏭');
    // The dev server has the writer: the button is there (the unit tests cover what it sends, and
    // the build checks keep it out of the store build).
    await expect(section(page, 'feel').getByRole('button', { name: 'Enregistrer' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a restart keeps the tuned value, and the pane shows it', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'hitstopMs');
    const hitstopMs = shiftedFeelValue(['timing', 'hitstopMs'], 11);
    const input = field.locator('input').first();
    await input.fill(String(hitstopMs));
    await input.press('Enter');
    await ppLoadLevel(page, LEVEL, SEED + 3);
    // The restart lays the tuned value over the feel on disk as a SetFeel at t = 0: one step applies it.
    await ppAdvance(page, 1);
    expect((await ppWorld(page)).feel.timing.hitstopMs).toBe(hitstopMs);
    const again = await openFeelField(page, 'timing', 'hitstopMs');
    await expect
      .poll(async () => Number(await again.locator('input').first().inputValue()))
      .toBe(hitstopMs);
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › the level’s feel overrides', () => {
  test('marks a key the level overrides with a star, and no other', async ({ page }) => {
    const problems = collectProblems(page);
    // The level file served with an override of the touch radius (Vite serves each content file
    // as a module in dev); the star must come from what the level declares.
    const level = JSON.parse(readFileSync(`content/levels/${LEVEL}.json`, 'utf8')) as Record<
      string,
      unknown
    >;
    const overridden = {
      ...level,
      feelOverrides: { input: { touchRadiusPx: liveFeel.input.touchRadiusPx + 10 } },
    };
    await page.route(new RegExp(`/content/levels/${LEVEL}\\.json\\?`), (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export default ${JSON.stringify(JSON.stringify(overridden))};`,
      }),
    );
    await openFrozenLevel(page);
    expect((await ppWorld(page)).feel.input.touchRadiusPx).toBe(liveFeel.input.touchRadiusPx + 10);
    await page.keyboard.press('F1');
    const starred = await openFeelField(page, 'input', 'touchRadiusPx');
    await expect(starred).toContainText('★');
    const plain = await openFeelField(page, 'input', 'contextReachM');
    await expect(plain).not.toContainText('★');
    expect(problems).toEqual([]);
  });
});

test.describe('the live feel reaches the client', () => {
  test('a SetFeel on input.touchRadiusPx changes the hit test on the next pointer event', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    const world = await ppWorld(page);
    const outlet = world.threats.find((threat) => threat.defId === 'outlet');
    if (outlet === undefined) throw new Error('the level does not plan the outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await ppAdvance(page, 1);
    // Up to the window of the outlet, one step at a time (a window is a few hundred ms wide).
    for (let i = 0; i < 400; i++) {
      const threat = (await ppWorld(page)).threats.find((candidate) => candidate.id === outlet.id);
      if (threat?.state === 'windowOpen') break;
      await ppAdvance(page, 5);
    }
    const state = (await ppWorld(page)).threats.find((candidate) => candidate.id === outlet.id);
    expect(state?.state).toBe('windowOpen');

    const point = await threatIconPoint(page);
    // A tap this far from the icon is inside the live radius (it is a fraction of it) ...
    const offsetPx = liveFeel.input.touchRadiusPx * 0.6;
    const tapAtOffset = async (): Promise<boolean> => {
      await page.mouse.move(point.x + offsetPx, point.y);
      await page.mouse.down();
      await ppAdvance(page, 2);
      const pressed =
        (await ppWorld(page)).threats.find((candidate) => candidate.id === outlet.id)?.press !==
        null;
      await page.mouse.up();
      await ppAdvance(page, 2);
      return pressed;
    };
    // ... and outside a radius cut to a few pixels, set while the level runs.
    await ppSetFeel(page, { input: { touchRadiusPx: 4 } });
    await ppAdvance(page, 1);
    expect(await tapAtOffset()).toBe(false);
    // Back to the live value: the same tap at the same spot now hits the threat.
    await ppSetFeel(page, { input: { touchRadiusPx: liveFeel.input.touchRadiusPx } });
    await ppAdvance(page, 1);
    expect(await tapAtOffset()).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe('the debug overlay › keeps its fields away from the game', () => {
  test('typing movement keys in a field never moves Papa, though the same keys outside it do', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const seed = page.locator('[data-debug="seed"]');
    await seed.focus();
    await page.keyboard.type('wasdzq');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await ppAdvance(page, 20);
    const idle = await ppWorld(page);
    expect(idle.papa.state).toBe('idle');

    // The control: the same key with the focus on the page moves him.
    await seed.blur();
    await page.keyboard.down('ArrowRight');
    await ppAdvance(page, 20);
    await page.keyboard.up('ArrowRight');
    const moved = await ppWorld(page);
    expect(moved.papa.xM).not.toBe(idle.papa.xM);
    expect(problems).toEqual([]);
  });

  test('typing in a Tweakpane number field of the feel pane never moves Papa nor changes the feel', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'windowMs');
    const before = await ppWorld(page);
    const input = field.locator('input').first();
    await input.focus();
    await expect(input).toBeFocused();
    // Movement keys, then Space, typed into the field (Up and Down are left out: Tweakpane steps its value with them).
    await page.keyboard.type('wasdzq');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await input.evaluate((node: HTMLInputElement) => node.blur());
    await ppAdvance(page, 20);
    const after = await ppWorld(page);
    expect(after.papa.state).toBe('idle');
    expect(after.papa.xM).toBe(before.papa.xM);
    expect(after.papa.zM).toBe(before.papa.zM);
    expect(after.feel).toEqual(before.feel);
    expect(problems).toEqual([]);
  });

  test('a key released over the panel still reaches the game: Papa does not keep walking', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    const start = await ppWorld(page);
    await page.keyboard.down('ArrowRight');
    await ppAdvance(page, 10);
    const walking = await ppWorld(page);
    expect(walking.papa.xM).not.toBe(start.papa.xM);
    // The focus moves into a field while the key is held, and the key is let go there.
    await page.locator('[data-debug="seed"]').focus();
    await page.keyboard.up('ArrowRight');
    await ppAdvance(page, 2);
    const stopped = await ppWorld(page);
    await ppAdvance(page, 30);
    const later = await ppWorld(page);
    expect(later.papa.xM).toBe(stopped.papa.xM);
    expect(problems).toEqual([]);
  });

  test('Enter and Space typed in a field do not skip the Result screen', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="skipToEnd"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: SKIP_TIMEOUT_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    // Past the screen's input grace, when a key would skip the sequence for real.
    await waitFrames(page, Math.ceil(liveFeedback.resultScreen.inputGraceMs / FRAME_MS_UPPER) + 10);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    const seed = page.locator('[data-debug="seed"]');
    await seed.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    // The control: the same key with the focus off the field does skip the sequence.
    await seed.blur();
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    expect(problems).toEqual([]);
  });
});
