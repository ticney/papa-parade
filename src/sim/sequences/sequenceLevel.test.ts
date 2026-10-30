import type { LevelContent } from '@content/contentBundle';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestStayAwake,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// What a level that lists a sequence must have (story 4.4, AC 3): `createSim` refuses it with the
// wording `content:check` uses, so a level built without the schema (a test, a tool) cannot slip by.
const content = createTestContent();
const geometry = createTestGeometry();

const levelWith = (overrides: Parameters<typeof createTestLevel>[0] = {}): LevelContent =>
  createTestLevel({
    gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
    carry: CARRY,
    sequences: ['stay_awake'],
    ...overrides,
  });

describe('createSim and the level’s sequences', () => {
  it('accepts a level that carries and has fatigue, and plans the def in the level’s order', async () => {
    const sim = await createSim({ content, geometry, level: levelWith(), seed: 1 });
    sim.dispose();
  });

  it('refuses a sequence that carries the baby in a level with no carry', async () => {
    await expect(
      createSim({ content, geometry, level: levelWith({ carry: undefined }), seed: 1 }),
    ).rejects.toThrow(
      /sequences\[0\]: the sequence "stay_awake" carries the baby, but the level has no carry/,
    );
  });

  it('refuses a microSleeps step in a level with no micro-sleep def', async () => {
    await expect(
      createSim({ content, geometry, level: levelWith({ gauges: NOISE_GAUGES }), seed: 1 }),
    ).rejects.toThrow(
      /has a microSleeps step, but the level has no gauges\.fatigue\.microSleepDef/,
    );
  });

  it('refuses a sequence the level lists but did not load, and one listed twice', async () => {
    const level = levelWith();
    await expect(
      createSim({
        content,
        geometry,
        level: { ...level, sequences: {} },
        seed: 1,
      }),
    ).rejects.toThrow(/sequences\[0\]: the sequence stay_awake is not loaded/);
    await expect(
      createSim({
        content,
        geometry,
        level: { ...level, level: { ...level.level, sequences: ['stay_awake', 'stay_awake'] } },
        seed: 1,
      }),
    ).rejects.toThrow(/sequences\[1\]: the sequence "stay_awake" is already listed/);
  });

  it('refuses a step kind the sim has no handler for', async () => {
    const level = levelWith();
    const def = createTestStayAwake();
    const rogue = { ...def, steps: [{ ...def.steps[0], kind: 'dance' }] } as never;
    await expect(
      createSim({
        content,
        geometry,
        level: { ...level, sequences: { stay_awake: rogue } },
        seed: 1,
      }),
    ).rejects.toThrow(/step of the kind "dance", which the sim does not know/);
  });
});

describe('a level that lists a sequence but never starts one', () => {
  it('runs a missed threat exactly as before: no sequence event, no snore, no wake', async () => {
    const level = levelWith({ waves: [testWave([OUTLET], { gapMinMs: 500, gapMaxMs: 500 })] });
    const sim = await createSim({ content, geometry, level, seed: 3 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 400; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.some((event) => event.type === 'GagTriggered')).toBe(true);
    const types = new Set(events.map((event) => event.type));
    for (const name of [
      'SequenceStarted',
      'SequenceStepStarted',
      'SequenceEnded',
      'PapaSnored',
      'BabyWoke',
    ]) {
      expect(types.has(name as SimEvent['type']), name).toBe(false);
    }
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.world.sequence.id).toBeNull();
    sim.dispose();
  });

  it('a missed micro-sleep outside a sequence is still a plain 3 s nap: no snore, no noise (D2)', async () => {
    const sim = await createSim({ content, geometry, level: levelWith(), seed: 3 });
    sim.enqueue({ type: 'SetFatigue', t: 0 as never, points: 95 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 2500; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.filter((event) => event.type === 'GagTriggered').length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'PapaSnored')).toBe(false);
    expect(events.some((event) => event.type === 'BabyWoke')).toBe(false);
    expect(
      events.filter((event) => event.type === 'NoiseChanged' && event.source === 'snore'),
    ).toEqual([]);
    sim.dispose();
  });
});
