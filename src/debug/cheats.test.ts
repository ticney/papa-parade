import { DEBUG_SKIP_CHUNK_STEPS, GAUGE_MAX_POINTS, MIN_TIME_SCALE } from '@shared/constants';
import { log } from '@shared/log';
import { createSim, type Sim } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  STAIRS,
  testWave,
} from '../../tests/support/testContent.ts';
import {
  CHEATS,
  clampTimeScale,
  createCheatContext,
  createSkipToEnd,
  launchableThreats,
  launchThreat,
} from './cheats.ts';

beforeAll(() => {
  log.setLevel('error');
});

const LEVEL_DURATION_MS = 3000;

async function rig(options: { isActive?: boolean; hasFatigue?: boolean } = {}) {
  const level = createTestLevel({
    waves: [testWave([OUTLET, STAIRS])],
    durationMs: LEVEL_DURATION_MS,
    ...(options.hasFatigue ? { gauges: FATIGUE_GAUGES } : {}),
  });
  const sim: Sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level,
    seed: 3,
  });
  const advanced: number[] = [];
  const session = {
    active: options.isActive === false ? null : { sim, level, geometry: createTestGeometry() },
    advance(steps: number) {
      if (session.active === null) throw new Error('no level is running');
      advanced.push(steps);
      for (let i = 0; i < steps; i++) sim.step();
    },
  };
  const host = createFakeTestHost({ levelSession: session as never });
  return { sim, host, session, advanced, level };
}

