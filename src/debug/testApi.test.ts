import type { ActiveLevel, LevelSession, LevelStartOutcome } from '@client/app/levelSession';
import { ADVANCE_MAX_STEPS, STEP_MS, UINT32_RANGE } from '@shared/constants';
import { log } from '@shared/log';
import { createSim, type Sim, type SimEvent } from '@sim';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeTestHost, type FakeTestHost } from '../../tests/support/fakeTestHost.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from '../../tests/support/testContent.ts';
import { createTestApi, installTestApi, type PPTestApi } from './testApi.ts';

beforeAll(() => {
  log.setLevel('error');
});

const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
afterEach(() => warnSpy.mockClear());

async function newSim(seed = 1): Promise<Sim> {
  return createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel([outletEntry(2000)]),
    seed,
    strictInvariants: true,
  });
}

interface Rig {
  api: PPTestApi;
  host: FakeTestHost;
  session: FakeSession;
  sim: Sim;
  /** Fires the event log the way the app does for a level: a started level, then its events. */
  startLevel(seed?: number): Promise<Sim>;
}

interface FakeSession extends LevelSession {
  active: ActiveLevel | null;
  current: {
    levelId: string;
    seed: number | null;
    feel: ReturnType<typeof createTestContent>['feel'];
  };
  isFrozen: boolean;
  startCalls: unknown[];
  freezeCalls: boolean[];
  outcome: LevelStartOutcome;
}

async function createRig(options: { eventLogMax?: number } = {}): Promise<Rig> {
  const content = createTestContent();
  const sim = await newSim();
  // The fake: the host and the session know each other through these closures.
  const holder: { host?: FakeTestHost } = {};
  const session = {
    active: { sim, level: createTestLevel([outletEntry(2000)]), timeMap: {} as never },
    current: { levelId: 'salon_crawler', seed: 1 as number | null, feel: content.feel },
    isFrozen: false,
    startCalls: [] as unknown[],
    freezeCalls: [] as boolean[],
    outcome: 'started' as LevelStartOutcome,
    start: async (startOptions?: unknown) => {
      session.startCalls.push(startOptions);
      return session.outcome;
    },
    stop: () => {},
    freeze(next: boolean) {
      session.freezeCalls.push(next);
      session.isFrozen = next;
    },
    advance(steps: number) {
      session.isFrozen = true;
      for (let i = 0; i < steps; i++) {
        session.active?.sim.step();
        for (const event of session.active?.sim.drainEvents() ?? []) {
          holder.host?.fireSimEvent(event);
        }
      }
    },
  } as unknown as FakeSession;
  const host = createFakeTestHost({ content, levelSession: session });
  holder.host = host;
  const api = createTestApi(host, { eventLogMax: options.eventLogMax });
  const startLevel = async (seed = 1): Promise<Sim> => {
    const next = await newSim(seed);
    session.active = {
      sim: next,
      level: createTestLevel([outletEntry(2000)]),
      timeMap: {} as never,
    };
    host.fireLevelStarted({
      sim: next,
      levelId: 'salon_crawler',
      seed,
      level: createTestLevel([outletEntry(2000)]),
      feel: content.feel,
    });
    return next;
  };
  host.fireLevelStarted({
    sim,
    levelId: 'salon_crawler',
    seed: 1,
    level: createTestLevel([outletEntry(2000)]),
    feel: content.feel,
  });
  return { api, host, session, sim, startLevel };
}

const fakeEvent = (n: number): SimEvent =>
  ({
    type: 'BabyStateChanged',
    t: n * STEP_MS,
    from: 'babble',
    to: 'crawl',
  }) as unknown as SimEvent;

describe('state()', () => {
  it('is null when no level is running', async () => {
    const { api, session } = await createRig();
    session.active = null;
    expect(api.state()).toBeNull();
  });

  it("is a copy of the running level's world: changing it changes nothing in the sim", async () => {
    const { api, sim } = await createRig();
    const world = api.state();
    expect(world?.time.sim).toBe(0);
    if (world !== null) world.time.sim = 999 as never;
    expect(sim.world.time.sim).toBe(0);
    expect(api.state()).not.toBe(api.state());
  });
});

