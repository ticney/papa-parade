import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
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
import { PARRY_RELEASE_AFTER_MS } from '../../tests/support/timeEffects.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import type { SimEvent } from './events.ts';
import { SYSTEMS } from './step.ts';
import { THREAT_STATES } from './threats/threatFsm.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const level = createTestLevel();
const scale = (t: number, value: number) =>
  ({ type: 'SetTimeScale', t: asSimMs(t), scale: value }) as const;

describe('snapshot / restore', () => {
  async function liveGame() {
    const a = await createSim({ content, geometry, level, seed: 5 });
    const events: SimEvent[] = [];
    const collect = () => {
      for (const event of a.drainEvents()) events.push(event);
    };
    a.enqueue(scale(100, 0.5));
    a.enqueue(scale(1205, 0.8)); // between two step ends, pending at the snapshot
    a.enqueue(scale(1500, 0.3));
    stepN(a, 100);
    a.enqueue(scale(950, 0.9)); // late, enqueued before the snapshot
    stepN(a, 20); // sim time 1200
    collect();
    const snapshot = a.snapshot();
    const eventsBeforeSnapshot = events.length;
    stepN(a, 10); // sim time 1300
    a.enqueue(scale(1100, 0.6)); // late AND enqueued after the snapshot: applyAt 1310
    stepN(a, 120); // sim time 2500
    collect();
    return { a, snapshot, events, eventsBeforeSnapshot };
  }

  it('restores a snapshot with the journal tail: same final state, events and journal', async () => {
    const { a, snapshot, events, eventsBeforeSnapshot } = await liveGame();
    const tail = a.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    expect(tail.map((e) => e.command.t)).toEqual([1205, 1500, 1100]);
    expect(tail.map((e) => e.applyAt)).toEqual([1210, 1500, 1310]);

    const b = await createSim({ content, geometry, level, seed: 5 });
    b.restore(snapshot, tail);
    expect(b.world.time.sim).toBe(1200);
    stepN(b, 130);

    expect(b.world).toEqual(a.world);
    expect(hashJson(b.world)).toBe(hashJson(a.world));
    expect(b.drainEvents()).toEqual(events.slice(eventsBeforeSnapshot));
    expect(b.journal()).toEqual({ ...a.journal(), startSimMs: 1200, entries: tail });
  });

  it('re-enqueueing through enqueue() would apply the late command too early', async () => {
    const { a, snapshot, events, eventsBeforeSnapshot } = await liveGame();
    const tail = a.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    const b = await createSim({ content, geometry, level, seed: 5 });
    b.restore(snapshot);
    for (const entry of tail) b.enqueue(entry.command);
    stepN(b, 130);
    expect(b.drainEvents()).not.toEqual(events.slice(eventsBeforeSnapshot));
  });

  it('marks the journal as starting at the snapshot time, and keeps its seed and feel', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    stepN(sim, 7);
    const snapshot = sim.snapshot();
    expect(sim.journal().startSimMs).toBe(0);
    sim.restore(snapshot);
    expect(sim.journal()).toMatchObject({
      seed: 5,
      feelHash: hashJson(content.feel),
      startSimMs: 70,
      entries: [],
    });
  });

  it('refuses a snapshot of another seed or feel, a malformed world and an already applied tail', async () => {
    const other = await createSim({ content, geometry, level, seed: 6 });
    const sim = await createSim({ content, geometry, level, seed: 5 });
    expect(() => sim.restore(other.snapshot())).toThrow(/another seed/);
    expect(() => sim.restore({ ...sim.snapshot(), feelHash: 'x' })).toThrow(/another feel/);
    expect(() => sim.restore({ ...sim.snapshot(), geometryHash: 'x' })).toThrow(
      /another level geometry/,
    );
    for (const world of [{}, { ...sim.world, time: { sim: 'a', scale: 1 } }, null]) {
      expect(() => sim.restore({ ...sim.snapshot(), world: world as never })).toThrow(
        /invalid snapshot world/,
      );
    }
    stepN(sim, 10);
    const late = { applyAt: asSimMs(100), command: scale(100, 0.5) };
    expect(() => sim.restore(sim.snapshot(), [late])).toThrow(/already applied/);
    expect(() =>
      sim.restore(sim.snapshot(), [{ applyAt: asSimMs(105), command: late.command }]),
    ).toThrow(/step grid/);
  });

  it('restoring a sim built from a journal drops its pre-loaded entries unless they are passed as the tail', async () => {
    const source = await createSim({ content, geometry, level, seed: 5 });
    source.enqueue(scale(500, 0.5));
    const journal = source.journal();
    const replay = await createSim({ content, geometry, level, seed: 5, journal });
    const snapshot = replay.snapshot();
    replay.restore(snapshot);
    stepN(replay, 60);
    expect(replay.timeScale).toBe(1);
    replay.restore(snapshot, journal.entries);
    stepN(replay, 60);
    expect(replay.timeScale).toBe(0.5);
  });

  it('is a deep copy in both directions', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    stepN(sim, 10);
    const snapshot = sim.snapshot();
    stepN(sim, 10);
    expect(snapshot.world.time.sim).toBe(100);
    const other = await createSim({ content, geometry, level, seed: 5 });
    other.restore(snapshot);
    (snapshot.world as { nextId: number }).nextId = 999;
    expect(other.world.nextId).not.toBe(999);
    stepN(other, 1);
    expect(snapshot.world.time.sim).toBe(100);
  });

  it('clears pending commands, events, freeze and the journal entries', async () => {
    const requestFreeze: System = (_world, ctx) => ctx.requestFreezeRealMs(80);
    const emit: System = (world, ctx) => {
      ctx.events.push({ type: 'TimeScaleChanged', t: world.time.sim, from: 1, to: 1 });
    };
    const sim = await createSimWithSystems({ content, geometry, level, seed: 5 }, [
      ...SYSTEMS,
      requestFreeze,
      emit,
    ]);
    const snapshot = sim.snapshot();
    sim.enqueue(scale(500, 0.5));
    stepN(sim, 3);
    expect(sim.freezeRealMs).toBe(80);

    sim.restore(snapshot);
    expect(sim.freezeRealMs).toBe(0);
    expect(sim.drainEvents()).toHaveLength(0);
    expect(sim.journal().entries).toEqual([]);
    expect(sim.journal().seed).toBe(5);
    stepN(sim, 60);
    expect(sim.timeScale).toBe(1); // the pending command did not survive
  });

  it('stamps events with the restored time (ctx.t follows the new world)', async () => {
    const lenient = await createSim({ content, geometry, level, seed: 5, strictInvariants: false });
    stepN(lenient, 10);
    const snapshot = lenient.snapshot();
    stepN(lenient, 40);
    lenient.restore(snapshot);
    lenient.enqueue(scale(0, 5));
    lenient.step();
    expect(lenient.drainEvents()).toContainEqual({
      type: 'InvariantViolated',
      t: 110,
      name: 'time.scale',
      value: 5,
    });
  });

  it('restores a snapshot taken mid-walk (path and direction) to the same world as the live run', async () => {
    for (const script of ['path', 'direction'] as const) {
      const live = await createSim({ content, geometry, level, seed: 5 });
      if (script === 'path') live.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: 0.5, zM: -2.6 });
      else live.enqueue({ type: 'Move', t: asSimMs(0), dirX: -1, dirZ: -1 });
      stepN(live, 80);
      expect(live.world.papa.state).toBe(script === 'path' ? 'walkPath' : 'walkDir');
      const snapshot = live.snapshot();
      live.enqueue({ type: 'MoveStop', t: asSimMs(900) });
      live.enqueue({ type: 'TapFloor', t: asSimMs(1000), xM: 2, zM: 1 });
      const tail = live.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
      stepN(live, 300);
      const restored = await createSim({ content, geometry, level, seed: 5 });
      restored.restore(snapshot, tail);
      stepN(restored, 300);
      expect(restored.world).toEqual(live.world);
      expect(hashJson(restored.world)).toBe(hashJson(live.world));
    }
  });

  it('refuses a snapshot whose papa slice is malformed', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    const good = sim.snapshot();
    const broken: [string, (papa: Record<string, unknown>) => void][] = [
      [
        'state',
        (papa) => {
          papa.state = 'flying';
        },
      ],
      [
        'xM',
        (papa) => {
          papa.xM = Number.NaN;
        },
      ],
      [
        'path',
        (papa) => {
          papa.path = [1];
        },
      ],
      [
        'path',
        (papa) => {
          papa.path = [1, 'a'];
        },
      ],
      [
        'pathIndex',
        (papa) => {
          papa.pathIndex = 3;
        },
      ],
      [
        'isBlocked',
        (papa) => {
          papa.isBlocked = 1;
        },
      ],
      // The state and its data must agree.
      [
        'dir',
        (papa) => {
          papa.state = 'walkDir';
        },
      ],
      [
        'dir',
        (papa) => {
          papa.dirX = 1;
        },
      ],
      [
        'path',
        (papa) => {
          papa.state = 'walkPath';
        },
      ],
      [
        'path',
        (papa) => {
          papa.path = [1, 1];
        },
      ],
      [
        'heading',
        (papa) => {
          papa.headingX = 0;
          papa.headingZ = 0;
        },
      ],
    ];
    for (const [name, damage] of broken) {
      const snapshot = JSON.parse(JSON.stringify(good)) as typeof good;
      damage(snapshot.world.papa as unknown as Record<string, unknown>);
      expect(() => sim.restore(snapshot)).toThrow(new RegExp(`world\\.papa\\.${name}`));
    }
    const noPapa = JSON.parse(JSON.stringify(good)) as typeof good;
    delete (noPapa.world as unknown as Record<string, unknown>).papa;
    expect(() => sim.restore(noPapa)).toThrow(/world\.papa is missing/);
  });

  it('restores a snapshot taken mid-wander (path half done) to the same world as the live run', async () => {
    const live = await createSim({ content, geometry, level, seed: 5 });
    // Past the first babble, then until the baby is wandering with waypoints behind it.
    for (let i = 0; i < 2000 && live.world.baby.state !== 'wander'; i++) live.step();
    expect(live.world.baby.state).toBe('wander');
    // A straight wander has a single waypoint (its goal): go on until one with a corner is half done.
    for (
      let i = 0;
      i < 20000 && !(live.world.baby.state === 'wander' && live.world.baby.pathIndex > 0);
      i++
    )
      live.step();
    expect(live.world.baby.state).toBe('wander');
    const snapshot = live.snapshot();
    // Path half done: some waypoints behind it, some still ahead.
    expect(snapshot.world.baby.pathIndex).toBeGreaterThan(0);
    expect(snapshot.world.baby.pathIndex).toBeLessThan(snapshot.world.baby.path.length);
    live.enqueue({ type: 'TapFloor', t: asSimMs(live.world.time.sim + 500), xM: 2, zM: 1 });
    const tail = live.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    stepN(live, 3000);
    live.drainEvents();

    const restored = await createSim({ content, geometry, level, seed: 5 });
    restored.restore(snapshot, tail);
    stepN(restored, 3000);
    expect(restored.world).toEqual(live.world);
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
  });

  it('refuses a snapshot whose baby slice is malformed or missing', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    stepN(sim, 200); // wandering, so that the path rules apply
    expect(sim.world.baby.state).toBe('wander');
    const good = sim.snapshot();
    const broken: [string, (baby: Record<string, unknown>) => void][] = [
      [
        'state',
        (baby) => {
          baby.state = 'sleep';
        },
      ],
      [
        'xM',
        (baby) => {
          baby.xM = Number.NaN;
        },
      ],
      [
        'wanderAt',
        (baby) => {
          baby.wanderAt = 'soon';
        },
      ],
      [
        'path',
        (baby) => {
          baby.path = [1];
        },
      ],
      [
        'pathIndex',
        (baby) => {
          baby.pathIndex = 99;
        },
      ],
      [
        'babbling',
        (baby) => {
          baby.babbling = 1;
        },
      ],
      // The state and its data must agree.
      [
        'path',
        (baby) => {
          baby.path = [];
        },
      ],
      [
        'path',
        (baby) => {
          baby.state = 'babble';
        },
      ],
      [
        'heading',
        (baby) => {
          baby.headingX = 0;
          baby.headingZ = 0;
        },
      ],
      [
        'gaze',
        (baby) => {
          baby.gazeX = 2;
        },
      ],
    ];
    for (const [name, damage] of broken) {
      const snapshot = JSON.parse(JSON.stringify(good)) as typeof good;
      damage(snapshot.world.baby as unknown as Record<string, unknown>);
      expect(() => sim.restore(snapshot)).toThrow(new RegExp(`world\\.baby\\.${name}`));
    }
    const noBaby = JSON.parse(JSON.stringify(good)) as typeof good;
    delete (noBaby.world as unknown as Record<string, unknown>).baby;
    expect(() => sim.restore(noBaby)).toThrow(/world\.baby is missing/);
  });

  it('refuses an unknown snapshot version', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    const snapshot = sim.snapshot();
    expect(() => sim.restore({ ...snapshot, version: 1 as 9 })).toThrow(/version/);
    // Version 3 predates the base scale and the slow-mos (story 1.14).
    expect(() => sim.restore({ ...snapshot, version: 3 as 9 })).toThrow(/version/);
    // Version 4 has no Rapier world (story 1.15).
    expect(() => sim.restore({ ...snapshot, version: 4 as 9 })).toThrow(/version 4/);
    // Version 5 has no director, flow or wave index (story 1.18).
    expect(() => sim.restore({ ...snapshot, version: 5 as 9 })).toThrow(/version 5/);
    // Version 6 has no gauges, no Papa busy state and no `objectId` (story 1.19).
    expect(() => sim.restore({ ...snapshot, version: 6 as 9 })).toThrow(/version 6/);
    // Version 7 has no disruptions and no `onPhone` state (story 1.20).
    expect(() => sim.restore({ ...snapshot, version: 7 as 9 })).toThrow(/version 7/);
    // Version 8 has no silence, no `mischiefs` and no hidden state (story 1.21).
    expect(() => sim.restore({ ...snapshot, version: 8 as 9 })).toThrow(/version 8/);
  });

  it('refuses a snapshot of another level', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    expect(() => sim.restore({ ...sim.snapshot(), levelHash: 'x' })).toThrow(/another level$/);
    const planning = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])] }),
      seed: 5,
    });
    expect(() => sim.restore(planning.snapshot())).toThrow(/another level$/);
  });
});

