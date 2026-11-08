import { readFileSync } from 'node:fs';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { type GradedLights, gradeLightsInto } from './grade.ts';

const LEVEL_AMBIENT = new Color('#FFFFFF');
const LEVEL_SUN = new Color('#C4CEFF');
const COLD = { lightsFactor: 0.8, ambientColor: '#C0C8F0', sunColor: '#E0E4FF' };
const WARM = { lightsFactor: 0.9, ambientColor: '#F0E0D0', sunColor: '#FFEAD4' };

const fresh = (): GradedLights => ({ factor: 0, ambient: new Color(), sun: new Color() });

describe('gradeLightsInto (story 7.4)', () => {
  it('is exactly the level with no grade, or a grade of weight 0', () => {
    for (const [grade, weight] of [
      [null, 1],
      [COLD, 0],
    ] as const) {
      const out = fresh();
      gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, grade, weight, null, 0);
      expect(out.factor).toBe(1);
      expect(out.ambient.equals(LEVEL_AMBIENT)).toBe(true);
      expect(out.sun.equals(LEVEL_SUN)).toBe(true);
    }
  });

  it('is the grade at full weight, and halfway at 0.5', () => {
    const out = fresh();
    gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, COLD, 1, null, 0);
    expect(out.factor).toBeCloseTo(0.8, 12);
    expect(out.ambient.getHexString()).toBe('c0c8f0');
    gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, COLD, 0.5, null, 0);
    expect(out.factor).toBeCloseTo(0.9, 12);
    const half = LEVEL_AMBIENT.clone().lerp(new Color(COLD.ambientColor), 0.5);
    expect(out.ambient.r).toBeCloseTo(half.r, 9);
    expect(out.ambient.b).toBeCloseTo(half.b, 9);
  });

  it('weighs two grades at a seam, scaled down when they add up past 1: no overshoot', () => {
    const out = fresh();
    gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, WARM, 0.6, COLD, 0.9);
    expect(out.factor).toBeCloseTo((0.6 * 0.9 + 0.9 * 0.8) / 1.5, 12);
    expect(out.factor).toBeGreaterThanOrEqual(0.8);
    expect(out.factor).toBeLessThanOrEqual(0.9);
    // Under 1 in all: the level makes up the rest.
    gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, WARM, 0.2, COLD, 0.3);
    expect(out.factor).toBeCloseTo(0.5 + 0.2 * 0.9 + 0.3 * 0.8, 12);
  });

  it('clamps the weights to 0..1', () => {
    const out = fresh();
    gradeLightsInto(out, LEVEL_AMBIENT, LEVEL_SUN, COLD, 4, null, -2);
    expect(out.factor).toBeCloseTo(0.8, 12);
  });

  it('allocates nothing: no new in its body once a grade has been parsed', () => {
    const source = readFileSync(new URL('./grade.ts', import.meta.url), 'utf8');
    const from = source.indexOf('export function gradeLightsInto');
    expect(from, 'the gradeLightsInto marker').toBeGreaterThan(-1);
    const body = source.slice(from);
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/\bnew\b/);
  });
});
