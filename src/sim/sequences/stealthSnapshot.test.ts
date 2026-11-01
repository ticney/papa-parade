import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createStealthSim, only, type StealthSim } from '../../../tests/support/stealthSupport.ts';
import type { SimEvent } from '../events.ts';

// Snapshot v26 (story 4.9): the `stealth` slice. A round trip taken with something in flight (the
// breath held, a gasp already paid in a passage, Papa standing on a board) is played to the end on
// both copies, hashes and events compared; and each field the slice checks has a test that names it.
const BOARD = [-2, 1.6, 0.4, 0.4] as const;
const roundTrip = (run: StealthSim) =>
  JSON.parse(JSON.stringify(run.sim.snapshot())) as ReturnType<StealthSim['sim']['snapshot']>;

async function pair(options: Parameters<typeof createStealthSim>[0] = {}) {
  return [await createStealthSim(options), await createStealthSim(options)] as const;
}

/** Plays both copies the same `commands` for `ms`, and returns what each emitted. */
function playBoth(
  live: StealthSim,
  copy: StealthSim,
  ms: number,
  commands: readonly (readonly [number, 'HoldAnywhere' | 'ReleaseHold'])[] = [],
): [SimEvent[], SimEvent[]] {
  for (const run of [live, copy]) {
    for (const [t, type] of commands) run.sim.enqueue({ type, t: asSimMs(t) });
  }
  const until = live.world.time.sim + ms;
  return [live.runTo(until), copy.runTo(until)];
}

