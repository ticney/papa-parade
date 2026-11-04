import { SLIDE_DIRECTION_MIN_M } from '@shared/constants';
import { GAG_IDS } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createGagFx,
  downstairsOffsetAt,
  GAG_DOWNSTAIRS_DROP_M,
  GAG_HAIR_MS,
  GAG_LIGHTS_DARK_MS,
  GAG_LIGHTS_FADE_MS,
  GAG_LIGHTS_MIN_PCT,
  GAG_LIGHTS_TOTAL_MS,
  GAG_PRESENTATIONS,
  GAG_SLIDE_BACK_MS,
  GAG_SLIDE_M,
  GAG_SLIDE_OUT_MS,
  hairAmountAt,
  lightsFactorAt,
  slideDirection,
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
      papaClip: 'gag_shock',
      babyClip: 'gag_delight',
    });
  });

  it('slides the baby for the stairs gag only, and shows nothing of its own for the coffee table', () => {
    expect(GAG_PRESENTATIONS.stairs_slide).toEqual({
      lightsOff: false,
      hair: false,
      babySlide: true,
      papaClip: 'gag_shock',
      babyClip: 'gag_delight',
    });
    expect(GAG_PRESENTATIONS.table_object_fall).toEqual({
      lightsOff: false,
      hair: false,
      babySlide: false,
      papaClip: 'gag_hit',
      babyClip: 'laugh',
    });
  });
});

describe('the surprise mischiefs of the silence (story 1.21)', () => {
  it.each(['tissues_everywhere', 'crayon_scribbles'] as const)(
    '%s moves nothing on the stage: its clips and the gag cue are the show',
    (gag) => {
      expect(GAG_PRESENTATIONS[gag]).toEqual({
        lightsOff: false,
        hair: false,
        babySlide: false,
        papaClip: 'gag_hit',
        babyClip: 'gag_delight',
      });
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

describe('downstairsOffsetAt', () => {
  it('is 0 before the gag', () => {
    expect(downstairsOffsetAt(-50, null)).toBe(0);
    expect(downstairsOffsetAt(0, null)).toBe(0);
  });

  it('goes out with an ease-out, and stays at GAG_SLIDE_M for as long as nobody releases him', () => {
    expect(downstairsOffsetAt(GAG_SLIDE_OUT_MS, null)).toBe(GAG_SLIDE_M);
    expect(downstairsOffsetAt(GAG_SLIDE_OUT_MS * 20, null)).toBe(GAG_SLIDE_M);
    // Ease-out: more than half the way at half the time.
    expect(downstairsOffsetAt(GAG_SLIDE_OUT_MS / 2, null)).toBeGreaterThan(GAG_SLIDE_M / 2);
  });

  it('comes back over GAG_SLIDE_BACK_MS from where he is when released, and is 0 after', () => {
    const releasedAfterMs = GAG_SLIDE_OUT_MS * 3;
    expect(downstairsOffsetAt(releasedAfterMs, releasedAfterMs)).toBe(GAG_SLIDE_M);
    expect(
      downstairsOffsetAt(releasedAfterMs + GAG_SLIDE_BACK_MS / 2, releasedAfterMs),
    ).toBeLessThan(GAG_SLIDE_M / 2);
    expect(downstairsOffsetAt(releasedAfterMs + GAG_SLIDE_BACK_MS, releasedAfterMs)).toBe(0);
    expect(downstairsOffsetAt(releasedAfterMs + 10_000, releasedAfterMs)).toBe(0);
  });

  it('comes back from the part of the way he had done when released early', () => {
    const half = GAG_SLIDE_OUT_MS / 2;
    const reached = downstairsOffsetAt(half, null);
    expect(downstairsOffsetAt(half, half)).toBe(reached);
    expect(downstairsOffsetAt(half + 1, half)).toBeLessThan(reached);
  });

  it('never leaves [0, GAG_SLIDE_M]', () => {
    for (let ms = -10; ms < GAG_SLIDE_OUT_MS * 4; ms += 5) {
      for (const released of [null, 0, 100, GAG_SLIDE_OUT_MS, GAG_SLIDE_OUT_MS * 2]) {
        const offset = downstairsOffsetAt(ms, released);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(GAG_SLIDE_M);
      }
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
      setBabySlide: (x: number, z: number, drop: number) =>
        calls.push(`slide:${x.toFixed(2)},${z.toFixed(2)},${drop.toFixed(2)}`),
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
    expect(calls).toEqual(['lights:1.00', 'hair:0.00', 'slide:0.00,0.00,0.00']);
    calls.length = 0;
    fx.update(400);
    expect(calls).toEqual([]);
  });

  it('slides the baby down along the given direction, lowers him, and keeps him there while he is downstairs', () => {
    const { calls, fx } = build();
    fx.start('stairs_slide', 1000, false, 0.6, 0.8);
    fx.update(1000 + GAG_SLIDE_OUT_MS, true);
    expect(calls).toEqual([
      `slide:${(0.6 * GAG_SLIDE_M).toFixed(2)},${(0.8 * GAG_SLIDE_M).toFixed(2)},${GAG_DOWNSTAIRS_DROP_M.toFixed(2)}`,
    ]);
    calls.length = 0;
    // Much later: still there, written every frame (the sim has not released him).
    fx.update(1000 + GAG_SLIDE_OUT_MS + 30_000, true);
    expect(calls).toEqual([
      `slide:${(0.6 * GAG_SLIDE_M).toFixed(2)},${(0.8 * GAG_SLIDE_M).toFixed(2)},${GAG_DOWNSTAIRS_DROP_M.toFixed(2)}`,
    ]);
  });

  it('brings him back once the sim says he is not downstairs, then stops writing', () => {
    const { calls, fx } = build();
    fx.start('stairs_slide', 1000, false, 1, 0);
    fx.update(5000, true);
    calls.length = 0;
    fx.update(6000, false);
    expect(calls).toHaveLength(1);
    fx.update(6000 + GAG_SLIDE_BACK_MS, false);
    expect(calls.at(-1)).toBe('slide:0.00,0.00,0.00');
    calls.length = 0;
    fx.update(6000 + GAG_SLIDE_BACK_MS + 16, false);
    expect(calls).toEqual([]);
  });

  it('writes no slide for the other gags', () => {
    const { calls, fx } = build();
    fx.start('outlet_hair', 0, false, 1, 0);
    fx.start('table_object_fall', 0, false, 1, 0);
    fx.update(GAG_SLIDE_OUT_MS);
    expect(calls.filter((call) => call.startsWith('slide'))).toEqual([]);
  });

  it('puts him at the bottom at once when motion is reduced, with no slide to see', () => {
    const { calls, fx } = build();
    fx.start('stairs_slide', 0, true, 1, 0);
    fx.update(10, true);
    expect(calls).toEqual([
      `slide:${GAG_SLIDE_M.toFixed(2)},0.00,${GAG_DOWNSTAIRS_DROP_M.toFixed(2)}`,
    ]);
    calls.length = 0;
    fx.update(20, false);
    expect(calls).toEqual(['slide:0.00,0.00,0.00']);
  });

  it('puts a baby found downstairs with no gag started at the bottom at once, along the fallback direction', () => {
    const { calls, fx } = build();
    fx.update(500, true, 0, -1);
    expect(calls).toEqual([
      `slide:0.00,${(-GAG_SLIDE_M).toFixed(2)},${GAG_DOWNSTAIRS_DROP_M.toFixed(2)}`,
    ]);
  });
});
