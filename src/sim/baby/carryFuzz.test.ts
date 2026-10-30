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
  NEED_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  TEST_OBJECTS,
  TEST_TOILET,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { World } from '../world.ts';

// Story 4.1: random play on the frozen room with carrying and the cry in the arms. Strict
// invariants throw inside the sim; on top of that, after every step a carried baby is at Papa's
// point, `armsCryAt` is set only while he is carried, and no threat of the baby (an anchored one, or a found silence's) is announced to him.
// Story 4.2 adds the combo: after every step the multiplier is between the feel's bounds, the points
// cashed in never fall, and the carry tick is due exactly while the baby is carried.
// Story 4.3 adds the toilet: after every step `onToilet` never meets a carried baby, the need stays
// in [0, 100] and a visit freezes it; random `SetBladder` commands keep the toilet visits coming.
// Story 4.4 adds the special sequence: random `StartSequence` commands, and after every step `sequence.id` and
// the flow agree, a sequence that carries the baby has him in the arms, and a carried baby never moves away from Papa.
// The commands come from a seeded rng of the test (never `Math.random`); `ForceThreat` is left out
// on purpose: it is the one way to announce a threat to a carried baby.

const SEED_COUNT = 200;
const STEP_COUNT = 3000;
/** Every this many steps the world goes through a snapshot and back: the validator must accept it. */
const SNAPSHOT_EVERY_STEPS = 500;
const COMMAND_CHANCE = 0.05;
/** A sequence start, drawn apart so that the mix of the other commands (and the coverage it was written for) does not move. */
const SEQUENCE_CHANCE = 0.0004;

// A short carry tick: random play seldom carries for ten seconds, and the cash-in must be exercised.
const baseContent = createTestContent();
const content = {
  ...baseContent,
  feel: {
    ...baseContent.feel,
    combo: { ...baseContent.feel.combo, carryTickMs: 1500 },
    // A short visit: random play seldom stays long, and the visits must end inside a run.
    bladder: { ...baseContent.feel.bladder, toiletDurationMs: 1500 },
  },
};
const geometry = createTestGeometry();
const playpen = geometry.zones.find((zone) => zone.id === 'playpen');
if (playpen === undefined) throw new Error('the frozen room has no playpen zone');
const BABY_DEFS = new Set(['outlet', 'stairs', 'coffee_table_object', 'silence_mischief']);

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
    objects: [...TEST_OBJECTS, TEST_TOILET],
    gauges: { ...NOISE_GAUGES, ...FATIGUE_GAUGES, ...NEED_GAUGES },
    carry: CARRY,
    sequences: ['stay_awake'],
  });
}

