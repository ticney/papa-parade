import { expect, type Page, test } from '@playwright/test';
import { collectProblems } from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The three threats of the prototype (story 1.16) on the live level, driven by the test API on a
// frozen level: steps by hand, then what the world, the DOM and the events say. Nothing answers, so
// every threat ends in its gag. Chromium and WebKit both run it. No screenshot, no `waitForTimeout`.

const LEVEL = 'salon_crawler';
const SEED = 42;
const DRAW_CALLS_MAX = 100;
/** One chunk of the wait loops: 250 ms of sim time. */
const CHUNK_STEPS = 25;
/** A wait loop gives up after 40 s of sim time: the live level plans all three within 20 s. */
const CHUNKS_MAX = 160;
/** The object that falls must hit something within this long of its gag, in sim ms. */
const FALL_WITHIN_MS = 1000;

/** Advances by chunks until `isDone(world)` holds; fails the test when it never does. */
async function advanceUntil(
  page: Page,
  what: string,
  isDone: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
): Promise<void> {
  for (let i = 0; i < CHUNKS_MAX; i++) {
    if (isDone(await ppWorld(page))) return;
    await ppAdvance(page, CHUNK_STEPS);
  }
  throw new Error(`never reached: ${what}`);
}

/** The paths drawn by the markers that are shown (not `display: none`), in DOM order. */
const shownGlyphs = (page: Page): Promise<(string | null)[]> =>
  page
    .locator('.pp-threat')
    .evaluateAll((elements) =>
      elements
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.querySelector('.pp-threat-icon path')?.getAttribute('d') ?? null),
    );

/** Advances to the telegraph of `defId` and returns the glyph of the one marker then shown. */
async function glyphWhenTelegraphed(page: Page, defId: string): Promise<string> {
  await advanceUntil(page, `${defId} is telegraphed`, (world) => {
    const threat = world.threats.find((candidate) => candidate.defId === defId);
    return threat?.state === 'telegraph' || threat?.state === 'windowOpen';
  });
  // The marker is drawn on the next rendered frame (the frozen level renders on).
  await expect.poll(async () => (await shownGlyphs(page)).length).toBe(1);
  const [glyph] = await shownGlyphs(page);
  if (glyph === null || glyph === undefined) throw new Error(`no glyph shown for ${defId}`);
  return glyph;
}

const threatOf = (world: Awaited<ReturnType<typeof ppWorld>>, defId: string) =>
  world.threats.find((threat) => threat.defId === defId);

test.describe('the three threats', () => {
  test('the stairs and the coffee-table object are telegraphed with their own glyph and end in their gags', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);

    // The live level plans all three, the outlet first.
    const planned = await ppWorld(page);
    expect(planned.threats.map((threat) => threat.defId)).toEqual([
      'outlet',
      'stairs',
      'coffee_table_object',
    ]);

    // Each threat is telegraphed with its own glyph: the one marker shown draws the path of its icon.
    const outletGlyph = await glyphWhenTelegraphed(page, 'outlet');
    const stairsGlyph = await glyphWhenTelegraphed(page, 'stairs');
    const stairsIndex = planned.threats.findIndex((threat) => threat.defId === 'stairs');

    // Nothing answers: the stairs ends in its gag, a near miss at the same step.
    await advanceUntil(
      page,
      'the stairs gags',
      (world) => threatOf(world, 'stairs')?.state === 'gag',
    );
    const stairsEvents = await ppEvents(page);
    const stairsGag = stairsEvents.find(
      (event) => event.type === 'GagTriggered' && event.gag === 'stairs_slide',
    );
    expect(stairsGag).toBeDefined();
    expect(stairsEvents).toContainEqual(
      expect.objectContaining({
        type: 'NearMiss',
        gag: 'stairs_slide',
        t: stairsGag?.t,
        threatId: stairsIndex + 1,
      }),
    );
    await expect(page.locator('html')).toHaveAttribute('data-pp-gag', 'stairs_slide');

    // The coffee-table object: telegraphed with the mug, then it falls (the mug hits something within a second).
    const mugGlyph = await glyphWhenTelegraphed(page, 'coffee_table_object');
    expect(new Set([outletGlyph, stairsGlyph, mugGlyph]).size).toBe(3);
    await advanceUntil(
      page,
      'the coffee table gags',
      (world) => threatOf(world, 'coffee_table_object')?.state === 'gag',
    );
    // Run on until the mug has had time to land.
    await ppAdvance(page, FALL_WITHIN_MS / 10);
    const events = await ppEvents(page);
    const tableGag = events.find(
      (event) => event.type === 'GagTriggered' && event.gag === 'table_object_fall',
    );
    expect(tableGag).toBeDefined();
    await expect(page.locator('html')).toHaveAttribute('data-pp-gag', 'table_object_fall');
    const gagAt = tableGag?.t ?? 0;
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'PropImpact', propId: 'mug_01' }),
    );
    const mugImpacts = events.filter(
      (event) => event.type === 'PropImpact' && event.propId === 'mug_01' && event.t >= gagAt,
    );
    expect(mugImpacts.length).toBeGreaterThan(0);
    expect(Math.min(...mugImpacts.map((event) => event.t)) - gagAt).toBeLessThanOrEqual(
      FALL_WITHIN_MS,
    );
    // The stairs' near miss is the only one: the table gag is no near miss.
    expect(events.filter((event) => event.type === 'NearMiss')).toHaveLength(1);

    await expect
      .poll(async () => Number(await page.locator('html').getAttribute('data-pp-draw-calls')))
      .toBeGreaterThan(0);
    const drawCalls = Number(await page.locator('html').getAttribute('data-pp-draw-calls'));
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);

    expect(problems).toEqual([]);
  });
});
