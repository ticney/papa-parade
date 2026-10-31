import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  collectProblems,
  html,
  liveFeel,
  liveThreat,
  OVERRUN_MARGIN_MS,
  openGame,
  pauseButton,
  startLevel,
  stubGamepad,
  tapOnEveryBeat,
  waitForThreat,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import { ppWorld, waitForTestApi } from './support/testApi.ts';

// The tier and the settings (story 2.8). The maths are proven in unit tests; these specs prove the
// whole path in a browser: the pause panel opens the settings over a level that stays alive, a change
// reaches the save at once, the tier reaches the next game as a journaled command, and the music, the
// pad and the portrait overlay behave. What no spec can check, and Geo must: whether the three tiers
// *feel* like Assistance, Normal and Experienced Dad, and whether a slider is comfortable under a
// thumb on a real phone (docs/playtest/device-measurements.md).

const SAVE_KEY = SAVE_STORAGE_KEY;
const INVALID_KEY = 'papa-parade.save.invalid';
const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
/** Both phases of a calibration (8 beats at 100 BPM each) and what surrounds them, with a margin. */
const CALIBRATION_TIMEOUT_MS = 45_000;
const FIRST_TELEGRAPH_TIMEOUT_MS = 20_000 + OVERRUN_MARGIN_MS;
const RESUMED_TIMEOUT_MS = RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS;

// The live multipliers, read here and never copied: Geo retunes them freely.
const { difficulty } = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  difficulty: Record<'assistance' | 'normal' | 'experienced', { windowMultiplier: number }>;
};

// Standard-mapping indices of the pad stub (see `GamepadStub`).
const PAD = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 } as const;

interface StoredSettings {
  tier: string;
  volumes: { music: number; sfx: number; voice: number; ui: number };
  haptics: boolean;
  reducedMotion: boolean;
  largeVerbs: boolean;
}
interface StoredSave {
  version: number;
  calibration: { audioSkipped: boolean; visualOffsetMs: number } | null;
  settings: StoredSettings;
}

/** WebKit has no `navigator.vibrate`: the Vibrations row is not built there (EXPERIENCE.md). */
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const readRaw = (page: Page, key = SAVE_KEY): Promise<string | null> =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
const readSave = async (page: Page): Promise<StoredSave | null> => {
  const text = await readRaw(page);
  return text === null ? null : (JSON.parse(text) as StoredSave);
};
const savedSettings = async (page: Page): Promise<StoredSettings> => {
  const save = await readSave(page);
  if (save === null) throw new Error('no save in localStorage');
  return save.settings;
};

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

const radio = (page: Page, tier: 'assistance' | 'normal' | 'experienced') =>
  page.getByRole('radio', { name: STRINGS[`settings.tier_${tier}`], exact: true });
const slider = (page: Page, bus: 'music' | 'sfx' | 'voice' | 'ui') =>
  page.getByRole('slider', { name: STRINGS[`settings.volume_${bus}`], exact: true });
const haptics = (page: Page) =>
  page.getByRole('switch', { name: STRINGS['settings.haptics'], exact: true });
const reducedMotionSwitch = (page: Page) =>
  page.getByRole('switch', { name: STRINGS['settings.reduced_motion'], exact: true });
const largeVerbsSwitch = (page: Page) =>
  page.getByRole('switch', { name: STRINGS['settings.large_verbs'], exact: true });
const deviceNote = (page: Page) =>
  page.getByText(STRINGS['settings.reduced_motion_device'] as string, { exact: true });
const settingsButton = (
  page: Page,
  key: 'settings.recalibrate' | 'settings.credits' | 'settings.back',
) => page.getByRole('button', { name: STRINGS[key], exact: true });
const panel = (page: Page) => page.locator('.pp-panel');

const pauseWithEscape = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
};

/** From a running level: the pause panel, then « Réglages ». */
async function openSettings(page: Page): Promise<void> {
  await pauseWithEscape(page);
  await pauseButton(page, STRINGS['pause.settings']).click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
}

