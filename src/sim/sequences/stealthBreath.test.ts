import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createStealthSim, only, type StealthSim } from '../../../tests/support/stealthSupport.ts';
import { createTestContent } from '../../../tests/support/testContent.ts';

// The breath of the stealth exit (story 4.9, AC 9) on the frozen room: a gauge of
// `breathCapacityMs` that falls while held and rises `breathRefillPerSecMs` each second while not,
// three reasons to gasp, and the false alarm's window as the critical passage (D8). The frozen feel
// has 6000 ms of breath and 1500 ms/s of refill (15 ms a step).
const content = createTestContent();
const { breathCapacityMs, breathRefillPerSecMs } = content.feel.stealth;
const REFILL_PER_STEP_MS = (breathRefillPerSecMs * STEP_MS) / MS_PER_S;
const { floorCreak, breathReleased } = content.feel.noise.sources;

async function quiet(options: Parameters<typeof createStealthSim>[0] = {}) {
  const run = await createStealthSim(options);
  run.start();
  run.holdAlerts();
  return run;
}

const hold = (run: StealthSim, t: number = run.world.time.sim) =>
  run.sim.enqueue({ type: 'HoldAnywhere', t: asSimMs(t) });
const letGo = (run: StealthSim, t: number = run.world.time.sim) =>
  run.sim.enqueue({ type: 'ReleaseHold', t: asSimMs(t) });

/** A false alarm telegraphed now: the times of its passage. */
function falseAlarmPassage(run: StealthSim) {
  run.alertNow('falseAlarm');
  const alarm = run.falseAlarm();
  const openAt = alarm.windowOpenAt;
  const endAt = openAt + (alarm.responseWindow?.windowMs ?? 0);
  return { alarm, openAt, endAt };
}

describe('the gauge (story 4.9)', () => {
  it('falls by one step per step while held, to the ms', async () => {
    const run = await quiet();
    hold(run);
    const seen = run.runTo(run.world.time.sim + 10 * STEP_MS);
    expect(only(seen, 'BreathHeld')).toHaveLength(1);
    expect(run.world.sequence.stealth.breathLeftMs).toBe(breathCapacityMs - 10 * STEP_MS);
    expect(run.world.sequence.stealth.breathHeldAt).not.toBeNull();
  });

  it('is let out loudly at 0: BreathReleased then BreathGasped{empty}, and the key does nothing more', async () => {
    const run = await quiet();
    hold(run);
    const startAt = run.world.time.sim;
    const seen = run.runTo(startAt + breathCapacityMs + 5 * STEP_MS);
    const released = only(seen, 'BreathReleased');
    const gasped = only(seen, 'BreathGasped');
    expect(released).toHaveLength(1);
    expect(gasped).toMatchObject([{ reason: 'empty' }]);
    expect(released[0]?.t).toBe(gasped[0]?.t);
    expect(released[0]?.t).toBe(startAt + breathCapacityMs);
    expect(run.world.sequence.stealth.breathHeldAt).toBeNull();
    // Still the same hold as far as the client is concerned: the sim holds nothing without a new press.
    expect(run.world.sequence.stealth.breathLeftMs).toBeGreaterThan(0);
  });

  it('rises by the refill each step while not held, and stops at the capacity', async () => {
    const run = await quiet();
    hold(run);
    run.runTo(run.world.time.sim + 100 * STEP_MS);
    const left = run.world.sequence.stealth.breathLeftMs;
    letGo(run);
    run.runTo(run.world.time.sim + 4 * STEP_MS);
    expect(run.world.sequence.stealth.breathLeftMs).toBeCloseTo(left + 4 * REFILL_PER_STEP_MS);
    run.runTo(run.world.time.sim + 3000);
    expect(run.world.sequence.stealth.breathLeftMs).toBe(breathCapacityMs);
  });

  it('ignores a press on an empty gauge, with no event', async () => {
    const run = await quiet();
    run.world.sequence.stealth.breathLeftMs = 0;
    hold(run);
    const seen = run.runTo(run.world.time.sim + STEP_MS);
    expect(only(seen, 'BreathHeld')).toEqual([]);
    expect(run.world.sequence.stealth.breathHeldAt).toBeNull();
  });

  it('needs a new press after it ran out: refilled, nothing holds it again by itself', async () => {
    const run = await quiet();
    hold(run);
    run.runTo(run.world.time.sim + breathCapacityMs + 2 * STEP_MS);
    run.runTo(run.world.time.sim + 1000);
    expect(run.world.sequence.stealth.breathHeldAt).toBeNull();
    expect(run.world.sequence.stealth.breathLeftMs).toBeGreaterThan(1000);
    hold(run);
    const seen = run.runTo(run.world.time.sim + STEP_MS);
    expect(only(seen, 'BreathHeld')).toHaveLength(1);
  });

  it('ignores a second press while held and a release when not held', async () => {
    const run = await quiet();
    letGo(run);
    expect(only(run.runTo(run.world.time.sim + STEP_MS), 'BreathReleased')).toEqual([]);
    hold(run);
    run.stepOnce();
    hold(run);
    const seen = run.runTo(run.world.time.sim + STEP_MS);
    expect(only(seen, 'BreathHeld')).toEqual([]);
    letGo(run);
    expect(only(run.runTo(run.world.time.sim + STEP_MS), 'BreathReleased')).toHaveLength(1);
  });

  it('is judged on the command t: a hold taken at a stamp before the step is kept', async () => {
    const run = await quiet();
    const stamp = run.world.time.sim + 3 * STEP_MS;
    hold(run, stamp);
    run.runTo(stamp + STEP_MS);
    expect(run.world.sequence.stealth.breathHeldAt).toBe(stamp);
  });
});

