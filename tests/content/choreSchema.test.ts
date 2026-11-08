import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { CHORE_STATION_KINDS, ChoreDefSchema } from '@content/schemas/chore';
import { LevelSchema, OBJECT_KINDS } from '@content/schemas/level';
import { describe, expect, it } from 'vitest';

const FILE = 'content/chores/cooking.json';
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const real = read(FILE);

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), ChoreDefSchema);
}

function pathsOf(value: unknown): string[] {
  const result = parse(value);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/chores/cooking.json (story 9.4)', () => {
  it('parses against ChoreDefSchema, as the cooking on the stove', () => {
    const parsed = parse(real);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('cooking');
    expect(parsed.value.station).toBe('stove');
    expect(parsed.value.windowMs).toBeNull();
    expect(parsed.value.beats.map((beat) => beat.telegraphDelayMs)).toEqual([
      2000, 2500, 1500, 3000,
    ]);
    expect(parsed.value.homePoints).toBe(7.5);
  });

  it('gives each beat its verb, and names the pot of an abandoned cooking (story 9.5)', () => {
    const parsed = parse(real);
    if (!parsed.ok) throw new Error('cooking.json does not parse');
    expect(parsed.value.beats.map((beat) => beat.verbKey)).toEqual([
      'verb.stir',
      'verb.mash',
      'verb.stir',
      'verb.turn_off_heat',
    ]);
    expect(parsed.value.abandonedThreat).toEqual({ def: 'pot_on_stove', afterMs: 30000 });
  });

  it('keeps every number in the JSON, with its unit in its name', () => {
    expect(
      Object.keys(real)
        .filter((key) => /Ms$|Points$/.test(key))
        .sort(),
    ).toEqual(['homePoints', 'windowMs']);
    for (const beat of real.beats as Record<string, unknown>[]) {
      expect(Object.keys(beat)).toEqual(['verbKey', 'telegraphDelayMs']);
    }
    expect(Object.keys(real.abandonedThreat as Record<string, unknown>)).toEqual([
      'def',
      'afterMs',
    ]);
  });

  it('lists the station kinds, each of them an object kind', () => {
    expect([...CHORE_STATION_KINDS]).toEqual(['stove', 'dishwasher']);
    for (const kind of CHORE_STATION_KINDS) expect(OBJECT_KINDS).toContain(kind);
  });

  it('keeps the dishwasher keys out of the cooking (story 9.6: absent, no default)', () => {
    for (const key of ['missBrokenObjects', 'missNoisePct', 'openThreat']) {
      expect(Object.hasOwn(real, key), key).toBe(false);
    }
  });

  it('keeps `missBrokenObjects` optional, a whole number of at least 1 (story 9.6)', () => {
    expect(parse({ ...real, missBrokenObjects: 1 })).toMatchObject({ ok: true });
    expect(parse({ ...real, missBrokenObjects: 3 })).toMatchObject({ ok: true });
    for (const value of [0, -1, 1.5]) {
      expect(pathsOf({ ...real, missBrokenObjects: value })).toEqual(['missBrokenObjects']);
    }
  });

  it('keeps `missNoisePct` optional, above 0 and at most 100 (story 9.6)', () => {
    expect(parse({ ...real, missNoisePct: 10 })).toMatchObject({ ok: true });
    expect(parse({ ...real, missNoisePct: 100 })).toMatchObject({ ok: true });
    expect(parse({ ...real, missNoisePct: 0.5 })).toMatchObject({ ok: true });
    for (const value of [0, -5, 100.1]) {
      expect(pathsOf({ ...real, missNoisePct: value })).toEqual(['missNoisePct']);
    }
  });

  it('keeps `openThreat` optional, a lower_snake_case threat id (story 9.6)', () => {
    expect(parse({ ...real, openThreat: 'dishwasher_open' })).toMatchObject({ ok: true });
    expect(pathsOf({ ...real, openThreat: 'Dishwasher' })).toEqual(['openThreat']);
    expect(pathsOf({ ...real, openThreat: 3 })).toEqual(['openThreat']);
  });

  it('refuses an unknown key, a missing key and a beat with no delay', () => {
    expect(pathsOf({ ...real, extra: 1 })).toEqual(['extra']);
    const { homePoints: _homePoints, ...withoutPoints } = real;
    expect(pathsOf(withoutPoints)).toEqual(['homePoints']);
    expect(pathsOf({ ...real, beats: [{ verbKey: 'verb.stir' }] })).toEqual([
      'beats[0].telegraphDelayMs',
    ]);
  });

  it('refuses a beat with no verb, and a verb that is not a `verb.` key (story 9.5)', () => {
    expect(pathsOf({ ...real, beats: [{ telegraphDelayMs: 2000 }] })).toEqual(['beats[0].verbKey']);
    expect(pathsOf({ ...real, beats: [{ verbKey: 'stir', telegraphDelayMs: 2000 }] })).toEqual([
      'beats[0].verbKey',
    ]);
    expect(pathsOf({ ...real, beats: [{ verbKey: 'verb.Stir', telegraphDelayMs: 2000 }] })).toEqual(
      ['beats[0].verbKey'],
    );
  });

  it('keeps `abandonedThreat` optional, strict, with a whole positive wait (story 9.5)', () => {
    const { abandonedThreat: _abandonedThreat, ...without } = real;
    expect(parse(without)).toMatchObject({ ok: true });
    expect(pathsOf({ ...real, abandonedThreat: { def: 'pot_on_stove' } })).toEqual([
      'abandonedThreat.afterMs',
    ]);
    expect(pathsOf({ ...real, abandonedThreat: { afterMs: 30000 } })).toEqual([
      'abandonedThreat.def',
    ]);
    expect(pathsOf({ ...real, abandonedThreat: { def: 'Pot', afterMs: 30000 } })).toEqual([
      'abandonedThreat.def',
    ]);
    for (const afterMs of [0, -1, 1500.5]) {
      expect(pathsOf({ ...real, abandonedThreat: { def: 'pot_on_stove', afterMs } })).toEqual([
        'abandonedThreat.afterMs',
      ]);
    }
    expect(
      pathsOf({ ...real, abandonedThreat: { def: 'pot_on_stove', afterMs: 30000, extra: 1 } }),
    ).toEqual(['abandonedThreat.extra']);
  });

  it('refuses no beat, a fractional or negative delay, negative points and an unknown station', () => {
    expect(pathsOf({ ...real, beats: [] })).toEqual(['beats']);
    expect(
      pathsOf({ ...real, beats: [{ verbKey: 'verb.stir', telegraphDelayMs: 1500.5 }] }),
    ).toEqual(['beats[0].telegraphDelayMs']);
    expect(pathsOf({ ...real, beats: [{ verbKey: 'verb.stir', telegraphDelayMs: -1 }] })).toEqual([
      'beats[0].telegraphDelayMs',
    ]);
    expect(pathsOf({ ...real, homePoints: -1 })).toEqual(['homePoints']);
    expect(pathsOf({ ...real, station: 'sink' })).toEqual(['station']);
  });

  it.each([7.3, 0.1, 2.25, 7.51])(
    'refuses %s points: the Maison row counts in halves',
    (points) => {
      expect(pathsOf({ ...real, homePoints: points })).toEqual(['homePoints']);
    },
  );

  it.each([0, 2.5, 7.5, 15])('accepts %s points: whole or half', (points) => {
    expect(parse({ ...real, homePoints: points })).toMatchObject({ ok: true });
  });

  it('accepts a window of its own', () => {
    expect(parse({ ...real, windowMs: 400 })).toMatchObject({ ok: true });
  });
});

