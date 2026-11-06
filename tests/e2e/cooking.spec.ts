import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cueIds, typesOf } from './support/duel.ts';
import { collectProblems, OWN_WARNINGS, THREATS_OFF, waitFrames } from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppChore,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppOffscreen,
  ppPagePoint,
  ppSend,
  ppSilenceCatastrophe,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The cooking dressed and left on the fire (story 9.5): the verb of each beat at the station, the smoke of
// a missed beat, and the pot a cooking left alone for `afterMs` becomes. A frozen `salon_kitchen` stepped
// through the test API, real taps on the markers. Every delay, verb and amount is read from the content
// (`cooking.json`, `strings.fr.json`, the feel): none is typed. Chromium only.

const LEVEL = 'salon_kitchen';
const SEED = 42;
const STOVE = '[data-pp-object="stove"]';
const VERB = `${STOVE} .pp-object-verb`;
const POT_DEF = 'pot_on_stove';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (story 9.5)');

const geometry = JSON.parse(readFileSync(`content/levels/${LEVEL}.geometry.json`, 'utf8')) as {
  anchors: { id: string; positionM: [number, number, number] }[];
};
const anchorOf = (id: string): [number, number, number] => {
  const anchor = geometry.anchors.find((candidate) => candidate.id === id);
  if (anchor === undefined) throw new Error(`${LEVEL} has no ${id} anchor`);
  return anchor.positionM;
};
const STOVE_AT = anchorOf('stove');
const SPAWN_AT = anchorOf('papa_spawn');
/** A walkable point at the kitchen end, a step from the stove: the follow camera then frames it. */
const KITCHEN_END = [STOVE_AT[0] - 0.35, STOVE_AT[2] + 1.625] as const;
const AWAY_FROM_STOVE = [KITCHEN_END[0] + 1, KITCHEN_END[1] + 0.5] as const;
const cooking = JSON.parse(readFileSync('content/chores/cooking.json', 'utf8')) as {
  beats: { verbKey: string }[];
  abandonedThreat: { def: string; afterMs: number };
};
const verbOfBeat = (beat: number): string => {
  const key = cooking.beats[beat]?.verbKey;
  const text = key === undefined ? undefined : STRINGS[key];
  if (text === undefined) throw new Error(`beat ${beat} has no verb string`);
  return text;
};
const LOWER_HEAT = STRINGS['verb.lower_heat'] as string;

type World = Awaited<ReturnType<typeof ppWorld>>;

