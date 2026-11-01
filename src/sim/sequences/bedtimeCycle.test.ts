import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  type CycleLevelOptions,
  createTestCycleGeometry,
  createTestCycleLevel,
} from '../../../tests/support/cycleSupport.ts';
import {
  createTestContent,
  createTestSequences,
  createTestSilence,
} from '../../../tests/support/testContent.ts';
import type { StepContext, System } from '../context.ts';
import { createSimWithSystems, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { runPapa } from '../papa/papaSystem.ts';
import { SYSTEMS } from '../step.ts';
import type { World } from '../world.ts';
import { cycleProblems, cycleRoomOf } from './bedtimeCycle.ts';
import { failSequence, succeedSequence } from './sequenceEnd.ts';

// The bedtime cycle (story 4.10), on the frozen bedroom. A hidden hand wins or loses the running
// sequence on demand, right before `runPapa` (where a real end would come from `runThreats`), so these
// tests are about the chain and not about playing each sequence; `cycleLevel.test.ts` plays it with bots.

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

const ALL = ['stay_awake', 'lullaby_walk', 'bedtime_duel', 'bomb_drop', 'stealth_exit'];

interface Run {
  readonly sim: Sim;
  readonly world: World;
  readonly events: SimEvent[];
  step(n?: number): void;
  /** Steps until `until` is true, within `maxMs` of sim time. */
  stepUntil(until: () => boolean, maxMs?: number): void;
  /** Ends the running sequence in the next step. */
  end(outcome: 'win' | 'lose'): void;
  /** Starts of each sequence, in order. */
  started(): string[];
}

async function runOf(options: CycleLevelOptions = {}, seed = 1): Promise<Run> {
  let pending: 'win' | 'lose' | null = null;
  const hand: System = (world: World, ctx: StepContext) => {
    if (pending === null || world.flow.state !== 'sequence') return;
    if (pending === 'win') succeedSequence(world, ctx);
    else failSequence(world, ctx);
    pending = null;
  };
  const papaAt = SYSTEMS.indexOf(runPapa);
  const sim = await createSimWithSystems(
    {
      content: createTestContent(),
      geometry: createTestCycleGeometry(),
      level: createTestCycleLevel(options),
      seed,
    },
    [...SYSTEMS.slice(0, papaAt), hand, ...SYSTEMS.slice(papaAt)],
  );
  const events: SimEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
  };
  return {
    sim,
    get world() {
      return sim.world as World;
    },
    events,
    step,
    stepUntil(until, maxMs = 240_000) {
      for (let i = 0; i < maxMs / STEP_MS && !until(); i++) step();
      expect(until()).toBe(true);
    },
    end(outcome) {
      pending = outcome;
      step();
    },
    started: () => only(events, 'SequenceStarted').map((event) => event.id),
  };
}

const NO_THREATS: CycleLevelOptions = { waves: [] };

/** A cycle of the one sequence `id`, with a first interlude of 1 s. */
const oneEntry = (id: string, overrides: CycleLevelOptions = {}): CycleLevelOptions => ({
  ...NO_THREATS,
  sequences: [id],
  cycle: {
    entries: [{ sequence: id, interludeMs: 1000 }],
    retryInterludeMs: 2000,
    gatherMaxMs: 6000,
  },
  ...overrides,
});

const inSequence = (run: Run) => run.world.flow.state === 'sequence';

/** Plays the frozen cycle by hand, winning each sequence as soon as it starts, up to `upTo` wins. */
async function winTo(run: Run, upTo: number): Promise<void> {
  for (let i = 0; i < upTo; i++) {
    run.stepUntil(() => inSequence(run));
    run.end('win');
  }
}

