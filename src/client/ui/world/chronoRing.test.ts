import { THREAT_RESPONSES } from '@content/schemas/threat';
import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  CHRONO_RING_NOTCH_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  applyChronoRingMetrics,
  CHRONO_DASH_OFFSET_STRINGS,
  CHRONO_PERMILLE_STRINGS,
  CHRONO_RING_REACH_PX,
  type ChronoRing,
  chronoDrainPermille,
  chronoJudgedMirror,
  chronoProgressPermille,
  chronoRingOf,
  chronoRingRadii,
  chronoRingStartAt,
  createChronoRing,
  hasChronoRing,
  isChronoArcLit,
  threatFootprint,
} from './chronoRing.ts';

/** A ring telegraphed at 1000, opening at 2000 (a 1000 ms delay), over a 400 ms window with a 100 ms perfect zone. */
function ringOf(window = { windowMs: 400, perfectMs: 100 }, startAt = 1000, windowOpenAt = 2000) {
  return chronoRingOf(createChronoRing(), startAt, windowOpenAt, window);
}

describe('hasChronoRing', () => {
  it('has a ring on a parry and a firm, never on a wait or a nothing', () => {
    expect(hasChronoRing('parry')).toBe(true);
    expect(hasChronoRing('firm')).toBe(true);
    expect(hasChronoRing('wait')).toBe(false);
    expect(hasChronoRing('nothing')).toBe(false);
  });

  it('says yes or no for every response of the schema', () => {
    for (const response of THREAT_RESPONSES) {
      expect(typeof hasChronoRing(response)).toBe('boolean');
    }
  });
});

describe('chronoRingStartAt (D3)', () => {
  it('is the entry of the state in telegraph', () => {
    expect(chronoRingStartAt(true, 1000, 2000, Number.NaN, 0, 1000)).toBe(1000);
  });

  it('uses what the marker remembered in windowOpen, for the same opening', () => {
    expect(chronoRingStartAt(false, 2000, 2000, 1000, 2000, 900)).toBe(1000);
  });

  it('falls back to the opening minus the delay when the memory is another telegraph or none', () => {
    expect(chronoRingStartAt(false, 2000, 2000, 1000, 1500, 900)).toBe(1100);
    expect(chronoRingStartAt(false, 2000, 2000, Number.NaN, 2000, 900)).toBe(1100);
  });
});

describe('chronoRingOf', () => {
  it('puts the final arc at delay / (delay + window) and the notch at the centre of the window', () => {
    const ring = ringOf();
    expect(ring.closeAt).toBe(2400);
    // 1000 ms of delay over a 1400 ms span.
    expect(ring.arcFromPermille).toBe(Math.round((1000 / 1400) * 1000));
    expect(ring.notchPermille).toBe(Math.round((1200 / 1400) * 1000));
    expect(ring.notchFromPermille).toBe(Math.round((1150 / 1400) * 1000));
    expect(ring.notchToPermille).toBe(Math.round((1250 / 1400) * 1000));
  });

  it('keeps the notch range around its centre and inside the final arc', () => {
    const ring = ringOf();
    expect(ring.notchFromPermille).toBeLessThanOrEqual(ring.notchPermille);
    expect(ring.notchPermille).toBeLessThanOrEqual(ring.notchToPermille);
    expect(ring.arcFromPermille).toBeLessThanOrEqual(ring.notchFromPermille);
    expect(ring.notchToPermille).toBeLessThanOrEqual(1000);
  });

  it('follows a window stretched by the tier, the fatigue and the instinct (a frozen responseWindow)', () => {
    const base = ringOf({ windowMs: 400, perfectMs: 100 });
    for (const factor of [1.5, 0.8, 1.3]) {
      const stretched = ringOf({ windowMs: 400 * factor, perfectMs: 100 });
      // The arc's share of the ring is the window's share of the span.
      const share = (400 * factor) / (1000 + 400 * factor);
      expect(1000 - stretched.arcFromPermille).toBe(Math.round(share * 1000));
      expect(stretched.closeAt).toBe(2000 + 400 * factor);
    }
    expect(1000 - base.arcFromPermille).toBe(Math.round((400 / 1400) * 1000));
  });

  it('clamps a perfect zone that is the whole window to the arc', () => {
    const ring = ringOf({ windowMs: 100, perfectMs: 100 });
    expect(ring.notchFromPermille).toBe(ring.arcFromPermille);
    expect(ring.notchToPermille).toBe(1000);
  });

  it('does not divide by zero on a degenerate span', () => {
    const ring = ringOf({ windowMs: 0, perfectMs: 0 }, 2000, 2000);
    expect(Number.isFinite(ring.arcFromPermille)).toBe(true);
    expect(chronoProgressPermille(ring, 2000)).toBeGreaterThanOrEqual(0);
  });

  it('writes into the ring it is given and returns it', () => {
    const out = createChronoRing();
    expect(chronoRingOf(out, 0, 100, { windowMs: 100, perfectMs: 50 })).toBe(out);
    expect(out.closeAt).toBe(200);
  });
});

