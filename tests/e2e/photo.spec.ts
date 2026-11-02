import { expect, type Page, test } from '@playwright/test';
import {
  advanceToEnd,
  collectProblems,
  cueCount,
  html,
  liveFeedback,
  mirrorWrites,
  recordMirrorWrites,
  THREATS_OFF,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  waitForTestApi,
} from './support/testApi.ts';

// The end photo (story 3.6): a 2D canvas of the frozen room, taken once at `LevelScored`, in a polaroid
// left of the Result panel; the flash and the shutter with it; Mama's header after it. A frozen level is
// stepped to its end through the test API, and the sequence is followed through `data-pp-result` and
// `data-pp-photo`. The tilt is random, so nothing here pins it, and there is no screenshot reference.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PANEL = '.pp-result-panel';
const POLAROID = '.pp-polaroid';
const PHOTO = `${POLAROID} canvas`;
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
const SEQUENCE_TIMEOUT_MS = 15_000;
const GRACE_MARGIN_MS = 60;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const { photo: PHOTO_SETTINGS, resultScreen } = liveFeedback;

/** What the page saw at the instant `data-pp-result` became `photo` (a mutation observer, so no polling race). */
interface PhotoShot {
  isHudHidden: boolean;
  panelOpacity: string | null;
  hasPolaroid: boolean;
  polaroidAnimation: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  hasHeader: boolean;
  hasPanelFocus: boolean;
  hasActions: boolean;
}

/** One frame where the flash was showing something. */
interface FlashSample {
  opacity: number;
  isInHud: boolean;
  isInHiddenParent: boolean;
  zIndex: number;
  isGlow: boolean;
  isOver: boolean;
}

/**
 * Before the page loads: records, each time `data-pp-result` becomes `photo`, what the screen looks
 * like then; and, every frame, the flash when it has any opacity. `hasPanelFocus` is read a frame later.
 */
