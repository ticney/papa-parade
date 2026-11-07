import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cueIds, shot, typesOf } from './support/duel.ts';
import {
  appUrl,
  collectProblems,
  html,
  OWN_WARNINGS,
  THREATS_OFF,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppChore,
  ppCueLog,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppPagePoint,
  ppSend,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The dishwasher (story 9.6): the second station of the kitchen, its plates and its open door, played with
// real taps on the markers. A frozen `salon_kitchen` is stepped through the test API. Every delay, rise,
// amount and verb is read from the content (`unload_dishwasher.json`, `dishwasher_open.json`,
// `strings.fr.json`, the feel): none is typed. Chromium only.

const LEVEL = 'salon_kitchen';
const SEED = 42;
const DISHWASHER = '[data-pp-object="dishwasher"]';
const VERB = `${DISHWASHER} .pp-object-verb`;

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (story 9.6)');

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const geometry = read<{ anchors: { id: string; positionM: [number, number, number] }[] }>(
  `content/levels/${LEVEL}.geometry.json`,
);
const anchorOf = (id: string): [number, number, number] => {
  const anchor = geometry.anchors.find((candidate) => candidate.id === id);
  if (anchor === undefined) throw new Error(`${LEVEL} has no ${id} anchor`);
  return anchor.positionM;
};
const DISHWASHER_AT = anchorOf('dishwasher');
const STOVE_AT = anchorOf('stove');
/** A walkable point at the kitchen end, a step from the stove: the follow camera then frames both stations. */
const KITCHEN_END = [STOVE_AT[0] - 0.35, STOVE_AT[2] + 1.625] as const;
/** Another walkable point, a metre further along the room: where Papa goes to leave a station. */
const AWAY = [KITCHEN_END[0] + 1, KITCHEN_END[1] + 0.5] as const;
/** Across the room from the dishwasher, still inside the follow frame (9.1 m wide): its marker stays in view. */
const ACROSS = [DISHWASHER_AT[0] + 3.8, DISHWASHER_AT[2] + 2.4] as const;

const level = read<{ durationMs: number; chores: { def: string; object: string }[] }>(
  `content/levels/${LEVEL}.json`,
);
const unload = read<{
  beats: { verbKey: string }[];
  missBrokenObjects: number;
  missNoisePct: number;
  homePoints: number;
  openThreat: string;
}>('content/chores/unload_dishwasher.json');
const door = read<{ id: string; verbKey: string }>(`content/threats/${unload.openThreat}.json`);
/** The dishwasher's place among the level's chores (the mirror and `world.chores` are indexed by it). */
const INDEX = level.chores.findIndex((entry) => entry.def === 'unload_dishwasher');
if (INDEX < 0) throw new Error(`${LEVEL} declares no unload_dishwasher chore`);
const BEATS = unload.beats.length;
const CATCH = STRINGS[unload.beats[0]?.verbKey ?? ''] as string;
const CLOSE_DOOR = STRINGS[door.verbKey] as string;

type World = Awaited<ReturnType<typeof ppWorld>>;

/** Loads the kitchen frozen; `threats` keeps its waves (the door is a wave threat), else none disturbs the beats. */
async function open(page: Page, { threats = false }: { threats?: boolean } = {}): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(appUrl(`/${threats ? '' : THREATS_OFF}${threats ? '?' : '&'}level=${LEVEL}`));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await waitFrames(page, 3);
}

async function advanceUntil(page: Page, done: (world: World) => boolean, limit = 2000) {
  for (let i = 0; i < limit; i++) {
    if (done(await ppWorld(page))) return;
    await ppAdvance(page, 1);
  }
  throw new Error(`the condition did not hold within ${limit} steps`);
}

