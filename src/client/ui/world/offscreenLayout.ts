import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  HOLD_RING_OUTLINE_PX,
  OFFSCREEN_BUBBLE_BORDER_PX,
  OFFSCREEN_BUBBLE_CHEVRON_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
  OFFSCREEN_BUBBLE_PADDING_PX,
  OFFSCREEN_BUBBLE_STACK_GAP_PX,
} from '@shared/constants';
import { compareUrgency } from '../../input/urgency.ts';

// Where the off-screen bubbles of a follow level sit (story 9.3, D3), as pure maths: no DOM, no
// `three`. Bubble centres live on a U-shaped track inside the HUD insets: up the left edge from just
// above the bottom third to just under the HUD row, along the top edge, down the right edge. A
// threat's wish is where the ray from the frame's centre toward its screen point crosses the track's
// rectangle; a threat below the frame goes to the bottom of the leg on its side. The 3 most urgent
// are kept, sorted along the track and packed so that two bubbles (chevrons included) keep the stack
// gap between them, Euclidean (two bubbles either side of a corner stay apart), going round a corner
// when an edge is full. Everything is written into preallocated slots: a frame allocates nothing.

/** The edge a bubble is stuck to. */
export type OffscreenEdge = 'left' | 'top' | 'right';

/** The bubble's radii for an icon of `iconPx`: the paper disc (its border included) and the chevron's reach. */
export interface OffscreenBubbleRadii {
  /** The ring hugs the icon (no hold-ring inside): its gap, its lit arc and the arc's ink outline. */
  readonly ringOuterPx: number;
  /** The disc, its ink border included. */
  readonly discPx: number;
  /** The disc plus the chevron: what the layout keeps apart and out of the bottom third. */
  readonly outerPx: number;
}

/** The radii of a bubble whose icon is `iconPx` (`OFFSCREEN_BUBBLE_ICON_*_PX` by surface), from the constants. */
export function offscreenBubbleRadii(iconPx: number): OffscreenBubbleRadii {
  const ringOuterPx =
    iconPx / 2 + CHRONO_RING_GAP_PX + CHRONO_RING_FINAL_ARC_STROKE_PX + HOLD_RING_OUTLINE_PX;
  const discPx = ringOuterPx + OFFSCREEN_BUBBLE_PADDING_PX + OFFSCREEN_BUBBLE_BORDER_PX;
  return { ringOuterPx, discPx, outerPx: discPx + OFFSCREEN_BUBBLE_CHEVRON_PX };
}

/** The screen the bubbles are laid out on, in CSS px of the HUD root. Set on every resize. */
export interface OffscreenViewport {
  widthPx: number;
  heightPx: number;
  /** `{spacing.hud-inset}` on the left and the right. */
  insetLeftPx: number;
  insetRightPx: number;
  /** The bottom of the HUD row: the top edge's bubbles sit a stack gap under it. */
  hudBottomPx: number;
  /** A bubble's outer radius on this surface, chevron included (`OffscreenBubbleRadii.outerPx`). */
  radiusPx: number;
  /** The follow frame's centre on this screen: where the rays toward the threats start. */
  centreXPx: number;
  centreYPx: number;
}

/** One threat outside the frame: its id, its icon point on the screen and its urgency (`threatCloseAt`). */
export interface OffscreenCandidate {
  threatId: number;
  xPx: number;
  yPx: number;
  closeAt: number;
}

/** A box the bubbles must keep clear of (the silence bubble and its ring, D8), or none. */
export interface OffscreenObstacle {
  isSet: boolean;
  leftPx: number;
  topPx: number;
  rightPx: number;
  bottomPx: number;
}

/** One placed bubble; `threatId` is -1 for an empty slot. */
export interface OffscreenSlot {
  threatId: number;
  edge: OffscreenEdge;
  /** The bubble's centre, whole CSS px of the HUD root. */
  xPx: number;
  yPx: number;
  /** From the centre toward the threat's point, whole degrees clockwise from the right, `[0, 360)`. */
  angleDeg: number;
}

export function createOffscreenViewport(): OffscreenViewport {
  return {
    widthPx: 0,
    heightPx: 0,
    insetLeftPx: 0,
    insetRightPx: 0,
    hudBottomPx: 0,
    radiusPx: 0,
    centreXPx: 0,
    centreYPx: 0,
  };
}

