import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  ISO_YAW_DEG,
  RESUME_COUNTDOWN_MS,
  TAP_MARKER_FADE_MS,
} from '../../src/shared/constants.ts';
import {
  canvasPoint,
  collectProblems,
  html,
  OVERRUN_MARGIN_MS,
  papaAt,
  pauseButton,
  pressCode,
  sceneShot,
  startLevel,
  stubGamepad,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

// The live room, read here and never copied: Geo re-exports it freely. Papa's start is the
// `papa_spawn` anchor, which is on open floor today (no snapping).
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  anchors: { id: string; positionM: [number, number, number] }[];
  nav: { originM: [number, number]; cols: number; rowCount: number };
  cellM: number;
};
const spawn = (geometry.anchors.find((a) => a.id === 'papa_spawn') as (typeof geometry.anchors)[0])
  .positionM;
const FLOOR = {
  minX: geometry.nav.originM[0],
  maxX: geometry.nav.originM[0] + geometry.nav.cols * geometry.cellM,
  minZ: geometry.nav.originM[1],
  maxZ: geometry.nav.originM[1] + geometry.nav.rowCount * geometry.cellM,
};
/** The longest walk across the room, in metres, for the bound on how long a walk may take. */
const ROOM_DIAGONAL_M = Math.hypot(FLOOR.maxX - FLOOR.minX, FLOOR.maxZ - FLOOR.minZ);
/** `feel.json` speed: read, not copied. */
const WALK_SPEED_MPS = (
  JSON.parse(readFileSync('content/feel.json', 'utf8')) as { movement: { walkSpeedMps: number } }
).movement.walkSpeedMps;
const WALK_BOUND_MS = (ROOM_DIAGONAL_M / WALK_SPEED_MPS) * 1000 + OVERRUN_MARGIN_MS * 2;
/** Frames a key is held to move Papa a visible distance, a bound and not a wait. */
const HOLD_FRAMES = 20;
const FRAMES_TO_SETTLE = 10;

const state = (page: Page) => html(page).getAttribute('data-pp-papa-state');