describe('the level key `chores` (story 9.4)', () => {
  const kitchen = read('content/levels/salon_kitchen.json');
  const parseLevel = (value: unknown) =>
    parseContentFile('content/levels/salon_kitchen.json', JSON.stringify(value), LevelSchema);

  it('is declared by the kitchen alone, on its stove and its dishwasher, and absent from the other levels', () => {
    expect(kitchen.chores).toEqual([
      { def: 'cooking', object: 'stove' },
      { def: 'unload_dishwasher', object: 'dishwasher' },
    ]);
    const objects = kitchen.objects as { id: string; kind: string; anchor: string }[];
    expect(objects.find((object) => object.id === 'stove')).toEqual({
      id: 'stove',
      kind: 'stove',
      anchor: 'stove',
    });
    expect(objects.find((object) => object.id === 'dishwasher')).toEqual({
      id: 'dishwasher',
      kind: 'dishwasher',
      anchor: 'dishwasher',
    });
    for (const id of ['salon_crawler', 'chambre_night']) {
      expect(Object.hasOwn(read(`content/levels/${id}.json`), 'chores'), id).toBe(false);
    }
  });

  it('has no default: a level that does not declare it parses with no `chores` key at all', () => {
    const { chores: _chores, objects, ...rest } = kitchen;
    const parsed = parseLevel({
      ...rest,
      objects: (objects as { kind: string }[]).filter(
        (object) => !CHORE_STATION_KINDS.some((kind) => kind === object.kind),
      ),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.hasOwn(parsed.value, 'chores')).toBe(false);
  });

  const messagesOf = (result: ReturnType<typeof parseLevel>): string[] =>
    result.ok ? [] : result.error.map((problem) => `${problem.jsonPath}: ${problem.message}`);
  const withoutStations = (extra: Record<string, unknown> = {}) => ({
    ...kitchen,
    objects: (kitchen.objects as { kind: string }[]).filter(
      (object) => !CHORE_STATION_KINDS.some((kind) => kind === object.kind),
    ),
    ...extra,
  });

  it('refuses an empty list: only that rule fires, since the level has no station left', () => {
    expect(messagesOf(parseLevel(withoutStations({ chores: [] })))).toEqual([
      'chores: Too small: expected array to have >=1 items',
    ]);
  });

  it('refuses an object that is not in the level: only that rule fires, the stove is named', () => {
    const missing = parseLevel({
      ...kitchen,
      chores: [
        { def: 'cooking', object: 'stove' },
        { def: 'unload_dishwasher', object: 'dishwasher' },
        { def: 'cooking', object: 'nowhere' },
      ],
    });
    expect(messagesOf(missing)).toEqual([
      'chores[2].object: chores[2]: the object "nowhere" is not in the level objects',
    ]);
  });

  it('refuses an object named twice', () => {
    const twice = parseLevel({
      ...kitchen,
      chores: [
        { def: 'cooking', object: 'stove' },
        { def: 'unload_dishwasher', object: 'dishwasher' },
        { def: 'cooking', object: 'stove' },
      ],
    });
    expect(messagesOf(twice)).toEqual([
      'chores[2].object: chores[2]: the object "stove" is already the station of another chore',
    ]);
  });

  it('refuses a station that no chore names', () => {
    const { chores: _chores, ...rest } = kitchen;
    const result = parseLevel(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((problem) => problem.message).join('\n')).toMatch(
        /the stove "stove" is a station and no chore names it/,
      );
    }
  });
});
