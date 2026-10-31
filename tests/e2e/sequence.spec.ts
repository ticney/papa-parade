import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  HUD_MAX_DOM_NODES,
  REDUCED_MOTION_ZOOM_CAP_PCT,
  STEP_MS,
} from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeedback,
  liveFeel,
  recordVibrations,
  startLevel,
  threatIconPoint,
  vibrations,
  waitForThreat,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// « Rester éveillé » and the special-sequence frame (story 4.4) on the live level, driven by the
// test API on a frozen level: steps by hand, every bound read from the live content (the sequence
// def, the feel, the feedback table), nothing waits on a fixed delay. Chromium and WebKit both run
// it; the vibrations are checked on Chromium only (WebKit has no `navigator.vibrate`).

const LEVEL = 'salon_crawler';
const SEED = 42;
const stayAwake = JSON.parse(readFileSync('content/sequences/stay_awake.json', 'utf8')) as {
  steps: { durationMs: number }[];
  framing: { camera: { zoomPct: number; focusPct: number; inMs: number; outMs: number } };
};
const levelSequences = (
  JSON.parse(readFileSync('content/levels/salon_crawler.json', 'utf8')) as { sequences: string[] }
).sequences;
const SEQUENCE_MS = stayAwake.steps.reduce((total, step) => total + step.durationMs, 0);
const { camera } = stayAwake.framing;
const feedback = liveFeedback as unknown as {
  sequenceBar: { slideMs: number };
  cues: Record<string, unknown>;
};
const { slideMs } = feedback.sequenceBar;
const noiseSnorePct = (
  liveFeel as unknown as { noise: { sources: { snore: { noisePct: number } } } }
).noise.sources.snore.noisePct;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const BAR = '.pp-hud-sequence-bar';
const TIMER = '[data-pp-zone="timer"] .pp-hud-timer';
const OVERLAY = '[data-debug-overlay]';

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up (WebKit resumes its context a moment after the start): a first tap must not be
  // the gesture that rescues it (story 4.3's review).
  await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
  await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
}

/** Starts the sequence through the debug overlay's « Start » (journaled, like any command). */
async function startFromOverlay(page: Page): Promise<void> {
  await page.keyboard.press('F1');
  await expect(page.locator(OVERLAY)).toHaveAttribute('data-debug-overlay', 'open');
  // The list is kept up to date while the overlay is open: the level's sequences are in it, in order,
  // and « Rester éveillé » (the first) is the one selected.
  await expect(page.locator('[data-debug="sequenceSelect"] option')).toHaveCount(
    levelSequences.length,
  );
  await expect(page.locator('[data-debug="sequenceSelect"]')).toHaveValue('stay_awake');
  await page.locator('[data-debug="startSequence"]').click();
  await page.keyboard.press('F1');
  await ppAdvance(page, 2);
}

/** Starts it by the test API: the bar, the camera and the music follow the state, not the way it started. */
async function start(page: Page): Promise<void> {
  await ppSend(page, { type: 'StartSequence', sequenceId: 'stay_awake' });
  await ppAdvance(page, 2);
}

/** Waits for the bar to have slid in: its CSS transition (real time, `slideMs`) has ended. */
async function settleBar(page: Page): Promise<void> {
  await expect(page.locator(BAR)).not.toHaveClass(/pp-hud-sequence-bar--out/);
  await expect
    .poll(() => page.locator(BAR).evaluate((element) => element.getAnimations().length))
    .toBe(0);
}

/** Advances in chunks until `isDone` holds on the world, failing past `boundMs` of sim time. */
async function advanceUntil(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
): Promise<void> {
  const chunk = 10;
  for (let i = 0; i <= boundMs / (chunk * STEP_MS) + 1; i++) {
    if (isDone(await ppWorld(page))) return;
    await ppAdvance(page, chunk);
  }
  throw new Error(`${what} did not happen within ${boundMs} ms`);
}

/** Nobody answers: the first micro-sleep ends in its gag, and the sequence with it. */
async function letItFail(page: Page): Promise<void> {
  await advanceUntil(
    page,
    'the end of the sequence',
    SEQUENCE_MS,
    (world) => world.flow.state !== 'sequence',
  );
}

