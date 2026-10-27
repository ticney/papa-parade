import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { GAG_IDS, gagIdOf } from './gags.ts';
import {
  enterThreatState,
  gagThreat,
  openWindow,
  rearmThreat,
  resolveThreat,
  THREAT_STATES,
  THREAT_STATES_ARE_COMPLETE,
  telegraphThreat,
} from './threatFsm.ts';

const content = createTestContent();
const def = createTestLevel([outletEntry(0)]).threats.outlet;
if (def === undefined) throw new Error('no outlet');

/** A world with its one planned threat and a context that only collects events. */
async function setup() {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel([outletEntry(0)]),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const ctx = { feel: content.feel, events } as unknown as StepContext;
  const threat = world.threats[0] as World['threats'][number];
  return { world, ctx, events, threat };
}

describe('threat FSM', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...THREAT_STATES]).toEqual(['idle', 'telegraph', 'windowOpen', 'resolved', 'gag']);
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
    threat.press = { t: asSimMs(1), quality: 'perfect', offsetMs: 0, releasedAt: null };
    telegraphThreat(world, ctx, threat, def);
    expect(threat).toMatchObject({
      state: 'telegraph',
      enteredAt: 500,
      windowOpenAt: 500 + 1200,
      press: null,
      responseWindow: { windowMs: content.feel.timing.windowMs },
    });
    expect(events).toEqual([
      { type: 'ThreatTelegraphed', t: 500, threatId: 1, kind: 'outlet', anchorId: 'outlet_01' },
    ]);
  });

  it('openWindow emits WindowOpened', async () => {
    const { world, ctx, events, threat } = await setup();
    openWindow(world, ctx, threat);
    expect(threat.state).toBe('windowOpen');
    expect(events).toEqual([{ type: 'WindowOpened', t: 500, threatId: 1 }]);
  });

  it('resolveThreat emits the quality and clears the press', async () => {
    const { world, ctx, events, threat } = await setup();
    threat.press = { t: asSimMs(400), quality: 'success', offsetMs: -20, releasedAt: null };
    resolveThreat(world, ctx, threat, def, 'success', -20);
    expect(threat).toMatchObject({ state: 'resolved', press: null });
    expect(events).toEqual([
      {
        type: 'ResponseResolved',
        t: 500,
        threatId: 1,
        response: 'parry',
        quality: 'success',
        offsetMs: -20,
      },
    ]);
  });

  it('gagThreat emits the failed response, then the gag', async () => {
    const { world, ctx, events, threat } = await setup();
    gagThreat(world, ctx, threat, def, 'late', null);
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

  it('rearmThreat puts the threat back to idle with nothing left of the cycle', async () => {
    const { world, ctx, events, threat } = await setup();
    telegraphThreat(world, ctx, threat, def);
    events.length = 0;
    world.time.sim = asSimMs(9000);
    rearmThreat(world, ctx, threat);
    expect(threat).toMatchObject({
      state: 'idle',
      enteredAt: 9000,
      windowOpenAt: 0,
      responseWindow: null,
      press: null,
    });
    expect(events).toEqual([{ type: 'ThreatRearmed', t: 9000, threatId: 1 }]);
  });
});

describe('gags', () => {
  it('lists outlet_hair', () => {
    expect([...GAG_IDS]).toContain('outlet_hair');
  });

  it('gagIdOf accepts a known gag and refuses another', () => {
    expect(gagIdOf('outlet_hair')).toBe('outlet_hair');
    expect(() => gagIdOf('outlet_hairs')).toThrow(/unknown gag outlet_hairs/);
  });
});
