import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { collectProblems, html, startLevel, waitFrames } from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppWorld,
} from './support/testApi.ts';

// The séquelles of the gags (story 3.15) on the live level, driven by the test API on a frozen level: the
// outlet's shock and pénombre, the baby left downstairs and fetched, the debris picked up and stepped on, the
// mess a silence leaves. The durations come from the threats' JSON, never from a literal. Since the live
// first wave draws one threat at a time, 4 to 7 s apart, and none while the baby is not free, a forced threat
// at the start has the room to itself for the time each test needs.

const LEVEL = 'salon_crawler';
const SEED = 42;
const BUBBLE = '.pp-activity-bubble';

type World = Awaited<ReturnType<typeof ppWorld>>;
const effectOf = <T extends Record<string, number | string>>(defId: string): T =>
  (
    JSON.parse(readFileSync(`content/threats/${defId}.json`, 'utf8')) as {
      afterEffect: T;
    }
  ).afterEffect;
const ELECTRIFIED = effectOf<{ busyMs: number; dimMs: number }>('outlet');
const DOWNSTAIRS = effectOf<{ carryUpMs: number; selfReturnMs: number }>('stairs');
const DEBRIS = effectOf<{ pickUpMs: number }>('coffee_table_object');
const DIM = (
  JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
    fx: { dim: { lightsPct: number; fadeMs: number } };
  }
).fx.dim;

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Advances step by step until `isDone(world)`; fails when `boundMs` of sim time passed first. */
async function advanceUntil(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (world: World) => boolean,
  stepsPerCall = 5,
): Promise<World> {
  const startMs = (await ppWorld(page)).time.sim;
  for (;;) {
    const world = await ppWorld(page);
    if (isDone(world)) return world;
    if (world.time.sim - startMs > boundMs)
      throw new Error(`${what} did not happen in ${boundMs} ms`);
    await ppAdvance(page, stepsPerCall);
  }
}

/** Forces the threat of `defId` and lets nobody answer it: returns the world at the step it gags. */
async function forceGag(page: Page, defId: string): Promise<World> {
  const world = await ppWorld(page);
  const threat = world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`no threat ${defId}`);
  await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
  return advanceUntil(
    page,
    `${defId} gags`,
    10_000,
    (w) => w.threats.find((candidate) => candidate.defId === defId)?.state === 'gag',
    1,
  );
}

/**
 * Whatever the world UI is drawn with, for every element of `#pp-world` that is shown and every ancestor of
 * the layer: its computed opacity and filter. A pénombre that dimmed, filtered or covered the markers would
 * show here.
 */
const worldUiStyles = (page: Page) =>
  page.evaluate(() => {
    const rows: { what: string; opacity: string; filter: string }[] = [];
    const record = (what: string, element: Element) => {
      const style = getComputedStyle(element);
      rows.push({ what, opacity: style.opacity, filter: style.filter });
    };
    const layer = document.querySelector('#pp-world');
    for (let node: Element | null = layer; node !== null; node = node.parentElement) {
      record(`ancestor ${node.tagName.toLowerCase()}#${node.id}`, node);
    }
    for (const selector of [
      '.pp-threat',
      '.pp-activity-bubble',
      '.pp-threat-verb',
      '.pp-tidy-marker',
    ]) {
      for (const element of layer?.querySelectorAll(selector) ?? []) {
        if (getComputedStyle(element).display === 'none') continue;
        record(selector, element);
      }
    }
    return rows;
  });