describe('snapshot / restore with a threat', () => {
  const planned = createTestLevel({ waves: [testWave([OUTLET])] });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });
  const press = (t: number) => ({ type: 'PressThreat', t: asSimMs(t), threatId: 1 }) as const;

  it('restores a snapshot taken mid-telegraph (threat telegraph, baby approach, Papa glide) to the uninterrupted hash', async () => {
    const live = await newSim();
    // The telegraph is at 10, the window opens at 1210: press early in the buffer, mid-glide.
    live.enqueue(press(1100));
    live.enqueue({ type: 'Release', t: asSimMs(1130) });
    stepN(live, 111); // 1110: the press (1100) is pending, Papa is gliding
    live.drainEvents();
    const snapshot = live.snapshot();
    expect(snapshot.world.threats[0]).toMatchObject({ state: 'telegraph', press: { t: 1100 } });
    expect(snapshot.world.baby.state).toBe('approach');
    expect(snapshot.world.papa.state).toBe('glide');
    expect(snapshot.world.papa.glide).not.toBeNull();
    const tail = live.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    expect(tail.map((e) => e.command.type)).toEqual(['Release']);
    stepN(live, 700);
    const liveAfter = [...live.drainEvents()];
    expect(liveAfter.map((event) => event.type)).toContain('ResponseResolved');
    const restored = await newSim();
    restored.restore(snapshot, tail);
    stepN(restored, 700);
    expect(restored.world).toEqual(live.world);
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
    expect(restored.drainEvents()).toEqual(liveAfter);
  });

  it('keeps World plain data with a threat in every state', async () => {
    const sim = await newSim();
    for (let i = 0; i < 1000; i++) {
      sim.step();
      expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    }
    // Unanswered: idle, telegraph, windowOpen, gag. Answered (a Parry in the window): resolved too.
    const states = new Set<string>();
    const unanswered = await newSim();
    for (let i = 0; i < 3000; i++) {
      unanswered.step();
      states.add(unanswered.world.threats[0]?.state ?? '');
    }
    const answered = await newSim();
    answered.enqueue(press(1220));
    answered.enqueue({ type: 'Release', t: asSimMs(1250) });
    for (let i = 0; i < 300; i++) {
      answered.step();
      expect(JSON.parse(JSON.stringify(answered.world))).toEqual(answered.world);
      states.add(answered.world.threats[0]?.state ?? '');
    }
    // The outlet is never hidden: only a silence is (see the silence tests below).
    expect([...states].sort()).toEqual([...THREAT_STATES].filter((s) => s !== 'hidden').sort());
  });

  it('refuses a snapshot whose threats are malformed', async () => {
    const sim = await newSim();
    stepN(sim, 100); // telegraph, with a window
    const good = sim.snapshot();
    expect(good.world.threats[0]?.state).toBe('telegraph');
    const broken: [string, (threat: Record<string, unknown>) => void, RegExp][] = [
      [
        'state',
        (threat) => {
          threat.state = 'sleeping';
        },
        /world\.threats\[0\]\.state/,
      ],
      [
        'id',
        (threat) => {
          threat.id = 1.5;
        },
        /world\.threats\[0\]\.id/,
      ],
      [
        'defId',
        (threat) => {
          threat.defId = 3;
        },
        /world\.threats\[0\]\.defId/,
      ],
      [
        'xM',
        (threat) => {
          threat.xM = Number.NaN;
        },
        /world\.threats\[0\]\.xM/,
      ],
      [
        'windowOpenAt',
        (threat) => {
          threat.windowOpenAt = 'x';
        },
        /world\.threats\[0\]\.windowOpenAt/,
      ],
      [
        'a telegraph without window',
        (threat) => {
          threat.responseWindow = null;
        },
        /responseWindow/,
      ],
      [
        'a window field',
        (threat) => {
          (threat.responseWindow as Record<string, unknown>).bufferMs = 'x';
        },
        /responseWindow\.bufferMs/,
      ],
      [
        'a window that is not an object',
        (threat) => {
          threat.responseWindow = 4;
        },
        /responseWindow/,
      ],
      [
        'an idle threat with a window',
        (threat) => {
          threat.state = 'idle';
        },
        /responseWindow/,
      ],
      [
        'a press on a threat that has none to carry',
        (threat) => {
          threat.state = 'resolved';
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: null };
        },
        /world\.threats\[0\]\.press/,
      ],
      [
        'a press quality',
        (threat) => {
          threat.press = { t: 1, quality: 'fail', offsetMs: 0, releasedAt: null };
        },
        /press\.quality/,
      ],
      [
        'a press time',
        (threat) => {
          threat.press = { t: 'x', quality: 'perfect', offsetMs: 0, releasedAt: null };
        },
        /press\.t/,
      ],
      [
        'a press offset',
        (threat) => {
          threat.press = { t: 1, quality: 'perfect', offsetMs: null, releasedAt: null };
        },
        /press\.offsetMs/,
      ],
      [
        'a press release',
        (threat) => {
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: 'x' };
        },
        /press\.releasedAt/,
      ],
      [
        'a press that is not an object',
        (threat) => {
          threat.press = 7;
        },
        /world\.threats\[0\]\.press/,
      ],
    ];
    for (const [name, change, message] of broken) {
      const copy = JSON.parse(JSON.stringify(good)) as typeof good;
      change(copy.world.threats[0] as unknown as Record<string, unknown>);
      expect(() => sim.restore(copy), name).toThrow(message);
    }
    const notAList = JSON.parse(JSON.stringify(good)) as typeof good;
    (notAList.world as unknown as Record<string, unknown>).threats = {};
    expect(() => sim.restore(notAList)).toThrow(/world\.threats/);
    const notAThreat = JSON.parse(JSON.stringify(good)) as typeof good;
    (notAThreat.world as unknown as { threats: unknown[] }).threats = [null];
    expect(() => sim.restore(notAThreat)).toThrow(/world\.threats\[0\]/);
  });

  it('refuses a windowOpen threat without its window, and an open window without one', async () => {
    const sim = await newSim();
    stepN(sim, 125);
    const good = sim.snapshot();
    expect(good.world.threats[0]?.state).toBe('windowOpen');
    const copy = JSON.parse(JSON.stringify(good)) as typeof good;
    (copy.world.threats[0] as unknown as Record<string, unknown>).responseWindow = null;
    expect(() => sim.restore(copy)).toThrow(/responseWindow/);
  });

  it('refuses a Papa in glide with no glide, a glide without the state, and a glide with a bad field', async () => {
    const sim = await newSim();
    sim.enqueue(press(300));
    stepN(sim, 40);
    expect(sim.world.papa.state).toBe('glide');
    const good = sim.snapshot();
    const mutate = (change: (papa: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(good)) as typeof good;
      change(copy.world.papa as unknown as Record<string, unknown>);
      return copy;
    };
    expect(() =>
      sim.restore(
        mutate((papa) => {
          papa.glide = null;
        }),
      ),
    ).toThrow(/world\.papa\.glide/);
    expect(() =>
      sim.restore(
        mutate((papa) => {
          papa.state = 'idle';
          papa.path = [];
        }),
      ),
    ).toThrow(/world\.papa\.glide/);
    expect(() =>
      sim.restore(
        mutate((papa) => {
          papa.glide = 'x';
        }),
      ),
    ).toThrow(/world\.papa\.glide/);
    expect(() =>
      sim.restore(
        mutate((papa) => {
          (papa.glide as Record<string, unknown>).threatId = 0.5;
        }),
      ),
    ).toThrow(/glide\.threatId/);
    expect(() =>
      sim.restore(
        mutate((papa) => {
          (papa.glide as Record<string, unknown>).arriveAt = 'x';
        }),
      ),
    ).toThrow(/glide\.arriveAt/);
    // An idle Papa with a glide is refused the same way.
    const idle = await createSim({ content, geometry, level, seed: 5 });
    const idleGood = idle.snapshot();
    const withGlide = JSON.parse(JSON.stringify(idleGood)) as typeof idleGood;
    (withGlide.world.papa as unknown as Record<string, unknown>).glide = {
      threatId: 1,
      toXM: 0,
      toZM: 0,
      startedAt: 0,
      arriveAt: 0,
      speedMps: 1,
    };
    expect(() => idle.restore(withGlide)).toThrow(/world\.papa\.glide/);
  });

  it('refuses a glide that cannot end, and a snapshot whose threats are not the level’s', async () => {
    const sim = await newSim();
    sim.enqueue(press(300));
    stepN(sim, 40);
    expect(sim.world.papa.state).toBe('glide');
    const good = sim.snapshot();
    const copyOf = () => JSON.parse(JSON.stringify(good)) as typeof good;
    const glideOf = (snapshot: typeof good) =>
      snapshot.world.papa.glide as unknown as Record<string, unknown>;

    const slow = copyOf();
    glideOf(slow).speedMps = 0;
    expect(() => sim.restore(slow)).toThrow(/glide\.speedMps/);
    const backwards = copyOf();
    glideOf(backwards).arriveAt = (glideOf(backwards).startedAt as number) - 1;
    expect(() => sim.restore(backwards)).toThrow(/glide\.arriveAt/);
    const pathless = copyOf();
    pathless.world.papa.path = [];
    pathless.world.papa.pathIndex = 0;
    expect(() => sim.restore(pathless)).toThrow(/world\.papa\.path/);

    const extra = copyOf();
    extra.world.threats.push({ ...(extra.world.threats[0] as object), id: 7 } as never);
    expect(() => sim.restore(extra)).toThrow(/world\.threats/);
    const missing = copyOf();
    missing.world.threats.length = 0;
    expect(() => sim.restore(missing)).toThrow(/world\.threats/);
    const otherDef = copyOf();
    (otherDef.world.threats[0] as unknown as Record<string, unknown>).defId = 'sofa';
    expect(() => sim.restore(otherDef)).toThrow(/threats\[0\]\.defId/);
    const aheadOfNextId = copyOf();
    (aheadOfNextId.world.threats[0] as unknown as Record<string, unknown>).id =
      aheadOfNextId.world.nextId;
    expect(() => sim.restore(aheadOfNextId)).toThrow(/threats\[0\]\.id/);
  });

  it('refuses a baby whose target is no threat, who has one while free, or who crawls while not approaching', async () => {
    const sim = await newSim();
    stepN(sim, 5); // targetLocked
    expect(sim.world.baby.state).toBe('targetLocked');
    const good = sim.snapshot();
    const mutate = (change: (baby: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(good)) as typeof good;
      change(copy.world.baby as unknown as Record<string, unknown>);
      return copy;
    };
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.targetThreatId = 99;
        }),
      ),
    ).toThrow(/world\.baby\.targetThreatId/);
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.approachSpeedMps = 0.5;
        }),
      ),
    ).toThrow(/world\.baby\.approachSpeedMps/);
    const free = await createSim({ content, geometry, level, seed: 5 });
    const freeGood = free.snapshot();
    const withTarget = JSON.parse(JSON.stringify(freeGood)) as typeof freeGood;
    (withTarget.world.baby as unknown as Record<string, unknown>).targetThreatId = 1;
    expect(() => free.restore(withTarget)).toThrow(/world\.baby\.targetThreatId/);
  });

  it('refuses a baby that locks on nothing, or whose approach speed is not a speed', async () => {
    const sim = await newSim();
    stepN(sim, 5); // targetLocked
    expect(sim.world.baby.state).toBe('targetLocked');
    const good = sim.snapshot();
    const mutate = (change: (baby: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(good)) as typeof good;
      change(copy.world.baby as unknown as Record<string, unknown>);
      return copy;
    };
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.targetThreatId = null;
        }),
      ),
    ).toThrow(/world\.baby\.targetThreatId/);
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.targetThreatId = 'x';
        }),
      ),
    ).toThrow(/world\.baby\.targetThreatId/);
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.approachSpeedMps = -1;
        }),
      ),
    ).toThrow(/world\.baby\.approachSpeedMps/);
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.approachSpeedMps = 'x';
        }),
      ),
    ).toThrow(/world\.baby\.approachSpeedMps/);
    expect(() =>
      sim.restore(
        mutate((baby) => {
          baby.path = [1, 1];
        }),
      ),
    ).toThrow(/world\.baby\.path/);
  });

  it('accepts a baby in approach with no path (it is already there)', async () => {
    const sim = await newSim();
    stepN(sim, 125); // at the outlet, still in approach, path empty
    expect(sim.world.baby.state).toBe('approach');
    expect(sim.world.baby.path).toEqual([]);
    const other = await newSim();
    expect(() => other.restore(sim.snapshot())).not.toThrow();
  });
});

