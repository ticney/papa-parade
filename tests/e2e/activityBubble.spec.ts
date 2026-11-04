import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  recordVibrations,
  startLevel,
  threatIconPoint,
  vibrations,
  WALK_BOUND_MS,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  ppWorld,
} from './support/testApi.ts';

// The activity bubble above a busy Papa and the refused tap (story 2.12) on the live level: a frozen level
// driven by the test API (`TapObject`, `ForceThreat`, `ppAdvance`) for the ring, the end and the refusal, and a
// real pause on a running level. Every bound comes from the live feel and the world's own `enteredAt` /
// `busyUntil`, never from a literal. `ppAdvance` runs steps without a frame: a frame is awaited (`waitFrames`)
// before the DOM is read, and the drawn time trails the sim by one step in a frozen frame, as in story 2.11.

const LEVEL = 'salon_crawler';
const SEED = 42;
const OUTLET = 'outlet';
const COFFEE_MS = (liveFeel as unknown as { fatigue: { coffeeDurationMs: number } }).fatigue
  .coffeeDurationMs;
const BUBBLE = '.pp-activity-bubble';
const BODY = '.pp-activity-body';
const hasVibrate = (): boolean => test.info().project.name === 'chromium';
/** A point on the floor of the room, away from every marker and from the HUD (the floor test proves it with a control). */
const FLOOR_POINT = { x: 300, y: 200 };

/** How much of the ring is paper, in whole percent: the custom property the bubble writes. */
const progressOf = (page: Page): Promise<number> =>
  page
    .locator(BUBBLE)
    .evaluate((bubble) =>
      Number((bubble as HTMLElement).style.getPropertyValue('--pp-activity-progress')),
    );

/** Starts the game for real (audio unlocked), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await recordVibrations(page);
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Taps the coffee machine and steps, one step at a time, until Papa drinks. */
async function startCoffee(page: Page) {
  await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
  const stepsMax = Math.ceil(WALK_BOUND_MS / STEP_MS);
  for (let i = 0; i < stepsMax; i++) {
    await ppAdvance(page, 1);
    const { papa } = await ppWorld(page);
    if (papa.state === 'drink') return papa;
  }
  throw new Error('Papa never started the coffee');
}

/** The whole percent the ring shows when the world is at `simMs`: the drawn time trails the sim by one step. */
const expectedPct = (papa: { enteredAt: number; busyUntil: number }, simMs: number): number => {
  const drawnMs = simMs - STEP_MS;
  const permille = ((papa.busyUntil - drawnMs) / (papa.busyUntil - papa.enteredAt)) * 1000;
  return Math.floor(Math.min(1000, Math.max(0, permille)) / 10);
};

test.describe('the bubble during a coffee', () => {
  test('shows the cup, drains with the sim time to busyUntil, then pops out with a ding and a light vibration', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(BUBBLE)).toBeHidden();

    const papa = await startCoffee(page);
    await waitFrames(page, 3);
    expect(papa.busyUntil - papa.enteredAt).toBe(COFFEE_MS);
    const bubble = page.locator(BUBBLE);
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/pp-activity-bubble--cup/);
    // Full at the first drawn frame: the drawn time trails the step that made him drink.
    expect(await progressOf(page)).toBe(100);

    // After n more steps the ring shows what the sim time says, a step behind, never more than a percent off.
    for (const steps of [10, 20, 30]) {
      await ppAdvance(page, steps);
      await waitFrames(page, 3);
      const world = await ppWorld(page);
      const n = (world.time.sim - papa.enteredAt) / STEP_MS;
      const fromFeel = Math.floor(
        Math.min(1, Math.max(0, 1 - (n * STEP_MS - STEP_MS) / COFFEE_MS)) * 100,
      );
      const shown = await progressOf(page);
      expect(Math.abs(shown - fromFeel), `after ${n} steps`).toBeLessThanOrEqual(1);
      expect(Math.abs(shown - expectedPct(world.papa, world.time.sim))).toBeLessThanOrEqual(1);
    }
    const midway = await progressOf(page);
    expect(midway).toBeLessThan(100);
    expect(midway).toBeGreaterThan(0);

    // Still busy: no ding yet.
    expect((await ppCueLog(page)).filter((r) => r.cueId === 'papa_free')).toHaveLength(0);

    // At busyUntil: Papa is free, the bubble pops and goes, the ding plays once, with its light vibration.
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    const world = await ppWorld(page);
    // The step that frees Papa and the first frame after it, in one call: the bubble is still there, popping
    // out (a scale-and-fade running for its 160 ms), and only then does it go.
    const pop = await page.evaluate(
      async (steps) => {
        window.__PP__?.advance(steps);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const element = document.querySelector('.pp-activity-bubble');
        const animations = element?.getAnimations({ subtree: true }) ?? [];
        return {
          isShown: element !== null && getComputedStyle(element).display !== 'none',
          endOpacities: animations.map((animation) => {
            const frames = (animation.effect as KeyframeEffect).getKeyframes();
            return String(frames.at(-1)?.opacity);
          }),
        };
      },
      Math.ceil((papa.busyUntil - world.time.sim) / STEP_MS),
    );
    expect(pop.isShown).toBe(true);
    expect(pop.endOpacities).toContain('0');
    expect((await ppWorld(page)).papa.state).not.toBe('drink');
    await waitFrames(page, 3);
    await expect(bubble).toBeHidden();
    const dings = (await ppCueLog(page)).filter((r) => r.cueId === 'papa_free');
    expect(dings).toHaveLength(1);
    expect(dings[0]?.haptic).toBe('light');
    expect(dings[0]?.visuals).toEqual(['uiElement']);
    if (hasVibrate()) {
      const pattern = hapticPatternOfCue('papa_free');
      expect((await vibrations(page)).slice(vibrationsBefore)).toContainEqual(pattern);
    }
    expect(problems).toEqual([]);
  });
});