test.describe('the outlet: electrified and a pénombre', () => {
  test('shocks Papa for busyMs behind a stars bubble, and the room stays dim for dimMs', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    expect((await ppFx(page)).lightsFactor).toBe(1);
    await expect(html(page)).toHaveAttribute('data-pp-dim', 'off');

    const gagged = await forceGag(page, 'outlet');
    const startedAt = gagged.time.sim;
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'electrified');
    expect(gagged.papa.busyUntil - gagged.papa.enteredAt).toBe(ELECTRIFIED.busyMs);
    expect(gagged.afterEffects.dimUntil - startedAt).toBe(ELECTRIFIED.dimMs);
    await expect(html(page)).toHaveAttribute('data-pp-dim', 'on');
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toBeVisible();
    await expect(page.locator(BUBBLE)).toHaveClass(/pp-activity-bubble--stars/);

    // The lights fade to lightsPct over fadeMs, and only they.
    await ppAdvance(page, Math.ceil((DIM.fadeMs * 2) / STEP_MS));
    await waitFrames(page, 3);
    expect((await ppFx(page)).lightsFactor).toBeCloseTo(DIM.lightsPct / 100, 2);

    // Past busyUntil Papa is free and the bubble is gone, the room still dim.
    await advanceUntil(
      page,
      'the end of the shock',
      ELECTRIFIED.busyMs,
      (w) => w.papa.state === 'idle',
    );
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toBeHidden();
    await expect(html(page)).toHaveAttribute('data-pp-dim', 'on');
    expect((await ppWorld(page)).time.sim - startedAt).toBeLessThan(ELECTRIFIED.dimMs);

    // The pénombre ends at dimUntil, and the light comes back over fadeMs.
    await advanceUntil(
      page,
      'the end of the pénombre',
      ELECTRIFIED.dimMs,
      (w) => w.afterEffects.dimUntil === 0,
    );
    await expect(html(page)).toHaveAttribute('data-pp-dim', 'off');
    await ppAdvance(page, Math.ceil((DIM.fadeMs * 2) / STEP_MS));
    await waitFrames(page, 3);
    expect((await ppFx(page)).lightsFactor).toBe(1);
    expect(problems).toEqual([]);
  });

  test('never dims, filters or covers the world UI: a marker up during the pénombre is drawn as outside it', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await waitFrames(page, 3);
    const outside = await worldUiStyles(page);
    // The layer and its ancestors, outside the pénombre: the reference.
    expect(outside.length).toBeGreaterThan(0);

    await forceGag(page, 'outlet');
    // A threat telegraphed during the pénombre, with Papa busy behind his bubble.
    const coffee = (await ppWorld(page)).threats.find((t) => t.defId === 'coffee_table_object');
    await ppSend(page, { type: 'ForceThreat', threatId: coffee?.id ?? -1 });
    await advanceUntil(page, 'the telegraph', 2000, (w) =>
      w.threats.some((t) => t.defId === 'coffee_table_object' && t.state === 'telegraph'),
    );
    await ppAdvance(page, Math.ceil((DIM.fadeMs * 2) / STEP_MS));
    await waitFrames(page, 4);
    await expect(html(page)).toHaveAttribute('data-pp-dim', 'on');
    expect((await ppFx(page)).lightsFactor).toBeLessThan(1);

    const during = await worldUiStyles(page);
    const shown = (rows: typeof during) => rows.filter((row) => !row.what.startsWith('ancestor'));
    expect(shown(during).map((row) => row.what)).toEqual(
      expect.arrayContaining(['.pp-threat', '.pp-activity-bubble']),
    );
    // Same ancestors, same values as outside the pénombre...
    const ancestors = (rows: typeof during) =>
      rows.filter((row) => row.what.startsWith('ancestor'));
    expect(ancestors(during)).toEqual(ancestors(outside));
    // ...and every marker fully opaque and unfiltered.
    for (const row of shown(during)) {
      expect(row, row.what).toMatchObject({ opacity: '1', filter: 'none' });
    }
    // The picture of it (macOS only, like the autoplay frame): a dim room, the marker and the bubble as bright as ever.
    if (process.platform === 'darwin')
      await expect(page).toHaveScreenshot('penombre-threat-up.png');
    expect(problems).toEqual([]);
  });
});

test.describe('the stairs: the baby at the bottom', () => {
  test('is left downstairs, fetched by a tap on him, carried up for carryUpMs, and is back babbling', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await forceGag(page, 'stairs');
    const down = await ppWorld(page);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'downstairs');
    expect(down.baby.downstairsUntil).toBe(down.time.sim + DOWNSTAIRS.selfReturnMs);

    // Not free: a few seconds on, he is still down and nothing was drawn that needs him.
    await ppAdvance(page, 100);
    expect((await ppWorld(page)).baby.state).toBe('downstairs');

    await advanceUntil(page, 'Papa is free', 5000, (w) => w.papa.state === 'idle');
    await ppSend(page, { type: 'TapBaby' });
    const carrying = await advanceUntil(
      page,
      'the carry up',
      15_000,
      (w) => w.papa.state === 'carryingUp',
    );
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'carryingUp');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carriedUp');
    expect(carrying.papa.busyUntil - carrying.papa.enteredAt).toBe(DOWNSTAIRS.carryUpMs);
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toHaveClass(/pp-activity-bubble--stars/);

    await advanceUntil(
      page,
      'the end of the carry',
      DOWNSTAIRS.carryUpMs + 200,
      (w) => w.papa.state === 'idle',
    );
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble');
    const kinds = (await ppEvents(page))
      .filter((event) => event.type === 'AfterEffectStarted' || event.type === 'AfterEffectEnded')
      .map((event) => `${event.type}:${(event as { kind: string }).kind}`);
    expect(kinds).toEqual([
      'AfterEffectStarted:babyDownstairs',
      'AfterEffectEnded:babyDownstairs',
      'AfterEffectStarted:carryUp',
      'AfterEffectEnded:carryUp',
    ]);
    expect(problems).toEqual([]);
  });

  test('climbs back by himself at selfReturnMs when nobody comes', async ({ page }) => {
    await openFrozen(page);
    await forceGag(page, 'stairs');
    const until = (await ppWorld(page)).baby.downstairsUntil as number;
    await advanceUntil(
      page,
      'the self-return',
      DOWNSTAIRS.selfReturnMs + 500,
      (w) => w.baby.state !== 'downstairs',
    );
    // The end is told at the very step the baby comes back.
    const ended = (await ppEvents(page)).find(
      (event) => event.type === 'AfterEffectEnded' && event.kind === 'babyDownstairs',
    );
    expect(ended?.t).toBe(until);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble');
  });
});

