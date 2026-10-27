import type { ContentBundle } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { createNavGrid } from '../nav/navGrid.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const FEEL = content.feel.baby;
const BUDGET_M = (FEEL.crawlSpeedMps * STEP_MS) / 1000;
const grid = createNavGrid(geometry, FEEL.bodyRadiusM);

type BabyChange = Extract<SimEvent, { type: 'BabyStateChanged' }>;

async function newSim(
  options: { content?: ContentBundle; geometry?: LevelGeometry; seed?: number } = {},
): Promise<Sim> {
  return createSim({
    content: options.content ?? content,
    geometry: options.geometry ?? geometry,
    seed: options.seed ?? 1,
  });
}

/** Runs `steps` steps and returns the events they emitted. */
function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const babyEvents = (events: readonly SimEvent[]): BabyChange[] =>
  events.filter((event): event is BabyChange => event.type === 'BabyStateChanged');
const babyOf = (sim: Sim) => sim.world.baby;
const anchor = (id: string) =>
  (geometry.anchors.find((a) => a.id === id) as { positionM: [number, number, number] }).positionM;
const stepsFor = (ms: number) => ms / STEP_MS;

describe('spawn', () => {
  it('starts babbling at the baby_spawn anchor, facing +z, with its first wander due after babbleMinMs', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('baby_spawn');
    expect(babyOf(sim)).toMatchObject({
      state: 'babble',
      xM: x,
      zM: z,
      prevXM: x,
      prevZM: z,
      headingX: 0,
      headingZ: 1,
      gazeX: 0,
      gazeZ: 1,
      path: [],
      pathIndex: 0,
      wanderAt: FEEL.babbleMinMs,
      babbling: true,
    });
  });

  it('moves a spawn that its clearance closes to the nearest open cell', async () => {
    const closed: LevelGeometry = {
      ...geometry,
      anchors: geometry.anchors.map((a) =>
        a.id === 'baby_spawn' ? { ...a, positionM: [-3.9, 0, -2.9] } : a,
      ),
    };
    const sim = await newSim({ geometry: closed });
    expect(grid.isOpenAt(-3.9, -2.9)).toBe(false);
    const cell = grid.nearestOpenCell(-3.9, -2.9, -1);
    expect([babyOf(sim).xM, babyOf(sim).zM]).toEqual([grid.centerXM(cell), grid.centerZM(cell)]);
  });

  it('is an invariant naming the anchor when the level has none', async () => {
    const without: LevelGeometry = {
      ...geometry,
      anchors: geometry.anchors.filter((a) => a.id !== 'baby_spawn'),
    };
    await expect(newSim({ geometry: without })).rejects.toThrow(/no baby_spawn anchor/);
  });

  it('is an invariant when the baby has nowhere to stand but Papa has', async () => {
    // A band three cells high: Papa (one cell of clearance) fits in its middle row, a baby as wide
    // as two cells (0.5 m) does not.
    const rows = geometry.nav.rows.map((row, index) =>
      index >= 5 && index <= 7 ? '1'.repeat(row.length) : '0'.repeat(row.length),
    );
    const band: LevelGeometry = { ...geometry, nav: { ...geometry.nav, rows } };
    const wide: ContentBundle = {
      ...content,
      feel: { ...content.feel, baby: { ...FEEL, bodyRadiusM: 0.5 } },
    };
    await expect(newSim({ geometry: band, content: wide })).rejects.toThrow(
      /no cell where the baby can stand/,
    );
    await expect(newSim({ geometry: band })).resolves.toBeDefined();
  });
});

