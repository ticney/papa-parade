import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  TEST_TOILET,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { isPapaBusy, type PapaState } from '../papa/papaFsm.ts';
import type { ThreatInstance } from '../world.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const content = createTestContent();
const geometry = createTestGeometry();
const OUTLET_ID = 1;

async function newSim(): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  });
}

const press = (t: number, threatId = OUTLET_ID): SimCommand => ({
  type: 'PressThreat',
  t: asSimMs(t),
  threatId,
});

function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}
const runTo = (sim: Sim, untilSimMs: number): SimEvent[] =>
  run(sim, (untilSimMs - sim.world.time.sim) / STEP_MS);

const refused = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'TapRefused');
const threatOf = (sim: Sim): Readonly<ThreatInstance> => sim.world.threats[0] as ThreatInstance;

function makeBusy(sim: Sim, state: PapaState, busyUntil = 60_000): void {
  const papa = sim.world.papa as Mutable<typeof sim.world.papa>;
  papa.state = state;
  papa.busyUntil = asSimMs(busyUntil);
}

/** A sim stopped one step before the outlet's window is half open, and the time of that half. */
async function almostOpen() {
  const sim = await newSim();
  sim.step();
  sim.drainEvents();
  const { windowOpenAt, responseWindow } = threatOf(sim);
  if (responseWindow === null) throw new Error('the threat was not telegraphed');
  return { sim, centerMs: windowOpenAt + responseWindow.windowMs / 2 };
}

describe('TapRefused (story 2.12)', () => {
  it.each(['drink', 'onPhone', 'onToilet', 'asleep'] as const)(
    'comes out for a press on the telegraphed outlet while %s',
    async (state) => {
      const { sim } = await almostOpen();
      makeBusy(sim, state);
      expect(threatOf(sim).state).toBe('telegraph');
      sim.enqueue(press(sim.world.time.sim));
      const events = run(sim, 1);
      expect(refused(events)).toEqual([
        { type: 'TapRefused', t: sim.world.time.sim, threatId: OUTLET_ID },
      ]);
    },
  );

  it('comes out for a press while the window is open', async () => {
    const { sim, centerMs } = await almostOpen();
    runTo(sim, centerMs);
    makeBusy(sim, 'drink');
    expect(threatOf(sim).state).toBe('windowOpen');
    sim.enqueue(press(centerMs));
    expect(refused(run(sim, 1))).toHaveLength(1);
  });

  it('comes out once per command', async () => {
    const { sim } = await almostOpen();
    makeBusy(sim, 'onPhone');
    sim.enqueue(press(sim.world.time.sim));
    sim.enqueue(press(sim.world.time.sim));
    expect(refused(run(sim, 1))).toHaveLength(2);
    expect(refused(run(sim, 1))).toHaveLength(0);
  });

  it('records nothing: the world is the same with and without the refused press', async () => {
    const withPress = await almostOpen();
    const without = await almostOpen();
    makeBusy(withPress.sim, 'drink');
    makeBusy(without.sim, 'drink');
    withPress.sim.enqueue(press(withPress.sim.world.time.sim));
    run(withPress.sim, 1);
    run(without.sim, 1);
    expect(threatOf(withPress.sim).press).toBeNull();
    expect(withPress.sim.world.papa.state).toBe('drink');
    expect(hashJson(withPress.sim.world)).toBe(hashJson(without.sim.world));
  });

  it('does not come out when Papa is free', async () => {
    const { sim, centerMs } = await almostOpen();
    sim.enqueue(press(centerMs));
    expect(refused(runTo(sim, centerMs + STEP_MS))).toEqual([]);
    expect(threatOf(sim).press).not.toBeNull();
  });

  it('does not come out at the step where busyUntil is reached: the press is judged', async () => {
    const { sim, centerMs } = await almostOpen();
    runTo(sim, centerMs - STEP_MS);
    makeBusy(sim, 'drink', centerMs);
    sim.enqueue(press(centerMs - 10));
    const events = run(sim, 1);
    expect(sim.world.time.sim).toBe(centerMs);
    expect(refused(events)).toEqual([]);
    expect(threatOf(sim).press).not.toBeNull();
  });

  it('does not come out for an unknown threat', async () => {
    const { sim } = await almostOpen();
    makeBusy(sim, 'drink');
    sim.enqueue(press(sim.world.time.sim, 999));
    expect(refused(run(sim, 1))).toEqual([]);
  });

  it('does not come out for a threat that is resolved', async () => {
    const { sim, centerMs } = await almostOpen();
    sim.enqueue(press(centerMs));
    sim.enqueue({ type: 'Release', t: asSimMs(centerMs + 50) });
    runTo(sim, centerMs + 400);
    expect(threatOf(sim).state).toBe('resolved');
    makeBusy(sim, 'drink');
    sim.enqueue(press(sim.world.time.sim));
    expect(refused(run(sim, 1))).toEqual([]);
  });

  it('does not come out for TapBaby or TapFloor while busy', async () => {
    const { sim } = await almostOpen();
    makeBusy(sim, 'drink');
    sim.enqueue({ type: 'TapBaby', t: sim.world.time.sim });
    sim.enqueue({ type: 'TapFloor', t: sim.world.time.sim, xM: 0, zM: 0 });
    expect(refused(run(sim, 1))).toEqual([]);
  });
});