describe('snapshot / restore under a slow-mo', () => {
  const planned = createTestLevel({ waves: [testWave([OUTLET])] });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });
  const { slowMoPerfect } = content.feel.timing;

  /** A live sim that parried perfectly: stepped to `untilMs`, with the step that resolved at `resolvedAt`. */
  async function parried(untilMs: (resolvedAt: number) => number) {
    const sim = await newSim();
    sim.step();
    const { windowOpenAt, responseWindow } = sim.world.threats[0] ?? {};
    if (responseWindow == null || windowOpenAt === undefined) throw new Error('not telegraphed');
    const center = windowOpenAt + responseWindow.windowMs / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: 1 });
    sim.enqueue({ type: 'Release', t: asSimMs(center + PARRY_RELEASE_AFTER_MS) });
    const resolvedAt = center + PARRY_RELEASE_AFTER_MS;
    const untilSimMs = untilMs(resolvedAt);
    while (sim.world.time.sim < untilSimMs) sim.step();
    return { sim, resolvedAt };
  }

  it.each([
    ['holding', (resolvedAt: number) => resolvedAt + slowMoPerfect.durationMs / 2],
    [
      'returning',
      (resolvedAt: number) =>
        Math.ceil((resolvedAt + slowMoPerfect.durationMs + slowMoPerfect.returnMs / 2) / 10) * 10,
    ],
  ])('restores a snapshot taken while %s to the uninterrupted hash', async (phase, at) => {
    const { sim: live } = await parried(at);
    const snapshot = live.snapshot();
    const slowMo = snapshot.world.time.slowMos[0];
    expect(slowMo).toMatchObject({ source: 'perfect', scale: slowMoPerfect.timeScale });
    expect(snapshot.world.time.scale).toBeLessThan(1);
    if (phase === 'returning')
      expect(snapshot.world.time.scale).toBeGreaterThan(slowMoPerfect.timeScale);
    live.drainEvents();
    stepN(live, 400);
    const liveAfter = [...live.drainEvents()];
    expect(live.world.time.slowMos).toEqual([]);
    expect(live.world.time.scale).toBe(1);

    const restored = await newSim();
    restored.restore(snapshot, []);
    stepN(restored, 400);
    expect(restored.world).toEqual(live.world);
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
    expect(restored.drainEvents()).toEqual(liveAfter);
  });

  it('refuses a snapshot whose time slice is malformed', async () => {
    const { sim } = await parried((resolvedAt) => resolvedAt + 100);
    const good = sim.snapshot();
    const time = (world: Record<string, unknown>) => world.time as Record<string, unknown>;
    const entry = (world: Record<string, unknown>) =>
      (time(world).slowMos as Record<string, unknown>[])[0] as Record<string, unknown>;
    const broken: [string, (world: Record<string, unknown>) => void, RegExp][] = [
      ['a missing base scale', (w) => delete time(w).baseScale, /world\.time\.baseScale/],
      ['a base scale of 0', (w) => (time(w).baseScale = 0), /world\.time\.baseScale/],
      ['a base scale above 1', (w) => (time(w).baseScale = 1.5), /world\.time\.baseScale/],
      ['an effective scale of 0', (w) => (time(w).scale = 0), /world\.time\.scale/],
      ['an effective scale above 1', (w) => (time(w).scale = 2), /world\.time\.scale/],
      ['slowMos that is not an array', (w) => (time(w).slowMos = {}), /world\.time\.slowMos$/],
      ['an entry that is not an object', (w) => (time(w).slowMos = [3]), /slowMos\[0\]$/],
      ['an unknown source', (w) => (entry(w).source = 'nap'), /slowMos\[0\]\.source/],
      ['a scale of 0', (w) => (entry(w).scale = 0), /slowMos\[0\]\.scale/],
      ['a scale above 1', (w) => (entry(w).scale = 1.2), /slowMos\[0\]\.scale/],
      ['a scale below the minimum', (w) => (entry(w).scale = 0.01), /slowMos\[0\]\.scale/],
      ['a non-finite start', (w) => (entry(w).startedAt = 'now'), /slowMos\[0\]\.startedAt/],
      ['a non-finite hold', (w) => (entry(w).holdUntil = 'soon'), /slowMos\[0\]\.holdUntil/],
      ['a non-finite end', (w) => (entry(w).endsAt = 'later'), /slowMos\[0\]\.endsAt/],
      [
        'a hold that ends before it starts',
        (w) => (entry(w).holdUntil = (entry(w).startedAt as number) - 10),
        /slowMos\[0\]\.holdUntil/,
      ],
      [
        'an end before the hold',
        (w) => (entry(w).endsAt = (entry(w).holdUntil as number) - 10),
        /slowMos\[0\]\.endsAt/,
      ],
      [
        'two slow-mos of one source',
        (w) => (time(w).slowMos = [entry(w), { ...entry(w) }]),
        /world\.time\.slowMos$/,
      ],
    ];
    for (const [name, mutate, message] of broken) {
      const world = JSON.parse(JSON.stringify(good.world)) as Record<string, unknown>;
      mutate(world);
      const target = await newSim();
      expect(
        () => target.restore({ ...good, world: world as never }, []),
        `${name} must be refused`,
      ).toThrow(message);
    }
  });
});

