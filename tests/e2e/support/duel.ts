import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { STEP_MS } from '../../../src/shared/constants.ts';
import { html, startLevel, waitFrames } from './game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
} from './testApi.ts';

// What the e2e specs of the bedtime duel (story 4.6) and of the fake sleep (story 4.7) share: the
// frozen live level, the start of the duel, the waits on a round's telegraph, real taps and the
// markers as drawn. A spec that plays a later round wins the earlier ones with `winRound`.

export const LEVEL = 'salon_crawler';
export const SEED = 42;

/** The live level with the loop frozen (steps by hand), and the audio up before any tap. */
export async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up before any tap: a first tap must not be the gesture that rescues it.
  await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
}

type World = Awaited<ReturnType<typeof ppWorld>>;

/** The instance of a threat def in the world (the duel has one per def). */
export const threatOf = (world: World, defId: string) =>
  world.threats.find((threat) => threat.defId === defId);

export async function start(page: Page, sequenceId = 'bedtime_duel'): Promise<void> {
  await ppSend(page, { type: 'StartSequence', sequenceId });
  await ppAdvance(page, 2);
  await expect(html(page)).toHaveAttribute('data-pp-sequence', sequenceId);
}

/**
 * Steps, in chunks of 200 ms, until the threat of `defId` is `telegraph`: its signal is drawn and not
 * given. A chunk is short beside the shortest telegraph-to-signal time of a round (2.8 s for the eyes),
 * so the telegraph is always seen before anything of it happens. `feintAt` is the instant drawn for a
 * feint (null for a def with none): a test may read it, as the client must not.
 */
export async function untilTelegraphed(
  page: Page,
  defId = 'bedtime_eyes',
): Promise<{ windowOpenAt: number; windowMs: number; feintAt: number | null }> {
  for (let i = 0; i < 300; i++) {
    const threat = threatOf(await ppWorld(page), defId);
    if (threat?.state === 'telegraph' && threat.responseWindow !== null) {
      return {
        windowOpenAt: threat.windowOpenAt,
        windowMs: threat.responseWindow.windowMs,
        feintAt: threat.feintAt,
      };
    }
    await ppAdvance(page, 20);
  }
  throw new Error(`${defId} was never telegraphed`);
}

/** Steps, by hand, to the first step at or after `untilMs` of sim time. */
export async function advanceTo(page: Page, untilMs: number): Promise<void> {
  const now = (await ppWorld(page)).time.sim;
  const steps = Math.max(0, Math.ceil((untilMs - now) / STEP_MS));
  if (steps > 0) await ppAdvance(page, steps);
  // The loop records the new clock at its next frames: an input stamped before that is mapped
  // between the old clock and the new one, not onto the new one (the loop is frozen, the map flat).
  await waitFrames(page, 3);
}

/** A real click in the bottom-left of the canvas: far from the marker, clear of the HUD's corners. */
export async function realTap(page: Page): Promise<void> {
  const box = await page.locator('#pp-canvas').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.9);
}

/**
 * Wins the round of `defId` that is next, by a real tap at the centre of its window, and waits for the
 * sequence to step up. `stepIndex` is the step it is on.
 */
export async function winRound(page: Page, defId: string, stepIndex: number): Promise<void> {
  const { windowOpenAt, windowMs } = await untilTelegraphed(page, defId);
  await advanceTo(page, windowOpenAt + windowMs / 2);
  await realTap(page);
  await ppAdvance(page, 3);
  await expect(html(page)).toHaveAttribute('data-pp-sequence-step', String(stepIndex + 1));
}

/** The markers that are shown (not `display: none`): the verb text, the path of the glyph and the classes. */
export const shownMarkers = (page: Page) =>
  page.locator('.pp-threat').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => ({
        verb: element.querySelector('.pp-threat-verb')?.textContent ?? null,
        glyph: element.querySelector('.pp-threat-icon path')?.getAttribute('d') ?? null,
        classes: element.className,
      })),
  );

/** A screenshot to look at: in `PP_SHOTS_DIR` when it is set (the story's review), else in the test's output. */
export const shot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({
    path:
      process.env.PP_SHOTS_DIR === undefined
        ? testInfo.outputPath(name)
        : join(process.env.PP_SHOTS_DIR, `${testInfo.project.name}-${name}`),
  });

export const typesOf = async (page: Page, type: string) =>
  (await ppEvents(page)).filter((event) => event.type === type);
export const cueIds = async (page: Page) => (await ppCueLog(page)).map((entry) => entry.cueId);