const closeSettings = async (page: Page): Promise<void> => {
  await settingsButton(page, 'settings.back').click();
  await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
};

const running = (page: Page) =>
  expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_TIMEOUT_MS });

const journal = (page: Page) => page.evaluate(() => window.__PP__?.journal() ?? null);
const tierCommands = async (page: Page) =>
  ((await journal(page))?.entries ?? []).filter((e) => e.command.type === 'SetDifficultyTier');

/** The window the sim froze for the first threat telegraphed in the level under way, and its base. */
async function firstWindow(
  page: Page,
): Promise<{ windowMs: number; baseMs: number; tier: string }> {
  await waitForTestApi(page);
  await waitForThreat(page, 'telegraph', FIRST_TELEGRAPH_TIMEOUT_MS);
  const world = await ppWorld(page);
  const threat = world.threats.find((candidate) => candidate.responseWindow !== null);
  if (threat === undefined || threat.responseWindow === null) throw new Error('no window');
  const baseMs = liveThreat(threat.defId).windowMs ?? liveFeel.timing.windowMs;
  return { windowMs: threat.responseWindow.windowMs, baseMs, tier: world.difficultyTier };
}

test.describe('Réglages over the pause', () => {
  test('replace the panel, keep the level alive under them, and give the panel back on Retour', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', FIRST_TELEGRAPH_TIMEOUT_MS);
    await pauseWithEscape(page);
    const before = {
      markers: await page.locator('.pp-threat').count(),
      objects: await page.locator('.pp-object').count(),
      objectPx: await html(page).getAttribute('data-pp-object-px'),
      flow: await html(page).getAttribute('data-pp-flow'),
      combo: await html(page).getAttribute('data-pp-combo'),
      simMs: (await ppWorld(page)).time.sim,
      commands: ((await journal(page))?.entries ?? []).length,
    };
    expect(before.markers).toBeGreaterThan(0);

    await pauseButton(page, STRINGS['pause.settings']).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    // One screen in the layer, with focus on the selected tier (the first row).
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: STRINGS['settings.title'] })).toBeVisible();
    await expect(radio(page, 'normal')).toBeFocused();
    await expect(radio(page, 'normal')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#pp-hud')).toHaveJSProperty('inert', true);

    await closeSettings(page);
    // The pause panel is back, on its first button; nothing resumed.
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(pauseButton(page, STRINGS['pause.resume'])).toBeFocused();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    // The level was never torn down: its markers, its objects, its mirrors and its clock are as they were.
    expect(await page.locator('.pp-threat').count()).toBe(before.markers);
    expect(await page.locator('.pp-object').count()).toBe(before.objects);
    expect(await html(page).getAttribute('data-pp-object-px')).toBe(before.objectPx);
    expect(await html(page).getAttribute('data-pp-flow')).toBe(before.flow);
    expect(await html(page).getAttribute('data-pp-combo')).toBe(before.combo);
    expect((await ppWorld(page)).time.sim).toBe(before.simMs);
    expect(((await journal(page))?.entries ?? []).length).toBe(before.commands);

    // Reprendre counts down and the game goes on.
    await pauseButton(page, STRINGS['pause.resume']).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await running(page);
    await expect.poll(async () => (await ppWorld(page)).time.sim).toBeGreaterThan(before.simMs);
    expect(problems).toEqual([]);
  });

  test('fit a landscape phone: the panel scrolls, the sliders let a vertical swipe through, every target is 44 px', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    const metrics = await panel(page).evaluate((element) => ({
      isScrollable: element.scrollHeight > element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      panelBottom: element.getBoundingClientRect().bottom,
    }));
    expect(metrics.isScrollable).toBe(true);
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.panelBottom).toBeLessThanOrEqual(LANDSCAPE.height);
    for (const bus of ['music', 'sfx', 'voice', 'ui'] as const) {
      await expect(slider(page, bus)).toHaveCSS('touch-action', 'pan-y');
    }
    const targets = [
      radio(page, 'assistance'),
      radio(page, 'normal'),
      radio(page, 'experienced'),
      slider(page, 'music'),
      ...(hasVibrate() ? [haptics(page)] : []),
      reducedMotionSwitch(page),
      largeVerbsSwitch(page),
      settingsButton(page, 'settings.recalibrate'),
      settingsButton(page, 'settings.credits'),
      settingsButton(page, 'settings.back'),
    ];
    for (const target of targets) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    // Crédits, which starts below the fold, is reached by touch.
    await settingsButton(page, 'settings.credits').tap();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'credits');
    expect(problems).toEqual([]);
  });

  test('reach Crédits by key: moving focus scrolls the row into view', async ({ page }) => {
    await startLevel(page);
    await openSettings(page);
    // tier, four volumes, the switch (where the device vibrates), the two comfort switches, Recalibrer, Crédits.
    const downs = hasVibrate() ? 9 : 8;
    for (let i = 0; i < downs; i++) await page.keyboard.press('ArrowDown');
    const credits = settingsButton(page, 'settings.credits');
    await expect(credits).toBeFocused();
    const box = await credits.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(LANDSCAPE.height);
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'credits');
  });
});

