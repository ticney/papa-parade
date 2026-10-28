import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  html,
  liveFeedback,
  liveFeel,
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

const levelHasFatigue =
  (
    JSON.parse(readFileSync(`content/levels/${LEVEL}.json`, 'utf8')) as {
      gauges?: { fatigue?: unknown };
    }
  ).gauges?.fatigue !== undefined;

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
    const touch = (type: 'pointerdown' | 'pointerup', pointerId: number) =>
      page.evaluate(
        ([kind, id]) => {
          document.querySelector('canvas')?.dispatchEvent(
            new PointerEvent(kind as string, {
              pointerType: 'touch',
              pointerId: id as number,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        [type, pointerId] as const,
      );
    await touch('pointerdown', 11);
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
    // The numbers are real: a frame's work is less than a frame.
    const work = Number(/work (\d+\.\d) ms/.exec((await text.textContent()) ?? '')?.[1]);
    expect(work).toBeLessThan(10 * FRAME_MS_UPPER);
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
    // A press at the centre of the window, shifted by a known 20 ms, released at once.
    const shiftMs = 20;
    const pressAt = threat.windowOpenAt + threat.responseWindow.windowMs / 2 + shiftMs;
    await ppSend(page, { type: 'PressThreat', t: pressAt as never, threatId: threat.id });
    await ppSend(page, { type: 'Release', t: (pressAt + 50) as never });
    const now = (await ppWorld(page)).time.sim;
    await ppAdvance(page, Math.ceil((pressAt + 50 - now) / STEP_MS) + 2);

    const resolved = (await ppEvents(page)).find((event) => event.type === 'ResponseResolved');
    if (resolved?.type !== 'ResponseResolved') throw new Error('no ResponseResolved');
    expect(resolved.offsetMs).toBe(shiftMs);
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
    // Let the level run unanswered: threats time out one after another.
    for (let i = 0; i < 80; i++) await ppAdvance(page, 100);
    const rows = page.locator('.pp-debug-tl-row:not([hidden])');
    await expect(rows.first()).toHaveAttribute('data-quality', 'fail');
    await expect(rows.first().locator('.pp-debug-tl-label')).toHaveText(
      /^no press · fail \(late\)/,
    );
    await expect(rows.first().locator('.pp-debug-tl-marker')).toBeHidden();
    expect(await rows.count()).toBeLessThanOrEqual(10);
    expect(await page.locator('.pp-debug-tl-row').count()).toBe(10);
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

  test('sets the fatigue with a SetFatigue, in a level that has the gauge', async ({ page }) => {
    test.skip(!levelHasFatigue, 'the live level has no fatigue gauge');
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
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    const types = (await ppEvents(page)).map((event) => event.type);
    expect(types).toContain('LevelEnded');
    expect(types).toContain('LevelScored');
    expect((await ppWorld(page)).flow.state).toBe('ended');
    expect(problems).toEqual([]);
  });

  test('restarts with another seed', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="seed"]').fill('9');
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

  test('changing timing.windowMs sends a SetFeel: the world has it at the next step, the level goes on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await ppAdvance(page, 5);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'windowMs');
    const widenedMs = liveFeel.timing.windowMs + 120;
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

  test('marks the keys the sim reads at the next level, and has no « Enregistrer » outside dev only when built so', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const radius = await openFeelField(page, 'movement', 'papaRadiusM');
    await expect(radius).toContainText('⏭');
    const speed = await openFeelField(page, 'movement', 'walkSpeedMps');
    await expect(speed).not.toContainText('⏭');
    // The dev server has the writer: the button is there (the unit tests cover what it sends).
    await expect(section(page, 'feel').getByRole('button', { name: 'Enregistrer' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a restart keeps the tuned value, and the pane shows it', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    const field = await openFeelField(page, 'timing', 'hitstopMs');
    const hitstopMs = liveFeel.timing.hitstopMs + 11;
    const input = field.locator('input').first();
    await input.fill(String(hitstopMs));
    await input.press('Enter');
    await ppLoadLevel(page, LEVEL, SEED + 3);
    expect((await ppWorld(page)).feel.timing.hitstopMs).toBe(hitstopMs);
    const again = await openFeelField(page, 'timing', 'hitstopMs');
    await expect
      .poll(async () => Number(await again.locator('input').first().inputValue()))
      .toBe(hitstopMs);
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

  test('Enter and Space typed in a field do not skip the Result screen', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozenLevel(page);
    await page.keyboard.press('F1');
    await openSection(page, 'controls');
    await page.locator('[data-debug="skipToEnd"]').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
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
