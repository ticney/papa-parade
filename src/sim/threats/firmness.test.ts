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
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { replayJournal } from '../replay.ts';
import type { ThreatInstance } from '../world.ts';

// Story 1.23: a Firmness is a press held `holdMinMs` and kept down to the end of the attack
// (`windowOpenAt + holdUntilMs`). Bounds come from the frozen feel and the def, never from literals.

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const content = createTestContent();
const geometry = createTestGeometry();
const { input } = content.feel;
const HOLD_UNTIL_MS = 1500;

const press = (t: number): SimCommand => ({ type: 'PressThreat', t: asSimMs(t), threatId: 1 });
const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });
const gridCeil = (t: number) => Math.ceil(t / STEP_MS) * STEP_MS;

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

/** The outlet asking for a Firmness, stopped on the step that telegraphed it. */
async function telegraphed(response: 'firm' | 'parry', holdUntilMs = HOLD_UNTIL_MS) {
  const base = createTestLevel({ waves: [testWave([OUTLET])] });
  const outlet = base.threats.outlet;
  if (outlet === undefined) throw new Error('no outlet in the test level');
  const level: LevelContent = {
    ...base,
    threats: {
      ...base.threats,
      outlet: response === 'firm' ? { ...outlet, response, holdUntilMs } : outlet,
    },
  };
  const sim = await createSim({ content, geometry, level, seed: 1 });
  sim.step();
  sim.drainEvents();
  const { windowOpenAt, responseWindow } = threatOf(sim);
  if (responseWindow === null) throw new Error('the threat was not telegraphed');
  return { sim, level, openAt: windowOpenAt, center: windowOpenAt + responseWindow.windowMs / 2 };
}

describe('a firm def without holdUntilMs', () => {
  it('is refused when it is pressed, not played as a hold of holdMinMs', async () => {
    const { level, center } = await telegraphed('firm');
    const outlet = level.threats.outlet;
    if (outlet === undefined) throw new Error('no outlet in the test level');
    // Content that skipped the Zod schema: the def asks for a Firmness and says no end.
    const { holdUntilMs: _skipped, ...bare } = outlet;
    const broken = await createSim({
      content,
      geometry,
      level: { ...level, threats: { ...level.threats, outlet: bare as typeof outlet } },
      seed: 1,
    });
    broken.step();
    broken.enqueue(press(center));
    expect(() => runTo(broken, center + input.holdMinMs + STEP_MS)).toThrow(/holdUntilMs/);
  });
});