describe('snapshot / restore with props in motion (story 1.15)', () => {
  const pushMug = {
    type: 'PushProp',
    t: asSimMs(0),
    propId: 'mug_01',
    impulseXNs: 0.72,
    impulseYNs: 0,
    impulseZNs: 0,
  } as const;
  const PUSHED_STEPS = 40;

  async function newSim() {
    return createSim({ content, geometry, level, seed: 5 });
  }

  /** A sim whose mug was pushed off the coffee table and is still in the air. */
  async function midFall() {
    const sim = await newSim();
    sim.enqueue(pushMug);
    stepN(sim, PUSHED_STEPS);
    return sim;
  }

  /** The prop events after `afterT`, from a sim stepped `steps` more times. */
  function propEvents(sim: Awaited<ReturnType<typeof newSim>>, steps: number): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      sim.step();
      for (const event of sim.drainEvents()) if (event.type.startsWith('Prop')) out.push(event);
    }
    return out;
  }

  it('is taken while a prop moves, and carries the Rapier world as base64', async () => {
    const sim = await midFall();
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(9);
    expect(snapshot.physics).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(snapshot.world.props[0]?.xM).toBeGreaterThan(0.7);
    expect(snapshot.world.props[0]?.yM).toBeLessThan(0.5);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('restored into the same sim, continues to the same hash and events as an uninterrupted run', async () => {
    const straight = await midFall();
    const snapshot = straight.snapshot();
    straight.drainEvents();
    const expectedEvents = propEvents(straight, 400);
    expect(expectedEvents.length).toBeGreaterThan(0);

    const resumed = await midFall();
    resumed.drainEvents();
    stepN(resumed, 60); // go on, then come back to the snapshot
    resumed.restore(snapshot);
    expect(resumed.world).toEqual(snapshot.world);
    expect(propEvents(resumed, 400)).toEqual(expectedEvents);
    expect(hashJson(resumed.world)).toBe(hashJson(straight.world));
    expect(resumed.world.props).toEqual(straight.world.props);
  });

  it('restored into a second sim built from the same content, continues identically', async () => {
    const first = await midFall();
    const snapshot = first.snapshot();
    first.drainEvents();
    const expectedEvents = propEvents(first, 400);

    const second = await newSim();
    second.restore(snapshot);
    expect(propEvents(second, 400)).toEqual(expectedEvents);
    expect(hashJson(second.world)).toBe(hashJson(first.world));
    first.dispose();
    second.dispose();
  });

  it('restores a snapshot taken after the props came to rest', async () => {
    const first = await midFall();
    stepN(first, 600);
    const snapshot = first.snapshot();
    const second = await newSim();
    second.restore(snapshot);
    stepN(first, 100);
    stepN(second, 100);
    expect(hashJson(second.world)).toBe(hashJson(first.world));
  });

  it('refuses a snapshot from before the Rapier world (version 4)', async () => {
    const sim = await newSim();
    expect(() => sim.restore({ ...sim.snapshot(), version: 4 as 9 })).toThrow(/version 4/);
  });

  describe('refuses a malformed props slice, with its path', () => {
    const prop = (w: Record<string, unknown>) =>
      (w.props as Record<string, unknown>[])[0] as Record<string, unknown>;
    const broken: [string, (w: Record<string, unknown>) => void, RegExp][] = [
      ['no props at all', (w) => delete w.props, /world\.props$/],
      ['props that is not an array', (w) => (w.props = {}), /world\.props$/],
      ['a prop missing', (w) => (w.props = []), /world\.props$/],
      ['an extra prop', (w) => (w.props = [...(w.props as unknown[]), prop(w)]), /world\.props$/],
      ['a prop that is not an object', (w) => (w.props = [3, 3]), /world\.props\[0\]$/],
      ['another id', (w) => (prop(w).id = 'vase_09'), /world\.props\[0\]\.id/],
      ['another kind', (w) => (prop(w).kind = 'vase'), /world\.props\[0\]\.kind/],
      ['a non-finite x', (w) => (prop(w).xM = Number.NaN), /world\.props\[0\]\.xM/],
      ['a string y', (w) => (prop(w).yM = '1'), /world\.props\[0\]\.yM/],
      ['a missing z', (w) => delete prop(w).zM, /world\.props\[0\]\.zM/],
      ['a non-finite previous x', (w) => (prop(w).prevXM = null), /world\.props\[0\]\.prevXM/],
      ['a non-finite previous y', (w) => (prop(w).prevYM = 'a'), /world\.props\[0\]\.prevYM/],
      ['a non-finite previous z', (w) => delete prop(w).prevZM, /world\.props\[0\]\.prevZM/],
      ['a quaternion that is not a unit', (w) => (prop(w).qw = 2), /world\.props\[0\]\.q$/],
      ['a quaternion with a NaN', (w) => (prop(w).qx = Number.NaN), /world\.props\[0\]\.q$/],
      [
        'a previous quaternion that is not a unit',
        (w) => (prop(w).prevQw = 0),
        /world\.props\[0\]\.prevQ$/,
      ],
      ['a non-boolean isOnFloor', (w) => (prop(w).isOnFloor = 1), /world\.props\[0\]\.isOnFloor/],
      ['a non-boolean isBroken', (w) => (prop(w).isBroken = 'no'), /world\.props\[0\]\.isBroken/],
      [
        'a last impact that is a string',
        (w) => (prop(w).lastImpactAt = 'then'),
        /world\.props\[0\]\.lastImpactAt/,
      ],
      ['no mess', (w) => delete w.mess, /world\.mess is missing/],
      [
        'a negative mess count',
        (w) => ((w.mess as Record<string, unknown>).propsBroken = -1),
        /world\.mess\.propsBroken/,
      ],
      [
        'a fractional mess count',
        (w) => ((w.mess as Record<string, unknown>).propsOnFloor = 0.5),
        /world\.mess\.propsOnFloor/,
      ],
      [
        'a mess that disagrees with the props (broken)',
        (w) => ((w.mess as Record<string, unknown>).propsBroken = 1),
        /world\.mess\.propsBroken/,
      ],
      [
        'a mess that disagrees with the props (on the floor)',
        (w) => ((w.mess as Record<string, unknown>).propsOnFloor = 1),
        /world\.mess\.propsOnFloor/,
      ],
      [
        'a broken prop the mess does not count',
        (w) => (prop(w).isBroken = true),
        /world\.mess\.propsBroken/,
      ],
    ];

    it.each(broken)('%s', async (_name, mutate, message) => {
      const sim = await midFall();
      const world = JSON.parse(JSON.stringify(sim.snapshot().world)) as Record<string, unknown>;
      mutate(world);
      const target = await newSim();
      expect(() => target.restore({ ...sim.snapshot(), world: world as never })).toThrow(message);
    });
  });

  describe('refuses a damaged physics blob, and leaves the sim untouched', () => {
    async function expectUntouched(physics: unknown, message: RegExp) {
      const sim = await midFall();
      const twin = await midFall();
      const snapshot = sim.snapshot();
      stepN(sim, 5);
      stepN(twin, 5);
      const before = JSON.stringify(sim.world);
      expect(() => sim.restore({ ...snapshot, physics: physics as string })).toThrow(message);
      expect(JSON.stringify(sim.world)).toBe(before);
      stepN(sim, 200);
      stepN(twin, 200);
      expect(hashJson(sim.world)).toBe(hashJson(twin.world));
    }

    it('not a string', () => expectUntouched(42, /physics/));
    it('not base64', () => expectUntouched('not base64!', /invalid snapshot physics/));
    it('base64 of nothing', () => expectUntouched('', /physics/));
    it('base64 of garbage', () => expectUntouched('AAECAwQFBgcICQoL', /./));

    it('the snapshot of a level with other props', async () => {
      const otherGeometry = createTestGeometry();
      otherGeometry.props = [];
      const other = await createSim({ content, geometry: otherGeometry, level, seed: 5 });
      const sim = await midFall();
      const snapshot = sim.snapshot();
      // The world half is the sim's own; only the Rapier half comes from another level.
      expect(() => sim.restore({ ...snapshot, physics: other.snapshot().physics })).toThrow(
        /does not fit/,
      );
    });
  });
});

