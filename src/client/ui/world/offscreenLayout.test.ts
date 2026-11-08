import {
  OFFSCREEN_BUBBLE_CHIP_HEIGHT_PX,
  OFFSCREEN_BUBBLE_CHIP_WIDTH_PX,
  OFFSCREEN_BUBBLE_ICON_COMPACT_PX,
  OFFSCREEN_BUBBLE_ICON_REGULAR_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
  OFFSCREEN_BUBBLE_STACK_GAP_PX,
  TOUCH_TARGET_MIN_PX,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  createOffscreenCandidate,
  createOffscreenObstacle,
  createOffscreenSlots,
  createOffscreenViewport,
  layoutOffscreen,
  type OffscreenCandidate,
  type OffscreenChipPlace,
  type OffscreenObstacle,
  type OffscreenSlot,
  type OffscreenViewport,
  offscreenBubbleRadii,
  offscreenChipBox,
  placeOffscreenChip,
} from './offscreenLayout.ts';

const VIEWPORTS = [
  [667, 375],
  [750, 340],
  [844, 390],
  [1024, 768],
] as const;
const COMPACT = offscreenBubbleRadii(OFFSCREEN_BUBBLE_ICON_COMPACT_PX);
const REGULAR = offscreenBubbleRadii(OFFSCREEN_BUBBLE_ICON_REGULAR_PX);
const GAP = OFFSCREEN_BUBBLE_STACK_GAP_PX;
const HUD_BOTTOM = 56;

function viewportOf(widthPx: number, heightPx: number, radiusPx = COMPACT.outerPx) {
  const viewport = createOffscreenViewport();
  Object.assign(viewport, {
    widthPx,
    heightPx,
    insetLeftPx: 12,
    insetRightPx: 12,
    hudBottomPx: HUD_BOTTOM,
    radiusPx,
    centreXPx: widthPx / 2,
    centreYPx: heightPx / 2,
  } satisfies OffscreenViewport);
  return viewport;
}

function candidatesOf(points: readonly (readonly [number, number, number?])[]) {
  return points.map(([xPx, yPx, closeAt], i) => {
    const candidate = createOffscreenCandidate();
    candidate.threatId = i + 1;
    candidate.xPx = xPx;
    candidate.yPx = yPx;
    candidate.closeAt = closeAt ?? 1000 + i;
    return candidate;
  });
}

function lay(
  viewport: OffscreenViewport,
  candidates: OffscreenCandidate[],
  obstacle: OffscreenObstacle | null = null,
): OffscreenSlot[] {
  const slots = createOffscreenSlots();
  layoutOffscreen(viewport, candidates, candidates.length, obstacle, slots);
  return slots.filter((slot) => slot.threatId !== -1).map((slot) => ({ ...slot }));
}

/** Checks the rules every layout keeps (AC 2, 4): the allowed region, the gap, at most 3. */
function expectAllowed(viewport: OffscreenViewport, slots: OffscreenSlot[]): void {
  const r = viewport.radiusPx;
  expect(slots.length).toBeLessThanOrEqual(OFFSCREEN_BUBBLE_MAX_COUNT);
  for (const slot of slots) {
    // Whole px: the rounding may take half a pixel off a bound.
    expect(slot.yPx + r).toBeLessThanOrEqual((viewport.heightPx * 2) / 3 + 0.5);
    expect(slot.yPx - r).toBeGreaterThanOrEqual(viewport.hudBottomPx + GAP - 0.5);
    expect(slot.xPx - r).toBeGreaterThanOrEqual(viewport.insetLeftPx - 0.5);
    expect(slot.xPx + r).toBeLessThanOrEqual(viewport.widthPx - viewport.insetRightPx + 0.5);
    expect(Number.isInteger(slot.xPx) && Number.isInteger(slot.yPx)).toBe(true);
    expect(Number.isInteger(slot.angleDeg)).toBe(true);
    expect(slot.angleDeg).toBeGreaterThanOrEqual(0);
    expect(slot.angleDeg).toBeLessThan(360);
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i] as OffscreenSlot;
      const b = slots[j] as OffscreenSlot;
      // Two whole-px roundings: one px of slack.
      expect(Math.hypot(a.xPx - b.xPx, a.yPx - b.yPx)).toBeGreaterThanOrEqual(2 * r + GAP - 1);
    }
  }
}

