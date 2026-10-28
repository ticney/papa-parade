import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { HUD_MAX_DOM_NODES, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  html,
  liveFeel,
  objectIconPoint,
  pagePointOf,
  WALK_BOUND_MS,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Fatigue, coffee and micro-sleeps (story 1.19) on the live level, driven by the test API on a
// frozen level: steps by hand, `SetFatigue` to get tired without waiting 140 s. Every bound comes
// from the live feel; nothing waits on a fixed delay. Chromium and WebKit both run it.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PILL = '[data-pp-zone="gauges"] > .pp-hud-gauges';
// The pill holds Bruit then Fatigue since story 3.1: the fatigue gauge is picked by its label, so a
// gauge added before or after it can never silently become the one these tests read.
const GAUGE = `${PILL} > .pp-hud-gauge[aria-label^="${STRINGS['gauge.fatigue']} "]`;
const FATIGUE_FEEL = (liveFeel as unknown as { fatigue: Record<string, number> }).fatigue;
const COFFEE_REDUCTION = FATIGUE_FEEL.coffeeReductionPoints as number;
const COFFEE_STEPS = Math.ceil((FATIGUE_FEEL.coffeeDurationMs as number) / STEP_MS);
const MICRO_SLEEP_MAX_MS = FATIGUE_FEEL.microSleepMaxMs as number;
const ASLEEP_MS = FATIGUE_FEEL.asleepMs as number;
/** Upper bound of what a micro-sleep needs to be judged once telegraphed: delay + window + tolerance, rounded up. */
const MICRO_SLEEP_JUDGE_MS = 2000;
/** A floor point of the live level in the test viewport (a tap on it plans a walk; the first test of this spec shows it). */
const FLOOR_TAP = { x: 300, y: 200 };
const CHUNK_STEPS = 25;
/** A marker is « near Papa » within this many px of his drawn head. */
const NEAR_PAPA_PX = 90;

async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Advances by chunks until `isDone` holds on the events; fails when `boundMs` of sim time passed. */
async function advanceUntilEvent(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (event: Awaited<ReturnType<typeof ppEvents>>[number]) => boolean,
) {
  const chunks = Math.ceil(boundMs / (CHUNK_STEPS * STEP_MS));
  for (let i = 0; i < chunks; i++) {
    const found = (await ppEvents(page)).find(isDone);
    if (found !== undefined) return found;
    await ppAdvance(page, CHUNK_STEPS);
  }
  const found = (await ppEvents(page)).find(isDone);
  if (found === undefined) throw new Error(`never happened within ${boundMs} ms: ${what}`);
  return found;
}

test.describe('the gauge pill', () => {
  test('shows the idle fatigue gauge at 0 %, after Bruit, the fill a scaleX under a ten-segment mask', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(PILL)).toHaveCount(1);
    await expect(page.locator(PILL)).toHaveAttribute('role', 'group');
    await expect(page.locator(PILL)).toHaveAttribute('aria-label', STRINGS['hud.gauges'] ?? '');
    // Bruit first, then Fatigue (UX-DR4): the noise gauge is pinned in `noise.spec.ts`.
    await expect(page.locator(`${PILL} > .pp-hud-gauge`)).toHaveCount(2);
    await expect(page.locator(`${PILL} > .pp-hud-gauge`).nth(1)).toHaveAttribute(
      'aria-label',
      `${STRINGS['gauge.fatigue']} 0 %`,
    );
    await expect(page.locator(GAUGE)).toHaveCount(1);
    await expect(page.locator(GAUGE)).toHaveAttribute(
      'aria-label',
      `${STRINGS['gauge.fatigue']} 0 %`,
    );
    await expect(page.locator(GAUGE)).toHaveClass(/pp-hud-gauge-idle/);
    const fill = page.locator(`${GAUGE} .pp-hud-gauge-fill`);
    const style = await fill.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        transform: computed.transform,
        transitionDuration: computed.transitionDuration,
        animationName: computed.animationName,
      };
    });
    expect(style.transform).toMatch(/^matrix\(/);
    expect(style.animationName).toBe('none');
    expect(Number.parseFloat(style.transitionDuration)).toBe(0);
    // The bar: 60 x 16 with its 2 px outline, 56 px inside, ten segments of 5.6 px.
    const bar = await page.locator(`${GAUGE} .pp-hud-gauge-bar`).boundingBox();
    expect(bar?.width).toBeCloseTo(60, 0);
    expect(bar?.height).toBeCloseTo(16, 0);
    expect(problems).toEqual([]);
  });

  test('goes warm and full from 70 %: the warn class, an opacity of 1 and an aria-label that says it', async ({
    page,
  }) => {
    await openFrozen(page);
    await ppSend(page, { type: 'SetFatigue', points: 80 });
    await ppAdvance(page, 3);
    await expect(page.locator(GAUGE)).toHaveClass(/pp-hud-gauge-warn/);
    await expect(page.locator(GAUGE)).toHaveCSS('opacity', '1');
    await expect(page.locator(GAUGE)).toHaveAttribute('aria-label', /^Fatigue 8\d %$/);
    // The fill scales with the value: ~80 % of the way.
    const matrix = await page
      .locator(`${GAUGE} .pp-hud-gauge-fill`)
      .evaluate((element) => getComputedStyle(element).transform);
    const scaleX = Number(/^matrix\(([-\d.e]+),/.exec(matrix)?.[1]);
    expect(scaleX).toBeGreaterThan(0.79);
    expect(scaleX).toBeLessThan(0.85);
  });

  test('keeps the HUD within its node budget', async ({ page }) => {
    await openFrozen(page);
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
  });
});