describe('the gasps (story 4.9, D8)', () => {
  it('gasps empty outside a passage every time', async () => {
    const run = await quiet();
    for (let round = 0; round < 2; round++) {
      hold(run);
      const seen = run.runTo(run.world.time.sim + breathCapacityMs + 2 * STEP_MS);
      expect(only(seen, 'BreathGasped')).toMatchObject([{ reason: 'empty' }]);
      run.runTo(run.world.time.sim + 5000);
    }
  });

  it('gasps notHeld when the breath is not held as the false alarm is first seen open', async () => {
    const run = await quiet();
    const { openAt, endAt } = falseAlarmPassage(run);
    const seen = run.runTo(endAt + 2 * STEP_MS);
    const gasps = only(seen, 'BreathGasped');
    expect(gasps).toMatchObject([{ reason: 'notHeld', t: openAt + STEP_MS }]);
  });

  it('gasps nothing when the breath is held through the whole window and let go at its end', async () => {
    const run = await quiet();
    const { endAt } = falseAlarmPassage(run);
    hold(run);
    letGo(run, endAt);
    const seen = run.runTo(endAt + 3 * STEP_MS);
    expect(only(seen, 'BreathGasped')).toEqual([]);
    expect(only(seen, 'BreathReleased')).toHaveLength(1);
    expect(only(seen, 'ResponseResolved')).toMatchObject([{ quality: 'success' }]);
  });

  it('gasps early when the release is stamped before the end of the window', async () => {
    const run = await quiet();
    const { openAt, endAt } = falseAlarmPassage(run);
    hold(run);
    letGo(run, endAt - STEP_MS);
    const seen = run.runTo(endAt + STEP_MS);
    expect(only(seen, 'BreathGasped')).toMatchObject([{ reason: 'early', t: endAt - STEP_MS }]);
    expect(openAt).toBeLessThan(endAt - STEP_MS);
  });

  it('gasps empty in the passage when the gauge runs out inside it', async () => {
    const run = await quiet();
    const { endAt } = falseAlarmPassage(run);
    // Held almost to the end: nearly nothing left when the window opens.
    run.world.sequence.stealth.breathLeftMs = 900 + 500;
    hold(run);
    const seen = run.runTo(endAt + 3 * STEP_MS);
    expect(only(seen, 'BreathGasped')).toMatchObject([{ reason: 'empty' }]);
  });

  it('gasps at most once per passage', async () => {
    const run = await quiet();
    const { openAt, endAt } = falseAlarmPassage(run);
    // Not held at the opening: one notHeld; then held and let go early, then held until empty.
    run.runTo(openAt + 3 * STEP_MS);
    hold(run);
    run.runTo(run.world.time.sim + 3 * STEP_MS);
    letGo(run);
    run.stepOnce();
    hold(run);
    run.world.sequence.stealth.breathLeftMs = 2 * STEP_MS;
    const seen = run.runTo(endAt + 3 * STEP_MS);
    expect(only(seen, 'BreathGasped')).toEqual([]);
    expect(only(run.events, 'BreathGasped').filter((event) => event.t >= openAt)).toHaveLength(1);
    expect(only(seen, 'BreathReleased').length).toBeGreaterThan(0);
  });

  it('is free outside a passage: a release while the false alarm is still only announced', async () => {
    const run = await quiet();
    const { openAt } = falseAlarmPassage(run);
    hold(run);
    run.stepOnce();
    letGo(run);
    const seen = run.runTo(openAt - STEP_MS);
    expect(only(seen, 'BreathGasped')).toEqual([]);
    expect(only(seen, 'BreathReleased')).toHaveLength(1);
  });

  it('pays a new gasp in the next passage (the paid flag is reset when the window is over)', async () => {
    const run = await quiet();
    const first = falseAlarmPassage(run);
    run.runTo(first.endAt + 500);
    expect(only(run.events, 'BreathGasped').filter((e) => e.reason === 'notHeld')).toHaveLength(1);
    run.runTo(first.endAt + 2000);
    expect(run.world.sequence.stealth.isPassagePaid).toBe(false);
    const second = falseAlarmPassage(run);
    run.runTo(second.endAt + 500);
    expect(only(run.events, 'BreathGasped').filter((e) => e.reason === 'notHeld')).toHaveLength(2);
  });
});