/** The angle points at the threat: the unit vectors agree (dot > 0.99). */
function expectPointsAt(slot: OffscreenSlot, xPx: number, yPx: number): void {
  const radians = (slot.angleDeg * Math.PI) / 180;
  const length = Math.hypot(xPx - slot.xPx, yPx - slot.yPx);
  const dot =
    (Math.cos(radians) * (xPx - slot.xPx) + Math.sin(radians) * (yPx - slot.yPx)) / length;
  expect(dot).toBeGreaterThan(0.99);
}

describe('offscreenBubbleRadii (story 9.3, D6, D9)', () => {
  it('hugs the icon with the ring, then the padding and the border, then the chevron', () => {
    expect(COMPACT.discPx * 2).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(REGULAR.discPx).toBe(COMPACT.discPx + 4);
    expect(COMPACT.outerPx).toBeGreaterThan(COMPACT.discPx);
    // About 70 px across on a phone, 78 on a tablet (the story's estimate), give or take the padding.
    expect(COMPACT.discPx * 2).toBeGreaterThanOrEqual(70);
    expect(COMPACT.discPx * 2).toBeLessThanOrEqual(76);
    expect(REGULAR.discPx * 2).toBeGreaterThanOrEqual(78);
    expect(REGULAR.discPx * 2).toBeLessThanOrEqual(84);
  });
});