test.describe('a refused tap', () => {
  test('on a threat while Papa drinks: TapRefused, the « occupé » cue, a shaking bubble, no tap marker, no press', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startCoffee(page);

    // The outlet comes up during the coffee: its marker is a threat the player can tap, but Papa cannot answer.
    const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === OUTLET);
    if (outlet === undefined) throw new Error('the level does not plan the outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await ppAdvance(page, 1);
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toBeVisible();
    const point = await threatIconPoint(page);
    const eventsBefore = (await ppEvents(page)).length;

    // A real pointer click on the marker. The sim decides at its next step.
    await page.mouse.click(point.x, point.y);
    // The shake class is put on at the very step that refuses, and it lasts 150 ms of real time:
    // read it in the same call as the step.
    const probe = await page.evaluate(() => {
      window.__PP__?.advance(1);
      return {
        isShaking:
          document
            .querySelector('.pp-activity-body')
            ?.classList.contains('pp-activity-body--refused') ?? false,
        tapMarkers: document.querySelectorAll('.pp-tap-marker').length,
      };
    });
    expect(probe.isShaking).toBe(true);
    expect(probe.tapMarkers).toBe(0);

    const refused = (await ppEvents(page, eventsBefore)).filter((e) => e.type === 'TapRefused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ type: 'TapRefused', threatId: outlet.id });
    const cues = (await ppCueLog(page)).filter((r) => r.cueId === 'papa_busy_refused');
    expect(cues).toHaveLength(1);
    expect(cues[0]?.haptic).toBe('light');
    expect(cues[0]?.visuals).toEqual(['uiElement']);

    const after = await ppWorld(page);
    expect(after.threats.find((threat) => threat.id === outlet.id)?.press).toBeNull();
    expect(after.papa.state).toBe('drink');
    await expect(page.locator('.pp-tap-marker:visible')).toHaveCount(0);

    // The shake is a short class: it is gone a frame after its 150 ms.
    await expect(page.locator(BODY)).not.toHaveClass(/pp-activity-body--refused/);
    expect(problems).toEqual([]);
  });

  test('on the floor while Papa drinks: nothing is sent and the bubble does not shake', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // The control: with Papa free, this very point is a floor tap and plans a walk.
    const controlFrom = (await ppEvents(page)).length;
    await page.mouse.click(FLOOR_POINT.x, FLOOR_POINT.y);
    await ppAdvance(page, 2);
    expect((await ppEvents(page, controlFrom)).map((e) => e.type)).toContain('PapaPathPlanned');
    await startCoffee(page);
    await waitFrames(page, 2);
    const eventsBefore = (await ppEvents(page)).length;
    await page.mouse.click(FLOOR_POINT.x, FLOOR_POINT.y);
    await ppAdvance(page, 2);
    const events = await ppEvents(page, eventsBefore);
    expect(events.filter((e) => e.type === 'TapRefused' || e.type === 'PapaPathPlanned')).toEqual(
      [],
    );
    await expect(page.locator(BODY)).not.toHaveClass(/pp-activity-body--refused/);
    expect(problems).toEqual([]);
  });
});

