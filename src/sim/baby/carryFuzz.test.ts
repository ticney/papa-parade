import { createRng, nextFloat, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { World } from '../world.ts';

// Story 4.1: random play on the frozen room with carrying and the cry in the arms. Strict
// invariants throw inside the sim; on top of that, after every step a carried baby is at Papa's
// point, `armsCryAt` is set only while he is carried, and no anchored threat is announced to him.
// The commands come from a seeded rng of the test (never `Math.random`); `ForceThreat` is left out
// on purpose: it is the one way to announce a threat to a carried baby.

const SEED_COUNT = 200;
const STEP_COUNT = 3000;
/** Every this many steps the world goes through a snapshot and back: the validator must accept it. */
const SNAPSHOT_EVERY_STEPS = 500;
const COMMAND_CHANCE = 0.05;

const content = createTestContent();
const geometry = createTestGeometry();
const playpen = geometry.zones.find((zone) => zone.id === 'playpen');
if (playpen === undefined) throw new Error('the frozen room has no playpen zone');
const ANCHORED_DEFS = new Set(['outlet', 'stairs', 'coffee_table_object']);

function newLevel() {
  return createTestLevel({
    waves: [
      testWave([OUTLET, STAIRS], { gapMinMs: 300, gapMaxMs: 900 }),
      testWave([COFFEE_TABLE, SILENCE], {
        fromMs: 20_000,
        maxSimultaneous: 2,
        gapMinMs: 300,
        gapMaxMs: 900,
        disruptions: [testPhoneEntry(25_000)],
      }),
    ],
    objects: TEST_OBJECTS,
    gauges: { ...NOISE_GAUGES, ...FATIGUE_GAUGES },
    carry: CARRY,
  });
}

function randomCommand(sim: Sim, rng: ReturnType<typeof createRng>): SimCommand {
  const t = asSimMs(sim.world.time.sim);
  const world = sim.world as World;
  switch (nextInt(rng, 0, 8)) {
    case 0:
    case 1:
      return { type: 'TapBaby', t };
    case 2:
      return {
        type: 'TapFloor',
        t,
        xM: playpen?.centerM[0] ?? 0,
        zM: playpen?.centerM[2] ?? 0,
      };
    case 3:
      return { type: 'TapFloor', t, xM: -3 + nextFloat(rng) * 6, zM: -2 + nextFloat(rng) * 4 };
    case 4:
      return {
        type: 'TapObject',
        t,
        objectId: nextFloat(rng) < 0.5 ? 'coffee_machine' : 'phone',
      };
    case 5:
      return nextFloat(rng) < 0.5
        ? { type: 'Move', t, dirX: nextFloat(rng) * 2 - 1, dirZ: 1 - nextFloat(rng) * 2 }
        : { type: 'MoveStop', t };
    case 6: {
      const threat = world.threats[nextInt(rng, 0, world.threats.length)];
      return { type: 'PressThreat', t, threatId: threat?.id ?? 0 };
    }
    default:
      return { type: 'Release', t };
  }
}

describe('carrying, played at random', () => {
  it(`keeps its invariants over ${SEED_COUNT} seeds of ${STEP_COUNT} steps`, async () => {
    let carriedSteps = 0;
    let pickUps = 0;
    let putDowns = 0;
    let cancels = 0;
    let armsCries = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const sim = await createSim({ content, geometry, level: newLevel(), seed });
      const rng = createRng(seed * 7919);
      try {
        for (let step = 0; step < STEP_COUNT; step++) {
          // `restore` swaps the world for a copy: read it again at every step.
          const world = sim.world as World;
          if (nextFloat(rng) < COMMAND_CHANCE) sim.enqueue(randomCommand(sim, rng));
          const wasCarried = world.baby.state === 'carried';
          sim.step();
          for (const event of sim.drainEvents()) {
            if (event.type === 'BabyPickedUp') pickUps++;
            if (event.type === 'BabyPutDown') putDowns++;
            if (event.type === 'ThreatCancelled') cancels++;
            if (event.type === 'ThreatTelegraphed' && event.kind === 'arms_cry') armsCries++;
            if (event.type === 'ThreatTelegraphed' && wasCarried) {
              expect(
                ANCHORED_DEFS.has(event.kind),
                `seed ${seed} step ${step}: ${event.kind}`,
              ).toBe(false);
            }
          }
          const isCarried = world.baby.state === 'carried';
          if (isCarried) {
            carriedSteps++;
            expect(world.baby.xM, `seed ${seed} step ${step}`).toBe(world.papa.xM);
            expect(world.baby.zM, `seed ${seed} step ${step}`).toBe(world.papa.zM);
            for (const threat of world.threats) {
              if (!ANCHORED_DEFS.has(threat.defId)) continue;
              expect(['telegraph', 'windowOpen'], `seed ${seed} step ${step}`).not.toContain(
                threat.state,
              );
            }
          }
          if (world.carry.armsCryAt !== null) {
            expect(isCarried, `seed ${seed} step ${step}: armsCryAt while not carried`).toBe(true);
          }
          if (step % SNAPSHOT_EVERY_STEPS === SNAPSHOT_EVERY_STEPS - 1) {
            sim.restore(sim.snapshot());
          }
        }
      } finally {
        sim.dispose();
      }
    }
    // The run actually exercised the feature.
    expect(pickUps).toBeGreaterThan(SEED_COUNT);
    expect(putDowns).toBeGreaterThan(SEED_COUNT / 2);
    expect(carriedSteps).toBeGreaterThan(SEED_COUNT * 100);
    expect(cancels).toBeGreaterThan(0);
    expect(armsCries).toBeGreaterThan(0);
  }, 120_000);
});