test.describe('starting from the overlay', () => {
  test('the « Start » row starts the sequence: the flow, the mirrors, the baby in the arms and the cue', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startFromOverlay(page);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'sequence');
    await expect(html(page)).toHaveAttribute('data-pp-sequence', 'stay_awake');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    expect((await ppWorld(page)).flow.state).toBe('sequence');
    expect((await ppCueLog(page)).map((entry) => entry.cueId)).toContain('sequence_started');
    expect(problems).toEqual([]);
  });

  test('says why when it is refused: a second start while one runs', async ({ page }) => {
    await openFrozen(page);
    await startFromOverlay(page);
    await page.keyboard.press('F1');
    await page.locator('[data-debug="startSequence"]').click();
    await expect(page.locator(OVERLAY)).toContainText('a sequence is already running');
  });
});

test.describe('the HUD', () => {
  test('puts the bar under the timer, compacts the timer, makes the value fall and keeps the node budget', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const timerBefore = await page.locator(TIMER).boundingBox();
    expect(timerBefore?.height).toBe(40);
    await start(page);
    await ppAdvance(page, 5);
    await expect(page.locator(BAR)).toHaveCount(1);
    await settleBar(page);
    const bar = await page.locator(BAR).boundingBox();
    const timer = await page.locator(TIMER).boundingBox();
    expect(timer?.height).toBe(32);
    // Directly under the timer, and not touching it: the bar's top is below the timer's bottom.
    expect(bar?.y ?? 0).toBeGreaterThanOrEqual((timer?.y ?? 0) + (timer?.height ?? 0));
    const digitsSize = await page
      .locator(`${TIMER} .pp-hud-timer-digits`)
      .evaluate((element) => getComputedStyle(element).fontSize);
    const compactSize = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--pp-font-numeric-compact-size')
        .trim(),
    );
    expect(digitsSize).toBe(compactSize);
    // The value falls with the time left.
    const first = Number(await page.locator(BAR).getAttribute('aria-valuenow'));
    await ppAdvance(page, 600);
    await expect
      .poll(async () => Number(await page.locator(BAR).getAttribute('aria-valuenow')))
      .toBeLessThan(first);
    // The HUD's node budget with the bar up (UX-DR26): a count that goes over stops the story.
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    await expect(page.locator(BAR)).toHaveAttribute('role', 'progressbar');
    expect(problems).toEqual([]);
  });

  test('takes the bar away slideMs after the end, and gives the timer its 40 px back', async ({
    page,
  }) => {
    await openFrozen(page);
    await start(page);
    await ppAdvance(page, 5);
    await expect(page.locator(BAR)).toHaveCount(1);
    await letItFail(page);
    await ppAdvance(page, 1);
    await expect(page.locator(BAR)).toHaveCount(0, { timeout: slideMs + 2000 });
    await expect.poll(async () => (await page.locator(TIMER).boundingBox())?.height).toBe(40);
  });

  test('looks right at 667 × 375, beside the three gauges', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openFrozen(page);
    await start(page);
    await ppAdvance(page, 100);
    await expect(page.locator(BAR)).toHaveCount(1);
    await settleBar(page);
    const bar = await page.locator(BAR).boundingBox();
    const timer = await page.locator(TIMER).boundingBox();
    await page.screenshot({ path: test.info().outputPath('sequence-667x375.png') });
    const pill = await page.locator('.pp-hud-gauges').boundingBox();
    const pause = await page.locator('.pp-hud-row .pp-button').boundingBox();
    // Under the timer, and touching neither the gauges pill nor the pause button.
    expect(bar?.y ?? 0).toBeGreaterThanOrEqual((timer?.y ?? 0) + (timer?.height ?? 0));
    const overlaps = (
      a: { x: number; y: number; width: number; height: number } | null,
      b: { x: number; y: number; width: number; height: number } | null,
    ): boolean =>
      a !== null &&
      b !== null &&
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    expect(overlaps(bar, pill)).toBe(false);
    expect(overlaps(bar, pause)).toBe(false);
  });
});

