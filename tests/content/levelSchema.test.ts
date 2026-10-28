import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { LEVEL_VARIANTS, LevelSchema } from '@content/schemas/level';
import { describe, expect, it } from 'vitest';

const FILE = 'content/levels/salon_crawler.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/levels/salon_crawler.json', import.meta.url), 'utf8'),
);

const UNIT_SUFFIX = /Ms$/;

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), LevelSchema);
}

const wave = {
  fromMs: 0,
  maxSimultaneous: 1,
  gapMinMs: 1000,
  gapMaxMs: 2000,
  lullMs: 500,
  threats: [{ def: 'outlet', anchor: 'outlet_01' }],
};
const second = { ...wave, fromMs: 60000, threats: [{ def: 'stairs', anchor: 'stairs_top' }] };
const level = (waves: unknown[], extra: Record<string, unknown> = {}) => ({
  ...real,
  waves,
  ...extra,
});

function problemsOf(result: ReturnType<typeof parse>): { jsonPath: string; message: string }[] {
  return result.ok ? [] : result.error.map(({ jsonPath, message }) => ({ jsonPath, message }));
}

describe('content/levels/salon_crawler.json', () => {
  it('parses against LevelSchema, as a 3-minute Sieste of three waves', () => {
    const parsed = parse(real);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.variant).toBe('nap');
    expect(parsed.value.durationMs).toBe(180000);
    expect(parsed.value.waves.map((w) => w.maxSimultaneous)).toEqual([1, 2, 3]);
    expect(parsed.value.feelOverrides).toEqual({});
  });

  it('plans the outlet, the stairs and the coffee table, once each, and no top-level threats', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.waves.flatMap((w) => w.threats)).toEqual([
      { def: 'outlet', anchor: 'outlet_01' },
      { def: 'stairs', anchor: 'stairs_top' },
      { def: 'coffee_table_object', anchor: 'coffee_table' },
    ]);
    expect(real).not.toHaveProperty('threats');
  });

  it('lists the coffee machine and the phone, and defaults to no objects', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.objects.map((object) => object.id)).toEqual([
      'coffee_machine',
      'phone',
    ]);
    const { objects: _objects, ...withoutObjects } = real;
    const bare = parse(withoutObjects);
    expect(bare.ok && bare.value.objects).toEqual([]);
  });

  it('accepts no wave at all (a level that plans nothing), and defaults feelOverrides to {}', () => {
    const bare: Record<string, unknown> = level([]);
    delete bare.feelOverrides;
    const parsed = parse(bare);
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && parsed.value.feelOverrides).toEqual({});
  });

  it('accepts the same def at several anchors', () => {
    const twice = {
      ...wave,
      threats: [
        { def: 'outlet', anchor: 'outlet_01' },
        { def: 'outlet', anchor: 'outlet_02' },
      ],
    };
    expect(parse(level([twice]))).toMatchObject({ ok: true });
  });

  it('accepts a wave that adds no threat (wave 3 of the salon)', () => {
    const { threats: _threats, ...bare } = wave;
    const parsed = parse(level([bare]));
    expect(parsed.ok && parsed.value.waves[0]?.threats).toEqual([]);
  });

  it.each<[string, unknown, string[]]>([
    ['an unknown key', { ...real, bogus: 1 }, ['bogus']],
    ['an unknown key in a wave', level([{ ...wave, bogus: 1 }]), ['waves[0].bogus']],
    [
      'an unknown key in a wave threat',
      level([{ ...wave, threats: [{ def: 'outlet', anchor: 'outlet_01', fromMs: 1 }] }]),
      ['waves[0].threats[0].fromMs'],
    ],
    ['a level id with a dot', { ...real, id: 'salon.crawler' }, ['id']],
    ['waves missing', { id: 'salon_crawler', variant: 'nap', durationMs: 1000 }, ['waves']],
    ['an unknown variant', { ...real, variant: 'return' }, ['variant']],
    ['a non-integer durationMs', { ...real, durationMs: 1000.5 }, ['durationMs']],
    ['a zero durationMs', level([], { durationMs: 0 }), ['durationMs']],
    [
      'a def in camelCase',
      level([{ ...wave, threats: [{ def: 'outLet', anchor: 'outlet_01' }] }]),
      ['waves[0].threats[0].def'],
    ],
    [
      'an anchor with its prefix',
      level([{ ...wave, threats: [{ def: 'outlet', anchor: 'ANCHOR_outlet_01' }] }]),
      ['waves[0].threats[0].anchor'],
    ],
    [
      'an object with an unknown key',
      { ...real, objects: [{ id: 'phone', anchor: 'phone', bogus: 1 }] },
      ['objects[0].bogus'],
    ],
    [
      'an object id in camelCase',
      { ...real, objects: [{ id: 'coffeeMachine', anchor: 'phone' }] },
      ['objects[0].id'],
    ],
    [
      'an object anchor with its prefix',
      { ...real, objects: [{ id: 'phone', anchor: 'ANCHOR_phone' }] },
      ['objects[0].anchor'],
    ],
    ['a negative fromMs', level([{ ...wave, fromMs: -1 }]), ['waves[0].fromMs']],
    [
      'a maxSimultaneous of 0',
      level([{ ...wave, maxSimultaneous: 0 }]),
      ['waves[0].maxSimultaneous'],
    ],
    [
      'a non-integer maxSimultaneous',
      level([{ ...wave, maxSimultaneous: 1.5 }]),
      ['waves[0].maxSimultaneous'],
    ],
    ['feelOverrides that is not an object', { ...real, feelOverrides: [] }, ['feelOverrides']],
  ])('rejects %s', (_name, value, expected) => {
    expect(problemsOf(parse(value)).map((problem) => problem.jsonPath)).toEqual(expected);
  });

  describe('the rules of the waves, each naming its wave', () => {
    it.each<[string, unknown, string, RegExp]>([
      [
        'fromMs that do not increase',
        level([wave, { ...second, fromMs: 0 }]),
        'waves[1].fromMs',
        /waves\[1\]: fromMs \(0\) must be after/,
      ],
      [
        'the same fromMs twice',
        level([wave, { ...second, fromMs: 0 }]),
        'waves[1].fromMs',
        /waves\[1\]/,
      ],
      [
        'a wave that starts at the end of the level',
        level([wave, { ...second, fromMs: 180000 }]),
        'waves[1].fromMs',
        /waves\[1\]: fromMs \(180000\) must be before the level's durationMs/,
      ],
      [
        'a wave that starts after the end of the level',
        level([wave, { ...second, fromMs: 200000 }]),
        'waves[1].fromMs',
        /waves\[1\]/,
      ],
      [
        'gapMinMs above gapMaxMs',
        level([wave, { ...second, gapMinMs: 3000, gapMaxMs: 2000 }]),
        'waves[1].gapMinMs',
        /waves\[1\]: gapMinMs \(3000\) must not be above gapMaxMs \(2000\)/,
      ],
      [
        'a lull as long as the wave (not the last)',
        level([{ ...wave, lullMs: 60000 }, second]),
        'waves[0].lullMs',
        /waves\[0\]: lullMs \(60000\) must be below the wave's length \(60000 ms\)/,
      ],
      [
        'a lull as long as the last wave',
        level([wave, { ...second, lullMs: 120000 }]),
        'waves[1].lullMs',
        /waves\[1\]: lullMs \(120000\) must be below the wave's length \(120000 ms\)/,
      ],
      [
        'a first gap that cannot land before the lull',
        level([{ ...wave, gapMinMs: 59500, gapMaxMs: 59500, lullMs: 500 }, second]),
        'waves[0].gapMinMs',
        /waves\[0\]: no telegraph can land: gapMinMs \(59500\) must be below the wave's length \(60000 ms\) minus its lullMs \(500\)/,
      ],
      [
        'a gap as long as the last wave',
        level([wave, { ...second, gapMinMs: 120000, gapMaxMs: 120000, lullMs: 0 }]),
        'waves[1].gapMinMs',
        /waves\[1\]: no telegraph can land/,
      ],
      [
        'an anchor planned twice, across waves',
        level([wave, { ...second, threats: [{ def: 'stairs', anchor: 'outlet_01' }] }]),
        'waves[1].threats[0].anchor',
        /waves\[1\]\.threats\[0\]: the anchor "outlet_01" is already planned by waves\[0\]\.threats\[0\]/,
      ],
      [
        'an anchor planned twice, in one wave',
        level([
          {
            ...wave,
            threats: [
              { def: 'outlet', anchor: 'outlet_01' },
              { def: 'stairs', anchor: 'outlet_01' },
            ],
          },
        ]),
        'waves[0].threats[1].anchor',
        /waves\[0\]\.threats\[1\]/,
      ],
    ])('rejects %s', (_name, value, jsonPath, message) => {
      const problems = problemsOf(parse(value));
      expect(problems).toContainEqual({ jsonPath, message: expect.stringMatching(message) });
    });

    it('accepts a lull just below the wave length, and waves in order', () => {
      const open = { ...wave, gapMinMs: 0, gapMaxMs: 0 };
      expect(parse(level([{ ...open, lullMs: 59999 }, second]))).toMatchObject({ ok: true });
    });

    it('accepts a first gap that lands just before the lull', () => {
      const edge = { ...wave, gapMinMs: 59499, gapMaxMs: 59499, lullMs: 500 };
      expect(parse(level([edge, second]))).toMatchObject({ ok: true });
    });
  });

  it('has a variant per icon: the variants are the ones the HUD has', () => {
    expect([...LEVEL_VARIANTS]).toEqual(['nap']);
  });

  it('gives every numeric key of a wave a unit suffix, but the count', () => {
    // The schema's own shape, so a future `fromSec` or `delay` fails here.
    const shape = LevelSchema.shape.waves.element.shape;
    const numeric = Object.entries(shape)
      .filter(([, field]) => field.def.type === 'number')
      .map(([key]) => key);
    expect(numeric).toEqual(
      expect.arrayContaining(['fromMs', 'gapMinMs', 'gapMaxMs', 'lullMs', 'maxSimultaneous']),
    );
    // `maxSimultaneous` is a count of threats, not a time: the one key with no suffix.
    expect(numeric.filter((key) => !UNIT_SUFFIX.test(key))).toEqual(['maxSimultaneous']);
    expect(LevelSchema.shape.durationMs.def.type).toBe('number');
  });
});
