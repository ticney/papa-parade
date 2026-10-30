import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { BABY_CARRIED_HEIGHT_M } from '../../src/client/render/views/babyView.ts';
import { HUD_MAX_DOM_NODES, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  pagePointOf,
  recordVibrations,
  startLevel,
  vibrations,
  WALK_BOUND_MS,
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

// Carrying the baby (story 4.1) on the live level, driven by the test API on a frozen level: steps by
// hand, every bound read from the live feel and content (nothing waits on a fixed delay, nothing
// hard-codes a tuned number). Chromium and WebKit both run it; the vibrations are checked on
// Chromium only (WebKit has no `navigator.vibrate`).

const LEVEL = 'salon_crawler';
const SEED = 42;
const CHUNK_STEPS = 10;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const carryFeel = (liveFeel as unknown as { carry: Record<string, number> }).carry;
const ARMS_CRY_MAX_MS = carryFeel.armsCryMaxMs as number;
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  zones: { id: string; kind: string; centerM: [number, number, number] }[];
};
const playpen = geometry.zones.find((zone) => zone.kind === 'safe');
if (playpen === undefined) throw new Error('the live room has no safe zone');
const armsCry = JSON.parse(readFileSync('content/threats/arms_cry.json', 'utf8')) as {
  telegraphDelayMs: number;
};
/** From the telegraph of the cry in the arms to the end of its judgement, with the margins. */
const ARMS_CRY_JUDGE_MS = armsCry.telegraphDelayMs + 2000;

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up (WebKit resumes its context a moment after the start): a first tap must not be
  // the gesture that rescues it.
  await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
}

/** Advances by chunks until `isDone` holds on the world; fails when `boundMs` of sim time passed. */
async function advanceUntil(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
): Promise<void> {
  const chunks = Math.ceil(boundMs / (CHUNK_STEPS * STEP_MS));
  for (let i = 0; i <= chunks; i++) {
    if (isDone(await ppWorld(page))) return;
    await ppAdvance(page, CHUNK_STEPS);
  }
  throw new Error(`${what} did not happen within ${boundMs} ms`);
}

/** Takes the baby with a `TapBaby` (Papa walks there first), trying again if he crawled away. */
async function takeBaby(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await ppWorld(page)).baby.state === 'carried') return;
    await ppSend(page, { type: 'TapBaby' });
    try {
      await advanceUntil(
        page,
        'the pick-up',
        WALK_BOUND_MS,
        (world) => world.baby.state === 'carried',
      );
    } catch {
      // He was out of reach on arrival: the next attempt walks to where he is now.
    }
  }
  expect((await ppWorld(page)).baby.state).toBe('carried');
}

const papaBabyThreat = async (page: Page, defId: string) => {
  const threat = (await ppWorld(page)).threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`the level has no ${defId}`);
  return threat;
};

test.describe('taking the baby', () => {
  test('a TapBaby walks Papa to him and takes him: the state, the event and the mirror follow', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const before = (await ppEvents(page)).length;
    await ppSend(page, { type: 'TapBaby' });
    await advanceUntil(
      page,
      'the pick-up',
      WALK_BOUND_MS,
      (world) => world.baby.state === 'carried',
    );
    const types = (await ppEvents(page, before)).map((event) => event.type);
    expect(types).toContain('PapaPathPlanned');
    expect(types).toContain('BabyPickedUp');
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    // He is in Papa's arms: at his point, wherever he walks.
    const world = await ppWorld(page);
    expect([world.baby.xM, world.baby.zM]).toEqual([world.papa.xM, world.papa.zM]);
    expect(problems).toEqual([]);
  });

  test('a real tap on the baby does the same', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const baby = (await ppWorld(page)).baby;
    const at = await pagePointOf(
      page,
      baby.xM,
      (liveFeel.baby as unknown as { bodyRadiusM: number }).bodyRadiusM,
      baby.zM,
    );
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 1);
    expect((await ppEvents(page)).map((event) => event.type)).toContain('PapaPathPlanned');
    await advanceUntil(
      page,
      'the pick-up',
      WALK_BOUND_MS,
      (world) => world.baby.state === 'carried',
    );
    expect(problems).toEqual([]);
  });

  test('cancels a telegraphed threat with no gag: it goes back to idle and the gag mirror does not move', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // Next to the baby first, so that the take is at once.
    const baby = (await ppWorld(page)).baby;
    await ppSend(page, { type: 'TapFloor', xM: baby.xM, zM: baby.zM });
    await ppAdvance(page, 1); // the walk has begun: Papa is no longer idle
    await advanceUntil(page, 'the walk', WALK_BOUND_MS, (world) => world.papa.state === 'idle');
    const outlet = await papaBabyThreat(page, 'outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-threat', `${outlet.id}:telegraph`);
    const before = (await ppEvents(page)).length;
    await takeBaby(page);
    const events = await ppEvents(page, before);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ThreatCancelled', threatId: outlet.id, reason: 'carried' }),
    );
    expect(events.map((event) => event.type)).not.toContain('GagTriggered');
    expect(events.map((event) => event.type)).not.toContain('ResponseResolved');
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-threat', `${outlet.id}:idle`);
    await expect(html(page)).not.toHaveAttribute('data-pp-gag', /.+/);
    expect(problems).toEqual([]);
  });
});

