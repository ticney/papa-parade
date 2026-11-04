import { expect, type Page, test } from '@playwright/test';
import { HUD_MAX_DOM_NODES } from '../../src/shared/constants.ts';
import { typesOf } from './support/duel.ts';
import {
  collectProblems,
  html,
  OWN_WARNINGS,
  startLevel,
  stepToFirstTelegraph,
  threatIconPoint,
  waitFrames,
} from './support/game.ts';
import {
  type OffscreenBubbleMirror,
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppOffscreen,
  ppSend,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The off-screen bubble (story 9.3) in the big room, on a frozen level stepped by hand. Today's
// `salon_kitchen` threats leave the frame on a 4:3 screen (the stairs, Papa at the kitchen end) or with
// a tighter follow frame (`setFeel`), never on a landscape phone with the live feel: the tests make it
// happen on purpose, `ForceThreat` starting the threats they need. Chromium only.

const LEVEL = 'salon_kitchen';
const SEED = 42;
/** The kitchen end, far from the stairs. */
const KITCHEN_END = [-5.5, -1.5] as const;
/**
 * The tightest follow frame `feel.camera` allows (metres): on a landscape phone the outlet, the coffee
 * table and the stairs then leave it on the right or below, Papa at the kitchen end (the camera stands
 * against the kitchen wall, so his exact spot barely moves them).
 */
const TIGHT_FRAME = { frameWidthM: 3, frameDepthM: 3 };
/** The HUD inset at the screen edges, in CSS px (`--pp-spacing-hud-inset-*` without a safe area). */
const HUD_INSET_PX = 12;

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (story 9.3)');

type ThreatView = Awaited<ReturnType<typeof ppWorld>>['threats'][number];

async function openFrozen(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/?level=${LEVEL}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await waitFrames(page, 2);
}

/** Walks Papa to `(xM, zM)` through `__PP__`, a frame between steps so the camera follows, then lets it settle. */
async function walkTo(page: Page, xM: number, zM: number): Promise<void> {
  await ppSend(page, { type: 'TapFloor', xM, zM });
  // Until he stops (the nearest reachable point if that one is not): before the first wave telegraphs.
  for (let i = 0; i < 300; i++) {
    await ppAdvance(page, 10);
    await waitFrames(page, 1);
    if ((await ppWorld(page)).papa.state === 'idle') break;
  }
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

async function threatOf(page: Page, defId: string): Promise<ThreatView> {
  const threat = (await ppWorld(page)).threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`the level plans no ${defId}`);
  return threat;
}

/** Forces the threats and steps until each telegraphs (the follow is still: Papa stands). */
async function force(page: Page, ...defIds: string[]): Promise<ThreatView[]> {
  const forced: ThreatView[] = [];
  for (const defId of defIds) {
    const threat = await threatOf(page, defId);
    await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
    forced.push(threat);
  }
  await ppAdvance(page, 2);
  await waitFrames(page, 3);
  return forced;
}

const bubbles = (page: Page) => page.locator('.pp-offscreen-bubble');
const nodes = (page: Page) => page.evaluate(() => document.querySelectorAll('#pp-hud *').length);

/** The bubble's outer radius on this screen (its disc and chevron), read from the page's custom properties. */
async function outerRadiusPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const px = (name: string) => Number.parseFloat(style.getPropertyValue(name));
    return px('--pp-offscreen-disc') + px('--pp-offscreen-chevron');
  });
}

