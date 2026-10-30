import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  OUTLET,
  SILENCE,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { GAG_IDS, gagIdOf } from './gags.ts';
import {
  cancelThreat,
  enterThreatState,
  gagThreat,
  hideThreat,
  openWindow,
  rearmThreat,
  resolveThreat,
  THREAT_STATES,
  THREAT_STATES_ARE_COMPLETE,
  telegraphThreat,
} from './threatFsm.ts';

const content = createTestContent();
const def = createTestLevel({ waves: [testWave([OUTLET])] }).threats.outlet;
if (def === undefined) throw new Error('no outlet');
// The test feel (tests/support/testContent.ts) has timing windowMs 300, perfectMs 100, toleranceMs
// 60, bufferMs 100, and the outlet def sets no windowMs of its own. Literals on purpose: the
// expectation must not be computed with the production formula (min(perfectMs, windowMs), the
// feel's window as the fallback).
expect(content.feel.timing).toMatchObject({
  windowMs: 300,
  perfectMs: 100,
  toleranceMs: 60,
  bufferMs: 100,
});
expect(def.windowMs ?? null).toBeNull();
/** What a threat with no frozen window (never telegraphed) is reported against: the plain window of its def. */
const nominalWindow = { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 };

/** A world with its one planned threat and a context that only collects events. */
async function setup() {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const freezes: number[] = [];
  const ctx = {
    feel: content.feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    // A level with no fatigue: the window modifier is neutral.
    level: { microSleepIndex: -1 },
    requestFreezeRealMs: (ms: number) => freezes.push(ms),
  } as unknown as StepContext;
  const threat = world.threats[0] as World['threats'][number];
  return { world, ctx, events, threat, freezes };
}

