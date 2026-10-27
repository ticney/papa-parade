import { expect, type Page, test } from '@playwright/test';
import {
  HUD_BAND_MAX_PCT,
  HUD_MAX_DOM_NODES,
  PANEL_POP_MAX_MS,
  RESUME_COUNTDOWN_MS,
  TOUCH_TARGET_MIN_PX,
} from '../../src/shared/constants.ts';
import {
  collectProblems,
  GLB_URL,
  holdRequests,
  html,
  OVERRUN_MARGIN_MS,
  openGame,
  pauseButton,
  sceneShot,
  settleAnimations,
  startLevel,
  startWalking,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

// An iPhone 12 held in landscape: the compact surface, a notch, touch.
const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
test.use({ viewport: LANDSCAPE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const FRAMES_TO_SETTLE = 10;
const LAYOUT_PROPERTIES = /^(width|height|top|right|bottom|left|margin|padding|inset|all)(-|$)/;

const pauseHud = (page: Page) => pauseButton(page, STRINGS['hud.pause_button']);
const panel = (page: Page) => page.locator('.pp-panel');

/** Opens the pause panel with the keyboard (so that focus rings show) and waits for it. */
async function pauseWithEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
  await expect(panel(page)).toBeVisible();
}

test("a whole session (start, pause, resume, restart, turn the phone) raises no error and none of the app's own warnings", async ({
  page,
}) => {
  const problems = collectProblems(page);

  await startLevel(page);
  await pauseWithEscape(page);
  await pauseButton(page, STRINGS['pause.resume']).click();
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
  await pauseWithEscape(page);
  await pauseButton(page, STRINGS['pause.restart']).click();
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
  await page.setViewportSize(PORTRAIT);
  await expect(page.locator('.pp-portrait-screen')).toBeVisible(); // two resizes in a row can merge
  await page.setViewportSize(LANDSCAPE);
  await expect(panel(page)).toBeVisible();
  expect(problems).toEqual([]);
});

test.describe('start screen', () => {
  test('shows the title and the prompt over the scene, in the real fonts, with no external request', async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await openGame(page);

    await expect(page.locator('.pp-start-title')).toHaveText(STRINGS['start.title']);
    await expect(page.locator('.pp-start-prompt')).toHaveText(STRINGS['start.tap_to_start']);
    await expect(page.locator('.pp-start-screen')).toHaveAttribute(
      'aria-label',
      STRINGS['start.tap_to_start'],
    );
    const startBox = await page.locator('.pp-start-screen').boundingBox();
    expect(startBox?.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(startBox?.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        baloo: document.fonts.check('800 56px "Baloo 2"'),
        nunito: document.fonts.check('800 16px Nunito'),
        anton: document.fonts.check('400 64px Anton'),
        family: getComputedStyle(document.querySelector('.pp-start-title') as Element).fontFamily,
      };
    });
    expect(fonts).toMatchObject({ baloo: true, nunito: true, anton: true });
    expect(fonts.family).toContain('Baloo 2');

    const origin = new URL(page.url()).origin;
    const external = urls.filter((url) => !url.startsWith(origin) && !/^(data|blob):/.test(url));
    expect(external).toEqual([]);
  });

  test('the first click, key or touch starts the level, through the countdown', async ({
    page,
  }) => {
    await openGame(page);
    await page.locator('.pp-start-screen').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(page.locator('.pp-start-screen')).toHaveCount(0);
    // The level starts through the countdown: the pause screen is built as the countdown, so the
    // panel is hidden and nothing took focus.
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(panel(page)).toBeHidden();
    const isFocusInPanel = await page.evaluate(
      () => document.activeElement?.closest('.pp-panel') != null,
    );
    expect(isFocusInPanel).toBe(false);
    await expect(page.locator('.pp-countdown-digit:not([hidden])')).toHaveText(
      STRINGS['countdown.step_3'],
    );
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });

    await openGame(page);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');

    await openGame(page);
    await page.touchscreen.tap(LANDSCAPE.width / 2, LANDSCAPE.height / 2);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
  });

  test('Escape and a bare modifier do not start the game', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift');
    await waitFrames(page, FRAMES_TO_SETTLE);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
  });
});