test.describe('the coffee table: the debris', () => {
  test('stays on the floor with its marker until Papa picks it up in pickUpMs; a step on it makes a noise', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await forceGag(page, 'coffee_table_object');
    await advanceUntil(page, 'the mug lands', 4000, (w) =>
      w.props.some((prop) => prop.id === 'mug_01' && prop.isMess),
    );
    await advanceUntil(page, 'Papa is free', 5000, (w) => w.papa.state === 'idle');
    await waitFrames(page, 4);
    // The marker of the rush is there outside the rush, over the debris.
    await expect(page.locator('.pp-tidy-marker:visible')).toHaveCount(1);

    // Walking onto it is a step on it: the event, its cue and the noise, once.
    const mug = (await ppWorld(page)).props.find((prop) => prop.id === 'mug_01');
    const noiseBefore = (await ppWorld(page)).gauges.noisePct;
    await ppSend(page, { type: 'TapFloor', xM: mug?.xM ?? 0, zM: mug?.zM ?? 0 });
    await advanceUntil(page, 'the step', 6000, (w) => w.afterEffects.steppedDebrisIndex >= 0);
    const events = await ppEvents(page);
    expect(events.filter((event) => event.type === 'DebrisSteppedOn')).toHaveLength(1);
    expect((await ppCueLog(page)).map((entry) => entry.cueId)).toContain('debris_stepped');
    expect((await ppWorld(page)).gauges.noisePct).toBeGreaterThan(noiseBefore);

    // A tap on it: Papa walks there, picks it up for pickUpMs behind a hand, and it is tidied.
    await advanceUntil(page, 'Papa is free', 6000, (w) => w.papa.state === 'idle');
    await ppSend(page, { type: 'TapObject', objectId: 'mug_01' });
    const picking = await advanceUntil(
      page,
      'the pick-up',
      8000,
      (w) => w.papa.state === 'pickingUp',
    );
    expect(picking.papa.busyUntil - picking.papa.enteredAt).toBe(DEBRIS.pickUpMs);
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toHaveClass(/pp-activity-bubble--hand/);
    await advanceUntil(page, 'the tidy', DEBRIS.pickUpMs + 200, (w) => w.papa.state === 'idle');
    const after = await ppWorld(page);
    expect(after.props.find((prop) => prop.id === 'mug_01')?.isMess).toBe(false);
    expect(after.mess.propsOnFloor).toBe(0);
    await waitFrames(page, 3);
    await expect(page.locator('.pp-tidy-marker:visible')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

test.describe('the silence: the mess that stays', () => {
  test('leaves a decal at the mischief, kept for the rest of the level', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const silence = (await ppWorld(page)).threats.find((t) => t.defId === 'silence_mischief');
    await ppSend(page, { type: 'ForceThreat', threatId: silence?.id ?? -1 });
    await advanceUntil(page, 'the mischief', 12_000, (w) => w.mess.mischiefs === 1);
    const world = await ppWorld(page);
    expect(world.afterEffects.mischiefMarks).toHaveLength(1);
    await waitFrames(page, 3);
    expect((await ppFx(page)).mischiefDecals).toBe(1);
    await ppAdvance(page, 1000);
    await waitFrames(page, 3);
    expect((await ppFx(page)).mischiefDecals).toBe(1);
    expect(problems).toEqual([]);
  });
});
