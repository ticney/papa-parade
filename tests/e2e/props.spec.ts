import { expect, test } from '@playwright/test';
import { collectProblems } from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Light physics of the props (story 1.15), driven by the test API on a frozen level: a push, then
// steps by hand, then what the world and the events say. Chromium and WebKit both run Rapier's WASM
// (the autoplay spec compares both with Node's world hash). No screenshot, no `waitForTimeout`.
// The numbers of the push are the calibrated ones of the `prop_fall` golden; the feel is the live
// one, so the spec asserts what must hold for any sane tuning, not the exact impulses.

const LEVEL = 'salon_crawler';
const SEED = 42;
const DRAW_CALLS_MAX = 100;
/** The push of the golden scenario: along +x, off the coffee table. */
const PUSH_NS = 0.72;
/** Three seconds of sim time: the mug has left the table, hit the vase and come to the floor. */
const STEPS = 300;

test.describe('props', () => {
  test('a pushed mug falls, hits, ends on the floor, and WebKit and Chromium run Rapier without a problem', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);

    const before = await ppWorld(page);
    const mugBefore = before.props.find((prop) => prop.id === 'mug_01');
    expect(mugBefore).toBeDefined();
    expect(before.mess).toEqual({ propsOnFloor: 0, propsBroken: 0 });

    await ppSend(page, {
      type: 'PushProp',
      t: before.time.sim,
      propId: 'mug_01',
      impulseXNs: PUSH_NS,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    await ppAdvance(page, STEPS);

    const events = await ppEvents(page);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'PropImpact', propId: 'mug_01' }),
    );

    const after = await ppWorld(page);
    const mugAfter = after.props.find((prop) => prop.id === 'mug_01');
    expect(mugAfter?.xM).toBeGreaterThan(mugBefore?.xM ?? Number.POSITIVE_INFINITY);
    expect(mugAfter?.yM).toBeLessThan(mugBefore?.yM ?? Number.NEGATIVE_INFINITY);
    expect(mugAfter?.isOnFloor).toBe(true);
    expect(after.mess.propsOnFloor).toBeGreaterThanOrEqual(1);

    // The room still draws within budget with the props as pooled views.
    await expect
      .poll(async () => Number(await page.locator('html').getAttribute('data-pp-draw-calls')))
      .toBeGreaterThan(0);
    const drawCalls = Number(await page.locator('html').getAttribute('data-pp-draw-calls'));
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);

    expect(problems).toEqual([]);
  });

  test('a prop at rest emits nothing: a quiet room stays quiet for ten seconds', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/?threats=off');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await ppAdvance(page, 1000);
    const events = await ppEvents(page);
    expect(events.filter((event) => event.type.startsWith('Prop'))).toEqual([]);
    expect((await ppWorld(page)).mess).toEqual({ propsOnFloor: 0, propsBroken: 0 });
    expect(problems).toEqual([]);
  });
});