describe('the chain', () => {
  it('runs the five sequences in order, and the level ends with the last', async () => {
    const run = await runOf(NO_THREATS);
    await winTo(run, 5);
    expect(run.started()).toEqual(ALL);
    expect(only(run.events, 'SequenceEnded').map((event) => event.outcome)).toEqual(
      ALL.map(() => 'succeeded'),
    );
    expect(run.world.cycle.index).toBe(5);
    expect(run.world.flow.state).toBe('ended');
  });

  it('is due after each interlude to the ms: the first gather starts at 15000', async () => {
    const run = await runOf(NO_THREATS);
    expect(run.world.cycle.nextAt).toBe(15000);
    run.stepUntil(() => run.world.time.sim === 15000 - STEP_MS);
    expect(only(run.events, 'PapaPathPlanned')).toEqual([]);
    run.step();
    expect(only(run.events, 'PapaPathPlanned')).toMatchObject([{ t: 15000 }]);
  });

  it('starts a sequence that needs no gather on the very step it is due', async () => {
    const run = await runOf(NO_THREATS);
    await winTo(run, 1);
    const wonAt = only(run.events, 'SequenceEnded')[0]?.t as number;
    expect(run.world.cycle.nextAt).toBe(wonAt + 12000);
    run.stepUntil(() => run.started().length === 2);
    expect(only(run.events, 'SequenceStarted')[1]).toMatchObject({
      id: 'lullaby_walk',
      t: wonAt + 12000,
    });
  });

  it('draws nothing of its own: the rng does not move from one win to the next start', async () => {
    const run = await runOf({
      ...NO_THREATS,
      gauges: {},
      carry: {},
      sequences: ['bedtime_duel', 'lullaby_walk'],
      cycle: {
        entries: [
          { sequence: 'bedtime_duel', interludeMs: 100 },
          { sequence: 'lullaby_walk', interludeMs: 3000 },
        ],
        retryInterludeMs: 2000,
        gatherMaxMs: 6000,
      },
    });
    run.stepUntil(() => inSequence(run));
    run.end('win');
    expect(run.world.baby.state).toBe('carried');
    const rng = structuredClone(run.world.rng);
    run.stepUntil(() => inSequence(run));
    expect(run.world.rng).toEqual(rng);
  });
});

describe('a retry', () => {
  it.each([
    ['gag', 'stay_awake'],
    ['babyAwake', 'lullaby_walk'],
    ['retreats', 'bedtime_duel'],
    ['retreats', 'bomb_drop'],
    ['gag', 'stealth_exit'],
  ])(
    'comes on the same entry after a %s failure (%s)',
    async (kind, id) => {
      expect(createTestSequences()[id]?.failure?.kind).toBe(kind);
      const run = await runOf(oneEntry(id));
      run.stepUntil(() => only(run.events, 'SequenceEnded').length === 1);
      const [ended] = only(run.events, 'SequenceEnded');
      expect(ended).toMatchObject({ id, outcome: 'failed' });
      expect(run.world.cycle.index).toBe(0);
      expect(run.world.cycle.nextAt).toBe((ended?.t as number) + 2000);
      expect(run.world.cycle.completedAt).toBeNull();
      run.stepUntil(() => run.started().length === 2);
      expect(only(run.events, 'SequenceStarted')[1]?.t).toBeGreaterThanOrEqual(
        (ended?.t as number) + 2000,
      );
    },
    20_000,
  );
});

describe('a refused start', () => {
  it('waits while Papa is on the toilet, and starts once he is out', async () => {
    const run = await runOf({
      ...oneEntry('bedtime_duel'),
      cycle: {
        entries: [{ sequence: 'bedtime_duel', interludeMs: 100 }],
        retryInterludeMs: 2000,
        gatherMaxMs: 2500,
      },
    });
    run.sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'toilet' });
    run.stepUntil(() => run.world.papa.state === 'onToilet');
    const until = run.world.papa.busyUntil;
    expect(until).toBeGreaterThan(2600); // past the cap: the refusal still holds it
    expect(run.started()).toEqual([]);
    run.stepUntil(() => run.world.time.sim === until - 10);
    expect(run.started()).toEqual([]);
    run.stepUntil(() => run.started().length === 1);
    expect(only(run.events, 'SequenceStarted')[0]?.t).toBeGreaterThanOrEqual(until);
  });

  it('waits while the baby hides, in a level that has a silence, and starts once he is found', async () => {
    const geometry = structuredClone(createTestCycleGeometry());
    geometry.zones.push({
      id: 'under_bed',
      kind: 'hidden',
      centerM: [1.5, 0.3, 1.5],
      halfExtentsM: [0.4, 0.3, 0.4],
    });
    const content = createTestContent();
    const level = createTestCycleLevel({
      sequences: ['bedtime_duel'],
      cycle: {
        entries: [{ sequence: 'bedtime_duel', interludeMs: 100 }],
        retryInterludeMs: 2000,
        gatherMaxMs: 100,
      },
      waves: [
        {
          fromMs: 0,
          maxSimultaneous: 1,
          gapMinMs: 0,
          gapMaxMs: 0,
          lullMs: 0,
          threats: [{ def: 'silence_mischief', anchor: 'under_bed' }],
          disruptions: [],
        },
      ],
    });
    const sim = await createSimWithSystems(
      {
        content,
        geometry,
        level: {
          ...level,
          threats: { ...level.threats, silence_mischief: createTestSilence() },
        },
        seed: 1,
      },
      SYSTEMS,
    );
    const world = () => sim.world as World;
    // The silence is taken in the very first steps, before the entry is due.
    world().director.nextAt = asSimMs(0);
    let isHeldSeen = false;
    for (let i = 0; i < 3000 && world().flow.state !== 'sequence'; i++) {
      sim.step();
      if (world().silence.threatId !== null && world().time.sim > 200) isHeldSeen = true;
    }
    expect(isHeldSeen).toBe(true);
    expect(world().flow.state).toBe('sequence');
    expect(world().silence.threatId).toBeNull();
    sim.dispose();
  });
});