test.describe('the game stops the ring', () => {
  test('a real pause on a running level leaves the ring where it was', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    // A long coffee, so that the pause lands well inside it whatever the machine's speed.
    await ppSetFeel(page, { fatigue: { coffeeDurationMs: 10 * COFFEE_MS } });
    await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'drink', {
      timeout: WALK_BOUND_MS,
    });
    await expect(page.locator(BUBBLE)).toBeVisible();
    // The ring has drained by the time of the pause (a ring frozen at 100 would prove nothing).
    await expect.poll(() => progressOf(page), { timeout: WALK_BOUND_MS }).toBeLessThan(100);
    await page.locator('.pp-hud-pause').click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await waitFrames(page, 3);
    const paused = await progressOf(page);
    expect(paused).toBeLessThan(100);
    expect(paused).toBeGreaterThan(0);
    await waitFrames(page, 20);
    expect(await progressOf(page)).toBe(paused);
    await expect(page.locator(BUBBLE)).toBeVisible();
    expect(problems).toEqual([]);
  });
});

// The layout above a busy Papa (AC 12): the bubble, a threat that follows him (the micro-sleep holds the centre)
// and the combo badge never overlap, on the compact and the regular surface. Measured on the real boxes, not on
// the constants the CSS is built from. A parried outlet raises the combo so that the badge shows, and the badge's
// text is then set to the widest the game writes (the highest multiplier).
const MAX_MULTIPLIER = (liveFeel as unknown as { combo: { maxMultiplier: number } }).combo
  .maxMultiplier;
const MICRO_SLEEP_MAX_MS = (liveFeel as unknown as { fatigue: { microSleepMaxMs: number } }).fatigue
  .microSleepMaxMs;
const SURFACES = [
  { name: 'compact', viewport: { width: 667, height: 375 } },
  { name: 'regular', viewport: { width: 1024, height: 768 } },
] as const;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The boxes of what stands above Papa, in page px; the threat's is its icon grown by the chrono-ring's reach. */
async function layoutOf(page: Page) {
  return page.evaluate((followingIconPath) => {
    const box = (element: Element | null): Box | null => {
      if (element === null) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const reachPx = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--pp-chrono-reach'),
    );
    // The threat that follows Papa: the micro-sleep's closed eye (other markers may be up elsewhere in the room).
    const icon = box(document.querySelector(`.pp-threat-icon:has(path[d="${followingIconPath}"])`));
    return {
      bubble: box(document.querySelector('.pp-activity-ring-outline')),
      badge: box(document.querySelector('.pp-combo-badge')),
      badgeDisplay: getComputedStyle(document.querySelector('.pp-combo-badge') as Element).display,
      threat:
        icon === null
          ? null
          : {
              left: icon.left - reachPx,
              right: icon.right + reachPx,
              top: icon.top - reachPx,
              bottom: icon.bottom + reachPx,
            },
      width: window.innerWidth,
    };
  }, THREAT_ICON_PATHS.eyelids);
}

/** A forced outlet, parried as soon as its window is open: the combo goes above its minimum, so the badge shows. */
async function parryTheOutlet(page: Page): Promise<void> {
  const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === OUTLET);
  if (outlet === undefined) throw new Error('the level does not plan the outlet');
  const stateOf = async () =>
    (await ppWorld(page)).threats.find((threat) => threat.id === outlet.id)?.state;
  const stepsMax = Math.ceil(WALK_BOUND_MS / STEP_MS);
  await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
  for (let i = 0; i < stepsMax && (await stateOf()) !== 'windowOpen'; i++) await ppAdvance(page, 1);
  await ppSend(page, { type: 'PressThreat', threatId: outlet.id });
  await ppAdvance(page, 5);
  await ppSend(page, { type: 'Release' });
  for (let i = 0; i < stepsMax && (await stateOf()) !== 'resolved'; i++) await ppAdvance(page, 1);
  await ppAdvance(page, 1);
  expect((await ppWorld(page)).combo.multiplier).toBeGreaterThan(1);
}