test.describe('pause', () => {
  test('the HUD button presses on pointerdown, acts on pointerup inside, and cancels when the pointer slides out', async ({
    page,
  }) => {
    await startLevel(page);
    const button = pauseHud(page);
    const box = await button.boundingBox();
    if (box === null) throw new Error('no pause button');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await expect(button).toHaveClass(/pp-pressed/);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running'); // not on pointerdown

    await page.mouse.move(centre.x - 200, centre.y + 100);
    await expect(button).not.toHaveClass(/pp-pressed/);
    await page.mouse.up();
    await waitFrames(page, FRAMES_TO_SETTLE);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running');
    await expect(panel(page)).toHaveCount(0);

    await button.click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(panel(page)).toBeVisible();
  });

  test('a touch tap on the pause button opens the panel, which shows the scene dimmed with the HUD inert under it', async ({
    page,
  }) => {
    await startLevel(page);
    const box = await pauseHud(page).boundingBox();
    if (box === null) throw new Error('no pause button');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');

    await expect(page.locator('.pp-panel-title')).toHaveText(STRINGS['pause.title']);
    await expect(pauseButton(page, STRINGS['pause.resume'])).toBeFocused();
    await expect(pauseButton(page, STRINGS['pause.restart'])).toBeVisible();
    await expect(page.locator('#pp-hud')).toBeVisible();
    await expect(page.locator('#pp-hud')).toHaveJSProperty('inert', true);
    const veil = await page
      .locator('.pp-pause-screen')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const scrim = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.backgroundColor = 'var(--pp-color-scrim)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    expect(veil).toBe(scrim);
  });

  test('a click with no pointer (assistive technology, detail 0) activates the button', async ({
    page,
  }) => {
    await startLevel(page);
    await pauseHud(page).evaluate((node) => (node as HTMLElement).click());
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(panel(page)).toBeVisible();
  });

  test('the veil swallows a tap outside the panel: nothing resumes, there is one overlay', async ({
    page,
  }) => {
    await startLevel(page);
    await pauseWithEscape(page);
    await settleAnimations(page);
    await page.mouse.click(20, LANDSCAPE.height / 2); // the veil, well left of the panel
    await page.touchscreen.tap(LANDSCAPE.width - 20, LANDSCAPE.height - 20);
    await waitFrames(page, FRAMES_TO_SETTLE);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
  });

  test('the panel opens within the pop-in budget, and under reduced motion it is a plain fade', async ({
    page,
  }) => {
    await startLevel(page);
    await pauseWithEscape(page);
    const timing = async () =>
      panel(page).evaluate((node) => {
        const style = getComputedStyle(node);
        const toMs = (value: string) =>
          Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
        return {
          name: style.animationName,
          totalMs: toMs(style.animationDuration) + toMs(style.animationDelay),
        };
      });
    const normal = await timing();
    expect(normal.name).toBe('pp-pop-in');
    expect(normal.totalMs).toBeLessThanOrEqual(PANEL_POP_MAX_MS);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await timing();
    expect(reduced.name).toBe('pp-fade-in');
    expect(reduced.totalMs).toBeLessThanOrEqual(PANEL_POP_MAX_MS);
  });

  test('Escape toggles pause, and pauses again during the countdown', async ({ page }) => {
    await startLevel(page);
    await pauseWithEscape(page);

    await page.keyboard.press('Escape'); // resume
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(panel(page)).toHaveCount(0);

    await page.keyboard.press('Escape'); // cancels the countdown
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
  });

  test('« Reprendre » counts « 3 », « 2 », « 1 », then plays, with the scene still during the countdown', async ({
    page,
  }) => {
    await startLevel(page);
    await startWalking(page);
    // Still on his way when the game is paused: what moves again after the countdown is the walk.
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkPath');
    await pauseWithEscape(page);
    const stillShot = await sceneShot(page);

    await pauseButton(page, STRINGS['pause.resume']).click();
    const seen = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const digits: string[] = [];
          const onFrame = (): void => {
            const text = document.querySelector('.pp-countdown-digit:not([hidden])')?.textContent;
            if (text && digits.at(-1) !== text) digits.push(text);
            if (document.documentElement.dataset.ppState === 'running') resolve(digits);
            else requestAnimationFrame(onFrame);
          };
          onFrame();
        }),
    );
    expect(seen).toEqual([
      STRINGS['countdown.step_3'],
      STRINGS['countdown.step_2'],
      STRINGS['countdown.step_1'],
    ]);
    await expect(page.locator('.pp-pause-screen')).toHaveCount(0);
    await expect
      .poll(async () => (await sceneShot(page)).equals(stillShot), {
        message: 'the sim runs again',
      })
      .toBe(false);
  });

  test('« Recommencer » restarts the level through loading with a new seed, and counts down', async ({
    page,
  }) => {
    await startLevel(page);
    const seed = await html(page).getAttribute('data-pp-seed');
    expect(seed).not.toBeNull();
    await pauseWithEscape(page);
    // The old value of each change of data-pp-app, in order: level → loading → level.
    await page.evaluate(() => {
      const left: string[] = [];
      new MutationObserver((records) => {
        for (const record of records) left.push(record.oldValue ?? '');
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-pp-app'],
        attributeOldValue: true,
      });
      Object.assign(window, { ppAppLeft: left });
    });

    await pauseButton(page, STRINGS['pause.restart']).click();
    await expect(html(page)).not.toHaveAttribute('data-pp-seed', seed as string);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { ppAppLeft: string[] }).ppAppLeft))
      .toEqual(['level', 'loading']);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(panel(page)).toHaveCount(0);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
  });
});