test.describe('the tier', () => {
  test.describe.configure({ timeout: 90_000 });

  test('Assistance: the hint and the note show, the save holds it at once, the game under way is untouched, « Recommencer » carries it', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await radio(page, 'assistance').click();
    await expect(radio(page, 'assistance')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(STRINGS['settings.tier_assistance_hint'] ?? '')).toBeVisible();
    await expect(page.getByText(STRINGS['settings.applies_next_game'] ?? '')).toBeVisible();
    await expect.poll(async () => (await savedSettings(page)).tier).toBe('assistance');
    // The game under way keeps its tier: nothing was sent.
    expect((await ppWorld(page)).difficultyTier).toBe('normal');
    expect(await tierCommands(page)).toEqual([]);

    await closeSettings(page);
    await pauseButton(page, STRINGS['pause.restart']).click();
    await running(page);
    const commands = await tierCommands(page);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toMatchObject({
      type: 'SetDifficultyTier',
      tier: 'assistance',
      t: 0,
    });
    const { windowMs, baseMs, tier } = await firstWindow(page);
    expect(tier).toBe('assistance');
    expect(windowMs).toBeCloseTo(baseMs * difficulty.assistance.windowMultiplier, 6);
    expect(problems).toEqual([]);
  });

  test('Papa expérimenté: its window is the tight one', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await radio(page, 'experienced').click();
    await expect(page.getByText(STRINGS['settings.tier_experienced_hint'] ?? '')).toBeVisible();
    await expect.poll(async () => (await savedSettings(page)).tier).toBe('experienced');
    await closeSettings(page);
    await pauseButton(page, STRINGS['pause.restart']).click();
    await running(page);
    const { windowMs, baseMs, tier } = await firstWindow(page);
    expect(tier).toBe('experienced');
    expect(windowMs).toBeCloseTo(baseMs * difficulty.experienced.windowMultiplier, 6);
    expect(problems).toEqual([]);
  });

  test.describe('back at Normal', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('sends no command: a game from a saved Assistance tier has one, and the next at Normal has none', async ({
      page,
    }) => {
      const problems = collectProblems(page);
      await seedStorage(page, SAVE_KEY, calibratedSaveValue({}, { tier: 'assistance' }));
      await startLevel(page);
      expect(await tierCommands(page)).toHaveLength(1);
      expect((await ppWorld(page)).difficultyTier).toBe('assistance');
      await openSettings(page);
      await expect(radio(page, 'assistance')).toBeFocused();
      await radio(page, 'normal').click();
      await expect.poll(async () => (await savedSettings(page)).tier).toBe('normal');
      await closeSettings(page);
      await pauseButton(page, STRINGS['pause.restart']).click();
      await running(page);
      expect(await tierCommands(page)).toEqual([]);
      const { windowMs, baseMs, tier } = await firstWindow(page);
      expect(tier).toBe('normal');
      expect(windowMs).toBeCloseTo(baseMs * difficulty.normal.windowMultiplier, 6);
      expect(problems).toEqual([]);
    });

    test('a reload keeps the tier, the volumes and the switches', async ({ page }) => {
      const problems = collectProblems(page);
      await seedStorage(page, SAVE_KEY, calibratedSaveValue());
      await startLevel(page);
      await openSettings(page);
      await radio(page, 'experienced').click();
      await slider(page, 'music').fill('40');
      await slider(page, 'ui').fill('0');
      if (hasVibrate()) await haptics(page).click();
      await reducedMotionSwitch(page).click();
      await largeVerbsSwitch(page).click();
      await expect
        .poll(async () => savedSettings(page))
        .toEqual({
          tier: 'experienced',
          volumes: { music: 40, sfx: 100, voice: 100, ui: 0 },
          haptics: !hasVibrate(),
          reducedMotion: true,
          largeVerbs: true,
        });
      await page.reload();
      await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
      await page.locator('.pp-start-screen').click();
      await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
      await running(page);
      await openSettings(page);
      await expect(radio(page, 'experienced')).toHaveAttribute('aria-checked', 'true');
      await expect(slider(page, 'music')).toHaveValue('40');
      await expect(slider(page, 'ui')).toHaveValue('0');
      if (hasVibrate()) await expect(haptics(page)).toHaveAttribute('aria-checked', 'false');
      await expect(reducedMotionSwitch(page)).toHaveAttribute('aria-checked', 'true');
      await expect(largeVerbsSwitch(page)).toHaveAttribute('aria-checked', 'true');
      await expect(html(page)).toHaveAttribute('data-pp-volumes', '40,100,100,0');
      await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
      expect(problems).toEqual([]);
    });
  });
});

