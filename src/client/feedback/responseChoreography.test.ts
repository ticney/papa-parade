import { asSimMs } from '@shared/time';
import { createSim, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createResponseChoreography } from './responseChoreography.ts';

const t = (ms: number) => asSimMs(ms);

const resolved = (quality: 'perfect' | 'success' | 'fail', threatId = 1): SimEvent => ({
  type: 'ResponseResolved',
  t: t(1000),
  threatId,
  response: 'parry',
  quality,
  offsetMs: 0,
});

/** A world slice with just what the choreography reads. */
const worldWith = (
  papaState: string,
  glideThreatId: number | null,
  simMs = 1000,
): Readonly<World> =>
  ({
    time: { sim: t(simMs) },
    papa: {
      state: papaState,
      glide: glideThreatId === null ? null : { threatId: glideThreatId },
    },
  }) as unknown as Readonly<World>;

function setup() {
  const lifts: number[] = [];
  return {
    choreography: createResponseChoreography(),
    fx: { liftBaby: (startAt: number) => void lifts.push(startAt) },
    lifts,
  };
}

describe('createResponseChoreography', () => {
  it('plays the pose at once when Papa is not gliding to the threat, at the sim time of the world', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success'), worldWith('idle', null, 1234), fx);
    expect(lifts).toEqual([1234]);
  });

  it('plays it at once when Papa glides to another threat', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('perfect', 1), worldWith('glide', 2, 900), fx);
    expect(lifts).toEqual([900]);
  });

  it('queues the pose while Papa glides to that threat, and plays it when he arrives, at the arrival time', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success', 1), worldWith('glide', 1), fx);
    expect(lifts).toEqual([]);
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1400), xM: 1, zM: 1 },
      worldWith('idle', null),
      fx,
    );
    expect(lifts).toEqual([1400]);
  });

  it('plays it once: a second arrival does nothing', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success', 1), worldWith('glide', 1), fx);
    const arrived: SimEvent = { type: 'PapaArrived', t: t(1400), xM: 1, zM: 1 };
    choreography.onEvent(arrived, worldWith('idle', null), fx);
    choreography.onEvent(arrived, worldWith('idle', null), fx);
    expect(lifts).toHaveLength(1);
  });

  it('drops the pose when the glide is cancelled by a floor tap or a move', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success', 1), worldWith('glide', 1), fx);
    choreography.onEvent(
      { type: 'PapaStateChanged', t: t(1100), from: 'glide', to: 'walkPath' },
      worldWith('walkPath', null),
      fx,
    );
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1900), xM: 1, zM: 1 },
      worldWith('idle', null),
      fx,
    );
    expect(lifts).toEqual([]);
  });

  it('keeps the pose when the glide ends by arriving (glide to idle)', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success', 1), worldWith('glide', 1), fx);
    choreography.onEvent(
      { type: 'PapaStateChanged', t: t(1400), from: 'glide', to: 'idle' },
      worldWith('idle', null),
      fx,
    );
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1400), xM: 1, zM: 1 },
      worldWith('idle', null),
      fx,
    );
    expect(lifts).toEqual([1400]);
  });

  it('plays nothing for a failed response (its gag is presented by GagTriggered)', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('fail'), worldWith('idle', null), fx);
    expect(lifts).toEqual([]);
  });

  it('ignores an arrival with nothing queued, and every other event', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(
      { type: 'PapaArrived', t: t(10), xM: 0, zM: 0 },
      worldWith('idle', null),
      fx,
    );
    choreography.onEvent(
      { type: 'WindowOpened', t: t(10), threatId: 1 },
      worldWith('idle', null),
      fx,
    );
    choreography.onEvent(
      { type: 'PapaStateChanged', t: t(10), from: 'idle', to: 'walkPath' },
      worldWith('walkPath', null),
      fx,
    );
    expect(lifts).toEqual([]);
  });

  it('forgets a queued pose on reset (a new level)', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success', 1), worldWith('glide', 1), fx);
    choreography.reset();
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1400), xM: 1, zM: 1 },
      worldWith('idle', null),
      fx,
    );
    expect(lifts).toEqual([]);
  });

  it('with a real sim: a press on the outlet queues the pose until Papa arrives, with no second result', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({ waves: [testWave([OUTLET])] }),
      seed: 1,
    });
    const { choreography, fx, lifts } = setup();
    let pressed = false;
    let resolvedCount = 0;
    let arrivalAt: number | null = null;
    for (let step = 0; step < 600 && arrivalAt === null; step++) {
      const threat = sim.world.threats[0];
      if (!pressed && threat?.state === 'windowOpen') {
        sim.enqueue({ type: 'PressThreat', t: sim.world.time.sim, threatId: threat.id });
        sim.enqueue({ type: 'Release', t: sim.world.time.sim });
        pressed = true;
      }
      sim.step();
      for (const event of sim.drainEvents()) {
        if (event.type === 'ResponseResolved') resolvedCount++;
        if (event.type === 'PapaArrived') arrivalAt = event.t;
        choreography.onEvent(event, sim.world, fx);
      }
    }
    expect(pressed).toBe(true);
    expect(resolvedCount).toBe(1);
    expect(arrivalAt).not.toBeNull();
    // The pose played once, at the arrival or at the resolution if Papa was already at the outlet.
    expect(lifts).toHaveLength(1);
    expect(lifts[0]).toBeLessThanOrEqual(arrivalAt as number);
  });
});