describe('a Firmness', () => {
  it.each([
    ['perfect', 0],
    ['success', 100],
  ] as const)(
    'is %s when the finger stays down to the end of the attack, with no release',
    async (quality, shift) => {
      const { sim, openAt, center } = await telegraphed('firm');
      const window = { ...threatOf(sim).responseWindow };
      sim.enqueue(press(center + shift));
      const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
      expect(only(events, 'ResponseResolved')).toEqual([
        {
          type: 'ResponseResolved',
          t: openAt + HOLD_UNTIL_MS,
          threatId: 1,
          response: 'firm',
          quality,
          offsetMs: shift,
          responseWindow: window,
        },
      ]);
      expect(only(events, 'GagTriggered')).toEqual([]);
      expect(threatOf(sim).state).toBe('resolved');
    },
  );

  it('does not resolve before the end of the attack, however long the finger has been down', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS - STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([]);
    expect(threatOf(sim).state).toBe('windowOpen');
    expect(threatOf(sim).press).not.toBeNull();
  });

  it('is held when the release comes exactly at the end, and a later Release changes nothing', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    sim.enqueue(release(openAt + HOLD_UNTIL_MS));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + 300);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'firm', quality: 'perfect', t: openAt + HOLD_UNTIL_MS }),
    ]);
    sim.enqueue(release(openAt + HOLD_UNTIL_MS + 400));
    expect(only(runTo(sim, openAt + HOLD_UNTIL_MS + 500), 'GagTriggered')).toEqual([]);
  });

  it('is a Parry, so a wrongResponse gag, when the finger comes up before holdMinMs', async () => {
    const { sim, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    sim.enqueue(release(center + input.holdMinMs - 1));
    const events = runTo(sim, center + input.holdMinMs + STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'wrongResponse', offsetMs: 0 }),
    ]);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'outlet_hair', reason: 'wrongResponse' }),
    ]);
    expect(only(events, 'ResponseHeld')).toEqual([]);
  });

  it.each([
    ['at holdMinMs', (center: number) => center + input.holdMinMs],
    ['just before the end', (_center: number, openAt: number) => openAt + HOLD_UNTIL_MS - 1],
  ])('is a "released" gag when the finger comes up %s', async (_name, releaseAt) => {
    const { sim, openAt, center } = await telegraphed('firm');
    const at = releaseAt(center, openAt);
    sim.enqueue(press(center));
    sim.enqueue(release(at));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        quality: 'fail',
        reason: 'released',
        offsetMs: 0,
        t: gridCeil(at),
      }),
    ]);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ reason: 'released', t: gridCeil(at) }),
    ]);
    expect(threatOf(sim).state).toBe('gag');
  });

  it('ends holdMinMs after a press so late that the attack would already be over', async () => {
    const shortUntilMs = 500; // above the 300 ms window, below a late press + holdMinMs
    const { sim, openAt, center } = await telegraphed('firm', shortUntilMs);
    const t = center + 100;
    expect(t + input.holdMinMs).toBeGreaterThan(openAt + shortUntilMs);
    sim.enqueue(press(t));
    const early = runTo(sim, openAt + shortUntilMs + STEP_MS);
    expect(only(early, 'ResponseResolved')).toEqual([]);
    const events = runTo(sim, t + input.holdMinMs + STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'firm', quality: 'success', t: t + input.holdMinMs }),
    ]);
  });

  it('keeps a buffered press made while the threat is still in its telegraph, and holds it', async () => {
    const { sim, openAt } = await telegraphed('firm');
    const t = openAt - 100; // inside the buffer: a success, pending until the window opens
    sim.enqueue(press(t));
    runTo(sim, openAt - STEP_MS);
    expect(threatOf(sim)).toMatchObject({ state: 'telegraph', press: { t, quality: 'success' } });
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'firm', quality: 'success', t: openAt + HOLD_UNTIL_MS }),
    ]);
  });

  it('closes the ring once, before the result, holdMinMs after the press', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
    expect(only(events, 'ResponseHeld')).toEqual([
      { type: 'ResponseHeld', t: center + input.holdMinMs, threatId: 1 },
    ]);
    const types = events.map((event) => event.type);
    expect(types.indexOf('ResponseHeld')).toBeLessThan(types.indexOf('ResponseResolved'));
  });

  it('sets heldAt on the pending press when the ring closes, and not before', async () => {
    const { sim, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    runTo(sim, center + input.holdMinMs - STEP_MS);
    expect(threatOf(sim).press).toMatchObject({ heldAt: null });
    runTo(sim, center + input.holdMinMs);
    expect(threatOf(sim).press).toMatchObject({ heldAt: center + input.holdMinMs });
  });

  it('stays a Firmness once the ring has closed, whatever holdMinMs becomes (a SetFeel)', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    runTo(sim, center + input.holdMinMs + STEP_MS);
    expect(threatOf(sim).press).toMatchObject({ heldAt: center + input.holdMinMs });
    // The finger has been down for longer than the old holdMinMs; the new one is longer than it.
    const raised = input.holdMinMs + 400;
    sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: { input: { holdMinMs: raised } } });
    const releaseAt = center + input.holdMinMs + 4 * STEP_MS;
    expect(releaseAt - center).toBeLessThan(raised);
    sim.enqueue(release(releaseAt));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
    expect(sim.world.feel.input.holdMinMs).toBe(raised);
    // A Firmness released too soon, not a Parry on a Firmness threat.
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ reason: 'released', t: gridCeil(releaseAt) }),
    ]);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'released' }),
    ]);
  });

  it('closes the ring on a release at holdMinMs too, then gags in the same step, in that order', async () => {
    const { sim, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    sim.enqueue(release(center + input.holdMinMs));
    const events = runTo(sim, center + input.holdMinMs + STEP_MS);
    const types = events
      .filter((event) => ['ResponseHeld', 'ResponseResolved', 'GagTriggered'].includes(event.type))
      .map((event) => event.type);
    expect(types).toEqual(['ResponseHeld', 'ResponseResolved', 'GagTriggered']);
  });

  it('ignores PressThreat while Papa is busy, but a Release still ends the press', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    runTo(sim, center + STEP_MS);
    const papa = sim.world.papa as Mutable<typeof sim.world.papa>;
    papa.state = 'asleep';
    papa.busyUntil = asSimMs(60_000);
    sim.enqueue(release(center + input.holdMinMs + 20));
    const events = runTo(sim, openAt + HOLD_UNTIL_MS + STEP_MS);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ reason: 'released' }),
    ]);
  });

  it('starts the usual effects of a success at the resolving step: hitstop and the perfect slow-mo', async () => {
    const { sim, openAt, center } = await telegraphed('firm');
    sim.enqueue(press(center));
    runTo(sim, openAt + HOLD_UNTIL_MS - STEP_MS);
    expect(sim.freezeRealMs).toBe(0);
    expect(sim.timeScale).toBe(1);
    runTo(sim, openAt + HOLD_UNTIL_MS);
    expect(sim.freezeRealMs).toBe(content.feel.timing.hitstopMs);
    expect(sim.timeScale).toBe(content.feel.timing.slowMoPerfect.timeScale);
  });
});

