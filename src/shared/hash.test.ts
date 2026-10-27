import { describe, expect, it } from 'vitest';
import { canonicalJson, cloneJson, hashJson } from './hash.ts';

const KNOWN_HASH = '1034b77cc1d846';

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,1]},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('writes -0 as 0 and escapes strings', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
  });

  it('rejects what JSON cannot carry faithfully', () => {
    class Thing {}
    const bad: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      Symbol('x'),
      10n,
      new Map(),
      new Set(),
      new Thing(),
      new Date(0),
      { nested: { value: undefined } },
      [1, Number.NaN],
    ];
    for (const value of bad) expect(() => canonicalJson(value)).toThrow(/Not serializable/);
  });

  it('names the faulty path', () => {
    expect(() => canonicalJson({ a: [{ b: undefined }] })).toThrow('$.a[0].b');
  });

  it('rejects sparse arrays and cycles with the same error', () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point
    expect(() => canonicalJson([1, , 3])).toThrow(/is a hole/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/is a cycle/);
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('accepts objects without a prototype', () => {
    const bare = Object.create(null) as Record<string, number>;
    bare.x = 1;
    expect(canonicalJson(bare)).toBe('{"x":1}');
  });
});

describe('cloneJson', () => {
  it('returns an equal but distinct deep copy', () => {
    const source = { a: [{ b: 1 }], c: 'x' };
    const copy = cloneJson(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.a[0]).not.toBe(source.a[0]);
  });

  it('refuses non-serializable input', () => {
    expect(() => cloneJson({ a: undefined })).toThrow();
  });
});

describe('hashJson', () => {
  it('is stable, key-order independent and 14 hex chars', () => {
    const hash = hashJson({ a: 1, b: [1, 2] });
    expect(hash).toMatch(/^[0-9a-f]{14}$/);
    expect(hashJson({ b: [1, 2], a: 1 })).toBe(hash);
  });

  it('changes when the content changes', () => {
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });

  it('self-pins the algorithm (every golden reference depends on it)', () => {
    expect(hashJson({ a: 1 })).toBe(KNOWN_HASH);
  });
});
