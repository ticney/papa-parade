import { OFFSCREEN_BUBBLE_HYSTERESIS_PX } from '@shared/constants';
import { createFollowFrame, viewUM, viewVM, worldOfView } from '@shared/followCamera';
import type { ThreatInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import type { OffscreenBubbles } from '../world/offscreenBubble.ts';
import type { OffscreenSlot } from '../world/offscreenLayout.ts';
import type { ThreatMarkerEntry } from '../world/threatMarkers.ts';
import { createOffscreenHud, type OffscreenChip, type OffscreenScreen } from './offscreenHud.ts';

const WIDTH = 844;
const HEIGHT = 390;

/** A follow frame 10 m × (10 / aspect) m, centred on the view-plane origin. */
function followOf(mode: 'fixed' | 'follow' = 'follow') {
  const frame = createFollowFrame();
  frame.halfWidthM = 5;
  frame.halfHeightM = 5 / (WIDTH / HEIGHT);
  return { mode, frame, centreUM: 0, centreVM: 0 };
}

/** The world point at the icon height that lands on the screen point `(xPx, yPx)` of that frame. */
function entryAt(threatId: number, xPx: number, yPx: number): ThreatMarkerEntry {
  const follow = followOf();
  const uM = ((xPx / WIDTH) * 2 - 1) * follow.frame.halfWidthM;
  const vM = (1 - (yPx / HEIGHT) * 2) * follow.frame.halfHeightM;
  const out = { xM: 0, zM: 0 };
  worldOfView(uM, vM, 0.3, out);
  expect(viewUM(out.xM, out.zM)).toBeCloseTo(uM, 9);
  expect(viewVM(out.xM, 0.3, out.zM)).toBeCloseTo(vM, 9);
  return {
    threatId,
    xM: out.xM,
    yM: 0.3,
    zM: out.zM,
    icon: 'bolt',
    followsPapa: false,
    verb: '',
    iconShape: 'circle',
    color: 'parry',
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
}

const threat = (id: number, state = 'windowOpen', closeAt = 2000) =>
  ({
    id,
    state,
    windowOpenAt: closeAt - 400,
    responseWindow: { windowMs: 400 },
  }) as unknown as Readonly<ThreatInstance>;

function setup(mode: 'fixed' | 'follow' = 'follow') {
  const updates: { slots: OffscreenSlot[]; targetedId: number | null; pressedId: number | null }[] =
    [];
  let hides = 0;
  let measures = 0;
  const bubbles: OffscreenBubbles = {
    elements: [],
    setLevel: () => {},
    setDiscRadius: () => {},
    update: (slots, targetedId, pressedId = null) =>
      updates.push({
        slots: slots.filter((slot) => slot.threatId !== -1).map((slot) => ({ ...slot })),
        targetedId,
        pressedId,
      }),
    pick: (x, y) => (x === 100 && y === 50 ? 7 : null),
    hide: () => {
      hides++;
    },
  };
  const hud = createOffscreenHud({
    bubbles,
    follow: followOf(mode),
    measure: (out: OffscreenScreen) => {
      measures++;
      Object.assign(out, {
        hudLeftPx: 10,
        hudTopPx: 20,
        widthPx: WIDTH,
        heightPx: HEIGHT,
        insetLeftPx: 12,
        insetRightPx: 12,
        hudBottomPx: 56,
        canvasLeftPx: 0,
        canvasTopPx: 0,
        canvasWidthPx: WIDTH,
        canvasHeightPx: HEIGHT,
        isCompact: true,
      } satisfies OffscreenScreen);
      return true;
    },
    silenceBox: (out) =>
      Object.assign(out, { isSet: true, leftPx: 0, topPx: 0, rightPx: 1, bottomPx: 1 }),
  });
  return {
    hud,
    updates,
    hides: () => hides,
    measures: () => measures,
  };
}

describe('createOffscreenHud (story 9.3)', () => {
  it('gives a bubble to an active threat outside the frame, on its side, and none inside', () => {
    const { hud, updates } = setup();
    hud.setLevel([entryAt(1, -80, 200), entryAt(2, 400, 200)]);
    hud.update(true, [threat(1), threat(2)], null, null, false);
    expect(updates.at(-1)?.slots.map((slot) => [slot.threatId, slot.edge])).toEqual([[1, 'left']]);
    expect(hud.mirrorText()).toMatch(/^1:left:\d+:\d+:\d+$/);
    expect(hud.hasChanged).toBe(true);
  });

  it('counts an icon under the HUD row as outside, and a hidden or idle threat as never', () => {
    const { hud, updates } = setup();
    hud.setLevel([entryAt(1, 400, 40), entryAt(2, -80, 200), entryAt(3, -80, 100)]);
    hud.update(true, [threat(1), threat(2, 'hidden'), threat(3, 'idle')], null, null, false);
    expect(updates.at(-1)?.slots.map((slot) => [slot.threatId, slot.edge])).toEqual([[1, 'top']]);
  });

  it('keeps a shown bubble until the icon is the hysteresis inside, then lets it go', () => {
    const { hud, updates } = setup();
    // 28 px is half the compact icon: on the line is inside.
    const justInside = entryAt(1, 28 + OFFSCREEN_BUBBLE_HYSTERESIS_PX / 2, 200);
    hud.setLevel([justInside]);
    hud.update(true, [threat(1)], null, null, false);
    expect(updates.at(-1)?.slots).toEqual([]);
    hud.setLevel([entryAt(1, 20, 200)]);
    hud.update(true, [threat(1)], null, null, false);
    expect(updates.at(-1)?.slots).toHaveLength(1);
    // Back a little inside: still shown (the same entry object moves, as the marker's does).
    const moving = entryAt(1, 20, 200);
    hud.setLevel([moving]);
    hud.update(true, [threat(1)], null, null, false);
    Object.assign(moving, entryAt(1, 28 + OFFSCREEN_BUBBLE_HYSTERESIS_PX / 2, 200));
    hud.update(true, [threat(1)], null, null, false);
    expect(updates.at(-1)?.slots).toHaveLength(1);
    Object.assign(moving, entryAt(1, 28 + OFFSCREEN_BUBBLE_HYSTERESIS_PX + 1, 200));
    hud.update(true, [threat(1)], null, null, false);
    expect(updates.at(-1)?.slots).toEqual([]);
  });

  it('hands the target and the press to the bubbles', () => {
    const { hud, updates } = setup();
    hud.setLevel([entryAt(1, -80, 200)]);
    hud.update(true, [threat(1)], 1, 4, false);
    expect(updates.at(-1)).toMatchObject({ targetedId: 1, pressedId: 4 });
  });

  it('does nothing in a fixed level, and hides when the level is not live', () => {
    const fixed = setup('fixed');
    fixed.hud.setLevel([entryAt(1, -80, 200)]);
    fixed.hud.update(true, [threat(1)], null, null, false);
    expect(fixed.updates).toEqual([]);
    expect(fixed.measures()).toBe(0);
    const { hud, updates, hides } = setup();
    hud.setLevel([entryAt(1, -80, 200)]);
    hud.update(true, [threat(1)], null, null, false);
    const before = hides();
    hud.update(false, [threat(1)], null, null, false);
    expect(hides()).toBe(before + 1);
    expect(updates).toHaveLength(1);
    expect(hud.mirrorText()).toBe('');
    expect(hud.hasChanged).toBe(true);
  });

  it('measures the screen once, then again only after invalidate', () => {
    const { hud, measures } = setup();
    hud.setLevel([entryAt(1, -80, 200)]);
    hud.update(true, [threat(1)], null, null, false);
    hud.update(true, [threat(1)], null, null, false);
    expect(measures()).toBe(1);
    hud.invalidate();
    hud.update(true, [threat(1)], null, null, false);
    expect(measures()).toBe(2);
  });

  it('picks in HUD px from a page point, and only while a bubble shows', () => {
    const { hud } = setup();
    hud.setLevel([entryAt(7, -80, 200)]);
    expect(hud.pick(110, 70)).toBeNull();
    hud.update(true, [threat(7)], null, null, false);
    expect(hud.pick(110, 70)).toBe(7);
  });

  it('places the chip toward the centre of a left bubble, with its NDC point', () => {
    const { hud } = setup();
    hud.setLevel([entryAt(1, -80, 200)]);
    hud.update(true, [threat(1)], 1, null, false);
    const chip: OffscreenChip = { side: null, xPx: 0, yPx: 0, ndcX: 0, ndcY: 0, radiusPx: 0 };
    expect(hud.chipOf(1, chip)).toBe(true);
    expect(chip.side).toBe('right');
    expect(chip.ndcX).toBeCloseTo((chip.xPx / WIDTH) * 2 - 1, 9);
    expect(chip.ndcY).toBeCloseTo(1 - (chip.yPx / HEIGHT) * 2, 9);
    expect(hud.chipOf(2, chip)).toBe(false);
  });
});
