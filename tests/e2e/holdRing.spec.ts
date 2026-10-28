import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOf,
  html,
  liveFeel,
  liveThreat,
  recordVibrations,
  startLevel,
  telegraphDelayMsOf,
  threatIconPoint,
  vibrations,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The hold-ring (story 1.23) on the live level, driven by the test API on a frozen level. The live
// level has only Parry threats, so the outlet is forced with `ForceThreat` (as `silence.spec.ts`
// does) and held: the ring fills against the sim's pending press, closes when the sim says it was
// held `holdMinMs` (`ResponseHeld`), and the Parry threat then gags `wrongResponse`. The closed state
// is a class, never a pixel. Every bound comes from the live feel and the live outlet def; nothing
// waits on a fixed delay. Chromium and WebKit both run it (the vibration is checked on Chromium only).

const LEVEL = 'salon_crawler';
const SEED = 42;
const OUTLET = 'outlet';
const { holdMinMs } = liveFeel.input;
const HOLD_STEPS = Math.ceil(holdMinMs / STEP_MS);
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

/** The outlet served as a Firmness held from the opening of its window to well past `holdMinMs`. */
const FIRM_HOLD_UNTIL_MS =
  (liveThreat(OUTLET).windowMs ?? liveFeel.timing.windowMs) + holdMinMs * 2;

const ring = (page: Page) => page.locator('.pp-threat-hold');

/** Starts the game for real (audio unlocked), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await recordVibrations(page);
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/**
 * Serves `content/threats/outlet.json` as a Firmness (Vite serves each content file as a module in
 * dev): same def, `response: "firm"` and a `holdUntilMs`. Call it before the page is opened.
 */