test.describe('the volumes and the vibrations', () => {
  test('each change reaches the save at once, and the audio buses', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await slider(page, 'sfx').fill('55');
    await expect.poll(async () => (await savedSettings(page)).volumes.sfx).toBe(55);
    await slider(page, 'voice').fill('0');
    await expect.poll(async () => (await savedSettings(page)).volumes.voice).toBe(0);
    await expect(html(page)).toHaveAttribute('data-pp-volumes', '100,55,0,100');
    const save = await readSave(page);
    expect(save?.version).toBe(3);
    expect(save?.settings.volumes).toEqual({ music: 100, sfx: 55, voice: 0, ui: 100 });
    expect(save?.calibration).not.toBeNull();
    expect(problems).toEqual([]);
  });

  test('the switch flips and saves; with it off a cue still plays but nothing vibrates', async ({
    page,
  }) => {
    test.skip(!hasVibrate(), 'WebKit has no navigator.vibrate: there is no switch to flip');
    const problems = collectProblems(page);
    await page.addInitScript(() => {
      const seen: number[][] = [];
      Object.assign(window, { ppVibrations: seen });
      const original = navigator.vibrate?.bind(navigator);
      if (original === undefined) return;
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (pattern: number[]) => {
          seen.push([...pattern]);
          return original(pattern);
        },
      });
    });
    await startLevel(page);
    await openSettings(page);
    await expect(haptics(page)).toBeVisible();
    await expect(haptics(page)).toHaveAttribute('aria-checked', 'true');
    await haptics(page).click();
    await expect(haptics(page)).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await savedSettings(page)).haptics).toBe(false);
    const cuesBefore = Number(await html(page).getAttribute('data-pp-cue-count'));
    const vibratedBefore = await page.evaluate(
      () => (window as unknown as { ppVibrations: number[][] }).ppVibrations.length,
    );
    await closeSettings(page);
    await pauseButton(page, STRINGS['pause.resume']).click();
    await running(page);
    // The countdown ticks (a cue with a pulse) and the first threat telegraphs: cues play, none vibrates.
    await waitForThreat(page, 'telegraph', FIRST_TELEGRAPH_TIMEOUT_MS);
    expect(Number(await html(page).getAttribute('data-pp-cue-count'))).toBeGreaterThan(cuesBefore);
    const vibrated = await page.evaluate(
      () => (window as unknown as { ppVibrations: number[][] }).ppVibrations.length,
    );
    expect(vibrated).toBe(vibratedBefore);
    expect(problems).toEqual([]);
  });

  test.describe('on a device that cannot vibrate', () => {
    test('the Vibrations row is not built', async ({ page }) => {
      const problems = collectProblems(page);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
      });
      await startLevel(page);
      await expect(html(page)).toHaveAttribute('data-pp-haptics', 'false');
      await openSettings(page);
      // The two comfort switches need no hardware: only Vibrations is gone.
      await expect(haptics(page)).toHaveCount(0);
      await expect(page.getByRole('switch')).toHaveCount(2);
      await expect(reducedMotionSwitch(page)).toBeVisible();
      await expect(largeVerbsSwitch(page)).toBeVisible();
      await expect(slider(page, 'music')).toBeVisible();
      expect(problems).toEqual([]);
    });
  });
});