describe('layoutOffscreen (story 9.3, D3)', () => {
  const viewport = viewportOf(844, 390);

  it('sticks a threat off the left to the left edge, at the height the ray from the centre gives', () => {
    const [slot] = lay(viewport, candidatesOf([[-200, 160]]));
    expect(slot?.edge).toBe('left');
    expect(slot?.xPx).toBe(12 + COMPACT.outerPx);
    expect(slot?.yPx).toBeGreaterThan(150);
    expect(slot?.yPx).toBeLessThan(195);
    expectPointsAt(slot as OffscreenSlot, -200, 160);
  });

  it('sticks a threat off the right to the right edge', () => {
    const [slot] = lay(viewport, candidatesOf([[1100, 180]]));
    expect(slot?.edge).toBe('right');
    expect(slot?.xPx).toBe(844 - 12 - COMPACT.outerPx);
    expectPointsAt(slot as OffscreenSlot, 1100, 180);
  });

  it('sticks a threat above the frame to the top edge, under the HUD row', () => {
    const [slot] = lay(viewport, candidatesOf([[500, -80]]));
    expect(slot?.edge).toBe('top');
    expect(slot?.yPx).toBe(HUD_BOTTOM + GAP + COMPACT.outerPx);
    expect(slot?.xPx).toBeGreaterThan(422);
    expectPointsAt(slot as OffscreenSlot, 500, -80);
  });

  it('puts a threat under the HUD row (inside the screen) on the top edge too', () => {
    const [slot] = lay(viewport, candidatesOf([[300, 30]]));
    expect(slot?.edge).toBe('top');
    expectPointsAt(slot as OffscreenSlot, 300, 30);
  });

  it('puts a threat below the frame at the bottom of the nearer side edge, above the bottom third', () => {
    const lowest = Math.round((390 * 2) / 3 - COMPACT.outerPx);
    const [left] = lay(viewport, candidatesOf([[300, 600]]));
    expect(left?.edge).toBe('left');
    expect(left?.yPx).toBe(lowest);
    const [right] = lay(viewport, candidatesOf([[600, 600]]));
    expect(right?.edge).toBe('right');
    expect(right?.yPx).toBe(lowest);
    // Straight below the centre: the tie goes right.
    const [straight] = lay(viewport, candidatesOf([[422, 600]]));
    expect(straight?.edge).toBe('right');
    expectPointsAt(straight as OffscreenSlot, 422, 600);
  });

  it('keeps the 3 most urgent of 5, ties to the lower id', () => {
    const slots = lay(
      viewport,
      candidatesOf([
        [-100, 150, 900],
        [-100, 100, 500],
        [1000, 150, 700],
        [500, -100, 500],
        [1000, 100, 2000],
      ]),
    );
    expect(slots.map((slot) => slot.threatId).sort()).toEqual([2, 3, 4]);
  });

  it('wraps a third bubble round the corner when a side edge holds two (750 × 340)', () => {
    const small = viewportOf(750, 340);
    const slots = lay(
      small,
      candidatesOf([
        [-100, 120],
        [-100, 160],
        [-100, 200],
      ]),
    );
    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.edge)).toContain('top');
    expectAllowed(small, slots);
  });

  it('keeps clear of an obstacle (the silence bubble and its ring at the top right)', () => {
    const obstacle = createOffscreenObstacle();
    Object.assign(obstacle, {
      isSet: true,
      leftPx: 844 - 12 - 156,
      topPx: HUD_BOTTOM + 8,
      rightPx: 844 - 12,
      bottomPx: HUD_BOTTOM + 66,
    });
    const slots = lay(
      viewport,
      candidatesOf([
        [1000, 60],
        [700, -50],
      ]),
      obstacle,
    );
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      const nearX = Math.min(Math.max(slot.xPx, obstacle.leftPx), obstacle.rightPx);
      const nearY = Math.min(Math.max(slot.yPx, obstacle.topPx), obstacle.bottomPx);
      expect(Math.hypot(slot.xPx - nearX, slot.yPx - nearY)).toBeGreaterThanOrEqual(
        COMPACT.outerPx + GAP - 1,
      );
    }
    expectAllowed(viewport, slots);
  });

  it('gives the same slots for the same inputs, and keeps a bubble where it is when another appears elsewhere', () => {
    const one = candidatesOf([[-150, 170]]);
    const first = lay(viewport, one);
    expect(lay(viewport, one)).toEqual(first);
    const two = candidatesOf([
      [-150, 170],
      [1100, 120],
    ]);
    const after = lay(viewport, two);
    const same = after.find((slot) => slot.threatId === 1);
    expect(same).toEqual(first[0]);
  });

  it('empties the slots when nothing is outside', () => {
    const slots = createOffscreenSlots();
    layoutOffscreen(viewport, candidatesOf([[-150, 170]]), 1, null, slots);
    expect(layoutOffscreen(viewport, [], 0, null, slots)).toBe(0);
    expect(slots.every((slot) => slot.threatId === -1)).toBe(true);
  });

  it('lays out three on one side without overlap at every viewport, on both surfaces', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const radii of [COMPACT, REGULAR]) {
        const vp = viewportOf(w, h, radii.outerPx);
        for (const x of [-120, w + 120]) {
          const slots = lay(
            vp,
            candidatesOf([
              [x, h * 0.3],
              [x, h * 0.45],
              [x, h * 0.6],
            ]),
          );
          expect(slots, `${w}×${h}`).toHaveLength(3);
          expectAllowed(vp, slots);
        }
      }
    }
  });
});

