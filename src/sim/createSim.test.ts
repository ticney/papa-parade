import type { DisruptionDef } from '@content/schemas/disruption';
import { cloneJson, hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  stepN,
  TEST_OBJECTS,
  testPhoneEntry,
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
    const wrong = createTestLevel({
      objects: [{ id: 'kettle', kind: 'coffee_machine', anchor: 'kettle_spot' }],
    });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*objects\[0\].*kettle.*kettle_spot/,
    );
  });

  it('refuses an object id listed twice', async () => {
    const twice = createTestLevel({
      objects: [
        { id: 'phone', kind: 'phone', anchor: 'phone' },
        { id: 'phone', kind: 'phone', anchor: 'coffee_machine' },
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
      /the threat "outlet" has the gag "outlet_hairs", which the sim does not know \(outlet_hair, stairs_slide, table_object_fall, papa_asleep, tissues_everywhere, crayon_scribbles, arms_wail\)/,
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
    expect(sim.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0, mischiefs: 0 });
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

describe('the level’s fatigue and objects (story 1.19)', () => {
  const withGauge = createTestLevel({ gauges: FATIGUE_GAUGES, objects: TEST_OBJECTS });

  it('plans the micro-sleep last, on Papa, from no wave', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])], gauges: FATIGUE_GAUGES }),
      seed: 1,
    });
    expect(sim.world.threats.map((threat) => threat.defId)).toEqual(['outlet', 'papa_microsleep']);
    const { papa } = sim.world;
    expect(sim.world.threats[1]).toMatchObject({
      anchorId: 'papa',
      xM: papa.xM,
      zM: papa.zM,
      state: 'idle',
      waveIndex: -1,
    });
  });

  it('plans no micro-sleep in a level without the fatigue gauge', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(sim.world.threats).toEqual([]);
  });

  it('exposes the objects with their kind and the height of their anchor', async () => {
    const sim = await createSim({ content, geometry, level: withGauge, seed: 1 });
    const phone = geometry.anchors.find((anchor) => anchor.id === 'phone');
    expect(sim.objects.map((object) => [object.id, object.kind])).toEqual([
      ['coffee_machine', 'coffee_machine'],
      ['phone', 'phone'],
    ]);
    expect(sim.objects[1]).toMatchObject({
      xM: phone?.positionM[0],
      yM: phone?.positionM[1],
      zM: phone?.positionM[2],
    });
  });

  it('refuses a micro-sleep def that is not loaded, naming the level and the path', async () => {
    const missing = { ...createTestLevel({ gauges: FATIGUE_GAUGES }), threats: {} };
    await expect(createSim({ content, geometry, level: missing, seed: 1 })).rejects.toThrow(
      /salon_crawler › gauges\.fatigue\.microSleepDef: the threat papa_microsleep is not loaded/,
    );
  });

  it('refuses a micro-sleep def whose target is not papa', async () => {
    const wrong = createTestLevel({ gauges: { fatigue: { microSleepDef: 'outlet' } } });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /gauges\.fatigue\.microSleepDef: the threat "outlet" has target "anchor", but a micro-sleep must have target "papa"/,
    );
  });

  it('refuses a wave that plans a threat whose target is papa', async () => {
    const wrong = createTestLevel({
      waves: [testWave([{ def: 'papa_microsleep', anchor: 'outlet_01' }])],
    });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /waves\[0\]\.threats\[0\]: the threat "papa_microsleep" has target "papa": only the sim spawns it/,
    );
  });

  it('refuses a geometry with an anchor named like the threat that stands on Papa', async () => {
    const odd = {
      ...geometry,
      anchors: [
        ...geometry.anchors,
        { id: 'papa', positionM: [0, 0, 0] as [number, number, number] },
      ],
    } as typeof geometry;
    await expect(
      createSim({ content, geometry: odd, level: createTestLevel(), seed: 1 }),
    ).rejects.toThrow(/an anchor named "papa", which the sim reserves/);
  });

  it('refuses a micro-sleep def whose gag is not papa_asleep', async () => {
    const level = createTestLevel({ gauges: FATIGUE_GAUGES });
    const wrong = {
      ...level,
      threats: { papa_microsleep: { ...level.threats.papa_microsleep, gag: 'outlet_hair' } },
    } as typeof level;
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /gauges\.fatigue\.microSleepDef: the threat "papa_microsleep" has the gag "outlet_hair", but a micro-sleep must have the gag "papa_asleep"/,
    );
  });

  it('refuses a wave that plans a threat whose gag is papa_asleep', async () => {
    const level = createTestLevel({
      waves: [testWave([{ def: 'outlet', anchor: 'outlet_01' }])],
    });
    const wrong = {
      ...level,
      threats: { outlet: { ...level.threats.outlet, gag: 'papa_asleep' } },
    } as typeof level;
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /waves\[0\]\.threats\[0\]: the threat "outlet" has the gag "papa_asleep": only the micro-sleep/,
    );
  });

  describe('a level that carries the baby (story 4.1)', () => {
    const carrying = () => createTestLevel({ gauges: FATIGUE_GAUGES, carry: CARRY });
    const withArmsCry = (patch: Record<string, unknown>) => {
      const base = carrying();
      return {
        ...base,
        threats: { ...base.threats, arms_cry: { ...base.threats.arms_cry, ...patch } },
      } as typeof base;
    };

    it('puts the cry in the arms after the micro-sleep, which keeps its own index', async () => {
      const sim = await createSim({ content, geometry, level: carrying(), seed: 1 });
      expect(sim.world.threats.map((threat) => threat.defId)).toEqual([
        'papa_microsleep',
        'arms_cry',
      ]);
      const onlyCarry = await createSim({
        content,
        geometry,
        level: createTestLevel({ carry: CARRY }),
        seed: 1,
      });
      expect(onlyCarry.world.threats.map((threat) => threat.defId)).toEqual(['arms_cry']);
    });

    it('accepts a carry without a cry in the arms', async () => {
      const sim = await createSim({
        content,
        geometry,
        level: createTestLevel({ carry: {} }),
        seed: 1,
      });
      expect(sim.world.threats).toEqual([]);
    });

    it('refuses a cry in the arms that is not loaded', async () => {
      const base = carrying();
      const wrong = {
        ...base,
        threats: { papa_microsleep: base.threats.papa_microsleep },
      } as typeof base;
      await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
        /carry\.armsCryDef: the threat arms_cry is not loaded/,
      );
    });

    it('refuses a cry in the arms with another target', async () => {
      await expect(
        createSim({ content, geometry, level: withArmsCry({ target: 'anchor' }), seed: 1 }),
      ).rejects.toThrow(
        /carry\.armsCryDef: the threat "arms_cry" has target "anchor", but a cry in the arms must have target "papa"/,
      );
    });

    it('refuses a cry in the arms that ends in papa_asleep, and in a gag the sim does not know', async () => {
      await expect(
        createSim({ content, geometry, level: withArmsCry({ gag: 'papa_asleep' }), seed: 1 }),
      ).rejects.toThrow(
        /carry\.armsCryDef: the threat "arms_cry" has the gag "papa_asleep", which is the micro-sleep's alone/,
      );
      await expect(
        createSim({ content, geometry, level: withArmsCry({ gag: 'arms_wails' }), seed: 1 }),
      ).rejects.toThrow(
        /carry\.armsCryDef: the threat "arms_cry" has the gag "arms_wails", which the sim does not know/,
      );
    });

    it('refuses a cry in the arms that asks for Firmness', async () => {
      await expect(
        createSim({
          content,
          geometry,
          level: withArmsCry({ response: 'firm', holdUntilMs: 1000 }),
          seed: 1,
        }),
      ).rejects.toThrow(/carry\.armsCryDef: the threat "arms_cry" has the response "firm"/);
    });

    it('refuses a level that carries with no safe zone in the room', async () => {
      const bare = {
        ...geometry,
        zones: geometry.zones.filter((zone) => zone.kind !== 'safe'),
      } as typeof geometry;
      await expect(
        createSim({ content, geometry: bare, level: carrying(), seed: 1 }),
      ).rejects.toThrow(/carry: the level carries the baby, but salon_crawler has no safe zone/);
      // A level that does not carry does not need one.
      const sim = await createSim({ content, geometry: bare, level: createTestLevel(), seed: 1 });
      expect(sim.world.threats).toEqual([]);
    });

    it('refuses a safe zone no one can stand in', async () => {
      const walled = {
        ...geometry,
        zones: geometry.zones.map((zone) =>
          zone.kind === 'safe'
            ? { ...zone, centerM: [-6, 0.3, 1.6] as [number, number, number] }
            : zone,
        ),
      } as typeof geometry;
      await expect(
        createSim({ content, geometry: walled, level: carrying(), seed: 1 }),
      ).rejects.toThrow(/the safe zone playpen has no open cell/);
    });

    it('refuses a wave that plans the cry in the arms', async () => {
      const wrong = createTestLevel({
        waves: [testWave([{ def: 'arms_cry', anchor: 'outlet_01' }])],
        carry: CARRY,
      });
      await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
        /waves\[0\]\.threats\[0\]: the threat "arms_cry" has target "papa": only the sim spawns it/,
      );
    });
  });

  it('refuses an object kind the sim has no action for', async () => {
    const odd = createTestLevel({
      objects: [{ id: 'kettle', kind: 'kettle' as never, anchor: 'phone' }],
    });
    await expect(createSim({ content, geometry, level: odd, seed: 1 })).rejects.toThrow(
      /objects\[0\]: the object "kettle" has the kind "kettle", which the sim has no action for \(coffee_machine, phone, toilet\)/,
    );
  });
});

