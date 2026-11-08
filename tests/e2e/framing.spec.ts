import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { appUrl, collectProblems, html, startLevel, waitFrames } from './support/game.ts';
import {
  ppAdvance,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppPagePoint,
  ppSend,
  ppWorld,
} from './support/testApi.ts';

// The film grammar of the special sequences (story 7.4, D8 to D12), on the live level, driven by the test
// API on a frozen level: each sequence names its style in its JSON, and the client draws the letterbox, the
// grade, the vignette, the roll and the title from the world's sequence slice and the sim clock. What is
// checked is what the player sees (the bars on the page, Papa and the exit outside them) and the mirrors.

const LEVEL = 'salon_crawler';
const SEED = 42;
const STRINGS = JSON.parse(readFileSync('content/strings.fr.json', 'utf8')) as Record<
  string,
  string
>;
const FEEDBACK = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
  framingStyles: Record<string, { letterboxPct: number; rollDeg: number; titleHoldMs: number }>;
};
interface SequenceJson {
  framing: { camera: { inMs: number; outMs: number }; style: string; titleKey: string };
}
const sequenceOf = (id: string): SequenceJson =>
  JSON.parse(readFileSync(`content/sequences/${id}.json`, 'utf8')) as SequenceJson;
const SEQUENCES = ['stay_awake', 'lullaby_walk', 'bedtime_duel', 'bomb_drop', 'stealth_exit'];
const SIZES = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];
const LETTERBOX = '.pp-film-letterbox';
const TITLE = '.pp-film-title';
const EXIT_MARKER = '.pp-exit-marker';

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

async function startSequence(page: Page, id: string): Promise<void> {
  await ppSend(page, { type: 'StartSequence', sequenceId: id });
  await ppAdvance(page, 2);
  await expect(html(page)).toHaveAttribute('data-pp-sequence', id);
}

/** The two bars as drawn: the top bar's bottom edge and the bottom bar's top edge, in px. */
async function barEdges(
  page: Page,
): Promise<{ topPx: number; bottomPx: number; heightPx: number }> {
  return page.locator(LETTERBOX).evaluate((element) => {
    const before = Number.parseFloat(getComputedStyle(element, '::before').height) || 0;
    const after = Number.parseFloat(getComputedStyle(element, '::after').height) || 0;
    const opacity = Number(getComputedStyle(element).opacity);
    const shown = opacity > 0 ? 1 : 0;
    return {
      topPx: before * shown,
      bottomPx: window.innerHeight - after * shown,
      heightPx: before,
    };
  });
}

test.describe('the film grammar of each sequence', () => {
  for (const id of SEQUENCES) {
    const { style, titleKey, camera } = sequenceOf(id).framing;
    const look = FEEDBACK.framingStyles[style] as { letterboxPct: number; rollDeg: number };

    test(`${id} draws ${style}: the mirror, the bars at full blend, the title, Papa clear of the bars`, async ({
      page,
    }) => {
      const problems = collectProblems(page);
      await openFrozen(page);
      await startSequence(page, id);
      // The title card is up in the first steps, on the sim clock (at the very start the blend is 0).
      await ppAdvance(page, 5);
      await waitFrames(page, 2);
      await expect(page.locator(TITLE)).toHaveText(STRINGS[titleKey] as string);
      expect(
        Number(await page.locator(TITLE).evaluate((element) => getComputedStyle(element).opacity)),
      ).toBeGreaterThan(0);
      await ppAdvance(page, Math.ceil(camera.inMs / STEP_MS) + 5);
      await waitFrames(page, 2);
      await expect(html(page)).toHaveAttribute('data-pp-framing-style', style);
      const { framing } = await ppFx(page);
      expect(framing.style).toBe(style);
      expect(framing.blend).toBe(1);
      expect(framing.letterboxPct).toBeCloseTo(look.letterboxPct, 6);
      expect(framing.rollDeg).toBeCloseTo(look.rollDeg, 6);
      expect(framing.lightsFactor).toBeLessThanOrEqual(1);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await waitFrames(page, 3);
        const bars = await barEdges(page);
        expect(bars.heightPx).toBeCloseTo((size.height * look.letterboxPct) / 100, 0);
        const world = await ppWorld(page);
        // Papa's feet and his head, projected through the live camera, are between the bars.
        for (const yM of [0, 0.9]) {
          const papa = await ppPagePoint(page, world.papa.xM, yM, world.papa.zM);
          expect(papa.y, `Papa at ${size.width} × ${size.height}`).toBeGreaterThan(bars.topPx);
          expect(papa.y, `Papa at ${size.width} × ${size.height}`).toBeLessThan(bars.bottomPx);
        }
        if (id === 'stealth_exit') {
          const exit = await page.locator(EXIT_MARKER).boundingBox();
          expect(exit, 'the exit marker').not.toBeNull();
          expect(exit?.y ?? 0).toBeGreaterThanOrEqual(bars.topPx);
          expect((exit?.y ?? 0) + (exit?.height ?? 0)).toBeLessThanOrEqual(bars.bottomPx);
        }
      }
      // The layers take no tap and sit under the world's markers.
      const layers = await page.evaluate(() =>
        ['.pp-film-vignette', '.pp-film-letterbox', '.pp-film-title'].map((selector) => {
          const element = document.querySelector(selector) as HTMLElement;
          const world = document.getElementById('pp-world') as HTMLElement;
          return {
            pointerEvents: getComputedStyle(element).pointerEvents,
            isUnder:
              Number(getComputedStyle(element).zIndex) < Number(getComputedStyle(world).zIndex),
            isBefore: element.compareDocumentPosition(world) === Node.DOCUMENT_POSITION_FOLLOWING,
          };
        }),
      );
      for (const layer of layers) {
        expect(layer).toEqual({ pointerEvents: 'none', isUnder: true, isBefore: true });
      }
      expect(problems).toEqual([]);
    });
  }
});