export function createOffscreenCandidate(): OffscreenCandidate {
  return { threatId: -1, xPx: 0, yPx: 0, closeAt: 0 };
}

export function createOffscreenObstacle(): OffscreenObstacle {
  return { isSet: false, leftPx: 0, topPx: 0, rightPx: 0, bottomPx: 0 };
}

/** The `OFFSCREEN_BUBBLE_MAX_COUNT` slots a layout writes, all empty. */
export function createOffscreenSlots(): OffscreenSlot[] {
  return Array.from({ length: OFFSCREEN_BUBBLE_MAX_COUNT }, () => ({
    threatId: -1,
    edge: 'top' as OffscreenEdge,
    xPx: 0,
    yPx: 0,
    angleDeg: 0,
  }));
}

/** The lowest a bubble's centre goes: its outer edge stays above the bottom third. */
export function lowestCentrePx(viewport: Readonly<OffscreenViewport>): number {
  return (viewport.heightPx * 2) / 3 - viewport.radiusPx;
}

/** The highest: its outer edge a stack gap under the HUD row. */
export function highestCentrePx(viewport: Readonly<OffscreenViewport>): number {
  return viewport.hudBottomPx + OFFSCREEN_BUBBLE_STACK_GAP_PX + viewport.radiusPx;
}

// The track of the current layout: x of the legs, y of the top edge and of the legs' bottom, lengths.
let leftXPx = 0;
let rightXPx = 0;
let topYPx = 0;
let lowYPx = 0;
let legPx = 0;
let topPx = 0;
let totalPx = 0;
// The obstacle's forbidden stretch of the track, `[forbidFrom, forbidTo]`, or none.
let hasForbidden = false;
let forbidFrom = 0;
let forbidTo = 0;
let minGapPx = 0;
// The chosen candidates (indices), their wishes and their places along the track.
const chosen = [0, 0, 0];
const wishes = [0, 0, 0];
const places = [0, 0, 0];
const BISECTIONS = 40;

function setTrack(viewport: Readonly<OffscreenViewport>): void {
  const r = viewport.radiusPx;
  leftXPx = viewport.insetLeftPx + r;
  rightXPx = Math.max(leftXPx, viewport.widthPx - viewport.insetRightPx - r);
  topYPx = highestCentrePx(viewport);
  lowYPx = Math.max(topYPx, lowestCentrePx(viewport));
  legPx = lowYPx - topYPx;
  topPx = rightXPx - leftXPx;
  totalPx = 2 * legPx + topPx;
  minGapPx = 2 * r + OFFSCREEN_BUBBLE_STACK_GAP_PX;
}

const xAt = (s: number): number =>
  s <= legPx ? leftXPx : s >= legPx + topPx ? rightXPx : leftXPx + (s - legPx);
const yAt = (s: number): number =>
  s <= legPx ? lowYPx - s : s >= legPx + topPx ? topYPx + (s - legPx - topPx) : topYPx;
const distanceAt = (a: number, b: number): number => Math.hypot(xAt(a) - xAt(b), yAt(a) - yAt(b));

/** The stretch of the track whose bubble would touch `obstacle` grown by the stack gap, hull of the three legs. */
function setForbidden(obstacle: Readonly<OffscreenObstacle> | null, r: number): void {
  hasForbidden = false;
  if (obstacle === null || !obstacle.isSet) return;
  const reach = r + OFFSCREEN_BUBBLE_STACK_GAP_PX;
  const left = obstacle.leftPx - reach;
  const right = obstacle.rightPx + reach;
  const top = obstacle.topPx - reach;
  const bottom = obstacle.bottomPx + reach;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  // The legs: a vertical stretch of each that the grown box covers. The left leg runs upward, the right
  // one downward, so their places are `lowYPx − y` and `legPx + topPx + (y − topYPx)`.
  const y0 = Math.max(top, topYPx);
  const y1 = Math.min(bottom, lowYPx);
  if (y0 <= y1 && leftXPx >= left && leftXPx <= right) {
    from = Math.min(from, lowYPx - y1);
    to = Math.max(to, lowYPx - y0);
  }
  if (y0 <= y1 && rightXPx >= left && rightXPx <= right) {
    from = Math.min(from, legPx + topPx + (y0 - topYPx));
    to = Math.max(to, legPx + topPx + (y1 - topYPx));
  }
  if (topYPx >= top && topYPx <= bottom) {
    const x0 = Math.max(left, leftXPx);
    const x1 = Math.min(right, rightXPx);
    if (x0 <= x1) {
      from = Math.min(from, legPx + (x0 - leftXPx));
      to = Math.max(to, legPx + (x1 - leftXPx));
    }
  }
  if (from <= to) {
    hasForbidden = true;
    forbidFrom = from;
    forbidTo = to;
  }
}