describe('the gather', () => {
  it('walks Papa to the baby and takes him there, with no jump, before the sequence starts', async () => {
    const run = await runOf(NO_THREATS);
    run.stepUntil(() => run.world.cycle.nextAt === run.world.time.sim);
    let previous = { xM: run.world.papa.xM, zM: run.world.papa.zM };
    let babyPrevious = { xM: run.world.baby.xM, zM: run.world.baby.zM };
    while (!inSequence(run)) {
      run.step();
      const { papa, baby } = run.world;
      expect(Math.hypot(papa.xM - previous.xM, papa.zM - previous.zM)).toBeLessThan(0.05);
      if (baby.state !== 'carried') {
        expect(Math.hypot(baby.xM - babyPrevious.xM, baby.zM - babyPrevious.zM)).toBeLessThan(0.05);
      }
      previous = { xM: papa.xM, zM: papa.zM };
      babyPrevious = { xM: baby.xM, zM: baby.zM };
    }
    const [picked] = only(run.events, 'BabyPickedUp');
    const [started] = only(run.events, 'SequenceStarted');
    expect(picked).toBeDefined();
    expect((picked?.t as number) < (started?.t as number)).toBe(true);
  });

  it('walks Papa to the crib carrying the baby, keeps him there, and the placement moves nothing', async () => {
    const run = await runOf(NO_THREATS);
    await winTo(run, 3);
    const nextAt = run.world.cycle.nextAt as number;
    run.stepUntil(() => run.world.time.sim === nextAt);
    expect(run.world.papa.state).toBe('walkPath');
    expect(run.world.papa.intent).toBe('none');
    let last = { xM: run.world.papa.xM, zM: run.world.papa.zM };
    while (!inSequence(run)) {
      last = { xM: run.world.papa.xM, zM: run.world.papa.zM };
      run.step();
    }
    expect(only(run.events, 'BabyPutDown')).toEqual([]);
    expect(run.world.baby.state).toBe('carried');
    // The step that started the sequence moved him by nothing: he had arrived.
    expect(run.world.papa.xM).toBeCloseTo(last.xM);
    expect(run.world.papa.zM).toBeCloseTo(last.zM);
    expect(only(run.events, 'SequenceStarted').at(-1)?.id).toBe('bomb_drop');
  });

  it('starts the infiltration the step after the drop: no gather, and the baby has not moved', async () => {
    const run = await runOf(NO_THREATS);
    await winTo(run, 3);
    run.stepUntil(() => inSequence(run));
    const walks = only(run.events, 'PapaPathPlanned').length;
    run.end('win');
    const [laid] = only(run.events, 'BabyPutDown');
    expect(laid).toMatchObject({ safe: true });
    const at = { xM: run.world.baby.xM, zM: run.world.baby.zM };
    expect(run.world.cycle.nextAt).toBe(run.world.time.sim);
    run.step();
    expect(only(run.events, 'SequenceStarted').at(-1)).toMatchObject({
      id: 'stealth_exit',
      t: (laid?.t as number) + STEP_MS,
    });
    expect(only(run.events, 'PapaPathPlanned')).toHaveLength(walks);
    expect(run.world.baby.xM).toBe(at.xM);
    expect(run.world.baby.zM).toBe(at.zM);
  });

  it('does not cut across the walk of the player', async () => {
    const run = await runOf({
      ...oneEntry('bedtime_duel'),
      cycle: {
        entries: [{ sequence: 'bedtime_duel', interludeMs: 100 }],
        retryInterludeMs: 2000,
        gatherMaxMs: 6000,
      },
    });
    run.sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: 2.5, zM: 2 });
    run.step(2);
    const [planned] = only(run.events, 'PapaPathPlanned');
    expect(planned).toMatchObject({ targetXM: 2.5, targetZM: 2 });
    run.stepUntil(() => run.world.time.sim === 200);
    expect(run.world.papa.state).toBe('walkPath');
    expect(run.started()).toEqual([]);
    run.stepUntil(() => only(run.events, 'PapaArrived').length === 1);
    expect(only(run.events, 'PapaPathPlanned')).toHaveLength(1);
    // Idle at last: the gather sets off for the baby.
    run.step();
    expect(only(run.events, 'PapaPathPlanned')).toHaveLength(2);
    expect(run.world.papa.intent).toBe('takeBaby');
  });

  it('a player who tapped the crib with the baby does put him down, and the gather fetches him', async () => {
    const run = await runOf({
      ...NO_THREATS,
      sequences: ['bedtime_duel', 'lullaby_walk'],
      cycle: {
        entries: [
          { sequence: 'bedtime_duel', interludeMs: 100 },
          { sequence: 'lullaby_walk', interludeMs: 4000 },
        ],
        retryInterludeMs: 2000,
        gatherMaxMs: 6000,
      },
    });
    run.stepUntil(() => inSequence(run));
    run.end('win');
    expect(run.world.baby.state).toBe('carried');
    run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: -1.8, zM: 1.4 });
    run.stepUntil(() => only(run.events, 'BabyPutDown').length === 1);
    expect(only(run.events, 'BabyPutDown')).toMatchObject([{ safe: true }]);
    run.stepUntil(() => run.started().length === 2);
    expect(only(run.events, 'BabyPickedUp')).toHaveLength(2);
  });

  it('starts at the cap with its own placements, however the player keeps Papa walking', async () => {
    const run = await runOf({
      ...oneEntry('bomb_drop'),
      cycle: {
        entries: [{ sequence: 'bomb_drop', interludeMs: 100 }],
        retryInterludeMs: 2000,
        gatherMaxMs: 500,
      },
    });
    // A direction held: he never goes idle.
    run.sim.enqueue({ type: 'Move', t: asSimMs(0), dirX: 1, dirZ: 0 });
    run.stepUntil(() => inSequence(run));
    expect(only(run.events, 'SequenceStarted')).toMatchObject([{ t: 600 }]);
    // Popped over the crib, baby in the arms: the 4.8 placements.
    expect(run.world.papa.xM).toBeCloseTo(-1.8);
    expect(run.world.papa.zM).toBeCloseTo(1.4);
    expect(run.world.baby.state).toBe('carried');
  });
});

