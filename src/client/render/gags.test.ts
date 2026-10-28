import { SLIDE_DIRECTION_MIN_M } from '@shared/constants';
import { GAG_IDS } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createGagFx,
  GAG_HAIR_MS,
  GAG_LIGHTS_DARK_MS,
  GAG_LIGHTS_FADE_MS,
  GAG_LIGHTS_MIN_PCT,
  GAG_LIGHTS_TOTAL_MS,
  GAG_PRESENTATIONS,
  GAG_SLIDE_BACK_MS,
  GAG_SLIDE_HOLD_MS,
  GAG_SLIDE_M,
  GAG_SLIDE_OUT_MS,
  GAG_SLIDE_TOTAL_MS,
  hairAmountAt,
  lightsFactorAt,
  slideDirection,
  slideOffsetAt,
} from './gags.ts';

const MIN = GAG_LIGHTS_MIN_PCT / 100;

describe('GAG_PRESENTATIONS', () => {
  it('has a presentation for every gag of the sim', () => {
    expect(Object.keys(GAG_PRESENTATIONS).sort()).toEqual([...GAG_IDS].sort());
  });

  it('turns the lights off and raises the hair for the outlet gag', () => {
    expect(GAG_PRESENTATIONS.outlet_hair).toEqual({
      lightsOff: true,
      hair: true,
      babySlide: false,
    });
  });

  it('slides the baby for the stairs gag only, and shows nothing of its own for the coffee table', () => {
    expect(GAG_PRESENTATIONS.stairs_slide).toEqual({
      lightsOff: false,
      hair: false,
      babySlide: true,
    });
    expect(GAG_PRESENTATIONS.table_object_fall).toEqual({
      lightsOff: false,
      hair: false,
      babySlide: false,
    });
  });
});

describe('the surprise mischiefs of the silence (story 1.21)', () => {
  it.each(['tissues_everywhere', 'crayon_scribbles'] as const)(
    '%s shows nothing of its own: the gag cue is the show until E7',
    (gag) => {
      expect(GAG_PRESENTATIONS[gag]).toEqual({ lightsOff: false, hair: false, babySlide: false });
    },
  );
});

describe('lightsFactorAt', () => {
  it('is 1 before the gag and once it is over', () => {
    expect(lightsFactorAt(-50)).toBe(1);
    expect(lightsFactorAt(0)).toBe(1);
    expect(lightsFactorAt(GAG_LIGHTS_TOTAL_MS)).toBe(1);
    expect(lightsFactorAt(GAG_LIGHTS_TOTAL_MS + 1000)).toBe(1);
  });

  it('fades out, stays dark, then fades back in', () => {
    expect(lightsFactorAt(GAG_LIGHTS_FADE_MS / 2)).toBeCloseTo((1 + MIN) / 2, 5);
    expect(lightsFactorAt(GAG_LIGHTS_FADE_MS)).toBe(MIN);
    expect(lightsFactorAt(GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS / 2)).toBe(MIN);
    expect(
      lightsFactorAt(GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS + GAG_LIGHTS_FADE_MS / 2),
    ).toBeCloseTo((1 + MIN) / 2, 5);
  });

  it('never goes below the minimum or above full light', () => {
    for (let ms = -10; ms < GAG_LIGHTS_TOTAL_MS + 10; ms += 7) {
      const factor = lightsFactorAt(ms);
      expect(factor).toBeGreaterThanOrEqual(MIN);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });
});

describe('hairAmountAt', () => {
  it('is flat before and after, on end after its rise, and settles back', () => {
    expect(hairAmountAt(0)).toBe(0);
    expect(hairAmountAt(GAG_HAIR_MS)).toBe(0);
    const peak = Math.max(
      ...Array.from({ length: 100 }, (_, i) => hairAmountAt((i * GAG_HAIR_MS) / 100)),
    );
    expect(peak).toBeCloseTo(1, 1);
    expect(hairAmountAt(GAG_HAIR_MS * 0.9)).toBeLessThan(hairAmountAt(GAG_HAIR_MS * 0.3));
  });
});

describe('slideOffsetAt', () => {
  it('is 0 before the gag and once it is over', () => {
    expect(slideOffsetAt(-50)).toBe(0);
    expect(slideOffsetAt(0)).toBe(0);
    expect(slideOffsetAt(GAG_SLIDE_TOTAL_MS)).toBe(0);
    expect(slideOffsetAt(GAG_SLIDE_TOTAL_MS + 1000)).toBe(0);
  });

  it('goes out with an ease-out, is held at its peak, and comes back', () => {
    expect(slideOffsetAt(GAG_SLIDE_OUT_MS)).toBe(GAG_SLIDE_M);
    expect(slideOffsetAt(GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS / 2)).toBe(GAG_SLIDE_M);
    // Ease-out: more than half the way at half the time.
    expect(slideOffsetAt(GAG_SLIDE_OUT_MS / 2)).toBeGreaterThan(GAG_SLIDE_M / 2);
    expect(
      slideOffsetAt(GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS + GAG_SLIDE_BACK_MS / 2),
    ).toBeLessThan(GAG_SLIDE_M / 2);
  });

  it('peaks at GAG_SLIDE_M and never leaves [0, GAG_SLIDE_M]', () => {
    let peak = 0;
    for (let ms = -10; ms < GAG_SLIDE_TOTAL_MS + 10; ms += 5) {
      const offset = slideOffsetAt(ms);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(GAG_SLIDE_M);
      peak = Math.max(peak, offset);
    }
    expect(peak).toBe(GAG_SLIDE_M);
  });

  it('is monotonic out, then back', () => {
    let last = 0;
    for (let ms = 1; ms <= GAG_SLIDE_OUT_MS; ms++) {
      const offset = slideOffsetAt(ms);
      expect(offset).toBeGreaterThanOrEqual(last);
      last = offset;
    }
    for (let ms = GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS; ms < GAG_SLIDE_TOTAL_MS; ms++) {
      const offset = slideOffsetAt(ms);
      expect(offset).toBeLessThanOrEqual(last);
      last = offset;
    }
  });
});

describe('slideDirection', () => {
  it('is the unit vector from the threat to the baby', () => {
    const out = { x: 9, z: 9 };
    slideDirection(1, 1, 4, 5, 0, 1, out);
    expect(out).toEqual({ x: 0.6, z: 0.8 });
  });

  it('goes against the gaze when the baby is on the threat', () => {
    const out = { x: 9, z: 9 };
    slideDirection(2, 3, 2, 3, 0, 1, out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.z).toBe(-1);
  });

  it('takes a baby closer than the minimum distance for being on the threat, not a noisy direction', () => {
    const out = { x: 9, z: 9 };
    slideDirection(2, 3, 2 + SLIDE_DIRECTION_MIN_M / 2, 3, 0, 1, out);
    expect(out.z).toBe(-1);
    slideDirection(2, 3, 2 + SLIDE_DIRECTION_MIN_M * 2, 3, 0, 1, out);
    expect(out).toEqual({ x: 1, z: 0 });
  });

  it('normalises the gaze it goes against, and has a default axis with no gaze', () => {
    const out = { x: 9, z: 9 };
    slideDirection(2, 3, 2, 3, 3, 4, out);
    expect(out.x).toBeCloseTo(-0.6, 12);
    expect(out.z).toBeCloseTo(-0.8, 12);
    slideDirection(2, 3, 2, 3, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 1 });
  });
});