/** Where the ray from the frame's centre toward `(xPx, yPx)` meets the track, as a place along it. */
function wishOf(viewport: Readonly<OffscreenViewport>, xPx: number, yPx: number): number {
  const cx = Math.min(rightXPx, Math.max(leftXPx, viewport.centreXPx));
  const cy = Math.min(lowYPx, Math.max(topYPx, viewport.centreYPx));
  const dx = xPx - cx;
  const dy = yPx - cy;
  const tx =
    dx > 0 ? (rightXPx - cx) / dx : dx < 0 ? (leftXPx - cx) / dx : Number.POSITIVE_INFINITY;
  const ty = dy < 0 ? (topYPx - cy) / dy : dy > 0 ? (lowYPx - cy) / dy : Number.POSITIVE_INFINITY;
  if (ty < tx && dy > 0) {
    // Below the frame: the bottom of the leg on the threat's side (straight below goes right).
    return xPx < viewport.centreXPx ? 0 : totalPx;
  }
  if (tx <= ty) {
    const y = cy + Math.min(tx, 1e9) * dy;
    return dx < 0 ? lowYPx - y : legPx + topPx + (y - topYPx);
  }
  const x = cx + ty * dx;
  return legPx + (x - leftXPx);
}

/** The first place at or after `s` that keeps the gap from a bubble at `previous`; past the end when none. */
function nextAfter(s: number, previous: number): number {
  let from = Math.max(s, previous);
  if (distanceAt(from, previous) < minGapPx) {
    if (distanceAt(totalPx, previous) < minGapPx) return totalPx + 1;
    let lo = from;
    let hi = totalPx;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (distanceAt(mid, previous) >= minGapPx) hi = mid;
      else lo = mid;
    }
    from = hi;
  }
  if (hasForbidden && from > forbidFrom && from < forbidTo) from = forbidTo;
  return from;
}

/** The last place at or before `s` that keeps the gap from a bubble at `following`; below 0 when none. */
function previousBefore(s: number, following: number): number {
  let from = Math.min(s, following);
  if (distanceAt(from, following) < minGapPx) {
    if (distanceAt(0, following) < minGapPx) return -1;
    let lo = 0;
    let hi = from;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (distanceAt(mid, following) >= minGapPx) lo = mid;
      else hi = mid;
    }
    from = lo;
  }
  if (hasForbidden && from > forbidFrom && from < forbidTo) from = forbidFrom;
  return from;
}

/** A place of its own, out of the forbidden stretch (forward first, back when that runs off the end). */
function clearOfObstacle(s: number): number {
  if (!hasForbidden || s <= forbidFrom || s >= forbidTo) return s;
  return forbidTo <= totalPx ? forbidTo : forbidFrom;
}

/** Packs the first `count` chosen bubbles (sorted by wish); false when they do not fit. */
function pack(count: number): boolean {
  for (let i = 0; i < count; i++) {
    const wish = wishes[i] as number;
    places[i] = i === 0 ? clearOfObstacle(wish) : nextAfter(wish, places[i - 1] as number);
  }
  if ((places[count - 1] as number) <= totalPx) return true;
  // Ran past the end: pack again from the end backward, never past where the forward pass put each.
  places[count - 1] = clearOfObstacle(Math.min(totalPx, wishes[count - 1] as number));
  for (let i = count - 2; i >= 0; i--) {
    places[i] = previousBefore(places[i] as number, places[i + 1] as number);
  }
  return (places[0] as number) >= 0;
}

