import { expect, type Page, test } from '@playwright/test';
import { PHONE_RINGING_EVERY_MS, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  cueCount,
  hapticPatternOfCue,
  html,
  liveFeel,
  livePhone,
  objectIconPoint,
  recordVibrations,
  vibrations,
  WALK_BOUND_MS,
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

// The phone that rings (story 1.20) on the live level, driven by the test API on a frozen level:
// `StartDisruption` rings it now (no waiting for 125 s), steps by hand. Every bound comes from the
// live `content/disruptions/phone.json`; nothing waits on a fixed delay. Chromium and WebKit both run it.

const LEVEL = 'salon_crawler';
const SEED = 42;
const TICK_STEPS = PHONE_RINGING_EVERY_MS / STEP_MS;
const RING_STEPS = Math.ceil(livePhone.ringMaxMs / STEP_MS);
const CALL_STEPS = Math.ceil(livePhone.answerBusyMs / STEP_MS);
const CHUNK_STEPS = 25;
const FATIGUE_FEEL = (
  liveFeel as unknown as { fatigue: { perSec: number; carriedMultiplier: number } }
).fatigue;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

const typesOf = async (page: Page, since = 0): Promise<string[]> =>
  (await ppEvents(page, since)).map((event) => event.type);

/** Advances by chunks until an event of `type` appears; fails when `boundMs` of sim time passed. */
async function advanceUntilEvent(page: Page, type: string, boundMs: number) {
  const chunks = Math.ceil(boundMs / (CHUNK_STEPS * STEP_MS));
  for (let i = 0; i < chunks; i++) {
    const found = (await ppEvents(page)).find((event) => event.type === type);
    if (found !== undefined) return found;
    await ppAdvance(page, CHUNK_STEPS);
  }
  const found = (await ppEvents(page)).find((event) => event.type === type);
  if (found === undefined) throw new Error(`no ${type} within ${boundMs} ms`);
  return found;
}

test.describe('the phone rings', () => {
  test('starts on StartDisruption, rings once a second with a cue and a vibration each, and says so on the page', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const cuesBefore = await cueCount(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    const eventsBefore = (await ppEvents(page)).length;

    await ppSend(page, { type: 'StartDisruption', index: 0 });
    await ppAdvance(page, 1);
    const started = (await ppEvents(page, eventsBefore)).find(
      (event) => event.type === 'PhoneRingStarted',
    );
    if (started?.type !== 'PhoneRingStarted') throw new Error('no PhoneRingStarted');
    expect(started).toMatchObject({ objectId: 'phone', untilAt: started.t + livePhone.ringMaxMs });
    await expect(html(page)).toHaveAttribute('data-pp-phone', 'ringing');
    await expect(html(page)).toHaveAttribute('data-pp-cue', livePhone.feedback.ring);
    expect(await cueCount(page)).toBe(cuesBefore + 1);

    // Three seconds on: one PhoneRinging per period, each with its cue (and its vibration).
    await ppAdvance(page, 3 * TICK_STEPS);
    const ticks = (await ppEvents(page, eventsBefore)).filter(
      (event) => event.type === 'PhoneRinging',
    );
    expect(ticks.map((event) => event.t)).toEqual([
      started.t + PHONE_RINGING_EVERY_MS,
      started.t + 2 * PHONE_RINGING_EVERY_MS,
      started.t + 3 * PHONE_RINGING_EVERY_MS,
    ]);
    // The start and the three ticks each played the ring (the threats of the live level are not
    // due before their first gap, which is longer than these three seconds: `cuesBefore` is taken here).
    expect(await cueCount(page)).toBe(cuesBefore + 4);
    const pattern = hapticPatternOfCue(livePhone.feedback.ring);
    if (hasVibrate() && pattern !== null) {
      const patterns = (await vibrations(page)).slice(vibrationsBefore);
      expect(patterns.filter((candidate) => String(candidate) === String(pattern))).toHaveLength(4);
    }
    expect(problems).toEqual([]);
  });

  test('rings out when nobody answers: floor(ringMaxMs / period) rings, then PhoneRingEnded timedOut', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const eventsBefore = (await ppEvents(page)).length;
    await ppSend(page, { type: 'StartDisruption', index: 0 });
    await ppAdvance(page, RING_STEPS + 2);
    const events = await ppEvents(page, eventsBefore);
    const started = events.find((event) => event.type === 'PhoneRingStarted');
    const ended = events.find((event) => event.type === 'PhoneRingEnded');
    if (started?.type !== 'PhoneRingStarted' || ended?.type !== 'PhoneRingEnded') {
      throw new Error('the ring never started or never ended');
    }
    expect(ended).toMatchObject({ reason: 'timedOut', objectId: 'phone' });
    expect(ended.t).toBe(started.untilAt);
    expect(events.filter((event) => event.type === 'PhoneRinging')).toHaveLength(
      Math.floor(livePhone.ringMaxMs / PHONE_RINGING_EVERY_MS),
    );
    expect(events.map((event) => event.type)).not.toContain('PhoneAnswered');
    await expect(html(page)).toHaveAttribute('data-pp-phone', 'timedOut');
    // It stays silent after: no more phone event, however long the room goes on.
    const countAfter = (await ppEvents(page)).length;
    await ppAdvance(page, 2 * TICK_STEPS);
    expect((await typesOf(page, countAfter)).filter((type) => type.startsWith('Phone'))).toEqual(
      [],
    );
    expect(problems).toEqual([]);
  });
});

