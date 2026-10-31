import { VERB_MIN_FONT_PX } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  clampVerbShiftPx,
  createVerbStack,
  fitVerbFontPx,
  stackVerbs,
  type VerbStack,
} from './verbLayout.ts';

describe('clampVerbShiftPx (story 2.10 review)', () => {
  const LAYER = 568;

  it('leaves a box that fits where it is, edges included', () => {
    expect(clampVerbShiftPx(284, 200, LAYER)).toBe(0);
    expect(clampVerbShiftPx(100, 200, LAYER)).toBe(0);
    expect(clampVerbShiftPx(LAYER - 100, 200, LAYER)).toBe(0);
  });

  it('moves a box that reaches past the left edge back in, by the overhang', () => {
    expect(clampVerbShiftPx(60, 200, LAYER)).toBe(40);
  });

  it('moves a box that reaches past the right edge back in', () => {
    expect(clampVerbShiftPx(LAYER - 60, 200, LAYER)).toBe(-40);
  });

  it('rounds away from zero, so that the box is never left half a pixel outside', () => {
    expect(clampVerbShiftPx(60.4, 200, LAYER)).toBe(40);
    expect(clampVerbShiftPx(LAYER - 60.4, 200, LAYER)).toBe(-40);
    expect(clampVerbShiftPx(99.5, 201, LAYER)).toBe(1);
  });

  it('centres a box wider than the layer on it', () => {
    expect(clampVerbShiftPx(100, LAYER + 50, LAYER)).toBe(LAYER / 2 - 100);
    expect(clampVerbShiftPx(LAYER, LAYER, LAYER)).toBe(-LAYER / 2);
  });

  it('does nothing for a box with no text or a layer with no size', () => {
    expect(clampVerbShiftPx(0, 0, LAYER)).toBe(0);
    expect(clampVerbShiftPx(0, 200, 0)).toBe(0);
  });
});

describe('fitVerbFontPx', () => {
  const MAX = 380;

  it('keeps the base size for a verb that fits', () => {
    expect(fitVerbFontPx(200, 40, MAX)).toBe(40);
    expect(fitVerbFontPx(1, 32, MAX)).toBe(32);
  });

  it('keeps the base size for a verb exactly at the maximum width', () => {
    expect(fitVerbFontPx(MAX, 40, MAX)).toBe(40);
  });

  it('shrinks a long verb in proportion to the width it is over', () => {
    expect(fitVerbFontPx(400, 40, 380)).toBeCloseTo(38, 10);
    expect(fitVerbFontPx(420, 40, 300)).toBeCloseTo(40 * (300 / 420), 10);
  });

  it('never goes under the 28 px floor, even for a very long verb', () => {
    expect(VERB_MIN_FONT_PX).toBe(28);
    expect(fitVerbFontPx(2000, 40, 380)).toBe(VERB_MIN_FONT_PX);
    expect(fitVerbFontPx(2000, 32, 380)).toBe(VERB_MIN_FONT_PX);
  });

  it('stops at the floor exactly where the fit would go under it', () => {
    // 40 × 380 / 540 = 28.15 px: still above the floor; 40 × 380 / 560 = 27.1 px: floored.
    expect(fitVerbFontPx(540, 40, 380)).toBeCloseTo(28.148, 2);
    expect(fitVerbFontPx(560, 40, 380)).toBe(28);
  });

  it('shows the compact base size on the compact surface, and fits it the same way', () => {
    expect(fitVerbFontPx(250, 32, 300)).toBe(32);
    // 32 × 300 / 375 = 25.6 px: floored.
    expect(fitVerbFontPx(375, 32, 300)).toBe(VERB_MIN_FONT_PX);
    expect(fitVerbFontPx(330, 32, 300)).toBeCloseTo(32 * (300 / 330), 10);
  });

  it('multiplies both the base size and the floor by the scale (« Grands verbes », D9)', () => {
    expect(fitVerbFontPx(200, 40, MAX, 1.25)).toBe(50);
    expect(fitVerbFontPx(200, 32, MAX, 1.25)).toBe(40);
    expect(fitVerbFontPx(5000, 40, MAX, 1.25)).toBe(VERB_MIN_FONT_PX * 1.25);
    expect(fitVerbFontPx(500, 40, 380, 1.25)).toBeCloseTo(50 * (380 / 500), 10);
  });

  it('defaults the scale to 1', () => {
    expect(fitVerbFontPx(200, 40, MAX)).toBe(fitVerbFontPx(200, 40, MAX, 1));
  });

  it('falls back to the base size when the width is zero, negative or not a number (nothing to fit)', () => {
    expect(fitVerbFontPx(0, 40, MAX)).toBe(40);
    expect(fitVerbFontPx(-5, 40, MAX)).toBe(40);
    expect(fitVerbFontPx(Number.NaN, 40, MAX)).toBe(40);
  });

  it('overflows rather than cuts when the maximum is not a positive number: the floor still holds', () => {
    expect(fitVerbFontPx(200, 40, 0)).toBe(VERB_MIN_FONT_PX);
    expect(fitVerbFontPx(200, 40, Number.NaN)).toBe(40);
  });
});

