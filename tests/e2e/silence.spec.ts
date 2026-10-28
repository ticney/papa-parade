import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  liveSilence,
  pagePointOf,
  recordVibrations,
  startLevel,
  telegraphDelayMsOf,
  vibrations,
  WALK_BOUND_MS,
} from './support/game.ts';
import { ppAdvance, ppEvents, ppFreeze, ppLoadLevel, ppSend, ppWorld } from './support/testApi.ts';

// The suspicious silence (story 1.21) on the live level, driven by the test API on a frozen level:
// `ForceThreat` hides the silence now (no waiting for wave 2), steps by hand. Every bound comes from
// the live `content/threats/silence_mischief.json` and `feel.json`; nothing waits on a fixed delay.
// Chromium and WebKit both run it (the vibration is checked on Chromium only).

const LEVEL = 'salon_crawler';
const SEED = 42;
const CHUNK_STEPS = 25;
const SILENCE_CUE = 'silence_started';
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

/** The crawl to the zone, the quiet that follows, with a margin for the path's detours. */
const CRAWL_BOUND_MS =
  WALK_BOUND_MS * Math.max(1, liveFeel.movement.walkSpeedMps / liveFeel.baby.sneakSpeedMps);
const SILENCE_START_BOUND_MS = CRAWL_BOUND_MS + liveFeel.baby.silenceAlertMs;
const FIND_STEPS = Math.ceil(liveSilence.findMaxMs / STEP_MS);

/** Starts the game for real (audio unlocked, loops playing), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** The instance of the silence in the running world, never a literal id. */
async function silenceThread(page: Page) {
  const world = await ppWorld(page);
  const threat = world.threats.find((candidate) => candidate.defId === liveSilence.id);
  if (threat === undefined) throw new Error('the level does not plan the silence');
  return threat;
}

/** Advances by chunks until `isDone` holds on the events; fails when `boundMs` of sim time passed. */
async function advanceUntilEvent(
  page: Page,
  type: string,
  boundMs: number,
): Promise<Awaited<ReturnType<typeof ppEvents>>[number]> {
  const chunks = Math.ceil(boundMs / (CHUNK_STEPS * STEP_MS));
  for (let i = 0; i <= chunks; i++) {
    const found = (await ppEvents(page)).find((event) => event.type === type);
    if (found !== undefined) return found;
    await ppAdvance(page, CHUNK_STEPS);
  }
  throw new Error(`no ${type} within ${boundMs} ms`);
}

/** Forces the silence and steps to the instant it is announced. */
async function startSilence(page: Page) {
  const threat = await silenceThread(page);
  await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
  const started = await advanceUntilEvent(page, 'SilenceStarted', SILENCE_START_BOUND_MS);
  await ppAdvance(page, 1); // a frame later, the page has followed the world
  return { threat, started };
}

const bubble = (page: Page) => page.locator('.pp-silence-bubble');

/** `rgb(...)` of a colour token, resolved by the browser. */
const tokenColour = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

async function babyPx(page: Page): Promise<{ x: number; y: number }> {
  const value = await html(page).getAttribute('data-pp-baby-px');
  const match = /^(-?[\d.]+),(-?[\d.]+)$/.exec(value ?? '');
  if (match === null) throw new Error(`data-pp-baby-px is "${String(value)}", not "x,y"`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test.describe('the silence starts', () => {
  test('the baby hides and goes quiet, the music cuts, the bubble blinks at the edge on the side of the zone and the device vibrates once', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await expect(bubble(page)).toBeHidden();
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    const eventsBefore = (await ppEvents(page)).length;

    const { threat } = await startSilence(page);
    const types = (await ppEvents(page, eventsBefore)).map((event) => event.type);
    expect(types).toContain('ThreatHidden');
    expect(types).toContain('SilenceStarted');
    expect(types).not.toContain('ThreatTelegraphed');
    const changes = (await ppEvents(page, eventsBefore)).filter(
      (event) => event.type === 'BabyStateChanged',
    );
    expect(changes).toContainEqual(expect.objectContaining({ to: 'mischiefSilent' }));

    // The sound telegraph is the babble's stop, then the music's.
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-silence', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-cue', SILENCE_CUE);

    // The « … » bubble: shown, in the alert colour, blinking no faster than 3 Hz.
    await expect(bubble(page)).toBeVisible();
    await expect(bubble(page)).toHaveText('…');
    await expect(bubble(page)).toHaveAttribute('aria-label', 'Silence');
    const style = await bubble(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        background: computed.backgroundColor,
        durations: computed.animationDuration.split(',').map((value) => value.trim()),
        name: computed.animationName,
      };
    });
    expect(style.background).toBe(await tokenColour(page, '--pp-color-alert'));
    expect(style.name).not.toBe('none');
    for (const duration of style.durations) {
      const seconds = duration.endsWith('ms')
        ? Number.parseFloat(duration) / 1000
        : Number.parseFloat(duration);
      expect(seconds, 'one blink cycle').toBeGreaterThanOrEqual(1 / 3);
    }

    // It sits at the edge of the side the zone is on, under the HUD row and above the bottom third.
    const viewport = page.viewportSize();
    const box = await bubble(page).boundingBox();
    if (viewport === null || box === null) throw new Error('no viewport or no bubble box');
    const zone = await pagePointOf(page, threat.xM, 0.25, threat.zM);
    const isZoneOnTheRight = zone.x > viewport.width / 2;
    expect(box.x + box.width / 2 > viewport.width / 2).toBe(isZoneOnTheRight);
    const edgeGap = isZoneOnTheRight ? viewport.width - (box.x + box.width) : box.x;
    expect(edgeGap).toBeLessThan(viewport.width / 4);
    const row = await page.locator('.pp-hud-row').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual((row?.y ?? 0) + (row?.height ?? 0));
    expect(box.y + box.height).toBeLessThanOrEqual((viewport.height * 2) / 3 + 1);

    // One short vibration: the cue of SilenceStarted (nothing else played in between).
    const pattern = hapticPatternOfCue(SILENCE_CUE);
    if (hasVibrate() && pattern !== null) {
      const seen = (await vibrations(page)).slice(vibrationsBefore);
      expect(seen.filter((candidate) => String(candidate) === String(pattern))).toHaveLength(1);
    }
    expect(problems).toEqual([]);
  });

  test('with reduced motion the bubble pulses at 1 Hz or slower, with no flash', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFrozen(page);
    await startSilence(page);
    await expect(bubble(page)).toBeVisible();
    const style = await bubble(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        name: computed.animationName,
        timing: computed.animationTimingFunction,
        duration: computed.animationDuration,
      };
    });
    expect(style.name).toBe('pp-silence-pulse');
    expect(style.timing).not.toContain('steps');
    const seconds = style.duration.endsWith('ms')
      ? Number.parseFloat(style.duration) / 1000
      : Number.parseFloat(style.duration);
    expect(seconds).toBeGreaterThanOrEqual(1);
  });
});

