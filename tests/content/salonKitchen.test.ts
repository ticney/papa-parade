import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { describe, expect, it } from 'vitest';

// The big room with its open kitchen (story 9.1, AC 2 and 3) is a test on the LIVE geometry and feel,
// like the boards of `creakZones.test.ts`: when Geo moves furniture in Blender and re-exports, this
// is what says whether the plan is still the GDD's and every E9 station is still within reach.

/** GDD › Cadre de level design (grand salon): about 13.5 × 7 m of walkable floor. */
const FLOOR_WIDTH_MIN_M = 13;
const FLOOR_WIDTH_MAX_M = 14;
const FLOOR_DEPTH_MIN_M = 6.5;
const FLOOR_DEPTH_MAX_M = 7.5;

/** The living corner, the dining corner and the open kitchen each stand on the floor (D5). */
const FLOOR_PIECES = [
  'sofa',
  'coffee_table',
  'stairs',
  'counter',
  'counter_back',
  'dining_table',
  'bin',
  'plant',
] as const;

/** The salon's gameplay ids (D4): `salon_kitchen.json` plays the salon's waves in this room. */
const SALON_ANCHORS = [
  'papa_spawn',
  'baby_spawn',
  'door',
  'outlet_01',
  'stairs_top',
  'coffee_table',
  'phone',
  'coffee_machine',
  'toilet',
] as const;
const SALON_ZONES = [
  { id: 'behind_sofa', kind: 'hidden' },
  { id: 'playpen', kind: 'safe' },
  { id: 'board_01', kind: 'creak' },
  { id: 'board_02', kind: 'creak' },
  { id: 'board_03', kind: 'creak' },
] as const;
const SALON_PROPS = ['book_01', 'mug_01', 'mug_02', 'toy_01', 'vase_01'] as const;

/** The stations and mischief places of Epic 9 (chores 9.4 to 9.6, mischiefs 9.7). */
const E9_ANCHORS = ['stove', 'dishwasher', 'dining_table', 'low_cabinet', 'bin', 'plant'] as const;

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function liveGeometry(): LevelGeometry {
  const parsed = parseContentFile(
    'content/levels/salon_kitchen.geometry.json',
    read('content/levels/salon_kitchen.geometry.json'),
    LevelGeometrySchema,
  );
  if (!parsed.ok) throw new Error('the live geometry is invalid');
  return parsed.value;
}

function liveContextReachM(): number {
  const parsed = parseContentFile('content/feel.json', read('content/feel.json'), FeelSchema);
  if (!parsed.ok) throw new Error('the live feel is invalid');
  return parsed.value.input.contextReachM;
}

/** The distance on the floor from (xM, zM) to the centre of the nearest walkable cell. */
function nearestWalkableM(geometry: LevelGeometry, xM: number, zM: number): number {
  const { originM, rows } = geometry.nav;
  let best = Number.POSITIVE_INFINITY;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '1') continue;
      const cx = originM[0] + (c + 0.5) * geometry.cellM;
      const cz = originM[1] + (r + 0.5) * geometry.cellM;
      best = Math.min(best, Math.hypot(cx - xM, cz - zM));
    }
  });
  return best;
}

describe('the live salon_kitchen room (story 9.1)', () => {
  const geometry = liveGeometry();
  const anchorIds = geometry.anchors.map((anchor) => anchor.id);

  it('has the walkable floor of the GDD: 13 to 14 m by 6.5 to 7.5 m', () => {
    const widthM = geometry.nav.cols * geometry.cellM;
    const depthM = geometry.nav.rowCount * geometry.cellM;
    expect(widthM).toBeGreaterThanOrEqual(FLOOR_WIDTH_MIN_M);
    expect(widthM).toBeLessThanOrEqual(FLOOR_WIDTH_MAX_M);
    expect(depthM).toBeGreaterThanOrEqual(FLOOR_DEPTH_MIN_M);
    expect(depthM).toBeLessThanOrEqual(FLOOR_DEPTH_MAX_M);
  });

  it('has a collider for each piece that stands on the floor', () => {
    expect(geometry.colliders.map((collider) => collider.id)).toEqual(
      expect.arrayContaining([...FLOOR_PIECES]),
    );
  });

  it('blocks the nav grid under each floor piece (D5)', () => {
    const { originM, rows } = geometry.nav;
    for (const id of FLOOR_PIECES) {
      const collider = geometry.colliders.find((candidate) => candidate.id === id);
      if (collider === undefined) throw new Error(`no collider ${id}`);
      const c = Math.floor((collider.centerM[0] - originM[0]) / geometry.cellM);
      const r = Math.floor((collider.centerM[2] - originM[1]) / geometry.cellM);
      // The stairs' collider stands on the floor's edge; its centre cell is still inside the grid.
      expect(rows[r]?.[c], `the cell under ${id}`).toBe('0');
    }
  });

  it('has the required anchors and every anchor of the salon gameplay (D4)', () => {
    expect(anchorIds).toEqual(expect.arrayContaining([...SALON_ANCHORS]));
  });

  it('has the zones of the salon gameplay, with their kinds', () => {
    for (const zone of SALON_ZONES) {
      expect(geometry.zones).toContainEqual(expect.objectContaining(zone));
    }
  });

  it('has the props of the salon on its coffee table', () => {
    expect(geometry.props.map((prop) => prop.id)).toEqual([...SALON_PROPS]);
  });

  it('has the anchors of Epic 9', () => {
    expect(anchorIds).toEqual(expect.arrayContaining([...E9_ANCHORS]));
  });

  it.each(E9_ANCHORS)('reaches %s from a walkable cell within feel.input.contextReachM', (id) => {
    const anchor = geometry.anchors.find((candidate) => candidate.id === id);
    if (anchor === undefined) throw new Error(`no anchor ${id}`);
    const [xM, , zM] = anchor.positionM;
    expect(nearestWalkableM(geometry, xM, zM)).toBeLessThanOrEqual(liveContextReachM());
  });
});
