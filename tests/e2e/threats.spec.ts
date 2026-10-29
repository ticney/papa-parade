import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { DRAW_CALLS_MAX, STEP_MS, VERB_MIN_FONT_PX } from '../../src/shared/constants.ts';
import {
  collectProblems,
  GEOMETRY_URL,
  liveThreat,
  liveWaves,
  waitFrames,
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

/** The player-facing strings, read from the file (a verb is never hard-coded in a spec). */
const STRINGS = JSON.parse(readFileSync('content/strings.fr.json', 'utf8')) as Record<
  string,
  string
>;

// The three threats of the prototype (story 1.16) on the live level, driven by the test API on a
// frozen level: steps by hand, then what the world, the DOM and the events say. Nothing answers, so
// every threat ends in its gag. Chromium and WebKit both run it. No screenshot, no `waitForTimeout`.
// Since story 1.18 the outlet and the stairs come in the first wave in the order the PRNG draws,
// and the coffee table only from the second wave: every bound comes from the live waves.

const LEVEL = 'salon_crawler';
const SEED = 42;
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

    // The live level plans all three, and since story 1.21 the suspicious silence in its second wave:
    // the instances are in order of first appearance in the waves. Since story 1.19 the level's
    // micro-sleep (the threat on Papa, planned by no wave) comes last.
    const planned = await ppWorld(page);
    expect(planned.threats.map((threat) => threat.defId)).toEqual([
      'outlet',
      'stairs',
      'coffee_table_object',
      'silence_mischief',
      'papa_microsleep',
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

// ---------------------------------------------------------------------------------------------
// Story 2.2: the verb above each threat, the shape and colour of its icon, the overlap of verbs.
// ---------------------------------------------------------------------------------------------

/** What a shown marker draws of its verb and icon, as the browser computed it. */
interface ShownVerb {
  glyph: string | null;
  text: string | null;
  fontPx: number;
  textOverflow: string;
  overflow: string;
  whiteSpace: string;
  isTriangle: boolean;
  iconRadius: string;
  zIndex: number;
  /** The offset the layout wrote on the verb stack (`--pp-verb-offset`); empty while it never pushed it. */
  offset: string;
  iconCenterXPx: number;
  verb: { x: number; y: number; width: number; height: number } | null;
}

/** The markers that are shown, with their verb's box and computed style. */
const shownVerbs = (page: Page): Promise<ShownVerb[]> =>
  page.locator('.pp-threat').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => {
        const verb = element.querySelector('.pp-threat-verb');
        const icon = element.querySelector('.pp-threat-icon') as Element;
        const style = verb === null ? null : getComputedStyle(verb);
        const rect = verb?.getBoundingClientRect() ?? null;
        const iconRect = icon.getBoundingClientRect();
        return {
          glyph: icon.querySelector('path')?.getAttribute('d') ?? null,
          text: verb?.textContent ?? null,
          fontPx: Number.parseFloat(style?.fontSize ?? '0'),
          textOverflow: style?.textOverflow ?? '',
          overflow: style?.overflow ?? '',
          whiteSpace: style?.whiteSpace ?? '',
          isTriangle: icon.classList.contains('pp-threat-icon--triangle'),
          iconRadius: getComputedStyle(icon).borderRadius,
          zIndex: Number(getComputedStyle(element).zIndex),
          offset: (
            element.querySelector('.pp-threat-verb-stack') as HTMLElement
          ).style.getPropertyValue('--pp-verb-offset'),
          iconCenterXPx: iconRect.x + iconRect.width / 2,
          verb:
            rect === null ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }),
  );

/** Opens a frozen level with no start gesture: silent, as an agent's run is. */
async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Starts the idle instance of `defId` now and steps once: it is telegraphed, and drawn a frame later. */
async function forceThreat(page: Page, defId: string): Promise<number> {
  const threat = threatOf(await ppWorld(page), defId);
  if (threat === undefined) throw new Error(`the level does not plan ${defId}`);
  await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
  await ppAdvance(page, 1);
  return threat.id;
}

test.describe('the verb and the icon of a threat (story 2.2)', () => {
  for (const defId of ['outlet', 'stairs', 'coffee_table_object']) {
    test(`${defId}: its verb is shown whole, at 28 px or more, above a circle icon`, async ({
      page,
    }) => {
      const problems = collectProblems(page);
      await openFrozen(page);
      const def = liveThreat(defId);
      if (def.verbKey === null) throw new Error(`${defId} has no verbKey`);
      const expected = STRINGS[def.verbKey];
      expect(expected, `${def.verbKey} is in strings.fr.json`).toBeTruthy();
      await forceThreat(page, defId);
      await waitFrames(page, 2);
      const [shown, ...others] = await shownVerbs(page);
      expect(others).toEqual([]);
      expect(shown?.text).toBe(expected);
      expect(shown?.fontPx).toBeGreaterThanOrEqual(VERB_MIN_FONT_PX);
      // A circle: no triangle modifier, a round border.
      expect(shown?.isTriangle).toBe(false);
      expect(shown?.iconRadius).toMatch(/50%/);
      // Shown whole: no ellipsis, no clipping, no wrapping inside the label.
      expect(shown?.textOverflow).not.toBe('ellipsis');
      expect(shown?.overflow).not.toBe('hidden');
      expect(shown?.whiteSpace).toBe('nowrap');
      expect(problems).toEqual([]);
    });
  }

  test('the verb goes with its icon: it is gone once the threat is not active', async ({
    page,
  }) => {
    await openFrozen(page);
    const id = await forceThreat(page, 'outlet');
    await waitFrames(page, 2);
    expect(await shownVerbs(page)).toHaveLength(1);
    // Nothing answers: the threat ends, and the marker (verb included) is hidden with it.
    for (let i = 0; i < CHUNKS_MAX; i++) {
      const threat = (await ppWorld(page)).threats.find((candidate) => candidate.id === id);
      if (threat?.state === 'gag' || threat?.state === 'resolved') break;
      await ppAdvance(page, CHUNK_STEPS);
    }
    await waitFrames(page, 2);
    expect(await shownVerbs(page)).toEqual([]);
  });

  test('the micro-sleep verb follows Papa like its icon', async ({ page }) => {
    await openFrozen(page);
    // The sim spawns it above the fatigue threshold (`ForceThreat` ignores a threat on Papa).
    await ppSend(page, { type: 'SetFatigue', points: 90 });
    for (let i = 0; i < CHUNKS_MAX; i++) {
      const events = await ppEvents(page);
      if (events.some((e) => e.type === 'ThreatTelegraphed' && e.kind === 'papa_microsleep')) break;
      await ppAdvance(page, CHUNK_STEPS);
    }
    await ppAdvance(page, 1);
    await waitFrames(page, 2);
    const [before] = await shownVerbs(page);
    expect(before?.text).toBe(STRINGS[liveThreat('papa_microsleep').verbKey ?? '']);
    if (before?.verb === null || before === undefined) throw new Error('no verb shown');
    // The verb is centred over the icon.
    expect(Math.abs(before.verb.x + before.verb.width / 2 - before.iconCenterXPx)).toBeLessThan(2);
    // Papa walks away: the icon moves, and the verb with it.
    const papa = (await ppWorld(page)).papa;
    await ppSend(page, { type: 'TapFloor', xM: papa.xM - 3, zM: papa.zM - 1 });
    await ppAdvance(page, 60);
    await waitFrames(page, 2);
    const [after] = await shownVerbs(page);
    if (after?.verb === null || after === undefined) throw new Error('no verb shown');
    expect(Math.abs(after.iconCenterXPx - before.iconCenterXPx)).toBeGreaterThan(20);
    expect(Math.abs(after.verb.x + after.verb.width / 2 - after.iconCenterXPx)).toBeLessThan(2);
  });
});

test.describe('verbs of simultaneous threats (story 2.2)', () => {
  /**
   * The live geometry with the stairs' anchor moved 20 cm from the outlet's (an anchor is planned once, so
   * two threats cannot share one): the two icons, and their verbs, overlap on screen.
   */
  async function serveStairsNextToTheOutlet(page: Page): Promise<void> {
    const geometry = JSON.parse(
      readFileSync('content/levels/salon_crawler.geometry.json', 'utf8'),
    ) as { anchors: { id: string; positionM: [number, number, number] }[] };
    const outlet = geometry.anchors.find((anchor) => anchor.id === 'outlet_01');
    const stairs = geometry.anchors.find((anchor) => anchor.id === 'stairs_top');
    if (outlet === undefined || stairs === undefined) throw new Error('the anchors moved');
    stairs.positionM = [outlet.positionM[0] + 0.2, outlet.positionM[1], outlet.positionM[2]];
    await page.route(GEOMETRY_URL, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export default ${JSON.stringify(JSON.stringify(geometry))};`,
      }),
    );
  }

  test('overlapping verbs are offset so none covers another, and the most urgent is in front', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await serveStairsNextToTheOutlet(page);
    await openFrozen(page);
    await forceThreat(page, 'outlet');
    await forceThreat(page, 'stairs');
    await waitFrames(page, 3);

    // The most urgent threat is the one whose window closes first, ties to the lower id.
    const world = await ppWorld(page);
    const closeAt = (defId: string): number => {
      const threat = threatOf(world, defId);
      if (threat?.responseWindow == null) throw new Error(`${defId} has no window`);
      return threat.windowOpenAt + threat.responseWindow.windowMs;
    };
    const outletId = threatOf(world, 'outlet')?.id ?? 0;
    const stairsId = threatOf(world, 'stairs')?.id ?? 0;
    const isOutletFirst =
      closeAt('outlet') < closeAt('stairs') ||
      (closeAt('outlet') === closeAt('stairs') && outletId < stairsId);

    const shown = await shownVerbs(page);
    expect(shown).toHaveLength(2);
    const outlet = shown.find((marker) => marker.glyph === THREAT_ICON_PATHS.bolt);
    const stairs = shown.find((marker) => marker.glyph === THREAT_ICON_PATHS.stairs);
    if (outlet?.verb == null || stairs?.verb == null) throw new Error('a verb is missing');
    const [urgent, other] = isOutletFirst ? [outlet, stairs] : [stairs, outlet];
    if (urgent.verb === null || other.verb === null) throw new Error('a verb is missing');

    // No overlap: the boxes do not intersect.
    const a = urgent.verb;
    const b = other.verb;
    const isOverlapping =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(isOverlapping).toBe(false);
    // The less urgent verb was pushed up, never down.
    expect(b.y + b.height).toBeLessThanOrEqual(a.y);
    // The most urgent marker is in front, and stayed where it was; the other one went up.
    expect(urgent.zIndex).toBeGreaterThan(other.zIndex);
    expect(urgent.offset).toBe('');
    expect(Number.parseFloat(other.offset)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('verbs of threats far apart on screen are left where they are', async ({ page }) => {
    await openFrozen(page);
    await forceThreat(page, 'outlet');
    await forceThreat(page, 'stairs');
    await waitFrames(page, 3);
    const shown = await shownVerbs(page);
    expect(shown).toHaveLength(2);
    // Nothing overlaps, so the layout never pushed either of them.
    expect(shown.map((marker) => marker.offset)).toEqual(['', '']);
  });
});