test.describe('the coffee machine icon', () => {
  const ICON = '.pp-object[data-pp-object="coffee_machine"]';

  test('shows where the machine is, on the point a tap on it aims at, and none for the phone', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppAdvance(page, 2);
    await expect(page.locator(ICON)).toHaveCount(1);
    await expect(page.locator('.pp-object')).toHaveCount(1);
    const point = await objectIconPoint(page, 'coffee_machine');
    const box = await page.locator(ICON).boundingBox();
    if (box === null) throw new Error('the icon has no box');
    expect(
      Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y),
    ).toBeLessThan(2);
    expect(problems).toEqual([]);
  });

  test('is calm at the start and turns warm once Papa is above the fatigue threshold', async ({
    page,
  }) => {
    await openFrozen(page);
    await ppAdvance(page, 2);
    await expect(page.locator(ICON)).not.toHaveClass(/pp-object-urgent/);
    await ppSend(page, {
      type: 'SetFatigue',
      points: (FATIGUE_FEEL.thresholdPoints as number) + 5,
    });
    await ppAdvance(page, 2);
    await expect(page.locator(ICON)).toHaveClass(/pp-object-urgent/);
  });
});

test.describe('the coffee', () => {
  test('a tap on the machine walks Papa there, he drinks for coffeeDurationMs, then fatigue drops', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppSend(page, { type: 'SetFatigue', points: 80 });
    await ppAdvance(page, 2);

    const point = await objectIconPoint(page, 'coffee_machine');
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 1);
    const events = await ppEvents(page);
    expect(events.map((event) => event.type)).toContain('ObjectTapped');

    const started = await advanceUntilEvent(
      page,
      'CoffeeStarted',
      WALK_BOUND_MS,
      (event) => event.type === 'CoffeeStarted',
    );
    if (started.type !== 'CoffeeStarted') throw new Error('unreachable');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'drink');

    // During the drink a tap on the floor plans no walk.
    const plansBefore = (await ppEvents(page)).filter(
      (event) => event.type === 'PapaPathPlanned',
    ).length;
    await page.touchscreen.tap(point.x + 120, point.y + 60);
    await ppAdvance(page, 5);
    const plansAfter = (await ppEvents(page)).filter(
      (event) => event.type === 'PapaPathPlanned',
    ).length;
    expect(plansAfter).toBe(plansBefore);

    // Up to the step before the end: still drinking; then one step: drunk, with the reduction.
    const untilSteps = Math.round((started.untilAt - (await ppWorld(page)).time.sim) / STEP_MS);
    expect(untilSteps).toBeLessThanOrEqual(COFFEE_STEPS);
    await ppAdvance(page, untilSteps - 1);
    const before = (await ppWorld(page)).gauges.fatigue;
    expect((await ppWorld(page)).papa.state).toBe('drink');
    await ppAdvance(page, 1);
    const drunk = (await ppEvents(page)).find((event) => event.type === 'CoffeeDrunk');
    if (drunk?.type !== 'CoffeeDrunk') throw new Error('no CoffeeDrunk');
    expect(drunk.t).toBe(started.untilAt);
    expect(drunk.fatigue).toBeCloseTo(before - COFFEE_REDUCTION, 6);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    await expect(html(page)).toHaveAttribute('data-pp-fatigue', String(Math.round(drunk.fatigue)));
    expect(problems).toEqual([]);
  });
});