describe('ResponseHeld on a Parry threat', () => {
  it('comes once, then the wrongResponse gag, in the same step', async () => {
    const { sim, center } = await telegraphed('parry');
    sim.enqueue(press(center));
    const events = runTo(sim, center + input.holdMinMs + STEP_MS);
    const at = center + input.holdMinMs;
    const tail = events.filter((e) => e.type === 'ResponseHeld' || e.type === 'ResponseResolved');
    expect(tail).toEqual([
      { type: 'ResponseHeld', t: at, threatId: 1 },
      expect.objectContaining({ type: 'ResponseResolved', t: at, reason: 'wrongResponse' }),
    ]);
  });

  it('is never emitted for a Parry, an early press or a late one', async () => {
    const parry = await telegraphed('parry');
    parry.sim.enqueue(press(parry.center));
    parry.sim.enqueue(release(parry.center + input.holdMinMs - 1));
    expect(only(runTo(parry.sim, parry.center + 800), 'ResponseHeld')).toEqual([]);

    const early = await telegraphed('parry');
    early.sim.enqueue(press(early.openAt - 1000));
    expect(only(runTo(early.sim, early.openAt + 800), 'ResponseHeld')).toEqual([]);

    const late = await telegraphed('parry');
    late.sim.enqueue(press(late.openAt + 1000));
    expect(only(runTo(late.sim, late.openAt + 1500), 'ResponseHeld')).toEqual([]);
  });
});

describe('a replay of a held press', () => {
  it('ends in the same state, with the same events, whether the finger is released or held to the end', async () => {
    for (const isReleased of [false, true]) {
      const { sim, level, openAt, center } = await telegraphed('firm');
      sim.enqueue(press(center));
      // Released exactly at the end of the attack: a hold kept, whichever way it ends.
      if (isReleased) sim.enqueue(release(openAt + HOLD_UNTIL_MS));
      const untilSimMs = openAt + HOLD_UNTIL_MS + 200;
      const events = runTo(sim, untilSimMs);
      expect(only(events, 'ResponseResolved')).toEqual([
        expect.objectContaining({ response: 'firm', quality: 'perfect' }),
      ]);

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
      expect(only(replay.value.events, 'ResponseHeld')).toEqual(only(events, 'ResponseHeld'));
      expect(only(replay.value.events, 'ResponseResolved')).toEqual(
        only(events, 'ResponseResolved'),
      );
      replay.value.sim.dispose();
    }
  });
});