test.describe('the framing over time', () => {
  test('goes back to none after outMs: no mirror, no bars, the level lights', async ({ page }) => {
    await openFrozen(page);
    await startSequence(page, 'stay_awake');
    const { inMs, outMs } = sequenceOf('stay_awake').framing.camera;
    await ppAdvance(page, Math.ceil(inMs / STEP_MS) + 5);
    await expect(html(page)).toHaveAttribute('data-pp-framing-style', 'action');
    // Nobody answers the micro-sleep: the sequence ends in its gag.
    for (let i = 0; i < 400 && (await ppWorld(page)).flow.state === 'sequence'; i++) {
      await ppAdvance(page, 10);
    }
    expect((await ppWorld(page)).flow.state).not.toBe('sequence');
    await ppAdvance(page, Math.ceil(outMs / STEP_MS) + 2);
    await waitFrames(page, 2);
    await expect(html(page)).not.toHaveAttribute('data-pp-framing-style', /.+/);
    const { framing } = await ppFx(page);
    expect(framing).toEqual({
      style: null,
      blend: 0,
      letterboxPct: 0,
      lightsFactor: 1,
      rollDeg: 0,
    });
    expect((await barEdges(page)).topPx).toBe(0);
  });

  test('a pause holds it: the bars, the roll and the title stand still', async ({ page }) => {
    await page.goto(appUrl('/'));
    await startLevel(page);
    await ppSend(page, { type: 'StartSequence', sequenceId: 'bedtime_duel' });
    await expect(html(page)).toHaveAttribute('data-pp-sequence', 'bedtime_duel');
    // Mid-blend: the framing is still rising.
    await expect.poll(async () => (await ppFx(page)).framing.blend).toBeGreaterThan(0.1);
    await page.locator('.pp-hud-row .pp-button').click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const held = await ppFx(page);
    const title = await page
      .locator(TITLE)
      .evaluate((element) => getComputedStyle(element).opacity);
    await waitFrames(page, 30);
    expect((await ppFx(page)).framing).toEqual(held.framing);
    expect(await page.locator(TITLE).evaluate((element) => getComputedStyle(element).opacity)).toBe(
      title,
    );
  });

  test('reduced motion: no roll, the zoom cap of 4.4 as before, the bars and the grade stay', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFrozen(page);
    await startSequence(page, 'bedtime_duel');
    const { inMs } = sequenceOf('bedtime_duel').framing.camera;
    await ppAdvance(page, Math.ceil(inMs / STEP_MS) + 5);
    await waitFrames(page, 2);
    const { framing } = await ppFx(page);
    expect(framing.rollDeg).toBe(0);
    expect(framing.letterboxPct).toBeCloseTo(FEEDBACK.framingStyles.duel?.letterboxPct ?? 0, 6);
    expect(framing.lightsFactor).toBeLessThan(1);
  });

  test('the bomb drop → stealth seam: the bars and the grade change by under a tenth a step', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFrozen(page);
    await startSequence(page, 'bomb_drop');
    // Nobody lays the baby down: the drop ends (lost) within a few of its rounds.
    for (let i = 0; i < 300 && (await ppWorld(page)).flow.state === 'sequence'; i++) {
      await ppAdvance(page, 10);
    }
    expect((await ppWorld(page)).flow.state).not.toBe('sequence');
    // From here on, every step is sampled: the retries of the start, the seam, and what follows.
    let last = (await ppFx(page)).framing;
    const expectSmooth = async (label: string): Promise<void> => {
      await waitFrames(page, 1);
      const next = (await ppFx(page)).framing;
      expect(Math.abs(next.letterboxPct - last.letterboxPct) / 12, `bars ${label}`).toBeLessThan(
        0.1,
      );
      expect(Math.abs(next.lightsFactor - last.lightsFactor) / 1.2, `grade ${label}`).toBeLessThan(
        0.1,
      );
      last = next;
    };
    // The stealth exit starts as soon as Papa may (a gag can hold him for a few steps).
    let isStarted = false;
    for (let i = 0; i < 40 && !isStarted; i++) {
      await ppSend(page, { type: 'StartSequence', sequenceId: 'stealth_exit' });
      await ppAdvance(page, 1);
      await expectSmooth(`at retry ${i}`);
      isStarted = (await ppWorld(page)).sequence.id === 'stealth_exit';
    }
    expect(isStarted, 'StartSequence was refused for 40 steps').toBe(true);
    for (let i = 0; i < 120; i++) {
      await ppAdvance(page, 1);
      await expectSmooth(`at step ${i}`);
    }
    expect(last.style).toBe('infiltration');
  });
});