test.describe('putting the baby down', () => {
  test('a tap on Papa puts him down on bare floor: unsafe, babbling again', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await takeBaby(page);
    const world = await ppWorld(page);
    const at = await pagePointOf(page, world.papa.xM, BABY_CARRIED_HEIGHT_M, world.papa.zM);
    const before = (await ppEvents(page)).length;
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 2);
    expect((await ppEvents(page, before)).map((event) => event.type)).toContain('BabyPutDown');
    await expect(html(page)).toHaveAttribute('data-pp-put-down', 'unsafe');
    expect((await ppWorld(page)).baby.state).not.toBe('carried');
    await expect(html(page)).not.toHaveAttribute('data-pp-baby-state', 'carried');
    expect(problems).toEqual([]);
  });

  test('carried to the playpen, he is put down safe', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await takeBaby(page);
    const before = (await ppEvents(page)).length;
    await ppSend(page, { type: 'TapFloor', xM: playpen.centerM[0], zM: playpen.centerM[2] });
    await advanceUntil(
      page,
      'the put-down',
      WALK_BOUND_MS,
      (world) => world.baby.state !== 'carried',
    );
    const putDown = (await ppEvents(page, before)).find((event) => event.type === 'BabyPutDown');
    expect(putDown).toMatchObject({ safe: true });
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-put-down', 'safe');
    expect(problems).toEqual([]);
  });
});

test.describe('the cry in the arms', () => {
  test('comes after a delay, reads « BERCE ! », is parried, and a put-down cancels the next one', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppSetFeel(page, {
      carry: { armsCryMinMs: STEP_MS, armsCryMaxMs: STEP_MS * 2 },
    });
    await takeBaby(page);
    const cryThreat = await papaBabyThreat(page, 'arms_cry');
    await advanceUntil(page, 'the cry in the arms', ARMS_CRY_MAX_MS, (world) =>
      world.threats.some((threat) => threat.id === cryThreat.id && threat.state === 'telegraph'),
    );
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-threat', `${cryThreat.id}:telegraph`);
    const verb = page.locator('.pp-threat-verb');
    await expect(verb).toHaveText(STRINGS['verb.rock'] as string);

    // A Parry: press the marker once the window is open.
    await advanceUntil(
      page,
      'the window',
      ARMS_CRY_JUDGE_MS,
      (world) => world.threats.find((threat) => threat.id === cryThreat.id)?.state === 'windowOpen',
    );
    const marker = page.locator('.pp-threat-icon').first();
    const box = await marker.boundingBox();
    if (box === null) throw new Error('the marker has no box');
    const pressFrom = (await ppEvents(page)).length;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await ppAdvance(page, 5);
    const resolved = (await ppEvents(page, pressFrom)).find(
      (event) => event.type === 'ResponseResolved',
    );
    expect(resolved).toMatchObject({ threatId: cryThreat.id, response: 'parry' });
    expect((await ppWorld(page)).baby.state).toBe('carried');

    // The next one is due again; putting the baby down while it is up cancels it.
    await advanceUntil(page, 'the next cry', ARMS_CRY_MAX_MS + ARMS_CRY_JUDGE_MS, (world) =>
      world.threats.some((threat) => threat.id === cryThreat.id && threat.state === 'telegraph'),
    );
    const cancelFrom = (await ppEvents(page)).length;
    await ppSend(page, { type: 'TapBaby' });
    await ppAdvance(page, 2);
    expect(await ppEvents(page, cancelFrom)).toContainEqual(
      expect.objectContaining({
        type: 'ThreatCancelled',
        threatId: cryThreat.id,
        reason: 'putDown',
      }),
    );
    await expect(html(page)).toHaveAttribute('data-pp-threat', `${cryThreat.id}:idle`);
    expect(problems).toEqual([]);
  });
});

test.describe('the cues of carrying', () => {
  test('the pick-up and the put-down play their cues, with their vibrations on Chromium', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    await takeBaby(page);
    await ppSend(page, { type: 'TapBaby' });
    await ppAdvance(page, 3);
    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    expect(cues).toContain('baby_picked_up');
    expect(cues).toContain('baby_put_down');
    if (hasVibrate()) {
      const seen = (await vibrations(page)).slice(vibrationsBefore).map(String);
      for (const cueId of ['baby_picked_up', 'baby_put_down']) {
        const pattern = hapticPatternOfCue(cueId);
        expect(pattern, `${cueId} has a haptic`).not.toBeNull();
        expect(seen).toContain(String(pattern));
      }
    }
    expect(problems).toEqual([]);
  });

  test('keeps the HUD within its node budget while carrying', async ({ page }) => {
    await openFrozen(page);
    await takeBaby(page);
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
  });
});
