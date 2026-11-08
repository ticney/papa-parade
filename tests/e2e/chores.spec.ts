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
  ppFreeze,
  ppLoadLevel,
  ppPagePoint,
  ppSend,
  ppSilenceCatastrophe,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The house chores (story 9.4): the cooking on the stove of the kitchen, played with real taps on
// its marker. A frozen level is stepped through the test API; the chore's state is read through the
// mirror `data-pp-chore` (`<index>:<state>:<beatsDone>/<beatCount>:<beatState>`) and the events.
// Every timing is read from the world (the window frozen at the announcement), the places from the
// level's own files (its geometry's `stove` anchor, its duration), the rise from the feel: none is typed.

const LEVEL = 'salon_kitchen';
const SEED = 42;
const STOVE = '[data-pp-object="stove"]';
const HINT = '.pp-papa-hint';
const geometry = JSON.parse(readFileSync(`content/levels/${LEVEL}.geometry.json`, 'utf8')) as {
  anchors: { id: string; positionM: [number, number, number] }[];
};
const stoveAnchor = geometry.anchors.find((anchor) => anchor.id === 'stove');
if (stoveAnchor === undefined) throw new Error(`${LEVEL} has no stove anchor`);
/** The stove's anchor (its icon point), at the far end from Papa's spawn. */
const STOVE_AT = stoveAnchor.positionM;
/** A walkable point at the kitchen end, a step from the stove: the follow camera then frames it. */
const KITCHEN_END = [STOVE_AT[0] - 0.35, STOVE_AT[2] + 1.625] as const;
/** Another walkable point, a metre further along the room: where Papa goes to leave the stove. */
const AWAY_FROM_STOVE = [KITCHEN_END[0] + 1, KITCHEN_END[1] + 0.5] as const;
const levelDurationMs = (
  JSON.parse(readFileSync(`content/levels/${LEVEL}.json`, 'utf8')) as { durationMs: number }
).durationMs;

const chore = ppChore;

/** Loads the kitchen frozen; `threats` keeps its waves (a test about a threat), else none disturbs the beat. */
async function open(page: Page, { threats = false }: { threats?: boolean } = {}): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(appUrl(`/${threats ? '' : THREATS_OFF}${threats ? '?' : '&'}level=${LEVEL}`));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await waitFrames(page, 3);
}

/**
 * Walks Papa to the kitchen end (a `TapFloor` sent through `__PP__`, the baby in his arms if he carries
 * him), so that the follow camera frames the stove and a real finger can reach its marker.
 */
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
  const { papa } = await ppWorld(page);
  expect(Math.hypot(papa.xM - KITCHEN_END[0], papa.zM - KITCHEN_END[1])).toBeLessThan(0.5);
  // The follow camera settles on Papa within about a second of sim time.
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

/** Steps one at a time until `done` holds (a world read after each step); fails after `limit` steps. */
async function advanceUntil(
  page: Page,
  done: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
  limit = 2000,
): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (done(await ppWorld(page))) return;
    await ppAdvance(page, 1);
  }
  throw new Error(`the condition did not hold within ${limit} steps`);
}

/** A real finger on the stove's marker, then the steps that apply it. */
async function tapStove(page: Page, steps = 2): Promise<void> {
  await waitFrames(page, 3);
  const at = await ppPagePoint(page, ...STOVE_AT);
  await page.touchscreen.tap(at.x, at.y);
  await ppAdvance(page, steps);
}

/** Starts the cooking: a tap on the marker, then steps until Papa works there. */
async function startCooking(page: Page): Promise<void> {
  await tapStove(page);
  await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
  await waitFrames(page, 3);
}

/** The centre of the announced beat's window, from the world. */
async function centreOfBeat(page: Page): Promise<number> {
  const { chores } = await ppWorld(page);
  const beat = chores[0];
  if (beat === undefined) throw new Error('the level has no chore');
  return beat.beatWindowOpenAt + beat.responseWindow.windowMs / 2;
}