/**
 * Lays out the bubbles of `candidates[0..count)`: the `OFFSCREEN_BUBBLE_MAX_COUNT` most urgent are
 * placed into `slots` in track order (left leg from the bottom, top edge from the left, right leg to
 * the bottom), the rest of the slots emptied. Returns how many were placed. Deterministic, allocates
 * nothing; `obstacle` is a box the bubbles must keep clear of (null or unset: none).
 */
export function layoutOffscreen(
  viewport: Readonly<OffscreenViewport>,
  candidates: readonly Readonly<OffscreenCandidate>[],
  count: number,
  obstacle: Readonly<OffscreenObstacle> | null,
  slots: OffscreenSlot[],
): number {
  setTrack(viewport);
  setForbidden(obstacle, viewport.radiusPx);
  // The most urgent first (an insertion into a list of at most 3).
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const candidate = candidates[i] as Readonly<OffscreenCandidate>;
    let at = kept;
    while (at > 0) {
      const other = candidates[chosen[at - 1] as number] as Readonly<OffscreenCandidate>;
      if (
        compareUrgency(candidate.closeAt, candidate.threatId, other.closeAt, other.threatId) >= 0
      ) {
        break;
      }
      if (at < OFFSCREEN_BUBBLE_MAX_COUNT) chosen[at] = chosen[at - 1] as number;
      at--;
    }
    if (at < OFFSCREEN_BUBBLE_MAX_COUNT) chosen[at] = i;
    if (kept < OFFSCREEN_BUBBLE_MAX_COUNT) kept++;
  }
  // Fewer when they cannot all fit on the track: the least urgent goes first.
  let placed = kept;
  while (placed > 0) {
    for (let i = 0; i < placed; i++) {
      const candidate = candidates[chosen[i] as number] as Readonly<OffscreenCandidate>;
      wishes[i] = wishOf(viewport, candidate.xPx, candidate.yPx);
    }
    sortByWish(placed);
    if (pack(placed)) break;
    // Drop the least urgent of the chosen (they were sorted by wish: find it again).
    dropLeastUrgent(candidates, placed);
    placed--;
  }
  for (let i = 0; i < OFFSCREEN_BUBBLE_MAX_COUNT; i++) {
    const slot = slots[i] as OffscreenSlot;
    if (i >= placed) {
      slot.threatId = -1;
      continue;
    }
    const candidate = candidates[chosen[i] as number] as Readonly<OffscreenCandidate>;
    const s = places[i] as number;
    slot.threatId = candidate.threatId;
    slot.edge = s < legPx ? 'left' : s > legPx + topPx ? 'right' : 'top';
    slot.xPx = Math.round(xAt(s));
    slot.yPx = Math.round(yAt(s));
    const angle = Math.round(
      (Math.atan2(candidate.yPx - slot.yPx, candidate.xPx - slot.xPx) * 180) / Math.PI,
    );
    slot.angleDeg = angle < 0 ? angle + 360 : angle;
  }
  return placed;
}

/** Sorts `chosen` and `wishes` together by wish, then urgency order kept for equal wishes (insertion). */
function sortByWish(count: number): void {
  for (let i = 1; i < count; i++) {
    const wish = wishes[i] as number;
    const index = chosen[i] as number;
    let at = i;
    while (at > 0 && (wishes[at - 1] as number) > wish) {
      wishes[at] = wishes[at - 1] as number;
      chosen[at] = chosen[at - 1] as number;
      at--;
    }
    wishes[at] = wish;
    chosen[at] = index;
  }
}

function dropLeastUrgent(candidates: readonly Readonly<OffscreenCandidate>[], count: number): void {
  let least = 0;
  for (let i = 1; i < count; i++) {
    const a = candidates[chosen[i] as number] as Readonly<OffscreenCandidate>;
    const b = candidates[chosen[least] as number] as Readonly<OffscreenCandidate>;
    if (compareUrgency(a.closeAt, a.threatId, b.closeAt, b.threatId) > 0) least = i;
  }
  for (let i = least; i < count - 1; i++) chosen[i] = chosen[i + 1] as number;
}

/** Where the glyph chip hangs beside a targeted bubble (D7): toward the screen's centre first. */
export type OffscreenChipSide = 'right' | 'left' | 'below';

