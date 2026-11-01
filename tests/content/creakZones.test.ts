import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim/createSim.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import type { World } from '../../src/sim/world.ts';
import {
  CARRY,
  createTestContent,
  createTestLevel,
  createTestStealthExit,
} from '../support/testContent.ts';

// Where the boards go (story 4.9, AC 12) is a test, not a judgement, and it reads the LIVE geometry:
// when Geo moves a board in Blender and re-exports, this is what says whether the route still works.
//   - the path Papa takes from the playpen's centre to the door crosses at least one board, so that a
//     plain walk creaks (the boards are there to be memorised);
//   - a fixed list of waypoints reaches the exit radius crossing none (a clean route exists).
const live = (): LevelGeometry => {
  const text = readFileSync(
    new URL('../../content/levels/salon_crawler.geometry.json', import.meta.url),
    'utf8',
  );
  const parsed = parseContentFile(
    'content/levels/salon_crawler.geometry.json',
    text,
    LevelGeometrySchema,
  );
  if (!parsed.ok) throw new Error('the live geometry is invalid');
  return parsed.value;
};
const geometry = live();
const DOOR = geometry.anchors.find((anchor) => anchor.id === 'door')?.positionM ?? [0, 0, 0];
const PLAYPEN = geometry.zones.find((zone) => zone.id === 'playpen')?.centerM ?? [0, 0, 0];
/** A clean route from the playpen to the door, found with a throwaway A* and checked here with the sim's own. */
const CLEAN_ROUTE: readonly (readonly [number, number])[] = [
  [-0.8, 1.75],
  [1.0, 1.1],
  [2.8, 0.3],
  [2.95, -1.1],
  [2.9, -2.2],
];

async function stealthSim() {
  const sequence = createTestStealthExit();
  const sim = await createSim({
    content: createTestContent(),
    geometry,
    level: createTestLevel({
      carry: CARRY,
      sequences: [sequence.id],
      sequenceDefs: { [sequence.id]: sequence },
    }),
    seed: 1,
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: sequence.id });
  const world = sim.world as World;
  const events: SimEvent[] = [];
  const step = () => {
    sim.step();
    events.push(...sim.drainEvents());
    // No alert: this test is about the boards, not the baby.
    (sim.world as World).sequence.stealth.nextAlertAt = asSimMs(100_000_000);
  };
  step();
  return { sim, world, events, step };
}

describe('the boards of the live room (story 4.9)', () => {
  it('has three creak zones, and leaves the safe and hidden zones where they were', () => {
    const creaks = geometry.zones.filter((zone) => zone.kind === 'creak');
    expect(creaks.map((zone) => zone.id)).toEqual(['board_01', 'board_02', 'board_03']);
    expect(geometry.zones.find((zone) => zone.id === 'playpen')).toMatchObject({
      kind: 'safe',
      centerM: [-2, 0.3, 1.6],
    });
    expect(geometry.zones.find((zone) => zone.id === 'behind_sofa')).toMatchObject({
      kind: 'hidden',
      centerM: [0.5, 0.5, -2.6],
    });
  });

  it('is crossed by a plain walk from the playpen to the door', async () => {
    const run = await stealthSim();
    expect(run.world.papa.xM).toBeCloseTo(PLAYPEN[0]);
    run.sim.enqueue({
      type: 'TapFloor',
      t: run.world.time.sim,
      xM: DOOR[0],
      zM: DOOR[2],
    });
    for (let i = 0; i < 4000 && run.world.flow.state === 'sequence'; i++) run.step();
    expect(run.world.flow.state).toBe('playing');
    const creaks = run.events.filter((event) => event.type === 'FloorCreaked');
    expect(creaks.length).toBeGreaterThanOrEqual(1);
  });

  it('can be crossed with no creak: a fixed route reaches the exit radius over no board', async () => {
    const run = await stealthSim();
    for (const [xM, zM] of CLEAN_ROUTE) {
      run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM, zM });
      for (let i = 0; i < 2000 && run.world.flow.state === 'sequence'; i++) {
        run.step();
        if (run.world.papa.state === 'idle') break;
      }
    }
    expect(run.events.filter((event) => event.type === 'FloorCreaked')).toEqual([]);
    expect(run.events.filter((event) => event.type === 'SequenceEnded')).toMatchObject([
      { outcome: 'succeeded' },
    ]);
  });
});
