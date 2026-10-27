import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
  stepN,
} from '../../tests/support/testContent.ts';
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
    expect(() => sim.restore({ ...snapshot, version: 1 as 3 })).toThrow(/version/);
  });

  it('refuses a snapshot of another level', async () => {
    const sim = await createSim({ content, geometry, level, seed: 5 });
    expect(() => sim.restore({ ...sim.snapshot(), levelHash: 'x' })).toThrow(/another level$/);
    const planning = await createSim({
      content,
      geometry,
      level: createTestLevel([outletEntry(0)]),
      seed: 5,
    });
    expect(() => sim.restore(planning.snapshot())).toThrow(/another level$/);
  });
});

describe('snapshot / restore with a threat', () => {
  const planned = createTestLevel([outletEntry(0)]);
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
    expect([...states].sort()).toEqual([...THREAT_STATES].sort());
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
