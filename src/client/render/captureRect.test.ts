import { describe, expect, it } from 'vitest';
import { bufferRectOf, photoRectOf } from './captureRect.ts';

describe('photoRectOf', () => {
  it('fills a canvas of the same aspect', () => {
    expect(photoRectOf(800, 400, 2)).toEqual({ xPx: 0, yPx: 0, widthPx: 800, heightPx: 400 });
  });

  it('leaves bands left and right in a canvas wider than the aspect', () => {
    // 4:3 in a 844 x 390 canvas: the height is the limit.
    const rect = photoRectOf(844, 390, 4 / 3);
    expect(rect.heightPx).toBe(390);
    expect(rect.widthPx).toBeCloseTo(520);
    expect(rect.xPx).toBeCloseTo((844 - 520) / 2);
    expect(rect.yPx).toBe(0);
  });

  it('leaves bands above and below in a canvas narrower than the aspect', () => {
    // 4:3 in a 390 x 844 canvas (portrait): the width is the limit.
    const rect = photoRectOf(390, 844, 4 / 3);
    expect(rect.widthPx).toBe(390);
    expect(rect.heightPx).toBeCloseTo(292.5);
    expect(rect.xPx).toBe(0);
    expect(rect.yPx).toBeCloseTo((844 - 292.5) / 2);
  });

  it('always has the aspect it was given and sits centred', () => {
    for (const [width, height, aspect] of [
      [844, 390, 1.5],
      [390, 844, 1.5],
      [1000, 1000, 1.25],
      [500, 300, 3],
    ] as const) {
      const rect = photoRectOf(width, height, aspect);
      expect(rect.widthPx / rect.heightPx).toBeCloseTo(aspect);
      expect(rect.xPx * 2 + rect.widthPx).toBeCloseTo(width);
      expect(rect.yPx * 2 + rect.heightPx).toBeCloseTo(height);
      expect(rect.widthPx).toBeLessThanOrEqual(width + 1e-9);
      expect(rect.heightPx).toBeLessThanOrEqual(height + 1e-9);
    }
  });
});

describe('bufferRectOf', () => {
  it('is the CSS rectangle at a pixel ratio of 1', () => {
    const rect = photoRectOf(844, 390, 1.5);
    const buffer = bufferRectOf(rect, 1, 390);
    expect(buffer).toEqual({ xPx: 130, yPx: 0, widthPx: 585, heightPx: 390 });
  });

  it('scales every side by the pixel ratio of 2, and measures the offset from the top', () => {
    // A 400 x 300 CSS canvas, a 2:1 photo: 400 x 200, a band of 50 above and 50 below.
    const rect = photoRectOf(400, 300, 2);
    expect(rect).toEqual({ xPx: 0, yPx: 50, widthPx: 400, heightPx: 200 });
    // The buffer is 800 x 600: the photo is 800 x 400 with 100 above and 100 below.
    expect(bufferRectOf(rect, 2, 600)).toEqual({ xPx: 0, yPx: 100, widthPx: 800, heightPx: 400 });
  });

  it('turns a rectangle that is not centred over (GL counts from the bottom, drawImage from the top)', () => {
    // 100 CSS px up from the bottom, 50 high, in a 400-high buffer at a ratio of 2: 200 up from the
    // bottom, 100 high, so its top edge is 400 - 200 - 100 = 100 down from the top.
    const rect = { xPx: 10, yPx: 100, widthPx: 20, heightPx: 50 };
    expect(bufferRectOf(rect, 2, 400)).toEqual({ xPx: 20, yPx: 100, widthPx: 40, heightPx: 100 });
  });

  it('rounds as three rounds the viewport, and never reaches outside the buffer', () => {
    const rect = photoRectOf(844, 390, 1.5);
    const bufferHeightPx = Math.floor(390 * 1.5);
    const buffer = bufferRectOf(rect, 1.5, bufferHeightPx);
    expect(Number.isInteger(buffer.xPx)).toBe(true);
    expect(Number.isInteger(buffer.yPx)).toBe(true);
    expect(Number.isInteger(buffer.widthPx)).toBe(true);
    expect(Number.isInteger(buffer.heightPx)).toBe(true);
    expect(buffer.xPx).toBeGreaterThanOrEqual(0);
    expect(buffer.yPx).toBeGreaterThanOrEqual(0);
    expect(buffer.xPx + buffer.widthPx).toBeLessThanOrEqual(Math.floor(844 * 1.5) + 1);
    expect(buffer.yPx + buffer.heightPx).toBeLessThanOrEqual(bufferHeightPx + 1);
  });
});
