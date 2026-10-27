import { describe, expect, it } from 'vitest';
import { hashJson } from './hash.ts';
import {
  clampInvariant,
  defaultStrictInvariants,
  type InvariantContext,
  type InvariantViolation,
  invariant,
} from './invariant.ts';
import { asSimMs } from './time.ts';

function makeContext(
  strictInvariants: boolean,
): InvariantContext & { events: InvariantViolation[] } {
  return { strictInvariants, t: asSimMs(120), events: [] };
}

describe('invariant', () => {
  it('passes silently when true and throws when false', () => {
    expect(() => invariant(true, 'fine')).not.toThrow();
    expect(() => invariant(false, 'broken')).toThrow('broken');
  });
});

describe('clampInvariant', () => {
  it('returns an in-bounds value untouched, bounds included, in both modes', () => {
    for (const strict of [true, false]) {
      const ctx = makeContext(strict);
      expect(clampInvariant(ctx, 5, 0, 10, 'x')).toBe(5);
      expect(clampInvariant(ctx, 0, 0, 10, 'x')).toBe(0);
      expect(clampInvariant(ctx, 10, 0, 10, 'x')).toBe(10);
      expect(ctx.events).toEqual([]);
    }
  });

  it('throws naming the value in strict mode, and emits nothing', () => {
    const ctx = makeContext(true);
    expect(() => clampInvariant(ctx, 11, 0, 10, 'gauges.noise')).toThrow(/gauges\.noise = 11/);
    expect(ctx.events).toEqual([]);
  });

  it('clamps and emits InvariantViolated outside strict mode', () => {
    const ctx = makeContext(false);
    expect(clampInvariant(ctx, 11, 0, 10, 'a')).toBe(10);
    expect(clampInvariant(ctx, -3, 0, 10, 'b')).toBe(0);
    expect(ctx.events).toEqual([
      { type: 'InvariantViolated', t: 120, name: 'a', value: 11 },
      { type: 'InvariantViolated', t: 120, name: 'b', value: -3 },
    ]);
  });

  it('keeps the event JSON-safe for NaN and infinities, and treats a non-number as a violation', () => {
    const ctx = makeContext(false);
    clampInvariant(ctx, Number.NaN, 0, 1, 'a');
    clampInvariant(ctx, Number.POSITIVE_INFINITY, 0, 1, 'b');
    clampInvariant(ctx, Number.NEGATIVE_INFINITY, 0, 1, 'c');
    expect(clampInvariant(ctx, '0.5' as unknown as number, 0, 1, 'd')).toBe(0);
    expect(ctx.events.map((e) => e.value)).toEqual(['NaN', 'Infinity', '-Infinity', '0.5']);
    expect(() => hashJson(ctx.events)).not.toThrow();
    expect(() =>
      clampInvariant(makeContext(true), '0.5' as unknown as number, 0, 1, 'd'),
    ).toThrow();
  });

  it('treats NaN as a violation and clamps it to min', () => {
    const ctx = makeContext(false);
    expect(clampInvariant(ctx, Number.NaN, 2, 10, 'n')).toBe(2);
    expect(ctx.events).toHaveLength(1);
    expect(() => clampInvariant(makeContext(true), Number.NaN, 2, 10, 'n')).toThrow();
  });
});

describe('defaultStrictInvariants', () => {
  it('is strict under Vitest', () => {
    expect(defaultStrictInvariants()).toBe(true);
  });
});
