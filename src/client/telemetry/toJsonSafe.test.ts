import { JOURNAL_LOG_DATA_MAX_CHARS, JOURNAL_LOG_STRING_MAX_CHARS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { toJsonSafe } from './toJsonSafe.ts';

describe('toJsonSafe (story 3.3)', () => {
  it('keeps plain JSON as it is', () => {
    const value = { a: 1, b: 'x', c: [true, null, 2.5], d: { e: {} } };
    expect(toJsonSafe(value)).toEqual(value);
    expect(toJsonSafe('text')).toBe('text');
    expect(toJsonSafe(3)).toBe(3);
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(false)).toBe(false);
  });

  it('an Error becomes its name and message, with no stack', () => {
    expect(toJsonSafe(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('an Error nested in an object is converted too', () => {
    expect(toJsonSafe({ reason: new RangeError('r') })).toEqual({
      reason: { name: 'RangeError', message: 'r' },
    });
  });

  it('a cycle becomes "[cycle]" and a shared (non-cyclic) reference is kept', () => {
    const loop: { self?: unknown; n: number } = { n: 1 };
    loop.self = loop;
    expect(toJsonSafe(loop)).toEqual({ n: 1, self: '[cycle]' });
    const shared = { k: 1 };
    expect(toJsonSafe({ a: shared, b: shared })).toEqual({ a: { k: 1 }, b: { k: 1 } });
    const ring: unknown[] = [];
    ring.push(ring);
    expect(toJsonSafe(ring)).toEqual(['[cycle]']);
  });

  it('drops undefined, functions, symbols and bigints from an object', () => {
    const value = { keep: 1, u: undefined, f: () => 1, s: Symbol('x'), b: 10n };
    const safe = toJsonSafe(value) as Record<string, unknown>;
    expect(safe).toEqual({ keep: 1 });
    expect(Object.keys(safe)).toEqual(['keep']);
  });

  it('an array slot holding one of them becomes null', () => {
    expect(toJsonSafe([1, undefined, () => 1, Symbol('x'), 5n, 2])).toEqual([
      1,
      null,
      null,
      null,
      null,
      2,
    ]);
  });

  it('a top-level undefined, function, symbol or bigint gives undefined (the log entry has no data)', () => {
    expect(toJsonSafe(undefined)).toBeUndefined();
    expect(toJsonSafe(() => 1)).toBeUndefined();
    expect(toJsonSafe(Symbol('x'))).toBeUndefined();
    expect(toJsonSafe(1n)).toBeUndefined();
  });

  it('a non-finite number becomes its string', () => {
    expect(
      toJsonSafe({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: Number.NEGATIVE_INFINITY }),
    ).toEqual({ a: 'NaN', b: 'Infinity', c: '-Infinity' });
    expect(toJsonSafe([Number.NaN])).toEqual(['NaN']);
  });

  it('a class instance becomes "[<constructor name>]"', () => {
    class Widget {
      secret = 1;
    }
    expect(toJsonSafe(new Map([[1, 2]]))).toBe('[Map]');
    expect(toJsonSafe({ w: new Widget(), s: new Set([1]) })).toEqual({ w: '[Widget]', s: '[Set]' });
    expect(toJsonSafe(new Date(0))).toBe('[Date]');
  });

  it('an object with no prototype is a plain object', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(toJsonSafe(bare)).toEqual({ a: 1 });
  });

  it('cuts a string longer than the limit with an ellipsis, and keeps one at the limit', () => {
    const atLimit = 'a'.repeat(JOURNAL_LOG_STRING_MAX_CHARS);
    expect(toJsonSafe(atLimit)).toBe(atLimit);
    expect(toJsonSafe('a'.repeat(JOURNAL_LOG_STRING_MAX_CHARS + 1))).toBe(
      `${'a'.repeat(JOURNAL_LOG_STRING_MAX_CHARS)}…`,
    );
    const nested = toJsonSafe({ k: ['b'.repeat(JOURNAL_LOG_STRING_MAX_CHARS + 50)] }) as {
      k: string[];
    };
    expect(nested.k[0]).toBe(`${'b'.repeat(JOURNAL_LOG_STRING_MAX_CHARS)}…`);
  });

  it('a whole data whose JSON is longer than the limit becomes "[truncated]"', () => {
    const big = { items: Array.from({ length: 400 }, (_, i) => `item-${i}-xxxxxxxx`) };
    expect(JSON.stringify(big).length).toBeGreaterThan(JOURNAL_LOG_DATA_MAX_CHARS);
    expect(toJsonSafe(big)).toBe('[truncated]');
  });

  it('keeps a data whose JSON is exactly at the limit', () => {
    // Strings under the string limit, so that only the whole-data limit is in play.
    const chunk = 'x'.repeat(JOURNAL_LOG_STRING_MAX_CHARS - 100);
    const exact = [chunk, chunk, chunk, chunk, ''];
    exact[4] = 'y'.repeat(JOURNAL_LOG_DATA_MAX_CHARS - JSON.stringify(exact).length);
    expect(JSON.stringify(exact).length).toBe(JOURNAL_LOG_DATA_MAX_CHARS);
    expect(toJsonSafe(exact)).toEqual(exact);
    exact[4] += 'y';
    expect(toJsonSafe(exact)).toBe('[truncated]');
  });

  it('is safe to JSON.stringify whatever it is given', () => {
    const odd = { e: new Error('x'), n: Number.NaN, m: new Map(), f: () => 1, u: undefined };
    expect(() => JSON.stringify(toJsonSafe(odd))).not.toThrow();
  });

  it('does not mutate its input', () => {
    const input = { e: new Error('x'), list: [1, undefined] };
    toJsonSafe(input);
    expect(input.e).toBeInstanceOf(Error);
    expect(input.list).toEqual([1, undefined]);
  });
});