describe('snapshot / restore of the director and the flow (story 1.18)', () => {
  const planned = createTestLevel({
    waves: [testWave([OUTLET], { gapMinMs: 500, gapMaxMs: 500 }), testWave([], { fromMs: 5000 })],
  });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });
  const threat0 = (w: Record<string, unknown>) =>
    (w.threats as Record<string, unknown>[])[0] as Record<string, unknown>;

  it('is version 9, and carries the director, the flow and the wave index of each threat', async () => {
    const sim = await newSim();
    stepN(sim, 60); // 600 ms: wave 0 entered, the outlet telegraphed
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(9);
    expect(snapshot.world.director.waveIndex).toBe(0);
    expect(snapshot.world.flow).toEqual({ state: 'playing', enteredAt: 0 });
    expect(snapshot.world.threats[0]).toMatchObject({ state: 'telegraph', waveIndex: 0 });
  });

  it('restores mid-wave to the uninterrupted hash', async () => {
    const live = await newSim();
    stepN(live, 80);
    const snapshot = live.snapshot();
    stepN(live, 400);
    const restored = await newSim();
    restored.restore(snapshot);
    stepN(restored, 400);
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
  });

  describe('refuses a damaged slice, naming the field', () => {
    const director = (w: Record<string, unknown>) => w.director as Record<string, unknown>;
    const flow = (w: Record<string, unknown>) => w.flow as Record<string, unknown>;
    const set = (target: Record<string, unknown>, key: string, value: unknown): void => {
      target[key] = value;
    };
    const broken: [string, (w: Record<string, unknown>) => void, RegExp][] = [
      ['no director', (w) => delete w.director, /world\.director is missing/],
      [
        'a fractional wave index',
        (w) => set(director(w), 'waveIndex', 0.5),
        /world\.director\.waveIndex/,
      ],
      [
        'a wave index past the last wave',
        (w) => set(director(w), 'waveIndex', 2),
        /world\.director\.waveIndex/,
      ],
      [
        'a wave index below -1',
        (w) => set(director(w), 'waveIndex', -2),
        /world\.director\.waveIndex/,
      ],
      ['a NaN nextAt', (w) => set(director(w), 'nextAt', Number.NaN), /world\.director\.nextAt/],
      ['a negative nextAt', (w) => set(director(w), 'nextAt', -1), /world\.director\.nextAt/],
      ['no flow', (w) => delete w.flow, /world\.flow is missing/],
      ['an unknown flow state', (w) => set(flow(w), 'state', 'paused'), /world\.flow\.state/],
      [
        'a non-finite flow enteredAt',
        (w) => set(flow(w), 'enteredAt', 'x'),
        /world\.flow\.enteredAt/,
      ],
      [
        'a threat wave index past the last wave',
        (w) => set(threat0(w), 'waveIndex', 2),
        /world\.threats\[0\]\.waveIndex/,
      ],
      [
        'a threat wave index that is a string',
        (w) => set(threat0(w), 'waveIndex', '0'),
        /world\.threats\[0\]\.waveIndex/,
      ],
      [
        'a threat from a wave the director has not entered',
        (w) => set(director(w), 'waveIndex', -1),
        /world\.threats\[0\]\.waveIndex/,
      ],
      [
        'a flow that ended before the level time is up',
        (w) => set(flow(w), 'state', 'ended'),
        /world\.flow\.state/,
      ],
      [
        'a flow entered after the current sim time',
        (w) => set(flow(w), 'enteredAt', 700),
        /world\.flow\.enteredAt/,
      ],
      [
        'an idle threat that names a wave',
        (w) => {
          set(threat0(w), 'state', 'idle');
          set(threat0(w), 'responseWindow', null);
          set(threat0(w), 'waveIndex', 0);
        },
        /world\.threats\[0\]\.waveIndex/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, expected) => {
      const live = await newSim();
      stepN(live, 60);
      const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
        typeof live.snapshot
      >;
      damage(snapshot.world as unknown as Record<string, unknown>);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });
  });
});

