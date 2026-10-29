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
  OUTLET,
  testWave,
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
    level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
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
    active: {
      sim,
      level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
      timeMap: {} as never,
    },
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
    rememberFeel(feel: unknown) {
      session.current = { ...session.current, feel: feel as FakeSession['current']['feel'] };
    },
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
      level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
      timeMap: {} as never,
      geometry: createTestGeometry(),
      feel: content.feel,
    };
    host.fireLevelStarted({
      sim: next,
      levelId: 'salon_crawler',
      seed,
      level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
      feel: content.feel,
    });
    return next;
  };
  host.fireLevelStarted({
    sim,
    levelId: 'salon_crawler',
    seed: 1,
    level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
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
  it('enqueues the journaled SetFeel at the current sim time, and restarts nothing', async () => {
    const { api, session, sim } = await createRig();
    const base = sim.world.feel;
    for (let i = 0; i < 7; i++) sim.step();
    await api.setFeel({ movement: { walkSpeedMps: 2 * base.movement.walkSpeedMps } });
    expect(session.startCalls).toEqual([]);
    const entries = sim.journal().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.command).toEqual({
      type: 'SetFeel',
      t: sim.world.time.sim,
      patch: { movement: { walkSpeedMps: 2 * base.movement.walkSpeedMps } },
    });
    // Applied at the next step, not before.
    expect(sim.world.feel.movement.walkSpeedMps).toBe(base.movement.walkSpeedMps);
    sim.step();
    expect(sim.world.feel.movement.walkSpeedMps).toBe(2 * base.movement.walkSpeedMps);
    expect(sim.world.feel.timing).toEqual(base.timing);
  });

  it('lays the patch over the feel in force in the sim, so two patches add up', async () => {
    const { api, sim } = await createRig();
    await api.setFeel({ timing: { windowMs: 500 } });
    sim.step();
    await api.setFeel({ movement: { walkSpeedMps: 3 } });
    sim.step();
    expect(sim.world.feel.timing.windowMs).toBe(500);
    expect(sim.world.feel.movement.walkSpeedMps).toBe(3);
  });

  it('checks a patch against the SetFeels still queued: back to back, the second sees the first', async () => {
    const { api, sim } = await createRig();
    const { windowMs, perfectMs } = sim.world.feel.timing;
    // Alone, each is valid against the feel in force; together they would leave perfectMs > windowMs.
    const narrowedWindowMs = perfectMs + 50;
    const widenedPerfectMs = narrowedWindowMs + 25;
    expect(widenedPerfectMs).toBeLessThanOrEqual(windowMs);
    await api.setFeel({ timing: { windowMs: narrowedWindowMs } });
    await expect(api.setFeel({ timing: { perfectMs: widenedPerfectMs } })).rejects.toThrow(
      /__PP__\.setFeel.*perfectMs/,
    );
    // No step ran in between, and the refused patch was not queued.
    expect(sim.journal().entries).toHaveLength(1);
    sim.step();
    expect(sim.world.feel.timing.windowMs).toBe(narrowedWindowMs);
    expect(sim.world.feel.timing.perfectMs).toBe(perfectMs);
  });

  it('accepts, in the reverse order, what the queue makes valid: no step needed in between', async () => {
    const { api, sim } = await createRig();
    const { windowMs, perfectMs } = sim.world.feel.timing;
    const loweredPerfectMs = perfectMs - 40;
    const loweredWindowMs = perfectMs - 20;
    // Against `world.feel` alone the second would be refused: perfectMs (still the old one) > windowMs.
    expect(loweredWindowMs).toBeLessThan(perfectMs);
    expect(loweredWindowMs).toBeLessThan(windowMs);
    await api.setFeel({ timing: { perfectMs: loweredPerfectMs } });
    await api.setFeel({ timing: { windowMs: loweredWindowMs } });
    expect(sim.journal().entries).toHaveLength(2);
    sim.step();
    expect(sim.world.feel.timing.perfectMs).toBe(loweredPerfectMs);
    expect(sim.world.feel.timing.windowMs).toBe(loweredWindowMs);
  });

  it('stops folding a SetFeel once the sim has applied it (its effect is in world.feel)', async () => {
    const { api, sim } = await createRig();
    await api.setFeel({ timing: { windowMs: 200 } });
    sim.step();
    // 150 <= 200 is valid on the applied feel; 250 is not (the applied window is 200, not the old 300).
    await api.setFeel({ timing: { perfectMs: 150 } });
    await expect(api.setFeel({ timing: { perfectMs: 250 } })).rejects.toThrow(/perfectMs/);
  });

  it('refuses a new key of a record (physics.kinds.new_kind): the sim would drop it', async () => {
    const { api, sim } = await createRig();
    const kind = Object.values(sim.world.feel.physics.kinds)[0];
    await expect(api.setFeel({ physics: { kinds: { new_kind: kind } } } as never)).rejects.toThrow(
      /__PP__\.setFeel.*physics\.kinds\.new_kind/,
    );
    expect(sim.journal().entries).toEqual([]);
  });

  it('becomes the feel a restart uses, with the earlier tuning kept', async () => {
    const { api, session } = await createRig();
    await api.setFeel({ timing: { windowMs: 500 } });
    await api.setFeel({ movement: { walkSpeedMps: 3 } });
    expect(session.current.feel.timing.windowMs).toBe(500);
    expect(session.current.feel.movement.walkSpeedMps).toBe(3);
  });

  it('warns and goes on when the patch cannot be kept for a restart', async () => {
    const { api, session, sim } = await createRig();
    // The restart base is already tuned so that this patch would break `perfectMs <= windowMs` there.
    const tuned = session.current.feel;
    session.current = {
      ...session.current,
      feel: { ...tuned, timing: { ...tuned.timing, perfectMs: tuned.timing.windowMs + 10 } },
    };
    await api.setFeel({ timing: { windowMs: tuned.timing.windowMs + 5 } });
    expect(sim.journal().entries).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith('debug', expect.stringContaining('not kept'), {
      reason: expect.any(String),
    });
  });

  it('rejects an invalid patch with the paths, and sends nothing', async () => {
    const { api, session, sim } = await createRig();
    await expect(api.setFeel({ timing: { windowMs: -1 } } as never)).rejects.toThrow(
      /__PP__\.setFeel.*timing\.windowMs/,
    );
    await expect(api.setFeel({ nope: 1 } as never)).rejects.toThrow('__PP__.setFeel');
    // The cross-field rule is checked too: the perfect window may not exceed the window.
    await expect(api.setFeel({ timing: { perfectMs: 1e6 } } as never)).rejects.toThrow(/perfectMs/);
    expect(session.startCalls).toEqual([]);
    expect(sim.journal().entries).toEqual([]);
  });

  it('rejects when no level is running', async () => {
    const { api, session } = await createRig();
    session.active = null;
    await expect(api.setFeel({})).rejects.toThrow('__PP__.setFeel: no level is running');
  });

  it('no longer warns about an input patch: the client reads the live feel', async () => {
    const { api } = await createRig();
    await api.setFeel({ input: { touchRadiusPx: 99 } });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('perf()', () => {
  it('is all zeros before a frame, then measures the frames the app draws', async () => {
    const { api, host } = await createRig();
    expect(api.perf().frames).toBe(0);
    for (let i = 0; i < 100; i++) host.fireRenderedFrame(i * 20, { drawCalls: 12 + (i % 5) });
    const report = api.perf();
    expect(report.frames).toBe(100);
    expect(report.frameMsP95).toBe(20);
    expect(report.frameMsMax).toBeCloseTo(20, 6);
    expect(report.drawCallsMax).toBe(16);
    expect(report.trianglesMax).toBe(1000);
    expect(Math.round(report.fpsLastSecond)).toBe(50);
  });

  it('starts over at each new level', async () => {
    const { api, host, startLevel } = await createRig();
    for (let i = 0; i < 10; i++) host.fireRenderedFrame(i * 20);
    await startLevel(2);
    expect(api.perf().frames).toBe(0);
    host.fireRenderedFrame(5000);
    expect(api.perf().frames).toBe(1);
  });

  it('returns a copy: changing it changes nothing, and a later call sees the newer frames', async () => {
    const { api, host } = await createRig();
    host.fireRenderedFrame(0);
    const first = api.perf();
    first.frames = 999;
    host.fireRenderedFrame(20);
    const second = api.perf();
    expect(second).not.toBe(first);
    expect(second.frames).toBe(2);
    expect(first.frames).toBe(999);
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
      ['advance', 'events', 'freeze', 'loadLevel', 'perf', 'send', 'setFeel', 'state'].sort(),
    );
    installTestApi(target, host);
    expect(target.__PP__).toBe(first);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