describe('clampTimeScale', () => {
  it('holds the scale in the sim’s range, and a bad number is the normal speed', () => {
    expect(clampTimeScale(0.5)).toBe(0.5);
    expect(clampTimeScale(0)).toBe(MIN_TIME_SCALE);
    expect(clampTimeScale(-3)).toBe(MIN_TIME_SCALE);
    expect(clampTimeScale(7)).toBe(1);
    expect(clampTimeScale(Number.NaN)).toBe(1);
    expect(clampTimeScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('createCheatContext', () => {
  it('sends a journaled command stamped with the sim’s current time', async () => {
    const { host, sim } = await rig();
    for (let i = 0; i < 7; i++) sim.step();
    expect(createCheatContext(host).send({ type: 'SetFatigue', points: 30 })).toBe(true);
    const entry = sim.journal().entries.at(-1);
    expect(entry?.command).toEqual({ type: 'SetFatigue', t: sim.world.time.sim, points: 30 });
    // Applied at the next step, like any command.
    expect(entry?.applyAt).toBe(sim.world.time.sim + 10);
  });

  it('does nothing and says so when no level is running', async () => {
    const { host } = await rig({ isActive: false });
    expect(createCheatContext(host).send({ type: 'SetTimeScale', scale: 0.5 })).toBe(false);
  });

  it('never writes the world: a cheat reaches it only through the next step', async () => {
    const { host, sim } = await rig({ hasFatigue: true });
    const before = structuredClone(sim.world);
    createCheatContext(host).send({ type: 'SetFatigue', points: 99 });
    createCheatContext(host).send({ type: 'SetTimeScale', scale: 0.3 });
    expect(sim.world).toEqual(before);
    sim.step();
    // The gauge keeps filling during the step that sets it, by a few thousandths.
    expect(sim.world.gauges.fatigue).toBeCloseTo(99, 1);
    expect(sim.world.time.baseScale).toBe(0.3);
  });
});

describe('the cheat list', () => {
  it('lists the launchable threats of the level, in order, with their def, anchor and state', async () => {
    const { sim } = await rig();
    const threats = launchableThreats(sim.world);
    expect(threats.map((threat) => threat.id)).toEqual(
      sim.world.threats.map((threat) => threat.id),
    );
    expect(threats[0]?.label).toBe(
      `${sim.world.threats[0]?.defId} @ ${sim.world.threats[0]?.anchorId} (idle)`,
    );
    expect(threats.length).toBe(2);
  });

  it('launchThreat sends ForceThreat, and the director telegraphs that threat at the next step', async () => {
    const { host, sim } = await rig();
    const target = sim.world.threats[1]?.id as number;
    expect(launchThreat(createCheatContext(host), target)).toBe(true);
    expect(sim.journal().entries.at(-1)?.command).toMatchObject({
      type: 'ForceThreat',
      threatId: target,
    });
    sim.step();
    expect(sim.world.threats.find((threat) => threat.id === target)?.state).toBe('telegraph');
  });

  it('offers « set fatigue » only in a level with the gauge, as a number from 0 to the gauge maximum', async () => {
    const withGauge = await rig({ hasFatigue: true });
    const without = await rig();
    const cheat = CHEATS.find((candidate) => candidate.id === 'setFatigue');
    expect(cheat).toBeDefined();
    expect(cheat?.input).toMatchObject({ min: 0, max: GAUGE_MAX_POINTS });
    expect(cheat?.isAvailable(withGauge.sim.world, true)).toBe(true);
    expect(cheat?.isAvailable(without.sim.world, false)).toBe(false);
  });

  it('runs « set fatigue » through a SetFatigue command', async () => {
    const { host, sim } = await rig({ hasFatigue: true });
    CHEATS.find((candidate) => candidate.id === 'setFatigue')?.run(createCheatContext(host), 64);
    expect(sim.journal().entries.at(-1)?.command.type).toBe('SetFatigue');
    sim.step();
    expect(sim.world.gauges.fatigue).toBeCloseTo(64, 1);
  });

  it('has unique ids, so a story can add an entry without clashing', () => {
    const ids = CHEATS.map((cheat) => cheat.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('createSkipToEnd', () => {
  /** A frame scheduler a test steps by hand. */
  function frames() {
    const queue: (() => void)[] = [];
    return {
      request: (callback: () => void) => queue.push(callback),
      run: (count = 1) => {
        for (let i = 0; i < count; i++) queue.shift()?.();
      },
      get pending() {
        return queue.length;
      },
    };
  }

  it('runs the level in chunks of DEBUG_SKIP_CHUNK_STEPS per frame until it has ended', async () => {
    const { host, sim, advanced } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    expect(skip.isRunning).toBe(true);
    expect(advanced).toEqual([]);
    scheduler.run();
    expect(advanced).toEqual([DEBUG_SKIP_CHUNK_STEPS]);
    expect(sim.world.time.sim).toBe(DEBUG_SKIP_CHUNK_STEPS * 10);
    let guard = 0;
    while (skip.isRunning && guard++ < 100) scheduler.run();
    expect(sim.world.flow.state).toBe('ended');
    expect(skip.isRunning).toBe(false);
    expect(advanced.every((steps) => steps === DEBUG_SKIP_CHUNK_STEPS)).toBe(true);
    expect(scheduler.pending).toBe(0);
  });

  it('plays real steps: the end is scored as played', async () => {
    const { host, sim } = await rig();
    const scheduler = frames();
    createSkipToEnd(host, scheduler.request).start();
    let guard = 0;
    while (scheduler.pending > 0 && guard++ < 100) scheduler.run();
    const types = sim.drainEvents().map((event) => event.type);
    expect(types).toContain('LevelEnded');
    expect(types).toContain('LevelScored');
    expect(sim.world.score.final).not.toBeNull();
  });

  it('starts once: a second start while running changes nothing', async () => {
    const { host } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    skip.start();
    expect(scheduler.pending).toBe(1);
  });

  it('stops when cancelled, and can start again', async () => {
    const { host, advanced } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    skip.cancel();
    expect(skip.isRunning).toBe(false);
    scheduler.run();
    expect(advanced).toEqual([]);
    skip.start();
    scheduler.run();
    expect(advanced).toEqual([DEBUG_SKIP_CHUNK_STEPS]);
  });

  it('stops by itself, with a warning, when the level goes away under it', async () => {
    const { host, session, advanced } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    scheduler.run();
    session.active = null;
    scheduler.run();
    expect(skip.isRunning).toBe(false);
    expect(advanced).toHaveLength(1);
    expect(scheduler.pending).toBe(0);
  });

  it('stops when advancing throws (the loop is gone), and logs it', async () => {
    const { host, session } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    session.advance = () => {
      throw new Error('no level is running');
    };
    skip.start();
    scheduler.run();
    expect(skip.isRunning).toBe(false);
    expect(
      log
        .buffer()
        .some((entry) => entry.level === 'warn' && /skip to the end stopped/.test(entry.message)),
    ).toBe(true);
  });

  it('a started level that has already ended runs nothing', async () => {
    const { host, sim, advanced } = await rig();
    while (sim.world.flow.state !== 'ended') sim.step();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    scheduler.run();
    expect(advanced).toEqual([]);
    expect(skip.isRunning).toBe(false);
  });
});
