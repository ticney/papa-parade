import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import { LevelSchema } from '@content/schemas/level';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { createSim } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../tools/sim/loadSimLevel.ts';

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
  'side_table',
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
const E9_ANCHORS = [
  'stove',
  'dishwasher',
  'dining_table',
  'low_cabinet',
  'bin',
  'plant',
  'papa_mug',
] as const;

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function liveGeometry(): LevelGeometry {
  const parsed = parseContentFile(
    'content/levels/salon_kitchen.geometry.json',
    read('content/levels/salon_kitchen.geometry.json'),
    LevelGeometrySchema,
  );
  if (!parsed.ok) throw new Error(`the live geometry is invalid: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function liveContextReachM(): number {
  const parsed = parseContentFile('content/feel.json', read('content/feel.json'), FeelSchema);
  if (!parsed.ok) throw new Error(`the live feel is invalid: ${JSON.stringify(parsed.error)}`);
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

  it('blocks the nav grid under the whole footprint of each floor piece (D5)', () => {
    const { originM, rows } = geometry.nav;
    for (const id of FLOOR_PIECES) {
      const collider = geometry.colliders.find((candidate) => candidate.id === id);
      if (collider === undefined) throw new Error(`no collider ${id}`);
      const [centerX, , centerZ] = collider.centerM;
      const [halfX, , halfZ] = collider.halfExtentsM;
      let checkedCells = 0;
      rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          const cellX = originM[0] + (c + 0.5) * geometry.cellM;
          const cellZ = originM[1] + (r + 0.5) * geometry.cellM;
          // The stairs' collider stands on the floor's edge: only the cells inside the grid count.
          if (Math.abs(cellX - centerX) >= halfX || Math.abs(cellZ - centerZ) >= halfZ) continue;
          checkedCells++;
          expect(row[c], `the cell (${c}, ${r}) under ${id}`).toBe('0');
        }
      });
      expect(checkedCells, `the cells under ${id}`).toBeGreaterThan(0);
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

  it('has the props of the salon gameplay', () => {
    // At least these: a prop added in Blender (9.7) must not break the test.
    expect(geometry.props.map((prop) => prop.id)).toEqual(expect.arrayContaining([...SALON_PROPS]));
  });

  it('has the anchors of Epic 9', () => {
    expect(anchorIds).toEqual(expect.arrayContaining([...E9_ANCHORS]));
  });

  it.each([...SALON_ANCHORS, ...E9_ANCHORS])(
    'reaches %s from a walkable cell within feel.input.contextReachM',
    (id) => {
      const anchor = geometry.anchors.find((candidate) => candidate.id === id);
      if (anchor === undefined) throw new Error(`no anchor ${id}`);
      const [xM, , zM] = anchor.positionM;
      expect(nearestWalkableM(geometry, xM, zM)).toBeLessThanOrEqual(liveContextReachM());
    },
  );
});

describe('the five new mischiefs of the big salon (story 9.7)', () => {
  const parsed = parseContentFile(
    'content/levels/salon_kitchen.json',
    read('content/levels/salon_kitchen.json'),
    LevelSchema,
  );
  if (!parsed.ok) throw new Error(`the live level is invalid: ${JSON.stringify(parsed.error)}`);
  const level = parsed.value;

  /** Where each is planned: the wave that enters it (0 or 1) and its anchor. */
  const PLAN = [
    { def: 'tablecloth_pull', anchor: 'dining_table', wave: 0 },
    { def: 'low_cabinet_open', anchor: 'low_cabinet', wave: 0 },
    { def: 'plant_dig', anchor: 'plant', wave: 0 },
    { def: 'bin_rummage', anchor: 'bin', wave: 1 },
    { def: 'papa_mug_low', anchor: 'papa_mug', wave: 1 },
  ] as const;

  it.each(PLAN)('plans $def at $anchor in wave $wave', ({ def, anchor, wave }) => {
    const entries = level.waves.flatMap((candidate, index) =>
      (candidate.threats ?? [])
        .filter((entry) => entry.def === def)
        .map((entry) => ({ ...entry, index })),
    );
    expect(entries).toEqual([{ def, anchor, index: wave }]);
  });

  it('keeps the mug at least 1 m from the coffee table, so their markers never stack', () => {
    const at = (id: string) => {
      const found = liveGeometry().anchors.find((candidate) => candidate.id === id);
      if (found === undefined) throw new Error(`no anchor ${id}`);
      return found.positionM;
    };
    const [mugX, , mugZ] = at('papa_mug');
    const [tableX, , tableZ] = at('coffee_table');
    expect(Math.hypot(mugX - tableX, mugZ - tableZ)).toBeGreaterThanOrEqual(1);
  });
});

describe('the live salon_kitchen level (story 9.2)', () => {
  it('follows Papa with the follow camera (the room is too big for the fixed one)', () => {
    const parsed = parseContentFile(
      'content/levels/salon_kitchen.json',
      read('content/levels/salon_kitchen.json'),
      LevelSchema,
    );
    if (!parsed.ok) throw new Error(`the live level is invalid: ${JSON.stringify(parsed.error)}`);
    expect(parsed.value.camera).toBe('follow');
  });

  it.each(['salon_crawler', 'chambre_night'])('leaves %s on the fixed camera', (id) => {
    const parsed = parseContentFile(
      `content/levels/${id}.json`,
      read(`content/levels/${id}.json`),
      LevelSchema,
    );
    if (!parsed.ok) throw new Error(`the live level is invalid: ${JSON.stringify(parsed.error)}`);
    expect(parsed.value.camera).toBe('fixed');
  });

  it('caps a glide across the big room at the level glideMaxMs: 900 ms of sim time, Papa arriving (AC 9)', async () => {
    const loaded = await loadSimLevel(
      fileURLToPath(new URL('../../content', import.meta.url)),
      'salon_kitchen',
    );
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level } = loaded.value;
    expect(content.feel.movement.glideMaxMs).toBe(900);
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    try {
      const { papa } = sim.world;
      // The planned threat Papa can press that stands farthest from his spawn. The open dishwasher is a
      // wave threat the director draws only while its chore is paused and open (story 9.6): `ForceThreat`
      // ignores it, so it is not the one to force here. A Firmness is out too (story 9.7): the test
      // presses and releases one step later, which is a tap, so a `wrongResponse` gag, not a glide;
      // the farthest parry (the low cabinet) is the one to cross the room for.
      const doorDefIds = new Set((level.chores ?? []).map((chore) => chore.openThreat));
      const pressable = sim.world.threats.filter((threat) => {
        const def = level.threats[threat.defId];
        return (
          def?.target === 'anchor' && def.response === 'parry' && !doorDefIds.has(threat.defId)
        );
      });
      const farthest = pressable.reduce((best, threat) =>
        Math.hypot(threat.xM - papa.xM, threat.zM - papa.zM) >
        Math.hypot(best.xM - papa.xM, best.zM - papa.zM)
          ? threat
          : best,
      );
      expect(Math.hypot(farthest.xM - papa.xM, farthest.zM - papa.zM)).toBeGreaterThan(
        (content.feel.movement.walkSpeedMps * 900) / 1000,
      );
      sim.enqueue({ type: 'ForceThreat', t: asSimMs(0), threatId: farthest.id });
      sim.step();
      // Pressed in its window: an early press is a gag, whose séquelle (story 3.15) holds Papa still.
      while (sim.world.time.sim < farthest.windowOpenAt) sim.step();
      const pressAt = sim.world.time.sim;
      sim.enqueue({ type: 'PressThreat', t: asSimMs(pressAt), threatId: farthest.id });
      sim.enqueue({ type: 'Release', t: asSimMs(pressAt + STEP_MS) });
      sim.drainEvents();
      sim.step();
      const glide = sim
        .drainEvents()
        .find((event) => event.type === 'PapaGlideStarted' && event.threatId === farthest.id);
      if (glide?.type !== 'PapaGlideStarted') throw new Error('the press started no glide');
      expect(glide.arriveAt - glide.t).toBe(900);
      while (sim.world.time.sim < glide.arriveAt + STEP_MS) sim.step();
      expect(sim.world.papa.xM).toBeCloseTo(glide.toXM, 6);
      expect(sim.world.papa.zM).toBeCloseTo(glide.toZM, 6);
    } finally {
      sim.dispose();
    }
  });
});

describe('the live salon_kitchen dishwasher (story 9.6)', () => {
  async function loaded() {
    const result = await loadSimLevel(
      fileURLToPath(new URL('../../content', import.meta.url)),
      'salon_kitchen',
    );
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it('has the dishwasher object at the dishwasher anchor, and both chores in order', async () => {
    const { level } = await loaded();
    expect(level.level.objects).toContainEqual({
      id: 'dishwasher',
      kind: 'dishwasher',
      anchor: 'dishwasher',
    });
    // The cooking keeps index 0: nothing that reads chores by position moves.
    expect(level.level.chores).toEqual([
      { def: 'cooking', object: 'stove' },
      { def: 'unload_dishwasher', object: 'dishwasher' },
    ]);
  });

  it('pays the whole Maison row with the two chores, 7.5 points each', async () => {
    const { content, level } = await loaded();
    const points = (level.chores ?? []).map((chore) => chore.homePoints);
    expect(points).toEqual([7.5, 7.5]);
    expect(points.reduce((sum, value) => sum + value, 0)).toBe(content.feel.mama.homeMaxPoints);
  });

  it('plans the open dishwasher once, at the dishwasher anchor, from the first wave', async () => {
    const { level } = await loaded();
    const planned = level.level.waves.flatMap((wave, w) =>
      wave.threats.filter((threat) => threat.def === 'dishwasher_open').map(() => w),
    );
    expect(planned).toEqual([0]);
    expect(level.level.waves[0]?.threats).toContainEqual({
      def: 'dishwasher_open',
      anchor: 'dishwasher',
    });
    expect(level.chores?.[1]?.openThreat).toBe('dishwasher_open');
    expect(level.threats.dishwasher_open?.target).toBe('anchor');
  });

  it('plans the sim: the dishwasher is the second station and its chore knows its door', async () => {
    const { content, geometry, level } = await loaded();
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    try {
      expect(sim.chores.map((chore) => chore.objectId)).toEqual(['stove', 'dishwasher']);
      expect(sim.chores[0]?.openThreatIndex).toBeNull();
      const doorIndex = sim.chores[1]?.openThreatIndex;
      expect(doorIndex).not.toBeNull();
      expect(sim.world.threats[doorIndex as number]?.defId).toBe('dishwasher_open');
      // The station stands on the anchor the door does (the stations' floor point is the anchor's).
      const anchor = geometry.anchors.find((candidate) => candidate.id === 'dishwasher');
      expect(sim.chores[1]).toMatchObject({ xM: anchor?.positionM[0], zM: anchor?.positionM[2] });
    } finally {
      sim.dispose();
    }
  });
});