test.describe('the baby is found', () => {
  test('a tap on the baby ends the silence: music and babble back, the bubble gone, the threat telegraphed and parried in its window', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const { threat } = await startSilence(page);
    const eventsBefore = (await ppEvents(page)).length;
    const at = await babyPx(page);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 2);

    const after = await ppEvents(page, eventsBefore);
    expect(after).toContainEqual(
      expect.objectContaining({ type: 'SilenceEnded', reason: 'found' }),
    );
    expect(after).toContainEqual(
      expect.objectContaining({ type: 'ThreatTelegraphed', threatId: threat.id }),
    );
    await expect(html(page)).toHaveAttribute('data-pp-silence', 'found');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
    await expect(bubble(page)).toBeHidden();

    // From here it is parried like any other threat: wait for the window, press the marker.
    const instance = await silenceThread(page);
    const stepsToOpen = Math.ceil(
      (instance.windowOpenAt - (await ppWorld(page)).time.sim) / STEP_MS,
    );
    expect(stepsToOpen * STEP_MS).toBeLessThanOrEqual(
      telegraphDelayMsOf(liveSilence as never) + STEP_MS,
    );
    await ppAdvance(page, stepsToOpen);
    expect((await silenceThread(page)).state).toBe('windowOpen');
    const marker = page.locator('.pp-threat-icon').first();
    await expect(marker).toBeVisible();
    const box = await marker.boundingBox();
    if (box === null) throw new Error('the marker has no box');
    const pressFrom = (await ppEvents(page)).length;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await ppAdvance(page, 3);
    const resolved = (await ppEvents(page, pressFrom)).find(
      (event) => event.type === 'ResponseResolved',
    );
    expect(resolved).toMatchObject({ threatId: threat.id });
    expect(['perfect', 'success']).toContain(
      resolved?.type === 'ResponseResolved' ? resolved.quality : '',
    );
    expect(problems).toEqual([]);
  });

  test('Papa walking into the zone finds him, before the surprise mischief comes', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const { threat, started } = await startSilence(page);
    const zone = await silenceThread(page);
    await ppSend(page, { type: 'TapFloor', xM: zone.xM, zM: zone.zM });
    const found = await advanceUntilEvent(page, 'SilenceEnded', liveSilence.findMaxMs);
    expect(found).toMatchObject({ reason: 'found', threatId: threat.id });
    expect(found.t).toBeLessThan(started.t + liveSilence.findMaxMs);
    expect((await ppEvents(page)).map((event) => event.type)).not.toContain('GagTriggered');
    expect(problems).toEqual([]);
  });
});

test.describe('the baby is not found', () => {
  test('the surprise mischief comes findMaxMs after the silence started: a late gag from the list, the music back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const { threat, started } = await startSilence(page);
    const eventsBefore = (await ppEvents(page)).length;
    await ppAdvance(page, FIND_STEPS + 2);
    const after = await ppEvents(page, eventsBefore);
    const ended = after.find((event) => event.type === 'SilenceEnded');
    expect(ended).toMatchObject({ reason: 'timedOut', threatId: threat.id });
    expect(ended?.t).toBe(started.t + liveSilence.findMaxMs);
    const gag = after.find((event) => event.type === 'GagTriggered');
    expect(gag).toMatchObject({ threatId: threat.id, reason: 'late' });
    expect(liveSilence.surpriseGags).toContain(gag?.type === 'GagTriggered' ? gag.gag : '');
    expect(after.map((event) => event.type)).not.toContain('NearMiss');
    await expect(html(page)).toHaveAttribute('data-pp-silence', 'timedOut');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
    await expect(bubble(page)).toBeHidden();
    await expect(html(page)).toHaveAttribute('data-pp-cue', liveSilence.feedback.gag);
    expect((await ppWorld(page)).mess.mischiefs).toBe(1);
    expect(problems).toEqual([]);
  });
});
