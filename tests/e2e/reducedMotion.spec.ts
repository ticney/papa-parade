import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { SCREEN_FLASH_CLASSES } from '../../src/client/ui/hud/screenFlash.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  FIRST_WAVE_RESPONSE_MAX_MS,
  html,
  OVERRUN_MARGIN_MS,
  objectIconPoint,
  startLevel,
  WALK_BOUND_MS,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The two comfort settings (story 2.10). The player's « Réduire les animations » reaches the effects of
// the screen (camera, shake, flash, panels) exactly as the OS preference did in 2.5, and « Grands
// verbes » makes every verb 25 % larger without cutting one. A bot plays in the real browser; every
// bound comes from the live content or from the live plan, and no spec waits on a fixed delay. The OS
// preference stays at `no-preference` throughout: what moves is the saved setting, which is what proves
// it reaches the JS and the CSS. What no spec can judge, and Geo must: whether the softer game still
// feels like the same game, and whether the larger verbs read well on the smallest phone.

const LEVEL = 'salon_crawler';
const SEED = 42;
const SPEED = 4;
const AUTOPLAY = `/?autoplay=perfect&seed=${SEED}&speed=${SPEED}`;
/** The perfects the bot must land before the sampler is read. */
const PERFECTS = 3;
/** Responses compared between a run with the setting and a run without. */
const COMPARED_RESPONSES = 5;
/** Chunks of 10 steps the sim may take to let a Papa at full fatigue fall asleep (30 s of sim time). */
const FATIGUE_CHUNKS_MAX = Math.ceil(30_000 / (10 * STEP_MS));

const live = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  fx: { perfectCamera: { zoomPct: number } };
};
const { zoomPct } = live.fx.perfectCamera;

/** Real ms for the perfect bot to get its first response: a bound from the live plan. */
const FIRST_RESPONSE_TIMEOUT_MS =
  RESUME_COUNTDOWN_MS +
  (FIRST_TELEGRAPH_MAX_MS + FIRST_WAVE_RESPONSE_MAX_MS) / SPEED +
  2 * OVERRUN_MARGIN_MS;
const RESPONSES_TIMEOUT_MS = (COMPARED_RESPONSES + 2) * FIRST_RESPONSE_TIMEOUT_MS;

/** Saves the player's comfort settings before the page loads: every load starts from them. */
async function seedSettings(
  page: Page,
  settings: { reducedMotion?: boolean; largeVerbs?: boolean },
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_STORAGE_KEY, calibratedSaveValue({}, settings)],
  );
}

/** Samples `__PP__.fx()` at every frame: polling would miss an effect that short at speed 4. */
async function installFxSampler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const maxima = { yawDeg: 0, shakeM: 0, zoom: 1 };
    Object.assign(window, { ppFxMax: maxima });
    const sample = (): void => {
      const fx = window.__PP__?.fx();
      if (fx !== undefined) {
        maxima.yawDeg = Math.max(maxima.yawDeg, Math.abs(fx.cameraYawDeg));
        maxima.shakeM = Math.max(maxima.shakeM, Math.abs(fx.shakeOffsetM));
        maxima.zoom = Math.max(maxima.zoom, fx.cameraZoom);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

const fxMaxima = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { ppFxMax: { yawDeg: number; shakeM: number; zoom: number } }).ppFxMax,
  );

const resolved = async (page: Page) =>
  (await ppEvents(page)).flatMap((event) => (event.type === 'ResponseResolved' ? [event] : []));

/** Waits until the bot has landed `count` perfect responses. */
async function waitForPerfects(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await resolved(page)).filter((e) => e.quality === 'perfect').length, {
      timeout: (count + 1) * FIRST_RESPONSE_TIMEOUT_MS,
      message: `the bot never landed ${count} perfects`,
    })
    .toBeGreaterThanOrEqual(count);
}