/** Every bubble keeps out of the bottom third, under the HUD row, inside the insets; two keep the gap. */
async function expectPlacedWell(page: Page, shown: OffscreenBubbleMirror[]): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport');
  const radius = await outerRadiusPx(page);
  const row = await page.locator('.pp-hud-row').boundingBox();
  if (row === null) throw new Error('no HUD row');
  for (const bubble of shown) {
    expect(bubble.yPx + radius).toBeLessThanOrEqual((viewport.height * 2) / 3 + 0.5);
    expect(bubble.yPx - radius).toBeGreaterThanOrEqual(row.y + row.height - 0.5);
    expect(bubble.xPx - radius).toBeGreaterThanOrEqual(HUD_INSET_PX - 0.5);
    expect(bubble.xPx + radius).toBeLessThanOrEqual(viewport.width - HUD_INSET_PX + 0.5);
  }
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i] as OffscreenBubbleMirror;
      const b = shown[j] as OffscreenBubbleMirror;
      expect(Math.hypot(a.xPx - b.xPx, a.yPx - b.yPx)).toBeGreaterThanOrEqual(2 * radius + 8 - 1);
    }
  }
  // The drawn boxes (discs, without the chevron) agree with the mirror and never overlap.
  const boxes = await bubbles(page).evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect),
  );
  expect(boxes).toHaveLength(shown.length);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as DOMRect;
      const b = boxes[j] as DOMRect;
      const isApart =
        a.right + 8 <= b.left + 1 ||
        b.right + 8 <= a.left + 1 ||
        a.bottom + 8 <= b.top + 1 ||
        b.bottom + 8 <= a.top + 1 ||
        Math.hypot(
          a.x + a.width / 2 - (b.x + b.width / 2),
          a.y + a.height / 2 - (b.y + b.height / 2),
        ) >=
          a.width + 8 - 1;
      expect(isApart).toBe(true);
    }
  }
}

/** The angle from the bubble's centre to a page point, in whole degrees `[0, 360)`. */
const angleTo = (bubble: OffscreenBubbleMirror, x: number, y: number): number => {
  const degrees = (Math.atan2(y - bubble.yPx, x - bubble.xPx) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
};
const angleGap = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

/** Steps until the threat is `windowOpen`. */
async function stepToOpen(page: Page, threatId: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const threat = (await ppWorld(page)).threats.find((candidate) => candidate.id === threatId);
    if (threat?.state === 'windowOpen') break;
    await ppAdvance(page, 1);
  }
  await waitFrames(page, 2);
}

