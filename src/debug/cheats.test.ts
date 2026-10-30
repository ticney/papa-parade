import {
  DEBUG_SKIP_CHUNK_STEPS,
  GAUGE_MAX_POINTS,
  MIN_TIME_SCALE,
  UINT32_RANGE,
} from '@shared/constants';
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
  levelHasFatigue,
  parseCheatNumber,
  parseSeed,
  refusalReason,
} from './cheats.ts';

beforeAll(() => {
  log.setLevel('error');
});

const LEVEL_DURATION_MS = 3000;

async function rig(options: { isActive?: boolean; hasFatigue?: boolean; isFrozen?: boolean } = {}) {
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
  /** Like the real session: `advance` freezes the level, `freeze` sets the wish. */
  const session = {
    active: options.isActive === false ? null : { sim, level, geometry: createTestGeometry() },
    isFrozen: options.isFrozen === true,
    freeze(isFrozen: boolean) {
      session.isFrozen = isFrozen;
    },
    advance(steps: number) {
      if (session.active === null) throw new Error('no level is running');
      advanced.push(steps);
      for (let i = 0; i < steps; i++) sim.step();
      session.isFrozen = true;
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

  it('refuses, with a warning, when the level has ended: the sim would drop the command', async () => {
    const { host, sim } = await rig();
    while (sim.world.flow.state !== 'ended') sim.step();
    const entries = sim.journal().entries.length;
    expect(createCheatContext(host).send({ type: 'SetFatigue', points: 30 })).toBe(false);
    expect(sim.journal().entries).toHaveLength(entries);
    const warning = log
      .buffer()
      .reverse()
      .find((entry) => entry.message.startsWith('cheat refused'));
    expect(warning?.level).toBe('warn');
    expect(warning?.message).toContain('the level has ended');
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

describe('refusalReason', () => {
  it('says why a command would be lost, and nothing while the level plays', async () => {
    const playing = await rig();
    expect(refusalReason(playing.host)).toBeNull();
    const none = await rig({ isActive: false });
    expect(refusalReason(none.host)).toBe('no level is running');
    const over = await rig();
    while (over.sim.world.flow.state !== 'ended') over.sim.step();
    expect(refusalReason(over.host)).toBe('the level has ended');
  });
});

describe('parseSeed', () => {
  it('takes a whole number from 0 to 2**32 - 1', () => {
    expect(parseSeed('0')).toEqual({ ok: true, value: 0 });
    expect(parseSeed('42')).toEqual({ ok: true, value: 42 });
    expect(parseSeed(String(UINT32_RANGE - 1))).toEqual({ ok: true, value: UINT32_RANGE - 1 });
  });

  it('refuses a blank field (not a 0), a fraction, a negative, a text and a seed createRng would throw on', () => {
    for (const text of [
      '',
      '   ',
      '1.5',
      '-1',
      'abc',
      '1e400',
      String(UINT32_RANGE),
      '99999999999',
    ]) {
      expect(parseSeed(text).ok, `"${text}"`).toBe(false);
    }
  });
});

describe('parseCheatNumber', () => {
  const input = { min: 0, max: GAUGE_MAX_POINTS };

  it('holds the number in the cheat’s own range', () => {
    expect(parseCheatNumber('64', input)).toEqual({ ok: true, value: 64 });
    expect(parseCheatNumber('250', input)).toEqual({ ok: true, value: GAUGE_MAX_POINTS });
    expect(parseCheatNumber('-5', input)).toEqual({ ok: true, value: 0 });
  });

  it('refuses a blank or non-numeric field instead of reading it as 0', () => {
    expect(parseCheatNumber('', input).ok).toBe(false);
    expect(parseCheatNumber('  ', input).ok).toBe(false);
    expect(parseCheatNumber('abc', input).ok).toBe(false);
    expect(parseCheatNumber('Infinity', input).ok).toBe(false);
  });
});

describe('levelHasFatigue', () => {
  it('is true for a level with the fatigue gauge, false for one without', () => {
    expect(levelHasFatigue(createTestLevel({ gauges: FATIGUE_GAUGES }))).toBe(true);
    expect(levelHasFatigue(createTestLevel())).toBe(false);
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
    // The answer is derived from the level, the way the overlay does it.
    const available = (r: typeof withGauge): boolean | undefined =>
      r.session.active === null
        ? undefined
        : cheat?.isAvailable(r.sim.world, levelHasFatigue(r.session.active.level));
    expect(available(withGauge)).toBe(true);
    expect(available(without)).toBe(false);
  });

  it('runs « set fatigue » through a SetFatigue command', async () => {
    const { host, sim } = await rig({ hasFatigue: true });
    CHEATS.find((candidate) => candidate.id === 'setFatigue')?.run(createCheatContext(host), 64);
    expect(sim.journal().entries.at(-1)?.command.type).toBe('SetFatigue');
    sim.step();
    expect(sim.world.gauges.fatigue).toBeCloseTo(64, 1);
  });

  it('runs « take / put down the baby » through a TapBaby command, always available', async () => {
    const { host, sim } = await rig();
    const cheat = CHEATS.find((candidate) => candidate.id === 'takePutDownBaby');
    expect(cheat?.input).toBeNull();
    expect(cheat?.isAvailable(sim.world, false)).toBe(true);
    cheat?.run(createCheatContext(host), 0);
    expect(sim.journal().entries.at(-1)?.command.type).toBe('TapBaby');
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
    const warning = log
      .buffer()
      .reverse()
      .find((entry) => entry.message.startsWith('skip to the end stopped: no level'));
    expect(warning?.level).toBe('warn');
  });

  it('a cancelled run that left a callback queued does not feed a later run: one chunk per frame', async () => {
    const { host, advanced } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    skip.cancel();
    skip.start();
    // Two callbacks are queued (the stale one and the live one): the frame advances once.
    expect(scheduler.pending).toBe(2);
    scheduler.run(2);
    expect(advanced).toEqual([DEBUG_SKIP_CHUNK_STEPS]);
    expect(scheduler.pending).toBe(1);
    scheduler.run(1);
    expect(advanced).toEqual([DEBUG_SKIP_CHUNK_STEPS, DEBUG_SKIP_CHUNK_STEPS]);
  });

  it('puts the freeze back as it was when the level ends (a skip leaves nothing frozen)', async () => {
    const { host, session } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    scheduler.run();
    // `advance` froze the level while the skip runs.
    expect(session.isFrozen).toBe(true);
    let guard = 0;
    while (skip.isRunning && guard++ < 100) scheduler.run();
    expect(session.isFrozen).toBe(false);
  });

  it('keeps a freeze that was on before the skip, on the end and on a cancel', async () => {
    const first = await rig({ isFrozen: true });
    const scheduler = frames();
    const skip = createSkipToEnd(first.host, scheduler.request);
    skip.start();
    scheduler.run();
    skip.cancel();
    expect(first.session.isFrozen).toBe(true);

    const second = await rig({ isFrozen: true });
    const other = frames();
    const again = createSkipToEnd(second.host, other.request);
    again.start();
    let guard = 0;
    while (again.isRunning && guard++ < 100) other.run();
    expect(second.session.isFrozen).toBe(true);
  });

  it('puts the freeze back when it is cancelled, and when advancing throws', async () => {
    const { host, session } = await rig();
    const scheduler = frames();
    const skip = createSkipToEnd(host, scheduler.request);
    skip.start();
    scheduler.run();
    expect(session.isFrozen).toBe(true);
    skip.cancel();
    expect(session.isFrozen).toBe(false);

    session.advance = () => {
      throw new Error('no level is running');
    };
    session.isFrozen = false;
    skip.start();
    scheduler.run(2);
    expect(session.isFrozen).toBe(false);
    expect(skip.isRunning).toBe(false);
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
