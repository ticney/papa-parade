import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  stepN,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { computeMamaScore } from '../scoring/mamaScore.ts';
import type { World } from '../world.ts';
import { enterFlowState, FLOW_STATES, FLOW_STATES_ARE_COMPLETE, isFlowLive } from './flowFsm.ts';

const DURATION_MS = 1000;

async function newSim(waves = false, durationMs = DURATION_MS) {
  return createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({ durationMs, waves: waves ? [testWave([OUTLET])] : [] }),
    seed: 3,
  });
}

describe('the flow FSM', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...FLOW_STATES]).toEqual(['playing', 'sequence', 'ended']);
    expect(FLOW_STATES_ARE_COMPLETE).toBe(true);
  });

  it('enterFlowState is the one writer of the state and its time, and emits nothing', async () => {
    const sim = await newSim();
    stepN(sim, 5);
    const world = sim.world as Parameters<typeof enterFlowState>[0];
    enterFlowState(world, 'ended');
    expect(world.flow).toEqual({ state: 'ended', enteredAt: 5 * STEP_MS });
    expect(sim.drainEvents()).toEqual([]);
  });
});

describe('runFlow', () => {
  it('starts playing', async () => {
    const sim = await newSim();
    expect(sim.world.flow).toEqual({ state: 'playing', enteredAt: 0 });
  });

  it('ends the level at the first step where the clock reaches durationMs, with LevelEnded{timer} once', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS - 1);
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.drainEvents().some((event) => event.type === 'LevelEnded')).toBe(false);
    sim.step();
    expect(sim.world.time.sim).toBe(DURATION_MS);
    expect(sim.world.flow).toEqual({ state: 'ended', enteredAt: DURATION_MS });
    expect(sim.drainEvents().filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: DURATION_MS, reason: 'timer' },
    ]);
  });

  it('gives the combo points cashed in to the Rire of the note, and loses the ones not cashed (story 4.2)', async () => {
    const sim = await newSim();
    const world = sim.world as World;
    world.score.comboPoints = 12;
    // A combo still running when the level ends is lost, with no event.
    world.combo.multiplier = 5;
    world.combo.basePoints = 3;
    stepN(sim, DURATION_MS / STEP_MS);
    const scored = sim.drainEvents().filter((event) => event.type === 'LevelScored');
    expect(scored).toHaveLength(1);
    expect(scored[0]).toMatchObject({ laughPoints: 12 });
    expect(sim.world.score.final?.laughPoints).toBe(12);
    expect(sim.world.score.comboPoints).toBe(12);
  });

  it('emits it exactly once, however long the clock keeps going', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS);
    sim.drainEvents();
    stepN(sim, 500);
    expect(sim.drainEvents().filter((event) => event.type === 'LevelEnded')).toEqual([]);
    expect(sim.world.flow.enteredAt).toBe(DURATION_MS);
  });

  it('ends a level with waves too, and the clock goes on past the end', async () => {
    const sim = await newSim(true);
    stepN(sim, DURATION_MS / STEP_MS + 50);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.time.sim).toBe(DURATION_MS + 50 * STEP_MS);
  });

  it('gives Mama’s note in the ending step: LevelScored right after LevelEnded, same t, and once (story 1.22)', async () => {
    const sim = await newSim(true);
    const seen: SimEvent[] = [];
    for (let i = 0; i < DURATION_MS / STEP_MS - 1; i++) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    // None while playing.
    expect(seen.some((event) => event.type === 'LevelScored')).toBe(false);
    expect(sim.world.score.final).toBeNull();
    sim.step();
    const last = sim.drainEvents();
    const ended = last.findIndex((event) => event.type === 'LevelEnded');
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(last[ended + 1]).toEqual({
      type: 'LevelScored',
      t: DURATION_MS,
      ...computeMamaScore(
        {
          perfects: sim.world.score.perfects,
          nearMisses: sim.world.score.nearMisses,
          comboPoints: sim.world.score.comboPoints,
          propsOnFloor: sim.world.mess.propsOnFloor,
          propsBroken: sim.world.mess.propsBroken,
          mischiefs: sim.world.mess.mischiefs,
        },
        createTestContent().feel.mama,
        false,
      ),
    });
    expect(last.filter((event) => event.type === 'LevelScored')).toHaveLength(1);
    const {
      type: _type,
      t: _t,
      ...note
    } = last[ended + 1] as Extract<SimEvent, { type: 'LevelScored' }>;
    expect(sim.world.score.final).toEqual(note);
    // None after: the ended steps run only the clock and the commands.
    stepN(sim, 300);
    expect(sim.drainEvents().some((event) => event.type === 'LevelScored')).toBe(false);
  });

  it('is the same step for a duration that is off the step grid', async () => {
    const sim = await newSim(false, 1005);
    stepN(sim, 100);
    expect(sim.world.flow.state).toBe('playing');
    sim.step();
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.flow.enteredAt).toBe(1010);
  });
});

