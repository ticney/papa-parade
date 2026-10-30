import type { LevelContent } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { commandProblem, type SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { replayJournal } from '../replay.ts';
import type { ThreatInstance } from '../world.ts';

// Story 2.7 D1: the client corrects every input stamp into the past by the player's screen latency,
// so a press reaches the sim `lagMs` after the instant its `t` names. The sim waits that long before
// it decides what no command has come to say. Bounds come from the frozen feel, never from literals.

const content = createTestContent();
const geometry = createTestGeometry();
const { input } = content.feel;
const HOLD_UNTIL_MS = 1500;

const press = (t: number): SimCommand => ({ type: 'PressThreat', t: asSimMs(t), threatId: 1 });
const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });
const setLag = (lagMs: number): SimCommand => ({ type: 'SetInputLag', t: asSimMs(0), lagMs });

function runTo(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);
const threatOf = (sim: Sim): Readonly<ThreatInstance> => sim.world.threats[0] as ThreatInstance;

/** The outlet (a Parry, or a Firmness), with the lag already commanded, stopped on its telegraph step. */
async function telegraphed(lagMs: number, response: 'firm' | 'parry' = 'parry') {
  const base = createTestLevel({ waves: [testWave([OUTLET])] });
  const outlet = base.threats.outlet;
  if (outlet === undefined) throw new Error('no outlet in the test level');
  const level: LevelContent = {
    ...base,
    threats: {
      ...base.threats,
      outlet: response === 'firm' ? { ...outlet, response, holdUntilMs: HOLD_UNTIL_MS } : outlet,
    },
  };
  const sim = await createSim({ content, geometry, level, seed: 1 });
  if (lagMs > 0) sim.enqueue(setLag(lagMs));
  sim.step();
  sim.drainEvents();
  const { windowOpenAt, responseWindow } = threatOf(sim);
  if (responseWindow === null) throw new Error('the threat was not telegraphed');
  const center = windowOpenAt + responseWindow.windowMs / 2;
  const closesAt = windowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs;
  return { sim, level, openAt: windowOpenAt, center, closesAt };
}

describe('SetInputLag', () => {
  it('is a command the journal knows, with a finite lag of at least 0', () => {
    expect(commandProblem({ type: 'SetInputLag', t: 0, lagMs: 0 })).toBeNull();
    expect(commandProblem({ type: 'SetInputLag', t: 0, lagMs: 250 })).toBeNull();
    for (const lagMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, '100', undefined, null]) {
      expect(commandProblem({ type: 'SetInputLag', t: 0, lagMs }), String(lagMs)).toMatch(
        /SetInputLag: lagMs/,
      );
    }
  });

  it('starts every sim at 0, and sets it at the step that applies it', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])] }),
      seed: 1,
    });
    expect(sim.world.input).toEqual({ lagMs: 0 });
    sim.enqueue(setLag(120));
    expect(sim.world.input.lagMs).toBe(0);
    sim.step();
    expect(sim.world.input.lagMs).toBe(120);
    sim.enqueue({ type: 'SetInputLag', t: asSimMs(sim.world.time.sim), lagMs: 0 });
    sim.step();
    expect(sim.world.input.lagMs).toBe(0);
  });

  it('is journaled and survives a snapshot', async () => {
    const { sim } = await telegraphed(180);
    expect(sim.journal().entries.map((entry) => entry.command.type)).toContain('SetInputLag');
    const snapshot = sim.snapshot();
    expect(snapshot.world.input.lagMs).toBe(180);
    expect(snapshot.version).toBe(15);
  });
});

describe('an unanswered window with a lag', () => {
  it('gags at close + tolerance at a lag of 0 (today)', async () => {
    const { sim, closesAt } = await telegraphed(0);
    expect(only(runTo(sim, closesAt), 'GagTriggered')).toEqual([]);
    expect(only(runTo(sim, closesAt + STEP_MS), 'GagTriggered')).toHaveLength(1);
  });

  it.each([150, 250])('gags lagMs later at a lag of %i', async (lagMs) => {
    const { sim, closesAt } = await telegraphed(lagMs);
    expect(only(runTo(sim, closesAt + lagMs), 'GagTriggered')).toEqual([]);
    expect(threatOf(sim).state).toBe('windowOpen');
    const gag = only(runTo(sim, closesAt + lagMs + STEP_MS), 'GagTriggered');
    expect(gag).toEqual([
      expect.objectContaining({ reason: 'late', t: closesAt + lagMs + STEP_MS }),
    ]);
  });

  it('judges a press made physically after the close, but inside it once corrected, on its t', async () => {
    const lagMs = 150;
    const { sim, closesAt } = await telegraphed(lagMs);
    // Physically at close + 100, so `t` = close − 50: the sim must not have gagged yet.
    runTo(sim, closesAt + 100);
    expect(threatOf(sim).state).toBe('windowOpen');
    const t = closesAt - 50;
    sim.enqueue(press(t));
    sim.enqueue(release(t + 60));
    const events = runTo(sim, closesAt + 3 * STEP_MS + 100);
    expect(only(events, 'GagTriggered')).toEqual([]);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'parry', quality: 'success' }),
    ]);
  });

  it('without the lag, the same late press arrives on a threat that has already gagged', async () => {
    const { sim, closesAt } = await telegraphed(0);
    runTo(sim, closesAt + 100);
    expect(threatOf(sim).state).toBe('gag');
  });
});

