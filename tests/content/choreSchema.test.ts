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

  it('keeps every number in the JSON, with its unit in its name', () => {
    expect(
      Object.keys(real)
        .filter((key) => /Ms$|Points$/.test(key))
        .sort(),
    ).toEqual(['homePoints', 'windowMs']);
    for (const beat of real.beats as Record<string, unknown>[]) {
      expect(Object.keys(beat)).toEqual(['telegraphDelayMs']);
    }
  });

  it('lists the station kinds, each of them an object kind', () => {
    expect([...CHORE_STATION_KINDS]).toEqual(['stove']);
    for (const kind of CHORE_STATION_KINDS) expect(OBJECT_KINDS).toContain(kind);
  });

  it('refuses an unknown key, a missing key and a beat with no delay', () => {
    expect(pathsOf({ ...real, extra: 1 })).toEqual(['extra']);
    const { homePoints: _homePoints, ...withoutPoints } = real;
    expect(pathsOf(withoutPoints)).toEqual(['homePoints']);
    expect(pathsOf({ ...real, beats: [{}] })).toEqual(['beats[0].telegraphDelayMs']);
  });

  it('refuses no beat, a fractional or negative delay, negative points and an unknown station', () => {
    expect(pathsOf({ ...real, beats: [] })).toEqual(['beats']);
    expect(pathsOf({ ...real, beats: [{ telegraphDelayMs: 1500.5 }] })).toEqual([
      'beats[0].telegraphDelayMs',
    ]);
    expect(pathsOf({ ...real, beats: [{ telegraphDelayMs: -1 }] })).toEqual([
      'beats[0].telegraphDelayMs',
    ]);
    expect(pathsOf({ ...real, homePoints: -1 })).toEqual(['homePoints']);
    expect(pathsOf({ ...real, station: 'sink' })).toEqual(['station']);
  });

  it('accepts halves of points and a window of its own', () => {
    expect(parse({ ...real, homePoints: 2.5, windowMs: 400 })).toMatchObject({ ok: true });
  });
});

describe('the level key `chores` (story 9.4)', () => {
  const kitchen = read('content/levels/salon_kitchen.json');
  const parseLevel = (value: unknown) =>
    parseContentFile('content/levels/salon_kitchen.json', JSON.stringify(value), LevelSchema);

  it('is declared by the kitchen alone, on its stove, and absent from the other levels', () => {
    expect(kitchen.chores).toEqual([{ def: 'cooking', object: 'stove' }]);
    expect(
      (kitchen.objects as { id: string; kind: string; anchor: string }[]).find(
        (object) => object.id === 'stove',
      ),
    ).toEqual({ id: 'stove', kind: 'stove', anchor: 'stove' });
    for (const id of ['salon_crawler', 'chambre_night']) {
      expect(Object.hasOwn(read(`content/levels/${id}.json`), 'chores'), id).toBe(false);
    }
  });

  it('has no default: a level that does not declare it parses with no `chores` key at all', () => {
    const { chores: _chores, objects, ...rest } = kitchen;
    const parsed = parseLevel({
      ...rest,
      objects: (objects as { kind: string }[]).filter((object) => object.kind !== 'stove'),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.hasOwn(parsed.value, 'chores')).toBe(false);
  });

  it('refuses an empty list, an object that is not in the level and an object named twice', () => {
    expect(parseLevel({ ...kitchen, chores: [] }).ok).toBe(false);
    const missing = parseLevel({ ...kitchen, chores: [{ def: 'cooking', object: 'nowhere' }] });
    expect(missing.ok).toBe(false);
    const twice = parseLevel({
      ...kitchen,
      chores: [
        { def: 'cooking', object: 'stove' },
        { def: 'cooking', object: 'stove' },
      ],
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) {
      expect(twice.error.map((problem) => problem.message).join('\n')).toMatch(
        /already the station of another chore/,
      );
    }
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