test.describe('« Réduire les animations » on a bot-played level', () => {
  test.describe.configure({ timeout: (PERFECTS + 2) * FIRST_RESPONSE_TIMEOUT_MS });

  test('the camera does not turn, nothing shakes, the zoom is capped at half', async ({ page }) => {
    const problems = collectProblems(page);
    await seedSettings(page, { reducedMotion: true });
    await installFxSampler(page);
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    await waitForPerfects(page, PERFECTS);
    const maxima = await fxMaxima(page);
    expect(maxima.yawDeg).toBe(0);
    expect(maxima.shakeM).toBe(0);
    expect(maxima.zoom).toBeLessThanOrEqual(1 + zoomPct / 200 + 1e-9);
    // The zoom is capped, not removed: it still moves.
    expect(maxima.zoom).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });

  test('positive control: with the setting off, the same sampler sees the camera turn and the shake', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await seedSettings(page, { reducedMotion: false });
    await installFxSampler(page);
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    await waitForPerfects(page, PERFECTS);
    const maxima = await fxMaxima(page);
    expect(maxima.yawDeg).toBeGreaterThan(0);
    expect(maxima.shakeM).toBeGreaterThan(0);
    expect(maxima.zoom).toBeGreaterThan(1 + zoomPct / 200);
    expect(problems).toEqual([]);
  });

  test('a perfect plays no shake, and its flash carries the glow instead of the full screen', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await seedSettings(page, { reducedMotion: true });
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    await waitForPerfects(page, 1);
    const log = await ppCueLog(page);
    expect(log.some((record) => record.visuals.includes('shake'))).toBe(false);
    expect(log.some((record) => record.visuals.includes('flash'))).toBe(true);
    await expect(page.locator(`.${SCREEN_FLASH_CLASSES.root}`)).toHaveClass(
      new RegExp(SCREEN_FLASH_CLASSES.glow),
    );
    expect(problems).toEqual([]);
  });

  test('positive control: with the setting off, a perfect shakes and its flash is the full screen', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await seedSettings(page, { reducedMotion: false });
    await page.goto(AUTOPLAY);
    await waitForTestApi(page);
    await waitForPerfects(page, 1);
    expect((await ppCueLog(page)).some((record) => record.visuals.includes('shake'))).toBe(true);
    await expect(page.locator(`.${SCREEN_FLASH_CLASSES.root}`)).not.toHaveClass(
      new RegExp(SCREEN_FLASH_CLASSES.glow),
    );
    expect(problems).toEqual([]);
  });

  test('it is the same game: the first responses are judged identically with and without the setting', async ({
    context,
  }) => {
    test.setTimeout(2 * RESPONSES_TIMEOUT_MS);
    const judgements = async (reducedMotion: boolean) => {
      const page = await context.newPage();
      const problems = collectProblems(page);
      await seedSettings(page, { reducedMotion });
      await page.goto(AUTOPLAY);
      await waitForTestApi(page);
      await expect
        .poll(async () => (await resolved(page)).length, { timeout: RESPONSES_TIMEOUT_MS })
        .toBeGreaterThanOrEqual(COMPARED_RESPONSES);
      const first = (await resolved(page)).slice(0, COMPARED_RESPONSES).map((event) => ({
        t: event.t,
        threatId: event.threatId,
        response: event.response,
        quality: event.quality,
        offsetMs: event.offsetMs,
        responseWindow: event.responseWindow,
      }));
      expect(problems).toEqual([]);
      await page.close();
      return first;
    };
    const withSetting = await judgements(true);
    const without = await judgements(false);
    expect(withSetting).toHaveLength(COMPARED_RESPONSES);
    expect(withSetting).toStrictEqual(without);
  });
});