describe('wander and babble', () => {
  it('sets off at the first step at or after babbleMinMs, with one BabyStateChanged', async () => {
    const sim = await newSim();
    const events = run(sim, stepsFor(FEEL.babbleMinMs) + 5);
    const changes = babyEvents(events);
    expect(changes[0]).toMatchObject({ from: 'babble', to: 'wander' });
    const t = (changes[0] as BabyChange).t;
    expect(t).toBeGreaterThanOrEqual(FEEL.babbleMinMs);
    expect(t).toBeLessThan(FEEL.babbleMinMs + STEP_MS);
    expect(babyOf(sim).state).toBe('wander');
    expect(babyOf(sim).enteredAt).toBe(t);
  });

  it('stays put before that', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('baby_spawn');
    const events = run(sim, stepsFor(FEEL.babbleMinMs) - 5);
    expect(babyEvents(events)).toEqual([]);
    expect([babyOf(sim).xM, babyOf(sim).zM]).toEqual([x, z]);
  });

  it('alternates babble → wander and wander → babble over 60 s, babbling all the time', async () => {
    const sim = await newSim();
    const changes: BabyChange[] = [];
    for (let i = 0; i < stepsFor(60000); i++) {
      sim.step();
      for (const event of babyEvents(sim.drainEvents())) changes.push(event);
      expect(babyOf(sim).babbling).toBe(true);
    }
    expect(changes.length).toBeGreaterThanOrEqual(6);
    changes.forEach((change, index) => {
      expect(change).toMatchObject(
        index % 2 === 0 ? { from: 'babble', to: 'wander' } : { from: 'wander', to: 'babble' },
      );
    });
  });

  it('keeps its centre on an open cell of its own grid at every step', async () => {
    const sim = await newSim({ seed: 3 });
    for (let i = 0; i < stepsFor(60000); i++) {
      sim.step();
      expect(grid.isOpenAt(babyOf(sim).xM, babyOf(sim).zM)).toBe(true);
    }
  });

  it('crawls to destinations within the ring and babbles within the pause bounds', async () => {
    const sim = await newSim({ seed: 5 });
    const halfDiagonalM = (geometry.cellM * Math.SQRT2) / 2;
    const slackM = BUDGET_M + 1e-9;
    let wanderStart: { x: number; z: number } | null = null;
    let babbleSince = 0;
    let cycles = 0;
    for (let i = 0; i < stepsFor(90000); i++) {
      sim.step();
      for (const event of babyEvents(sim.drainEvents())) {
        const baby = babyOf(sim);
        if (event.to === 'wander') {
          const pauseMs = event.t - babbleSince;
          expect(pauseMs).toBeGreaterThanOrEqual(FEEL.babbleMinMs);
          expect(pauseMs).toBeLessThan(FEEL.babbleMaxMs + STEP_MS);
          wanderStart = { x: baby.prevXM, z: baby.prevZM };
        } else {
          const start = wanderStart as { x: number; z: number };
          const distanceM = Math.hypot(baby.xM - start.x, baby.zM - start.z);
          expect(distanceM).toBeGreaterThanOrEqual(FEEL.wanderMinDistM - halfDiagonalM - slackM);
          expect(distanceM).toBeLessThanOrEqual(FEEL.wanderMaxDistM + halfDiagonalM + slackM);
          babbleSince = event.t;
          cycles++;
        }
      }
    }
    expect(cycles).toBeGreaterThanOrEqual(5);
  });

  it('crawls at crawlSpeedMps: never more than the budget per step, the whole budget on a straight run', async () => {
    const sim = await newSim({ seed: 2 });
    let fullSteps = 0;
    for (let i = 0; i < stepsFor(30000); i++) {
      sim.step();
      const baby = babyOf(sim);
      const movedM = Math.hypot(baby.xM - baby.prevXM, baby.zM - baby.prevZM);
      expect(movedM).toBeLessThanOrEqual(BUDGET_M + 1e-9);
      if (Math.abs(movedM - BUDGET_M) < 1e-9) fullSteps++;
    }
    expect(fullSteps).toBeGreaterThan(100);
  });

  it('a faster baby arrives first on the same seed', async () => {
    const fast: ContentBundle = {
      ...content,
      feel: { ...content.feel, baby: { ...FEEL, crawlSpeedMps: FEEL.crawlSpeedMps * 2 } },
    };
    const arrival = async (bundle: ContentBundle) => {
      const sim = await newSim({ content: bundle, seed: 9 });
      const events = run(sim, stepsFor(30000));
      return babyEvents(events).find((e) => e.to === 'babble')?.t as number;
    };
    const slowAt = await arrival(content);
    const fastAt = await arrival(fast);
    expect(fastAt).toBeLessThan(slowAt);
  });

  it('looks where it crawls, and keeps its gaze through a babble', async () => {
    const sim = await newSim({ seed: 4 });
    let babbleGaze: [number, number] | null = null;
    let babbleSteps = 0;
    for (let i = 0; i < stepsFor(40000); i++) {
      sim.step();
      sim.drainEvents();
      const baby = babyOf(sim);
      if (baby.state === 'wander') {
        expect([baby.gazeX, baby.gazeZ]).toEqual([baby.headingX, baby.headingZ]);
        babbleGaze = null;
      } else if (babbleGaze === null) {
        // The step that arrives already updated the gaze: it is the one the babble keeps.
        babbleGaze = [baby.gazeX, baby.gazeZ];
      } else {
        expect([baby.gazeX, baby.gazeZ]).toEqual(babbleGaze);
        babbleSteps++;
      }
    }
    expect(babbleSteps).toBeGreaterThan(100);
  });

  it('clears its path on arrival and sits exactly on the destination', async () => {
    const sim = await newSim({ seed: 6 });
    let lastWaypoint: number[] = [];
    for (let i = 0; i < stepsFor(30000); i++) {
      sim.step();
      const baby = babyOf(sim);
      if (baby.state === 'wander') lastWaypoint = baby.path.slice(-2);
      if (baby.state === 'babble' && lastWaypoint.length === 2) {
        expect(baby.path).toEqual([]);
        expect(baby.pathIndex).toBe(0);
        expect([baby.xM, baby.zM]).toEqual(lastWaypoint);
        return;
      }
    }
    throw new Error('the baby never arrived');
  });
});

