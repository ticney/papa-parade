import { PAPA_TARGET_ANCHOR_ID } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestResponseWindow,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createResponseChoreography, type ResponseCue } from './responseChoreography.ts';

const t = (ms: number) => asSimMs(ms);

const resolved = (
  quality: 'perfect' | 'success' | 'fail',
  threatId = 1,
  offsetMs: number | null = 0,
  atMs = 1000,
): SimEvent => ({
  type: 'ResponseResolved',
  t: t(atMs),
  threatId,
  response: 'parry',
  quality,
  offsetMs,
  responseWindow: createTestResponseWindow(),
});

/** A world slice with just what the choreography reads. */
const worldWith = (
  papaState: string,
  glideThreatId: number | null,
  simMs = 1000,
  threats: readonly { id: number; anchorId: string }[] = [],
  successes = 0,
  isDuel = false,
): Readonly<World> =>
  ({
    time: { sim: t(simMs) },
    threats,
    papa: {
      state: papaState,
      glide: glideThreatId === null ? null : { threatId: glideThreatId },
    },
    score: { successes },
    feel: { characters: { relief: { lastSharePct: 25 } } },
    sequence: { duel: { isRunning: isDuel }, stealth: { isRunning: false } },
  }) as unknown as Readonly<World>;

function setup() {
  const lifts: number[] = [];
  const clips: string[] = [];
  const cues: ResponseCue[] = [];
  return {
    choreography: createResponseChoreography(),
    fx: {
      liftBaby: (startAt: number) => void lifts.push(startAt),
      playResponseClip: (cue: Readonly<ResponseCue>) => {
        clips.push(`${cue.response}/${cue.quality}`);
        cues.push({ ...cue });
      },
    },
    lifts,
    clips,
    cues,
  };
}

describe('createResponseChoreography', () => {
  it('plays the response clip with the pose, at once or on arrival, and never for a dropped glide', () => {
    const { choreography, fx, clips } = setup();
    choreography.onEvent(resolved('perfect'), worldWith('idle', null), fx);
    expect(clips).toEqual(['parry/perfect']);
    // Gliding: the sound fired at the judgement, the clip waits for him (P3).
    choreography.onEvent(resolved('success'), worldWith('glide', 1), fx);
    expect(clips).toEqual(['parry/perfect']);
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1200), xM: 0, zM: 0 },
      worldWith('idle', null),
      fx,
    );
    expect(clips).toEqual(['parry/perfect', 'parry/success']);
    // The glide cancelled: the clip is dropped with the pose.
    choreography.onEvent(resolved('success'), worldWith('glide', 1), fx);
    choreography.onEvent(
      { type: 'PapaStateChanged', t: t(1300), from: 'glide', to: 'walkPath' },
      worldWith('walkPath', null),
      fx,
    );
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1400), xM: 0, zM: 0 },
      worldWith('idle', null),
      fx,
    );
    expect(clips).toHaveLength(2);
  });

  it('plays the clip of a threat on Papa at once, with no baby to lift', () => {
    const { choreography, fx, clips, lifts } = setup();
    const world = worldWith('idle', null, 1000, [{ id: 2, anchorId: PAPA_TARGET_ANCHOR_ID }]);
    choreography.onEvent(resolved('success', 2), world, fx);
    expect(clips).toEqual(['parry/success']);
    expect(lifts).toEqual([]);
  });

  it('plays the pose at once when Papa is not gliding to the threat, at the sim time of the world', () => {
    const { choreography, fx, lifts } = setup();
    choreography.onEvent(resolved('success'), worldWith('idle', null, 1234), fx);
    expect(lifts).toEqual([1234]);
  });

  it('plays nothing for the micro-sleep: a threat that stands on Papa has no baby to lift', () => {
    const { choreography, fx, lifts } = setup();
    const world = worldWith('idle', null, 1000, [
      { id: 1, anchorId: 'outlet_01' },
      { id: 2, anchorId: PAPA_TARGET_ANCHOR_ID },
    ]);
    choreography.onEvent(resolved('perfect', 2), world, fx);
    expect(lifts).toEqual([]);
    choreography.onEvent(resolved('perfect', 1), world, fx);
    expect(lifts).toEqual([1000]);
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

  it('tells the pose the world of the judgement: its successes, its guard and its instant (story 7.12, D6)', () => {
    const { choreography, fx, cues } = setup();
    choreography.onEvent(resolved('success', 1, 0, 1000), worldWith('idle', null, 1000, [], 4), fx);
    expect(cues).toEqual([
      {
        response: 'parry',
        quality: 'success',
        successes: 4,
        isRelief: false,
        isSignalOnly: false,
        atMs: 1000,
      },
    ]);
    choreography.onEvent(
      resolved('perfect', 1, 0, 1200),
      worldWith('idle', null, 1200, [], 5, true),
      fx,
    );
    expect(cues[1]).toMatchObject({
      quality: 'perfect',
      successes: 5,
      isSignalOnly: true,
      atMs: 1200,
    });
  });

  it('marks a success late in its window, its tolerance included, as a relief; never a perfect', () => {
    const window = createTestResponseWindow();
    const half = window.windowMs / 2 + window.toleranceMs;
    const { choreography, fx, cues } = setup();
    choreography.onEvent(
      resolved('success', 1, Math.ceil(half * 0.5)),
      worldWith('idle', null),
      fx,
    );
    choreography.onEvent(
      resolved('success', 1, -Math.ceil(half * 0.5)),
      worldWith('idle', null),
      fx,
    );
    choreography.onEvent(
      resolved('perfect', 1, Math.ceil(half * 0.5)),
      worldWith('idle', null),
      fx,
    );
    expect(cues.map((cue) => cue.isRelief)).toEqual([true, false, false]);
  });

  it("keeps the judgement's world for the arrival, dated at the arrival, whatever comes meanwhile", () => {
    const window = createTestResponseWindow();
    const late = Math.ceil((window.windowMs / 2 + window.toleranceMs) * 0.5);
    const { choreography, fx, cues } = setup();
    choreography.onEvent(
      resolved('success', 1, late, 1000),
      worldWith('glide', 1, 1000, [], 2),
      fx,
    );
    expect(cues).toEqual([]);
    // The micro-sleep, judged while he glides: its pose plays at once and leaves the queued one be.
    const onPapa = worldWith('glide', 1, 1100, [{ id: 2, anchorId: PAPA_TARGET_ANCHOR_ID }], 3);
    choreography.onEvent(resolved('perfect', 2, 0, 1100), onPapa, fx);
    choreography.onEvent(
      { type: 'PapaArrived', t: t(1400), xM: 0, zM: 0 },
      worldWith('idle', null, 1400, [], 9),
      fx,
    );
    expect(cues).toHaveLength(2);
    expect(cues[1]).toEqual({
      response: 'parry',
      quality: 'success',
      successes: 2,
      isRelief: true,
      isSignalOnly: false,
      atMs: 1400,
    });
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
