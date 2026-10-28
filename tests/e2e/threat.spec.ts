import { expect, test } from '@playwright/test';
import {
  canvasPoint,
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  hapticPatternOfCue,
  html,
  lastTelegraph,
  mirrorWrites,
  OVERRUN_MARGIN_MS,
  recordMirrorWrites,
  recordVibrations,
  startLevel,
  THREATS_OFF,
  telegraphDelayMsOf,
  threatIconPoint,
  vibrations,
  waitForThreat,
  windowOpenMsOf,
} from './support/game.ts';
import { waitForTestApi } from './support/testApi.ts';

// The live level's first wave draws its first threat (story 1.18: by the PRNG, not always the
// outlet): after the countdown the baby locks on it, the threat is telegraphed, and the player
// parries it with a tap on its icon or watches the gag. The threat that came is read from the
// sim's events; every bound is derived from the live plan, def and feel; nothing waits on a fixed delay.

const TELEGRAPH_TIMEOUT_MS = FIRST_TELEGRAPH_MAX_MS + OVERRUN_MARGIN_MS;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const valuesOf = async (
  page: Parameters<typeof mirrorWrites>[0],
  name: string,
): Promise<string[]> =>
  (await mirrorWrites(page)).filter((write) => write.name === name).map((write) => write.value);

test.describe('the first threat of the live level', () => {
  test('is telegraphed: the icon and its halo appear on its anchor and its telegraph cue plays', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', TELEGRAPH_TIMEOUT_MS);
    await waitForTestApi(page);
    const { def } = await lastTelegraph(page);
    await expect(page.locator('.pp-threat-icon')).toBeVisible();
    await expect(page.locator('.pp-threat-halo')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-cue', def.feedback.telegraph);
    const pattern = hapticPatternOfCue(def.feedback.telegraph);
    if (hasVibrate() && pattern !== null) expect(await vibrations(page)).toContainEqual(pattern);
    // The icon stands where the app says it does, inside the canvas.
    const icon = await threatIconPoint(page);
    const box = await page.locator('#pp-canvas').boundingBox();
    expect(icon.x).toBeGreaterThan(box?.x ?? Number.POSITIVE_INFINITY);
    expect(icon.x).toBeLessThan((box?.x ?? 0) + (box?.width ?? 0));
    expect(problems).toEqual([]);
  });

  test('a tap on the icon in the window highlights it at once, glides Papa there and parries it', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordMirrorWrites(page, ['data-pp-papa-state', 'data-pp-cue', 'data-pp-response']);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', TELEGRAPH_TIMEOUT_MS);
    await waitForTestApi(page);
    const { def } = await lastTelegraph(page);
    const cues = def.feedback;
    const icon = await threatIconPoint(page);
    await waitForThreat(page, 'windowOpen', telegraphDelayMsOf(def) + OVERRUN_MARGIN_MS);
    await page.touchscreen.tap(icon.x, icon.y);

    await expect(html(page)).toHaveAttribute('data-pp-response', /^(perfect|success)$/);
    // It was a press on the threat, not a floor tap: no tap marker, no tap mirror.
    await expect(html(page)).toHaveAttribute('data-pp-press', /^\d+$/);
    expect(await html(page).getAttribute('data-pp-tap')).toBeNull();
    // The highlight was drawn (the app marks the first frame that shows it, debug builds only).
    const highlightMarks = await page.evaluate(
      () => performance.getEntriesByName('highlightRendered').length,
    );
    expect(highlightMarks).toBe(1);
    // Papa glided to the threat, and the result sounded at the judgement with the def's cue.
    expect(await valuesOf(page, 'data-pp-papa-state')).toContain('glide');
    const playedCues = await valuesOf(page, 'data-pp-cue');
    expect([cues.success, cues.perfect]).toContain(playedCues.at(-1));
    expect(playedCues).not.toContain(cues.gag);
    // The threat is resolved: its icon is gone and no gag was shown.
    await expect(page.locator('.pp-threat-icon')).toBeHidden();
    expect(await html(page).getAttribute('data-pp-gag')).toBeNull();
    expect(problems).toEqual([]);
  });

  test('left alone, it ends in the gag: the result is a fail, the gag cue plays once and nothing is removed', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordMirrorWrites(page, ['data-pp-cue']);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', TELEGRAPH_TIMEOUT_MS);
    await waitForTestApi(page);
    const { def } = await lastTelegraph(page);
    const cues = def.feedback;
    await waitForThreat(
      page,
      'gag',
      telegraphDelayMsOf(def) + windowOpenMsOf(def) + OVERRUN_MARGIN_MS,
    );
    await expect(html(page)).toHaveAttribute('data-pp-response', 'fail');
    await expect(html(page)).toHaveAttribute('data-pp-gag', def.gag);
    await expect(html(page)).toHaveAttribute('data-pp-cue', cues.gag);
    const playedCues = await valuesOf(page, 'data-pp-cue');
    expect(playedCues.filter((cue) => cue === cues.gag)).toHaveLength(1);
    expect(playedCues).not.toContain(cues.success);
    await expect(page.locator('.pp-threat-icon')).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('a tap on the floor far from the icon still walks Papa, with its marker', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', TELEGRAPH_TIMEOUT_MS);
    const icon = await threatIconPoint(page);
    const box = await page.locator('#pp-canvas').boundingBox();
    // The side of the canvas the icon is not on.
    const isIconWest = icon.x < (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const far = await canvasPoint(page, isIconWest ? 0.8 : 0.2, 0.6);
    expect(Math.hypot(far.x - icon.x, far.y - icon.y)).toBeGreaterThan(200);
    await page.touchscreen.tap(far.x, far.y);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkPath');
    await expect(page.locator('.pp-tap-marker-ring')).toBeVisible();
    expect(await html(page).getAttribute('data-pp-press')).toBeNull();
    expect(problems).toEqual([]);
  });

  test('?threats=off loads the level with no threat: nothing is telegraphed when the plan says it should be', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page, THREATS_OFF);
    // The plan would have fired by now (sim time runs one for one in a test).
    await expect(waitForThreat(page, 'telegraph', TELEGRAPH_TIMEOUT_MS)).rejects.toThrow(/Timeout/);
    expect(await html(page).getAttribute('data-pp-threat')).toBeNull();
    await expect(page.locator('.pp-threat-icon')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});
