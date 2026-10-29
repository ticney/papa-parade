import { VERB_MIN_FONT_PX } from '@shared/constants';
import { compareUrgency } from '../../input/urgency.ts';

// The pure half of the verb label (story 2.2): how big a verb is, and where it goes when the verbs of
// several threats would overlap. No DOM, no camera, no allocation after `createVerbStack`.

/**
 * The font size of a verb, in CSS px: its base size (`typography.verb` or `verb-compact` of the
 * surface), shrunk in proportion when its natural width is over `maxWidthPx`, and never under
 * `VERB_MIN_FONT_PX` (DESIGN `verb-label.minFontSize`): a verb that is still too wide at the floor
 * overflows, it is never cut. `scale` is the « Grands verbes » multiplier of story 2.10 (D9): it
 * multiplies the base size and the floor, so that the setting only flips a variable and refits.
 * `naturalWidthPx` is the width of the text at the size `basePx × scale`. Pure.
 */
export function fitVerbFontPx(
  naturalWidthPx: number,
  basePx: number,
  maxWidthPx: number,
  scale = 1,
): number {
  const scaledBasePx = basePx * scale;
  // Nothing to measure, or no limit to measure against: the verb keeps its size.
  if (!(naturalWidthPx > 0) || !Number.isFinite(maxWidthPx)) return scaledBasePx;
  const fittedPx = Math.min(scaledBasePx, (scaledBasePx * maxWidthPx) / naturalWidthPx);
  return Math.max(VERB_MIN_FONT_PX * scale, fittedPx);
}

/**
 * The boxes of the verbs that are on screen, as parallel arrays sized once for the whole level (a
 * struct of arrays: filling and stacking them allocates nothing). The caller writes the inputs of
 * boxes `0..count - 1` each frame; `stackVerbs` writes `offsetPx` and `rank`. Screen space: `y`
 * grows downward.
 */
export interface VerbStack {
  /** Input: the box's horizontal centre. */
  readonly centerXPx: Float64Array;
  /** Input: the y of the box's bottom edge, before any push. */
  readonly bottomPx: Float64Array;
  /** Input: the box's width; 0 for a threat with no verb text (it never overlaps). */
  readonly widthPx: Float64Array;
  /** Input: the box's height; 0 for no text. */
  readonly heightPx: Float64Array;
  /** Input: when the threat's window closes (`threatCloseAt`), `Infinity` while it has none. */
  readonly closeAt: Float64Array;
  /** Input: the threat id, the tie-break of the urgency. */
  readonly ids: Int32Array;
  /** Output: how far the box is pushed up, in whole px, 0 for the most urgent. */
  readonly offsetPx: Float64Array;
  /** Output: 0 for the most urgent threat, 1 for the next, and so on. */
  readonly rank: Int32Array;
  /** Scratch: the box indices in urgency order. */
  readonly order: Int32Array;
}

/** The arrays for at most `capacity` boxes. */
export function createVerbStack(capacity: number): VerbStack {
  return {
    centerXPx: new Float64Array(capacity),
    bottomPx: new Float64Array(capacity),
    widthPx: new Float64Array(capacity),
    heightPx: new Float64Array(capacity),
    closeAt: new Float64Array(capacity),
    ids: new Int32Array(capacity),
    offsetPx: new Float64Array(capacity),
    rank: new Int32Array(capacity),
    order: new Int32Array(capacity),
  };
}

/**
 * Offsets the verbs that would overlap, so that each stays readable (story 2.2 D6, D7): boxes are
 * placed in urgency order (the window that closes first, ties to the lower id: `compareUrgency`, the
 * auto-target's rule). The most urgent stays where it is; each next one is pushed up by the smallest
 * step that clears every box already placed, plus `gapPx`, then rounded up to a whole pixel. Verbs
 * only move up, never down or sideways, so one never covers its own icon. Two boxes that only touch,
 * or that are clear, are left alone. Greedy and quadratic, fine for the few threats at once; an
 * insertion sort over `order` and no closure, so nothing allocates.
 */
export function stackVerbs(stack: VerbStack, count: number, gapPx: number): void {
  const { centerXPx, bottomPx, widthPx, heightPx, closeAt, ids, offsetPx, rank, order } = stack;
  for (let k = 0; k < count; k++) {
    let j = k;
    while (
      j > 0 &&
      compareUrgency(
        closeAt[k] as number,
        ids[k] as number,
        closeAt[order[j - 1] as number] as number,
        ids[order[j - 1] as number] as number,
      ) < 0
    ) {
      order[j] = order[j - 1] as number;
      j--;
    }
    order[j] = k;
  }
  for (let r = 0; r < count; r++) {
    const i = order[r] as number;
    rank[i] = r;
    let pushPx = 0;
    // Each push clears one placed box and only ever grows, so a few passes settle it.
    let isMoved = true;
    while (isMoved) {
      isMoved = false;
      const bottomI = (bottomPx[i] as number) - pushPx;
      const topI = bottomI - (heightPx[i] as number);
      for (let q = 0; q < r; q++) {
        const p = order[q] as number;
        const isBeside =
          Math.abs((centerXPx[i] as number) - (centerXPx[p] as number)) >=
          ((widthPx[i] as number) + (widthPx[p] as number)) / 2;
        if (isBeside) continue;
        const bottomP = (bottomPx[p] as number) - (offsetPx[p] as number);
        const topP = bottomP - (heightPx[p] as number);
        if (topI < bottomP && bottomI > topP) {
          pushPx = (bottomPx[i] as number) - topP + gapPx;
          isMoved = true;
          break;
        }
      }
    }
    offsetPx[i] = Math.ceil(pushPx);
  }
}