describe('the disruptions it plans (story 1.20)', () => {
  const phoneWave = (atMs = 125_000) => [testWave([], { disruptions: [testPhoneEntry(atMs)] })];

  it('plans one pending instance per wave entry, index-aligned with the level, in wave order', async () => {
    const planned = createTestLevel({
      waves: [
        testWave([OUTLET]),
        testWave([], { fromMs: 60_000, disruptions: [testPhoneEntry(61_000)] }),
      ],
      objects: TEST_OBJECTS,
    });
    const sim = await createSim({ content, geometry, level: planned, seed: 1 });
    expect(sim.world.disruptions).toEqual([
      { state: 'pending', enteredAt: 0, untilAt: 0, nextRingingAt: 0 },
    ]);
  });

  it('plans none for a level that plans none, and hashes the disruptions into the journal', async () => {
    const quiet = await createSim({ content, geometry, level, seed: 1 });
    expect(quiet.world.disruptions).toEqual([]);
    const planned = createTestLevel({ waves: phoneWave(), objects: TEST_OBJECTS });
    const sim = await createSim({ content, geometry, level: planned, seed: 1 });
    expect(sim.journal().levelHash).toBe(hashJson(planned));
    expect(sim.journal().levelHash).not.toBe(
      hashJson(createTestLevel({ waves: [testWave([])], objects: TEST_OBJECTS })),
    );
  });

  it('refuses a disruption whose def is not loaded, naming the level and the entry', async () => {
    const planned = createTestLevel({ waves: phoneWave(), objects: TEST_OBJECTS });
    const unloaded = { ...planned, disruptions: {} };
    await expect(createSim({ content, geometry, level: unloaded, seed: 1 })).rejects.toThrow(
      /salon_crawler › waves\[0\]\.disruptions\[0\]: the disruption phone is not loaded/,
    );
  });

  it('refuses a disruption at an object the level does not have', async () => {
    const planned = createTestLevel({ waves: phoneWave() });
    await expect(createSim({ content, geometry, level: planned, seed: 1 })).rejects.toThrow(
      /waves\[0\]\.disruptions\[0\]: the object "phone" is not in the level objects/,
    );
  });

  it('refuses a def whose kind is not the kind of its object, naming both', async () => {
    const planned = createTestLevel({
      waves: phoneWave(),
      objects: [{ id: 'phone', kind: 'coffee_machine', anchor: 'phone' }],
    });
    await expect(createSim({ content, geometry, level: planned, seed: 1 })).rejects.toThrow(
      /the disruption "phone" has the kind "phone", but the object "phone" has the kind "coffee_machine"/,
    );
  });

  it.each([
    ['negative', -1, 0],
    ['in the next wave', 60_000, 0],
    ['before its wave', 59_999, 1],
    ['past the end of the level', 10_000_000, 1],
  ])('refuses an atMs that is %s, built without the schema', async (_name, atMs, waveIndex) => {
    // Two waves (0 to 60 s, then 60 s to the end): the phone is planned in one of them.
    const waves = [testWave([]), testWave([], { fromMs: 60_000 })];
    waves[waveIndex] = testWave([], {
      ...(waveIndex === 1 ? { fromMs: 60_000 } : {}),
      disruptions: [testPhoneEntry(atMs)],
    });
    const planned = createTestLevel({ waves, objects: TEST_OBJECTS });
    await expect(createSim({ content, geometry, level: planned, seed: 1 })).rejects.toThrow(
      new RegExp(
        `waves\\[${waveIndex}\\]\\.disruptions\\[0\\]: atMs \\(.*\\) must be inside its wave`,
      ),
    );
  });

  it('refuses a disruption whose kind the sim has no handler for', async () => {
    const planned = createTestLevel({
      waves: phoneWave(),
      objects: [{ id: 'phone', kind: 'coffee_machine', anchor: 'phone' }],
    });
    const def = planned.disruptions.phone as DisruptionDef;
    const odd = { ...planned, disruptions: { phone: { ...def, kind: 'coffee_machine' } } };
    await expect(
      createSim({ content, geometry, level: odd as unknown as typeof planned, seed: 1 }),
    ).rejects.toThrow(
      /the disruption "phone" has the kind "coffee_machine", which the sim does not know/,
    );
  });

  it('refuses an object planned by two disruptions', async () => {
    const twice = createTestLevel({
      waves: [
        testWave([], { disruptions: [testPhoneEntry(1000)] }),
        testWave([], { fromMs: 60_000, disruptions: [testPhoneEntry(61_000)] }),
      ],
      objects: TEST_OBJECTS,
    });
    await expect(createSim({ content, geometry, level: twice, seed: 1 })).rejects.toThrow(
      /waves\[1\]\.disruptions\[0\]: the object "phone" is already planned by another disruption/,
    );
  });
});

