import { readFileSync } from 'node:fs';
import { mergeFeel } from '@content/feelMerge';
import { parseContentFile } from '@content/parseContentFile';
import { type Feel, FeelSchema } from '@content/schemas/feel';
import { describe, expect, it } from 'vitest';

const parsedBase = parseContentFile(
  'content/feel.json',
  readFileSync(new URL('../../content/feel.json', import.meta.url), 'utf8'),
  FeelSchema,
);
if (!parsedBase.ok) throw new Error('content/feel.json must be valid before testing the merge');
const base: Feel = parsedBase.value;

function problemsOf(overrides: unknown) {
  const result = mergeFeel(base, overrides, 'level_x');
  if (result.ok) throw new Error('expected a failure');
  return result.error.problems;
}

describe('mergeFeel', () => {
  it('returns an equal but distinct object for empty overrides', () => {
    const result = mergeFeel(base, {});
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value).toEqual(base);
      expect(result.value).not.toBe(base);
      expect(result.value.timing).not.toBe(base.timing);
    }
  });

  it('changes one nested leaf and leaves its siblings alone', () => {
    const newWindowMs = base.timing.windowMs + 50;
    const result = mergeFeel(base, { timing: { windowMs: newWindowMs } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timing.windowMs).toBe(newWindowMs);
      expect(result.value.timing.perfectMs).toBe(base.timing.perfectMs);
      expect(result.value.timing.slowMoPerfect).toEqual(base.timing.slowMoPerfect);
      expect(result.value.input).toEqual(base.input);
    }
  });

  it('merges the physics kinds: a level override of one restitution keeps the siblings', () => {
    const newRestitution = Math.min(1, base.physics.kinds.mug.restitution + 0.1);
    const result = mergeFeel(base, {
      physics: { kinds: { mug: { restitution: newRestitution } } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.physics.kinds.mug.restitution).toBe(newRestitution);
      expect(result.value.physics.kinds.mug.massKg).toBe(base.physics.kinds.mug.massKg);
      expect(result.value.physics.kinds.vase).toEqual(base.physics.kinds.vase);
      expect(result.value.physics.gravityMps2).toBe(base.physics.gravityMps2);
    }
  });

  it('merges two levels deep (slow-mo group)', () => {
    const result = mergeFeel(base, { timing: { slowMoPerfect: { timeScale: 0.5 } } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timing.slowMoPerfect.timeScale).toBe(0.5);
      expect(result.value.timing.slowMoPerfect.durationMs).toBe(
        base.timing.slowMoPerfect.durationMs,
      );
    }
  });

  it('keeps the siblings of a partial slow-mo return override', () => {
    const result = mergeFeel(base, { timing: { slowMoPerfect: { returnMs: 0 } } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timing.slowMoPerfect.returnMs).toBe(0);
      expect(result.value.timing.slowMoPerfect.timeScale).toBe(base.timing.slowMoPerfect.timeScale);
      expect(result.value.timing.slowMoPerfect.durationMs).toBe(
        base.timing.slowMoPerfect.durationMs,
      );
    }
  });

  it('replaces an array as a whole', () => {
    const result = mergeFeel(base, { mama: { starThresholdPoints: [10, 20, 30, 40, 50] } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mama.starThresholdPoints).toEqual([10, 20, 30, 40, 50]);
  });

  it('skips undefined values', () => {
    const result = mergeFeel(base, { timing: { windowMs: undefined } });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.timing.windowMs).toBe(base.timing.windowMs);
  });

  it('never mutates its inputs', () => {
    const snapshot = structuredClone(base);
    const overrides = { timing: { windowMs: 999 }, mama: { starThresholdPoints: [1, 2, 3, 4, 5] } };
    const overridesSnapshot = structuredClone(overrides);
    const result = mergeFeel(base, overrides);
    expect(base).toEqual(snapshot);
    expect(overrides).toEqual(overridesSnapshot);
    if (result.ok) {
      expect(result.value.mama.starThresholdPoints).not.toBe(overrides.mama.starThresholdPoints);
    }
  });

  it('rejects an unknown key and names it', () => {
    expect(problemsOf({ timing: { bogusMs: 1 } })).toEqual([
      expect.objectContaining({ file: 'level_x', jsonPath: 'timing.bogusMs' }),
    ]);
  });

  it('rejects a badly typed override', () => {
    expect(problemsOf({ timing: { windowMs: 'x' } })).toEqual([
      expect.objectContaining({ file: 'level_x', jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('rejects an override that breaks perfectMs <= windowMs', () => {
    expect(problemsOf({ timing: { windowMs: 50, perfectMs: 100 } })).toEqual([
      expect.objectContaining({ jsonPath: 'timing.perfectMs' }),
    ]);
  });

  it('rejects an override that only lowers windowMs below the base perfectMs', () => {
    const problems = problemsOf({ timing: { windowMs: base.timing.perfectMs - 1 } });
    expect(problems).toEqual([expect.objectContaining({ jsonPath: 'timing.perfectMs' })]);
  });

  it('is safe against a __proto__ key from parsed JSON', () => {
    const overrides = JSON.parse(
      '{"__proto__": {"polluted": 1}, "timing": {"__proto__": {"x": 1}}}',
    );
    const problems = problemsOf(overrides);
    expect(problems.map((problem) => problem.jsonPath)).toEqual(
      expect.arrayContaining(['__proto__', 'timing.__proto__']),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it.each([null, undefined, 3, 'x', []])(
    'rejects overrides that are %j (not an object)',
    (overrides) => {
      expect(problemsOf(overrides)).toEqual([
        expect.objectContaining({ file: 'level_x', jsonPath: '' }),
      ]);
    },
  );

  it('uses feelOverrides as the default origin', () => {
    const result = mergeFeel(base, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.problems[0]?.file).toBe('feelOverrides');
  });
});