async function recordPhotoMoment(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shots: unknown[] = [];
    const samples: unknown[] = [];
    Object.assign(window, { ppPhotoShots: shots, ppFlashSamples: samples });
    new MutationObserver(() => {
      if (document.documentElement.dataset.ppResult !== 'photo') return;
      const panel = document.querySelector('.pp-result-panel');
      const polaroid = document.querySelector('.pp-polaroid');
      const canvas = document.querySelector('.pp-polaroid canvas') as HTMLCanvasElement | null;
      shots.push({
        isHudHidden: (document.querySelector('#pp-hud') as HTMLElement).hidden,
        panelOpacity: panel === null ? null : getComputedStyle(panel).opacity,
        hasPolaroid: polaroid !== null,
        polaroidAnimation: polaroid === null ? null : getComputedStyle(polaroid).animationName,
        canvasWidth: canvas?.width ?? null,
        canvasHeight: canvas?.height ?? null,
        hasHeader: document.querySelector('.pp-result-reason') !== null,
        hasPanelFocus: false,
        hasActions: document.querySelector('.pp-result-actions:not([hidden])') !== null,
      });
      requestAnimationFrame(() => {
        (shots.at(-1) as { hasPanelFocus: boolean }).hasPanelFocus =
          document.activeElement === document.querySelector('.pp-result-panel');
      });
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-pp-result'] });
    const frame = (): void => {
      const flash = document.querySelector('.pp-screen-flash');
      if (flash !== null) {
        const style = getComputedStyle(flash);
        if (Number(style.opacity) > 0.02 || style.boxShadow !== 'none') {
          const opacity = Number(style.opacity);
          if (opacity > 0.02) {
            samples.push({
              opacity,
              isInHud: flash.closest('#pp-hud') !== null,
              isInHiddenParent: flash.closest('[hidden]') !== null,
              zIndex: Number(style.zIndex),
              isGlow: flash.classList.contains('pp-screen-flash--glow'),
              isOver: flash.classList.contains('pp-screen-flash--over'),
            });
          }
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

const photoShots = (page: Page): Promise<PhotoShot[]> =>
  page.evaluate(() => [...(window as unknown as { ppPhotoShots: PhotoShot[] }).ppPhotoShots]);
const flashSamples = (page: Page): Promise<FlashSample[]> =>
  page.evaluate(() => [...(window as unknown as { ppFlashSamples: FlashSample[] }).ppFlashSamples]);

/** Opens a frozen level and steps it to its end: a timer end, nobody threatened the room. */
async function openEnd(
  page: Page,
  options: { patch?: Parameters<typeof ppSetFeel>[1]; woken?: boolean } = {},
): Promise<void> {
  await page.goto(`/${THREATS_OFF}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  if (options.patch !== undefined) await ppSetFeel(page, options.patch);
  if (options.woken === true) {
    await ppSend(page, { type: 'SetNoise', pct: 100 });
    await ppAdvance(page, 1);
  } else {
    await advanceToEnd(page);
  }
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
}

/** The pixels of the polaroid's canvas, as a string: equal strings, equal pictures. */
const pixelsOfPhoto = (page: Page): Promise<string> =>
  page.locator(PHOTO).evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));

/**
 * What the canvas holds, over a grid of its pixels (a margin of 6 px left out, where a scaled copy may
 * blend): how many different colours, and how many pixels are not fully opaque. The renderer draws
 * opaque (`alpha: false`) and the vignette is ink over what is there, so a capture that copied the room
 * leaves no transparent pixel; one that drew nothing leaves the canvas transparent, and the vignette's
 * gradient over it still gives many colours (the alpha varies), which is why the colours alone prove nothing.
 */
const surveyOfPhoto = (
  page: Page,
): Promise<{ colourCount: number; notOpaqueCount: number; sampleCount: number }> =>
  page.locator(PHOTO).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    const colours = new Set<string>();
    let notOpaqueCount = 0;
    let sampleCount = 0;
    for (let y = 6; y < canvas.height - 6; y += 6) {
      for (let x = 6; x < canvas.width - 6; x += 6) {
        const data = context.getImageData(x, y, 1, 1).data;
        colours.add(data.join(','));
        if (data[3] !== 255) notOpaqueCount++;
        sampleCount++;
      }
    }
    return { colourCount: colours.size, notOpaqueCount, sampleCount };
  });

const waitForInputGrace = (page: Page): Promise<void> =>
  page.waitForTimeout(resultScreen.inputGraceMs + GRACE_MARGIN_MS);

async function waitForActions(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-result', 'actions', {
    timeout: SEQUENCE_TIMEOUT_MS,
  });
  await waitForInputGrace(page);
}

test.describe('the end photo', () => {
  test('takes one photo, then the sequence goes photo, rows, stars, actions', async ({ page }) => {
    await recordMirrorWrites(page, ['data-pp-result', 'data-pp-photo']);
    const problems = collectProblems(page);
    await openEnd(page);
    await waitForActions(page);
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    const writes = await mirrorWrites(page);
    const results = writes
      .filter(({ name }) => name === 'data-pp-result')
      .map(({ value }) => value);
    expect(results).toEqual(['photo', 'rows', 'stars', 'actions']);
    const photoWrites = writes.filter(({ name }) => name === 'data-pp-photo');
    expect(photoWrites.map(({ value }) => value)).toEqual(['taken']);
    // The photo is taken before the app enters `result`: the mirror is written first.
    expect(writes.findIndex(({ name }) => name === 'data-pp-photo')).toBeLessThan(
      writes.findIndex(({ name, value }) => name === 'data-pp-result' && value === 'photo'),
    );
    expect(problems).toEqual([]);
  });

  test('is a 2D canvas of the size feedback.json says, with a picture in it, never an image', async ({
    page,
  }) => {
    await openEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars|actions/);
    const canvas = page.locator(PHOTO);
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute('width', String(PHOTO_SETTINGS.widthPx));
    await expect(canvas).toHaveAttribute('height', String(PHOTO_SETTINGS.heightPx));
    await expect(canvas).toHaveAttribute('role', 'img');
    await expect(canvas).toHaveAttribute('aria-label', 'Photo de fin');
    // A room is many colours, all of them opaque: a capture that drew nothing leaves transparent
    // pixels (the vignette alone cannot fill them), and a one-colour photo is a flat fill.
    const survey = await surveyOfPhoto(page);
    expect(survey.sampleCount).toBeGreaterThan(500);
    expect(survey.notOpaqueCount).toBe(0);
    expect(survey.colourCount).toBeGreaterThan(8);
    // The CSP has no `img-src`: a `data:` or `blob:` image would be refused in the deployed build only.
    await expect(page.locator(`${POLAROID} img`)).toHaveCount(0);
    expect(await page.locator('#pp-ui img').count()).toBe(0);
  });

  test('stands alone first: the HUD hidden, the panel transparent, the polaroid dropping in', async ({
    page,
  }) => {
    await recordPhotoMoment(page);
    await openEnd(page);
    await waitForActions(page);
    const shots = await photoShots(page);
    expect(shots).toHaveLength(1);
    const [shot] = shots as [PhotoShot];
    expect(shot.isHudHidden).toBe(true);
    expect(shot.hasPolaroid).toBe(true);
    expect(shot.polaroidAnimation).toBe('pp-polaroid-drop');
    expect(shot.panelOpacity).toBe('0');
    expect(shot.canvasWidth).toBe(PHOTO_SETTINGS.widthPx);
    expect(shot.canvasHeight).toBe(PHOTO_SETTINGS.heightPx);
    expect(shot.hasActions).toBe(false);
    // The panel holds the focus although it is transparent (not `hidden`): Enter and Space are heard.
    expect(shot.hasPanelFocus).toBe(true);
    // The HUD stays hidden through the rest of the result.
    await expect(page.locator('#pp-hud')).toBeHidden();
  });

  test('plays the shutter once, and the flash is seen over the Result screen, outside the HUD', async ({
    page,
  }) => {
    await recordPhotoMoment(page);
    const problems = collectProblems(page);
    await openEnd(page);
    await waitForActions(page);
    const log = await ppCueLog(page);
    const shutters = log.filter((record) => record.cueId === 'photo_taken');
    expect(shutters).toHaveLength(1);
    expect(shutters[0]?.visuals).toEqual(expect.arrayContaining(['flash', 'uiElement']));
    // Not only what the log says it drew: the overlay really had opacity, outside the hidden HUD and above the panel.
    const samples = await flashSamples(page);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.isInHud).toBe(false);
      expect(sample.isInHiddenParent).toBe(false);
      expect(sample.isOver).toBe(true);
      // The pause panel (`#pp-ui`) is at 20, the HUD at 10: the flash is over the Result screen.
      expect(sample.zIndex).toBeGreaterThan(20);
      expect(sample.isGlow).toBe(false);
    }
    expect(problems).toEqual([]);
  });

  test('under reduced motion the flash is the border glow and the polaroid does not drop', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordPhotoMoment(page);
    await openEnd(page);
    await waitForActions(page);
    const [shot] = await photoShots(page);
    expect(shot?.polaroidAnimation).toBe('none');
    const samples = await flashSamples(page);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((sample) => sample.isGlow)).toBe(true);
    expect(
      await ppCueLog(page).then((log) => log.filter((r) => r.cueId === 'photo_taken')),
    ).toHaveLength(1);
  });

  test('a press during the photo skips to the end: panel and buttons up, the polaroid kept, no more sound', async ({
    page,
  }) => {
    await recordMirrorWrites(page, ['data-pp-result']);
    await openEnd(page);
    const pixels = await pixelsOfPhoto(page);
    const cuesBefore = await cueCount(page);
    await waitForInputGrace(page);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    const results = (await mirrorWrites(page)).map(({ value }) => value);
    // The press landed in the photo: no rows between it and the buttons.
    expect(results).toEqual(['photo', 'actions']);
    await expect(page.locator(POLAROID)).toBeVisible();
    expect(await pixelsOfPhoto(page)).toBe(pixels);
    await expect(page.locator(PANEL)).toHaveCSS('opacity', '1');
    await expect(page.locator(REPLAY)).toBeFocused();
    expect(await cueCount(page)).toBe(cuesBefore);
  });

  test('a screen rebuilt by the portrait overlay shows the same picture and tilt, with no cue and no flash', async ({
    page,
  }) => {
    await recordPhotoMoment(page);
    await openEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    const pixels = await pixelsOfPhoto(page);
    const tilt = await page
      .locator(POLAROID)
      .evaluate((node) => (node as HTMLElement).style.getPropertyValue('--pp-polaroid-tilt'));
    const cuesBefore = await cueCount(page);
    const samplesBefore = (await flashSamples(page)).length;
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    expect(await pixelsOfPhoto(page)).toBe(pixels);
    expect(
      await page
        .locator(POLAROID)
        .evaluate((node) => (node as HTMLElement).style.getPropertyValue('--pp-polaroid-tilt')),
    ).toBe(tilt);
    // At rest: no drop animation, no new cue, no new flash.
    await expect(page.locator(POLAROID)).toHaveCSS('animation-name', 'none');
    expect(await cueCount(page)).toBe(cuesBefore);
    expect((await flashSamples(page)).length).toBe(samplesBefore);
    await expect(page.locator('#pp-hud')).toBeHidden();
  });

  test('tilts within feedback.json › photo › tiltMaxDeg', async ({ page }) => {
    await openEnd(page);
    const tilt = await page
      .locator(POLAROID)
      .evaluate((node) => (node as HTMLElement).style.getPropertyValue('--pp-polaroid-tilt'));
    expect(tilt).toMatch(/^-?[\d.]+(?:e-?\d+)?deg$/);
    expect(Math.abs(Number.parseFloat(tilt))).toBeLessThanOrEqual(PHOTO_SETTINGS.tiltMaxDeg);
  });

  test('a woken Mama still has her photo, and her header comes after it, with the rows', async ({
    page,
  }) => {
    await recordMirrorWrites(page, ['data-pp-result']);
    await recordPhotoMoment(page);
    await openEnd(page, { woken: true });
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'mamaWoke');
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    await expect(page.locator(PHOTO)).toHaveCount(1);
    await expect(page.locator('.pp-result-reason')).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    const [shot] = await photoShots(page);
    // Nothing between the photo and Mama's reaction: no header while the photo stands alone.
    expect(shot?.hasHeader).toBe(false);
    const results = (await mirrorWrites(page)).map(({ value }) => value);
    expect(results.slice(0, 2)).toEqual(['photo', 'rows']);
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.indexOf('photo_taken')).toBeGreaterThanOrEqual(0);
    expect(cues.indexOf('mama_woke')).toBeGreaterThan(cues.indexOf('photo_taken'));
  });

  test('a skip in the photo brings a woken header up at rest: no slam, no door cue', async ({
    page,
  }) => {
    await openEnd(page, { woken: true });
    await waitForInputGrace(page);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    const header = page.locator('.pp-result-reason');
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS('animation-name', 'none');
    expect((await ppCueLog(page)).map((record) => record.cueId)).not.toContain('mama_woke');
  });

  test('a camera tune changes the picture: another zoom, other pixels', async ({ page }) => {
    await openEnd(page, { patch: { fx: { photoCamera: { zoomPct: 0 } } } });
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars|actions/);
    const plain = await pixelsOfPhoto(page);
    await openEnd(page, { patch: { fx: { photoCamera: { zoomPct: 25 } } } });
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars|actions/);
    const zoomed = await pixelsOfPhoto(page);
    expect(zoomed).not.toBe(plain);
    // The same tune twice gives the same picture: the difference is the camera's.
    await openEnd(page, { patch: { fx: { photoCamera: { zoomPct: 25 } } } });
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars|actions/);
    expect(await pixelsOfPhoto(page)).toBe(zoomed);
  });

  test('a replay forgets the photo until the next end', async ({ page }) => {
    await openEnd(page);
    await waitForActions(page);
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    await page.locator(REPLAY).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    await expect(html(page)).not.toHaveAttribute('data-pp-photo', /.*/);
    await expect(html(page)).not.toHaveAttribute('data-pp-result', /.*/);
  });

  test('the flash sits over the Result screen only while the app is in `result`', async ({
    page,
  }) => {
    const flash = page.locator('.pp-screen-flash');
    await page.goto(`/${THREATS_OFF}`);
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    // In play a perfect's flash is what it was: under the pause panel, above the HUD, not over a screen.
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(flash).toHaveCount(1);
    await expect(flash).not.toHaveClass(/pp-screen-flash--over/);
    await advanceToEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await expect(flash).toHaveClass(/pp-screen-flash--over/);
    await waitForActions(page);
    await page.locator(REPLAY).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    await expect(flash).not.toHaveClass(/pp-screen-flash--over/);
  });

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 750, height: 340 },
  ]) {
    test(`fits ${viewport.width} × ${viewport.height} in two columns, without scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openEnd(page, { woken: true });
      await waitForActions(page);
      const layout = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = (document.querySelector(selector) as Element).getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        };
        const panel = document.querySelector('.pp-result-panel') as HTMLElement;
        return {
          polaroid: box('.pp-polaroid'),
          panel: box('.pp-result-panel'),
          panelScrolls: panel.scrollHeight > panel.clientHeight,
          pageScrolls:
            document.documentElement.scrollWidth > innerWidth ||
            document.documentElement.scrollHeight > innerHeight,
        };
      });
      // A tilt of a few degrees may poke a corner of the card out of its box by a few pixels.
      const TILT_SLACK_PX = 12;
      expect(layout.polaroid.left).toBeGreaterThanOrEqual(-TILT_SLACK_PX);
      expect(layout.polaroid.top).toBeGreaterThanOrEqual(-TILT_SLACK_PX);
      expect(layout.polaroid.bottom).toBeLessThanOrEqual(viewport.height + TILT_SLACK_PX);
      expect(layout.panel.right).toBeLessThanOrEqual(viewport.width);
      expect(layout.panel.bottom).toBeLessThanOrEqual(viewport.height);
      // Left of the panel, and not over it.
      expect(layout.polaroid.right).toBeLessThanOrEqual(layout.panel.left + TILT_SLACK_PX);
      expect(layout.panelScrolls).toBe(false);
      expect(layout.pageScrolls).toBe(false);
    });
  }
});

test.describe('a photo that cannot be taken', () => {
  test('never blocks the Result screen: no polaroid, no shutter, the rows start as before, one warning', async ({
    page,
  }) => {
    // The photo canvas has no 2D context; the game's own WebGL canvas is not asked for one.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === '2d') return null;
        return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof original;
    });
    await recordMirrorWrites(page, ['data-pp-result']);
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('[render]')) {
        warnings.push(message.text());
      }
    });
    await openEnd(page);
    await waitForActions(page);
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'none');
    await expect(page.locator(POLAROID)).toHaveCount(0);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(REPLAY)).toBeFocused();
    expect((await mirrorWrites(page)).map(({ value }) => value)).toEqual([
      'rows',
      'stars',
      'actions',
    ]);
    expect((await ppCueLog(page)).map((record) => record.cueId)).not.toContain('photo_taken');
    expect(warnings.filter((text) => text.includes('end photo'))).toHaveLength(1);
  });
});