describe('the hidden-zone threat the level plans (story 1.21)', () => {
  const silenceLevel = createTestLevel({ waves: [testWave([SILENCE])] });

  it('stands the silence on the open baby cell of its zone nearest the centre, inside the box', async () => {
    const sim = await createSim({ content, geometry, level: silenceLevel, seed: 1 });
    const threat = sim.world.threats[0];
    const zone = geometry.zones.find((candidate) => candidate.id === 'behind_sofa');
    if (zone === undefined || threat === undefined) throw new Error('no zone or threat');
    expect(threat).toMatchObject({ defId: 'silence_mischief', anchorId: 'behind_sofa' });
    expect(Math.abs(threat.xM - zone.centerM[0])).toBeLessThanOrEqual(zone.halfExtentsM[0]);
    expect(Math.abs(threat.zM - zone.centerM[2])).toBeLessThanOrEqual(zone.halfExtentsM[2]);
  });

  it('refuses a hidden-zone threat planned at an anchor, naming the level, the entry and the def', async () => {
    const wrong = createTestLevel({
      waves: [testWave([{ def: 'silence_mischief', anchor: 'outlet_01' }])],
    });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*waves\[0\]\.threats\[0\].*"silence_mischief".*"outlet_01" must be a hidden zone/,
    );
  });

  it('refuses an anchored threat planned at a zone: a zone is not an anchor', async () => {
    const wrong = createTestLevel({
      waves: [testWave([{ def: 'outlet', anchor: 'behind_sofa' }])],
    });
    await expect(createSim({ content, geometry, level: wrong, seed: 1 })).rejects.toThrow(
      /salon_crawler.*waves\[0\]\.threats\[0\].*outlet.*behind_sofa.*does not have/,
    );
  });

  it('refuses a zone that is not hidden', async () => {
    const odd = cloneJson(geometry);
    for (const zone of odd.zones) zone.kind = 'safe';
    await expect(
      createSim({ content, geometry: odd, level: silenceLevel, seed: 1 }),
    ).rejects.toThrow(/behind_sofa.*must be a hidden zone/);
  });

  it('refuses a surprise gag the sim does not know, or papa_asleep, in the wording of content:check', async () => {
    const def = silenceLevel.threats.silence_mischief;
    if (def?.target !== 'hiddenZone') throw new Error('no silence');
    const unknown = {
      ...silenceLevel,
      threats: { silence_mischief: { ...def, surpriseGags: ['tissues_everywhere', 'glitter'] } },
    };
    await expect(createSim({ content, geometry, level: unknown, seed: 1 })).rejects.toThrow(
      /the threat "silence_mischief" has the gag "glitter", which the sim does not know/,
    );
    const sleepy = {
      ...silenceLevel,
      threats: { silence_mischief: { ...def, surpriseGags: ['papa_asleep'] } },
    };
    await expect(createSim({ content, geometry, level: sleepy, seed: 1 })).rejects.toThrow(
      /the threat "silence_mischief" has the gag "papa_asleep": only the micro-sleep/,
    );
  });

  it('refuses a zone where the baby has no open cell, or Papa has none', async () => {
    const zone = geometry.zones.find((candidate) => candidate.id === 'behind_sofa');
    if (zone === undefined) throw new Error('no zone');
    const closeBox = (walled: typeof geometry) => {
      const rows = walled.nav.rows.map((row) => row.split(''));
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < (rows[r] as string[]).length; c++) {
          const x = walled.nav.originM[0] + (c + 0.5) * walled.cellM;
          const z = walled.nav.originM[1] + (r + 0.5) * walled.cellM;
          if (
            Math.abs(x - zone.centerM[0]) <= zone.halfExtentsM[0] + 0.5 &&
            Math.abs(z - zone.centerM[2]) <= zone.halfExtentsM[2] + 0.5
          ) {
            (rows[r] as string[])[c] = '0';
          }
        }
      }
      walled.nav.rows = rows.map((row) => row.join(''));
      return walled;
    };
    await expect(
      createSim({ content, geometry: closeBox(cloneJson(geometry)), level: silenceLevel, seed: 1 }),
    ).rejects.toThrow(/hidden zone behind_sofa, where the baby has no open cell/);
    // A baby that fits where a fat Papa does not: the zone is a narrow gap behind the sofa, so a
    // Papa wide enough has no cell in it while the baby still has one.
    const messages: string[] = [];
    for (const papaRadiusM of [0.3, 0.4, 0.5, 0.6, 0.8]) {
      const fat = {
        ...content,
        feel: { ...content.feel, movement: { ...content.feel.movement, papaRadiusM } },
      };
      try {
        await createSim({ content: fat, geometry, level: silenceLevel, seed: 1 });
      } catch (cause) {
        messages.push(String(cause));
      }
    }
    expect(
      messages.some((message) =>
        /hidden zone behind_sofa, where Papa has no open cell/.test(message),
      ),
    ).toBe(true);
  });

  it('plans nothing it cannot hold when the level has no silence: the same world slices at creation', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(sim.world.silence).toEqual({ threatId: null, zoneEnteredAt: null, startedAt: null });
    expect(sim.world.mess.mischiefs).toBe(0);
  });
});