describe('snapshot / restore of the gauges and the busy Papa (story 1.19)', () => {
  const tired = {
    ...content,
    feel: {
      ...content.feel,
      fatigue: { ...content.feel.fatigue, startPoints: 90, coffeeDurationMs: 20_000 },
    },
  };
  const fatigueLevel = createTestLevel({ objects: TEST_OBJECTS, gauges: FATIGUE_GAUGES });
  const newTired = () => createSim({ content: tired, geometry, level: fatigueLevel, seed: 9 });

  /** Steps until Papa is drinking (a coffee of 20 s). */
  async function drinking() {
    const sim = await newTired();
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'coffee_machine' });
    for (let i = 0; i < 5000 && sim.world.papa.state !== 'drink'; i++) sim.step();
    expect(sim.world.papa.state).toBe('drink');
    return sim;
  }

  it('carries the gauges slice, the walk to an object and the end of a busy state', async () => {
    const sim = await newTired();
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'coffee_machine' });
    stepN(sim, 5);
    const walking = sim.snapshot().world;
    expect(walking.papa).toMatchObject({
      state: 'walkPath',
      objectId: 'coffee_machine',
      busyUntil: 0,
    });
    expect(walking.gauges).toMatchObject({ isFatigueAbove: true });
    expect(walking.gauges.microSleepAt).toBeGreaterThan(0);
    const busy = (await drinking()).snapshot().world;
    expect(busy.papa).toMatchObject({ state: 'drink', objectId: null });
    expect(busy.papa.busyUntil).toBeGreaterThan(0);
    expect(busy.papa.path).toEqual([]);
    expect(busy.papa.glide).toBeNull();
  });

  it('restores a coffee mid-drink to the uninterrupted hash', async () => {
    const live = await drinking();
    const snapshot = live.snapshot();
    const copy = await newTired();
    copy.restore(snapshot);
    stepN(live, 300);
    stepN(copy, 300);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  describe('refuses a damaged slice, naming the field', () => {
    const papa = (w: Record<string, unknown>) => w.papa as Record<string, unknown>;
    const gauges = (w: Record<string, unknown>) => w.gauges as Record<string, unknown>;
    const set = (target: Record<string, unknown>, key: string, value: unknown): void => {
      target[key] = value;
    };
    const broken: [string, (w: Record<string, unknown>) => void, RegExp][] = [
      ['no gauges', (w) => delete w.gauges, /world\.gauges is missing/],
      ['a fatigue above 100', (w) => set(gauges(w), 'fatigue', 100.5), /world\.gauges\.fatigue/],
      ['a negative fatigue', (w) => set(gauges(w), 'fatigue', -1), /world\.gauges\.fatigue/],
      ['a NaN fatigue', (w) => set(gauges(w), 'fatigue', Number.NaN), /world\.gauges\.fatigue/],
      [
        'a non-boolean isFatigueAbove',
        (w) => set(gauges(w), 'isFatigueAbove', 1),
        /isFatigueAbove/,
      ],
      [
        'a negative microSleepAt',
        (w) => set(gauges(w), 'microSleepAt', -5),
        /world\.gauges\.microSleepAt/,
      ],
      [
        'a micro-sleep pending while not above the threshold',
        (w) => set(gauges(w), 'isFatigueAbove', false),
        /world\.gauges\.microSleepAt/,
      ],
      [
        'above the threshold with no micro-sleep pending',
        (w) => set(gauges(w), 'microSleepAt', null),
        /world\.gauges\.microSleepAt/,
      ],
      [
        'an object id that is a number',
        (w) => set(papa(w), 'objectId', 3),
        /world\.papa\.objectId/,
      ],
      [
        'an object the level lacks',
        (w) => set(papa(w), 'objectId', 'kettle'),
        /world\.papa\.objectId/,
      ],
      ['an object while idle', (w) => set(papa(w), 'objectId', 'phone'), /world\.papa\.objectId/],
      ['a NaN busyUntil', (w) => set(papa(w), 'busyUntil', Number.NaN), /world\.papa\.busyUntil/],
      ['a busy end while idle', (w) => set(papa(w), 'busyUntil', 500), /world\.papa\.busyUntil/],
      [
        'a drink with no end',
        (w) => {
          set(papa(w), 'state', 'drink');
          set(papa(w), 'busyUntil', 0);
        },
        /world\.papa\.busyUntil/,
      ],
      [
        'a sleeping Papa that still walks',
        (w) => {
          set(papa(w), 'state', 'asleep');
          set(papa(w), 'busyUntil', 5000);
          set(papa(w), 'path', [1, 1]);
        },
        /world\.papa\.path/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, expected) => {
      const live = await newTired();
      stepN(live, 5);
      const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
        typeof live.snapshot
      >;
      damage(snapshot.world as unknown as Record<string, unknown>);
      const target = await newTired();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });
  });

  it('refuses fatigue above the threshold in a level that has no fatigue gauge', async () => {
    const live = await createSim({ content, geometry, level, seed: 9 });
    stepN(live, 5);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
      typeof live.snapshot
    >;
    Object.assign(snapshot.world.gauges, { isFatigueAbove: true, microSleepAt: 500 });
    const target = await createSim({ content, geometry, level, seed: 9 });
    expect(() => target.restore(snapshot)).toThrow(/world\.gauges\.isFatigueAbove/);
  });
});