/** A stack of boxes: `[centerXPx, bottomPx, widthPx, heightPx, closeAt, id]` each. */
function stackOf(
  ...boxes: readonly [
    x: number,
    bottom: number,
    w: number,
    h: number,
    closeAt: number,
    id: number,
  ][]
): VerbStack {
  const stack = createVerbStack(Math.max(boxes.length, 1));
  boxes.forEach(([x, bottom, w, h, closeAt, id], k) => {
    stack.centerXPx[k] = x;
    stack.bottomPx[k] = bottom;
    stack.widthPx[k] = w;
    stack.heightPx[k] = h;
    stack.closeAt[k] = closeAt;
    stack.ids[k] = id;
  });
  return stack;
}

const GAP = 4;
const offsets = (stack: VerbStack, count: number) => Array.from(stack.offsetPx.subarray(0, count));
const ranks = (stack: VerbStack, count: number) => Array.from(stack.rank.subarray(0, count));

describe('stackVerbs', () => {
  it('does nothing for no verb, and leaves one verb at its place and in front', () => {
    const empty = createVerbStack(4);
    stackVerbs(empty, 0, GAP);
    const one = stackOf([100, 200, 150, 40, 5000, 1]);
    stackVerbs(one, 1, GAP);
    expect(offsets(one, 1)).toEqual([0]);
    expect(ranks(one, 1)).toEqual([0]);
  });

  it('keeps an already clear pair at 0 (side by side, or one well above the other)', () => {
    const side = stackOf([100, 200, 100, 40, 5000, 1], [300, 200, 100, 40, 6000, 2]);
    stackVerbs(side, 2, GAP);
    expect(offsets(side, 2)).toEqual([0, 0]);
    const above = stackOf([100, 200, 100, 40, 5000, 1], [100, 100, 100, 40, 6000, 2]);
    stackVerbs(above, 2, GAP);
    expect(offsets(above, 2)).toEqual([0, 0]);
  });

  it('keeps a pair that only touches at 0, and one that is closer than the gap but does not overlap', () => {
    // A is [160, 200]; B's bottom is at 160: they touch. A gap is added only to a verb that is pushed.
    const touch = stackOf([100, 200, 100, 40, 5000, 1], [100, 160, 100, 40, 6000, 2]);
    stackVerbs(touch, 2, GAP);
    expect(offsets(touch, 2)).toEqual([0, 0]);
  });

  it('pushes the less urgent of two overlapping verbs up, by the smallest step plus the gap', () => {
    // Both at the same place, 40 px high: the second goes up by 40 + 4.
    const stack = stackOf([100, 200, 100, 40, 5000, 1], [100, 200, 100, 40, 6000, 2]);
    stackVerbs(stack, 2, GAP);
    expect(offsets(stack, 2)).toEqual([0, 40 + GAP]);
  });

  it('pushes by the smallest step: a partial overlap needs only the overlap, plus the gap', () => {
    // A is [160, 200]; B is [180, 220] and overlaps by 20: B goes up by 220 - 160 + 4 = 64.
    const stack = stackOf([100, 200, 100, 40, 5000, 1], [100, 220, 100, 40, 6000, 2]);
    stackVerbs(stack, 2, GAP);
    expect(offsets(stack, 2)).toEqual([0, 64]);
  });

  it('does not push a verb that only shares the height of another one, not its width', () => {
    const stack = stackOf([100, 200, 100, 40, 5000, 1], [210, 200, 100, 40, 6000, 2]);
    stackVerbs(stack, 2, GAP);
    expect(offsets(stack, 2)).toEqual([0, 0]);
  });

  it('pushes when the boxes overlap by a pixel horizontally, not when they touch', () => {
    // Half widths 50 + 50 = 100: centres 99 apart overlap, 100 apart touch.
    const overlap = stackOf([100, 200, 100, 40, 5000, 1], [199, 200, 100, 40, 6000, 2]);
    stackVerbs(overlap, 2, GAP);
    expect(offsets(overlap, 2)).toEqual([0, 44]);
    const touch = stackOf([100, 200, 100, 40, 5000, 1], [200, 200, 100, 40, 6000, 2]);
    stackVerbs(touch, 2, GAP);
    expect(offsets(touch, 2)).toEqual([0, 0]);
  });

  it('stacks three verbs one above the other, clearing every verb already placed', () => {
    const stack = stackOf(
      [100, 200, 100, 40, 5000, 1],
      [100, 200, 100, 40, 6000, 2],
      [100, 200, 100, 40, 7000, 3],
    );
    stackVerbs(stack, 3, GAP);
    expect(offsets(stack, 3)).toEqual([0, 44, 88]);
  });

  it('clears a verb that is pushed into another one above it (a second push)', () => {
    // A is [160, 200] and B is [100, 140]; C overlaps A, is pushed above A's top (156) and lands in B.
    const stack = stackOf(
      [100, 200, 100, 40, 5000, 1],
      [100, 140, 100, 40, 6000, 2],
      [100, 200, 100, 40, 7000, 3],
    );
    stackVerbs(stack, 3, GAP);
    const [a, b, c] = offsets(stack, 3);
    expect([a, b]).toEqual([0, 0]);
    // C ends above B's top (100) minus the gap: bottom at 96, so offset 200 - 96 = 104.
    expect(c).toBe(104);
  });

  it('leaves no overlap among the stacked verbs, whatever the order they were given', () => {
    const stack = stackOf(
      [100, 200, 120, 40, 7000, 3],
      [120, 210, 100, 36, 5000, 1],
      [90, 190, 140, 32, 6000, 2],
      [400, 200, 100, 40, 4000, 4],
    );
    stackVerbs(stack, 4, GAP);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const dx = Math.abs((stack.centerXPx[a] as number) - (stack.centerXPx[b] as number));
        const isHorizontal = dx < ((stack.widthPx[a] as number) + (stack.widthPx[b] as number)) / 2;
        const bottomA = (stack.bottomPx[a] as number) - (stack.offsetPx[a] as number);
        const bottomB = (stack.bottomPx[b] as number) - (stack.offsetPx[b] as number);
        const topA = bottomA - (stack.heightPx[a] as number);
        const topB = bottomB - (stack.heightPx[b] as number);
        const isVertical = topA < bottomB && bottomA > topB;
        expect(isHorizontal && isVertical, `${a} and ${b} overlap`).toBe(false);
      }
    }
    // The far box (4) is alone on its side: never moved.
    expect(stack.offsetPx[3]).toBe(0);
  });

  it('ranks by urgency: the window that closes first is rank 0, in whatever order the boxes come', () => {
    const stack = stackOf(
      [100, 200, 100, 40, 7000, 1],
      [100, 200, 100, 40, 5000, 2],
      [100, 200, 100, 40, 6000, 3],
    );
    stackVerbs(stack, 3, GAP);
    expect(ranks(stack, 3)).toEqual([2, 0, 1]);
    // The most urgent (index 1) stays at its place, the others go up in turn.
    expect(offsets(stack, 3)).toEqual([88, 0, 44]);
  });

  it('breaks a tie of windows with the lower id', () => {
    const stack = stackOf([100, 200, 100, 40, 5000, 9], [100, 200, 100, 40, 5000, 4]);
    stackVerbs(stack, 2, GAP);
    expect(ranks(stack, 2)).toEqual([1, 0]);
    expect(offsets(stack, 2)).toEqual([44, 0]);
  });

  it('ranks a threat with no window (Infinity) last', () => {
    const stack = stackOf(
      [100, 200, 100, 40, Number.POSITIVE_INFINITY, 1],
      [100, 200, 100, 40, 9000, 2],
    );
    stackVerbs(stack, 2, GAP);
    expect(ranks(stack, 2)).toEqual([1, 0]);
  });

  it('never moves a box with no text (zero width and height), and no verb is pushed by it', () => {
    const stack = stackOf([100, 200, 0, 0, 4000, 1], [100, 200, 100, 40, 5000, 2]);
    stackVerbs(stack, 2, GAP);
    expect(offsets(stack, 2)).toEqual([0, 0]);
    expect(ranks(stack, 2)).toEqual([0, 1]);
  });

  it('leaves a box with no text alone even when it sits inside a verb, whichever is more urgent', () => {
    // Zero-size point at (100, 180): inside the verb's span (x 50..150, y 160..200).
    const behind = stackOf([100, 180, 0, 0, 5000, 1], [100, 200, 100, 40, 4000, 2]);
    stackVerbs(behind, 2, GAP);
    expect(offsets(behind, 2)).toEqual([0, 0]);
    const inFront = stackOf([100, 180, 0, 0, 4000, 1], [100, 200, 100, 40, 5000, 2]);
    stackVerbs(inFront, 2, GAP);
    expect(offsets(inFront, 2)).toEqual([0, 0]);
  });

  it('whole pixels: a fractional box rounds the push up, so the gap is never eaten', () => {
    const stack = stackOf([100, 200, 100, 40.4, 5000, 1], [100, 200, 100, 40.4, 6000, 2]);
    stackVerbs(stack, 2, GAP);
    expect(offsets(stack, 2)).toEqual([0, 45]);
  });

  it('only reads the first `count` boxes (the arrays are sized for the whole level)', () => {
    const stack = stackOf([100, 200, 100, 40, 5000, 1], [100, 200, 100, 40, 6000, 2]);
    stackVerbs(stack, 1, GAP);
    expect(offsets(stack, 1)).toEqual([0]);
  });
});
