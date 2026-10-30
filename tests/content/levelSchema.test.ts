import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { LEVEL_VARIANTS, LevelSchema, OBJECT_KINDS } from '@content/schemas/level';
import { OBJECT_ACTION_KINDS } from '@sim';
import { describe, expect, it } from 'vitest';

const FILE = 'content/levels/salon_crawler.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/levels/salon_crawler.json', import.meta.url), 'utf8'),
);

const UNIT_SUFFIX = /Ms$/;

/** The live level with no disruption planned: for the tests that change its objects (a phone that rings needs its object). */
const quiet: Record<string, unknown> = {
  ...real,
  waves: (real.waves as Record<string, unknown>[]).map((wave) => ({ ...wave, disruptions: [] })),
};

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

describe('the object kinds', () => {
  it('are the ones the sim has an action for (content:check and createSim guard a drift)', () => {
    expect([...OBJECT_KINDS].sort()).toEqual([...OBJECT_ACTION_KINDS].sort());
  });
});

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

  it('gives the live level the noise and fatigue gauges (the micro-sleep), and each object its kind', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.gauges).toEqual({
      noise: {},
      fatigue: { microSleepDef: 'papa_microsleep' },
    });
    expect(parsed.ok && parsed.value.objects.map((object) => object.kind)).toEqual([
      'coffee_machine',
      'phone',
    ]);
  });

  it('lets the live level carry the baby, with a cry in the arms (story 4.1)', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.carry).toEqual({ armsCryDef: 'arms_cry' });
  });

  it('allows a level with no carry, and one that carries without a cry in the arms', () => {
    const { carry: _carry, ...withoutCarry } = real;
    const bare = parse(withoutCarry);
    expect(bare.ok && bare.value.carry).toBeUndefined();
    const silent = parse({ ...real, carry: {} });
    expect(silent.ok && silent.value.carry).toEqual({});
  });

  it('accepts a level with the noise gauge and no fatigue, and one with neither', () => {
    const noiseOnly = parse({ ...real, gauges: { noise: {} } });
    expect(noiseOnly.ok && noiseOnly.value.gauges).toEqual({ noise: {} });
    const { gauges: _gauges, ...withoutGauges } = real;
    const bare = parse(withoutGauges);
    expect(bare.ok && bare.value.gauges.noise).toBeUndefined();
  });

  it('has no gauge when the key is absent (a level opts into fatigue, D1)', () => {
    const { gauges: _gauges, ...withoutGauges } = real;
    const parsed = parse(withoutGauges);
    expect(parsed.ok && parsed.value.gauges).toEqual({});
  });

  it('plans the outlet, the stairs, the coffee table and the silence, once each, and no top-level threats', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.waves.flatMap((w) => w.threats)).toEqual([
      { def: 'outlet', anchor: 'outlet_01' },
      { def: 'stairs', anchor: 'stairs_top' },
      { def: 'coffee_table_object', anchor: 'coffee_table' },
      { def: 'silence_mischief', anchor: 'behind_sofa' },
    ]);
    expect(real).not.toHaveProperty('threats');
  });

  it('lists the coffee machine and the phone, and defaults to no objects', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.objects.map((object) => object.id)).toEqual([
      'coffee_machine',
      'phone',
    ]);
    const { objects: _objects, ...withoutObjects } = quiet;
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
      { ...quiet, objects: [{ id: 'phone', kind: 'phone', anchor: 'phone', bogus: 1 }] },
      ['objects[0].bogus'],
    ],
    [
      'an object id in camelCase',
      { ...quiet, objects: [{ id: 'coffeeMachine', kind: 'phone', anchor: 'phone' }] },
      ['objects[0].id'],
    ],
    [
      'an object anchor with its prefix',
      { ...quiet, objects: [{ id: 'phone', kind: 'phone', anchor: 'ANCHOR_phone' }] },
      ['objects[0].anchor'],
    ],
    [
      'an object with no kind',
      { ...quiet, objects: [{ id: 'phone', anchor: 'phone' }] },
      ['objects[0].kind'],
    ],
    [
      'an object of an unknown kind',
      { ...quiet, objects: [{ id: 'phone', kind: 'kettle', anchor: 'phone' }] },
      ['objects[0].kind'],
    ],
    [
      'a gauges entry that is not a known gauge',
      { ...real, gauges: { need: {} } },
      ['gauges.need'],
    ],
    [
      'a noise gauge with a key (it opts in with an empty object, story 3.1)',
      { ...real, gauges: { noise: { startPct: 10 } } },
      ['gauges.noise.startPct'],
    ],
    [
      'a fatigue gauge with no micro-sleep def',
      { ...real, gauges: { fatigue: {} } },
      ['gauges.fatigue.microSleepDef'],
    ],
    [
      'a carry with an unknown key (story 4.1)',
      { ...real, carry: { armsCryDef: 'arms_cry', crib: true } },
      ['carry.crib'],
    ],
    [
      'a cry in the arms in camelCase',
      { ...real, carry: { armsCryDef: 'armsCry' } },
      ['carry.armsCryDef'],
    ],
    [
      'a micro-sleep def in camelCase',
      { ...real, gauges: { fatigue: { microSleepDef: 'papaMicrosleep' } } },
      ['gauges.fatigue.microSleepDef'],
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

  describe('the disruptions of a wave (story 1.20)', () => {
    const objects = [{ id: 'phone', kind: 'phone', anchor: 'phone' }];
    const phoneAt = (atMs: number) => ({ def: 'phone', object: 'phone', atMs });
    const withDisruptions = (first: unknown[], second: unknown[] = []) =>
      level(
        [
          { ...wave, disruptions: first },
          { ...second0, disruptions: second },
        ],
        { objects, durationMs: 180000 },
      );
    const second0 = { ...wave, fromMs: 60000, threats: [] };

    it('plans the live phone inside wave 3, on the object `phone`', () => {
      const parsed = parse(real);
      expect(parsed.ok && parsed.value.waves.map((w) => w.disruptions.length)).toEqual([0, 0, 1]);
      const [entry] = parsed.ok ? (parsed.value.waves[2]?.disruptions ?? []) : [];
      expect(entry).toMatchObject({ def: 'phone', object: 'phone' });
      const wave3 = parsed.ok ? parsed.value.waves[2] : undefined;
      expect(entry?.atMs).toBeGreaterThanOrEqual(wave3?.fromMs ?? Number.POSITIVE_INFINITY);
      expect(entry?.atMs).toBeLessThan(parsed.ok ? parsed.value.durationMs : 0);
    });

    it('defaults to no disruption', () => {
      const { disruptions: _disruptions, ...bare } = wave as Record<string, unknown>;
      const parsed = parse(level([bare]));
      expect(parsed.ok && parsed.value.waves[0]?.disruptions).toEqual([]);
    });

    it('accepts a disruption at the very start of its wave, and one just before the next wave', () => {
      expect(parse(withDisruptions([phoneAt(0)]))).toMatchObject({ ok: true });
      expect(parse(withDisruptions([phoneAt(59999)]))).toMatchObject({ ok: true });
      expect(parse(withDisruptions([], [phoneAt(60000)]))).toMatchObject({ ok: true });
      expect(parse(withDisruptions([], [phoneAt(179999)]))).toMatchObject({ ok: true });
    });

    it.each<[string, () => unknown, string, RegExp]>([
      [
        'an atMs before its wave',
        () => withDisruptions([], [phoneAt(59999)]),
        'waves[1].disruptions[0].atMs',
        /waves\[1\]\.disruptions\[0\]: atMs \(59999\).*from 60000/,
      ],
      [
        'an atMs on the next wave (the end of a wave is excluded)',
        () => withDisruptions([phoneAt(60000)]),
        'waves[0].disruptions[0].atMs',
        /atMs \(60000\).*up to \(not including\) 60000/,
      ],
      [
        'an atMs at the end of the level',
        () => withDisruptions([], [phoneAt(180000)]),
        'waves[1].disruptions[0].atMs',
        /atMs \(180000\).*not including\) 180000/,
      ],
      [
        'an object that is not in the level',
        () => withDisruptions([{ def: 'phone', object: 'kettle', atMs: 10 }]),
        'waves[0].disruptions[0].object',
        /the object "kettle" is not in the level objects/,
      ],
      [
        'an object planned by two disruptions',
        () => withDisruptions([phoneAt(10)], [phoneAt(70000)]),
        'waves[1].disruptions[0].object',
        /already planned by waves\[0\]\.disruptions\[0\]/,
      ],
      [
        'an object planned twice in the same wave',
        () => withDisruptions([phoneAt(10), phoneAt(20)]),
        'waves[0].disruptions[1].object',
        /already planned by waves\[0\]\.disruptions\[0\]/,
      ],
    ])('rejects %s, naming the wave and the entry', (_name, build, path, message) => {
      const problems = problemsOf(parse(build()));
      expect(problems.map((problem) => problem.jsonPath)).toContain(path);
      expect(problems.find((problem) => problem.jsonPath === path)?.message).toMatch(message);
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['a def that is not an id', { def: 'Phone', object: 'phone', atMs: 10 }, 'def'],
      ['a negative atMs', { def: 'phone', object: 'phone', atMs: -1 }, 'atMs'],
      ['a stray key', { def: 'phone', object: 'phone', atMs: 10, loud: true }, 'loud'],
      ['no object', { def: 'phone', atMs: 10 }, 'object'],
    ])('rejects %s', (_name, entry, key) => {
      const paths = problemsOf(parse(withDisruptions([entry]))).map((problem) => problem.jsonPath);
      expect(paths.some((path) => path.endsWith(key))).toBe(true);
    });
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
