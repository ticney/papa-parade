import { describe, expect, it } from 'vitest';
import { REQUIRED_ANCHOR_IDS } from '../levelNodeNames.ts';
import { parseContentFile } from '../parseContentFile.ts';
import { type LevelGeometry, LevelGeometrySchema } from './levelGeometry.ts';

function goodLevel(): LevelGeometry {
  return {
    id: 'test_room',
    cellM: 0.25,
    boundsMinM: [-1, 0, -1],
    boundsMaxM: [1, 2.5, 1],
    colliders: [{ id: 'sofa', centerM: [0, 0.45, -0.5], halfExtentsM: [0.5, 0.45, 0.2] }],
    nav: { originM: [-1, -1], cols: 4, rowCount: 2, rows: ['1111', '1001'] },
    anchors: REQUIRED_ANCHOR_IDS.map((id, index) => ({
      id,
      positionM: [index / 10, 0, 0] as [number, number, number],
    })),
    zones: [
      { id: 'behind_sofa', kind: 'hidden', centerM: [0, 0.5, -0.9], halfExtentsM: [0.5, 0.5, 0.1] },
    ],
    props: [{ id: 'mug_01', kind: 'mug', centerM: [0, 0.7, 0], halfExtentsM: [0.05, 0.05, 0.05] }],
  };
}

function parse(value: unknown) {
  return parseContentFile(
    'content/levels/test_room.geometry.json',
    JSON.stringify(value),
    LevelGeometrySchema,
  );
}

function problems(value: unknown): string[] {
  const result = parse(value);
  return result.ok ? [] : result.error.map((problem) => `${problem.jsonPath}: ${problem.message}`);
}

describe('LevelGeometrySchema', () => {
  it('accepts a good level', () => {
    expect(parse(goodLevel())).toMatchObject({ ok: true });
  });

  it('refuses an unknown key (the schema is strict)', () => {
    expect(problems({ ...goodLevel(), stray: 1 })).toEqual([expect.stringContaining('stray')]);
  });

  it('refuses an id that is not lower_snake_case', () => {
    const level = goodLevel();
    level.colliders[0] = { ...(level.colliders[0] as object), id: 'Sofa' } as never;
    expect(problems(level)).toEqual([expect.stringContaining('colliders[0].id')]);
  });

  it('refuses a duplicate id in a list', () => {
    const level = goodLevel();
    level.colliders.push({ ...(level.colliders[0] as object) } as never);
    expect(problems(level)).toEqual([expect.stringContaining('duplicate id "sofa"')]);
  });

  it('refuses a nav row of the wrong length', () => {
    const level = goodLevel();
    level.nav.rows[1] = '101';
    expect(problems(level)).toEqual([expect.stringContaining('nav.rows[1]')]);
  });

  it('refuses a rowCount that does not match the rows', () => {
    const level = goodLevel();
    level.nav.rowCount = 3;
    expect(problems(level)).toEqual([expect.stringContaining('nav.rowCount')]);
  });

  it('refuses a nav cell other than 0 or 1', () => {
    const level = goodLevel();
    level.nav.rows[0] = '1121';
    expect(problems(level)).toEqual([expect.stringContaining('nav.rows[0]')]);
  });

  it.each(REQUIRED_ANCHOR_IDS)('refuses a level without the anchor %s', (id) => {
    const level = goodLevel();
    level.anchors = level.anchors.filter((anchor) => anchor.id !== id);
    expect(problems(level)).toEqual([expect.stringContaining(`required anchor "${id}"`)]);
  });

  it('refuses a level without the zone behind the sofa', () => {
    const level = goodLevel();
    level.zones = [];
    expect(problems(level)).toEqual([expect.stringContaining('required zone "behind_sofa"')]);
  });

  it('refuses an anchor outside the bounds', () => {
    const level = goodLevel();
    level.anchors[2] = { id: 'outlet_01', positionM: [9, 0, 0] };
    expect(problems(level)).toEqual([expect.stringContaining('anchors[2].positionM')]);
  });

  it('refuses bounds whose upper corner is below the lower one', () => {
    const level = goodLevel();
    level.boundsMaxM = [1, -1, 1];
    expect(problems(level).some((line) => line.includes('boundsMaxM[1]'))).toBe(true);
  });

  it('refuses bounds with no extent on an axis', () => {
    const level = goodLevel();
    level.boundsMaxM = [-1, 2.5, 1]; // same x as the lower corner
    expect(problems(level).some((line) => line.includes('boundsMaxM[0]'))).toBe(true);
  });

  it('refuses the zone behind the sofa when it is not a hidden zone', () => {
    const level = goodLevel();
    (level.zones[0] as { kind: string }).kind = 'safe';
    expect(problems(level)).toEqual([expect.stringContaining('must be of kind "hidden"')]);
  });

  it('refuses a zone of an unknown kind and a negative half extent', () => {
    const level = goodLevel();
    (level.zones[0] as { kind: string }).kind = 'scary';
    level.colliders[0] = { id: 'sofa', centerM: [0, 0, 0], halfExtentsM: [-1, 1, 1] };
    const found = problems(level);
    expect(found.some((line) => line.startsWith('zones[0].kind'))).toBe(true);
    expect(found.some((line) => line.startsWith('colliders[0].halfExtentsM'))).toBe(true);
  });
});