describe('snapshot / restore of the disruptions and the phone call (story 1.20)', () => {
  const phoneLevel = createTestLevel({
    waves: [testWave([], { disruptions: [testPhoneEntry(100_000)] })],
    objects: TEST_OBJECTS,
    gauges: FATIGUE_GAUGES,
  });
  const newPhone = () => createSim({ content, geometry, level: phoneLevel, seed: 9 });

  /** A sim whose phone rings and Papa has set off to answer it. */
  async function ringing() {
    const sim = await newPhone();
    sim.enqueue({ type: 'StartDisruption', t: asSimMs(0), index: 0 });
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'phone' });
    stepN(sim, 50);
    return sim;
  }

  /** Steps until Papa is on the phone. */
  async function onPhone() {
    const sim = await ringing();
    for (let i = 0; i < 5000 && sim.world.papa.state !== 'onPhone'; i++) sim.step();
    expect(sim.world.papa.state).toBe('onPhone');
    return sim;
  }

  it('is version 9, and carries a pending disruption as it was created', async () => {
    const sim = await newPhone();
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(9);
    expect(snapshot.world.disruptions).toEqual([
      { state: 'pending', enteredAt: 0, untilAt: 0, nextRingingAt: 0 },
    ]);
  });

  it('carries a ringing phone with its two instants, and restores to the uninterrupted hash', async () => {
    const live = await ringing();
    const snapshot = live.snapshot();
    expect(snapshot.world.disruptions[0]).toMatchObject({ state: 'ringing' });
    expect(snapshot.world.disruptions[0]?.untilAt).toBeGreaterThan(0);
    expect(snapshot.world.disruptions[0]?.nextRingingAt).toBeGreaterThan(0);
    const copy = await newPhone();
    copy.restore(snapshot);
    stepN(live, 400);
    stepN(copy, 400);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    expect(copy.world.disruptions[0]).toEqual(live.world.disruptions[0]);
  });

  it('restores a call mid-way to the uninterrupted hash: onPhone, its end, and what follows', async () => {
    const live = await onPhone();
    const snapshot = live.snapshot();
    expect(snapshot.world.papa).toMatchObject({ state: 'onPhone', objectId: null });
    expect(snapshot.world.papa.busyUntil).toBeGreaterThan(live.world.time.sim);
    expect(snapshot.world.disruptions[0]).toMatchObject({
      state: 'answered',
      untilAt: 0,
      nextRingingAt: 0,
    });
    const copy = await newPhone();
    copy.restore(snapshot);
    stepN(live, 700);
    stepN(copy, 700);
    expect(copy.world.papa.state).toBe('idle');
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('refuses a snapshot taken by a level that plans another number of disruptions', async () => {
    const live = await newPhone();
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
      typeof live.snapshot
    >;
    const none = await createSim({
      content,
      geometry,
      level: createTestLevel({ objects: TEST_OBJECTS, gauges: FATIGUE_GAUGES }),
      seed: 9,
    });
    expect(() => none.restore(snapshot)).toThrow(/world\.disruptions|another level/);
    // Same level hash needed for the length check: damage the list of the right level instead.
    snapshot.world.disruptions.push(snapshot.world.disruptions[0] as never);
    const target = await newPhone();
    expect(() => target.restore(snapshot)).toThrow(/world\.disruptions/);
  });

  describe('refuses a damaged slice, naming the field', () => {
    const slice = (w: Record<string, unknown>) =>
      (w.disruptions as Record<string, unknown>[])[0] as Record<string, unknown>;
    const set = (target: Record<string, unknown>, key: string, value: unknown): void => {
      target[key] = value;
    };
    const broken: [string, (w: Record<string, unknown>) => void, RegExp][] = [
      ['no disruptions', (w) => delete w.disruptions, /world\.disruptions/],
      [
        'a disruption that is not an object',
        (w) => set(w, 'disruptions', [3]),
        /world\.disruptions\[0\]/,
      ],
      [
        'an unknown state',
        (w) => set(slice(w), 'state', 'snoozing'),
        /world\.disruptions\[0\]\.state/,
      ],
      [
        'a NaN enteredAt',
        (w) => set(slice(w), 'enteredAt', Number.NaN),
        /disruptions\[0\]\.enteredAt/,
      ],
      ['a negative untilAt', (w) => set(slice(w), 'untilAt', -1), /disruptions\[0\]\.untilAt/],
      [
        'a negative nextRingingAt',
        (w) => set(slice(w), 'nextRingingAt', -1),
        /disruptions\[0\]\.nextRingingAt/,
      ],
      ['an enteredAt in the future', (w) => set(slice(w), 'enteredAt', 99_999_999), /enteredAt/],
      [
        'a pending phone that has an end',
        (w) => set(slice(w), 'untilAt', 5000),
        /disruptions\[0\]\.untilAt/,
      ],
      [
        'a ringing phone with no end',
        (w) => {
          set(slice(w), 'state', 'ringing');
          set(slice(w), 'nextRingingAt', 500);
        },
        /disruptions\[0\]\.untilAt/,
      ],
      [
        'a ringing phone with no next tick',
        (w) => {
          set(slice(w), 'state', 'ringing');
          set(slice(w), 'untilAt', 500);
        },
        /disruptions\[0\]\.nextRingingAt/,
      ],
      [
        'a timed-out phone that still has a next tick',
        (w) => {
          set(slice(w), 'state', 'timedOut');
          set(slice(w), 'nextRingingAt', 500);
        },
        /disruptions\[0\]\.nextRingingAt/,
      ],
      [
        'a ringing phone whose end is not ringMaxMs after its start (a huge untilAt: a burst of ticks)',
        (w) => {
          set(slice(w), 'state', 'ringing');
          set(slice(w), 'enteredAt', 0);
          set(slice(w), 'nextRingingAt', 1000);
          set(slice(w), 'untilAt', 1e15);
        },
        /disruptions\[0\]\.untilAt/,
      ],
      [
        'a ringing phone whose next tick is off the whole periods from its start',
        (w) => {
          set(slice(w), 'state', 'ringing');
          set(slice(w), 'enteredAt', 0);
          set(slice(w), 'untilAt', 15_000);
          set(slice(w), 'nextRingingAt', 1);
        },
        /disruptions\[0\]\.nextRingingAt/,
      ],
      [
        'a ringing phone whose end has passed',
        (w) => {
          set(slice(w), 'state', 'ringing');
          set(slice(w), 'enteredAt', 0);
          set(slice(w), 'untilAt', 15_000);
          set(slice(w), 'nextRingingAt', 1000);
          set(w.time as Record<string, unknown>, 'sim', 15_000);
        },
        /disruptions\[0\]\.untilAt/,
      ],
      [
        'a Papa on the phone while no disruption was answered',
        (w) => {
          set(w.papa as Record<string, unknown>, 'state', 'onPhone');
          set(w.papa as Record<string, unknown>, 'busyUntil', 9000);
        },
        /world\.papa\.state/,
      ],
      [
        'an onPhone Papa with no end',
        (w) => {
          set(slice(w), 'state', 'answered');
          set(w.papa as Record<string, unknown>, 'state', 'onPhone');
        },
        /world\.papa\.busyUntil/,
      ],
      [
        'a Papa who walks but has a busy end',
        (w) => set(w.papa as Record<string, unknown>, 'busyUntil', 9000),
        /world\.papa\.busyUntil/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, expected) => {
      const live = await newPhone();
      stepN(live, 5);
      const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
        typeof live.snapshot
      >;
      damage(snapshot.world as unknown as Record<string, unknown>);
      const target = await newPhone();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });
  });
});

