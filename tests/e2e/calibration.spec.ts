import { expect, type Page, test } from '@playwright/test';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  appHistory,
  collectProblems,
  html,
  liveFeel,
  OVERRUN_MARGIN_MS,
  openGame,
  recordAppStates,
  setVisibility,
  startLevel,
  stubGamepad,
  tapOnEveryBeat,
  threatIconPoint,
  waitForThreat,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import { waitForTestApi } from './support/testApi.ts';

// The latency calibration (story 2.7). The maths and the plumbing are proven in unit tests; these
// specs prove the whole path in a browser: the first launch, the second one, the skip, the retry, the
// background, a corrupt save, the pad, and the offset reaching the sim. What no spec can check, and
// Geo must: **real latency on a real device**: whether the measured offsets feel fair is for a phone
// (docs/playtest/device-measurements.md).
//
// The player taps on the mirrors' changes (`data-pp-calibration-beats` goes up at every beat), so
// nothing waits on a fixed delay. Every other spec starts from a saved calibration (the configs);
// these start from an empty storage.

test.use({ storageState: { cookies: [], origins: [] } });

/** Both phases (8 beats at 100 BPM, a lead-in and a tail each) and the level's load, with a margin. */
const CALIBRATION_TIMEOUT_MS = 45_000;
const PHASE_TIMEOUT_MS = 15_000;
const { offsetMinMs, offsetMaxMs } = liveFeel.calibration;

const SAVE_KEY = SAVE_STORAGE_KEY;
const INVALID_KEY = 'papa-parade.save.invalid';

/** Puts a value in `localStorage` before the page loads, once. */
const seedStorage = async (page: Page, key: string, value: string): Promise<void> => {
  await page.addInitScript(
    ([storageKey, storageValue]) => {
      if (localStorage.getItem(storageKey as string) === null) {
        localStorage.setItem(storageKey as string, storageValue as string);
      }
    },
    [key, value],
  );
};

interface StoredSave {
  version: number;
  calibration: {
    visualOffsetMs: number;
    audioOffsetMs: number;
    audioSkipped: boolean;
    measuredAt: string;
    device: string;
  } | null;
}

const readSave = async (page: Page): Promise<StoredSave | null> => {
  const text = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  return text === null ? null : (JSON.parse(text) as StoredSave);
};

/** The same, with A on the stubbed pad: pressed for a few frames at each beat. */
const padTapOnEveryBeat = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const pad = (window as unknown as { ppPad: { buttons: boolean[] } }).ppPad;
    new MutationObserver(() => {
      if (Number(document.documentElement.dataset.ppCalibrationBeats) <= 0) return;
      pad.buttons[0] = true;
      let frames = 0;
      const release = (): void => {
        if (++frames < 3) requestAnimationFrame(release);
        else pad.buttons[0] = false;
      };
      requestAnimationFrame(release);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-pp-calibration-beats'],
    });
  });

const phase = (page: Page, expected: string, timeout = PHASE_TIMEOUT_MS) =>
  expect(html(page)).toHaveAttribute('data-pp-calibration', expected, { timeout });

const startGame = async (page: Page): Promise<void> => {
  await page.locator('.pp-start-screen').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'calibration');
};

test.describe('the first launch', () => {
  test('start → calibration (audio, then visual) → « Calé ! » → loading → level, and the save holds both offsets', async ({
    page,
  }) => {
    test.setTimeout(CALIBRATION_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await openGame(page);
    await recordAppStates(page);
    expect(await readSave(page)).toBeNull();
    await startGame(page);
    await phase(page, 'audio');
    await tapOnEveryBeat(page);
    await phase(page, 'visual', PHASE_TIMEOUT_MS * 2);
    await phase(page, 'done', PHASE_TIMEOUT_MS * 2);
    await expect(page.locator('.pp-calibration-prompt')).toHaveText(
      STRINGS['calibration.done'] ?? '',
    );
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: CALIBRATION_TIMEOUT_MS,
    });
    expect(await appHistory(page)).toEqual(['calibration', 'loading', 'level']);

    const save = await readSave(page);
    expect(save?.version).toBe(2);
    const calibration = save?.calibration;
    expect(calibration).not.toBeNull();
    for (const offsetMs of [calibration?.visualOffsetMs, calibration?.audioOffsetMs]) {
      expect(offsetMs).toBeGreaterThanOrEqual(offsetMinMs);
      expect(offsetMs).toBeLessThanOrEqual(offsetMaxMs);
    }
    expect(calibration?.audioSkipped).toBe(false);
    expect(calibration?.device).toMatch(/^web-(touch|desktop)$/);
    expect(Number.isNaN(Date.parse(calibration?.measuredAt ?? ''))).toBe(false);
    expect(problems).toEqual([]);
  });

  test('the second load goes straight from start to loading: no calibration', async ({ page }) => {
    const problems = collectProblems(page);
    await seedStorage(page, SAVE_KEY, calibratedSaveValue());
    await openGame(page);
    await recordAppStates(page);
    await page.locator('.pp-start-screen').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    expect(await appHistory(page)).toEqual(['loading', 'level']);
    expect(problems).toEqual([]);
  });

  test('skipping the audio phase plays the visual one only: audioSkipped, and the audio offset is the visual one', async ({
    page,
  }) => {
    test.setTimeout(CALIBRATION_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await openGame(page);
    await startGame(page);
    await phase(page, 'audio');
    await page.locator('.pp-calibration-skip').click();
    await phase(page, 'visual');
    await expect(page.locator('.pp-calibration-skip')).toBeHidden();
    await tapOnEveryBeat(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: CALIBRATION_TIMEOUT_MS,
    });
    const calibration = (await readSave(page))?.calibration;
    expect(calibration?.audioSkipped).toBe(true);
    expect(calibration?.audioOffsetMs).toBe(calibration?.visualOffsetMs);
    expect(problems).toEqual([]);
  });

  test('with no taps the phase shows the string and waits; the next tap starts it over', async ({
    page,
  }) => {
    test.setTimeout(CALIBRATION_TIMEOUT_MS);
    const problems = collectProblems(page);
    await openGame(page);
    await startGame(page);
    await phase(page, 'audio');
    await page.locator('.pp-calibration-skip').click();
    await phase(page, 'visual');
    await phase(page, 'retry');
    await expect(page.locator('.pp-calibration-prompt')).toHaveText(
      STRINGS['calibration.too_few_taps'] ?? '',
    );
    // It does not start over on its own: the mirror still says `retry` a moment later.
    await expect(html(page)).toHaveAttribute('data-pp-calibration', 'retry');
    await page.keyboard.press('Space');
    await phase(page, 'visual');
    await expect(html(page)).toHaveAttribute('data-pp-calibration-beats', '0');
    expect(problems).toEqual([]);
  });

  test('a page sent to the background mid-phase starts the phase over from 0 beats', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openGame(page);
    await startGame(page);
    await phase(page, 'audio');
    await page.locator('.pp-calibration-skip').click();
    await phase(page, 'visual');
    await expect
      .poll(async () => Number(await html(page).getAttribute('data-pp-calibration-beats')), {
        timeout: PHASE_TIMEOUT_MS,
      })
      .toBeGreaterThanOrEqual(2);
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expect(html(page)).toHaveAttribute('data-pp-calibration-beats', '0');
    await phase(page, 'visual');
    expect(problems).toEqual([]);
  });

  test('a corrupt save is set aside, the game reaches the calibration, with one warning', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const storageWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('[storage]')) {
        storageWarnings.push(message.text());
      }
    });
    const corrupt = { version: 1, calibration: { visualOffsetMs: 'late' } };
    await seedStorage(page, SAVE_KEY, JSON.stringify(corrupt));
    await openGame(page);
    await startGame(page);
    const kept = await page.evaluate((key) => localStorage.getItem(key), INVALID_KEY);
    expect(JSON.parse(kept ?? 'null')).toEqual(corrupt);
    expect(storageWarnings).toHaveLength(1);
    expect(problems).toEqual([]);
  });
});

