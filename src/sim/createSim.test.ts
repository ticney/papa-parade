import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
  stepN,
  TEST_OBJECTS,
} from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import { SYSTEMS } from './step.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const level = createTestLevel();

describe('createSim', () => {
  it('advances exactly 1000 ms in 100 steps', async () => {
    const sim = await createSim({ content, geometry, level, seed: 42 });
    expect(sim.world.time.sim).toBe(0);
    stepN(sim, 100);
    expect(sim.world.time.sim).toBe(1000);
  });

  it('keeps World as plain serializable data, at creation and after 100 steps', async () => {
    const sim = await createSim({ content, geometry, level, seed: 42 });
    expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    stepN(sim, 100);
    expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    expect(() => hashJson(sim.world)).not.toThrow();
  });

  it('rejects a bad seed', async () => {
    for (const seed of [-1, 1.5, Number.NaN]) {
      await expect(createSim({ content, geometry, level, seed })).rejects.toThrow();
    }
  });

  it('exposes timeScale 1 at start', async () => {
    expect((await createSim({ content, geometry, level, seed: 1 })).timeScale).toBe(1);
  });
});

describe('drainEvents', () => {
  const emit: System = (world, ctx) => {
    ctx.events.push({ type: 'TimeScaleChanged', t: world.time.sim, from: 1, to: 1 });
  };

  it('returns the events once, then an empty array, reusing the same array', async () => {
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      emit,
    ]);
    stepN(sim, 3);
    const first = sim.drainEvents();
    expect(first.map((e) => e.t)).toEqual([10, 20, 30]);
    const second = sim.drainEvents();
    expect(second).toBe(first);
    expect(second).toHaveLength(0);
  });

  it('accumulates when nobody drains', async () => {
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      emit,
    ]);
    stepN(sim, 5);
    stepN(sim, 5);
    expect(sim.drainEvents()).toHaveLength(10);
  });
});

describe('freeze', () => {
  const requestAtFirstStep: System = (world, ctx) => {
    if (world.time.sim === 10) ctx.requestFreezeRealMs(80);
  };

  it('exposes the remaining freeze, consumed by the client, and never blocks step()', async () => {
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      requestAtFirstStep,
    ]);
    expect(sim.freezeRealMs).toBe(0);
    sim.step();
    expect(sim.freezeRealMs).toBe(80);
    sim.step();
    expect(sim.world.time.sim).toBe(20);
    expect(sim.freezeRealMs).toBe(80);
    sim.consumeFreeze(30);
    expect(sim.freezeRealMs).toBe(50);
    sim.consumeFreeze(1000);
    expect(sim.freezeRealMs).toBe(0);
  });

  it('is not part of World: a never-consumed freeze does not change the hash', async () => {
    const withFreeze = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      requestAtFirstStep,
    ]);
    const without = await createSim({ content, geometry, level, seed: 1 });
    stepN(withFreeze, 10);
    stepN(without, 10);
    expect(hashJson(withFreeze.world)).toBe(hashJson(without.world));
  });
});

describe('journal option', () => {
  it('refuses a journal recorded with another seed, feel, geometry or version', async () => {
    const source = await createSim({ content, geometry, level, seed: 7 });
    source.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.5 });
    const journal = source.journal();
    await expect(createSim({ content, geometry, level, seed: 8, journal })).rejects.toThrow(/seed/);
    await expect(
      createSim({ content, geometry, level, seed: 7, journal: { ...journal, feelHash: 'x' } }),
    ).rejects.toThrow(/feel/);
    await expect(
      createSim({ content, geometry, level, seed: 7, journal: { ...journal, geometryHash: 'x' } }),
    ).rejects.toThrow(/another level geometry/);
    await expect(
      createSim({ content, geometry, level, seed: 7, journal: { ...journal, levelHash: 'x' } }),
    ).rejects.toThrow(/another level$/);
    await expect(
      createSim({ content, geometry, level, seed: 7, journal: { ...journal, version: 2 as 3 } }),
    ).rejects.toThrow(/story 1\.10/);
    await expect(
      createSim({ content, geometry, level, seed: 7, journal: { ...journal, version: 1 as 3 } }),
    ).rejects.toThrow(/version 1/);
    const movedWall = { ...geometry, id: 'other_room' };
    const otherLevel = { ...level, level: { ...level.level, id: 'other_room' } };
    await expect(
      createSim({ content, level: otherLevel, geometry: movedWall, seed: 7, journal }),
    ).rejects.toThrow(/another level geometry/);
  });

  it('pre-loads the entries with their recorded applyAt', async () => {
    const source = await createSim({ content, geometry, level, seed: 7 });
    stepN(source, 100);
    source.enqueue({ type: 'SetTimeScale', t: asSimMs(980), scale: 0.5 });
    const journal = source.journal();
    const replay = await createSim({ content, geometry, level, seed: 7, journal });
    stepN(replay, 100);
    expect(replay.timeScale).toBe(1);
    replay.step();
    expect(replay.timeScale).toBe(0.5);
    expect(replay.journal()).toEqual(journal);
  });
});

describe('journal()', () => {
  it('returns a deep copy: editing it does not rewrite history', async () => {
    const sim = await createSim({ content, geometry, level, seed: 7 });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(10), scale: 0.5 });
    const copy = sim.journal();
    copy.entries.length = 0;
    expect(sim.journal().entries).toHaveLength(1);
    expect(sim.journal()).toMatchObject({ version: 3, seed: 7, feelHash: hashJson(content.feel) });
  });
});