describe('snapshot / restore of the suspicious silence (story 1.21)', () => {
  const planned = createTestLevel({ waves: [testWave([SILENCE])] });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });

  /** Steps until `isDone`, bounded. */
  async function until(isDone: (world: Awaited<ReturnType<typeof newSim>>['world']) => boolean) {
    const sim = await newSim();
    for (let i = 0; i < 3000 && !isDone(sim.world); i++) sim.step();
    expect(isDone(sim.world)).toBe(true);
    return sim;
  }

  it('carries a hidden silence on its way to the zone, and restores to the uninterrupted hash', async () => {
    const live = await until((world) => world.baby.state === 'mischiefSilent');
    stepN(live, 5);
    const snapshot = live.snapshot();
    expect(snapshot.world.threats[0]).toMatchObject({
      state: 'hidden',
      responseWindow: null,
      windowOpenAt: 0,
    });
    expect(snapshot.world.silence).toEqual({ threatId: 1, zoneEnteredAt: null, startedAt: null });
    stepN(live, 900);
    const restored = await newSim();
    restored.restore(snapshot);
    stepN(restored, 900);
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
  });

  it('carries a started silence, and the deadline gag comes the same after a restore', async () => {
    const live = await until((world) => world.silence.startedAt !== null);
    const snapshot = live.snapshot();
    expect(snapshot.world.baby).toMatchObject({ state: 'mischiefSilent', babbling: false });
    stepN(live, 700);
    const liveEvents = [...live.drainEvents()];
    const restored = await newSim();
    restored.restore(snapshot);
    restored.drainEvents();
    stepN(restored, 700);
    expect(restored.world).toEqual(live.world);
    expect(restored.world.mess.mischiefs).toBe(1);
    expect(liveEvents.map((event) => event.type)).toContain('SilenceEnded');
  });

  it('goes through every threat state once the silence is played, hidden included', async () => {
    const states = new Set<string>();
    const sim = await newSim();
    for (let i = 0; i < 2000; i++) {
      sim.step();
      states.add(sim.world.threats[0]?.state ?? '');
      expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    }
    expect(states.has('hidden')).toBe(true);
    expect(states.has('gag')).toBe(true);
  });

  describe('refuses a damaged silence slice, with its path', () => {
    const firstThreat = (w: Record<string, unknown>) =>
      (w.threats as Record<string, unknown>[])[0] as Record<string, unknown>;
    const broken: [string, (world: Record<string, unknown>) => void, RegExp][] = [
      ['no silence at all', (w) => delete w.silence, /world\.silence is missing/],
      [
        'a threat that is not hidden',
        (w) => {
          firstThreat(w).state = 'idle';
          firstThreat(w).waveIndex = -1;
        },
        /world\.silence\.threatId/,
      ],
      [
        'an unknown threat id',
        (w) => {
          (w.silence as Record<string, unknown>).threatId = 99;
        },
        /world\.silence\.threatId/,
      ],
      [
        'a zone entry with no threat',
        (w) => {
          (w.silence as Record<string, unknown>).threatId = null;
          (w.baby as Record<string, unknown>).state = 'babble';
          (w.baby as Record<string, unknown>).targetThreatId = null;
          firstThreat(w).state = 'idle';
          firstThreat(w).waveIndex = -1;
        },
        /world\.silence\.zoneEnteredAt/,
      ],
      [
        'a start with no zone entry',
        (w) => {
          (w.silence as Record<string, unknown>).zoneEnteredAt = null;
          (w.silence as Record<string, unknown>).startedAt = 1000;
        },
        /world\.silence\.startedAt/,
      ],
      [
        'a start before the zone entry',
        (w) => {
          (w.silence as Record<string, unknown>).startedAt = 1;
        },
        /world\.silence\.startedAt/,
      ],
      [
        'a baby that is not hiding while a silence is under way',
        (w) => {
          (w.baby as Record<string, unknown>).state = 'babble';
        },
        /world\.baby\.targetThreatId|world\.silence\.threatId/,
      ],
      [
        'a babbling baby in his zone',
        (w) => {
          (w.baby as Record<string, unknown>).babbling = true;
        },
        /world\.silence\.zoneEnteredAt/,
      ],
      [
        'a negative mischief count',
        (w) => {
          (w.mess as Record<string, unknown>).mischiefs = -1;
        },
        /world\.mess\.mischiefs/,
      ],
      [
        'a fractional mischief count',
        (w) => {
          (w.mess as Record<string, unknown>).mischiefs = 0.5;
        },
        /world\.mess\.mischiefs/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, pattern) => {
      const live = await until((world) => world.silence.startedAt !== null);
      const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
      damage(snapshot.world);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(pattern);
    });

    it('a hidden threat with a window', async () => {
      const live = await until((world) => world.silence.startedAt !== null);
      const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
      snapshot.world.threats[0].windowOpenAt = 5;
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/world\.threats\[0\]\.windowOpenAt/);
    });
  });
});