test.describe('the comfort switches (story 2.10)', () => {
  const rootScale = (page: Page): Promise<string> =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pp-verb-scale').trim(),
    );

  test('both flip, save at once, and apply with no reload', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await expect(reducedMotionSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(largeVerbsSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(html(page)).not.toHaveAttribute('data-pp-motion', /./);
    await expect(deviceNote(page)).toHaveCount(0);
    expect(await rootScale(page)).toBe('1');

    await reducedMotionSwitch(page).click();
    await expect(reducedMotionSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await savedSettings(page)).reducedMotion).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');

    await largeVerbsSwitch(page).tap();
    await expect(largeVerbsSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await savedSettings(page)).largeVerbs).toBe(true);
    await expect.poll(() => rootScale(page)).toBe('1.25');

    // Off again: the attribute goes, the scale is back to 1, and the other settings never moved.
    await reducedMotionSwitch(page).click();
    await largeVerbsSwitch(page).click();
    await expect(html(page)).not.toHaveAttribute('data-pp-motion', /./);
    await expect.poll(() => rootScale(page)).toBe('1');
    expect(await savedSettings(page)).toMatchObject({
      tier: 'normal',
      reducedMotion: false,
      largeVerbs: false,
    });
    // Still in the settings, over the paused level: a switch never leaves or resumes.
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    expect(problems).toEqual([]);
  });

  test('the OS already asks for reduced motion: the switch reads off and a note under it says why', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
    await openSettings(page);
    await expect(reducedMotionSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(deviceNote(page)).toBeVisible();
    await expect(reducedMotionSwitch(page)).toHaveAccessibleDescription(
      STRINGS['settings.reduced_motion_device'] as string,
    );
    // The note is under the switch it explains, not under another row.
    const order = await page.evaluate(() => {
      const switches = [...document.querySelectorAll('.pp-settings-panel [role="switch"]')];
      const note = document.querySelector('#pp-settings-motion-device');
      const motion = switches.find((one) => one.getAttribute('aria-describedby') === note?.id);
      return motion?.nextElementSibling === note;
    });
    expect(order).toBe(true);
    // Flipping the switch on the device that already asks changes nothing visible, and saves.
    await reducedMotionSwitch(page).click();
    await expect.poll(async () => (await savedSettings(page)).reducedMotion).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
    expect(problems).toEqual([]);
  });

  test('« Grands verbes » refits the verb of a marker already on screen, from 32 to 40 px', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = collectProblems(page);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', FIRST_TELEGRAPH_TIMEOUT_MS);
    await openSettings(page);
    const verb = page.locator('.pp-threat-verb:visible').first();
    const fontPx = async (): Promise<number> =>
      verb.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    await expect(verb).toBeVisible();
    expect(await fontPx()).toBeCloseTo(32, 0);
    await largeVerbsSwitch(page).click();
    await expect.poll(fontPx).toBeCloseTo(40, 0);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await largeVerbsSwitch(page).click();
    await expect.poll(fontPx).toBeCloseTo(32, 0);
    expect(problems).toEqual([]);
  });

  test('a press does not restart the panel: no animation runs and it stays opaque, both ways', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    const state = () =>
      panel(page).evaluate((element) => ({
        animations: element.getAnimations().length,
        opacity: getComputedStyle(element).opacity,
      }));
    // The panel's entry has played out: a finished animation with a fill is still listed.
    await panel(page).evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    for (const field of ['reducedMotion', 'largeVerbs'] as const) {
      const row = field === 'reducedMotion' ? reducedMotionSwitch(page) : largeVerbsSwitch(page);
      for (const isOn of [true, false]) {
        await row.click();
        expect(await state(), `${field} ${isOn ? 'on' : 'off'}`).toEqual({
          animations: 0,
          opacity: '1',
        });
        await expect(row).toHaveAttribute('aria-checked', String(isOn));
      }
    }
    // The name of the animation flipped (pp-pop-in ↔ pp-fade-in) while the panel stood still.
    await reducedMotionSwitch(page).click();
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
    expect(await state()).toEqual({ animations: 0, opacity: '1' });
    expect(problems).toEqual([]);
  });
});

