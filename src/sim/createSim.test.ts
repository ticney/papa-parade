import { cloneJson, hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  stepN,
  TEST_OBJECTS,
  testWave,
} from '../../tests/support/testContent.ts';
import type { StepContext, System } from './context.ts';
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
  const SECOND_OUTLET = { def: 'outlet', anchor: 'phone' };
  const planning = createTestLevel({
    waves: [
      testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 }),
      testWave([SECOND_OUTLET], { fromMs: 9000, gapMinMs: 500, gapMaxMs: 500 }),
    ],
  });
  const defOf = () => {
    const def = planning.threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    return def;
  };

  it('creates one idle instance per planned anchor, in order of first appearance, with ids from the world and the anchor’s position', async () => {
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
        waveIndex: -1,
      },
      expect.objectContaining({ id: 2, defId: 'outlet', anchorId: 'phone', state: 'idle' }),
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
      /waves\[0\]\.threats\[0\].*outlet is not loaded/,
    );
  });

  it('refuses an anchor the room does not have, naming the level, the def and the anchor', async () => {
    const wrong = createTestLevel({ waves: [testWave([{ def: 'outlet', anchor: 'outlet_02' }])] });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*waves\[0\]\.threats\[0\].*outlet.*outlet_02/,
    );
  });

  it('refuses an object whose anchor the room does not have, naming the level, the object and the anchor', async () => {
    const wrong = createTestLevel({ objects: [{ id: 'kettle', anchor: 'kettle_spot' }] });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*objects\[0\].*kettle.*kettle_spot/,
    );
  });

  it('refuses an object id listed twice', async () => {
    const twice = createTestLevel({
      objects: [
        { id: 'phone', anchor: 'phone' },
        { id: 'phone', anchor: 'coffee_machine' },
      ],
    });
    await expect(createSim({ content, geometry, level: twice, seed: 1 })).rejects.toThrow(
      /objects\[1\].*"phone" is listed twice/,
    );
  });

  it('accepts a level with objects, and hashes them into the journal', async () => {
    const withObjects = createTestLevel({ objects: TEST_OBJECTS });
    const sim = await createSim({ content, geometry, level: withObjects, seed: 1 });
    expect(sim.journal().levelHash).toBe(hashJson(withObjects));
    expect(sim.journal().levelHash).not.toBe(hashJson(level));
  });

  it('refuses a gag the sim does not know', async () => {
    const odd = { ...planning, threats: { outlet: { ...defOf(), gag: 'outlet_hairs' } } };
    await expect(createSim({ content, geometry, level: odd, seed: 1 })).rejects.toThrow(
      /the threat "outlet" has the gag "outlet_hairs", which the sim does not know \(outlet_hair, stairs_slide, table_object_fall\)/,
    );
  });

  it('refuses an anchor that is planned twice, naming the level and the entry', async () => {
    const twice = createTestLevel({
      waves: [
        testWave([OUTLET]),
        testWave([{ def: 'stairs', anchor: 'outlet_01' }], { fromMs: 9000 }),
      ],
    });
    await expect(createSim({ content, geometry, level: twice, seed: 1 })).rejects.toThrow(
      /salon_crawler.*waves\[1\]\.threats\[0\].*the anchor "outlet_01" is already planned by .*waves\[0\]\.threats\[0\]/,
    );
  });

  it('refuses a planned anchor the baby cannot reach from where it starts (D12)', async () => {
    // A closed pocket in the floor (a ring of blocked cells) with an anchor in it.
    const walled = cloneJson(geometry);
    const rows = walled.nav.rows.map((row) => row.split(''));
    for (let r = 14; r <= 20; r++) {
      for (let c = 2; c <= 8; c++) {
        const isRing = r === 14 || r === 20 || c === 2 || c === 8;
        (rows[r] as string[])[c] = isRing ? '0' : '1';
      }
    }
    walled.nav.rows = rows.map((row) => row.join(''));
    walled.anchors.push({ id: 'pocket', positionM: [-2.625, 0, 1.375] });
    const level = createTestLevel({ waves: [testWave([{ def: 'outlet', anchor: 'pocket' }])] });
    await expect(createSim({ content, geometry: walled, level, seed: 1 })).rejects.toThrow(
      /salon_crawler.*waves\[0\]\.threats\[0\].*outlet.*pocket.*cannot reach/,
    );
    // The same level on the open room is fine.
    const open = createTestLevel({ waves: [testWave([OUTLET])] });
    await expect(createSim({ content, geometry, level: open, seed: 1 })).resolves.toBeDefined();
  });

  it('builds the wave plan: the end of each wave, when it closes, and the level duration', async () => {
    const plan = createTestLevel({
      durationMs: 100_000,
      waves: [
        testWave([OUTLET], { maxSimultaneous: 2, gapMinMs: 100, gapMaxMs: 300, lullMs: 3000 }),
        testWave([], { fromMs: 60_000, lullMs: 5000 }),
      ],
    });
    const sim = await createSim({ content, geometry, level: plan, seed: 1 });
    const probe: { level?: StepContext['level'] } = {};
    const spy: System = (_world, ctx) => {
      probe.level = ctx.level;
    };
    const spied = await createSimWithSystems({ content, geometry, level: plan, seed: 1 }, [spy]);
    spied.step();
    expect(probe.level).toMatchObject({
      durationMs: 100_000,
      waves: [
        {
          fromMs: 0,
          endMs: 60_000,
          closesAtMs: 57_000,
          maxSimultaneous: 2,
          gapMinMs: 100,
          gapMaxMs: 300,
        },
        { fromMs: 60_000, endMs: 100_000, closesAtMs: 95_000 },
      ],
      threats: [{ anchorId: 'outlet_01', firstWaveIndex: 0 }],
    });
    expect(sim.world.director).toEqual({ waveIndex: -1, nextAt: 0 });
    expect(sim.world.flow).toEqual({ state: 'playing', enteredAt: 0 });
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