describe('what the cycle ignores', () => {
  it("a debug StartSequence of the current entry's id does count as that entry", async () => {
    const won = await runOf(NO_THREATS);
    won.sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
    won.stepUntil(() => inSequence(won));
    won.end('win');
    expect(won.world.cycle.index).toBe(1);

    const lost = await runOf(NO_THREATS);
    lost.sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
    lost.stepUntil(() => inSequence(lost));
    lost.end('lose');
    expect(lost.world.cycle.index).toBe(0);
    expect(lost.world.cycle.nextAt).toBe(lost.world.time.sim + 8000);
  });

  it('a debug StartSequence of another sequence moves nothing', async () => {
    const run = await runOf(NO_THREATS);
    run.sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
    run.stepUntil(() => inSequence(run));
    const before = structuredClone(run.world.cycle);
    run.end('win');
    expect(run.world.cycle).toEqual(before);
    run.sim.enqueue({
      type: 'StartSequence',
      t: run.world.time.sim,
      sequenceId: 'bedtime_duel',
    });
    run.stepUntil(() => inSequence(run));
    run.end('lose');
    expect(run.world.cycle).toEqual(before);
  });

  it('a level with no cycle sees no event, no field change and no start', async () => {
    const run = await runOf({ sequences: ['bedtime_duel'], cycle: undefined, ...NO_THREATS });
    run.step(2000);
    expect(run.world.cycle).toEqual({ index: 0, nextAt: null, completedAt: null });
    expect(run.started()).toEqual([]);
    expect(only(run.events, 'CycleCompleted')).toEqual([]);
    expect(only(run.events, 'PapaPathPlanned')).toEqual([]);
  });
});