test.describe('Recalibrer', () => {
  test('stops the music, measures with the audio running, goes back to the settings, and the music plays after Reprendre', async ({
    page,
  }) => {
    test.setTimeout(CALIBRATION_TIMEOUT_MS + 60_000);
    const problems = collectProblems(page);
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await openSettings(page);
    await settingsButton(page, 'settings.recalibrate').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'calibration');
    // The music does not play under the beeps.
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-calibration', 'audio', { timeout: 15_000 });
    await tapOnEveryBeat(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings', {
      timeout: CALIBRATION_TIMEOUT_MS,
    });
    // The audio phase really ran (a context left suspended by the pause would have skipped it).
    const save = await readSave(page);
    expect(save?.calibration?.audioSkipped).toBe(false);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    // The context is suspended again under the paused settings (D3): the panel is silent.
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'suspended');
    // Still stopped here: the loops restart from the top when the settings go back to the level.
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await expect(radio(page, 'normal')).toBeFocused();
    await closeSettings(page);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    await pauseButton(page, STRINGS['pause.resume']).click();
    await running(page);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    // The recalibration reached the live sim as a SetInputLag.
    const lagCommands = ((await journal(page))?.entries ?? []).filter(
      (entry) => entry.command.type === 'SetInputLag',
    );
    expect(lagCommands.length).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });
});

test.describe('Crédits', () => {
  test('open from the settings, focus Retour, and go back to the settings (Retour, Escape)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await settingsButton(page, 'settings.credits').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'credits');
    await expect(page.getByRole('dialog', { name: STRINGS['credits.title'] })).toBeVisible();
    await expect(page.getByText(STRINGS['credits.body'] ?? '')).toBeVisible();
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(settingsButton(page, 'settings.back')).toBeFocused();
    await settingsButton(page, 'settings.back').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await settingsButton(page, 'settings.credits').click();
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    // Escape from the settings goes back to the pause panel; it never resumes the game.
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(pauseButton(page, STRINGS['pause.resume'])).toBeFocused();
    expect(problems).toEqual([]);
  });
});