/** Where the chip goes: its side of the bubble, or null when no side is free. */
export interface OffscreenChipPlace {
  side: OffscreenChipSide | null;
}

/** The chip's box for a side of the bubble at `(x, y)`, written into the scratch below. */
let chipLeft = 0;
let chipTop = 0;
let chipRight = 0;
let chipBottom = 0;

function setChipBox(
  side: OffscreenChipSide,
  x: number,
  y: number,
  radiusPx: number,
  chipWidthPx: number,
  chipHeightPx: number,
): void {
  const reach = radiusPx + OFFSCREEN_BUBBLE_STACK_GAP_PX;
  if (side === 'below') {
    chipLeft = x - chipWidthPx / 2;
    chipRight = x + chipWidthPx / 2;
    chipTop = y + reach;
    chipBottom = chipTop + chipHeightPx;
    return;
  }
  chipTop = y - chipHeightPx / 2;
  chipBottom = y + chipHeightPx / 2;
  chipLeft = side === 'right' ? x + reach : x - reach - chipWidthPx;
  chipRight = chipLeft + chipWidthPx;
}

const SIDES_LEFT: readonly OffscreenChipSide[] = ['right', 'below', 'left'];
const SIDES_RIGHT: readonly OffscreenChipSide[] = ['left', 'below', 'right'];
const SIDES_TOP_LEFT: readonly OffscreenChipSide[] = ['below', 'right', 'left'];
const SIDES_TOP_RIGHT: readonly OffscreenChipSide[] = ['below', 'left', 'right'];

/**
 * The side of `slots[index]` the glyph chip goes to (D7): toward the screen's centre (a left bubble's
 * right, a right bubble's left, under a top one), else the next side whose chip box is on the screen,
 * under the HUD row, above the bottom third and off every other bubble. Allocates nothing.
 */
export function placeOffscreenChip(
  viewport: Readonly<OffscreenViewport>,
  slots: readonly Readonly<OffscreenSlot>[],
  index: number,
  chipWidthPx: number,
  chipHeightPx: number,
  out: OffscreenChipPlace,
): void {
  const slot = slots[index] as Readonly<OffscreenSlot>;
  const r = viewport.radiusPx;
  const sides =
    slot.edge === 'left'
      ? SIDES_LEFT
      : slot.edge === 'right'
        ? SIDES_RIGHT
        : slot.xPx < viewport.widthPx / 2
          ? SIDES_TOP_LEFT
          : SIDES_TOP_RIGHT;
  const lowestPx = (viewport.heightPx * 2) / 3;
  for (let k = 0; k < sides.length; k++) {
    const side = sides[k] as OffscreenChipSide;
    setChipBox(side, slot.xPx, slot.yPx, r, chipWidthPx, chipHeightPx);
    if (
      chipLeft < 0 ||
      chipRight > viewport.widthPx ||
      chipTop < viewport.hudBottomPx ||
      chipBottom > lowestPx
    ) {
      continue;
    }
    let isClear = true;
    for (let i = 0; i < slots.length; i++) {
      const other = slots[i] as Readonly<OffscreenSlot>;
      if (i === index || other.threatId === -1) continue;
      const nearX = Math.min(Math.max(other.xPx, chipLeft), chipRight);
      const nearY = Math.min(Math.max(other.yPx, chipTop), chipBottom);
      if (Math.hypot(other.xPx - nearX, other.yPx - nearY) < r) {
        isClear = false;
        break;
      }
    }
    if (isClear) {
      out.side = side;
      return;
    }
  }
  out.side = null;
}

/** The chip's box for `side` of the bubble at `(xPx, yPx)` (the tests read it). */
export function offscreenChipBox(
  side: OffscreenChipSide,
  xPx: number,
  yPx: number,
  radiusPx: number,
  chipWidthPx: number,
  chipHeightPx: number,
): { leftPx: number; topPx: number; rightPx: number; bottomPx: number } {
  setChipBox(side, xPx, yPx, radiusPx, chipWidthPx, chipHeightPx);
  return { leftPx: chipLeft, topPx: chipTop, rightPx: chipRight, bottomPx: chipBottom };
}
