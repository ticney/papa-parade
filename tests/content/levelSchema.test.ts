import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { LevelSchema } from '@content/schemas/level';
import { describe, expect, it } from 'vitest';

const FILE = 'content/levels/salon_crawler.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/levels/salon_crawler.json', import.meta.url), 'utf8'),
);

const UNIT_SUFFIX = /Ms$/;

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), LevelSchema);
}

const entry = { def: 'outlet', anchor: 'outlet_01', fromMs: 2000 };

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/levels/salon_crawler.json', () => {
  it('parses against LevelSchema', () => {
    expect(parse(real)).toMatchObject({ ok: true });
  });

  it('accepts a level that plans a threat, and the same def twice', () => {
    expect(parse({ ...real, threats: [entry, { ...entry, fromMs: 9000 }] })).toMatchObject({
      ok: true,
    });
  });

  it.each<[string, unknown, string[]]>([
    ['an unknown key', { ...real, bogus: 1 }, ['bogus']],
    [
      'an unknown key in an entry',
      { ...real, threats: [{ ...entry, bogus: 1 }] },
      ['threats[0].bogus'],
    ],
    ['a level id with a dot', { ...real, id: 'salon.crawler' }, ['id']],
    ['threats missing', { id: 'salon_crawler' }, ['threats']],
    ['a def in camelCase', { ...real, threats: [{ ...entry, def: 'outLet' }] }, ['threats[0].def']],
    [
      'an anchor with its prefix',
      { ...real, threats: [{ ...entry, anchor: 'ANCHOR_outlet_01' }] },
      ['threats[0].anchor'],
    ],
    ['a negative fromMs', { ...real, threats: [{ ...entry, fromMs: -1 }] }, ['threats[0].fromMs']],
  ])('rejects %s', (_name, value, expected) => {
    expect(failedPaths(parse(value))).toEqual(expected);
  });

  it('gives every numeric key of an entry a unit suffix', () => {
    // The schema's own shape, so a future `fromSec` or `delay` fails here.
    const shape = LevelSchema.shape.threats.element.shape;
    const numeric = Object.entries(shape)
      .filter(([, field]) => field.def.type === 'number')
      .map(([key]) => key);
    expect(numeric).toContain('fromMs');
    expect(numeric.filter((key) => !UNIT_SUFFIX.test(key))).toEqual([]);
  });
});