test.describe('the pad', () => {
  test('the D-pad walks every row, left and right change the row, A presses, B goes back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await startLevel(page);
    await pad.setPadPresent(true);
    await openSettings(page);
    await expect(radio(page, 'normal')).toBeFocused();

    // Down through the four volumes, the switches, and the three buttons.
    const rows = [
      slider(page, 'music'),
      slider(page, 'sfx'),
      slider(page, 'voice'),
      slider(page, 'ui'),
      ...(hasVibrate() ? [haptics(page)] : []),
      reducedMotionSwitch(page),
      largeVerbsSwitch(page),
      settingsButton(page, 'settings.recalibrate'),
      settingsButton(page, 'settings.credits'),
      settingsButton(page, 'settings.back'),
    ];
    for (const row of rows) {
      await pad.tapButton(PAD.down);
      await expect(row).toBeFocused();
    }
    await pad.tapButton(PAD.down); // wraps to the first row: the selected tier
    await expect(radio(page, 'normal')).toBeFocused();
    await pad.tapButton(PAD.up); // and back to the last
    await expect(settingsButton(page, 'settings.back')).toBeFocused();

    // Left and right change the focused row: a radio selects its neighbour and wraps…
    await pad.tapButton(PAD.down);
    await expect(radio(page, 'normal')).toBeFocused();
    await pad.tapButton(PAD.left);
    await expect(radio(page, 'assistance')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, 'assistance')).toBeFocused();
    await pad.tapButton(PAD.left);
    await expect(radio(page, 'experienced')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await savedSettings(page)).tier).toBe('experienced');
    // …a slider moves one step and clamps.
    await pad.tapButton(PAD.down);
    await expect(slider(page, 'music')).toBeFocused();
    await pad.tapButton(PAD.right); // already at 100: clamps
    await expect(slider(page, 'music')).toHaveValue('100');
    await pad.tapButton(PAD.left);
    await expect(slider(page, 'music')).toHaveValue('95');
    await expect.poll(async () => (await savedSettings(page)).volumes.music).toBe(95);
    // A does nothing on a range.
    await pad.tapButton(PAD.a);
    await expect(slider(page, 'music')).toHaveValue('95');
    // A presses the switch (where the device vibrates)…
    for (const bus of ['sfx', 'voice', 'ui'] as const) {
      await pad.tapButton(PAD.down);
      await expect(slider(page, bus)).toBeFocused();
    }
    if (hasVibrate()) {
      await pad.tapButton(PAD.down);
      await expect(haptics(page)).toBeFocused();
      const before = await haptics(page).getAttribute('aria-checked');
      await pad.tapButton(PAD.a);
      await expect(haptics(page)).toHaveAttribute(
        'aria-checked',
        before === 'true' ? 'false' : 'true',
      );
    }
    // …and the two comfort switches, which every device has…
    for (const [comfort, field] of [
      [reducedMotionSwitch(page), 'reducedMotion'],
      [largeVerbsSwitch(page), 'largeVerbs'],
    ] as const) {
      await pad.tapButton(PAD.down);
      await expect(comfort).toBeFocused();
      await pad.tapButton(PAD.a);
      await expect(comfort).toHaveAttribute('aria-checked', 'true');
      await expect.poll(async () => (await savedSettings(page))[field]).toBe(true);
    }
    // …and a button: Crédits, then B back to the settings, then B back to the pause panel.
    await pad.tapButton(PAD.down);
    await pad.tapButton(PAD.down);
    await expect(settingsButton(page, 'settings.credits')).toBeFocused();
    await pad.tapButton(PAD.a);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'credits');
    await pad.tapButton(PAD.b);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await pad.tapButton(PAD.b);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    expect(problems).toEqual([]);
  });
});

test.describe('an uncaught error over a live level', () => {
  // The page's own error is the point: no `collectProblems` here.
  const throwInPage = (page: Page): Promise<void> =>
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error('forced by the spec');
      });
    });

  test('in the settings it stops the level and offers « Oups »', async ({ page }) => {
    await startLevel(page);
    await openSettings(page);
    await throwInPage(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    // The level is gone: its markers do not stay up behind the screen.
    await expect(page.locator('.pp-threat')).toHaveCount(0);
    await expect(page.locator('.pp-object')).toHaveCount(0);
  });

  test('in the credits too', async ({ page }) => {
    await startLevel(page);
    await openSettings(page);
    await settingsButton(page, 'settings.credits').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'credits');
    await throwInPage(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
  });

  test('and in a recalibration started from them', async ({ page }) => {
    await startLevel(page);
    await openSettings(page);
    await settingsButton(page, 'settings.recalibrate').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'calibration');
    await throwInPage(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'oops');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
  });
});