describe('a press with a lag', () => {
  it('a 200 ms tap stays a Parry on a 250 ms lag device', async () => {
    const lagMs = 250;
    const { sim, center } = await telegraphed(lagMs);
    sim.enqueue(press(center));
    // At center + 400 physically the finger has been down for 400 − ... but its release (200 ms) is
    // still on its way: the press must not have been called a Firmness.
    const early = runTo(sim, center + input.holdMinMs + STEP_MS);
    expect(only(early, 'ResponseHeld')).toEqual([]);
    expect(only(early, 'GagTriggered')).toEqual([]);
    expect(threatOf(sim).press).not.toBeNull();
    sim.enqueue(release(center + 200));
    const events = runTo(sim, center + input.holdMinMs + lagMs + 100);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'parry', quality: 'perfect' }),
    ]);
    expect(only(events, 'GagTriggered')).toEqual([]);
  });

  it('a held press still fires ResponseHeld, lagMs later than at a lag of 0', async () => {
    const lagMs = 150;
    const { sim, center } = await telegraphed(lagMs);
    sim.enqueue(press(center));
    const events = runTo(sim, center + input.holdMinMs + lagMs + STEP_MS);
    expect(only(events, 'ResponseHeld')).toEqual([
      { type: 'ResponseHeld', t: center + input.holdMinMs + lagMs, threatId: 1 },
    ]);
  });

  it('a Firmness held to the end of the attack resolves lagMs later', async () => {
    const lagMs = 150;
    const { sim, openAt, center } = await telegraphed(lagMs, 'firm');
    sim.enqueue(press(center));
    const endAt = openAt + HOLD_UNTIL_MS;
    expect(only(runTo(sim, endAt + lagMs - STEP_MS), 'ResponseResolved')).toEqual([]);
    expect(only(runTo(sim, endAt + lagMs + STEP_MS), 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'firm', t: endAt + lagMs }),
    ]);
  });

  it('a Firmness let go just before the end is a release, not a hold, when its release is late', async () => {
    const lagMs = 150;
    const { sim, openAt, center } = await telegraphed(lagMs, 'firm');
    sim.enqueue(press(center));
    const endAt = openAt + HOLD_UNTIL_MS;
    // The finger came up 40 ms before the end; the corrected release reaches the sim lagMs after.
    runTo(sim, endAt - 40 + lagMs);
    sim.enqueue(release(endAt - 40));
    const events = runTo(sim, endAt + lagMs + 3 * STEP_MS);
    expect(only(events, 'GagTriggered')).toEqual([expect.objectContaining({ reason: 'released' })]);
  });
});

describe('a game with SetInputLag', () => {
  it('replays to the same world and the same events', async () => {
    const { sim, level, center, openAt } = await telegraphed(120);
    sim.enqueue(press(center));
    sim.enqueue(release(center + 80));
    const untilSimMs = openAt + 600;
    const events = runTo(sim, untilSimMs);
    const replay = await replayJournal({
      content,
      geometry,
      level,
      journal: sim.journal(),
      untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(sim.world));
    expect(only(replay.value.events, 'ResponseResolved')).toEqual(only(events, 'ResponseResolved'));
    replay.value.sim.dispose();
    sim.dispose();
  });

  it('changes nothing at a lag of 0: no command, same world as one that sets 0', async () => {
    const { sim: bare, center } = await telegraphed(0);
    bare.enqueue(press(center));
    bare.enqueue(release(center + 80));
    const bareEvents = runTo(bare, center + 600);
    const zero = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])] }),
      seed: 1,
    });
    zero.enqueue({ type: 'SetInputLag', t: asSimMs(0), lagMs: 0 });
    zero.step();
    zero.drainEvents();
    zero.enqueue(press(center));
    zero.enqueue(release(center + 80));
    const zeroEvents = runTo(zero, center + 600);
    expect(zeroEvents).toEqual(bareEvents);
    bare.dispose();
    zero.dispose();
  });
});
