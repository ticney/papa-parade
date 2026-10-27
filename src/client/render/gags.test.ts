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
  hairAmountAt,
  lightsFactorAt,
} from './gags.ts';

const MIN = GAG_LIGHTS_MIN_PCT / 100;

describe('GAG_PRESENTATIONS', () => {
  it('has a presentation for every gag of the sim', () => {
    expect(Object.keys(GAG_PRESENTATIONS).sort()).toEqual([...GAG_IDS].sort());
  });

  it('turns the lights off and raises the hair for the outlet gag', () => {
    expect(GAG_PRESENTATIONS.outlet_hair).toEqual({ lightsOff: true, hair: true });
  });
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

describe('createGagFx', () => {
  const build = () => {
    const calls: string[] = [];
    const stage = {
      setLightsFactor: (factor: number) => calls.push(`lights:${factor.toFixed(2)}`),
      setHairAmount: (amount: number) => calls.push(`hair:${amount.toFixed(2)}`),
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
    expect(calls).toEqual(['lights:1.00', 'hair:0.00']);
    calls.length = 0;
    fx.update(400);
    expect(calls).toEqual([]);
  });
});