describe('the level it plans', () => {
  const planning = createTestLevel([outletEntry(2000), outletEntry(9000)]);
  const defOf = () => {
    const def = planning.threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    return def;
  };

  it('creates one idle instance per entry, in level order, with ids from the world and the anchor’s position', async () => {
    const sim = await createSim({ content, geometry, level: planning, seed: 1 });
    const outlet = geometry.anchors.find((anchor) => anchor.id === 'outlet_01');
    expect(sim.world.threats).toEqual([
      {
        id: 1,
        defId: 'outlet',
        anchorId: 'outlet_01',
        xM: outlet?.positionM[0],
        zM: outlet?.positionM[2],
        state: 'idle',
        enteredAt: 0,
        windowOpenAt: 0,
        responseWindow: null,
        press: null,
      },
      expect.objectContaining({ id: 2, defId: 'outlet', state: 'idle' }),
    ]);
    expect(sim.world.nextId).toBe(3);
  });

  it('plans nothing for a level that plans nothing', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(sim.world.threats).toEqual([]);
    expect(sim.world.nextId).toBe(1);
  });

  it('refuses a level of another room, naming both', async () => {
    const other = { ...level, level: { ...level.level, id: 'other_room' } };
    await expect(createSim({ content, geometry, level: other, seed: 1 })).rejects.toThrow(
      /other_room.*salon_crawler/,
    );
  });

  it('refuses a planned threat whose def is not loaded', async () => {
    const missing = { ...planning, threats: {} };
    await expect(createSim({ content, geometry, level: missing, seed: 1 })).rejects.toThrow(
      /threats\[0\].*outlet is not loaded/,
    );
  });

  it('refuses an anchor the room does not have, naming the level, the def and the anchor', async () => {
    const wrong = createTestLevel([{ ...outletEntry(0), anchor: 'outlet_02' }]);
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*threats\[0\].*outlet.*outlet_02/,
    );
  });

  it('refuses an object whose anchor the room does not have, naming the level, the object and the anchor', async () => {
    const wrong = createTestLevel([], [{ id: 'kettle', anchor: 'kettle_spot' }]);
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*objects\[0\].*kettle.*kettle_spot/,
    );
  });

  it('refuses an object id listed twice', async () => {
    const twice = createTestLevel(
      [],
      [
        { id: 'phone', anchor: 'phone' },
        { id: 'phone', anchor: 'coffee_machine' },
      ],
    );
    await expect(createSim({ content, geometry, level: twice, seed: 1 })).rejects.toThrow(
      /objects\[1\].*"phone" is listed twice/,
    );
  });

  it('accepts a level with objects, and hashes them into the journal', async () => {
    const withObjects = createTestLevel([], TEST_OBJECTS);
    const sim = await createSim({ content, geometry, level: withObjects, seed: 1 });
    expect(sim.journal().levelHash).toBe(hashJson(withObjects));
    expect(sim.journal().levelHash).not.toBe(hashJson(level));
  });

  it('refuses a gag the sim does not know', async () => {
    const odd = { ...planning, threats: { outlet: { ...defOf(), gag: 'outlet_hairs' } } };
    await expect(createSim({ content, geometry, level: odd, seed: 1 })).rejects.toThrow(
      /unknown gag outlet_hairs/,
    );
  });

  it('hashes the level into the journal and the snapshot', async () => {
    const sim = await createSim({ content, geometry, level: planning, seed: 1 });
    expect(sim.journal().levelHash).toBe(hashJson(planning));
    expect(sim.snapshot().levelHash).toBe(hashJson(planning));
    expect(sim.snapshot().levelHash).not.toBe(hashJson(level));
  });
});

describe('physics (story 1.15)', () => {
  it('creates one prop slice per prop of the geometry, index-aligned, at rest at its start pose', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(sim.world.props.map((prop) => prop.id)).toEqual(geometry.props.map((prop) => prop.id));
    expect(sim.world.props[0]).toMatchObject({
      id: 'mug_01',
      kind: 'mug',
      xM: geometry.props[0]?.centerM[0],
      yM: geometry.props[0]?.centerM[1],
      qw: 1,
      prevXM: geometry.props[0]?.centerM[0],
      isOnFloor: false,
      isBroken: false,
      lastImpactAt: null,
    });
    expect(sim.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0 });
    sim.dispose();
  });

  it('refuses a level whose prop kind has no entry in the feel, naming the prop', async () => {
    const broken = createTestGeometry();
    broken.props = [
      { id: 'teapot_01', kind: 'teapot', centerM: [0, 0.2, 0], halfExtentsM: [0.1, 0.1, 0.1] },
    ];
    await expect(createSim({ content, geometry: broken, level, seed: 1 })).rejects.toThrow(
      /props\[0\]\.kind "teapot" has no feel\.physics\.kinds entry/,
    );
  });

  describe('dispose', () => {
    it('is idempotent, and a step, a snapshot or a restore after it fails an invariant', async () => {
      const sim = await createSim({ content, geometry, level, seed: 1 });
      const snapshot = sim.snapshot();
      sim.dispose();
      expect(() => sim.dispose()).not.toThrow();
      expect(() => sim.step()).toThrow(/disposed/);
      expect(() => sim.snapshot()).toThrow(/disposed/);
      expect(() => sim.restore(snapshot)).toThrow(/disposed/);
    });

    it('leaves another sim alone', async () => {
      const first = await createSim({ content, geometry, level, seed: 1 });
      const second = await createSim({ content, geometry, level, seed: 1 });
      first.dispose();
      expect(() => stepN(second, 50)).not.toThrow();
      second.dispose();
    });
  });
});