test.describe('the CSS follows the saved setting, not the OS', () => {
  /** The animation name a class would have on the page, read from the real stylesheet. */
  const animationNameOf = (page: Page, className: string): Promise<string> =>
    page.evaluate((name) => {
      const probe = document.createElement('div');
      probe.className = name;
      document.body.append(probe);
      const animationName = getComputedStyle(probe).animationName;
      probe.remove();
      return animationName;
    }, className);

  test('with the setting on: the attribute is there, the panel fades, the bubble pulses, the bottle is still', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seedSettings(page, { reducedMotion: true });
    await page.goto('/');
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
    expect(await animationNameOf(page, 'pp-panel')).toBe('pp-fade-in');
    expect(await animationNameOf(page, 'pp-silence-bubble')).toBe('pp-silence-pulse');
    expect(await animationNameOf(page, 'pp-bottle-fill')).toBe('none');
    expect(problems).toEqual([]);
  });

  test('positive control: with the setting off, the same probes see the normal animations', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seedSettings(page, { reducedMotion: false });
    await page.goto('/');
    await waitForTestApi(page);
    await expect(html(page)).not.toHaveAttribute('data-pp-motion', /./);
    expect(await animationNameOf(page, 'pp-panel')).toBe('pp-pop-in');
    expect(await animationNameOf(page, 'pp-silence-bubble')).toBe('pp-silence-blink');
    expect(await animationNameOf(page, 'pp-bottle-fill')).not.toBe('none');
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// « Grands verbes »: 25 % larger, and never cut.
// ---------------------------------------------------------------------------------------------

/** What a verb looks like once drawn: its box, and whether anything could have cut it. */
interface DrawnVerb {
  text: string | null;
  fontPx: number;
  scrollWidth: number;
  offsetWidth: number;
  overflow: string;
  textOverflow: string;
  box: { x: number; y: number; right: number; bottom: number };
}

const drawnVerbs = (page: Page): Promise<DrawnVerb[]> =>
  page.locator('.pp-threat-verb').evaluateAll((elements) =>
    elements
      .filter((element) => {
        let node: Element | null = element;
        while (node !== null) {
          if (getComputedStyle(node).display === 'none') return false;
          node = node.parentElement;
        }
        return true;
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent,
          fontPx: Number.parseFloat(style.fontSize),
          scrollWidth: element.scrollWidth,
          offsetWidth: (element as HTMLElement).offsetWidth,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          box: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
        };
      }),
  );

async function expectWhole(page: Page, verbs: DrawnVerb[], what: string): Promise<void> {
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  expect(verbs.length, `${what}: a verb is on screen`).toBeGreaterThan(0);
  for (const verb of verbs) {
    const label = `${what}: « ${verb.text} »`;
    expect(verb.scrollWidth, `${label} is not wider than its box`).toBeLessThanOrEqual(
      verb.offsetWidth,
    );
    expect(verb.overflow, label).not.toBe('hidden');
    expect(verb.textOverflow, label).not.toBe('ellipsis');
    expect(verb.box.x, `${label} starts on the screen`).toBeGreaterThanOrEqual(0);
    expect(verb.box.right, `${label} ends on the screen`).toBeLessThanOrEqual(viewport.w);
    expect(verb.box.y, `${label} starts below the top`).toBeGreaterThanOrEqual(0);
    expect(verb.box.bottom, `${label} ends above the bottom`).toBeLessThanOrEqual(viewport.h);
  }
}

// The phone the project tests on (the configured viewport), then the two smallest landscape phones
// the game supports (review of story 2.10: the floor of a long verb rises with the setting, and
// nothing else kept a verb or the hint above Papa inside the screen).
const VERB_SCREENS: ReadonlyArray<{
  label: string;
  viewport: { width: number; height: number } | null;
}> = [
  { label: '844 × 390, compact', viewport: null },
  { label: '667 × 375', viewport: { width: 667, height: 375 } },
  { label: '568 × 320', viewport: { width: 568, height: 320 } },
];

async function openFrozenWithLargeVerbs(page: Page): Promise<void> {
  await seedSettings(page, { largeVerbs: true });
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
  await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
}

for (const screen of VERB_SCREENS) {
  test.describe(`« Grands verbes » (${screen.label})`, () => {
    test.describe.configure({ timeout: 90_000 });
    if (screen.viewport !== null) test.use({ viewport: screen.viewport });
    const openFrozen = openFrozenWithLargeVerbs;

    if (screen.viewport === null) {
      test('the root carries the scale, and a verb is 25 % larger than the compact 32 px', async ({
        page,
      }) => {
        const problems = collectProblems(page);
        await openFrozen(page);
        expect(
          await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--pp-verb-scale').trim(),
          ),
        ).toBe('1.25');
        const world = await ppWorld(page);
        const first = world.threats[0];
        if (first === undefined) throw new Error('the level plans no threat');
        await ppSend(page, { type: 'ForceThreat', threatId: first.id });
        await ppAdvance(page, 1);
        await waitFrames(page, 2);
        const [verb] = await drawnVerbs(page);
        expect(verb?.fontPx).toBeCloseTo(40, 0);
        expect(problems).toEqual([]);
      });
    }

    largeVerbsWhole();
  });
}