test.describe('the micro-sleep', () => {
  test('is telegraphed on Papa, its marker follows him, and a tap on it parries without a glide', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppSend(page, { type: 'SetFatigue', points: 90 });
    const telegraphed = await advanceUntilEvent(
      page,
      'a micro-sleep telegraph',
      MICRO_SLEEP_MAX_MS + 2 * STEP_MS,
      (event) => event.type === 'ThreatTelegraphed' && event.kind === 'papa_microsleep',
    );
    if (telegraphed.type !== 'ThreatTelegraphed') throw new Error('unreachable');
    expect(telegraphed).toMatchObject({ waveIndex: -1, anchorId: 'papa' });

    // One frame later its marker is shown, with the closed-eye glyph, near Papa's drawn head.
    await ppAdvance(page, 1);
    const marker = page.locator('.pp-threat').filter({
      has: page.locator(`.pp-threat-icon path[d="${THREAT_ICON_PATHS.eyelids}"]`),
    });
    await expect(marker).toBeVisible();
    const world = await ppWorld(page);
    const head = await pagePointOf(page, world.papa.xM, 0.9, world.papa.zM);
    const box = await marker.boundingBox();
    if (box === null) throw new Error('the marker has no box');
    expect(
      Math.hypot(box.x + box.width / 2 - head.x, box.y + box.height / 2 - head.y),
    ).toBeLessThan(NEAR_PAPA_PX);

    // Step to the window (a few hundred ms wide) one step at a time, then tap the marker where it is.
    const instance = (await ppWorld(page)).threats.find(
      (threat) => threat.id === telegraphed.threatId,
    );
    if (instance === undefined) throw new Error('no micro-sleep instance');
    const stepsToOpen = Math.ceil(
      (instance.windowOpenAt - (await ppWorld(page)).time.sim) / STEP_MS,
    );
    await ppAdvance(page, stepsToOpen - 1);
    await ppAdvance(page, 1);
    expect(
      (await ppWorld(page)).threats.find((threat) => threat.id === telegraphed.threatId)?.state,
    ).toBe('windowOpen');
    const open = await marker.boundingBox();
    if (open === null) throw new Error('the marker has no box');
    const eventsBefore = (await ppEvents(page)).length;
    const papaBefore = (await ppWorld(page)).papa;
    await page.touchscreen.tap(open.x + open.width / 2, open.y + open.height / 2);
    await ppAdvance(page, 3);
    const after = (await ppEvents(page, eventsBefore)).map((event) => event.type);
    expect(after).not.toContain('PapaGlideStarted');
    expect(after).not.toContain('PapaPathPlanned');
    const papaAfter = (await ppWorld(page)).papa;
    expect([papaAfter.xM, papaAfter.zM]).toEqual([papaBefore.xM, papaBefore.zM]);
    expect(papaAfter.state).toBe('idle');
    const resolved = (await ppEvents(page, eventsBefore)).find(
      (event) => event.type === 'ResponseResolved',
    );
    expect(resolved).toMatchObject({ response: 'parry' });
    expect(['perfect', 'success']).toContain(
      resolved?.type === 'ResponseResolved' ? resolved.quality : '',
    );
    expect(problems).toEqual([]);
  });

  test('unanswered, it puts Papa to sleep for asleepMs: he answers no tap meanwhile, then wakes', async ({
    page,
  }) => {
    await openFrozen(page);
    // Control: the same tap, with Papa awake, plans a walk (so the pixel is a floor point).
    const planCount = async () =>
      (await ppEvents(page)).filter((event) => event.type === 'PapaPathPlanned').length;
    await page.touchscreen.tap(FLOOR_TAP.x, FLOOR_TAP.y);
    await ppAdvance(page, 5);
    expect(await planCount()).toBeGreaterThan(0);

    await ppSend(page, { type: 'SetFatigue', points: 90 });
    const fell = await advanceUntilEvent(
      page,
      'the nap',
      MICRO_SLEEP_MAX_MS + MICRO_SLEEP_JUDGE_MS,
      (event) => event.type === 'PapaStateChanged' && event.to === 'asleep',
    );
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'asleep');
    const events = (await ppEvents(page)).map((event) => event.type);
    expect(events).toContain('GagTriggered');
    expect(events).not.toContain('NearMiss');

    const plans = await planCount();
    await page.touchscreen.tap(FLOOR_TAP.x, FLOOR_TAP.y);
    await ppAdvance(page, 5);
    expect(await planCount()).toBe(plans);

    // Still asleep two steps before `asleepMs` is over, awake two steps after.
    const wakesAt = fell.t + ASLEEP_MS;
    let nowMs = (await ppWorld(page)).time.sim;
    await ppAdvance(page, Math.floor((wakesAt - 2 * STEP_MS - nowMs) / STEP_MS));
    expect((await ppWorld(page)).papa.state).toBe('asleep');
    nowMs = (await ppWorld(page)).time.sim;
    await ppAdvance(page, Math.ceil((wakesAt + 2 * STEP_MS - nowMs) / STEP_MS));
    expect((await ppWorld(page)).papa.state).toBe('idle');
  });
});