test.describe('the off-screen bubble (story 9.3)', () => {
  test('a 4:3 screen with the live feel: the stairs off the right edge get a bubble, with their icon, their ring and a chevron toward them', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page, 1024, 768);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    expect(await ppOffscreen(page)).toEqual([]);
    const [stairs] = await force(page, 'stairs');
    const shown = await ppOffscreen(page);
    expect(shown.map((bubble) => [bubble.threatId, bubble.edge])).toEqual([[stairs?.id, 'right']]);
    const bubble = shown[0] as OffscreenBubbleMirror;
    await expectPlacedWell(page, shown);
    // The chevron points at the stairs' icon point, as the live camera projects it.
    const icon = await threatIconPoint(page);
    expect(icon.x).toBeGreaterThan(1024);
    expect(angleGap(bubble.angleDeg, angleTo(bubble, icon.x, icon.y))).toBeLessThanOrEqual(10);
    // Its icon (a circle, the parry colour), its ring, and nothing else.
    const inside = await bubbles(page).evaluate((element) => ({
      icon: element.querySelector('.pp-threat-icon')?.className,
      band: element.querySelector('.pp-offscreen-band') !== null,
      arc: element.querySelector('.pp-offscreen-arc') !== null,
      color: (
        element.querySelector('.pp-threat-icon') as HTMLElement | null
      )?.style.getPropertyValue('--pp-threat-color'),
      label: element.getAttribute('aria-label'),
      nodes: element.querySelectorAll('*').length + 1,
    }));
    expect(inside).toEqual({
      icon: 'pp-threat-icon',
      band: true,
      arc: true,
      color: 'var(--pp-color-parry)',
      label: "Bêtise hors de l'écran",
      nodes: 6,
    });
    // The ring shows what the marker's ring shows, at this very frame.
    for (const steps of [0, 20, 40]) {
      await ppAdvance(page, steps);
      await waitFrames(page, 2);
      const rings = await page.evaluate(() => {
        const bubbleRoot = document.querySelector('.pp-offscreen-bubble') as HTMLElement | null;
        const marker = [...document.querySelectorAll<HTMLElement>('.pp-threat')].find(
          (element) => element.style.display !== 'none',
        );
        const offset = marker
          ?.querySelector('.pp-chrono-progress')
          ?.getAttribute('stroke-dashoffset');
        return {
          bubble: bubbleRoot?.style.getPropertyValue('--pp-offscreen-progress'),
          marker: offset === undefined || offset === null ? null : String(1000 - Number(offset)),
          isBubbleLit: bubbleRoot?.classList.contains('pp-offscreen-bubble--lit'),
          isMarkerLit: marker?.querySelector('.pp-chrono-ring--lit') !== null,
        };
      });
      expect(rings.bubble).toBe(rings.marker);
      expect(rings.isBubbleLit).toBe(rings.isMarkerLit);
    }
    expect(await nodes(page)).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    expect(problems).toEqual([]);
  });

  test('a real tap on the bubble parries the stairs, and the bubble goes', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page, 1024, 768);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    const [stairs] = await force(page, 'stairs');
    await stepToOpen(page, stairs?.id ?? -1);
    const [bubble] = await ppOffscreen(page);
    expect(bubble?.threatId).toBe(stairs?.id);
    const resolvedBefore = (await typesOf(page, 'ResponseResolved')).length;
    await page.touchscreen.tap(bubble?.xPx ?? 0, bubble?.yPx ?? 0);
    await ppAdvance(page, 3);
    const presses = (await page.evaluate(() => window.__PP__?.journal()?.entries ?? []))
      .map((entry) => entry.command)
      .filter((command) => command.type === 'PressThreat') as { threatId: number }[];
    expect(presses.map((press) => press.threatId)).toEqual([stairs?.id]);
    const answered = (
      (await typesOf(page, 'ResponseResolved')) as unknown as {
        threatId: number;
        quality: string;
      }[]
    ).slice(resolvedBefore);
    expect(answered.map((event) => event.threatId)).toEqual([stairs?.id]);
    expect(answered[0]?.quality).not.toBe('fail');
    await waitFrames(page, 2);
    expect(await ppOffscreen(page)).toEqual([]);
    await expect(bubbles(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  // On a phone only the coffee table and the stairs can leave the frame (the outlet stays in, however
  // tight the frame): two bubbles, which fill the right edge and wrap onto the top. Three bubbles need a
  // 4:3 screen; the layout's property test proves three at every size (`offscreenLayout.test.ts`).
  // A phone's right edge holds one bubble at 750 × 340 and two at 844 × 390 under the HUD row, so the
  // second (or third) wraps onto the top; a 4:3 one holds four.
  for (const [width, height, defIds, isWrapped] of [
    [844, 390, ['coffee_table_object', 'stairs'], true],
    [750, 340, ['coffee_table_object', 'stairs'], true],
    [1024, 768, ['outlet', 'coffee_table_object', 'stairs'], false],
  ] as const) {
    test(`threats off one side at ${width} × ${height}: ${defIds.length} bubbles, stacked apart, within the HUD budget`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
      await openFrozen(page, width, height);
      await ppSetFeel(page, { camera: TIGHT_FRAME });
      await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
      const forced = await force(page, 'outlet', 'coffee_table_object', 'stairs');
      const shown = await ppOffscreen(page);
      const expected = forced.filter((threat) =>
        (defIds as readonly string[]).includes(threat.defId),
      );
      expect(shown.map((bubble) => bubble.threatId).sort()).toEqual(
        expected.map((threat) => threat.id).sort(),
      );
      // All off the right or below on its side: they stack up the right edge, and wrap onto the top
      // when it is full.
      const edges = shown.map((bubble) => bubble.edge);
      expect(edges).toContain('right');
      expect(edges.includes('top')).toBe(isWrapped);
      expect(edges).not.toContain('left');
      await expectPlacedWell(page, shown);
      expect(await nodes(page)).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
      expect(problems).toEqual([]);
    });
  }

  test('the keyboard target shows on the bubble with the one glyph chip beside it, and Space presses it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page, 1024, 768);
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    const [stairs] = await force(page, 'stairs');
    // A key that is not the action: the hand is on the keyboard now.
    await page.keyboard.down('KeyD');
    await page.keyboard.up('KeyD');
    await ppAdvance(page, 1);
    await waitFrames(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-target', String(stairs?.id));
    await expect(bubbles(page)).toHaveClass(/pp-offscreen-bubble--targeted/);
    const [bubble] = await ppOffscreen(page);
    const chip = await page.locator('.pp-glyph-chip').boundingBox();
    const disc = await bubbles(page).boundingBox();
    if (chip === null || disc === null || bubble === undefined)
      throw new Error('no chip or bubble');
    await expect(page.locator('.pp-glyph-chip')).toHaveCount(1);
    // Beside it, toward the centre (a right bubble: on its left), off it, and above the bottom third.
    expect(chip.x + chip.width).toBeLessThanOrEqual(disc.x);
    expect(chip.y + chip.height / 2).toBeGreaterThan(disc.y);
    expect(chip.y + chip.height / 2).toBeLessThan(disc.y + disc.height);
    expect(chip.y + chip.height).toBeLessThanOrEqual((768 * 2) / 3);
    await stepToOpen(page, stairs?.id ?? -1);
    const before = (await ppEvents(page)).length;
    await page.keyboard.down('Space');
    await ppAdvance(page, 2);
    await page.keyboard.up('Space');
    await ppAdvance(page, 2);
    const presses = (await page.evaluate(() => window.__PP__?.journal()?.entries ?? []))
      .map((entry) => entry.command)
      .filter((command) => command.type === 'PressThreat') as { threatId: number }[];
    expect(presses.map((press) => press.threatId)).toEqual([stairs?.id]);
    expect((await ppEvents(page, before)).some((event) => event.type === 'ResponseResolved')).toBe(
      true,
    );
    expect(problems).toEqual([]);
  });

  test('the silence says no direction in the big room: « … » at the right edge, no off-screen bubble until the baby is found', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page, 844, 390);
    await ppSetFeel(page, { camera: TIGHT_FRAME });
    await walkTo(page, KITCHEN_END[0], KITCHEN_END[1]);
    const silence = await threatOf(page, 'silence_mischief');
    await ppSend(page, { type: 'ForceThreat', threatId: silence.id });
    for (let i = 0; i < 400; i++) {
      if ((await ppEvents(page)).some((event) => event.type === 'SilenceStarted')) break;
      await ppAdvance(page, 25);
    }
    await ppAdvance(page, 1);
    await waitFrames(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-silence', 'on');
    const box = await page.locator('.pp-silence-bubble').boundingBox();
    const row = await page.locator('.pp-hud-row').boundingBox();
    if (box === null || row === null) throw new Error('no silence bubble or HUD row');
    // The right edge (its tail fills the inset), just under the HUD row, whatever the zone's side.
    expect(box.x + box.width).toBeGreaterThan(844 - 2 * HUD_INSET_PX - 14);
    expect(Math.round(box.y)).toBe(Math.round(row.y + row.height + 8));
    await expect(bubbles(page)).toHaveCount(0);
    expect(await ppOffscreen(page)).toEqual([]);
    // Found: the silence bubble goes, the threat telegraphs at the zone (and has a bubble if it is out).
    await ppSend(page, { type: 'TapBaby' });
    for (let i = 0; i < 600; i++) {
      if ((await ppEvents(page)).some((event) => event.type === 'SilenceEnded')) break;
      await ppAdvance(page, 5);
    }
    await ppAdvance(page, 1);
    await waitFrames(page, 3);
    await expect(page.locator('.pp-silence-bubble')).toBeHidden();
    const found = (await ppWorld(page)).threats.find((threat) => threat.id === silence.id);
    expect(['telegraph', 'windowOpen', 'resolved', 'gag']).toContain(found?.state);
    expect(await nodes(page)).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    expect(problems).toEqual([]);
  });

  test('a fixed level never has one', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await ppFreeze(page, true);
    await stepToFirstTelegraph(page);
    await waitFrames(page, 3);
    await expect(bubbles(page)).toHaveCount(0);
    expect(await ppOffscreen(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