describe('events(since)', () => {
  it('returns every event of the level in order, and only the newer ones for a cursor', async () => {
    const { api, host } = await createRig();
    for (let i = 0; i < 5; i++) host.fireSimEvent(fakeEvent(i));
    expect(api.events()).toHaveLength(5);
    const seen = api.events();
    host.fireSimEvent(fakeEvent(5));
    host.fireSimEvent(fakeEvent(6));
    expect(api.events(seen.length).map((event) => event.t)).toEqual([5 * STEP_MS, 6 * STEP_MS]);
    expect(api.events(7)).toEqual([]);
    expect(api.events(100)).toEqual([]);
  });

  it('keeps a copy of each event (the loop reuses its array) and hands out a new array each time', async () => {
    const { api, host } = await createRig();
    const event = fakeEvent(1) as { t: number };
    host.fireSimEvent(event as unknown as SimEvent);
    event.t = 12345; // the sim reuses and rewrites what it drained
    const first = api.events();
    expect(first[0]?.t).toBe(STEP_MS);
    expect(api.events()).not.toBe(first);
    // The events handed out are copies too: rewriting one does not rewrite the log.
    (first[0] as { t: number }).t = 999;
    expect(api.events()[0]?.t).toBe(STEP_MS);
  });

  it('starts over at each new level: the indices restart at 0', async () => {
    const { api, host, startLevel } = await createRig();
    host.fireSimEvent(fakeEvent(1));
    host.fireSimEvent(fakeEvent(2));
    expect(api.events()).toHaveLength(2);
    await startLevel(2);
    expect(api.events()).toEqual([]);
    host.fireSimEvent(fakeEvent(3));
    expect(api.events(0)).toHaveLength(1);
  });

  it('drops the oldest beyond its cap with one warning, and the indices stay absolute', async () => {
    const { api, host } = await createRig({ eventLogMax: 3 });
    for (let i = 0; i < 5; i++) host.fireSimEvent(fakeEvent(i));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(api.events().map((event) => event.t)).toEqual([2, 3, 4].map((i) => i * STEP_MS));
    // A cursor older than the oldest kept returns from the oldest; a newer one is absolute.
    expect(api.events(0)).toHaveLength(3);
    expect(api.events(3).map((event) => event.t)).toEqual([3 * STEP_MS, 4 * STEP_MS]);
    host.fireSimEvent(fakeEvent(5));
    expect(api.events(5).map((event) => event.t)).toEqual([5 * STEP_MS]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a cursor that is not a whole number >= 0', async () => {
    const { api } = await createRig();
    for (const since of [-1, 1.5, Number.NaN]) {
      expect(() => api.events(since)).toThrow('__PP__.events');
    }
  });
});

describe('send(cmd)', () => {
  it('applies a command at the next step when t is omitted, and journals it on the sim time', async () => {
    const { api, sim } = await createRig();
    api.send({ type: 'TapFloor', xM: 1, zM: 1 });
    const entry = sim.journal().entries.at(-1);
    expect(entry?.command).toMatchObject({ type: 'TapFloor', xM: 1, zM: 1, t: 0 });
    for (let i = 0; i < 3; i++) sim.step();
    api.send({ type: 'MoveStop' });
    expect(sim.journal().entries.at(-1)?.command.t).toBe(3 * STEP_MS);
  });

  it('keeps an explicit t', async () => {
    const { api, sim } = await createRig();
    api.send({ type: 'TapFloor', t: 50, xM: 1, zM: 1 });
    expect(sim.journal().entries.at(-1)?.command.t).toBe(50);
  });

  it("throws with the sim's message on a malformed command, and the sim goes on", async () => {
    const { api, sim } = await createRig();
    expect(() => api.send({ type: 'Move', dirX: 0, dirZ: 0 })).toThrow(
      /__PP__\.send:.*the direction must not be \(0, 0\)/,
    );
    expect(sim.journal().entries).toHaveLength(0);
    sim.step();
    expect(sim.world.time.sim).toBe(STEP_MS);
  });

  it('throws when no level is running', async () => {
    const { api, session } = await createRig();
    session.active = null;
    expect(() => api.send({ type: 'MoveStop' })).toThrow('__PP__.send: no level is running');
  });
});

describe('advance(steps) and freeze(on)', () => {
  it('runs exactly n steps through the session and gives their events to the log', async () => {
    const { api, sim } = await createRig();
    api.advance(40);
    expect(sim.world.time.sim).toBe(40 * STEP_MS);
    api.send({ type: 'TapFloor', xM: 1, zM: 1 });
    api.advance(2);
    expect(api.events().some((event) => event.type === 'PapaStateChanged')).toBe(true);
  });

  it('throws on a count that is not an integer in [0, ADVANCE_MAX_STEPS], and on no level', async () => {
    const { api, session, sim } = await createRig();
    for (const steps of [1.5, -1, ADVANCE_MAX_STEPS + 1, Number.NaN]) {
      expect(() => api.advance(steps)).toThrow(
        `__PP__.advance: steps must be an integer in [0, ${ADVANCE_MAX_STEPS}], got ${steps}`,
      );
    }
    expect(sim.world.time.sim).toBe(0);
    session.active = null;
    expect(() => api.advance(1)).toThrow('__PP__.advance: no level is running');
  });

  it('freeze delegates to the session, with or without a level', async () => {
    const { api, session } = await createRig();
    api.freeze(true);
    session.active = null;
    api.freeze(false);
    expect(session.freezeCalls).toEqual([true, false]);
    expect(() => api.freeze('yes' as never)).toThrow('__PP__.freeze');
  });
});

describe('loadLevel(id, seed)', () => {
  it('starts that level with that seed and resolves once the countdown is over', async () => {
    const { api, host, session } = await createRig();
    host.setPause('resuming');
    let isDone = false;
    const loading = api.loadLevel('salon_crawler', 7).then(() => {
      isDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.startCalls).toEqual([{ levelId: 'salon_crawler', seed: 7 }]);
    expect(isDone).toBe(false);
    host.setPause('running');
    host.fireGameResumed();
    await loading;
    expect(isDone).toBe(true);
  });

  it('resolves at once when the level is already running', async () => {
    const { api, host } = await createRig();
    host.setPause('running');
    await expect(api.loadLevel('salon_crawler', 0)).resolves.toBeUndefined();
  });

  it('rejects, naming the level, when the load fails (« Oups »), is ignored or goes stale', async () => {
    const { api, session } = await createRig();
    for (const outcome of ['failed', 'ignored', 'stale'] as const) {
      session.outcome = outcome;
      await expect(api.loadLevel('nowhere', 1)).rejects.toThrow(/__PP__\.loadLevel.*nowhere/);
    }
  });

  it('rejects a seed that is not an integer in [0, 2**32), and an empty id, before starting anything', async () => {
    const { api, session } = await createRig();
    for (const seed of [-1, 1.5, UINT32_RANGE, Number.NaN]) {
      await expect(api.loadLevel('salon_crawler', seed)).rejects.toThrow('__PP__.loadLevel');
    }
    await expect(api.loadLevel('', 1)).rejects.toThrow('__PP__.loadLevel');
    expect(session.startCalls).toEqual([]);
  });
});

describe('setFeel(patch)', () => {
  it('restarts the current level with the same seed and the patch merged onto the current feel', async () => {
    const { api, host, session } = await createRig();
    host.setPause('running');
    const base = session.current.feel;
    await api.setFeel({ movement: { walkSpeedMps: 2 * base.movement.walkSpeedMps } });
    expect(session.startCalls).toHaveLength(1);
    const call = session.startCalls[0] as { levelId: string; seed: number; feel: typeof base };
    expect(call.levelId).toBe('salon_crawler');
    expect(call.seed).toBe(1);
    expect(call.feel.movement.walkSpeedMps).toBe(2 * base.movement.walkSpeedMps);
    expect(call.feel.timing).toEqual(base.timing);
  });

  it('merges onto the override already in force, not onto the boot feel', async () => {
    const { api, host, session } = await createRig();
    host.setPause('running');
    const base = session.current.feel;
    const patched = { ...base, movement: { ...base.movement, walkSpeedMps: 3 } };
    session.current = { ...session.current, feel: patched };
    await api.setFeel({ timing: { windowMs: 500 } });
    const call = session.startCalls[0] as { feel: typeof base };
    expect(call.feel.movement.walkSpeedMps).toBe(3);
    expect(call.feel.timing.windowMs).toBe(500);
  });

  it('rejects an invalid patch with the paths, and restarts nothing', async () => {
    const { api, session } = await createRig();
    await expect(api.setFeel({ timing: { windowMs: -1 } } as never)).rejects.toThrow(
      /__PP__\.setFeel.*timing\.windowMs/,
    );
    await expect(api.setFeel({ nope: 1 } as never)).rejects.toThrow('__PP__.setFeel');
    expect(session.startCalls).toEqual([]);
  });

  it('rejects when no level is running', async () => {
    const { api, session } = await createRig();
    session.active = null;
    await expect(api.setFeel({})).rejects.toThrow('__PP__.setFeel: no level is running');
  });

  it('rejects when the restart fails', async () => {
    const { api, session } = await createRig();
    session.outcome = 'failed';
    await expect(api.setFeel({})).rejects.toThrow('__PP__.setFeel');
  });
});

describe('installTestApi', () => {
  it('sets __PP__ once, and a second call is a no-op with a warning', async () => {
    const host = createFakeTestHost();
    const target: { __PP__?: PPTestApi } = {};
    installTestApi(target, host);
    const first = target.__PP__;
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ['advance', 'events', 'freeze', 'loadLevel', 'send', 'setFeel', 'state'].sort(),
    );
    installTestApi(target, host);
    expect(target.__PP__).toBe(first);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