test.describe('the gamepad', () => {
  test('A counts as a tap, B skips the audio phase', async ({ page }) => {
    test.setTimeout(CALIBRATION_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await openGame(page);
    await pad.setPadPresent(true);
    await pad.tapButton(0); // A starts the game
    await expect(html(page)).toHaveAttribute('data-pp-app', 'calibration');
    await phase(page, 'audio');
    await pad.tapButton(1); // B skips the audio phase
    await phase(page, 'visual');
    await padTapOnEveryBeat(page);
    // Five valid taps are needed to finish: A counted.
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: CALIBRATION_TIMEOUT_MS,
    });
    const calibration = (await readSave(page))?.calibration;
    expect(calibration?.audioSkipped).toBe(true);
    expect(calibration?.visualOffsetMs).toBeGreaterThanOrEqual(offsetMinMs);
    expect(calibration?.visualOffsetMs).toBeLessThanOrEqual(offsetMaxMs);
    expect(problems).toEqual([]);
  });
});

test.describe('the offset in the sim', () => {
  async function pressFirstThreat(page: Page): Promise<void> {
    await startLevel(page);
    await waitForTestApi(page);
    await waitForThreat(page, 'telegraph', 20_000 + OVERRUN_MARGIN_MS);
    const icon = await threatIconPoint(page);
    await waitForThreat(page, 'windowOpen', 10_000);
    await page.touchscreen.tap(icon.x, icon.y);
    await expect(html(page)).toHaveAttribute('data-pp-press', /^\d+$/);
  }

  const journal = (page: Page) => page.evaluate(() => window.__PP__?.journal() ?? null);

  test('a seeded offset of 100 journals SetInputLag, and a press is dated at least that much (in sim time) before the step that applies it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page);
    await seedStorage(page, SAVE_KEY, calibratedSaveValue({ visualOffsetMs: 100 }));
    await openGame(page);
    await pressFirstThreat(page);
    const entries = (await journal(page))?.entries ?? [];
    expect(entries[0]?.command).toMatchObject({ type: 'SetInputLag', lagMs: 100 });
    const press = entries.find((entry) => entry.command.type === 'PressThreat');
    expect(press).toBeDefined();
    // The press is corrected into the past by the offset: `t` is that much earlier than the step.
    // The offset is real ms and `t` is sim ms: while Instinct slows the sim, 100 real ms are only
    // `timeScale` x 100 sim ms (the full CI caught 94 with the 0.8 of Instinct).
    const minSimSpanMs = 100 * Math.min(1, liveFeel.instinct.timeScale);
    expect((press?.applyAt ?? 0) - (press?.command.t ?? 0)).toBeGreaterThanOrEqual(minSimSpanMs);
    expect(problems).toEqual([]);
  });

  test('with an offset of 0 there is no SetInputLag and the press is not moved', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page);
    await seedStorage(page, SAVE_KEY, calibratedSaveValue());
    await openGame(page);
    await pressFirstThreat(page);
    const entries = (await journal(page))?.entries ?? [];
    expect(entries.map((entry) => entry.command.type)).not.toContain('SetInputLag');
    const press = entries.find((entry) => entry.command.type === 'PressThreat');
    expect((press?.applyAt ?? 0) - (press?.command.t ?? 0)).toBeLessThan(100);
    expect(problems).toEqual([]);
  });
});