describe('determinism', () => {
  async function trace(seed: number) {
    const sim = await newSim({ seed });
    const positions: number[] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < stepsFor(30000); i++) {
      sim.step();
      positions.push(babyOf(sim).xM, babyOf(sim).zM);
      for (const event of sim.drainEvents()) events.push(event);
    }
    return hashJson({ positions, events });
  }

  it('same seed, same trajectory', async () => {
    expect(await trace(11)).toBe(await trace(11));
  });

  it('another seed, another trajectory', async () => {
    expect(await trace(11)).not.toBe(await trace(12));
  });
});

describe('independence from Papa', () => {
  const tap = (xM: number, zM: number): SimCommand => ({
    type: 'TapFloor',
    t: asSimMs(0),
    xM,
    zM,
  });
  const move = (t: number, dirX: number, dirZ: number): SimCommand => ({
    type: 'Move',
    t: asSimMs(t),
    dirX,
    dirZ,
  });

  it('is not moved or stopped by Papa’s taps and walks', async () => {
    const alone = await newSim({ seed: 8 });
    const busy = await newSim({ seed: 8 });
    busy.enqueue(tap(-1, 1));
    busy.enqueue(move(3000, 1, 0));
    busy.enqueue({ type: 'MoveStop', t: asSimMs(6000) });
    for (let i = 0; i < stepsFor(20000); i++) {
      alone.step();
      busy.step();
      expect(babyOf(busy)).toEqual(babyOf(alone));
    }
  });

  it('does not block Papa: a tap on the baby’s own spot arrives exactly there', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('baby_spawn');
    sim.enqueue(tap(x, z));
    run(sim, stepsFor(1400)); // the baby has not set off yet
    expect([sim.world.papa.xM, sim.world.papa.zM]).toEqual([x, z]);
    expect([babyOf(sim).xM, babyOf(sim).zM]).toEqual([x, z]);
  });
});

describe('when no destination can be planned', () => {
  // A single open cell for both agents: a 3 × 3 block of walkable cells, clearance one cell.
  const rows = geometry.nav.rows.map((row, index) =>
    index < 3 ? `111${'0'.repeat(row.length - 3)}` : '0'.repeat(row.length),
  );
  const cell: LevelGeometry = { ...geometry, nav: { ...geometry.nav, rows } };

  it('babbles on with a later wanderAt each time, emits nothing and does not throw', async () => {
    const sim = await newSim({ geometry: cell });
    const [x, z] = [babyOf(sim).xM, babyOf(sim).zM];
    const deadlines: number[] = [babyOf(sim).wanderAt];
    for (let i = 0; i < stepsFor(30000); i++) {
      sim.step();
      expect(sim.drainEvents()).toEqual([]);
      const { wanderAt } = babyOf(sim);
      if (wanderAt !== deadlines[deadlines.length - 1]) deadlines.push(wanderAt);
    }
    expect(babyOf(sim)).toMatchObject({ state: 'babble', xM: x, zM: z });
    expect(deadlines.length).toBeGreaterThan(3);
    deadlines.forEach((at, index) => {
      if (index > 0) {
        const gap = at - (deadlines[index - 1] as number);
        // Each retry happens at the step that reaches the deadline, then draws a new pause.
        expect(gap).toBeGreaterThanOrEqual(FEEL.babbleMinMs);
        expect(gap).toBeLessThan(FEEL.babbleMaxMs + STEP_MS);
      }
    });
  });
});