test.describe('portrait', () => {
  test('covers the game and keeps it paused; back in landscape the pause panel shows', async ({
    page,
  }) => {
    await startLevel(page);
    await page.setViewportSize(PORTRAIT);

    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await expect(page.locator('.pp-portrait-text')).toHaveText(STRINGS['portrait.rotate']);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(page.locator('.pp-pause-screen')).toHaveCount(0); // overlays never stack
    await expect(page.locator('#pp-ui > *')).toHaveCount(1);
    await expect(page.locator('#pp-hud')).toHaveJSProperty('inert', true);

    await waitFrames(page, FRAMES_TO_SETTLE);
    const coveredShot = await sceneShot(page);
    await page.keyboard.press('Escape'); // must not resume under the overlay
    await waitFrames(page, FRAMES_TO_SETTLE);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    expect((await sceneShot(page)).equals(coveredShot)).toBe(true);

    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('.pp-portrait-screen')).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');

    await pauseButton(page, STRINGS['pause.resume']).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
  });

  test('replaces the start screen, which comes back in landscape', async ({ page }) => {
    await openGame(page);
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await expect(page.locator('.pp-start-screen')).toHaveCount(0);
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('.pp-start-screen')).toBeVisible();
    await expect(page.locator('.pp-portrait-screen')).toHaveCount(0);
  });

  test('a countdown in progress is cancelled by turning the phone', async ({ page }) => {
    await startLevel(page);
    await pauseWithEscape(page);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await page.setViewportSize(PORTRAIT);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await page.setViewportSize(LANDSCAPE);
    await expect(panel(page)).toBeVisible();
  });
});