describe('threat FSM', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...THREAT_STATES]).toEqual([
      'idle',
      'hidden',
      'telegraph',
      'windowOpen',
      'resolved',
      'gag',
    ]);
    expect(THREAT_STATES_ARE_COMPLETE).toBe(true);
  });

  it('enterThreatState writes the state and the time, and emits nothing', async () => {
    const { world, threat, events } = await setup();
    enterThreatState(world, threat, 'windowOpen');
    expect(threat).toMatchObject({ state: 'windowOpen', enteredAt: 500 });
    expect(events).toEqual([]);
  });

  it('telegraphThreat freezes the window, fixes the opening instant and announces the threat', async () => {
    const { world, ctx, events, threat } = await setup();
    threat.press = {
      t: asSimMs(1),
      quality: 'perfect',
      offsetMs: 0,
      releasedAt: null,
      heldAt: null,
    };
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat).toMatchObject({
      state: 'telegraph',
      enteredAt: 500,
      windowOpenAt: 500 + 1200,
      press: null,
      responseWindow: { windowMs: content.feel.timing.windowMs },
    });
    expect(events).toEqual([
      {
        type: 'ThreatTelegraphed',
        t: 500,
        threatId: 1,
        kind: 'outlet',
        anchorId: 'outlet_01',
        waveIndex: 0,
      },
    ]);
  });

  it('openWindow emits WindowOpened', async () => {
    const { world, ctx, events, threat } = await setup();
    openWindow(world, ctx, threat);
    expect(threat.state).toBe('windowOpen');
    expect(events).toEqual([{ type: 'WindowOpened', t: 500, threatId: 1 }]);
  });

  it('resolveThreat emits the quality and clears the press', async () => {
    const { world, ctx, events, threat, freezes } = await setup();
    threat.press = {
      t: asSimMs(400),
      quality: 'success',
      offsetMs: -20,
      releasedAt: null,
      heldAt: null,
    };
    resolveThreat(world, ctx, threat, def, 'success', -20);
    expect(threat).toMatchObject({ state: 'resolved', press: null });
    // A success freezes for the hitstop, with no slow-mo.
    expect(freezes).toEqual([content.feel.timing.hitstopMs]);
    expect(world.time.slowMos).toEqual([]);
    expect(events).toEqual([
      {
        type: 'ResponseResolved',
        t: 500,
        threatId: 1,
        response: 'parry',
        quality: 'success',
        offsetMs: -20,
        responseWindow: nominalWindow,
      },
    ]);
  });

  it('puts on ResponseResolved a copy of the window the threat was frozen with at its telegraph (story 2.1)', async () => {
    const { world, ctx, events, threat } = await setup();
    telegraphThreat(world, ctx, threat, def, -1);
    const frozen = structuredClone(threat.responseWindow);
    expect(frozen).not.toBeNull();
    events.length = 0;
    resolveThreat(world, ctx, threat, def, 'success', 5);
    const resolved = events.find((event) => event.type === 'ResponseResolved');
    expect(resolved).toMatchObject({ responseWindow: frozen });
    if (resolved?.type !== 'ResponseResolved') return;
    expect(resolved.responseWindow).not.toBe(threat.responseWindow);
    // The event is its own object: rewriting it does not rewrite the threat.
    resolved.responseWindow.windowMs = 0;
    expect(threat.responseWindow).toEqual(frozen);
  });

  it('puts the frozen window on a gag too, whatever the reason (early press, wrong response, late)', async () => {
    for (const reason of ['early', 'wrongResponse', 'late'] as const) {
      const { world, ctx, events, threat } = await setup();
      telegraphThreat(world, ctx, threat, def, -1);
      const frozen = structuredClone(threat.responseWindow);
      events.length = 0;
      gagThreat(world, ctx, threat, def, reason, reason === 'late' ? null : -12);
      expect(events[0]).toMatchObject({ type: 'ResponseResolved', reason, responseWindow: frozen });
    }
  });

  it('resolveThreat on a perfect also starts the perfect slow-mo, after the event', async () => {
    const { world, ctx, events, threat, freezes } = await setup();
    resolveThreat(world, ctx, threat, def, 'perfect', 0);
    const { timeScale, durationMs, returnMs } = content.feel.timing.slowMoPerfect;
    expect(freezes).toEqual([content.feel.timing.hitstopMs]);
    expect(world.time.slowMos).toEqual([
      {
        source: 'perfect',
        scale: timeScale,
        startedAt: 500,
        holdUntil: 500 + durationMs,
        endsAt: 500 + durationMs + returnMs,
      },
    ]);
    expect(events.map((event) => event.type)).toEqual(['ResponseResolved', 'TimeScaleChanged']);
    expect(world.time.scale).toBe(timeScale);
  });

  it('counts a perfect for Mama’s laughs, and not a success or a fail (story 1.22)', async () => {
    const { world, ctx, threat } = await setup();
    resolveThreat(world, ctx, threat, def, 'success', 30);
    expect(world.score.perfects).toBe(0);
    gagThreat(world, ctx, threat, def, 'late', null);
    expect(world.score.perfects).toBe(0);
    resolveThreat(world, ctx, threat, def, 'perfect', 0);
    resolveThreat(world, ctx, threat, def, 'perfect', 5);
    expect(world.score.perfects).toBe(2);
    expect(world.score.nearMisses).toBe(0);
  });

  it('counts the micro-sleep’s perfect too: a perfect is a perfect (story 1.22, open point 2)', async () => {
    const { world, ctx, threat } = await setup();
    resolveThreat(world, ctx, threat, createTestMicroSleep(), 'perfect', 0);
    expect(world.score.perfects).toBe(1);
  });

  it('gagThreat emits the failed response, then the gag, and asks for no time effect', async () => {
    const { world, ctx, events, threat, freezes } = await setup();
    gagThreat(world, ctx, threat, def, 'late', null);
    expect(freezes).toEqual([]);
    expect(world.time.slowMos).toEqual([]);
    expect(threat.state).toBe('gag');
    expect(events.map((event) => event.type)).toEqual(['ResponseResolved', 'GagTriggered']);
    expect(events[1]).toEqual({
      type: 'GagTriggered',
      t: 500,
      threatId: 1,
      gag: 'outlet_hair',
      reason: 'late',
    });
  });

  it('gagThreat on a stairs miss emits ResponseResolved, GagTriggered, then NearMiss, at the same time', async () => {
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({ waves: [testWave([STAIRS])] }),
      seed: 1,
    });
    const world = sim.world as World;
    world.time.sim = asSimMs(700);
    const events: SimEvent[] = [];
    const ctx = {
      feel: content.feel,
      events,
      strictInvariants: true,
      t: world.time.sim,
    } as unknown as StepContext;
    const stairs = createTestLevel({ waves: [testWave([STAIRS])] }).threats.stairs;
    if (stairs === undefined) throw new Error('no stairs');
    gagThreat(world, ctx, world.threats[0] as World['threats'][number], stairs, 'late', null);
    expect(events.map((event) => event.type)).toEqual([
      'ResponseResolved',
      'GagTriggered',
      'NearMiss',
    ]);
    expect(events.map((event) => event.t)).toEqual([700, 700, 700]);
    expect(events[2]).toEqual({ type: 'NearMiss', t: 700, threatId: 1, gag: 'stairs_slide' });
  });

  it('gagThreat on an outlet miss emits no NearMiss', async () => {
    const { world, ctx, events, threat } = await setup();
    gagThreat(world, ctx, threat, def, 'early', -300);
    expect(events.map((event) => event.type)).not.toContain('NearMiss');
  });

  it('rearmThreat puts the threat back to idle with nothing left of the cycle', async () => {
    const { world, ctx, events, threat } = await setup();
    telegraphThreat(world, ctx, threat, def, 0);
    events.length = 0;
    world.time.sim = asSimMs(9000);
    rearmThreat(world, ctx, threat);
    expect(threat).toMatchObject({
      state: 'idle',
      enteredAt: 9000,
      windowOpenAt: 0,
      responseWindow: null,
      press: null,
      waveIndex: -1,
    });
    expect(events).toEqual([{ type: 'ThreatRearmed', t: 9000, threatId: 1 }]);
  });
});