describe('the stealth slice in a snapshot (story 4.9)', () => {
  it('round-trips mid-hold: the breath goes on falling, and ends the same on both copies', async () => {
    const [live, copy] = await pair();
    live.start();
    live.holdAlerts();
    live.sim.enqueue({ type: 'HoldAnywhere', t: live.world.time.sim });
    live.runTo(live.world.time.sim + 500);
    copy.sim.restore(roundTrip(live));
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    const [liveEvents, copyEvents] = playBoth(live, copy, 7000);
    expect(copyEvents).toEqual(liveEvents);
    expect(only(liveEvents, 'BreathGasped')).toMatchObject([{ reason: 'empty' }]);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('round-trips inside a passage after a paid gasp: no second gasp on either copy', async () => {
    const [live, copy] = await pair();
    live.start();
    live.holdAlerts();
    live.alertNow('falseAlarm');
    const openAt = live.falseAlarm().windowOpenAt;
    live.runTo(openAt + 3 * 10);
    expect(only(live.events, 'BreathGasped')).toMatchObject([{ reason: 'notHeld' }]);
    expect(live.world.sequence.stealth.isPassagePaid).toBe(true);
    copy.sim.restore(roundTrip(live));
    expect(copy.world.sequence.stealth.isPassagePaid).toBe(true);
    // Held and let go early, still inside the window: the gasp is paid already.
    const t = live.world.time.sim;
    const [liveEvents, copyEvents] = playBoth(live, copy, 2500, [
      [t + 20, 'HoldAnywhere'],
      [t + 200, 'ReleaseHold'],
    ]);
    expect(only(liveEvents, 'BreathGasped')).toEqual([]);
    expect(copyEvents).toEqual(liveEvents);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('round-trips with Papa standing on a board: no second creak', async () => {
    const [live, copy] = await pair({ creakBoxes: [BOARD] });
    live.start();
    live.holdAlerts();
    live.runTo(live.world.time.sim + 200);
    expect(live.world.sequence.stealth.creakZoneIndex).toBe(0);
    copy.sim.restore(roundTrip(live));
    expect(copy.world.sequence.stealth.creakZoneIndex).toBe(0);
    const [liveEvents, copyEvents] = playBoth(live, copy, 1000);
    expect(only(liveEvents, 'FloorCreaked')).toEqual([]);
    expect(copyEvents).toEqual(liveEvents);
  });

  it('round-trips the slice at rest after the sequence, and a restored sequence can end', async () => {
    const [live, copy] = await pair();
    live.start();
    live.holdAlerts();
    live.teleportPapa(2.9, -2.8);
    live.stepOnce();
    expect(live.world.sequence.stealth.isRunning).toBe(false);
    copy.sim.restore(roundTrip(live));
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });
});

describe('what the slice refuses (story 4.9)', () => {
  /** A snapshot taken mid-step, with the breath held. */
  async function midStep() {
    const live = await createStealthSim();
    live.start();
    live.holdAlerts();
    live.sim.enqueue({ type: 'HoldAnywhere', t: live.world.time.sim });
    live.runTo(live.world.time.sim + 300);
    return { live, snapshot: roundTrip(live) };
  }

  it.each([
    ['isRunning not a boolean', { isRunning: 'yes' }, 'isRunning'],
    ['isRunning false in a stealth step', { isRunning: false }, 'isRunning'],
    ['isPassagePaid not a boolean', { isPassagePaid: 1 }, 'isPassagePaid'],
    ['a non-finite exitXM', { exitXM: Number.NaN }, 'exitXM'],
    ['a non-finite exitZM', { exitZM: null }, 'exitZM'],
    ['a negative breathLeftMs', { breathLeftMs: -1 }, 'breathLeftMs'],
    ['a breathLeftMs above the capacity', { breathLeftMs: 600000 }, 'breathLeftMs'],
    ['a non-finite breathLeftMs', { breathLeftMs: 'full' }, 'breathLeftMs'],
    ['a negative breathHeldAt', { breathHeldAt: -5 }, 'breathHeldAt'],
    ['a non-numeric breathHeldAt', { breathHeldAt: 'now' }, 'breathHeldAt'],
    ['a breath held with none left', { breathLeftMs: 0 }, 'breathHeldAt'],
    ['a negative nextAlertAt', { nextAlertAt: -1 }, 'nextAlertAt'],
    ['no nextAlertAt while running', { nextAlertAt: null }, 'nextAlertAt'],
    ['a fractional creakZoneIndex', { creakZoneIndex: 0.5 }, 'creakZoneIndex'],
    ['a creakZoneIndex below -1', { creakZoneIndex: -2 }, 'creakZoneIndex'],
    ['a creakZoneIndex beyond the level’s zones', { creakZoneIndex: 99 }, 'creakZoneIndex'],
    ['a breathHeldAt later than the sim clock', { breathHeldAt: 600000 }, 'breathHeldAt'],
  ] as const)('refuses %s, naming the field', async (_name, patch, field) => {
    const { snapshot } = await midStep();
    Object.assign(snapshot.world.sequence.stealth, patch);
    const target = await createStealthSim();
    expect(() => target.sim.restore(snapshot)).toThrow(
      new RegExp(`world\\.sequence\\.stealth\\.${field}`),
    );
  });

  it('refuses a missing slice', async () => {
    const { snapshot } = await midStep();
    delete (snapshot.world.sequence as { stealth?: unknown }).stealth;
    const target = await createStealthSim();
    expect(() => target.sim.restore(snapshot)).toThrow(/world\.sequence\.stealth is missing/);
  });

  it.each([
    ['an exit', { exitXM: 1 }, 'exitXM'],
    ['an alert due', { nextAlertAt: 500 }, 'nextAlertAt'],
    ['a breath held', { breathHeldAt: 500 }, 'breathHeldAt'],
    ['a gasp paid', { isPassagePaid: true }, 'isPassagePaid'],
    ['a board', { creakZoneIndex: 0 }, 'creakZoneIndex'],
  ] as const)('refuses %s in a slice at rest', async (_name, patch, field) => {
    const run = await createStealthSim();
    const snapshot = roundTrip(run);
    Object.assign(snapshot.world.sequence.stealth, patch);
    const target = await createStealthSim();
    expect(() => target.sim.restore(snapshot)).toThrow(
      new RegExp(`world\\.sequence\\.stealth\\.${field}`),
    );
  });
});