test.describe('a pad pulled out under the settings', () => {
  test('keeps the settings up, and the pause panel shows the line when it comes back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await startLevel(page);
    await pad.setPadPresent(true);
    await openSettings(page);
    // The pad is the device in use (the D-pad moved the focus), so losing it is news.
    await pad.tapButton(PAD.down);
    await expect(slider(page, 'music')).toBeFocused();
    await pad.setPadPresent(false);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(page.getByText(STRINGS['pause.gamepad_disconnected'] ?? '')).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('the portrait overlay', () => {
  test('covers the settings, which come back as saved when the phone is turned', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await openSettings(page);
    await radio(page, 'assistance').click();
    await slider(page, 'music').fill('30');
    await reducedMotionSwitch(page).click();
    await largeVerbsSwitch(page).click();
    await expect.poll(async () => (await savedSettings(page)).volumes.music).toBe(30);
    await expect.poll(async () => (await savedSettings(page)).largeVerbs).toBe(true);

    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');

    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('.pp-portrait-screen')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: STRINGS['settings.title'] })).toBeVisible();
    await expect(radio(page, 'assistance')).toHaveAttribute('aria-checked', 'true');
    await expect(slider(page, 'music')).toHaveValue('30');
    await expect(reducedMotionSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(largeVerbsSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'settings');
    expect(problems).toEqual([]);
  });
});

test.describe('the save on disk', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a v1 save migrates: the calibration is kept, the settings are the defaults, it is written back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const v1 = JSON.parse(calibratedSaveValue({ visualOffsetMs: 20 })) as StoredSave;
    await seedStorage(page, SAVE_KEY, JSON.stringify({ version: 1, calibration: v1.calibration }));
    await openGame(page);
    const save = await readSave(page);
    expect(save?.version).toBe(3);
    expect(save?.calibration?.visualOffsetMs).toBe(20);
    expect(save?.settings).toEqual({
      tier: 'normal',
      volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
      haptics: true,
      reducedMotion: false,
      largeVerbs: false,
    });
    expect(await readRaw(page, INVALID_KEY)).toBeNull();
    expect(problems).toEqual([]);
  });

  test('a v2 save migrates: every setting is kept, both comfort switches are off, it is written back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const v3 = JSON.parse(
      calibratedSaveValue(
        { visualOffsetMs: 20 },
        { tier: 'experienced', haptics: false, volumes: { music: 40, sfx: 55, voice: 70, ui: 85 } },
      ),
    ) as StoredSave;
    const { reducedMotion: _motion, largeVerbs: _verbs, ...v2Settings } = v3.settings;
    await seedStorage(
      page,
      SAVE_KEY,
      JSON.stringify({ version: 2, calibration: v3.calibration, settings: v2Settings }),
    );
    await openGame(page);
    const save = await readSave(page);
    expect(save?.version).toBe(3);
    expect(save?.calibration?.visualOffsetMs).toBe(20);
    expect(save?.settings).toEqual({ ...v2Settings, reducedMotion: false, largeVerbs: false });
    expect(await readRaw(page, INVALID_KEY)).toBeNull();
    await expect(html(page)).not.toHaveAttribute('data-pp-motion', /./);
    expect(problems).toEqual([]);
  });

  test('a save from a newer game stays where it is, is copied aside, and the game runs on defaults', async ({
    page,
  }) => {
    const future = JSON.stringify({
      ...JSON.parse(calibratedSaveValue()),
      version: 4,
      tomorrow: true,
    });
    await seedStorage(page, SAVE_KEY, future);
    await openGame(page);
    expect(await readRaw(page)).toBe(future);
    expect(await readRaw(page, INVALID_KEY)).toBe(future);
    // Defaults: no calibration, so the first gesture opens it. And still nothing is written.
    await page.locator('.pp-start-screen').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'calibration');
    expect(await readRaw(page)).toBe(future);
  });
});