/** Walks Papa to the kitchen end through `__PP__`, a frame between steps so that the follow camera comes. */
async function walkToKitchen(page: Page): Promise<void> {
  await ppSend(page, { type: 'TapFloor', xM: KITCHEN_END[0], zM: KITCHEN_END[1] });
  for (let i = 0; i < 400; i++) {
    await ppAdvance(page, 10);
    const { papa } = await ppWorld(page);
    if (
      papa.state === 'idle' &&
      Math.hypot(papa.xM - KITCHEN_END[0], papa.zM - KITCHEN_END[1]) < 0.5
    ) {
      break;
    }
  }
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

/** A real finger on the dishwasher's marker (a threat standing on the same anchor wins the hit-test), then the steps that apply it. */
async function tapDishwasher(page: Page, steps = 2): Promise<void> {
  await waitFrames(page, 3);
  const at = await ppPagePoint(page, ...DISHWASHER_AT);
  await page.touchscreen.tap(at.x, at.y);
  await ppAdvance(page, steps);
}

async function startDishwasher(page: Page): Promise<void> {
  await tapDishwasher(page);
  await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
  await waitFrames(page, 3);
}

const dishwasherOf = (world: World) => {
  const chore = world.chores[INDEX];
  if (chore === undefined) throw new Error('the level has no dishwasher chore');
  return chore;
};
const doorOf = (world: World) => {
  const threat = world.threats.find((candidate) => candidate.defId === door.id);
  if (threat === undefined) throw new Error(`the kitchen plans no ${door.id}`);
  return threat;
};

/** Steps to the centre of the announced beat's window, then taps the marker with a real finger. */
async function catchBeat(page: Page): Promise<void> {
  const beat = dishwasherOf(await ppWorld(page));
  const centre = beat.beatWindowOpenAt + beat.responseWindow.windowMs / 2;
  await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
  await tapDishwasher(page, 3);
  await waitFrames(page, 3);
}

/** Lets the announced beat go by: the silence is its verdict. */
async function missBeat(page: Page): Promise<void> {
  const missed = dishwasherOf(await ppWorld(page)).beatsMissed;
  await advanceUntil(page, (world) => dishwasherOf(world).beatsMissed > missed, 2000);
  await waitFrames(page, 4);
}

const catastropheRise = async (page: Page, source: string) =>
  ((await typesOf(page, 'CatastropheChanged')) as unknown as { source: string; deltaPct: number }[])
    .filter((event) => event.source === source)
    .map((event) => event.deltaPct);

test.describe('the dishwasher: plates and the open door', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a tap on the dishwasher starts the chore: « RATTRAPE ! », a plate in the bubble, a beat caught', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkToKitchen(page);
    expect(await ppChore(page, INDEX)).toBe(`${INDEX}:untouched:0/${BEATS}:none`);
    await expect(page.locator(DISHWASHER)).toHaveCount(1);
    await expect(page.locator(VERB)).toBeHidden();
    await startDishwasher(page);
    expect(await ppChore(page, INDEX)).toBe(`${INDEX}:working:0/${BEATS}:telegraph`);
    await expect(page.locator(VERB)).toBeVisible();
    await expect(page.locator(VERB)).toHaveText(CATCH);
    // The bubble above Papa wears the dishwasher's plate, not the stove's saucepan.
    await expect(page.locator('.pp-activity-bubble--plate')).toHaveCount(1);
    await expect(page.locator('.pp-activity-bubble--pan')).toHaveCount(0);
    // A quiet room (`?threats=off`) has no open door: the chore never opens one (the door test below does).
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(false);
    await shot(page, testInfo, 'a-catch-the-plate.png');
    await catchBeat(page);
    expect(await ppChore(page, INDEX)).toBe(`${INDEX}:working:1/${BEATS}:telegraph`);
    const judged = (await typesOf(page, 'ChoreBeatJudged')) as unknown as {
      choreIndex: number;
      quality: string;
    }[];
    expect(judged).toEqual([expect.objectContaining({ choreIndex: INDEX, quality: 'perfect' })]);
    expect(problems).toEqual([]);
  });

  test('a missed beat breaks a plate: its crash, the noise, the catastrophe and a shard on the floor', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkToKitchen(page);
    await startDishwasher(page);
    expect((await ppFx(page)).choreShards).toBe(0);
    // Step to the miss and look at the frame right after it: the crash's puff lives a short real time.
    const beat = dishwasherOf(await ppWorld(page));
    const closeAt =
      beat.beatWindowOpenAt + beat.responseWindow.windowMs + beat.responseWindow.toleranceMs;
    await advanceUntil(page, (world) => world.time.sim >= closeAt - 20, 2000);
    await page.evaluate(async (untilSimMs) => {
      const api = window.__PP__;
      if (api === undefined) return;
      while ((api.state()?.time.sim ?? Number.POSITIVE_INFINITY) <= untilSimMs) {
        api.advance(1);
        if (api.cueLog().some((record) => record.cueId === 'chore_plate_broken')) break;
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }, closeAt + 200);
    await shot(page, testInfo, 'b-the-crash.png');
    await waitFrames(page, 4);
    expect(dishwasherOf(await ppWorld(page)).beatsMissed).toBe(1);
    // The same beat comes back; nothing advanced.
    expect(await ppChore(page, INDEX)).toBe(`${INDEX}:working:0/${BEATS}:telegraph`);
    expect(await cueIds(page)).toContain('chore_plate_broken');
    const crash = (await ppCueLog(page)).find((record) => record.cueId === 'chore_plate_broken');
    expect(crash?.visuals).toEqual(expect.arrayContaining(['soundWave']));
    const noise = (await typesOf(page, 'NoiseChanged')) as unknown as {
      source: string;
      deltaPct: number;
    }[];
    const gagNoise = noise.filter((event) => event.source === 'gag');
    expect(gagNoise).toHaveLength(1);
    expect(gagNoise[0]?.deltaPct).toBeCloseTo(unload.missNoisePct, 6);
    const { feel } = await ppWorld(page);
    const [rise] = await catastropheRise(page, 'choreBeat');
    expect(rise).toBeCloseTo(
      feel.catastrophe.risePct.choreBeat * feel.difficulty.normal.catastropheMultiplier,
      6,
    );
    // One plate, one cluster of shards on the floor in front of the dishwasher.
    expect((await ppFx(page)).choreShards).toBe(unload.missBrokenObjects);
    // Papa steps away: the verb goes, and the shards are what is left on the floor.
    await ppSend(page, { type: 'TapFloor', xM: AWAY[0], zM: AWAY[1] });
    await ppAdvance(page, 3);
    await waitFrames(page, 4);
    await expect(page.locator(VERB)).toBeHidden();
    await shot(page, testInfo, 'b2-the-shards.png');
    expect(problems).toEqual([]);
  });

  test('left open it calls the baby: « REFERME ! » closes the door, unanswered he gets in', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    // The whole level, the door among its threats: the first wave's other threats come no sooner than its gap.
    await open(page, { threats: true });
    const first = await ppWorld(page);
    const { risePct } = first.feel.catastrophe;
    // Only the mess of the door is under test: the other gags (the outlet, the stairs) must not end the level.
    await ppSetFeel(page, { catastrophe: { risePct: { ...risePct, nearMiss: 0, microSleep: 0 } } });
    // Papa opens the dishwasher and walks off, so it is paused with its door open: a command, because at the
    // spawn the station is out of the follow frame; everything after it is a real tap.
    await ppSend(page, { type: 'TapObject', objectId: 'dishwasher' });
    await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
    await ppAdvance(page, 100);
    await waitFrames(page, 4);
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(true);
    await ppSend(page, { type: 'TapFloor', xM: AWAY[0], zM: AWAY[1] });
    await ppAdvance(page, 3);
    expect(dishwasherOf(await ppWorld(page))).toMatchObject({ state: 'paused', isOpen: true });
    // The kitchen's other threats must not have started yet: this is the quiet before the first gap.
    const quiet = await ppWorld(page);
    expect(quiet.director.nextAt).toBeGreaterThan(quiet.time.sim + 1500);
    // The baby chooses the open dishwasher.
    await ppSend(page, { type: 'ForceThreat', threatId: doorOf(await ppWorld(page)).id });
    await ppAdvance(page, 2);
    await waitFrames(page, 4);
    const telegraphed = (await typesOf(page, 'ThreatTelegraphed')) as unknown as {
      kind: string;
      anchorId: string;
    }[];
    expect(telegraphed.filter((event) => event.kind === door.id)).toEqual([
      expect.objectContaining({ anchorId: 'dishwasher' }),
    ]);
    await expect(page.locator('.pp-threat-verb', { hasText: CLOSE_DOOR })).toBeVisible();
    // A real finger on the marker at the centre of the window shuts the door.
    const opening = doorOf(await ppWorld(page));
    const centre = opening.windowOpenAt + (opening.responseWindow?.windowMs ?? 0) / 2;
    await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
    await waitFrames(page, 2);
    await tapDishwasher(page, 3);
    const resolved = (await typesOf(page, 'ResponseResolved')) as unknown as {
      threatId: number;
      quality: string;
    }[];
    const closed = resolved.find((event) => event.threatId === opening.id);
    expect(closed?.quality === 'perfect' || closed?.quality === 'success').toBe(true);
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(false);
    // The baby is not sent back to the door Papa has just shut: the threat is in its cooldown, so this only
    // shows that no second telegraph follows the parry. That a shut door itself refuses `ForceThreat` and
    // the director is pinned by the sim tests (« ignores ForceThreat on a shut door »), not here.
    await ppSend(page, { type: 'ForceThreat', threatId: opening.id });
    await ppAdvance(page, 3);
    const again = (await typesOf(page, 'ThreatTelegraphed')) as unknown as { kind: string }[];
    expect(again.filter((event) => event.kind === door.id)).toHaveLength(1);
    // Papa reopens it by resuming the chore, and walks across the room while the door waits out its cooldown.
    await ppSend(page, { type: 'TapObject', objectId: 'dishwasher' });
    await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(true);
    await ppSend(page, { type: 'TapFloor', xM: ACROSS[0], zM: ACROSS[1] });
    await ppAdvance(page, 3);
    expect(dishwasherOf(await ppWorld(page))).toMatchObject({ state: 'paused', isOpen: true });
    for (let i = 0; i < 400 && (await ppWorld(page)).papa.state !== 'idle'; i++) {
      await ppAdvance(page, 10);
    }
    const { papa } = await ppWorld(page);
    expect(Math.hypot(papa.xM - DISHWASHER_AT[0], papa.zM - DISHWASHER_AT[2])).toBeGreaterThan(3);
    expect((await ppFx(page)).mischiefDecals).toBe(0);
    // Once the door is idle again the baby chooses it, and nobody answers.
    await advanceUntil(
      page,
      (world) => {
        const state = doorOf(world).state;
        return state === 'idle' || state === 'telegraph';
      },
      2000,
    );
    if (doorOf(await ppWorld(page)).state === 'idle') {
      await ppSend(page, { type: 'ForceThreat', threatId: opening.id });
    }
    await advanceUntil(page, (world) => doorOf(world).state === 'telegraph', 20);
    await waitFrames(page, 4);
    await shot(page, testInfo, 'c-the-open-door-papa-across-the-room.png');
    const messRisesBefore = (await catastropheRise(page, 'mess')).length;
    await advanceUntil(page, (world) => doorOf(world).state === 'gag', 1000);
    await waitFrames(page, 4);
    const gags = (await typesOf(page, 'GagTriggered')) as unknown as {
      gag: string;
      threatId: number;
    }[];
    expect(gags.filter((event) => event.gag === 'baby_in_dishwasher')).toEqual([
      expect.objectContaining({ threatId: opening.id }),
    ]);
    const { feel } = await ppWorld(page);
    // The door's gag is one `mess` rise of its own (another mischief of the kitchen may have come earlier in the
    // seeded run, story 9.7: the pool is bigger now, so only the rises since the telegraph count).
    const mess = (await catastropheRise(page, 'mess')).slice(messRisesBefore);
    expect(mess).toHaveLength(1);
    expect(mess[0]).toBeCloseTo(
      feel.catastrophe.risePct.mess * feel.difficulty.normal.catastropheMultiplier,
      6,
    );
    // The cutlery on the floor, and a mischief for Mama's Soupir; the door stays open.
    const afterGag = await ppWorld(page);
    expect((await ppFx(page)).mischiefDecals).toBe(afterGag.afterEffects.mischiefMarks.length);
    expect(afterGag.mess.mischiefs).toBeGreaterThanOrEqual(1);
    // The cutlery lies at the dishwasher, wherever the baby was drawn when the gag came.
    const marks = afterGag.afterEffects.mischiefMarks.filter(
      (mark) => mark.gag === 'baby_in_dishwasher',
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]?.xM).toBeCloseTo(DISHWASHER_AT[0], 2);
    expect(marks[0]?.zM).toBeCloseTo(DISHWASHER_AT[2], 2);
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(true);
    await shot(page, testInfo, 'd-the-cutlery.png');
    expect(problems).toEqual([]);
  });

  test('both chores done: the Maison row is full and the plate is in the Soupir', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkToKitchen(page);
    // The cooking first (the stove), four beats.
    await ppSend(page, { type: 'TapObject', objectId: 'stove' });
    await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
    for (let beat = 0; beat < 4; beat++) {
      const stove = (await ppWorld(page)).chores[0];
      const centre = (stove?.beatWindowOpenAt ?? 0) + (stove?.responseWindow.windowMs ?? 0) / 2;
      await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
      await ppSend(page, { type: 'TapObject', objectId: 'stove' });
      await ppAdvance(page, 3);
    }
    expect((await ppWorld(page)).chores[0]?.state).toBe('done');
    // Then the dishwasher: one plate dropped on the first beat, the rest caught.
    await startDishwasher(page);
    await missBeat(page);
    for (let beat = 0; beat < BEATS; beat++) {
      await catchBeat(page);
      if (beat < BEATS - 1) {
        await advanceUntil(page, (world) => dishwasherOf(world).beatState === 'telegraph', 600);
      }
    }
    await waitFrames(page, 3);
    expect(await ppChore(page, INDEX)).toBe(`${INDEX}:done:${BEATS}/${BEATS}:none`);
    expect(dishwasherOf(await ppWorld(page)).isOpen).toBe(false);
    expect((await ppFx(page)).choreShards).toBe(unload.missBrokenObjects);
    // The level ends on its timer; the note holds both chores and the plate.
    for (
      let i = 0;
      i < level.durationMs / 500 + 20 && (await html(page).getAttribute('data-pp-app')) === 'level';
      i++
    ) {
      await ppAdvance(page, 500);
    }
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    const scored = (await typesOf(page, 'LevelScored')) as unknown as {
      homePoints: number;
      sighPoints: number;
    }[];
    const { feel } = await ppWorld(page);
    expect(scored[0]?.homePoints).toBe(feel.mama.homeMaxPoints);
    // The Soupir row, to the point: the plates the chore counted join the props the physics broke, and
    // nothing else is added (the final rush's mess is in `world.mess`, read once the level is over).
    const { mess, chores } = await ppWorld(page);
    const platesBroken = (chores[INDEX]?.beatsMissed ?? 0) * (unload.missBrokenObjects as number);
    expect(platesBroken).toBe(unload.missBrokenObjects);
    expect(scored[0]?.sighPoints).toBe(
      Math.round(
        Math.min(
          feel.mama.sighMaxPoints,
          mess.propsOnFloor * feel.mama.sighPerPropOnFloorPoints +
            (mess.propsBroken + platesBroken) * feel.mama.sighPerBrokenPropPoints +
            mess.mischiefs * feel.mama.sighPerMischiefPoints,
        ),
      ),
    );
    await expect(page.locator('.pp-result-panel .pp-score-row-home .pp-score-value')).toHaveText(
      String(feel.mama.homeMaxPoints),
      { timeout: 15_000 },
    );
    await expect(page.locator('.pp-result-panel .pp-score-row-home .pp-score-max')).toHaveText(
      `/${feel.mama.homeMaxPoints}`,
    );
    // The Soupir row reads « no sigh »: what is left of its maximum once the plate and the rest are taken off.
    await expect(page.locator('.pp-result-panel .pp-score-row-sigh .pp-score-value')).toHaveText(
      String(feel.mama.sighMaxPoints - (scored[0]?.sighPoints ?? 0)),
      { timeout: 15_000 },
    );
    await shot(page, testInfo, 'e-the-result.png');
    expect(problems).toEqual([]);
  });
});
