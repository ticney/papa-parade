import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { STEP_MS } from '../../src/shared/constants.ts';
import { collectProblems, liveWaves } from './support/game.ts';
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
// Since story 1.18 the outlet and the stairs come in the first wave in the order the PRNG draws,
// and the coffee table only from the second wave: every bound comes from the live waves.

const LEVEL = 'salon_crawler';
const SEED = 42;
const DRAW_CALLS_MAX = 100;
/** One chunk of the wait loops: 250 ms of sim time. */
const CHUNK_STEPS = 25;
const CHUNK_MS = CHUNK_STEPS * STEP_MS;
/** The second wave is where the coffee table joins the pool (waves are cumulative). */
const secondWave = liveWaves[1];
if (secondWave === undefined) throw new Error('the live level has no second wave');
/** A wait loop gives up this far past the start of the second wave: a few gaps and cooldowns. */
const WAIT_SLACK_MS = 40_000;
const CHUNKS_MAX = Math.ceil((secondWave.fromMs + WAIT_SLACK_MS) / CHUNK_MS);
/** The object that falls must hit something within this long of its gag, in sim ms. */
const FALL_WITHIN_MS = 1000;
/** Two markers at different anchors are at least this far apart on the screen, in px. */
const MARKERS_APART_PX = 20;

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

/** A marker that is shown: the path of its glyph and where it is on the screen, in px. */
interface ShownMarker {
  glyph: string | null;
  xPx: number;
  yPx: number;
}

/** The markers that are shown (not `display: none`), in DOM order. */
const shownMarkers = (page: Page): Promise<ShownMarker[]> =>
  page.locator('.pp-threat').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          glyph: element.querySelector('.pp-threat-icon path')?.getAttribute('d') ?? null,
          xPx: box.x + box.width / 2,
          yPx: box.y + box.height / 2,
        };
      }),
  );

/**
 * Advances to the telegraph of `defId` and returns its marker: the one shown with its glyph (in
 * the second wave two threats may be on screen at once).
 */
async function markerWhenTelegraphed(
  page: Page,
  defId: string,
  glyph: string,
): Promise<ShownMarker> {
  await advanceUntil(page, `${defId} is telegraphed`, (world) => {
    const threat = world.threats.find((candidate) => candidate.defId === defId);
    return threat?.state === 'telegraph' || threat?.state === 'windowOpen';
  });
  // The marker is drawn on the next rendered frame (the frozen level renders on).
  await expect
    .poll(async () => (await shownMarkers(page)).filter((m) => m.glyph === glyph).length)
    .toBe(1);
  const marker = (await shownMarkers(page)).find((candidate) => candidate.glyph === glyph);
  if (marker === undefined) throw new Error(`no glyph shown for ${defId}`);
  return marker;
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

    // The live level plans all three: the instances are in order of first appearance in the waves.
    const planned = await ppWorld(page);
    expect(planned.threats.map((threat) => threat.defId)).toEqual([
      'outlet',
      'stairs',
      'coffee_table_object',
    ]);

    // Each threat is telegraphed with its own glyph (the def's icon), at its own anchor: the one
    // marker shown draws the path of its icon, and the markers are not on the same spot.
    const outletMarker = await markerWhenTelegraphed(page, 'outlet', THREAT_ICON_PATHS.bolt);
    const stairsMarker = await markerWhenTelegraphed(page, 'stairs', THREAT_ICON_PATHS.stairs);
    expect(
      Math.hypot(stairsMarker.xPx - outletMarker.xPx, stairsMarker.yPx - outletMarker.yPx),
    ).toBeGreaterThan(MARKERS_APART_PX);
    const stairsThreat = planned.threats.find((threat) => threat.defId === 'stairs');

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
        threatId: stairsThreat?.id,
      }),
    );
    await expect(page.locator('html')).toHaveAttribute('data-pp-gag', 'stairs_slide');

    // The coffee-table object: telegraphed with the mug, then it falls (the mug hits something within a second).
    const mugMarker = await markerWhenTelegraphed(
      page,
      'coffee_table_object',
      THREAT_ICON_PATHS.mug,
    );
    expect(mugMarker.glyph).toBe(THREAT_ICON_PATHS.mug);
    await advanceUntil(
      page,
      'the coffee table gags',
      (world) => threatOf(world, 'coffee_table_object')?.state === 'gag',
    );
    // Run on until the mug has had time to land.
    await ppAdvance(page, FALL_WITHIN_MS / STEP_MS);
    const events = await ppEvents(page);
    const tableGag = events.find(
      (event) => event.type === 'GagTriggered' && event.gag === 'table_object_fall',
    );
    expect(tableGag).toBeDefined();
    await expect(page.locator('html')).toHaveAttribute('data-pp-gag', 'table_object_fall');
    const gagAt = tableGag?.t ?? 0;
    const mugImpacts = events.filter(
      (event) => event.type === 'PropImpact' && event.propId === 'mug_01' && event.t >= gagAt,
    );
    expect(mugImpacts.length).toBeGreaterThan(0);
    expect(Math.min(...mugImpacts.map((event) => event.t)) - gagAt).toBeLessThanOrEqual(
      FALL_WITHIN_MS,
    );
    // The table gag is no near miss: every near miss of the run is the stairs', none at its step.
    const nearMisses = events.filter((event) => event.type === 'NearMiss');
    expect(nearMisses.length).toBeGreaterThan(0);
    for (const nearMiss of nearMisses) expect(nearMiss.gag).toBe('stairs_slide');
    expect(nearMisses.filter((nearMiss) => nearMiss.t === gagAt)).toEqual([]);

    await expect
      .poll(async () => Number(await page.locator('html').getAttribute('data-pp-draw-calls')))
      .toBeGreaterThan(0);
    const drawCalls = Number(await page.locator('html').getAttribute('data-pp-draw-calls'));
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);

    expect(problems).toEqual([]);
  });
});