describe('the noise of the stealth exit (story 4.9)', () => {
  it('adds breathReleased.noisePct for a gasp and floorCreak.noisePct for a creak', async () => {
    const run = await createStealthSim({
      hasNoise: true,
      creakBoxes: [[PAPA_X, PAPA_Z, 0.3, 0.3]],
    });
    run.start();
    run.holdAlerts();
    run.world.sequence.stealth.creakZoneIndex = -1;
    const { endAt } = falseAlarmPassage(run);
    const seen = run.runTo(endAt + 3 * STEP_MS);
    const noise = only(seen, 'NoiseChanged');
    expect(noise.filter((event) => event.source === 'breathReleased')).toMatchObject([
      { deltaPct: breathReleased.noisePct },
    ]);
    // Papa stands in the box from the start, so the entry was recorded when it began: no creak yet.
    expect(only(seen, 'FloorCreaked')).toHaveLength(0);
    run.world.sequence.stealth.creakZoneIndex = -1;
    const creaked = run.stepOnce();
    expect(only(creaked, 'FloorCreaked')).toHaveLength(1);
    expect(
      only(creaked, 'NoiseChanged').filter((event) => event.source === 'floorCreak'),
    ).toMatchObject([{ deltaPct: floorCreak.noisePct }]);
  });

  it('emits the events and no noise in a level with no noise gauge', async () => {
    const run = await createStealthSim({ creakBoxes: [[PAPA_X, PAPA_Z, 0.3, 0.3]] });
    run.start();
    run.holdAlerts();
    run.world.sequence.stealth.creakZoneIndex = -1;
    run.runTo(run.world.time.sim + STEP_MS);
    hold(run);
    const seen = run.runTo(run.world.time.sim + breathCapacityMs + 2 * STEP_MS);
    expect(only(run.events, 'FloorCreaked')).toHaveLength(1);
    expect(only(seen, 'BreathGasped')).toHaveLength(1);
    expect(only(run.events, 'NoiseChanged')).toEqual([]);
  });
});

/** Where the sequence puts Papa: the centre of the playpen. */
const PAPA_X = -2;
const PAPA_Z = 1.6;