/** The verb's box starts under the HUD's top row (the 9.5 review's clamp): it is not cut at the kitchen end. */
async function expectUnderHudRow(page: Page, verb: ReturnType<Page['locator']>): Promise<void> {
  const row = await page.locator('.pp-hud-row').first().boundingBox();
  const box = await verb.boundingBox();
  if (row === null || box === null) throw new Error('no HUD row or no verb box');
  expect(box.y).toBeGreaterThanOrEqual(row.y + row.height - 1);
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`/${THREATS_OFF}&level=${LEVEL}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await waitFrames(page, 3);
}

/** Walks Papa to `(xM, zM)` through `__PP__`, until he stands (a frame between steps so the camera follows). */
async function walkTo(page: Page, xM: number, zM: number): Promise<void> {
  await ppSend(page, { type: 'TapFloor', xM, zM });
  for (let i = 0; i < 600; i++) {
    await ppAdvance(page, 10);
    const { papa } = await ppWorld(page);
    if (papa.state === 'idle' && Math.hypot(papa.xM - xM, papa.zM - zM) < 0.5) break;
  }
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

async function advanceUntil(page: Page, done: (world: World) => boolean, limit = 2000) {
  for (let i = 0; i < limit; i++) {
    if (done(await ppWorld(page))) return;
    await ppAdvance(page, 1);
  }
  throw new Error(`the condition did not hold within ${limit} steps`);
}

/** Steps `ms` of sim time in chunks, so that nothing is skipped by a long call. */
async function advanceMs(page: Page, ms: number): Promise<void> {
  for (let left = Math.round(ms / 10); left > 0; left -= 500) {
    await ppAdvance(page, Math.min(500, left));
  }
}

async function tapStove(page: Page, steps = 2): Promise<void> {
  await waitFrames(page, 3);
  const at = await ppPagePoint(page, ...STOVE_AT);
  await page.touchscreen.tap(at.x, at.y);
  await ppAdvance(page, steps);
}

async function startCooking(page: Page): Promise<void> {
  await tapStove(page);
  await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
  await waitFrames(page, 3);
}

async function catchBeat(page: Page): Promise<void> {
  const beat = (await ppWorld(page)).chores[0];
  if (beat === undefined) throw new Error('the level has no chore');
  const centre = beat.beatWindowOpenAt + beat.responseWindow.windowMs / 2;
  await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
  await tapStove(page, 3);
  await waitFrames(page, 3);
}

/** The pot of the cooking in the world. */
const potOf = (world: World) => {
  const pot = world.threats.find((threat) => threat.defId === POT_DEF);
  if (pot === undefined) throw new Error(`the kitchen plans no ${POT_DEF}`);
  return pot;
};

/** Leaves the stove and steps until the pot is telegraphed (the cooking stays paused `afterMs`). */
async function abandonUntilPot(page: Page): Promise<void> {
  await ppSend(page, { type: 'TapFloor', xM: AWAY_FROM_STOVE[0], zM: AWAY_FROM_STOVE[1] });
  await ppAdvance(page, 3);
  expect(await ppChore(page)).toMatch(/^0:paused:/);
  await advanceMs(page, cooking.abandonedThreat.afterMs - 100);
  expect(potOf(await ppWorld(page)).state).toBe('idle');
  await advanceUntil(page, (world) => potOf(world).state === 'telegraph', 100);
  await waitFrames(page, 3);
}

test.describe('the cooking: verbs, smoke and the pot on the stove', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the station shows the verb of each announced beat, and none while paused', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    // No beat yet: the verb exists in the DOM and is hidden.
    await expect(page.locator(VERB)).toBeHidden();
    await startCooking(page);
    await expect(page.locator(VERB)).toBeVisible();
    await expect(page.locator(VERB)).toHaveText(verbOfBeat(0));
    await expectUnderHudRow(page, page.locator(VERB));
    await catchBeat(page);
    expect(await ppChore(page)).toBe('0:working:1/4:telegraph');
    await expect(page.locator(VERB)).toHaveText(verbOfBeat(1));
    await catchBeat(page);
    await expect(page.locator(VERB)).toHaveText(verbOfBeat(2));
    await catchBeat(page);
    await expect(page.locator(VERB)).toHaveText(verbOfBeat(3));
    // Leaving drops the announced beat: no verb while the cooking is paused.
    await ppSend(page, { type: 'TapFloor', xM: AWAY_FROM_STOVE[0], zM: AWAY_FROM_STOVE[1] });
    await ppAdvance(page, 3);
    await waitFrames(page, 3);
    expect(await ppChore(page)).toBe('0:paused:3/4:none');
    await expect(page.locator(VERB)).toBeHidden();
    // Coming back announces the beat again, with its verb.
    await tapStove(page);
    await advanceUntil(page, (world) => world.papa.state === 'chore', 600);
    await waitFrames(page, 3);
    await expect(page.locator(VERB)).toHaveText(verbOfBeat(3));
    expect(problems).toEqual([]);
  });

  test('a missed beat plays « la purée attache »: its own cue, with the smoke at the stove', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    await startCooking(page);
    expect((await ppFx(page)).particlesAlive).toBe(0);
    const beat = (await ppWorld(page)).chores[0];
    if (beat === undefined) throw new Error('the level has no chore');
    const closeAt =
      beat.beatWindowOpenAt + beat.responseWindow.windowMs + beat.responseWindow.toleranceMs;
    await advanceUntil(page, (world) => world.time.sim >= closeAt - 20, 2000);
    // Step to the miss and read the puff in the same page call, a frame after its cue: the particles live
    // a short real time, which a round trip per step (under the load of the whole suite) can outlast.
    const particlesAtMiss = await page.evaluate(async (untilSimMs) => {
      const api = window.__PP__;
      if (api === undefined) return -1;
      while ((api.state()?.time.sim ?? Number.POSITIVE_INFINITY) <= untilSimMs) {
        api.advance(1);
        if (api.cueLog().some((record) => record.cueId === 'chore_puree_stuck')) break;
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      return api.fx().particlesAlive;
    }, closeAt + 200);
    expect(await cueIds(page)).toContain('chore_puree_stuck');
    expect(await cueIds(page)).not.toContain('chore_beat_missed');
    // The cue drew its ring at the stove and the gag's puff: particles are alive.
    const log = await page.evaluate(() => window.__PP__?.cueLog() ?? []);
    const stuck = log.find((record) => record.cueId === 'chore_puree_stuck');
    expect(stuck?.visuals).toEqual(expect.arrayContaining(['soundWave', 'particles']));
    expect(particlesAtMiss).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('a cooking left alone for afterMs puts the pot on the fire, and a real tap lowers it', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    await startCooking(page);
    await catchBeat(page);
    await abandonUntilPot(page);
    const telegraphed = (await typesOf(page, 'ThreatTelegraphed')) as unknown as {
      kind: string;
      waveIndex: number;
    }[];
    expect(telegraphed.at(-1)).toMatchObject({ kind: POT_DEF, waveIndex: -1 });
    // Its marker stands at the stove, with « BAISSE LE FEU ! ».
    await expect(page.locator('.pp-threat-verb', { hasText: LOWER_HEAT })).toBeVisible();
    await expectUnderHudRow(page, page.locator('.pp-threat-verb', { hasText: LOWER_HEAT }));
    // The cooking keeps its progress: one beat caught, still to do.
    expect(await ppChore(page)).toBe('0:paused:1/4:none');
    // A real finger on the marker at the centre of the window.
    const pot = potOf(await ppWorld(page));
    const centre = pot.windowOpenAt + (pot.responseWindow?.windowMs ?? 0) / 2;
    await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
    await waitFrames(page, 2);
    const at = await ppPagePoint(page, ...STOVE_AT);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 3);
    const resolved = (await typesOf(page, 'ResponseResolved')) as unknown as {
      threatId: number;
      quality: string;
    }[];
    const lowered = resolved.find((event) => event.threatId === pot.id);
    expect(lowered?.quality === 'perfect' || lowered?.quality === 'success').toBe(true);
    expect(await typesOf(page, 'GagTriggered')).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test('a pot let go boils over: noise, the catastrophe, a mischief and the purée on the floor', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    await startCooking(page);
    await abandonUntilPot(page);
    const before = await ppWorld(page);
    expect((await ppFx(page)).mischiefDecals).toBe(0);
    const pot = potOf(before);
    const closeAt = pot.windowOpenAt + (pot.responseWindow?.windowMs ?? 0) + 400;
    await advanceUntil(page, (world) => world.time.sim >= closeAt, 3000);
    await waitFrames(page, 4);
    const gags = (await typesOf(page, 'GagTriggered')) as unknown as {
      gag: string;
      threatId: number;
    }[];
    expect(gags).toEqual([expect.objectContaining({ gag: 'pot_boiled_over', threatId: pot.id })]);
    const noise = (await typesOf(page, 'NoiseChanged')) as unknown as {
      source: string;
      deltaPct: number;
    }[];
    expect(noise.filter((event) => event.source === 'gag')).toHaveLength(1);
    const rises = (await typesOf(page, 'CatastropheChanged')) as unknown as {
      source: string;
      deltaPct: number;
    }[];
    const { feel, mess } = await ppWorld(page);
    const mess20 = rises.find((event) => event.source === 'mess');
    expect(mess20?.deltaPct).toBeCloseTo(
      feel.catastrophe.risePct.mess * feel.difficulty.normal.catastropheMultiplier,
      6,
    );
    expect(mess.mischiefs).toBe(1);
    // The purée stays on the floor: a decal, until the end.
    expect((await ppFx(page)).mischiefDecals).toBe(1);
    expect(problems).toEqual([]);
  });

  test('with Papa across the room the pot gets an off-screen bubble', async ({ page }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    await startCooking(page);
    // Papa leaves for the other end of the room: the stove is out of the follow frame.
    await ppSend(page, { type: 'TapFloor', xM: SPAWN_AT[0], zM: SPAWN_AT[2] });
    await advanceMs(page, cooking.abandonedThreat.afterMs - 100);
    await advanceUntil(page, (world) => potOf(world).state === 'telegraph', 200);
    await ppAdvance(page, 2);
    await waitFrames(page, 4);
    const pot = potOf(await ppWorld(page));
    const bubbles = await ppOffscreen(page);
    expect(bubbles.map((bubble) => bubble.threatId)).toContain(pot.id);
    expect(problems).toEqual([]);
  });
});