/** Steps to the centre of the beat's window, then taps the marker with a real finger. */
async function catchBeat(page: Page): Promise<void> {
  const centre = await centreOfBeat(page);
  await advanceUntil(page, (world) => world.time.sim >= centre - 10, 1000);
  await tapStove(page, 3);
}

test.describe('the house chores', () => {
  // A whole beat takes seconds of stepping and frames: more than the default 30 s on a loaded machine.
  test.describe.configure({ timeout: 120_000 });

  test('a tap on the stove glides Papa there and starts the cooking: ring and bubble up', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkToKitchen(page);
    expect(await chore(page)).toBe('0:untouched:0/4:none');
    await expect(page.locator(STOVE)).toHaveCount(1);

    await tapStove(page);
    const tapped = (await typesOf(page, 'ObjectTapped')) as unknown as { objectId: string }[];
    expect(tapped.map((event) => event.objectId)).toEqual(['stove']);
    // Papa glides to the station, with no threat to glide to.
    const glides = (await typesOf(page, 'PapaGlideStarted')) as unknown as {
      threatId: number | null;
    }[];
    expect(glides.at(-1)?.threatId).toBeNull();
    expect((await ppWorld(page)).papa.state).toBe('glide');

    await advanceUntil(page, (world) => world.papa.state === 'chore', 300);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:working:0/4:telegraph');
    // The station's ring is shown, and the bubble of the chore above Papa.
    await expect(page.locator(`${STOVE} .pp-chrono-ring`)).toBeVisible();
    await expect(page.locator('.pp-activity-bubble--pan')).toBeVisible();
    // A chore refuses no tap, so the bubble never shakes; and the announcement was cued.
    expect(await typesOf(page, 'TapRefused')).toHaveLength(0);
    await expect(page.locator('.pp-activity-body--refused')).toHaveCount(0);
    expect(await cueIds(page)).toContain('chore_beat_cued');
    await shot(page, testInfo, 'chore-announced.png');
    expect(problems).toEqual([]);
  });

  test('a beat caught at the centre of its window is perfect and advances the chore', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSend(page, { type: 'SetCatastrophe', pct: 50 });
    await walkToKitchen(page);
    await startCooking(page);
    // The window opens: the final arc of the ring is lit (a picture for the story's review).
    const opensAt = (await ppWorld(page)).chores[0]?.beatWindowOpenAt ?? 0;
    await advanceUntil(page, (world) => world.time.sim >= opensAt + 20, 1000);
    await waitFrames(page, 3);
    await shot(page, testInfo, 'chore-arc-lit.png');
    // The arc lighting vibrates once, as a threat's does at its window.
    expect(await cueIds(page)).toContain('chrono_arc_lit');
    await catchBeat(page);
    const judged = (await typesOf(page, 'ChoreBeatJudged')) as unknown as {
      quality: string;
      beatIndex: number;
    }[];
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ beatIndex: 0, quality: 'perfect' });
    expect(await chore(page)).toBe('0:working:1/4:telegraph');
    // A perfect lowers the catastrophe, like a perfect parry.
    const lowered = (await typesOf(page, 'CatastropheChanged')) as unknown as {
      source: string;
      deltaPct: number;
    }[];
    expect(lowered.find((event) => event.source === 'perfect')?.deltaPct).toBeLessThan(0);
    // Papa did not move for the tap: it was the beat's press.
    expect((await ppWorld(page)).papa.state).toBe('chore');
    // The log is cumulative: the one `ObjectTapped` is the tap that started the cooking. The beat's press
    // is taken by the chore system, which judges it, and emits none.
    expect(await typesOf(page, 'ObjectTapped')).toHaveLength(1);
    expect(await cueIds(page)).toContain('chore_beat_perfect');
    expect(problems).toEqual([]);
  });

  test('a missed beat costs the catastrophe, repeats the same beat and does not advance', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkToKitchen(page);
    await startCooking(page);
    const before = (await ppWorld(page)).gauges.catastrophePct;
    const { beatWindowOpenAt, responseWindow } = (await ppWorld(page)).chores[0] ?? {
      beatWindowOpenAt: 0,
      responseWindow: { windowMs: 0, toleranceMs: 0 },
    };
    const closeAt = beatWindowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs;
    await advanceUntil(page, (world) => world.time.sim > closeAt + 40, 2000);
    const judged = (await typesOf(page, 'ChoreBeatJudged')) as unknown as {
      quality: string;
      reason: string | null;
      beatIndex: number;
    }[];
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ quality: 'fail', reason: 'late', beatIndex: 0 });
    expect(await chore(page)).toBe('0:working:0/4:telegraph');
    const rises = (await typesOf(page, 'CatastropheChanged')) as unknown as {
      source: string;
      deltaPct: number;
    }[];
    const { feel } = await ppWorld(page);
    const multiplier = feel.difficulty.normal.catastropheMultiplier;
    expect(rises.find((event) => event.source === 'choreBeat')?.deltaPct).toBeCloseTo(
      feel.catastrophe.risePct.choreBeat * multiplier,
      6,
    );
    expect(await cueIds(page)).toContain('chore_puree_stuck');
    expect((await ppWorld(page)).gauges.catastrophePct).toBeGreaterThan(before);
    const announced = (await typesOf(page, 'ChoreBeatTelegraphed')) as unknown as {
      beatIndex: number;
    }[];
    expect(announced.map((event) => event.beatIndex)).toEqual([0, 0]);
    expect(problems).toEqual([]);
  });

  test('leaving keeps the progress, and a tap on the stove resumes at the next beat', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkToKitchen(page);
    await startCooking(page);
    await catchBeat(page);
    await ppSend(page, { type: 'TapFloor', xM: AWAY_FROM_STOVE[0], zM: AWAY_FROM_STOVE[1] });
    await ppAdvance(page, 3);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:paused:1/4:none');
    // No ring without an announced beat.
    await expect(page.locator(`${STOVE} .pp-chrono-ring`)).toBeHidden();
    await tapStove(page);
    await advanceUntil(page, (world) => world.papa.state === 'chore', 600);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:working:1/4:telegraph');
    const announced = (await typesOf(page, 'ChoreBeatTelegraphed')) as unknown as {
      beatIndex: number;
    }[];
    expect(announced.at(-1)?.beatIndex).toBe(1);
    expect(problems).toEqual([]);
  });

  test('a threat’s window holds the beat; answering the threat takes Papa off the stove', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page, { threats: true });
    await ppSilenceCatastrophe(page);
    await walkToKitchen(page);
    await startCooking(page);
    const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === 'outlet');
    if (outlet === undefined) throw new Error('the kitchen has no outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await advanceUntil(
      page,
      (world) => world.threats.find((threat) => threat.id === outlet.id)?.state === 'windowOpen',
      1500,
    );
    await waitFrames(page, 3);
    // The beat is withdrawn, its ring hidden: the threat has priority.
    expect(await chore(page)).toBe('0:working:0/4:held');
    await expect(page.locator(`${STOVE} .pp-chrono-ring`)).toBeHidden();
    // The press is never refused, and takes Papa off the stove: the chore is paused.
    const open1 = (await ppWorld(page)).threats.find((threat) => threat.id === outlet.id);
    const centre = (open1?.windowOpenAt ?? 0) + (open1?.responseWindow?.windowMs ?? 0) / 2;
    await advanceUntil(page, (world) => world.time.sim >= centre - 10, 400);
    await ppSend(page, { type: 'PressThreat', threatId: outlet.id });
    await ppAdvance(page, 3);
    await ppSend(page, { type: 'Release' });
    await ppAdvance(page, 5);
    expect(await typesOf(page, 'TapRefused')).toHaveLength(0);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:paused:0/4:none');
    // The threat's window is over (answered): nothing holds the beat any more.
    const answered = (await ppWorld(page)).threats.find((threat) => threat.id === outlet.id);
    expect(answered?.state).not.toBe('windowOpen');
    // Back at the stove after the window: the beat is announced again, in full.
    await tapStove(page);
    await advanceUntil(page, (world) => world.papa.state === 'chore', 600);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:working:0/4:telegraph');
    const back = (await ppWorld(page)).chores[0];
    expect((back?.beatWindowOpenAt ?? 0) - (back?.beatTelegraphAt ?? 0)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('four beats finish the cooking, which pays 7,5 of the Maison row at the end', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await walkToKitchen(page);
    await startCooking(page);
    for (let beat = 0; beat < 4; beat++) await catchBeat(page);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('0:done:4/4:none');
    const completed = (await typesOf(page, 'ChoreCompleted')) as unknown as {
      homePoints: number;
    }[];
    expect(completed).toHaveLength(1);
    expect(completed[0]?.homePoints).toBe(7.5);
    expect(await cueIds(page)).toContain('chore_completed');
    // Done: dimmed, inert, Papa idle at the station.
    await expect(page.locator(`${STOVE}.pp-object-done`)).toHaveCount(1);
    expect((await ppWorld(page)).papa.state).toBe('idle');
    await expect(page.locator(`${STOVE} .pp-chrono-ring`)).toBeHidden();
    // The level ends on its timer; the note holds the chore's points.
    // The cap is the level's own length (500 ms a step), plus a margin for the frozen end and the photo.
    for (
      let i = 0;
      i < levelDurationMs / 500 + 20 && (await html(page).getAttribute('data-pp-app')) === 'level';
      i++
    ) {
      await ppAdvance(page, 500);
    }
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    const scored = (await typesOf(page, 'LevelScored')) as unknown as { homePoints: number }[];
    expect(scored[0]?.homePoints).toBe(7.5);
    await expect(page.locator('.pp-result-panel .pp-score-row-home .pp-score-value')).toHaveText(
      '7,5',
      { timeout: 15_000 },
    );
    await expect(page.locator('.pp-result-panel .pp-score-row-home .pp-score-max')).toHaveText(
      '/15',
    );
    await shot(page, testInfo, 'chore-result.png');
    expect(problems).toEqual([]);
  });

  test('a tap on the stove with the baby in the arms is refused: Papa goes nowhere', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await ppSilenceCatastrophe(page);
    await ppSend(page, { type: 'TapBaby' });
    await advanceUntil(page, (world) => world.baby.state === 'carried', 800);
    // He carries the baby to the kitchen, where the stove is in the frame.
    await walkToKitchen(page);
    const before = (await ppWorld(page)).papa;
    await tapStove(page, 3);
    const refused = (await typesOf(page, 'ChoreRefused')) as unknown as { reason: string }[];
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBe('carrying');
    // Visible and audible: the cue played, and the hint says why above Papa.
    expect(await cueIds(page)).toContain('chore_refused');
    await expect(page.locator(HINT)).toBeVisible();
    await expect(page.locator(HINT)).toHaveText(STRINGS['verb.put_down_first'] as string);
    const after = (await ppWorld(page)).papa;
    expect(after.state).toBe('idle');
    expect(Math.hypot(after.xM - before.xM, after.zM - before.zM)).toBeLessThan(0.01);
    expect(await chore(page)).toBe('0:untouched:0/4:none');
    expect(problems).toEqual([]);
  });

  test('a level without stations has an empty chore mirror and no station marker', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await page.goto(appUrl(`/${THREATS_OFF}&level=salon_crawler`));
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, 'salon_crawler', SEED);
    await ppAdvance(page, 5);
    await waitFrames(page, 3);
    expect(await chore(page)).toBe('');
    await expect(page.locator(STOVE)).toHaveCount(0);
    expect((await ppWorld(page)).chores).toEqual([]);
    expect(problems).toEqual([]);
  });
});