test.describe('HUD', () => {
  test('keeps its zones, the free bottom third, the band and the node budget, on both surfaces', async ({
    page,
  }) => {
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-surface', 'compact');

    const measure = () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const rect = (document.querySelector(selector) as Element).getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        };
        const hud = document.querySelector('#pp-hud') as HTMLElement;
        const elements = [...hud.querySelectorAll<HTMLElement>('*')]; // #pp-hud itself is the whole screen
        return {
          viewport: { width: innerWidth, height: innerHeight },
          row: box('.pp-hud-row'),
          pause: box('.pp-hud-pause'),
          gauges: box('[data-pp-zone="gauges"]'),
          timer: box('[data-pp-zone="timer"]'),
          nodes: elements.length,
          lowestBottom: Math.max(
            ...elements.map((element) => element.getBoundingClientRect().bottom),
          ),
          // Only a transition that lasts counts: the default is `all` over 0s, which animates nothing.
          transitions: elements.flatMap((element) => {
            const style = getComputedStyle(element);
            const durations = style.transitionDuration.split(/,\s*/);
            return style.transitionProperty
              .split(/,\s*/)
              .filter(
                (_, index) => Number.parseFloat(durations[index % durations.length] ?? '0') > 0,
              );
          }),
        };
      });

    const compact = await measure();
    expect(compact.pause.right).toBeCloseTo(compact.viewport.width - 12, 0); // hud-inset, no notch
    expect(compact.pause.top).toBeCloseTo(12, 0);
    expect(compact.gauges.left).toBeCloseTo(12, 0);
    expect((compact.timer.left + compact.timer.right) / 2).toBeCloseTo(
      compact.viewport.width / 2,
      0,
    );
    expect(compact.row.height).toBeLessThanOrEqual(
      (compact.viewport.height * HUD_BAND_MAX_PCT) / 100,
    );
    expect(compact.lowestBottom).toBeLessThanOrEqual((compact.viewport.height * 2) / 3);
    expect(compact.nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    for (const property of compact.transitions) {
      expect(LAYOUT_PROPERTIES.test(property), `transition on ${property}`).toBe(false);
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(html(page)).toHaveAttribute('data-pp-surface', 'regular');
    const regular = await measure();
    // The corners do not move between surfaces.
    expect(regular.viewport.width - regular.pause.right).toBeCloseTo(
      compact.viewport.width - compact.pause.right,
      0,
    );
    expect(regular.pause.top).toBeCloseTo(compact.pause.top, 0);
    expect(regular.gauges.left).toBeCloseTo(compact.gauges.left, 0);
  });

  test('keeps clear of a notch: the safe-area insets feed every HUD margin', async ({ page }) => {
    await startLevel(page);
    // A browser cannot emulate a notch, so the four inset variables are set as the notch would
    // set them (47 px on each side of the screen, as in the pause mockup, and 21 px below).
    await page.addStyleTag({
      content: `:root {
        --pp-spacing-hud-inset-left: max(12px, 47px);
        --pp-spacing-hud-inset-right: max(12px, 47px);
        --pp-spacing-hud-inset-top: max(12px, 0px);
        --pp-spacing-hud-inset-bottom: max(12px, 21px);
      }`,
    });
    const boxes = await page.evaluate(() => {
      const left = (
        document.querySelector('[data-pp-zone="gauges"]') as Element
      ).getBoundingClientRect();
      const pause = (document.querySelector('.pp-hud-pause') as Element).getBoundingClientRect();
      return { left: left.left, pauseRight: pause.right, width: innerWidth };
    });
    expect(boxes.left).toBeGreaterThanOrEqual(47);
    expect(boxes.pauseRight).toBeLessThanOrEqual(boxes.width - 47);
  });
});