test.describe('the framing and the music', () => {
  test('zooms on Papa during the sequence, and is back to exactly 1 after outMs', async ({
    page,
  }) => {
    await openFrozen(page);
    expect((await ppFx(page)).cameraZoom).toBe(1);
    await start(page);
    await ppAdvance(page, Math.ceil(camera.inMs / STEP_MS) + 5);
    expect((await ppFx(page)).cameraZoom).toBeGreaterThan(1);
    expect((await ppFx(page)).cameraZoom).toBeCloseTo(1 + camera.zoomPct / 100, 2);
    await letItFail(page);
    await ppAdvance(page, Math.ceil(camera.outMs / STEP_MS) + 5);
    await expect.poll(async () => (await ppFx(page)).cameraZoom).toBe(1);
  });

  test('caps the zoom under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFrozen(page);
    await start(page);
    await ppAdvance(page, Math.ceil(camera.inMs / STEP_MS) + 5);
    const zoom = (await ppFx(page)).cameraZoom;
    expect(zoom).toBeGreaterThan(1);
    expect(zoom).toBeCloseTo(1 + (camera.zoomPct / 100) * (REDUCED_MOTION_ZOOM_CAP_PCT / 100), 2);
  });

  test('swaps the level stems for the sequence music, and back at the end', async ({ page }) => {
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'off');
    await start(page);
    await ppAdvance(page, 5);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await letItFail(page);
    await ppAdvance(page, 5);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
  });
});

test.describe('Papa stands still', () => {
  test('a tap on the floor walks nowhere and draws no tap marker; a key and Space do nothing either', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const canvas = await page.locator('#pp-canvas').boundingBox();
    const tapAt = (dy: number) =>
      page.touchscreen.tap(
        (canvas?.x ?? 0) + 60,
        (canvas?.y ?? 0) + (canvas?.height ?? 0) / 2 + dy,
      );
    // Outside a sequence the same tap draws a marker: proof that the mirror works on this page, so
    // that its absence below means something.
    await tapAt(0);
    await expect(html(page)).toHaveAttribute('data-pp-tap', /^-?\d+\.\d+,-?\d+\.\d+$/);
    const marker = await html(page).getAttribute('data-pp-tap');
    await start(page);
    await ppAdvance(page, 5);
    const before = (await ppEvents(page)).length;
    const world = await ppWorld(page);
    await tapAt(40);
    await page.keyboard.down('KeyD');
    await page.keyboard.up('KeyD');
    await page.keyboard.press('Space');
    await ppAdvance(page, 10);
    const events = (await ppEvents(page, before)).map((event) => event.type);
    expect(events).not.toContain('PapaPathPlanned');
    expect(events).not.toContain('BabyPutDown');
    expect(await html(page).getAttribute('data-pp-tap')).toBe(marker);
    const after = await ppWorld(page);
    expect([after.papa.xM, after.papa.zM]).toEqual([world.papa.xM, world.papa.zM]);
    expect(after.baby.state).toBe('carried');
    expect(problems).toEqual([]);
  });
});

test.describe('a miss', () => {
  test.beforeEach(async ({ page }) => {
    await recordVibrations(page);
  });

  test('snores, wakes the baby, ends the sequence and adds the noise, with the baby still carried', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const before = (await ppEvents(page)).length;
    await letItFail(page);
    await ppAdvance(page, 2);
    const events = await ppEvents(page, before);
    const types = events.map((event) => event.type);
    expect(types).toContain('PapaSnored');
    expect(types).toContain('BabyWoke');
    const noise = events.filter(
      (event) => event.type === 'NoiseChanged' && event.source === 'snore',
    );
    expect(noise).toHaveLength(1);
    expect((noise[0] as { deltaPct: number }).deltaPct).toBeCloseTo(noiseSnorePct, 6);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    await expect(html(page)).not.toHaveAttribute('data-pp-sequence', /.+/);
    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    for (const cue of ['papa_snored', 'baby_woke', 'sequence_failed']) expect(cues).toContain(cue);
    expect((await ppWorld(page)).baby.state).toBe('carried');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'asleep');
    await advanceUntil(page, 'Papa waking', 5000, (world) => world.papa.state === 'idle');
    expect((await ppWorld(page)).papa.state).toBe('idle');
    if (hasVibrate()) {
      const patterns = await vibrations(page);
      for (const cue of ['papa_snored', 'baby_woke', 'sequence_failed']) {
        const pattern = hapticPatternOfCue(cue);
        expect(patterns).toContainEqual(pattern);
      }
    }
    expect(problems).toEqual([]);
  });
});