/** A window long enough to still be open when Papa has walked to the coffee machine and drinks. */
const LONG_WINDOW_MS = 10_000;

/**
 * Reloads the level at the viewport, raises the combo to x2 (the badge shows, with the widest text the game writes)
 * and puts Papa on a long coffee. With `hasMicroSleep`, the micro-sleep is telegraphed first and its window is long,
 * so that it is still up on Papa while he drinks (a micro-sleep is never telegraphed once he is busy).
 */
async function drinkWithBadge(page: Page, name: string, hasMicroSleep: boolean): Promise<void> {
  await ppLoadLevel(page, LEVEL, SEED);
  await ppFreeze(page, true);
  await ppSetFeel(page, { fatigue: { coffeeDurationMs: 10 * COFFEE_MS } });
  await parryTheOutlet(page);
  if (hasMicroSleep) {
    await ppSetFeel(page, { timing: { windowMs: LONG_WINDOW_MS } });
    await ppSend(page, { type: 'SetFatigue', points: 90 });
    const chunks = Math.ceil((MICRO_SLEEP_MAX_MS + 2 * STEP_MS) / (5 * STEP_MS));
    let isTelegraphed = false;
    for (let i = 0; i < chunks && !isTelegraphed; i++) {
      await ppAdvance(page, 5);
      isTelegraphed = (await ppEvents(page)).some(
        (e) => e.type === 'ThreatTelegraphed' && e.kind === 'papa_microsleep',
      );
    }
    expect(isTelegraphed, `${name}: the micro-sleep telegraphs`).toBe(true);
  }
  await startCoffee(page);
  await waitFrames(page, 3);
  const text = (STRINGS['combo.multiplier'] as string).replace('{count}', String(MAX_MULTIPLIER));
  await page.locator('.pp-combo-badge-text').evaluate((node, value) => {
    node.textContent = value;
  }, text);
  await waitFrames(page, 2);
}

test.describe('the layout above a busy Papa', () => {
  for (const { name, viewport } of SURFACES) {
    test(`on the ${name} surface: the badge sits beside the bubble, and a threat on Papa holds the centre between them`, async ({
      page,
    }, testInfo) => {
      // Two reloads of the level, a parry and a wait for the micro-sleep: longer than the default.
      test.setTimeout(90_000);
      const problems = collectProblems(page);
      await openFrozen(page);
      await page.setViewportSize(viewport);

      // The badge on the right of the bubble, nothing else above Papa.
      await drinkWithBadge(page, name, false);
      const beside = await layoutOf(page);
      if (beside.bubble === null || beside.badge === null)
        throw new Error(`${name}: no bubble or badge`);
      expect(beside.badgeDisplay, `${name}: the badge shows`).not.toBe('none');
      expect(beside.bubble.right, `${name}: bubble | badge`).toBeLessThanOrEqual(beside.badge.left);
      expect(beside.bubble.left, `${name}: bubble on screen`).toBeGreaterThanOrEqual(0);
      expect(beside.badge.right, `${name}: badge on screen`).toBeLessThanOrEqual(beside.width);
      await page.screenshot({ path: testInfo.outputPath(`${name}-beside.png`) });

      // The micro-sleep is up on Papa while he drinks: the bubble steps left, the threat keeps the centre, the
      // badge its right.
      await drinkWithBadge(page, name, true);
      expect((await ppWorld(page)).papa.state).toBe('drink');
      const aside = await layoutOf(page);
      await page.screenshot({ path: testInfo.outputPath(`${name}-aside.png`) });
      await testInfo.attach(`${name}-aside.json`, {
        body: JSON.stringify(aside, null, 1),
        contentType: 'application/json',
      });
      if (aside.bubble === null || aside.badge === null || aside.threat === null) {
        throw new Error(`${name}: no bubble, badge or threat`);
      }
      expect(aside.bubble.right, `${name}: bubble | threat`).toBeLessThanOrEqual(aside.threat.left);
      expect(aside.threat.right, `${name}: threat | badge`).toBeLessThanOrEqual(aside.badge.left);
      expect(aside.bubble.left, `${name}: bubble on screen`).toBeGreaterThanOrEqual(0);
      expect(aside.badge.right, `${name}: badge on screen`).toBeLessThanOrEqual(aside.width);
      expect(problems).toEqual([]);
    });
  }
});