test.describe('buttons and keyboard', () => {
  test('every button is at least 44 × 44, has a French aria-label from the strings file, and is reachable', async ({
    page,
  }) => {
    await startLevel(page);
    const audit = () =>
      page.locator('button').evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            label: node.getAttribute('aria-label') ?? '',
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    // Each button has the exact label of its own string, not just some string of the file.
    const labels = async () => (await audit()).map((button) => button.label).sort();

    expect(await labels()).toEqual([STRINGS['hud.pause_button']]);
    for (const button of await audit()) {
      expect(button.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      expect(button.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
    await pauseWithEscape(page);
    await settleAnimations(page);
    expect(await labels()).toEqual(
      [STRINGS['hud.pause_button'], STRINGS['pause.resume'], STRINGS['pause.restart']].sort(),
    );
    for (const button of await audit()) {
      expect(button.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      expect(button.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  test('arrow keys and Tab move focus in the panel, with a visible primary ring; Enter activates', async ({
    page,
    browserName,
  }) => {
    await startLevel(page);
    await pauseWithEscape(page);
    const resume = pauseButton(page, STRINGS['pause.resume']);
    const restart = pauseButton(page, STRINGS['pause.restart']);
    await expect(resume).toBeFocused();

    const ring = await resume.evaluate((node) => {
      const style = getComputedStyle(node);
      const probe = document.createElement('i');
      probe.style.color = 'var(--pp-color-primary)';
      document.body.append(probe);
      const primary = getComputedStyle(probe).color;
      probe.remove();
      const width = getComputedStyle(document.documentElement).getPropertyValue(
        '--pp-spacing-focus-ring-width',
      );
      return {
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        primary,
        expectedWidth: width.trim(),
      };
    });
    expect(ring.outlineColor).toBe(ring.primary);
    expect(ring.outlineWidth).toBe(ring.expectedWidth);
    expect(ring.outlineStyle).toBe('solid');

    await page.keyboard.press('ArrowDown');
    await expect(restart).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(resume).toBeFocused();
    // Safari does not Tab to buttons unless the user turns that setting on (and WebKit follows it),
    // which is why the arrow keys exist; Tab is asserted where the browser does it by default.
    if (browserName === 'chromium') {
      await page.keyboard.press('Tab');
      await expect(restart).toBeFocused();
    }

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
  });

  test('Space activates the focused button too', async ({ page }) => {
    await startLevel(page);
    await pauseWithEscape(page);
    await page.keyboard.press('Space');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
  });
});

test.describe('strings 30 % longer', () => {
  test('nothing is truncated or overflows on the start, pause, countdown and portrait screens', async ({
    page,
  }) => {
    // Vite serves each content file as a JS module: `export default "<file text>"`.
    await page.route(/\/content\/strings\.fr\.json\?/, async (route) => {
      const response = await route.fetch();
      const module = await response.text();
      const literal = module.slice(module.indexOf('export default ') + 'export default '.length);
      const strings = JSON.parse(JSON.parse(literal.replace(/;\s*$/, ''))) as Record<
        string,
        string
      >;
      const longer = Object.fromEntries(
        Object.entries(strings).map(([key, value]) => {
          // A verb must stay « MOT ! »: the filler goes before the closing " !".
          const isVerb = key.startsWith('verb.');
          let text = isVerb ? value.slice(0, -2) : value;
          while (text.length < value.length * 1.3) text += isVerb ? ' AB' : ' ab';
          return [key, isVerb ? `${text} !` : text];
        }),
      );
      await route.fulfill({
        contentType: 'text/javascript',
        body: `export default ${JSON.stringify(JSON.stringify(longer))};`,
      });
    });

    const overflowing = (selector: string) =>
      page.locator(selector).evaluateAll((roots) =>
        roots.flatMap((root) =>
          [root, ...root.querySelectorAll<HTMLElement>('*')]
            .filter((node) =>
              [...node.childNodes].some(
                (child) =>
                  child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '',
              ),
            )
            .map((node) => {
              const element = node as HTMLElement;
              const rect = element.getBoundingClientRect();
              const problems: string[] = [];
              const style = getComputedStyle(element);
              // A word wider than its box overflows sideways. Vertically, only a box that clips
              // (the panel scrolls) can hide text: a tall font over a tight line-height spills
              // out of its own box without being cut, so that is not counted.
              if (element.scrollWidth > element.clientWidth + 1) problems.push('scroll-x');
              if (
                style.overflowY !== 'visible' &&
                element.scrollHeight > element.clientHeight + 1
              ) {
                problems.push('scroll-y');
              }
              if (style.textOverflow === 'ellipsis') problems.push('ellipsis');
              if (rect.left < 0 || rect.top < 0) problems.push('outside-start');
              if (rect.right > innerWidth || rect.bottom > innerHeight)
                problems.push('outside-end');
              return problems.length === 0 ? null : `${element.className}: ${problems.join(',')}`;
            })
            .filter((entry): entry is string => entry !== null),
        ),
      );

    await openGame(page);
    // The route only works against the dev server's module shape (`export default "<json>"`): if it
    // stops matching, the strings are not lengthened and this line says why.
    expect(
      await page.locator('.pp-start-prompt').textContent(),
      'the strings were not lengthened: the dev module shape changed, update the route',
    ).toContain('ab');
    expect(await overflowing('#pp-ui')).toEqual([]);

    // The loading screen too: the level's `.glb` is held back so that it stays up.
    const glb = await holdRequests(page, GLB_URL);
    await page.locator('.pp-start-screen').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'loading');
    await expect(page.locator('.pp-loading-screen')).toBeVisible();
    expect(await overflowing('#pp-ui')).toEqual([]);
    glb.release();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await pauseWithEscape(page);
    expect(await overflowing('#pp-ui')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    expect(await overflowing('#pp-ui')).toEqual([]);

    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    expect(await overflowing('#pp-ui')).toEqual([]);
  });
});