async function serveOutletAsFirm(page: Page): Promise<void> {
  const outlet = JSON.parse(readFileSync('content/threats/outlet.json', 'utf8')) as Record<
    string,
    unknown
  >;
  const firm = JSON.stringify({ ...outlet, response: 'firm', holdUntilMs: FIRM_HOLD_UNTIL_MS });
  await page.route(/\/content\/threats\/outlet\.json\?/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export default ${JSON.stringify(firm)};`,
    }),
  );
}

/**
 * Opens the app on a frozen level with no start gesture: the game is silent, as an agent's run is.
 * The keyboard test uses it, because a key press on a started WebKit session makes the audio engine
 * warn that the context is still suspended (not what this spec is about).
 */
async function openFrozenSilent(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Forces the outlet and steps to the instant its window opens; returns its id. */
async function outletInWindow(page: Page): Promise<number> {
  const world = await ppWorld(page);
  const outlet = world.threats.find((threat) => threat.defId === OUTLET);
  if (outlet === undefined) throw new Error('the level does not plan the outlet');
  await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
  await ppAdvance(page, 1);
  // The telegraph delay, then single steps up to the window: a window is a few hundred ms wide.
  await ppAdvance(page, Math.floor(telegraphDelayMsOf(liveThreat(OUTLET)) / STEP_MS) - 1);
  for (let i = 0; i < 20; i++) {
    const threat = (await ppWorld(page)).threats.find((candidate) => candidate.id === outlet.id);
    if (threat?.state === 'windowOpen') return outlet.id;
    await ppAdvance(page, 1);
  }
  throw new Error('the outlet window never opened');
}

/** The `--pp-hold-progress` the ring is drawn with, in whole percent. */
const progressOf = (page: Page): Promise<number> =>
  ring(page).evaluate((element) =>
    Number(element.style.getPropertyValue('--pp-hold-progress') || Number.NaN),
  );

const eventTypes = async (page: Page, from: number): Promise<string[]> =>
  (await ppEvents(page, from)).map((event) => event.type);

test.describe('the hold-ring', () => {
  test('a short tap shows the ring, which never closes, and is a Parry', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await outletInWindow(page);
    await expect(ring(page)).toBeHidden();
    const eventsBefore = (await ppEvents(page)).length;

    const point = await threatIconPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await ppAdvance(page, 2);
    await waitFrames(page, 2);
    await expect(ring(page)).toBeVisible();
    await expect(ring(page)).not.toHaveClass(/pp-threat-hold--closed/);
    await page.mouse.up();
    await ppAdvance(page, HOLD_STEPS + 2);
    await waitFrames(page, 2);

    const types = await eventTypes(page, eventsBefore);
    expect(types).not.toContain('ResponseHeld');
    expect(await ppEvents(page, eventsBefore)).toContainEqual(
      expect.objectContaining({
        type: 'ResponseResolved',
        response: 'parry',
        quality: expect.stringMatching(/^(perfect|success)$/),
      }),
    );
    await expect(ring(page)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('a hold on a Parry threat fills the ring; ResponseHeld then comes just before the wrongResponse gag, with the medium haptic', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const threatId = await outletInWindow(page);
    const eventsBefore = (await ppEvents(page)).length;
    const hapticsBefore = hasVibrate() ? (await vibrations(page)).length : 0;

    const point = await threatIconPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await ppAdvance(page, 1);
    await waitFrames(page, 2);
    await expect(ring(page)).toBeVisible();
    const early = await progressOf(page);
    expect(early).toBeLessThan(100);

    // Half way: the ring has filled further, and is still open.
    await ppAdvance(page, Math.floor(HOLD_STEPS / 2));
    await waitFrames(page, 2);
    const half = await progressOf(page);
    expect(half).toBeGreaterThan(early);
    expect(half).toBeLessThan(100);
    await expect(ring(page)).not.toHaveClass(/pp-threat-hold--closed/);
    expect(await eventTypes(page, eventsBefore)).not.toContain('ResponseHeld');

    // Past holdMinMs: the sim says it was held, and a Parry threat gags in that same step (so its
    // ring never shows closed: the Firmness test below proves the closed state).
    await ppAdvance(page, HOLD_STEPS);
    const events = await ppEvents(page, eventsBefore);
    const types = events.map((event) => event.type);
    expect(types).toContain('ResponseHeld');
    expect(events).toContainEqual(expect.objectContaining({ type: 'ResponseHeld', threatId }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'ResponseResolved',
        threatId,
        quality: 'fail',
        reason: 'wrongResponse',
      }),
    );
    expect(types.indexOf('ResponseHeld')).toBeLessThan(types.indexOf('ResponseResolved'));
    await page.mouse.up();

    if (hasVibrate()) {
      const pattern = hapticPatternOf('ResponseHeld');
      expect(pattern).not.toBeNull();
      expect((await vibrations(page)).slice(hapticsBefore)).toContainEqual(pattern);
    }
    expect(problems).toEqual([]);
  });

  test('on a Firmness the ring closes solid when the sim says the press was held, stays closed to the end of the attack, and the threat resolves', async ({
    page,
  }) => {
    // The live level has no Firmness: the outlet is served as one (the same def, `response: firm`).
    await serveOutletAsFirm(page);
    const problems = collectProblems(page);
    await openFrozen(page);
    const threatId = await outletInWindow(page);
    const eventsBefore = (await ppEvents(page)).length;
    const point = await threatIconPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();

    // Step by step up to the step that closes the ring: it is the sim's `heldAt`, not the pointer's
    // clock. The press is stamped from a real timestamp, which the frozen clock may put a little
    // ahead of the sim, hence the margin on top of `holdMinMs`.
    let heldFor: number | null = null;
    for (let i = 0; i < HOLD_STEPS * 2 && heldFor === null; i++) {
      await ppAdvance(page, 1);
      await waitFrames(page, 1);
      const press = (await ppWorld(page)).threats.find((threat) => threat.id === threatId)?.press;
      if (press?.heldAt !== null && press?.heldAt !== undefined) {
        heldFor = press.heldAt - press.t;
        await waitFrames(page, 2);
        await expect(ring(page)).toHaveClass(/pp-threat-hold--closed/);
        expect(await progressOf(page)).toBe(100);
      } else {
        // Open until then: the class never comes before the sim says so.
        await expect(ring(page)).not.toHaveClass(/pp-threat-hold--closed/);
      }
    }
    expect(heldFor).not.toBeNull();
    expect(heldFor).toBeGreaterThanOrEqual(holdMinMs);

    // Still held, the threat is not resolved yet, and the ring stays closed.
    const stillOpen = await ppEvents(page, eventsBefore);
    expect(stillOpen.map((event) => event.type)).not.toContain('ResponseResolved');
    await expect(ring(page)).toHaveClass(/pp-threat-hold--closed/);

    // To the end of the attack: the hold alone resolves it, a Firmness.
    await ppAdvance(page, Math.ceil(FIRM_HOLD_UNTIL_MS / STEP_MS));
    await waitFrames(page, 2);
    const events = await ppEvents(page, eventsBefore);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'ResponseResolved',
        threatId,
        response: 'firm',
        quality: expect.stringMatching(/^(perfect|success)$/),
      }),
    );
    expect(events.map((event) => event.type)).not.toContain('GagTriggered');
    await expect(ring(page)).toBeHidden();
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('Space held on the auto-targeted threat closes the ring too', async ({ page }) => {
    // The live level has no Firmness: the outlet is served as one, so the ring can close and stay.
    await serveOutletAsFirm(page);
    const problems = collectProblems(page);
    await openFrozenSilent(page);
    const threatId = await outletInWindow(page);
    // The hand is on the keyboard: the game now auto-targets the outlet.
    await page.keyboard.down('KeyD');
    await page.keyboard.up('KeyD');
    await expect(html(page)).toHaveAttribute('data-pp-target', String(threatId));

    await page.keyboard.down('Space');
    await expect(html(page)).toHaveAttribute('data-pp-press', String(threatId));
    await ppAdvance(page, 2);
    await waitFrames(page, 2);
    await expect(ring(page)).toBeVisible();
    await expect(ring(page)).not.toHaveClass(/pp-threat-hold--closed/);

    const eventsBefore = (await ppEvents(page)).length;
    // Up to the step the sim says the press was held `holdMinMs`, then the ring is closed.
    let heldFor: number | null = null;
    for (let i = 0; i < HOLD_STEPS * 2 && heldFor === null; i++) {
      await ppAdvance(page, 1);
      await waitFrames(page, 1);
      const press = (await ppWorld(page)).threats.find((threat) => threat.id === threatId)?.press;
      if (press?.heldAt !== null && press?.heldAt !== undefined) heldFor = press.heldAt - press.t;
    }
    expect(heldFor).not.toBeNull();
    expect(heldFor).toBeGreaterThanOrEqual(holdMinMs);
    await waitFrames(page, 2);
    expect(await eventTypes(page, eventsBefore)).toContain('ResponseHeld');
    await expect(ring(page)).toHaveClass(/pp-threat-hold--closed/);
    expect(await progressOf(page)).toBe(100);
    await page.keyboard.up('Space');
    expect(problems).toEqual([]);
  });
});