/** A small seeded generator (mulberry32): the property test is the same at every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('layoutOffscreen, a seeded property test (story 9.3, AC 4)', () => {
  it('never overlaps, stays in the allowed region, keeps the 3 most urgent and points each chevron at its threat', () => {
    const random = seeded(9_3);
    for (const [w, h] of VIEWPORTS) {
      for (const radii of [COMPACT, REGULAR]) {
        const vp = viewportOf(w, h, radii.outerPx);
        for (let run = 0; run < 150; run++) {
          const count = 1 + Math.floor(random() * 5);
          const points: [number, number, number][] = [];
          for (let i = 0; i < count; i++) {
            // A point outside the frame: on one of the four sides, beyond the screen.
            const side = Math.floor(random() * 4);
            const along = random();
            const beyond = 20 + random() * 400;
            const closeAt = Math.floor(random() * 4) * 100;
            if (side === 0) points.push([-beyond, along * h, closeAt]);
            else if (side === 1) points.push([w + beyond, along * h, closeAt]);
            else if (side === 2) points.push([along * w, -beyond, closeAt]);
            else points.push([along * w, h + beyond, closeAt]);
          }
          const candidates = candidatesOf(points);
          const slots = lay(vp, candidates);
          expectAllowed(vp, slots);
          const expected = [...candidates]
            .sort((a, b) => a.closeAt - b.closeAt || a.threatId - b.threatId)
            .slice(0, OFFSCREEN_BUBBLE_MAX_COUNT)
            .map((candidate) => candidate.threatId)
            .sort();
          expect(slots.map((slot) => slot.threatId).sort()).toEqual(expected);
          for (const slot of slots) {
            const candidate = candidates.find((c) => c.threatId === slot.threatId);
            expectPointsAt(slot, candidate?.xPx ?? 0, candidate?.yPx ?? 0);
          }
          // Deterministic: the same inputs, the same slots.
          expect(lay(vp, candidates)).toEqual(slots);
        }
      }
    }
  });
});

describe('placeOffscreenChip (story 9.3, D7)', () => {
  const viewport = viewportOf(844, 390);
  const place: OffscreenChipPlace = { side: null };
  const W = OFFSCREEN_BUBBLE_CHIP_WIDTH_PX;
  const H = OFFSCREEN_BUBBLE_CHIP_HEIGHT_PX;

  const chipOf = (slots: OffscreenSlot[], index: number) => {
    const all = createOffscreenSlots();
    for (const [i, slot] of slots.entries()) Object.assign(all[i] as OffscreenSlot, slot);
    placeOffscreenChip(viewport, all, index, W, H, place);
    return place.side;
  };

  it('puts the chip toward the centre: right of a left bubble, left of a right one, under a top one', () => {
    expect(chipOf(lay(viewport, candidatesOf([[-100, 170]])), 0)).toBe('right');
    expect(chipOf(lay(viewport, candidatesOf([[1000, 170]])), 0)).toBe('left');
    expect(chipOf(lay(viewport, candidatesOf([[300, -100]])), 0)).toBe('below');
  });

  it('never over another bubble, never in the bottom third, never above the HUD row', () => {
    const random = seeded(93);
    for (let run = 0; run < 300; run++) {
      const count = 1 + Math.floor(random() * 3);
      const points: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        const side = Math.floor(random() * 3);
        if (side === 0) points.push([-100, random() * 390]);
        else if (side === 1) points.push([944, random() * 390]);
        else points.push([random() * 844, -100]);
      }
      const slots = lay(viewport, candidatesOf(points));
      for (let index = 0; index < slots.length; index++) {
        const side = chipOf(slots, index);
        if (side === null) continue;
        const slot = slots[index] as OffscreenSlot;
        const box = offscreenChipBox(side, slot.xPx, slot.yPx, viewport.radiusPx, W, H);
        expect(box.bottomPx).toBeLessThanOrEqual((390 * 2) / 3);
        expect(box.topPx).toBeGreaterThanOrEqual(HUD_BOTTOM);
        for (const [i, other] of slots.entries()) {
          if (i === index) continue;
          const nearX = Math.min(Math.max(other.xPx, box.leftPx), box.rightPx);
          const nearY = Math.min(Math.max(other.yPx, box.topPx), box.bottomPx);
          expect(Math.hypot(other.xPx - nearX, other.yPx - nearY)).toBeGreaterThanOrEqual(
            viewport.radiusPx,
          );
        }
      }
    }
  });
});
