import type { LevelContent } from '@content/contentBundle';
import type { SequenceDef } from '@content/schemas/sequence';
import type { ThreatDef } from '@content/schemas/threat';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeDuel,
  createTestBedtimeEyes,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  FATIGUE_GAUGES,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimLevel } from '../context.ts';
import { createSim, createSimWithSystems } from '../createSim.ts';
import { SYSTEMS } from '../step.ts';

// What a level that lists a duel sequence must have (story 4.6): `createSim` refuses it with the
// words `content:check` uses (both call `sequenceDuelProblems`), and the instances it builds for
// the duel stand after the micro-sleep and the cry in the arms, which keep their indices.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestBedtimeDuel();
const EYES = createTestBedtimeEyes();

const levelWith = (
  overrides: Parameters<typeof createTestLevel>[0] = {},
  edit: (level: LevelContent) => LevelContent = (level) => level,
): LevelContent =>
  edit(
    createTestLevel({
      carry: CARRY,
      sequences: ['bedtime_duel'],
      ...overrides,
    }),
  );

const withThreat = (level: LevelContent, def: ThreatDef): LevelContent => ({
  ...level,
  threats: { ...level.threats, [def.id]: def },
});

const withDuel = (def: SequenceDef): Parameters<typeof createTestLevel>[0] => ({
  sequenceDefs: { bedtime_duel: def },
});

describe('createSim and the duel steps of a sequence (story 4.6)', () => {
  it('accepts the frozen duel in a level that carries the baby', async () => {
    const sim = await createSim({ content, geometry, level: levelWith(), seed: 1 });
    sim.dispose();
  });

  it('refuses a threatDef that is not loaded', async () => {
    const level = levelWith();
    const threats = { ...level.threats };
    delete threats.bedtime_eyes;
    await expect(
      createSim({ content, geometry, level: { ...level, threats }, seed: 1 }),
    ).rejects.toThrow(
      /the sequence "bedtime_duel" has a duel step .* threatDef "bedtime_eyes" is not loaded/,
    );
  });

  it('refuses a threatDef whose response is not wait', async () => {
    const outlet = { ...createTestOutlet(), id: 'bedtime_eyes', target: 'papa' } as ThreatDef;
    await expect(
      createSim({ content, geometry, level: withThreat(levelWith(), outlet), seed: 1 }),
    ).rejects.toThrow(/has the response "parry", but a duel asks for "wait"/);
  });

  it('refuses a threatDef whose target is not papa', async () => {
    const anchored = { ...EYES, target: 'anchor' } as ThreatDef;
    await expect(
      createSim({ content, geometry, level: withThreat(levelWith(), anchored), seed: 1 }),
    ).rejects.toThrow(/has the target "anchor", but a duel threat stands on Papa/);
  });

  it('refuses a durationMs below what a round can take', async () => {
    const short: SequenceDef = {
      ...DEF,
      steps: DEF.steps.map((step) => ({ ...step, durationMs: 1000 })),
    };
    await expect(
      createSim({ content, geometry, level: levelWith(withDuel(short)), seed: 1 }),
    ).rejects.toThrow(/with a durationMs of 1000, below the .* ms a round can take/);
  });

  it('refuses a papa_asleep gag', async () => {
    const asleep = { ...EYES, gag: 'papa_asleep' } as ThreatDef;
    await expect(
      createSim({ content, geometry, level: withThreat(levelWith(), asleep), seed: 1 }),
    ).rejects.toThrow(/has the gag "papa_asleep", which is the micro-sleep's alone/);
  });

  it('refuses a duel threat with a gag the sim does not know', async () => {
    const odd = { ...EYES, gag: 'baby_eyes_reopens' } as ThreatDef;
    await expect(
      createSim({ content, geometry, level: withThreat(levelWith(), odd), seed: 1 }),
    ).rejects.toThrow(/has the gag "baby_eyes_reopens", which the sim does not know/);
  });

  it('refuses a wave that plans a threat on Papa, naming the duel step as another way in', async () => {
    const level = createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: ['bedtime_duel'],
    });
    const asPlanned = {
      ...level,
      level: {
        ...level.level,
        waves: [testWave([{ def: 'bedtime_eyes', anchor: 'outlet_01' }])],
      },
      threats: { ...level.threats },
    };
    await expect(createSim({ content, geometry, level: asPlanned, seed: 1 })).rejects.toThrow(
      /only the sim spawns it \(gauges\.fatigue\.microSleepDef, carry\.armsCryDef or a sequence's duel step\)/,
    );
  });
});

describe('the duel instances of a level (story 4.6)', () => {
  /** The level the sim plans (`ctx.level`), seen by a system that runs once. */
  async function plannedOf(level: LevelContent): Promise<{ planned: SimLevel; defIds: string[] }> {
    let planned: SimLevel | null = null;
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      (_world, ctx) => {
        planned = ctx.level;
      },
    ]);
    sim.step();
    const defIds = sim.world.threats.map((threat) => threat.defId);
    sim.dispose();
    if (planned === null) throw new Error('the spy never ran');
    return { planned, defIds };
  }

  it('pushes the duel instance after the micro-sleep and the cry, which keep their indices', async () => {
    const level = levelWith({ gauges: FATIGUE_GAUGES, waves: [testWave([OUTLET])] });
    const { planned, defIds } = await plannedOf(level);
    // The wave's outlet, the micro-sleep, the cry in the arms, then the duel's eyes.
    expect(defIds).toEqual(['outlet', 'papa_microsleep', 'arms_cry', 'bedtime_eyes']);
    expect(planned.microSleepIndex).toBe(1);
    expect(planned.armsCryIndex).toBe(2);
    expect(planned.sequences[0]?.duelThreatIndexes).toEqual([3, 3, 3]);
    expect(planned.threats[3]).toMatchObject({
      anchorId: planned.threats[1]?.anchorId,
      firstWaveIndex: -1,
      zone: null,
    });
  });

  it('keeps the cry at the end of a level that has no micro-sleep, the duel after it', async () => {
    const { planned, defIds } = await plannedOf(levelWith());
    expect(defIds).toEqual(['arms_cry', 'bedtime_eyes']);
    expect(planned.microSleepIndex).toBe(-1);
    expect(planned.armsCryIndex).toBe(0);
    expect(planned.sequences[0]?.duelThreatIndexes).toEqual([1, 1, 1]);
  });

  it('gives a step that is not a duel step a null index', async () => {
    const { planned } = await plannedOf(
      levelWith({ gauges: FATIGUE_GAUGES, sequences: ['stay_awake', 'bedtime_duel'] }),
    );
    expect(planned.sequences[0]?.duelThreatIndexes).toEqual([null, null, null]);
    expect(planned.sequences[1]?.duelThreatIndexes?.every((index) => index !== null)).toBe(true);
  });
});
