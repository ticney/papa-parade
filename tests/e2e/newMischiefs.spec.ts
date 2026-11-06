import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { shot, typesOf } from './support/duel.ts';
import {
  collectProblems,
  html,
  OWN_WARNINGS,
  threatIconPoint,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppOffscreen,
  ppSend,
  ppSetFeel,
  ppSilenceCatastrophe,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The five new mischiefs of the big salon (story 9.7), played with real taps and holds on the markers: a
// frozen `salon_kitchen` stepped through the test API, `ForceThreat` starting the threat under test (the
// director's first gap is 4 s: every case ends well before it). Every delay, hold, rise and verb is read from
// the content (the five threat files, `strings.fr.json`, the feel): none is typed. Chromium only.

const LEVEL = 'salon_kitchen';
const SEED = 42;

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (story 9.7)');

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface DefFile {
  id: string;
  response: 'parry' | 'firm';
  verbKey: string;
  gag: string;
  holdUntilMs?: number;
  gagNoisePct?: number;
}

/** The five: the file, the anchor the level plans it at, and the wave that enters it. */
const FIVE = [
  { id: 'tablecloth_pull', anchor: 'dining_table' },
  { id: 'low_cabinet_open', anchor: 'low_cabinet' },
  { id: 'plant_dig', anchor: 'plant' },
  { id: 'bin_rummage', anchor: 'bin' },
  { id: 'papa_mug_low', anchor: 'papa_mug' },
] as const;
const defs = Object.fromEntries(
  FIVE.map(({ id }) => [id, read<DefFile>(`content/threats/${id}.json`)]),
) as Record<(typeof FIVE)[number]['id'], DefFile>;
const geometry = read<{ anchors: { id: string; positionM: [number, number, number] }[] }>(
  `content/levels/${LEVEL}.geometry.json`,
);
const anchorOf = (id: string): [number, number, number] => {
  const anchor = geometry.anchors.find((candidate) => candidate.id === id);
  if (anchor === undefined) throw new Error(`${LEVEL} has no ${id} anchor`);
  return anchor.positionM;
};
const verbOf = (id: keyof typeof defs): string => STRINGS[defs[id].verbKey] as string;

type World = Awaited<ReturnType<typeof ppWorld>>;
type ThreatView = World['threats'][number];

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`/?level=${LEVEL}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await waitFrames(page, 3);
}

async function advanceUntil(page: Page, done: (world: World) => boolean, limit = 1500) {
  for (let i = 0; i < limit; i++) {
    if (done(await ppWorld(page))) return;
    await ppAdvance(page, 1);
  }
  throw new Error(`the condition did not hold within ${limit} steps`);
}

const threatOf = (world: World, defId: string): ThreatView => {
  const threat = world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`the level plans no ${defId}`);
  return threat;
};

/** Walks Papa next to an anchor through `__PP__`, a frame between steps so that the follow camera comes. */
async function walkNear(page: Page, anchorId: string): Promise<void> {
  const [xM, , zM] = anchorOf(anchorId);
  await ppSend(page, { type: 'TapFloor', xM, zM });
  for (let i = 0; i < 400; i++) {
    await ppAdvance(page, 10);
    if (i % 5 === 0) await waitFrames(page, 1);
    if ((await ppWorld(page)).papa.state === 'idle') break;
  }
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

/** The baby chooses `defId`: forced, then two steps and a few frames so that the marker is drawn. */
async function force(page: Page, defId: string): Promise<ThreatView> {
  const threat = threatOf(await ppWorld(page), defId);
  await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
  await ppAdvance(page, 2);
  await waitFrames(page, 3);
  return threat;
}

/** Steps to `offsetMs` after the opening of the window of the threat `id`. */
async function stepToWindow(page: Page, id: number, offsetMs: number): Promise<ThreatView> {
  await advanceUntil(
    page,
    (world) => world.threats.find((t) => t.id === id)?.state === 'windowOpen',
  );
  const opened = (await ppWorld(page)).threats.find((candidate) => candidate.id === id);
  if (opened === undefined) throw new Error('the threat is gone');
  await advanceUntil(page, (world) => world.time.sim >= opened.windowOpenAt + offsetMs);
  await waitFrames(page, 2);
  return opened;
}

const resolved = async (page: Page, threatId: number) =>
  (
    (await typesOf(page, 'ResponseResolved')) as unknown as {
      threatId: number;
      quality: string;
      reason?: string;
      response: string;
    }[]
  ).filter((event) => event.threatId === threatId);

const gagsOf = async (page: Page) =>
  (await typesOf(page, 'GagTriggered')) as unknown as {
    threatId: number;
    gag: string;
    reason: string;
  }[];

const shownRing = (page: Page) => page.locator('.pp-chrono-ring:not([hidden])');
const progressOf = (page: Page): Promise<number> =>
  shownRing(page)
    .locator('.pp-chrono-progress')
    .evaluate((circle) => 1000 - Number(circle.getAttribute('stroke-dashoffset')));

test.describe('the five new mischiefs of the big salon', () => {
  test.describe.configure({ timeout: 180_000 });

  test('each is telegraphed at its anchor with its verb and its ring (screenshots a to e)', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    const shots: Record<string, string> = {
      tablecloth_pull: 'a-the-tablecloth.png',
      low_cabinet_open: 'b-the-low-cabinet.png',
      plant_dig: 'c-the-plant.png',
      bin_rummage: 'd-the-bin-held.png',
      papa_mug_low: 'e-papas-mug-held.png',
    };
    for (const { id, anchor } of FIVE) {
      await ppLoadLevel(page, LEVEL, SEED);
      await waitFrames(page, 3);
      await walkNear(page, anchor);
      const before = (await typesOf(page, 'ThreatTelegraphed')).length;
      const threat = await force(page, id);
      const telegraphed = (await typesOf(page, 'ThreatTelegraphed')) as unknown as {
        kind: string;
        anchorId: string;
      }[];
      expect(telegraphed.slice(before)).toEqual([
        expect.objectContaining({ kind: id, anchorId: anchor }),
      ]);
      // Its verb on the marker, its ring around it (the parry pair for a Firmness too).
      await expect(page.locator('.pp-threat-verb', { hasText: verbOf(id) })).toBeVisible();
      await expect(shownRing(page)).toHaveCount(1);
      const def = defs[id];
      if (def.response === 'firm') {
        // Held on the marker: the ring turns to its draining form while the finger stays down.
        await stepToWindow(page, threat.id, 0);
        const point = await threatIconPoint(page);
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await ppAdvance(page, 3);
        await waitFrames(page, 3);
        await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--hold/);
        await shot(page, testInfo, shots[id] as string);
        await page.mouse.up();
      } else {
        await shot(page, testInfo, shots[id] as string);
      }
    }
    expect(problems).toEqual([]);
  });

  test('a real tap on the tablecloth’s marker in its window parries it: « RATTRAPE ! », no gag', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkNear(page, 'dining_table');
    const threat = await force(page, 'tablecloth_pull');
    await expect(page.locator('.pp-threat-verb:not(.pp-object-verb)')).toHaveText(
      STRINGS['verb.catch'] as string,
    );
    await stepToWindow(page, threat.id, 0);
    const window = (await ppWorld(page)).threats.find((t) => t.id === threat.id);
    const centre = (window?.windowOpenAt ?? 0) + (window?.responseWindow?.windowMs ?? 0) / 2;
    await advanceUntil(page, (world) => world.time.sim >= centre - 10);
    await waitFrames(page, 2);
    const point = await threatIconPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 3);
    const [answer] = await resolved(page, threat.id);
    expect(answer?.response).toBe('parry');
    expect(answer?.quality === 'perfect' || answer?.quality === 'success').toBe(true);
    expect(await gagsOf(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('a real hold on the bin’s marker, kept past the end of the attack, wins it: the ring drains while held', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkNear(page, 'bin');
    const threat = await force(page, 'bin_rummage');
    await expect(page.locator('.pp-threat-verb:not(.pp-object-verb)')).toHaveText(
      STRINGS['verb.no'] as string,
    );
    const opened = await stepToWindow(page, threat.id, 0);
    const point = await threatIconPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await ppAdvance(page, 3);
    await waitFrames(page, 3);
    await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--hold/);
    const early = await progressOf(page);
    expect(early).toBeGreaterThan(0);
    // Later in the hold the ring holds less.
    await ppAdvance(page, 40);
    await waitFrames(page, 2);
    expect(await progressOf(page)).toBeLessThan(early);
    // The finger stays down past the end of the attack (`holdUntilMs` from the opening of the window).
    const holdUntilMs = defs.bin_rummage.holdUntilMs ?? Number.NaN;
    await advanceUntil(page, (world) => world.time.sim >= opened.windowOpenAt + holdUntilMs + 30);
    await waitFrames(page, 2);
    await page.mouse.up();
    await ppAdvance(page, 3);
    const [answer] = await resolved(page, threat.id);
    expect(answer?.response).toBe('firm');
    expect(answer?.quality === 'perfect' || answer?.quality === 'success').toBe(true);
    expect(await gagsOf(page)).toEqual([]);
    await ppAdvance(page, 40);
    await waitFrames(page, 4);
    // The bin's own threat has left its window (the walk to it may have let the director draw another one,
    // whose ring is no business of this test).
    expect(threatOf(await ppWorld(page), 'bin_rummage').state).not.toBe('windowOpen');
    expect(problems).toEqual([]);
  });

  test('a tap on the mug’s marker is the wrong answer to a Firmness: the coffee is spilled', async ({
    page,
  }) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkNear(page, 'papa_mug');
    const threat = await force(page, 'papa_mug_low');
    await expect(page.locator('.pp-threat-verb:not(.pp-object-verb)')).toHaveText(
      STRINGS['verb.no'] as string,
    );
    await stepToWindow(page, threat.id, 0);
    const point = await threatIconPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 4);
    expect(await gagsOf(page)).toEqual([
      expect.objectContaining({
        threatId: threat.id,
        gag: 'coffee_spilled',
        reason: 'wrongResponse',
      }),
    ]);
    expect(problems).toEqual([]);
  });

  test('letting the cabinet pass: the pans crash, the noise, the catastrophe, a mark and a decal at the cabinet', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    await walkNear(page, 'low_cabinet');
    const before = await ppWorld(page);
    expect((await ppFx(page)).mischiefDecals).toBe(0);
    const threat = await force(page, 'low_cabinet_open');
    await advanceUntil(page, (world) => threatOf(world, 'low_cabinet_open').state === 'gag');
    await waitFrames(page, 4);
    expect(await gagsOf(page)).toEqual([
      expect.objectContaining({ threatId: threat.id, gag: 'pan_concert', reason: 'late' }),
    ]);
    const { feel, mess, afterEffects } = await ppWorld(page);
    const noise = (
      (await typesOf(page, 'NoiseChanged')) as unknown as {
        source: string;
        deltaPct: number;
      }[]
    ).filter((event) => event.source === 'gag');
    expect(noise).toHaveLength(1);
    expect(noise[0]?.deltaPct).toBe(defs.low_cabinet_open.gagNoisePct);
    const rises = (
      (await typesOf(page, 'CatastropheChanged')) as unknown as {
        source: string;
        deltaPct: number;
      }[]
    ).filter((event) => event.source === 'mess');
    expect(rises).toHaveLength(1);
    expect(rises[0]?.deltaPct).toBeCloseTo(
      feel.catastrophe.risePct.mess * feel.difficulty.normal.catastropheMultiplier,
      6,
    );
    // One more mischief, marked at the cabinet's own anchor, and one decal drawn there.
    expect(mess.mischiefs).toBe(before.mess.mischiefs + 1);
    const [xM, , zM] = anchorOf('low_cabinet');
    expect(afterEffects.mischiefMarks).toEqual([
      { gag: 'pan_concert', xM: expect.closeTo(xM, 2), zM: expect.closeTo(zM, 2) },
    ]);
    expect((await ppFx(page)).mischiefDecals).toBe(1);
    await shot(page, testInfo, 'cabinet-pans-on-the-floor.png');
    expect(problems).toEqual([]);
  });

  test('a threat of the kitchen with Papa at the sofa end shows its off-screen bubble and its arrow (screenshot g)', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    // Papa stays at his spawn, at the sofa end of the room: the kitchen is a whole room away.
    const bin = await force(page, 'bin_rummage');
    const cabinet = await force(page, 'low_cabinet_open');
    await waitFrames(page, 4);
    const shown = await ppOffscreen(page);
    const ids = shown.map((bubble) => bubble.threatId);
    expect(ids).toEqual(expect.arrayContaining([bin.id, cabinet.id]));
    // Behind the kitchen wall as the camera sees it: out on the left or the top edge, never the right.
    for (const bubble of shown) expect(['left', 'top']).toContain(bubble.edge);
    await expect(page.locator('.pp-offscreen-bubble')).not.toHaveCount(0);
    await shot(page, testInfo, 'g-the-kitchen-off-screen.png');
    expect(problems).toEqual([]);
  });

  test('all five left alone leave five messes on the floor, and the Result’s Soupir counts them (screenshots f and h)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await open(page);
    // Only the messes are under test: no gag may bring Mama home (five rises of the mess would).
    await ppSilenceCatastrophe(page);
    // A wide frame so that the whole room, the five messes in it, is in the picture.
    await ppSetFeel(page, { camera: { frameWidthM: 15, frameDepthM: 9 } }).catch(() => undefined);
    await ppSend(page, { type: 'TapFloor', xM: -1.5, zM: 0 });
    for (let i = 0; i < 200 && (await ppWorld(page)).papa.state !== 'idle'; i++) {
      await ppAdvance(page, 10);
    }
    for (const { id } of FIVE) {
      await ppSend(page, { type: 'ForceThreat', threatId: threatOf(await ppWorld(page), id).id });
    }
    await advanceUntil(
      page,
      (world) => world.afterEffects.mischiefMarks.length >= FIVE.length,
      800,
    );
    await waitFrames(page, 5);
    const world = await ppWorld(page);
    const wanted = FIVE.map(({ id }) => defs[id].gag).sort();
    expect(world.afterEffects.mischiefMarks.map((mark) => mark.gag).sort()).toEqual(wanted);
    expect((await ppFx(page)).mischiefDecals).toBe(FIVE.length);
    // Each mess lies at its own anchor.
    for (const { id, anchor } of FIVE) {
      const [xM, , zM] = anchorOf(anchor);
      const mark = world.afterEffects.mischiefMarks.find(
        (candidate) => candidate.gag === defs[id].gag,
      );
      expect(mark?.xM).toBeCloseTo(xM, 2);
      expect(mark?.zM).toBeCloseTo(zM, 2);
    }
    await shot(page, testInfo, 'f-the-five-messes.png');
    // The level goes on to its end; the Soupir counts the mischiefs.
    for (let i = 0; i < 400 && (await html(page).getAttribute('data-pp-app')) === 'level'; i++) {
      await ppAdvance(page, 500);
    }
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    const scored = (await typesOf(page, 'LevelScored')) as unknown as { sighPoints: number }[];
    const end = await ppWorld(page);
    expect(end.mess.mischiefs).toBeGreaterThanOrEqual(FIVE.length);
    expect(scored[0]?.sighPoints).toBe(
      Math.round(
        Math.min(
          end.feel.mama.sighMaxPoints,
          end.mess.propsOnFloor * end.feel.mama.sighPerPropOnFloorPoints +
            end.mess.propsBroken * end.feel.mama.sighPerBrokenPropPoints +
            end.mess.mischiefs * end.feel.mama.sighPerMischiefPoints,
        ),
      ),
    );
    await expect(page.locator('.pp-result-panel .pp-score-row-sigh .pp-score-value')).toHaveText(
      String(end.feel.mama.sighMaxPoints - (scored[0]?.sighPoints ?? 0)),
      { timeout: 15_000 },
    );
    await shot(page, testInfo, 'h-the-result-soupir.png');
    expect(problems).toEqual([]);
  });
});