test.describe('move Papa', () => {
  test('starts idle at the papa_spawn anchor', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    expect(await papaAt(page)).toEqual({
      x: Number(spawn[0].toFixed(2)),
      z: Number(spawn[2].toFixed(2)),
    });
    expect(problems).toEqual([]);
  });

  for (const device of ['touch', 'mouse'] as const) {
    test(`a ${device} tap on the floor shows the marker at once and walks Papa there`, async ({
      page,
    }) => {
      const problems = collectProblems(page);
      await startLevel(page);
      const before = await papaAt(page);
      // 50 % across, 60 % down is open floor with today's camera and room (the centre of the room).
      const target = await canvasPoint(page, 0.5, 0.6);

      // Watch the frames from inside the page: the first one in which the marker has a box, and
      // how many frames after the pointerdown that was.
      await page.evaluate(() => {
        const seen = { downFrame: -1, firstFrame: -1, box: null as null | number[], frame: 0 };
        Object.assign(window, { ppMarker: seen });
        addEventListener(
          'pointerdown',
          () => {
            seen.downFrame = seen.frame;
          },
          { capture: true },
        );
        const onFrame = (): void => {
          seen.frame++;
          const marker = document.querySelector('.pp-tap-marker');
          if (
            seen.firstFrame < 0 &&
            marker !== null &&
            getComputedStyle(marker).display !== 'none'
          ) {
            const rect = marker.getBoundingClientRect();
            if (rect.width > 0) {
              seen.firstFrame = seen.frame;
              seen.box = [rect.x + rect.width / 2, rect.y + rect.height / 2];
            }
          }
          requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      });
      await page.evaluate(() => {
        const history: string[] = [];
        Object.assign(window, { ppStates: history });
        new MutationObserver(() => {
          history.push(document.documentElement.dataset.ppPapaState ?? '');
        }).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-pp-papa-state'],
        });
      });

      if (device === 'touch') await page.touchscreen.tap(target.x, target.y);
      else await page.mouse.click(target.x, target.y);

      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { ppMarker: { firstFrame: number } }).ppMarker.firstFrame,
          ),
        )
        .toBeGreaterThan(0);
      const marker = await page.evaluate(
        () =>
          (
            window as unknown as {
              ppMarker: { downFrame: number; firstFrame: number; box: number[] };
            }
          ).ppMarker,
      );
      // Visible in the frame after the pointerdown (NFR2, DESIGN.md).
      expect(marker.firstFrame - marker.downFrame).toBeLessThanOrEqual(1);
      expect(Math.abs((marker.box[0] as number) - target.x)).toBeLessThanOrEqual(6);
      expect(Math.abs((marker.box[1] as number) - target.y)).toBeLessThanOrEqual(6);

      // The tapped point is mirrored, and Papa walks to it and stops.
      await expect(html(page)).toHaveAttribute('data-pp-tap', /^-?\d+\.\d+,-?\d+\.\d+$/);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { ppStates: string[] }).ppStates), {
          timeout: WALK_BOUND_MS,
        })
        .toEqual(['walkPath', 'idle']);
      const tapped = (await html(page).getAttribute('data-pp-tap')) ?? '';
      const [tapX, tapZ] = tapped.split(',').map(Number) as [number, number];
      const after = await papaAt(page);
      const distance = (p: { x: number; z: number }) => Math.hypot(p.x - tapX, p.z - tapZ);
      expect(distance(after)).toBeLessThan(distance(before));
      expect(distance(after)).toBeLessThan(0.5); // on open floor he reaches the point itself

      // The marker is gone once its fade is over.
      await expect(page.locator('.pp-tap-marker')).toBeHidden({
        timeout: TAP_MARKER_FADE_MS + OVERRUN_MARGIN_MS,
      });
      expect(problems).toEqual([]);
    });
  }

  test('WASD and the arrows are read by code: D walks to the screen right, ArrowUp to the screen top', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    // Today's camera sits at +x/+z (ISO_YAW_DEG = 45): screen right is +x/-z, screen up is -x/-z.
    expect(ISO_YAW_DEG).toBe(45);

    const start = await papaAt(page);
    await page.keyboard.down('KeyD');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    await waitFrames(page, HOLD_FRAMES);
    await page.keyboard.up('KeyD');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    const right = await papaAt(page);
    expect(right.x - start.x).toBeGreaterThan(0.2);
    expect(right.z - start.z).toBeLessThan(-0.2);

    await page.keyboard.down('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    await waitFrames(page, HOLD_FRAMES);
    await page.keyboard.up('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    const up = await papaAt(page);
    expect(up.x - right.x).toBeLessThan(-0.2);
    expect(up.z - right.z).toBeLessThan(-0.2);
    expect(problems).toEqual([]);
  });

  test('an AZERTY keyboard works with no setting: Z is the physical W key, a QWERTY W on the Z position does nothing', async ({
    page,
  }) => {
    await startLevel(page);
    const start = await papaAt(page);

    // AZERTY: the key printed Z sits where QWERTY has W (code KeyW): screen up.
    await pressCode(page, 'keydown', 'z', 'KeyW');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    await waitFrames(page, HOLD_FRAMES);
    await pressCode(page, 'keyup', 'z', 'KeyW');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    const moved = await papaAt(page);
    expect(moved.x - start.x).toBeLessThan(-0.2);
    expect(moved.z - start.z).toBeLessThan(-0.2);

    // The key printed W on an AZERTY keyboard has the code KeyZ: not a movement key.
    await pressCode(page, 'keydown', 'w', 'KeyZ');
    await waitFrames(page, HOLD_FRAMES);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    expect(await papaAt(page)).toEqual(moved);
    await pressCode(page, 'keyup', 'w', 'KeyZ');
  });

  test('Papa stops against a wall and stays inside the floor while the key is held', async ({
    page,
  }) => {
    await startLevel(page);
    const start = await papaAt(page);
    await page.keyboard.down('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    // The mirrored position changes on an event: the walk starting (where he started), then the
    // blockage (where he stopped, once, when he cannot move at all). The picture of the room
    // cannot say he stopped any more, since the baby moves on its own.
    await expect.poll(() => papaAt(page), { timeout: WALK_BOUND_MS }).not.toEqual(start);
    expect(await state(page)).toBe('walkDir'); // still pushing, but not moving
    const stuck = await papaAt(page); // mirrored when he was blocked
    expect(stuck).not.toEqual(start);
    expect(stuck.x).toBeGreaterThanOrEqual(FLOOR.minX);
    expect(stuck.x).toBeLessThanOrEqual(FLOOR.maxX);
    expect(stuck.z).toBeGreaterThanOrEqual(FLOOR.minZ);
    expect(stuck.z).toBeLessThanOrEqual(FLOOR.maxZ);
    await page.keyboard.up('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
  });

  test.describe('the pause gate', () => {
    test('a tap while paused or counting down is dropped: no marker, no tap', async ({ page }) => {
      await startLevel(page);
      await page.keyboard.press('Escape');
      await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
      // Over the veil, beside the panel that sits in the middle.
      const target = await canvasPoint(page, 0.1, 0.5);
      await page.mouse.click(target.x, target.y);
      await expect(page.locator('.pp-tap-marker')).toHaveCount(0);
      await expect(html(page)).not.toHaveAttribute('data-pp-tap', /.*/);

      await pauseButton(page, STRINGS['pause.resume']).click();
      await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
      await page.mouse.click(target.x, target.y);
      await expect(page.locator('.pp-tap-marker')).toHaveCount(0);
      await expect(html(page)).not.toHaveAttribute('data-pp-tap', /.*/);
      await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
        timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
      });
    });

    test('a key held through a pause walks again after the countdown; one released during it stops Papa; a lost focus stops him', async ({
      page,
    }) => {
      await startLevel(page);
      const resume = async () => {
        await pauseButton(page, STRINGS['pause.resume']).click();
        await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
          timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
        });
      };

      await page.keyboard.down('KeyD');
      await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
      const walkStart = await papaAt(page); // mirrored when the walk began
      await page.keyboard.press('Escape');
      await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
      await waitFrames(page, FRAMES_TO_SETTLE);
      const pausedShot = await sceneShot(page);
      await resume();
      // Still walking: the scene changes again, and Papa (not only the baby) went on until the
      // wall, where his position is mirrored.
      await expect
        .poll(async () => (await sceneShot(page)).equals(pausedShot), {
          message: 'the scene moves again after the resume',
        })
        .toBe(false);
      await expect.poll(() => papaAt(page), { timeout: WALK_BOUND_MS }).not.toEqual(walkStart);
      expect(await state(page)).toBe('walkDir');

      // Released during a second pause: idle at the resume.
      await page.keyboard.press('Escape');
      await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
      await page.keyboard.up('KeyD');
      await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir'); // nothing sent while paused
      await resume();
      await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');

      // A window that loses focus releases the keys.
      await page.keyboard.down('KeyA');
      await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
      await page.keyboard.up('KeyA');
    });
  });

  test('the left stick walks Papa outside its deadzone and stops him inside it or when the pad is gone', async ({
    page,
  }) => {
    const pad = await stubGamepad(page);
    await startLevel(page);
    const start = await papaAt(page);

    await pad.setStick(0.9, 0);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    await waitFrames(page, HOLD_FRAMES);
    await pad.setStick(0.1, 0); // inside the deadzone
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    const moved = await papaAt(page);
    expect(moved.x - start.x).toBeGreaterThan(0.2); // screen right
    expect(moved.z - start.z).toBeLessThan(-0.2);

    await pad.setStick(0.9, 0);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkDir');
    await pad.setPadPresent(false);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
  });

  test('« Recommencer » starts a new level at the spawn, idle', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    const seed = await html(page).getAttribute('data-pp-seed');
    const target = await canvasPoint(page, 0.5, 0.6);
    await page.touchscreen.tap(target.x, target.y);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkPath');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle', {
      timeout: WALK_BOUND_MS,
    });
    expect(await papaAt(page)).not.toEqual({
      x: Number(spawn[0].toFixed(2)),
      z: Number(spawn[2].toFixed(2)),
    });

    await page.keyboard.press('Escape');
    await pauseButton(page, STRINGS['pause.restart']).click();
    await expect(html(page)).not.toHaveAttribute('data-pp-seed', seed as string);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    expect(await papaAt(page)).toEqual({
      x: Number(spawn[0].toFixed(2)),
      z: Number(spawn[2].toFixed(2)),
    });
    expect(problems).toEqual([]);
  });
});