function largeVerbsWhole(): void {
  const openFrozen = openFrozenWithLargeVerbs;

  test('every threat of the level shows its verb whole, inside the screen', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // A threat in a hidden zone has no marker until the player finds the silence, so it is left out
    // here (its verb is not measured): the markers of the others are all forced.
    const targetOf = (defId: string): string =>
      (JSON.parse(readFileSync(`content/threats/${defId}.json`, 'utf8')) as { target: string })
        .target;
    const defIds = [...new Set((await ppWorld(page)).threats.map((threat) => threat.defId))].filter(
      (defId) => targetOf(defId) !== 'hiddenZone',
    );
    expect(defIds.length).toBeGreaterThan(0);
    for (const defId of defIds) {
      await ppLoadLevel(page, LEVEL, SEED);
      const threat = (await ppWorld(page)).threats.find((candidate) => candidate.defId === defId);
      if (threat === undefined) throw new Error(`the level does not plan ${defId}`);
      if (targetOf(defId) === 'papa') {
        // The micro-sleep comes from fatigue, not from `ForceThreat`: Papa at the top of the gauge.
        await ppSend(page, { type: 'SetFatigue', points: 100 });
        for (let chunk = 0; chunk < FATIGUE_CHUNKS_MAX; chunk++) {
          const state = (await ppWorld(page)).threats.find((one) => one.id === threat.id)?.state;
          if (state !== 'idle') break;
          await ppAdvance(page, 10);
        }
      } else {
        await ppSend(page, { type: 'ForceThreat', threatId: threat.id });
      }
      await ppAdvance(page, 1);
      await waitFrames(page, 2);
      await expectWhole(page, await drawnVerbs(page), defId);
    }
    expect(problems).toEqual([]);
  });

  test('the longest string, « POSE-LE D’ABORD ! », is whole too (the hint above Papa)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // With the baby in the arms, a tap on the toilet door is refused and says why above Papa.
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await ppWorld(page)).baby.state === 'carried') break;
      await ppSend(page, { type: 'TapBaby' });
      for (let i = 0; i < Math.ceil(WALK_BOUND_MS / (10 * STEP_MS)); i++) {
        if ((await ppWorld(page)).baby.state === 'carried') break;
        await ppAdvance(page, 10);
      }
    }
    expect((await ppWorld(page)).baby.state).toBe('carried');
    const at = await objectIconPoint(page, 'toilet');
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 2);
    await expect(page.locator('.pp-papa-hint')).toHaveText(
      STRINGS['verb.put_down_first'] as string,
    );
    await waitFrames(page, 2);
    const hint = (await drawnVerbs(page)).filter(
      (verb) => verb.text === STRINGS['verb.put_down_first'],
    );
    expect(hint).toHaveLength(1);
    expect(hint[0]?.fontPx).toBeGreaterThan(32);
    await expectWhole(page, hint, 'the hint');
    expect(problems).toEqual([]);
  });
}