describe('runFlow: Mama wakes (story 3.2)', () => {
  const MAMA = createTestContent().feel.mama;
  const gameplayEvents = (events: readonly SimEvent[]) =>
    events.filter((event) => event.type !== 'TimeScaleChanged');

  async function noisySim(options: {
    durationMs?: number;
    phoneAtMs?: number;
    silence?: boolean;
    withGauge?: boolean;
  }) {
    const waves =
      options.phoneAtMs !== undefined
        ? [testWave([], { disruptions: [testPhoneEntry(options.phoneAtMs)] })]
        : options.silence === true
          ? [testWave([SILENCE])]
          : [];
    return createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: options.durationMs ?? 60_000,
        waves,
        objects: TEST_OBJECTS,
        gauges: options.withGauge === false ? {} : NOISE_GAUGES,
      }),
      seed: 3,
    });
  }

  const setNoise = (sim: Sim, pct: number) =>
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct });

  const noteOf = (event: SimEvent | undefined) => {
    if (event?.type !== 'LevelScored') throw new Error('expected a LevelScored');
    return event;
  };

  it('ends the level at the step the noise reaches 100: MamaWoke, LevelEnded{mamaWoke}, LevelScored, same t, in that order', async () => {
    const sim = await noisySim({});
    stepN(sim, 20);
    sim.drainEvents();
    expect(sim.world.flow.state).toBe('playing');
    setNoise(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    const t = sim.world.time.sim;
    expect(sim.world.gauges.noisePct).toBe(100);
    expect(sim.world.flow).toEqual({ state: 'ended', enteredAt: t });
    expect(events.map((event) => event.type)).toEqual([
      'NoiseChanged',
      'MamaWoke',
      'LevelEnded',
      'LevelScored',
    ]);
    expect(events[1]).toEqual({ type: 'MamaWoke', t });
    expect(events[2]).toEqual({ type: 'LevelEnded', t, reason: 'mamaWoke' });
    expect(noteOf(events[3]).t).toBe(t);
    expect(t).toBeLessThan(60_000);
  });

  it('freezes the world afterwards: 100 more steps give no gameplay event and move nothing but the clock', async () => {
    const sim = await noisySim({ phoneAtMs: 0 });
    setNoise(sim, 100);
    sim.step();
    sim.drainEvents();
    const frozen = JSON.stringify({ ...sim.world, time: null });
    stepN(sim, 100);
    expect(gameplayEvents(sim.drainEvents())).toEqual([]);
    expect(JSON.stringify({ ...sim.world, time: null })).toBe(frozen);
    expect(sim.world.time.sim).toBeGreaterThan(sim.world.flow.enteredAt);
  });

  it('does not end at 99.9 %', async () => {
    const sim = await noisySim({});
    setNoise(sim, 99.9);
    sim.step();
    expect(sim.world.gauges.noisePct).toBe(99.9);
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.drainEvents().some((event) => event.type === 'MamaWoke')).toBe(false);
  });

  it('ends on a real source too, not only on the debug command: a ringing phone loud enough reaches 100', async () => {
    const content = createTestContent();
    content.feel.noise.sources.phoneRinging.perSec = 200;
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: 60_000,
        waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
        objects: TEST_OBJECTS,
        gauges: NOISE_GAUGES,
      }),
      seed: 3,
    });
    const events: SimEvent[] = [];
    for (let i = 0; i < 1000 && sim.world.flow.state === 'playing'; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.gauges.noisePct).toBe(100);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'MamaWoke')).toHaveLength(1);
    expect(types.indexOf('MamaWoke')).toBe(types.indexOf('LevelEnded') - 1);
    const woke = events.find((event) => event.type === 'MamaWoke');
    expect(events.find((event) => event.type === 'LevelEnded')).toEqual({
      type: 'LevelEnded',
      t: woke?.t,
      reason: 'mamaWoke',
    });
    // Noise from a source only (the first ring tick of the phone): no debug event.
    expect(events.some((event) => event.type === 'NoiseChanged' && event.source === 'debug')).toBe(
      false,
    );
  });

  it('closes a ringing phone before it: PhoneRingEnded{levelEnded} comes before MamaWoke', async () => {
    const sim = await noisySim({ phoneAtMs: 500 });
    for (let i = 0; i < 2000 && sim.world.disruptions[0]?.state !== 'ringing'; i++) {
      sim.step();
      sim.drainEvents();
    }
    expect(sim.world.disruptions[0]?.state).toBe('ringing');
    setNoise(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    const t = sim.world.time.sim;
    const types = events.map((event) => event.type);
    expect(events.filter((event) => event.type === 'PhoneRingEnded')).toEqual([
      { type: 'PhoneRingEnded', t, objectId: 'phone', reason: 'levelEnded' },
    ]);
    expect(types.indexOf('PhoneRingEnded')).toBeLessThan(types.indexOf('MamaWoke'));
    expect(types.indexOf('MamaWoke')).toBe(types.indexOf('LevelEnded') - 1);
    expect(sim.world.disruptions[0]?.state).toBe('timedOut');
  });

  it('closes an open silence before it: SilenceEnded{levelEnded} comes before MamaWoke', async () => {
    const sim = await noisySim({ silence: true });
    for (let i = 0; i < 3000 && sim.world.silence.startedAt === null; i++) sim.step();
    expect(sim.world.silence.startedAt).not.toBeNull();
    sim.drainEvents();
    setNoise(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    const types = events.map((event) => event.type);
    expect(events.filter((event) => event.type === 'SilenceEnded')).toEqual([
      expect.objectContaining({ reason: 'levelEnded', t: sim.world.time.sim }),
    ]);
    expect(types.indexOf('SilenceEnded')).toBeLessThan(types.indexOf('MamaWoke'));
    expect(types.indexOf('MamaWoke')).toBe(types.indexOf('LevelEnded') - 1);
    expect(sim.world.silence).toEqual({ threatId: null, zoneEnteredAt: null, startedAt: null });
  });

  it('never ends a level with no noise gauge, even if its noise were at 100', async () => {
    const sim = await noisySim({ withGauge: false });
    setNoise(sim, 100);
    stepN(sim, 5);
    expect(sim.world.gauges.noisePct).toBe(0);
    expect(sim.world.flow.state).toBe('playing');
    // Forced by hand (SetNoise is ignored there): the gate is the level's gauge, not the value.
    (sim.world as { gauges: { noisePct: number } }).gauges.noisePct = 100;
    stepN(sim, 5);
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.drainEvents().some((event) => event.type === 'MamaWoke')).toBe(false);
  });

  it('gives a tie at durationMs to Mama: the noise is checked before the clock', async () => {
    const sim = await noisySim({ durationMs: DURATION_MS });
    stepN(sim, DURATION_MS / STEP_MS - 1);
    sim.drainEvents();
    expect(sim.world.flow.state).toBe('playing');
    setNoise(sim, 100);
    sim.step();
    expect(sim.world.time.sim).toBe(DURATION_MS);
    const events = sim.drainEvents();
    expect(events.filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: DURATION_MS, reason: 'mamaWoke' },
    ]);
    expect(events.filter((event) => event.type === 'MamaWoke')).toHaveLength(1);
  });

  it('keeps the timer end as it was: no MamaWoke, no lost star, whatever the noise did below 100', async () => {
    const sim = await noisySim({ durationMs: DURATION_MS });
    setNoise(sim, 90);
    const seen: SimEvent[] = [];
    for (let i = 0; i < DURATION_MS / STEP_MS; i++) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    expect(seen.some((event) => event.type === 'MamaWoke')).toBe(false);
    expect(seen.filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: DURATION_MS, reason: 'timer' },
    ]);
    expect(sim.world.score.final?.lostStars).toBe(0);
  });

  it('takes earlyWakePenaltyStars off the note, never below 0, and keeps the points', async () => {
    const quiet = await noisySim({ durationMs: DURATION_MS });
    stepN(quiet, DURATION_MS / STEP_MS);
    const timer = quiet.world.score.final;
    const woken = await noisySim({});
    stepN(woken, 5);
    setNoise(woken, 100);
    woken.step();
    const note = woken.world.score.final;
    expect(timer).not.toBeNull();
    expect(note).not.toBeNull();
    if (timer === null || note === null) return;
    expect(timer.stars).toBeGreaterThanOrEqual(1);
    expect(note.lostStars).toBe(Math.min(MAMA.earlyWakePenaltyStars, timer.stars));
    expect(note.stars).toBe(timer.stars - note.lostStars);
    expect(note.scorePoints).toBe(timer.scorePoints);
    expect(note.lostStars).toBeGreaterThanOrEqual(1);
  });
});

describe('isFlowLive (story 4.4)', () => {
  it('is true while playing and in a sequence, false once ended', async () => {
    const sim = await newSim();
    const world = sim.world as World;
    expect(isFlowLive(world)).toBe(true);
    enterFlowState(world, 'sequence');
    expect(isFlowLive(world)).toBe(true);
    enterFlowState(world, 'ended');
    expect(isFlowLive(world)).toBe(false);
  });

  it('a level in a sequence still ends on its timer: runFlow returns only for ended', async () => {
    const sim = await newSim(false, 500);
    const world = sim.world as World;
    enterFlowState(world, 'sequence');
    stepN(sim, 50);
    expect(world.flow.state).toBe('ended');
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'LevelEnded')
        .map((event) => (event as Extract<SimEvent, { type: 'LevelEnded' }>).reason),
    ).toEqual(['timer']);
  });
});