describe('the end of the level', () => {
  it('CycleCompleted and LevelEnded{cycleDone} come in the one step', async () => {
    const run = await runOf(NO_THREATS);
    await winTo(run, 5);
    const [completed] = only(run.events, 'CycleCompleted');
    expect(only(run.events, 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: completed?.t, reason: 'cycleDone' },
    ]);
    expect(run.world.cycle.completedAt).toBe(completed?.t);
    expect(run.world.cycle.nextAt).toBeNull();
    expect(only(run.events, 'MamaWoke')).toEqual([]);
    expect(run.world.score.final?.lostStars).toBe(0);
  });

  it('a tie with the noise goes to Mama', async () => {
    const run = await runOf(oneEntry('bedtime_duel'));
    run.stepUntil(() => inSequence(run));
    run.sim.enqueue({ type: 'SetNoise', t: run.world.time.sim, pct: 100 });
    run.end('win');
    expect(only(run.events, 'CycleCompleted')).toHaveLength(1);
    expect(only(run.events, 'LevelEnded')).toMatchObject([{ reason: 'mamaWoke' }]);
  });

  /** The infiltration of a level of `durationMs`, with no alert ever due: it runs until the test ends it. */
  async function quietStealth(durationMs: number) {
    const run = await runOf(oneEntry('stealth_exit', { durationMs }));
    run.stepUntil(() => inSequence(run));
    const stepQuietly = () => {
      run.world.sequence.stealth.nextAlertAt = asSimMs(100_000_000);
      run.step();
    };
    return { run, stepQuietly };
  }

  it('a tie with the timer goes to the cycle', async () => {
    const { run, stepQuietly } = await quietStealth(61_000);
    while (run.world.time.sim < 60_990) stepQuietly();
    expect(inSequence(run)).toBe(true);
    run.end('win');
    expect(only(run.events, 'LevelEnded')).toMatchObject([{ t: 61_000, reason: 'cycleDone' }]);
  });

  it('a timer end in mid-cycle stays a timer end, and closes the sequence as cut', async () => {
    const { run, stepQuietly } = await quietStealth(61_000);
    while (run.world.flow.state !== 'ended') stepQuietly();
    expect(only(run.events, 'LevelEnded')).toMatchObject([{ t: 61_000, reason: 'timer' }]);
    expect(only(run.events, 'SequenceEnded')).toMatchObject([{ outcome: 'levelEnded' }]);
    expect(only(run.events, 'CycleCompleted')).toEqual([]);
    expect(run.world.cycle).toMatchObject({ index: 0, completedAt: null });
  });
});

describe('base threats between the sequences (D5)', () => {
  it('comes in the first interlude, the baby free', async () => {
    const run = await runOf();
    run.stepUntil(() => only(run.events, 'ThreatTelegraphed').length > 0, 15_000);
    expect(only(run.events, 'ThreatTelegraphed')[0]?.t).toBeLessThan(15_000);
    expect(run.started()).toEqual([]);
  });

  it('never comes while he is carried, and comes in a later interlude once he is put down', async () => {
    const run = await runOf();
    run.stepUntil(() => inSequence(run));
    run.end('win');
    const wonAt = run.world.time.sim;
    const baseAfter = () =>
      only(run.events, 'ThreatTelegraphed').filter(
        (event) =>
          event.t > wonAt && (event.kind === 'outlet' || event.kind === 'coffee_table_object'),
      );
    // Carried, up to the next start.
    run.stepUntil(() => inSequence(run));
    expect(baseAfter()).toEqual([]);
    run.end('win');
    expect(run.world.baby.state).toBe('carried');
    run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: -1.8, zM: 1.4 });
    run.stepUntil(() => only(run.events, 'BabyPutDown').length === 1);
    const before = baseAfter().length;
    run.stepUntil(() => baseAfter().length > before, 12_000);
  });
});