describe('createGagFx', () => {
  const build = () => {
    const calls: string[] = [];
    const stage = {
      setLightsFactor: (factor: number) => calls.push(`lights:${factor.toFixed(2)}`),
      setHairAmount: (amount: number) => calls.push(`hair:${amount.toFixed(2)}`),
      setBabySlide: (x: number, z: number) => calls.push(`slide:${x.toFixed(2)},${z.toFixed(2)}`),
    };
    return { calls, fx: createGagFx(stage) };
  };

  it('writes nothing while no gag runs', () => {
    const { calls, fx } = build();
    fx.update(5000);
    expect(calls).toEqual([]);
  });

  it('runs the lights and the hair from the sim time the gag began, then puts them back and stops writing', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 1000);
    fx.update(1000 + GAG_LIGHTS_FADE_MS + 10);
    expect(calls).toEqual([`lights:${MIN.toFixed(2)}`, expect.stringMatching(/^hair:/)]);
    calls.length = 0;
    fx.update(1000 + GAG_LIGHTS_TOTAL_MS + GAG_HAIR_MS);
    expect(calls).toEqual(['lights:1.00', 'hair:0.00']);
    calls.length = 0;
    fx.update(1000 + GAG_LIGHTS_TOTAL_MS + GAG_HAIR_MS + 16);
    expect(calls).toEqual([]);
  });

  it('keeps the lights and leaves the hair flat when motion is reduced', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 1000, true);
    fx.update(1000 + GAG_LIGHTS_FADE_MS + 10);
    expect(calls).toEqual([`lights:${MIN.toFixed(2)}`]);
  });

  it('is frozen by a clock that does not move (a pause) and restarted by a new gag', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 0);
    fx.update(200);
    const first = [...calls];
    fx.update(200);
    expect(calls.slice(first.length)).toEqual(first);
    fx.start('outlet_hair', 5000);
    calls.length = 0;
    fx.update(5000 + GAG_LIGHTS_FADE_MS);
    expect(calls[0]).toBe(`lights:${MIN.toFixed(2)}`);
  });

  it('puts the stage back at once on reset, and stops', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 0);
    fx.update(300);
    calls.length = 0;
    fx.reset();
    expect(calls).toEqual(['lights:1.00', 'hair:0.00', 'slide:0.00,0.00']);
    calls.length = 0;
    fx.update(400);
    expect(calls).toEqual([]);
  });

  it('slides the baby along the given direction, only for the stairs gag, then puts it back and stops writing', () => {
    const { calls, fx } = build();
    fx.start('stairs_slide', 1000, false, 0.6, 0.8);
    fx.update(1000 + GAG_SLIDE_OUT_MS);
    expect(calls).toEqual([
      `slide:${(0.6 * GAG_SLIDE_M).toFixed(2)},${(0.8 * GAG_SLIDE_M).toFixed(2)}`,
    ]);
    calls.length = 0;
    fx.update(1000 + GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS + GAG_SLIDE_BACK_MS);
    expect(calls).toEqual(['slide:0.00,0.00']);
    calls.length = 0;
    fx.update(1000 + GAG_SLIDE_TOTAL_MS + 16);
    expect(calls).toEqual([]);
  });

  it('writes no slide for the other gags', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 0, false, 1, 0);
    fx.start('table_object_fall', 0, false, 1, 0);
    fx.update(GAG_SLIDE_OUT_MS);
    expect(calls.filter((call) => call.startsWith('slide'))).toEqual([]);
  });

  it('drops the slide when motion is reduced', () => {
    const { calls, fx } = build();
    fx.start('stairs_slide', 0, true, 1, 0);
    fx.update(GAG_SLIDE_OUT_MS);
    expect(calls).toEqual([]);
  });
});