test.describe('a win', () => {
  test('a real tap on the micro-sleep icon parries it and the sequence goes on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await ppSend(page, { type: 'StartSequence', sequenceId: 'stay_awake' });
    await waitForThreat(page, 'windowOpen', SEQUENCE_MS);
    const at = await threatIconPoint(page);
    const before = (await ppEvents(page)).length;
    await page.touchscreen.tap(at.x, at.y);
    await expect
      .poll(async () => (await ppEvents(page, before)).map((event) => event.type))
      .toContain('ResponseResolved');
    const resolved = (await ppEvents(page, before)).find(
      (event) => event.type === 'ResponseResolved',
    );
    expect(resolved).toMatchObject({ quality: expect.stringMatching(/success|perfect/) });
    expect((await ppWorld(page)).flow.state).toBe('sequence');
    expect(problems).toEqual([]);
  });

  test('Space answers the micro-sleep, as a tap does, while Papa stands still', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await ppSend(page, { type: 'StartSequence', sequenceId: 'stay_awake' });
    await waitForThreat(page, 'windowOpen', SEQUENCE_MS);
    const before = (await ppEvents(page)).length;
    await page.keyboard.press('Space');
    await expect
      .poll(async () => (await ppEvents(page, before)).map((event) => event.type))
      .toContain('ResponseResolved');
    const resolved = (await ppEvents(page, before)).find(
      (event) => event.type === 'ResponseResolved',
    );
    expect(resolved).toMatchObject({ quality: expect.stringMatching(/success|perfect/) });
    expect((await ppWorld(page)).flow.state).toBe('sequence');
    expect(problems).toEqual([]);
  });

  test('survives a bot: ?autoplay=perfect wins it, and the director draws again after a put-down', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/?autoplay=perfect&seed=7&speed=4');
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 15_000 });
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: 15_000 });
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing', { timeout: 15_000 });
    await ppSend(page, { type: 'StartSequence', sequenceId: 'stay_awake' });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: (SEQUENCE_MS / 4) * 3,
    });
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    // The bot never puts the baby down (the cycle bot, 4.10): the player's tap does, and the
    // director comes back at the time the resume pushed it to.
    await ppSend(page, { type: 'TapBaby' });
    const before = (await ppEvents(page)).length;
    await expect
      .poll(
        async () =>
          (await ppEvents(page, before)).filter((event) => event.type === 'ThreatTelegraphed')
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

test.describe('a pause in the middle', () => {
  test('holds the bar, the camera and the timer, and the resume is exact', async ({ page }) => {
    await startLevel(page);
    await ppSend(page, { type: 'StartSequence', sequenceId: 'stay_awake' });
    await expect(page.locator(BAR)).toHaveCount(1);
    await expect.poll(async () => (await ppFx(page)).cameraZoom).toBeGreaterThan(1);
    await page.locator('.pp-hud-row .pp-button').click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const held = {
      sim: (await ppWorld(page)).time.sim,
      value: await page.locator(BAR).getAttribute('aria-valuenow'),
      zoom: (await ppFx(page)).cameraZoom,
      timer: await page.locator(`${TIMER} .pp-hud-timer-digits`).textContent(),
    };
    await waitFrames(page, 30);
    expect((await ppWorld(page)).time.sim).toBe(held.sim);
    expect(await page.locator(BAR).getAttribute('aria-valuenow')).toBe(held.value);
    expect((await ppFx(page)).cameraZoom).toBe(held.zoom);
    expect(await page.locator(`${TIMER} .pp-hud-timer-digits`).textContent()).toBe(held.timer);
  });
});