describe('cycleProblems', () => {
  const geometry = createTestCycleGeometry();
  const level = createTestCycleLevel();
  const grid = { isOpenAt: () => true };
  const room = cycleRoomOf(geometry, grid);
  const cycle = level.level.cycle as NonNullable<typeof level.level.cycle>;
  const problems = (
    overrides: {
      cycle?: typeof cycle;
      listed?: readonly string[];
      durationMs?: number;
      geometry?: LevelGeometry;
      grid?: { isOpenAt(xM: number, zM: number): boolean };
      exitRadiusM?: number;
    } = {},
  ) => {
    const defs = structuredClone(level.sequences);
    if (overrides.exitRadiusM !== undefined) {
      const step = defs.stealth_exit?.steps[0];
      if (step?.kind === 'stealth') step.exitRadiusM = overrides.exitRadiusM;
    }
    return cycleProblems(
      overrides.cycle ?? cycle,
      overrides.listed ?? level.level.sequences,
      defs,
      overrides.durationMs ?? level.level.durationMs,
      overrides.geometry === undefined && overrides.grid === undefined
        ? room
        : cycleRoomOf(overrides.geometry ?? geometry, overrides.grid ?? grid),
    );
  };
  const withZone = (id: string, x: number, z: number): LevelGeometry => {
    const copy = structuredClone(geometry);
    copy.zones.push({
      id,
      kind: 'creak',
      centerM: [x, 0.05, z],
      halfExtentsM: [0.45, 0.05, 0.45],
    });
    return copy;
  };

  it('accepts the frozen level', () => {
    expect(problems()).toEqual([]);
  });

  it('refuses an entry not listed in the level', () => {
    expect(problems({ listed: ALL.slice(1) })).toEqual([
      expect.stringContaining('"stay_awake" is not listed'),
    ]);
  });

  it('refuses an entry listed twice', () => {
    const twice = {
      ...cycle,
      entries: [...cycle.entries, cycle.entries[0] as (typeof cycle.entries)[number]],
    };
    expect(problems({ cycle: twice })).toEqual([
      expect.stringContaining('"stay_awake" is listed twice'),
    ]);
  });

  it('refuses a level too short for one clean cycle', () => {
    expect(problems({ durationMs: 100_000 })).toEqual([
      expect.stringContaining('below the 160000 ms of one clean cycle'),
    ]);
    expect(problems({ durationMs: 160_000 })).toEqual([]);
  });

  it('refuses a crib entry in a level with no open safe centre', () => {
    const closed = { isOpenAt: () => false };
    const found = problems({ grid: closed });
    expect(found).toEqual([
      expect.stringContaining('"bomb_drop" needs the crib'),
      expect.stringContaining('"stealth_exit" needs the crib'),
    ]);
  });

  it("refuses Papa's spawn inside the exit radius", () => {
    const copy = structuredClone(geometry);
    const spawn = copy.anchors.find((anchor) => anchor.id === 'papa_spawn');
    if (spawn !== undefined) spawn.positionM = [2, 0, -2];
    expect(problems({ geometry: copy })).toEqual([expect.stringContaining("Papa's spawn")]);
  });

  it("refuses a crib's centre inside the exit radius", () => {
    const copy = structuredClone(geometry);
    const crib = copy.zones.find((zone) => zone.id === 'crib');
    if (crib !== undefined) crib.centerM = [2, 0.3, -2];
    expect(problems({ geometry: copy })).toEqual([expect.stringContaining("a safe zone's centre")]);
  });

  it('refuses a board overlapping another', () => {
    expect(problems({ geometry: withZone('board_04', -0.7, 0.7) })).toEqual([
      expect.stringContaining('"board_01" and "board_04" overlap'),
    ]);
  });

  it('refuses a board reaching into the exit radius', () => {
    expect(problems({ geometry: withZone('board_04', 2.4, -1.6) })).toEqual([
      expect.stringContaining('the board "board_04" reaches into the exit radius'),
    ]);
  });

  it('createSim refuses a level the rules refuse, with the same words', async () => {
    await expect(runOf({ durationMs: 100_000 })).rejects.toThrow(
      /below the 160000 ms of one clean cycle/,
    );
  });
});