describe('TapRefused through the real busy flows (story 2.12)', () => {
  // The outlet's wave starts long after Papa is busy, and each busy state lasts longer than the test.
  const LATE_MS = 20_000;
  const LONG_MS = 600_000;

  async function busySim(state: 'drink' | 'onPhone' | 'onToilet' | 'asleep'): Promise<Sim> {
    const feel = {
      ...content.feel,
      fatigue: {
        ...content.feel.fatigue,
        coffeeDurationMs: LONG_MS,
        asleepMs: LONG_MS,
        // The micro-sleep is due at once, so a missed one puts Papa to sleep.
        ...(state === 'asleep' ? { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 } : {}),
      },
      bladder: { ...content.feel.bladder, toiletDurationMs: LONG_MS },
    };
    const outletWave = testWave([OUTLET], { fromMs: LATE_MS });
    const level = createTestLevel({
      waves:
        state === 'onPhone'
          ? [testWave([], { disruptions: [testPhoneEntry(5000)] }), outletWave]
          : [outletWave],
      objects: [...TEST_OBJECTS, TEST_TOILET],
      gauges: { ...NEED_GAUGES, ...FATIGUE_GAUGES },
    });
    const phone = level.disruptions.phone;
    const sim = await createSim({
      content: { ...content, feel },
      geometry,
      level: phone
        ? { ...level, disruptions: { phone: { ...phone, answerBusyMs: LONG_MS } } }
        : level,
      seed: 1,
    });
    const command = (cmd: Record<string, unknown>) =>
      sim.enqueue({ ...cmd, t: asSimMs(sim.world.time.sim) } as SimCommand);
    const stepUntil = (done: () => boolean): void => {
      while (!done()) {
        if (sim.world.time.sim > 15_000) throw new Error(`Papa never became ${state}`);
        sim.step();
        sim.drainEvents();
      }
    };
    if (state === 'drink') {
      command({ type: 'SetFatigue', points: 80 });
      command({ type: 'TapObject', objectId: 'coffee_machine' });
    } else if (state === 'onToilet') {
      command({ type: 'SetBladder', pct: 100 });
      command({ type: 'TapObject', objectId: 'toilet' });
    } else if (state === 'onPhone') {
      command({ type: 'StartDisruption', index: 0 });
      command({ type: 'TapObject', objectId: 'phone' });
    }
    stepUntil(() => sim.world.papa.state === state);
    return sim;
  }

  it.each(['drink', 'onPhone', 'onToilet', 'asleep'] as const)(
    'refuses a press on a telegraphed threat while Papa is %s, entered by the real flow',
    async (state) => {
      const sim = await busySim(state);
      // The real start path left Papa busy for a good while, not for the instant it was set.
      expect(isPapaBusy(sim.world.papa)).toBe(true);
      expect(sim.world.papa.busyUntil).toBeGreaterThan(sim.world.time.sim + LONG_MS / 2);
      const events: SimEvent[] = [];
      while (!sim.world.threats.some((t) => t.state === 'telegraph' || t.state === 'windowOpen')) {
        if (sim.world.time.sim > LATE_MS + 5000) throw new Error('the outlet never telegraphed');
        sim.step();
        for (const event of sim.drainEvents()) events.push(event);
      }
      const threat = sim.world.threats.find(
        (t) => t.state === 'telegraph' || t.state === 'windowOpen',
      ) as ThreatInstance;
      expect(sim.world.papa.state).toBe(state);
      sim.enqueue(press(sim.world.time.sim, threat.id));
      expect(refused(run(sim, 1))).toEqual([
        { type: 'TapRefused', t: sim.world.time.sim, threatId: threat.id },
      ]);
      expect(sim.world.papa.state).toBe(state);
      expect(sim.world.threats.find((t) => t.id === threat.id)?.press).toBeNull();
    },
  );
});