function randomCommand(sim: Sim, rng: ReturnType<typeof createRng>): SimCommand {
  const t = asSimMs(sim.world.time.sim);
  const world = sim.world as World;
  switch (nextInt(rng, 0, 9)) {
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
        objectId: ['coffee_machine', 'phone', 'toilet', 'toilet'][nextInt(rng, 0, 4)] ?? 'toilet',
      };
    case 5:
      return nextFloat(rng) < 0.5
        ? { type: 'Move', t, dirX: nextFloat(rng) * 2 - 1, dirZ: 1 - nextFloat(rng) * 2 }
        : { type: 'MoveStop', t };
    case 6: {
      const threat = world.threats[nextInt(rng, 0, world.threats.length)];
      return { type: 'PressThreat', t, threatId: threat?.id ?? 0 };
    }
    case 7:
      return { type: 'SetBladder', t, pct: 40 + nextFloat(rng) * 60 };
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
    let comboChanges = 0;
    let cashIns = 0;
    let toiletVisits = 0;
    let refusals = 0;
    let sequencesStarted = 0;
    let sequencesSucceeded = 0;
    let sequencesFailed = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const sim = await createSim({ content, geometry, level: newLevel(), seed });
      const rng = createRng(seed * 7919);
      const sequenceRng = createRng(seed * 104729);
      let previousComboPoints = 0;
      try {
        for (let step = 0; step < STEP_COUNT; step++) {
          // `restore` swaps the world for a copy: read it again at every step.
          const world = sim.world as World;
          if (nextFloat(rng) < COMMAND_CHANCE) sim.enqueue(randomCommand(sim, rng));
          if (nextFloat(sequenceRng) < SEQUENCE_CHANCE) {
            sim.enqueue({
              type: 'StartSequence',
              t: asSimMs(world.time.sim),
              sequenceId: 'stay_awake',
            });
          }
          const wasCarried = world.baby.state === 'carried';
          sim.step();
          for (const event of sim.drainEvents()) {
            if (event.type === 'BabyPickedUp') pickUps++;
            if (event.type === 'BabyPutDown') putDowns++;
            if (event.type === 'ThreatCancelled') cancels++;
            if (event.type === 'ComboChanged') comboChanges++;
            if (event.type === 'ComboCashedIn') cashIns++;
            if (event.type === 'ToiletFinished') toiletVisits++;
            if (event.type === 'ToiletRefused') refusals++;
            if (event.type === 'SequenceStarted') sequencesStarted++;
            if (event.type === 'SequenceEnded' && event.outcome === 'succeeded') {
              sequencesSucceeded++;
            }
            if (event.type === 'SequenceEnded' && event.outcome === 'failed') sequencesFailed++;
            if (event.type === 'ThreatTelegraphed' && event.kind === 'arms_cry') armsCries++;
            if (event.type === 'ThreatTelegraphed' && wasCarried) {
              expect(BABY_DEFS.has(event.kind), `seed ${seed} step ${step}: ${event.kind}`).toBe(
                false,
              );
            }
          }
          const isCarried = world.baby.state === 'carried';
          // The sequence's id and the flow agree, and a running sequence has the baby in the arms.
          expect(
            world.sequence.id !== null,
            `seed ${seed} step ${step}: sequence.id and the flow disagree`,
          ).toBe(world.flow.state === 'sequence');
          if (world.flow.state === 'sequence') {
            expect(isCarried, `seed ${seed} step ${step}: a sequence with no baby`).toBe(true);
          }
          expect(
            world.papa.state === 'onToilet' && isCarried,
            `seed ${seed} step ${step}: a carried baby on the toilet`,
          ).toBe(false);
          expect(world.gauges.bladderPct, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(0);
          expect(world.gauges.bladderPct, `seed ${seed} step ${step}`).toBeLessThanOrEqual(100);
          if (isCarried) {
            carriedSteps++;
            expect(world.baby.xM, `seed ${seed} step ${step}`).toBe(world.papa.xM);
            expect(world.baby.zM, `seed ${seed} step ${step}`).toBe(world.papa.zM);
            for (const threat of world.threats) {
              if (!BABY_DEFS.has(threat.defId)) continue;
              expect(['telegraph', 'windowOpen'], `seed ${seed} step ${step}`).not.toContain(
                threat.state,
              );
            }
          }
          const { minMultiplier, maxMultiplier } = content.feel.combo;
          expect(world.combo.multiplier, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(
            minMultiplier,
          );
          expect(world.combo.multiplier, `seed ${seed} step ${step}`).toBeLessThanOrEqual(
            maxMultiplier,
          );
          expect(world.score.comboPoints, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(
            previousComboPoints,
          );
          previousComboPoints = world.score.comboPoints;
          expect(
            world.combo.carryTickAt !== null,
            `seed ${seed} step ${step}: carryTickAt and the arms disagree`,
          ).toBe(isCarried);
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
    expect(comboChanges).toBeGreaterThan(0);
    expect(cashIns).toBeGreaterThan(0);
    expect(toiletVisits).toBeGreaterThan(SEED_COUNT / 4);
    expect(refusals).toBeGreaterThan(0);
    expect(sequencesStarted).toBeGreaterThan(SEED_COUNT / 4);
    expect(sequencesSucceeded + sequencesFailed).toBeGreaterThan(0);
  }, 120_000);
});