describe('gags', () => {
  it('lists the gags of the prototype', () => {
    expect([...GAG_IDS]).toEqual([
      'outlet_hair',
      'stairs_slide',
      'table_object_fall',
      'papa_asleep',
      'tissues_everywhere',
      'crayon_scribbles',
      'arms_wail',
    ]);
  });

  it('gagIdOf accepts a known gag and refuses another', () => {
    expect(gagIdOf('outlet_hair')).toBe('outlet_hair');
    expect(() => gagIdOf('outlet_hairs')).toThrow(/unknown gag outlet_hairs/);
  });
});

describe('the hidden state and the surprise gag (story 1.21)', () => {
  async function silenceSetup() {
    const level = createTestLevel({ waves: [testWave([SILENCE])] });
    const sim = await createSim({ content, geometry: createTestGeometry(), level, seed: 4 });
    const world = sim.world as World;
    world.time.sim = asSimMs(500);
    const events: SimEvent[] = [];
    const ctx = {
      feel: content.feel,
      events,
      strictInvariants: true,
      t: world.time.sim,
      level: { microSleepIndex: -1 },
      requestFreezeRealMs: () => {},
    } as unknown as StepContext;
    const silenceDef = level.threats.silence_mischief;
    if (silenceDef === undefined) throw new Error('no silence');
    return { world, ctx, events, threat: world.threats[0] as World['threats'][number], silenceDef };
  }

  it('hideThreat goes idle → hidden with no window and no press, and says which wave drew it', async () => {
    const { world, ctx, events, threat } = await silenceSetup();
    hideThreat(world, ctx, threat, 2);
    expect(threat).toMatchObject({
      state: 'hidden',
      enteredAt: 500,
      windowOpenAt: 0,
      responseWindow: null,
      press: null,
      waveIndex: 2,
    });
    expect(events).toEqual([
      {
        type: 'ThreatHidden',
        t: 500,
        threatId: threat.id,
        kind: 'silence_mischief',
        anchorId: 'behind_sofa',
        waveIndex: 2,
      },
    ]);
  });

  it('a hidden threat is revealed by telegraphThreat like an idle one', async () => {
    const { world, ctx, events, threat, silenceDef } = await silenceSetup();
    hideThreat(world, ctx, threat, 0);
    events.length = 0;
    world.time.sim = asSimMs(900);
    telegraphThreat(world, ctx, threat, silenceDef, 0);
    expect(threat).toMatchObject({ state: 'telegraph', windowOpenAt: 900 + 800 });
    expect(events.map((event) => event.type)).toEqual(['ThreatTelegraphed']);
  });

  it('gagThreat draws the surprise gag from the list with exactly one nextFloat', async () => {
    const { world, ctx, events, threat, silenceDef } = await silenceSetup();
    if (silenceDef.target !== 'hiddenZone') throw new Error('expected a hidden-zone def');
    const expected = structuredClone(world.rng);
    const draw = nextFloat(expected);
    gagThreat(world, ctx, threat, silenceDef, 'late', null);
    const gag = events.find((event) => event.type === 'GagTriggered');
    expect(gag).toBeDefined();
    const { surpriseGags } = silenceDef;
    const index = Math.min(surpriseGags.length - 1, Math.floor(draw * surpriseGags.length));
    expect(gag).toMatchObject({ gag: surpriseGags[index] });
    expect(world.rng).toEqual(expected);
    expect(world.mess.mischiefs).toBe(1);
  });

  it('a silence nobody found is reported against its def’s plain window, as it was never judged (story 2.1)', async () => {
    const { world, ctx, events, threat, silenceDef } = await silenceSetup();
    hideThreat(world, ctx, threat, 0);
    events.length = 0;
    gagThreat(world, ctx, threat, silenceDef, 'late', null);
    expect(silenceDef.windowMs ?? null).toBeNull();
    expect(events[0]).toMatchObject({
      type: 'ResponseResolved',
      offsetMs: null,
      responseWindow: { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 },
    });
  });

  it('a silence whose def has a window shorter than perfectMs is reported with that window, and perfectMs capped to it', async () => {
    const { world, ctx, events, threat, silenceDef } = await silenceSetup();
    hideThreat(world, ctx, threat, 0);
    events.length = 0;
    gagThreat(world, ctx, threat, { ...silenceDef, windowMs: 80 }, 'late', null);
    expect(events[0]).toMatchObject({
      type: 'ResponseResolved',
      responseWindow: { windowMs: 80, perfectMs: 80, toleranceMs: 60, bufferMs: 100 },
    });
  });

  it('gagThreat on any other def draws nothing', async () => {
    const { world, ctx, threat } = await setup();
    const before = structuredClone(world.rng);
    gagThreat(world, ctx, threat, def, 'late', null);
    expect(world.rng).toEqual(before);
  });
});