describe('chronoProgressPermille', () => {
  const ring: ChronoRing = ringOf();

  it('is 0 at the telegraph and before it', () => {
    expect(chronoProgressPermille(ring, 1000)).toBe(0);
    expect(chronoProgressPermille(ring, 0)).toBe(0);
  });

  it('is delay / (delay + window) when the window opens', () => {
    expect(chronoProgressPermille(ring, 2000)).toBe(ring.arcFromPermille);
  });

  it('is 1000 at the close of the window and after it (the tolerance is not drawn)', () => {
    expect(chronoProgressPermille(ring, 2400)).toBe(1000);
    expect(chronoProgressPermille(ring, 2460)).toBe(1000);
    expect(chronoProgressPermille(ring, 9999)).toBe(1000);
  });

  it('is whole and grows with the sim time', () => {
    let previous = -1;
    for (let simMs = 1000; simMs <= 2400; simMs += 10) {
      const value = chronoProgressPermille(ring, simMs);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('puts a perfect press inside the notch (the mirror and the drawing share this function)', () => {
    const centre = 2000 + 400 / 2;
    for (const offsetMs of [-50, -25, 0, 25, 50]) {
      const press = chronoProgressPermille(ring, centre + offsetMs);
      expect(press).toBeGreaterThanOrEqual(ring.notchFromPermille);
      expect(press).toBeLessThanOrEqual(ring.notchToPermille);
    }
  });
});

describe('chronoJudgedMirror (AC 15)', () => {
  const ring = ringOf();

  it('is t, the threat, the press, the arc start and the notch range, in per-mille', () => {
    // A press at the centre of the window: 2000 + 400 / 2 + 0.
    const [t, id, press, arcFrom, notchFrom, notchTo] = chronoJudgedMirror(
      7340,
      4,
      ring,
      400,
      0,
    ).split(':');
    expect([t, id]).toEqual(['7340', '4']);
    expect(Number(press)).toBe(ring.notchPermille);
    expect(Number(arcFrom)).toBe(ring.arcFromPermille);
    expect(Number(notchFrom)).toBe(ring.notchFromPermille);
    expect(Number(notchTo)).toBe(ring.notchToPermille);
  });

  it('puts a perfect press in the notch and a late one past it, with the same function as the drawing', () => {
    const perfect = chronoJudgedMirror(1, 4, ring, 400, 49).split(':').map(Number);
    expect(perfect[2]).toBeGreaterThanOrEqual(perfect[4] as number);
    expect(perfect[2]).toBeLessThanOrEqual(perfect[5] as number);
    const late = chronoJudgedMirror(1, 4, ring, 400, 150).split(':').map(Number);
    expect(late[2]).toBeGreaterThan(late[5] as number);
    expect(late[2]).toBe(chronoProgressPermille(ring, 2000 + 200 + 150));
  });

  it('keeps two identical judgements apart by their time', () => {
    expect(chronoJudgedMirror(1, 4, ring, 400, 0)).not.toBe(chronoJudgedMirror(2, 4, ring, 400, 0));
  });
});

describe('isChronoArcLit', () => {
  it('lights at the opening, by the drawn time, even when the opening is off the step grid', () => {
    const ring = ringOf(undefined, 1003, 2007);
    expect(isChronoArcLit(ring, 2006.9)).toBe(false);
    expect(isChronoArcLit(ring, 2007)).toBe(true);
    expect(isChronoArcLit(ring, 2500)).toBe(true);
  });
});

describe('chronoDrainPermille (D5)', () => {
  it('is full at the press and empty at the end of the attack', () => {
    expect(chronoDrainPermille(2100, 2800, 2100)).toBe(1000);
    expect(chronoDrainPermille(2100, 2800, 2800)).toBe(0);
  });

  it('falls in between and stays clamped outside', () => {
    expect(chronoDrainPermille(2000, 3000, 2500)).toBe(500);
    expect(chronoDrainPermille(2000, 3000, 1000)).toBe(1000);
    expect(chronoDrainPermille(2000, 3000, 4000)).toBe(0);
  });

  it('is empty when the end is not after the press', () => {
    expect(chronoDrainPermille(2000, 2000, 2000)).toBe(0);
    expect(chronoDrainPermille(2000, 1500, 1800)).toBe(0);
  });
});

describe('string tables', () => {
  it('has one string per per-mille, and the matching dash offset', () => {
    expect(CHRONO_PERMILLE_STRINGS).toHaveLength(1001);
    expect(CHRONO_PERMILLE_STRINGS[0]).toBe('0');
    expect(CHRONO_PERMILLE_STRINGS[1000]).toBe('1000');
    expect(CHRONO_DASH_OFFSET_STRINGS[0]).toBe('1000');
    expect(CHRONO_DASH_OFFSET_STRINGS[1000]).toBe('0');
  });
});

describe('the ring and the marker around it (D9, AC 8)', () => {
  it('measures the ring from the constants', () => {
    // 2 px outline spread around the band; the lit arc grows out from the band's inner edge.
    expect(CHRONO_RING_REACH_PX).toBe(
      HOLD_RING_STROKE_PX +
        HOLD_RING_OUTLINE_PX +
        CHRONO_RING_GAP_PX +
        CHRONO_RING_FINAL_ARC_STROKE_PX +
        HOLD_RING_OUTLINE_PX,
    );
    const radii = chronoRingRadii(64);
    expect(radii.band.strokePx).toBe(HOLD_RING_STROKE_PX);
    expect(radii.arc.strokePx).toBe(CHRONO_RING_FINAL_ARC_STROKE_PX);
    expect(radii.notchStrokePx).toBe(CHRONO_RING_NOTCH_PX);
    // The arc and the band share their inner edge: the arc grows outward.
    expect(radii.arc.radiusPx - radii.arc.strokePx / 2).toBe(
      radii.band.radiusPx - radii.band.strokePx / 2,
    );
    // The notch crosses the whole lit arc.
    expect(radii.notchInnerPx).toBe(radii.arc.radiusPx - radii.arc.strokePx / 2);
    expect(radii.notchOuterPx).toBe(radii.arc.radiusPx + radii.arc.strokePx / 2);
  });

  for (const sizePx of [64, 56]) {
    it(`does not overlap the hold-ring, the highlight or the verb stack at ${sizePx} px`, () => {
      const half = sizePx / 2;
      const footprint = threatFootprint(sizePx);
      const radii = chronoRingRadii(sizePx);
      const inner = (stroke: { radiusPx: number; strokePx: number }): number =>
        stroke.radiusPx - stroke.strokePx / 2;
      const outer = (stroke: { radiusPx: number; strokePx: number }): number =>
        stroke.radiusPx + stroke.strokePx / 2;
      // The hold-ring (band and outline) ends before the ring starts, with the gap between.
      expect(footprint.holdOuterPx).toBe(half + HOLD_RING_STROKE_PX + HOLD_RING_OUTLINE_PX);
      expect(inner(radii.band)).toBe(footprint.holdOuterPx + CHRONO_RING_GAP_PX);
      expect(inner(radii.arc)).toBeGreaterThan(footprint.holdOuterPx);
      // Every ink of the ring, the lit arc's outline included, is inside the footprint.
      expect(outer(radii.outline)).toBeLessThanOrEqual(footprint.ringOuterPx);
      expect(outer(radii.arcOutline)).toBe(footprint.ringOuterPx);
      // The highlight starts after it, with a gap; the verb stack starts after the highlight.
      expect(footprint.highlightInnerPx).toBeGreaterThanOrEqual(
        footprint.ringOuterPx + CHRONO_RING_GAP_PX,
      );
      expect(footprint.verbBottomPx).toBeGreaterThanOrEqual(footprint.highlightOuterPx);
      expect(footprint.holdOuterPx).toBeLessThan(footprint.ringInnerPx);
    });
  }

  it('writes the custom properties the CSS reads from the constants', () => {
    const written = new Map<string, string>();
    applyChronoRingMetrics({
      style: { setProperty: (name: string, value: string) => written.set(name, value) },
    } as unknown as { style: CSSStyleDeclaration });
    expect(written.get('--pp-chrono-reach')).toBe(`${CHRONO_RING_REACH_PX}px`);
    expect(written.get('--pp-chrono-gap')).toBe(`${CHRONO_RING_GAP_PX}px`);
    expect(written.get('--pp-highlight-stroke')).toBe('4px');
    expect(written.get('--pp-highlight-outline')).toBe('2px');
  });
});
