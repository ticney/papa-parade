import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  CRYING_OUTLET,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  stepN,
  TEST_OBJECTS,
  TEST_TOILET,
  testPhoneEntry,
  testWave,
} from '../../tests/support/testContent.ts';
import { PARRY_RELEASE_AFTER_MS } from '../../tests/support/timeEffects.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems, type Sim } from './createSim.ts';
import type { SimEvent } from './events.ts';
import { SYSTEMS } from './step.ts';
import { THREAT_STATES } from './threats/threatFsm.ts';
import type { World } from './world.ts';

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
    expect(() => sim.restore({ ...snapshot, version: 1 as 19 })).toThrow(/version/);
    // Version 3 predates the base scale and the slow-mos (story 1.14).
    expect(() => sim.restore({ ...snapshot, version: 3 as 19 })).toThrow(/version/);
    // Version 4 has no Rapier world (story 1.15).
    expect(() => sim.restore({ ...snapshot, version: 4 as 19 })).toThrow(/version 4/);
    // Version 5 has no director, flow or wave index (story 1.18).
    expect(() => sim.restore({ ...snapshot, version: 5 as 19 })).toThrow(/version 5/);
    // Version 6 has no gauges, no Papa busy state and no `objectId` (story 1.19).
    expect(() => sim.restore({ ...snapshot, version: 6 as 19 })).toThrow(/version 6/);
    // Version 7 has no disruptions and no `onPhone` state (story 1.20).
    expect(() => sim.restore({ ...snapshot, version: 7 as 19 })).toThrow(/version 7/);
    // Version 8 has no silence, no `mischiefs` and no hidden state (story 1.21).
    expect(() => sim.restore({ ...snapshot, version: 8 as 19 })).toThrow(/version 8/);
    // Version 9 has no score (story 1.22).
    expect(() => sim.restore({ ...snapshot, version: 9 as 19 })).toThrow(/version 9/);
    // Version 10 has no `heldAt` on a press (story 1.23).
    expect(() => sim.restore({ ...snapshot, version: 10 as 19 })).toThrow(/version 10/);
    // Version 11 has no noise state and no cry (story 3.1).
    expect(() => sim.restore({ ...snapshot, version: 11 as 19 })).toThrow(/version 11/);
    // Version 12 has no effective feel (story 2.1).
    expect(() => sim.restore({ ...snapshot, version: 12 as 19 })).toThrow(/version 12/);
    // Version 13 has no `lostStars` in the note (story 3.2).
    expect(() => sim.restore({ ...snapshot, version: 13 as 19 })).toThrow(/version 13/);
    // Version 14 has no `carry`, no `papa.intent` and no `carried` baby (story 4.1).
    expect(() => sim.restore({ ...snapshot, version: 14 as 19 })).toThrow(/version 14/);
    // Version 15 has no `combo`, no `comboPoints` and no `comboCashIn` slow-mo (story 4.2).
    expect(() => sim.restore({ ...snapshot, version: 15 as 19 })).toThrow(/version 15/);
    // Version 16 has no input slice (story 2.7).
    expect(() => sim.restore({ ...snapshot, version: 16 as 19 })).toThrow(/version 16/);
    // Version 17 has no need gauge, no toilet (story 4.3).
    expect(() => sim.restore({ ...snapshot, version: 17 as 19 })).toThrow(/version 17/);
    // Version 18 has no difficulty tier (story 2.8).
    expect(() => sim.restore({ ...snapshot, version: 18 as 19 })).toThrow(/version 18/);
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
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: null, heldAt: null };
        },
        /world\.threats\[0\]\.press/,
      ],
      [
        'a press quality',
        (threat) => {
          threat.press = { t: 1, quality: 'fail', offsetMs: 0, releasedAt: null, heldAt: null };
        },
        /press\.quality/,
      ],
      [
        'a press time',
        (threat) => {
          threat.press = {
            t: 'x',
            quality: 'perfect',
            offsetMs: 0,
            releasedAt: null,
            heldAt: null,
          };
        },
        /press\.t/,
      ],
      [
        'a press offset',
        (threat) => {
          threat.press = {
            t: 1,
            quality: 'perfect',
            offsetMs: null,
            releasedAt: null,
            heldAt: null,
          };
        },
        /press\.offsetMs/,
      ],
      [
        'a press release',
        (threat) => {
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: 'x', heldAt: null };
        },
        /press\.releasedAt/,
      ],
      [
        'a press hold that is not a number',
        (threat) => {
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: null, heldAt: 'x' };
        },
        /press\.heldAt/,
      ],
      [
        'a press hold that is missing (a version-10 press)',
        (threat) => {
          threat.press = { t: 1, quality: 'perfect', offsetMs: 0, releasedAt: null };
        },
        /press\.heldAt/,
      ],
      [
        'a press that closed its ring before it was made',
        (threat) => {
          threat.press = { t: 500, quality: 'perfect', offsetMs: 0, releasedAt: null, heldAt: 499 };
        },
        /press\.heldAt/,
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
    expect(snapshot.version).toBe(19);
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
    expect(() => sim.restore({ ...sim.snapshot(), version: 4 as 19 })).toThrow(/version 4/);
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

  it('is the current version (19), and carries the director, the flow and the wave index of each threat', async () => {
    const sim = await newSim();
    stepN(sim, 60); // 600 ms: wave 0 entered, the outlet telegraphed
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(19);
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

  it('is the current version (19), and carries a pending disruption as it was created', async () => {
    const sim = await newPhone();
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(19);
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

  it('restores a level that ended in the middle of a silence: the slice is closed, the baby and the threat as they were', async () => {
    const level = createTestLevel({ waves: [testWave([SILENCE])], durationMs: 3500 });
    const live = await createSim({ content, geometry, level, seed: 5 });
    for (let i = 0; i < 400 && live.world.flow.state !== 'ended'; i++) live.step();
    expect(live.world.flow.state).toBe('ended');
    expect(live.world.silence).toEqual({ threatId: null, zoneEnteredAt: null, startedAt: null });
    expect(live.world.threats[0]?.state).toBe('hidden');
    expect(live.world.baby.state).toBe('mischiefSilent');
    const restored = await createSim({ content, geometry, level, seed: 5 });
    restored.restore(live.snapshot());
    expect(hashJson(restored.world)).toBe(hashJson(live.world));
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
        'a start in the future',
        (w) => {
          (w.silence as Record<string, unknown>).startedAt = 1e9;
        },
        /world\.silence\.startedAt/,
      ],
      [
        'a zone entry in the future',
        (w) => {
          (w.silence as Record<string, unknown>).zoneEnteredAt = 1e9;
          (w.silence as Record<string, unknown>).startedAt = null;
        },
        /world\.silence\.zoneEnteredAt/,
      ],
      [
        'a hidden threat no silence names',
        (w) => {
          Object.assign(w.silence as Record<string, unknown>, {
            threatId: null,
            zoneEnteredAt: null,
            startedAt: null,
          });
          Object.assign(w.baby as Record<string, unknown>, {
            state: 'babble',
            targetThreatId: null,
            babbling: true,
            path: [],
            pathIndex: 0,
          });
        },
        /world\.silence\.threatId/,
      ],
      [
        'a silence on a threat that is already telegraphed',
        (w) => {
          Object.assign(firstThreat(w), {
            state: 'telegraph',
            windowOpenAt: 1,
            responseWindow: { windowMs: 100, toleranceMs: 0 },
          });
        },
        /world\.silence\.threatId|world\.threats\[0\]/,
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

    it('a hiding baby whose path is spent', async () => {
      const live = await until((world) => world.baby.state === 'mischiefSilent');
      const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
      expect(snapshot.world.baby.path.length).toBeGreaterThan(0);
      snapshot.world.baby.pathIndex = snapshot.world.baby.path.length / 2;
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/world\.baby\.path/);
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

describe('the input slice (story 2.7)', () => {
  const planned = createTestLevel({ waves: [testWave([OUTLET])] });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });

  it.each<[string, (w: Record<string, unknown>) => void, RegExp]>([
    ['no input slice', (w) => delete w.input, /world\.input is missing/],
    [
      'a negative lag',
      (w) => ((w.input as Record<string, unknown>).lagMs = -1),
      /world\.input\.lagMs/,
    ],
    [
      'a NaN lag',
      (w) => ((w.input as Record<string, unknown>).lagMs = Number.NaN),
      /world\.input\.lagMs/,
    ],
    [
      'a text lag',
      (w) => ((w.input as Record<string, unknown>).lagMs = '100'),
      /world\.input\.lagMs/,
    ],
  ])('refuses %s, naming the field', async (_name, damage, pattern) => {
    const live = await newSim();
    stepN(live, 10);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    damage(snapshot.world);
    const target = await newSim();
    expect(() => target.restore(snapshot)).toThrow(pattern);
  });

  it('restores the lag a SetInputLag set', async () => {
    const live = await newSim();
    live.enqueue({ type: 'SetInputLag', t: asSimMs(0), lagMs: 90 });
    stepN(live, 3);
    const target = await newSim();
    target.restore(live.snapshot());
    expect(target.world.input.lagMs).toBe(90);
  });
});

describe('the difficulty tier (story 2.8)', () => {
  const planned = createTestLevel({ waves: [testWave([OUTLET])] });
  const newSim = () => createSim({ content, geometry, level: planned, seed: 5 });

  it('starts at normal', async () => {
    expect((await newSim()).world.difficultyTier).toBe('normal');
  });

  it.each<[string, (w: Record<string, unknown>) => void]>([
    ['no tier', (w) => delete w.difficultyTier],
    ['an unknown tier', (w) => (w.difficultyTier = 'legendary')],
    ['a numeric tier', (w) => (w.difficultyTier = 1)],
  ])('refuses %s', async (_name, damage) => {
    const live = await newSim();
    stepN(live, 3);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    damage(snapshot.world);
    const target = await newSim();
    expect(() => target.restore(snapshot)).toThrow(/world\.difficultyTier/);
  });

  it('restores the tier a SetDifficultyTier set', async () => {
    const live = await newSim();
    live.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier: 'experienced' });
    stepN(live, 3);
    const target = await newSim();
    target.restore(live.snapshot());
    expect(target.world.difficultyTier).toBe('experienced');
  });
});

describe('snapshot / restore of Mama’s score (story 1.22)', () => {
  const DURATION_MS = 1000;
  const shortLevel = createTestLevel({ durationMs: DURATION_MS, waves: [] });
  const newSim = () => createSim({ content, geometry, level: shortLevel, seed: 5 });

  async function ended() {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS + 1);
    expect(sim.world.flow.state).toBe('ended');
    return sim;
  }

  it('is the current version (19), carries the counters while playing and the note once ended, and round-trips', async () => {
    const playing = await newSim();
    stepN(playing, 10);
    const early = playing.snapshot();
    expect(early.version).toBe(19);
    expect(early.world.score).toEqual({ perfects: 0, nearMisses: 0, comboPoints: 0, final: null });

    const live = await ended();
    const snapshot = live.snapshot();
    expect(snapshot.world.score.final).not.toBeNull();
    const target = await newSim();
    target.restore(snapshot);
    expect(target.world.score).toEqual(live.world.score);
    stepN(live, 50);
    stepN(target, 50);
    expect(hashJson(target.world)).toBe(hashJson(live.world));
  });

  type Damage = (w: Record<string, unknown>) => void;
  const score = (w: Record<string, unknown>) => w.score as Record<string, unknown>;
  const note = (w: Record<string, unknown>) => score(w).final as Record<string, unknown>;

  it.each<[string, Damage, RegExp]>([
    ['no score at all', (w) => delete w.score, /world\.score is missing/],
    ['a negative perfect count', (w) => (score(w).perfects = -1), /world\.score\.perfects/],
    ['a fractional perfect count', (w) => (score(w).perfects = 1.5), /world\.score\.perfects/],
    ['a negative near-miss count', (w) => (score(w).nearMisses = -1), /world\.score\.nearMisses/],
    [
      'a note while the level plays',
      (w) =>
        (score(w).final = {
          laughPoints: 0,
          babyStatePoints: 0,
          sighPoints: 0,
          screamPoints: 0,
          scorePoints: 0,
          stars: 0,
          lostStars: 0,
        }),
      /world\.score\.final/,
    ],
  ])('refuses %s while playing, naming the field', async (_name, damage, pattern) => {
    const live = await newSim();
    stepN(live, 10);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    damage(snapshot.world);
    const target = await newSim();
    expect(() => target.restore(snapshot)).toThrow(pattern);
  });

  it.each<[string, Damage, RegExp]>([
    ['no note once ended', (w) => (score(w).final = null), /world\.score\.final/],
    ['a note missing a field', (w) => delete note(w).stars, /world\.score\.final/],
    ['a note with an extra field', (w) => (note(w).bonusPoints = 1), /world\.score\.final/],
    ['a negative row', (w) => (note(w).sighPoints = -1), /world\.score\.final\.sighPoints/],
    ['a fractional row', (w) => (note(w).laughPoints = 2.5), /world\.score\.final\.laughPoints/],
    ['a score above 100', (w) => (note(w).scorePoints = 101), /world\.score\.final\.scorePoints/],
    ['six stars', (w) => (note(w).stars = 6), /world\.score\.final\.stars/],
    ['a fractional lostStars', (w) => (note(w).lostStars = 0.5), /world\.score\.final\.lostStars/],
    ['a negative lostStars', (w) => (note(w).lostStars = -1), /world\.score\.final\.lostStars/],
    [
      'stars and lostStars that add up to more than five',
      (w) => {
        note(w).stars = 3;
        note(w).lostStars = 3;
      },
      /world\.score\.final\.lostStars/,
    ],
  ])('refuses %s once ended, naming the field', async (_name, damage, pattern) => {
    const live = await ended();
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    damage(snapshot.world);
    const target = await newSim();
    expect(() => target.restore(snapshot)).toThrow(pattern);
  });
});

describe('snapshot / restore of a level ended by Mama waking (story 3.2)', () => {
  const noisyLevel = createTestLevel({ durationMs: 5000, waves: [], gauges: NOISE_GAUGES });
  const newNoisy = () => createSim({ content, geometry, level: noisyLevel, seed: 5 });

  it('restores an ended world after mamaWoke to the same hash, with lostStars in the note', async () => {
    const live = await newNoisy();
    stepN(live, 10);
    live.enqueue({ type: 'SetNoise', t: asSimMs(live.world.time.sim), pct: 100 });
    live.step();
    expect(live.world.flow.state).toBe('ended');
    expect(live.drainEvents().some((event) => event.type === 'MamaWoke')).toBe(true);
    expect(live.world.score.final?.lostStars).toBe(content.feel.mama.earlyWakePenaltyStars);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
      typeof live.snapshot
    >;
    expect(snapshot.version).toBe(19);
    const copy = await newNoisy();
    copy.restore(snapshot);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    stepN(live, 50);
    stepN(copy, 50);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('refuses a level that ended before its time without a full noise gauge, naming the flow', async () => {
    const live = await newNoisy();
    live.enqueue({ type: 'SetNoise', t: asSimMs(live.world.time.sim), pct: 100 });
    live.step();
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    snapshot.world.gauges.noisePct = 99;
    const target = await newNoisy();
    expect(() => target.restore(snapshot)).toThrow(/world\.flow\.state/);
    // And a level with no gauge cannot have ended early at all.
    const quiet = await createSim({
      content,
      geometry,
      level: createTestLevel({ durationMs: 5000, waves: [] }),
      seed: 5,
    });
    stepN(quiet, 10);
    const early = JSON.parse(JSON.stringify(quiet.snapshot()));
    early.world.flow = { state: 'ended', enteredAt: 100 };
    early.world.score.final = {
      laughPoints: 0,
      babyStatePoints: 0,
      sighPoints: 0,
      screamPoints: 0,
      scorePoints: 0,
      stars: 0,
      lostStars: 0,
    };
    const again = await createSim({
      content,
      geometry,
      level: createTestLevel({ durationMs: 5000, waves: [] }),
      seed: 5,
    });
    expect(() => again.restore(early)).toThrow(/world\.flow\.state/);
  });
});

describe('snapshot / restore of the noise and the cry (story 3.1)', () => {
  const noisyLevel = createTestLevel({
    waves: [testWave([CRYING_OUTLET], { disruptions: [testPhoneEntry(500)] })],
    objects: TEST_OBJECTS,
    gauges: NOISE_GAUGES,
  });
  const newNoisy = () => createSim({ content, geometry, level: noisyLevel, seed: 5 });

  /** Steps until the baby cries (the crying outlet missed), with the noise already moved by the phone. */
  async function crying() {
    const sim = await newNoisy();
    for (let i = 0; i < 5000 && sim.world.baby.cryStartedAt === null; i++) sim.step();
    expect(sim.world.baby.cryStartedAt).not.toBeNull();
    return sim;
  }

  it('carries noisePct, propNoiseAt (one per prop, null at the start) and the cry pair', async () => {
    const fresh = (await newNoisy()).snapshot().world;
    expect(fresh.gauges.noisePct).toBe(0);
    expect(fresh.gauges.propNoiseAt).toEqual(fresh.props.map(() => null));
    expect(fresh.baby).toMatchObject({ cryStartedAt: null, cryEndsAt: null });
    const mid = (await crying()).snapshot().world;
    expect(mid.baby.cryStartedAt).not.toBeNull();
    expect(mid.baby.cryEndsAt).toBeGreaterThan(mid.baby.cryStartedAt as number);
    expect(mid.gauges.noisePct).toBeGreaterThan(0);
  });

  it('restores a game taken mid-cry to the uninterrupted hash and journal', async () => {
    const live = await crying();
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<
      typeof live.snapshot
    >;
    const copy = await newNoisy();
    copy.restore(snapshot);
    stepN(live, 600);
    stepN(copy, 600);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    expect(copy.world.baby.cryStartedAt).toBeNull();
  });

  it('is deterministic: the same seed gives the same worldHash with the noise on', async () => {
    const run = async () => {
      const sim = await newNoisy();
      stepN(sim, 1500);
      return hashJson(sim.world);
    };
    expect(await run()).toBe(await run());
  });

  describe('refuses a damaged field, naming it', () => {
    type Damage = (w: Record<string, Record<string, unknown>>) => void;
    const gauges = (w: Record<string, Record<string, unknown>>) =>
      w.gauges as Record<string, unknown>;
    const baby = (w: Record<string, Record<string, unknown>>) => w.baby as Record<string, unknown>;
    const broken: [string, Damage, RegExp][] = [
      ['a noise above 100', (w) => (gauges(w).noisePct = 100.5), /world\.gauges\.noisePct/],
      ['a negative noise', (w) => (gauges(w).noisePct = -1), /world\.gauges\.noisePct/],
      ['a NaN noise', (w) => (gauges(w).noisePct = Number.NaN), /world\.gauges\.noisePct/],
      ['a noise that is a string', (w) => (gauges(w).noisePct = '5'), /world\.gauges\.noisePct/],
      ['no propNoiseAt', (w) => delete gauges(w).propNoiseAt, /world\.gauges\.propNoiseAt/],
      [
        'a propNoiseAt that is too short',
        (w) => (gauges(w).propNoiseAt = [null]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a propNoiseAt of the wrong length',
        (w) => (gauges(w).propNoiseAt = [null, null, null]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a negative propNoiseAt entry',
        (w) => (gauges(w).propNoiseAt = [-5, null]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a NaN propNoiseAt entry',
        (w) => (gauges(w).propNoiseAt = [null, Number.NaN]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a string propNoiseAt entry',
        (w) => (gauges(w).propNoiseAt = ['5', null]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a cry that starts and never ends',
        (w) => (baby(w).cryEndsAt = null),
        /world\.baby\.cryEndsAt/,
      ],
      [
        'a cry that ends and never started',
        (w) => {
          baby(w).cryStartedAt = null;
        },
        /world\.baby\.cryEndsAt/,
      ],
      [
        'a cry that ends before it started',
        (w) => (baby(w).cryEndsAt = -1),
        /world\.baby\.cryEndsAt/,
      ],
      ['a negative cryStartedAt', (w) => (baby(w).cryStartedAt = -2), /world\.baby\.cryStartedAt/],
      [
        'a cryStartedAt in the future',
        (w) => {
          baby(w).cryStartedAt = 1e9;
          baby(w).cryEndsAt = 2e9;
        },
        /world\.baby\.cryStartedAt/,
      ],
      [
        'a propNoiseAt entry in the future',
        (w) => (gauges(w).propNoiseAt = [1e9, null]),
        /world\.gauges\.propNoiseAt/,
      ],
      [
        'a NaN cryStartedAt',
        (w) => (baby(w).cryStartedAt = Number.NaN),
        /world\.baby\.cryStartedAt/,
      ],
    ];

    it.each(broken)('%s', async (_name, damage, expected) => {
      const live = await crying();
      const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
      damage(snapshot.world);
      const target = await newNoisy();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });
  });

  it('refuses a noise other than 0 in a level with no noise gauge', async () => {
    const plain = createTestLevel();
    const live = await createSim({ content, geometry, level: plain, seed: 9 });
    stepN(live, 5);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
    snapshot.world.gauges.noisePct = 12;
    const target = await createSim({ content, geometry, level: plain, seed: 9 });
    expect(() => target.restore(snapshot)).toThrow(/world\.gauges\.noisePct/);
  });
});

describe('snapshot / restore of carrying (story 4.1)', () => {
  const carryLevel = createTestLevel({
    waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
    carry: CARRY,
  });
  const playpen = geometry.zones.find((zone) => zone.id === 'playpen');
  const newSim = () => createSim({ content, geometry, level: carryLevel, seed: 5 });

  /** A sim with the baby still and next to Papa, taken (or not) at once. */
  async function atTheBaby(isCarried: boolean) {
    const sim = await newSim();
    const world = sim.world as World;
    world.baby.xM = world.papa.xM - 0.5;
    world.baby.zM = world.papa.zM;
    world.baby.wanderAt = asSimMs(1_000_000);
    if (isCarried) {
      sim.enqueue({ type: 'TapBaby', t: asSimMs(world.time.sim) });
      sim.step();
    }
    return sim;
  }

  const roundTrip = (sim: Sim) =>
    JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;

  it('round-trips a carried world, with its cry in the arms due, to the same hash', async () => {
    const live = await atTheBaby(true);
    expect(live.world.baby.state).toBe('carried');
    expect(live.world.carry.armsCryAt).not.toBeNull();
    const snapshot = roundTrip(live);
    expect(snapshot.version).toBe(19);
    const copy = await newSim();
    copy.restore(snapshot);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    stepN(live, 1500);
    stepN(copy, 1500);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('round-trips a world mid-walk with each intent', async () => {
    const taking = await atTheBaby(false);
    (taking.world as World).baby.xM = -0.5;
    taking.enqueue({ type: 'TapBaby', t: asSimMs(taking.world.time.sim) });
    stepN(taking, 5);
    expect(taking.world.papa).toMatchObject({ state: 'walkPath', intent: 'takeBaby' });
    const takingCopy = await newSim();
    takingCopy.restore(roundTrip(taking));
    expect(hashJson(takingCopy.world)).toBe(hashJson(taking.world));
    stepN(taking, 400);
    stepN(takingCopy, 400);
    expect(taking.world.baby.state).toBe('carried');
    expect(hashJson(takingCopy.world)).toBe(hashJson(taking.world));

    const putting = await atTheBaby(true);
    putting.enqueue({
      type: 'TapFloor',
      t: asSimMs(putting.world.time.sim),
      xM: playpen?.centerM[0] ?? 0,
      zM: playpen?.centerM[2] ?? 0,
    });
    stepN(putting, 5);
    expect(putting.world.papa).toMatchObject({ state: 'walkPath', intent: 'putDownBaby' });
    const puttingCopy = await newSim();
    puttingCopy.restore(roundTrip(putting));
    stepN(putting, 400);
    stepN(puttingCopy, 400);
    expect(putting.world.baby.state).not.toBe('carried');
    expect(hashJson(puttingCopy.world)).toBe(hashJson(putting.world));
  });

  describe('refuses a damaged slice, naming the field', () => {
    const broken: [
      string,
      (world: Record<string, Record<string, unknown>>) => void,
      boolean,
      RegExp,
    ][] = [
      ['no carry slice', (w) => delete w.carry, false, /world\.carry is missing/],
      [
        'a cry due while the baby is not carried',
        (w) => {
          w.carry.armsCryAt = 5000;
        },
        false,
        /world\.carry\.armsCryAt/,
      ],
      [
        'a cry due that is not a number',
        (w) => {
          w.carry.armsCryAt = 'soon';
        },
        true,
        /world\.carry\.armsCryAt/,
      ],
      [
        'a carried baby with no cry due in a level that has a cry in the arms',
        (w) => {
          w.carry.armsCryAt = null;
        },
        true,
        /world\.carry\.armsCryAt/,
      ],
      [
        'an unknown intent',
        (w) => {
          w.papa.intent = 'cuddle';
        },
        false,
        /world\.papa\.intent/,
      ],
      [
        'an intent while Papa is idle',
        (w) => {
          w.papa.intent = 'takeBaby';
        },
        false,
        /world\.papa\.intent/,
      ],
      [
        'a carried baby away from Papa',
        (w) => {
          w.baby.xM = (w.baby.xM as number) + 1;
        },
        true,
        /world\.baby\.xM/,
      ],
      [
        'a carried baby who crawls to a threat',
        (w) => {
          w.baby.targetThreatId = 1;
        },
        true,
        /world\.baby\.targetThreatId/,
      ],
      [
        'a carried baby with a path',
        (w) => {
          w.baby.path = [0, 0, 1, 1];
        },
        true,
        /world\.baby\.path/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, isCarried, message) => {
      const live = await atTheBaby(isCarried);
      const snapshot = roundTrip(live);
      damage(snapshot.world as unknown as Record<string, Record<string, unknown>>);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(message);
    });

    it('refuses a take intent with a carried baby, and a put-down intent with a free one', async () => {
      const carried = await atTheBaby(true);
      carried.enqueue({
        type: 'TapFloor',
        t: asSimMs(carried.world.time.sim),
        xM: playpen?.centerM[0] ?? 0,
        zM: playpen?.centerM[2] ?? 0,
      });
      stepN(carried, 3);
      const wrongTake = roundTrip(carried);
      (wrongTake.world.papa as { intent: string }).intent = 'takeBaby';
      expect(() => carried.restore(wrongTake)).toThrow(/world\.papa\.intent/);

      const free = await atTheBaby(false);
      (free.world as World).baby.xM = -0.5;
      free.enqueue({ type: 'TapBaby', t: asSimMs(free.world.time.sim) });
      stepN(free, 3);
      const wrongPut = roundTrip(free);
      (wrongPut.world.papa as { intent: string }).intent = 'putDownBaby';
      expect(() => free.restore(wrongPut)).toThrow(/world\.papa\.intent/);
    });
  });
});

describe('snapshot / restore of the combo (story 4.2)', () => {
  // No cry in the arms: an unanswered one is a gag, which would reset the combo under test.
  const carryLevel = createTestLevel({
    waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
    carry: {},
  });
  const newSim = () => createSim({ content, geometry, level: carryLevel, seed: 5 });
  const roundTrip = (sim: Sim) =>
    JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;

  /** A sim whose baby is next to Papa, taken (or not) at once. */
  async function atTheBaby(isCarried: boolean) {
    const sim = await newSim();
    const world = sim.world as World;
    world.baby.xM = world.papa.xM - 0.5;
    world.baby.zM = world.papa.zM;
    world.baby.wanderAt = asSimMs(1_000_000);
    if (isCarried) {
      sim.enqueue({ type: 'TapBaby', t: asSimMs(world.time.sim) });
      sim.step();
    }
    return sim;
  }

  it('starts at rest, and round-trips a carried world mid-combo to the same hash', async () => {
    const fresh = await newSim();
    expect(fresh.world.combo).toEqual({
      multiplier: content.feel.combo.minMultiplier,
      basePoints: 0,
      carryTickAt: null,
    });
    expect(fresh.world.score.comboPoints).toBe(0);

    const live = await atTheBaby(true);
    const tickMs = content.feel.combo.carryTickMs;
    stepN(live, Math.ceil((tickMs + 500) / STEP_MS));
    expect(live.world.combo.multiplier).toBe(content.feel.combo.minMultiplier + 1);
    expect(live.world.combo.carryTickAt).not.toBeNull();
    const snapshot = roundTrip(live);
    expect(snapshot.version).toBe(19);
    const copy = await newSim();
    copy.restore(snapshot);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    stepN(live, 1500);
    stepN(copy, 1500);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('restores the cash-in slow-mo source', async () => {
    const live = await atTheBaby(true);
    (live.world as World).time.slowMos.push({
      source: 'comboCashIn',
      scale: 0.25,
      startedAt: asSimMs(0),
      holdUntil: asSimMs(1000),
      endsAt: asSimMs(1300),
    });
    const copy = await newSim();
    copy.restore(roundTrip(live));
    expect(copy.world.time.slowMos.map((slowMo) => slowMo.source)).toEqual(['comboCashIn']);
  });

  describe('refuses a damaged slice, naming the field', () => {
    type Damage = (world: Record<string, Record<string, unknown>>) => void;
    const broken: [string, Damage, boolean, RegExp][] = [
      ['no combo slice', (w) => delete w.combo, false, /world\.combo is missing/],
      [
        'a zero multiplier',
        (w) => {
          w.combo.multiplier = 0;
        },
        false,
        /world\.combo\.multiplier/,
      ],
      [
        'a fractional multiplier',
        (w) => {
          w.combo.multiplier = 2.5;
        },
        false,
        /world\.combo\.multiplier/,
      ],
      [
        'negative base points',
        (w) => {
          w.combo.basePoints = -0.5;
        },
        false,
        /world\.combo\.basePoints/,
      ],
      [
        'base points that are not a number',
        (w) => {
          w.combo.basePoints = 'lots';
        },
        true,
        /world\.combo\.basePoints/,
      ],
      [
        'a tick due while the baby is not carried',
        (w) => {
          w.combo.carryTickAt = 5000;
        },
        false,
        /world\.combo\.carryTickAt/,
      ],
      [
        'no tick due while the baby is carried',
        (w) => {
          w.combo.carryTickAt = null;
        },
        true,
        /world\.combo\.carryTickAt/,
      ],
      [
        'a tick that is not a number',
        (w) => {
          w.combo.carryTickAt = 'soon';
        },
        true,
        /world\.combo\.carryTickAt/,
      ],
      [
        'negative combo points',
        (w) => {
          w.score.comboPoints = -1;
        },
        false,
        /world\.score\.comboPoints/,
      ],
      [
        'combo points that are not a number',
        (w) => {
          w.score.comboPoints = 'many';
        },
        false,
        /world\.score\.comboPoints/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, isCarried, message) => {
      const live = await atTheBaby(isCarried);
      const snapshot = roundTrip(live);
      damage(snapshot.world as unknown as Record<string, Record<string, unknown>>);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(message);
    });
  });
});

describe('snapshot / restore of the pressing need (story 4.3)', () => {
  const needLevel = createTestLevel({
    objects: [...TEST_OBJECTS, TEST_TOILET],
    gauges: NEED_GAUGES,
    carry: CARRY,
  });
  const newSim = () => createSim({ content, geometry, level: needLevel, seed: 5 });
  const roundTrip = (sim: Sim) =>
    JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;

  /** Papa is mid-toilet and the need is full (frozen at 100 for the visit). */
  async function onToilet(): Promise<Sim> {
    const sim = await newSim();
    sim.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 100 });
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'toilet' });
    for (let i = 0; i < 5000 && sim.world.papa.state !== 'onToilet'; i++) sim.step();
    expect(sim.world.papa.state).toBe('onToilet');
    stepN(sim, 100);
    return sim;
  }

  it('is version 19 and carries the gauge and the flag', async () => {
    const fresh = await newSim();
    const snapshot = roundTrip(fresh);
    expect(snapshot.version).toBe(19);
    expect(snapshot.world.gauges).toMatchObject({ bladderPct: 0, isBladderFull: false });
  });

  it('round-trips a Papa mid-toilet with a full gauge to the uninterrupted hash', async () => {
    const live = await onToilet();
    const snapshot = roundTrip(live);
    expect(snapshot.world.papa.state).toBe('onToilet');
    expect(snapshot.world.gauges).toMatchObject({ bladderPct: 100, isBladderFull: true });
    const copy = await newSim();
    copy.restore(snapshot);
    stepN(live, 700);
    stepN(copy, 700);
    expect(copy.world.papa.state).toBe('idle');
    expect(copy.world.gauges.bladderPct).toBeLessThan(100);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  describe('refuses a damaged field, naming it', () => {
    type Damage = (w: Record<string, Record<string, unknown>>) => void;
    const gauges = (w: Record<string, Record<string, unknown>>) =>
      w.gauges as Record<string, unknown>;
    const broken: [string, Damage, RegExp][] = [
      ['a need above 100', (w) => (gauges(w).bladderPct = 100.5), /world\.gauges\.bladderPct/],
      ['a negative need', (w) => (gauges(w).bladderPct = -1), /world\.gauges\.bladderPct/],
      ['a NaN need', (w) => (gauges(w).bladderPct = Number.NaN), /world\.gauges\.bladderPct/],
      ['a need that is a string', (w) => (gauges(w).bladderPct = '5'), /world\.gauges\.bladderPct/],
      ['no need', (w) => delete gauges(w).bladderPct, /world\.gauges\.bladderPct/],
      [
        'a full flag that is not a boolean',
        (w) => (gauges(w).isBladderFull = 1),
        /world\.gauges\.isBladderFull/,
      ],
      ['no full flag', (w) => delete gauges(w).isBladderFull, /world\.gauges\.isBladderFull/],
      [
        'a baby carried while Papa is on the toilet',
        (w) => {
          (w.baby as Record<string, unknown>).state = 'carried';
        },
        /world\.papa\.state/,
      ],
    ];

    it.each(broken)('%s', async (_name, damage, expected) => {
      const snapshot = roundTrip(await onToilet());
      damage(snapshot.world as unknown as Record<string, Record<string, unknown>>);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });
  });

  it('does not hold the flag to the feel: a SetFeel can move the threshold', async () => {
    const live = await newSim();
    live.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 60 });
    live.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: { bladder: { slowFromPct: 50 } } });
    stepN(live, 5);
    expect(live.world.gauges.isBladderFull).toBe(true);
    const snapshot = roundTrip(live);
    expect(snapshot.world.gauges.bladderPct).toBeLessThan(100);
    const target = await newSim();
    expect(() => target.restore(snapshot)).not.toThrow();
  });

  it('refuses Papa on the toilet in a level with no need gauge', async () => {
    // `content:check` refuses such a level; the sim runs it all the same, and a snapshot of it must
    // not be taken for a good one.
    const doorOnly = createTestLevel({ objects: [...TEST_OBJECTS, TEST_TOILET] });
    const live = await createSim({ content, geometry, level: doorOnly, seed: 5 });
    live.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'toilet' });
    for (let i = 0; i < 5000 && live.world.papa.state !== 'onToilet'; i++) live.step();
    expect(live.world.papa.state).toBe('onToilet');
    const snapshot = roundTrip(live);
    const target = await createSim({ content, geometry, level: doorOnly, seed: 5 });
    expect(() => target.restore(snapshot)).toThrow(/world\.papa\.state/);
  });

  it('refuses a need or a full flag in a level with no need gauge', async () => {
    const plain = createTestLevel();
    const live = await createSim({ content, geometry, level: plain, seed: 9 });
    stepN(live, 5);
    for (const [key, value, message] of [
      ['bladderPct', 12, /world\.gauges\.bladderPct/],
      ['isBladderFull', true, /world\.gauges\.isBladderFull/],
    ] as const) {
      const snapshot = JSON.parse(JSON.stringify(live.snapshot()));
      snapshot.world.gauges[key] = value;
      const target = await createSim({ content, geometry, level: plain, seed: 9 });
      expect(() => target.restore(snapshot), key).toThrow(message);
    }
  });
});