describe('cancelThreat (story 4.1)', () => {
  it.each(['telegraph', 'windowOpen'] as const)(
    'drops a %s threat back to idle with ThreatCancelled and nothing else: no result, no gag, no rearm, no time effect',
    async (state) => {
      const { world, ctx, events, threat, freezes } = await setup();
      telegraphThreat(world, ctx, threat, def, 0);
      if (state === 'windowOpen') openWindow(world, ctx, threat);
      threat.press = {
        t: asSimMs(500),
        quality: 'perfect',
        offsetMs: 0,
        releasedAt: null,
        heldAt: null,
      };
      events.length = 0;
      world.time.sim = asSimMs(800);
      cancelThreat(world, ctx, threat, 'carried');
      expect(events).toEqual([
        { type: 'ThreatCancelled', t: 800, threatId: threat.id, reason: 'carried' },
      ]);
      expect(threat).toMatchObject({
        state: 'idle',
        enteredAt: 800,
        press: null,
        responseWindow: null,
        windowOpenAt: 0,
        waveIndex: -1,
      });
      expect(freezes).toEqual([]);
      expect(world.time.slowMos).toEqual([]);
    },
  );

  it('carries the reason it is given', async () => {
    const { world, ctx, events, threat } = await setup();
    telegraphThreat(world, ctx, threat, def, -1);
    events.length = 0;
    cancelThreat(world, ctx, threat, 'putDown');
    expect(events).toEqual([
      expect.objectContaining({ type: 'ThreatCancelled', reason: 'putDown' }),
    ]);
  });
});
