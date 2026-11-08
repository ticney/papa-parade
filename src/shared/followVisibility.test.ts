import { describe, expect, it } from 'vitest';
import { OFFSCREEN_BUBBLE_HYSTERESIS_PX } from './constants.ts';
import {
  type FollowInsets,
  type FollowScreenPoint,
  followFramePointOf,
  isInFollowFrame,
} from './followVisibility.ts';

const FRAME = { halfWidthM: 10, halfHeightM: 5 };
const WIDTH = 800;
const HEIGHT = 400;
/** The icon's half size on three sides, and the HUD row's bottom plus it at the top. */
const INSETS: FollowInsets = { leftPx: 32, rightPx: 32, topPx: 56 + 32, bottomPx: 32 };
const H = OFFSCREEN_BUBBLE_HYSTERESIS_PX;

const pointOf = (uM: number, vM: number, centreUM = 0, centreVM = 0): FollowScreenPoint => {
  const out = { xPx: Number.NaN, yPx: Number.NaN };
  followFramePointOf(FRAME, centreUM, centreVM, uM, vM, WIDTH, HEIGHT, out);
  return out;
};
const isIn = (xPx: number, yPx: number, wasOutside = false) =>
  isInFollowFrame(xPx, yPx, WIDTH, HEIGHT, INSETS, wasOutside, H);

describe('followFramePointOf (story 9.3, D2)', () => {
  it('puts the frame centre in the middle of the screen, and its edges on the screen edges', () => {
    expect(pointOf(0, 0)).toEqual({ xPx: 400, yPx: 200 });
    expect(pointOf(-10, 5)).toEqual({ xPx: 0, yPx: 0 });
    expect(pointOf(10, -5)).toEqual({ xPx: 800, yPx: 400 });
  });

  it('moves with the centre: a translation, the up of the view plane is the top of the screen', () => {
    expect(pointOf(3, 1, 3, 1)).toEqual({ xPx: 400, yPx: 200 });
    const moved = pointOf(0, 0, 2.5, -1);
    expect(moved.xPx).toBeCloseTo(400 - 2.5 * 40, 9);
    expect(moved.yPx).toBeCloseTo(200 - 1 * 40, 9);
  });

  it('is symmetric about the centre', () => {
    const left = pointOf(-4, 2);
    const right = pointOf(4, -2);
    expect(left.xPx + right.xPx).toBeCloseTo(WIDTH, 9);
    expect(left.yPx + right.yPx).toBeCloseTo(HEIGHT, 9);
  });

  it('maps points far outside the frame off the screen, on their side', () => {
    expect(pointOf(-30, 0).xPx).toBeLessThan(0);
    expect(pointOf(30, 0).xPx).toBeGreaterThan(WIDTH);
    expect(pointOf(0, 12).yPx).toBeLessThan(0);
    expect(pointOf(0, -12).yPx).toBeGreaterThan(HEIGHT);
  });
});

describe('isInFollowFrame (story 9.3, D2)', () => {
  it('sees the middle of the screen', () => {
    expect(isIn(400, 200)).toBe(true);
  });

  it('does not see a point outside on each side', () => {
    expect(isIn(-5, 200)).toBe(false);
    expect(isIn(805, 200)).toBe(false);
    expect(isIn(400, -5)).toBe(false);
    expect(isIn(400, 405)).toBe(false);
  });

  it('needs the icon half size inside the left, right and bottom edges', () => {
    expect(isIn(31, 200)).toBe(false);
    expect(isIn(769, 200)).toBe(false);
    expect(isIn(400, 369)).toBe(false);
    expect(isIn(33, 200)).toBe(true);
    expect(isIn(767, 200)).toBe(true);
    expect(isIn(400, 367)).toBe(true);
  });

  it('does not see an icon under the HUD row', () => {
    expect(isIn(400, 40)).toBe(false);
    expect(isIn(400, 87)).toBe(false);
    expect(isIn(400, 89)).toBe(true);
  });

  it('counts a point exactly on the line as inside', () => {
    expect(isIn(32, 200)).toBe(true);
    expect(isIn(768, 200)).toBe(true);
    expect(isIn(400, 88)).toBe(true);
    expect(isIn(400, 368)).toBe(true);
  });

  it('keeps a shown bubble until the point is the hysteresis further inside', () => {
    // Just inside: seen when nothing was shown, still outside for a shown bubble.
    expect(isIn(40, 200, false)).toBe(true);
    expect(isIn(40, 200, true)).toBe(false);
    expect(isIn(32 + H - 1, 200, true)).toBe(false);
    expect(isIn(32 + H, 200, true)).toBe(true);
    expect(isIn(768 - H + 1, 200, true)).toBe(false);
    expect(isIn(768 - H, 200, true)).toBe(true);
    expect(isIn(400, 88 + H - 1, true)).toBe(false);
    expect(isIn(400, 368 - H + 1, true)).toBe(false);
  });

  it('is symmetric for symmetric insets', () => {
    const symmetric: FollowInsets = { leftPx: 20, rightPx: 20, topPx: 20, bottomPx: 20 };
    for (const [x, y] of [
      [19, 100],
      [21, 100],
      [400, 19],
      [400, 21],
    ] as const) {
      const here = isInFollowFrame(x, y, WIDTH, HEIGHT, symmetric, false, H);
      const mirrored = isInFollowFrame(WIDTH - x, HEIGHT - y, WIDTH, HEIGHT, symmetric, false, H);
      expect(mirrored).toBe(here);
    }
  });
});