test.describe('the phone is answered', () => {
  test('a tap on the phone walks Papa there; on arrival he picks up, costs fatigue, talks answerBusyMs and is free again', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppSend(page, { type: 'SetFatigue', points: 20 });
    await ppAdvance(page, 2);
    await ppSend(page, { type: 'StartDisruption', index: 0 });
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-phone', 'ringing');
    const before = await ppWorld(page);
    const fatigueBefore = before.gauges.fatigue;
    const timeBefore = before.time.sim;

    const point = await objectIconPoint(page, 'phone');
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 1);
    expect(await typesOf(page)).toContain('ObjectTapped');

    const answered = await advanceUntilEvent(page, 'PhoneAnswered', WALK_BOUND_MS);
    if (answered.type !== 'PhoneAnswered') throw new Error('unreachable');
    const events = await ppEvents(page);
    const ended = events.find((event) => event.type === 'PhoneRingEnded');
    expect(ended).toMatchObject({ reason: 'answered', objectId: 'phone', t: answered.t });
    expect(answered.untilAt).toBe(answered.t + livePhone.answerBusyMs);
    // The cost is the def's, on top of what the gauge was before the walk plus what it grew by since
    // (at most `perSec`, at the carried rate, for the sim time that went by: from the live feel).
    const growthMax =
      ((answered.t - timeBefore) / 1000) * FATIGUE_FEEL.perSec * FATIGUE_FEEL.carriedMultiplier;
    expect(answered.fatigue).toBeGreaterThanOrEqual(fatigueBefore + livePhone.answerFatiguePoints);
    expect(answered.fatigue).toBeLessThanOrEqual(
      fatigueBefore + livePhone.answerFatiguePoints + growthMax,
    );
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'onPhone');
    await expect(html(page)).toHaveAttribute('data-pp-phone', 'answered');
    await expect(html(page)).toHaveAttribute(
      'data-pp-fatigue',
      String(Math.round(answered.fatigue)),
    );

    // During the call a tap on the floor plans no walk.
    const plansBefore = events.filter((event) => event.type === 'PapaPathPlanned').length;
    await page.touchscreen.tap(point.x + 120, point.y + 60);
    await ppAdvance(page, 5);
    const plansAfter = (await ppEvents(page)).filter(
      (event) => event.type === 'PapaPathPlanned',
    ).length;
    expect(plansAfter).toBe(plansBefore);

    // The call ends at the first step at or after untilAt, and nothing but the state change is emitted.
    const stepsLeft = Math.round((answered.untilAt - (await ppWorld(page)).time.sim) / STEP_MS);
    expect(stepsLeft).toBeLessThanOrEqual(CALL_STEPS);
    await ppAdvance(page, stepsLeft - 1);
    expect((await ppWorld(page)).papa.state).toBe('onPhone');
    const seen = (await ppEvents(page)).length;
    await ppAdvance(page, 1);
    expect(await typesOf(page, seen)).toEqual(['PapaStateChanged']);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    expect(problems).toEqual([]);
  });

  test('a phone that is not ringing is only a place to walk to', async ({ page }) => {
    await openFrozen(page);
    const point = await objectIconPoint(page, 'phone');
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 1);
    await advanceUntilEvent(page, 'PapaArrived', WALK_BOUND_MS);
    await ppAdvance(page, 2);
    expect((await typesOf(page)).filter((type) => type.startsWith('Phone'))).toEqual([]);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    await expect(html(page)).not.toHaveAttribute('data-pp-phone', /.*/);
  });
});
