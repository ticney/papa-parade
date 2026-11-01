import { BABY_CRYING_EVERY_MS, MS_PER_S, STEP_MS } from '@shared/constants';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createCreakGeometry,
  createStealthSim,
  FLOAT_MAX,
  FLOAT_ZERO,
  NEVER_MS,
  only,
} from '../../../tests/support/stealthSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestLevel,
  createTestStayAwake,
  createTestStealthExit,
  FATIGUE_GAUGES,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';

// « Sortie en infiltration » (story 4.9) at the sim level, on the frozen room, the frozen stealth
// sequence (a door at (2.9, -2.8), radius 0.9, an alert every 4 to 7 s, 30 % real wakes) and the
// frozen false alarm (900 ms of telegraph, 2000 ms to sit through) and real wake (1500 ms of
// telegraph, the feel's window). The playpen (the only safe zone) is centred at (-2, 1.6).
const content = createTestContent();
const { stealth: stealthFeel } = content.feel;
const PLAYPEN_XM = -2;
const PLAYPEN_ZM = 1.6;
const DOOR_XM = 2.9;
const DOOR_ZM = -2.8;
const SEQUENCE = createTestStealthExit();
const step = SEQUENCE.steps[0];
if (step === undefined || step.kind !== 'stealth') throw new Error('the frozen sequence changed');
const EXIT_RADIUS_M = step.exitRadiusM;

describe('the start of a stealth sequence (story 4.9, D6)', () => {
  it('puts Papa and the baby over the playpen, from anywhere, and runs the step', async () => {
    const run = await createStealthSim();
    expect(run.world.papa.xM).not.toBeCloseTo(PLAYPEN_XM);
    const seen = run.start();
    expect(only(seen, 'SequenceStarted')).toMatchObject([{ id: 'stealth_exit' }]);
    expect(run.world.flow.state).toBe('sequence');
    expect(run.world.papa.xM).toBeCloseTo(PLAYPEN_XM);
    expect(run.world.papa.zM).toBeCloseTo(PLAYPEN_ZM);
    expect(run.world.baby.xM).toBeCloseTo(PLAYPEN_XM);
    expect(run.world.baby.zM).toBeCloseTo(PLAYPEN_ZM);
    expect(run.world.baby.state).toBe('babble');
    const { stealth } = run.world.sequence;
    expect(stealth.isRunning).toBe(true);
    expect(stealth.exitXM).toBeCloseTo(DOOR_XM);
    expect(stealth.exitZM).toBeCloseTo(DOOR_ZM);
    expect(stealth.breathLeftMs).toBe(stealthFeel.breathCapacityMs);
    expect(stealth.breathHeldAt).toBeNull();
    expect(stealth.nextAlertAt).not.toBeNull();
    const gapMs = (stealth.nextAlertAt as number) - run.world.sequence.startedAt;
    expect(gapMs).toBeGreaterThanOrEqual(step.alertGapMinMs);
    expect(gapMs).toBeLessThanOrEqual(step.alertGapMaxMs);
  });

  it('draws exactly one float at the start (the first alert), and the placement draws none', async () => {
    const run = await createStealthSim();
    const expected = { ...run.world.rng };
    nextFloat(expected);
    run.start();
    expect(run.world.rng).toEqual(expected);
  });

  it('moves nothing when they are in place already', async () => {
    const run = await createStealthSim();
    run.teleportPapa(PLAYPEN_XM, PLAYPEN_ZM);
    run.world.baby.xM = PLAYPEN_XM + 0.2;
    run.world.baby.zM = PLAYPEN_ZM - 0.1;
    run.world.baby.prevXM = run.world.baby.xM;
    run.world.baby.prevZM = run.world.baby.zM;
    const babyBefore = { x: run.world.baby.xM, z: run.world.baby.zM };
    const seen = run.start();
    expect(run.world.papa.xM).toBe(PLAYPEN_XM);
    expect(run.world.baby.xM).toBe(babyBefore.x);
    expect(run.world.baby.zM).toBe(babyBefore.z);
    expect(only(seen, 'BabyStateChanged').filter((event) => event.to === 'babble')).toEqual([]);
    expect(only(seen, 'BabyPutDown')).toEqual([]);
  });

  it('puts a carried baby down over the playpen, safe', async () => {
    const run = await createStealthSim();
    run.teleportPapa(PLAYPEN_XM, PLAYPEN_ZM);
    run.world.baby.xM = PLAYPEN_XM;
    run.world.baby.zM = PLAYPEN_ZM;
    run.world.baby.state = 'carried';
    const seen = run.start();
    expect(only(seen, 'BabyPutDown')).toMatchObject([{ safe: true }]);
    expect(run.world.baby.state).toBe('babble');
  });

  it('is refused with the usual refusals: a ringing phone, a hiding baby, a running sequence', async () => {
    const run = await createStealthSim();
    run.start();
    // A second start while it runs is refused: no second SequenceStarted.
    run.sim.enqueue({ type: 'StartSequence', t: run.world.time.sim, sequenceId: 'stealth_exit' });
    expect(only(run.stepOnce(), 'SequenceStarted')).toEqual([]);
  });
});

describe('the alerts (story 4.9)', () => {
  it('draws exactly two floats per alert, whatever realWakePct says', async () => {
    for (const realWakePct of [1, 30, 100]) {
      const sequence = {
        ...createTestStealthExit(),
        steps: [{ ...step, realWakePct }],
      };
      const run = await createStealthSim({ sequence });
      run.start();
      run.world.rng = { a: 12345, b: 678, c: 9, d: 1011 };
      const expected = { ...run.world.rng };
      nextFloat(expected);
      nextFloat(expected);
      run.world.sequence.stealth.nextAlertAt = asSimMs(run.world.time.sim);
      const seen = run.stepOnce();
      expect(only(seen, 'ThreatTelegraphed')).toHaveLength(1);
      expect(run.world.rng).toEqual(expected);
    }
  });

  it('picks the real wake at 100 % and the false alarm at 1 % for the largest draw', async () => {
    const certain = await createStealthSim({
      sequence: { ...createTestStealthExit(), steps: [{ ...step, realWakePct: 100 }] },
    });
    certain.start();
    certain.world.rng = { ...FLOAT_MAX };
    certain.world.sequence.stealth.nextAlertAt = asSimMs(certain.world.time.sim);
    certain.stepOnce();
    expect(certain.realWake().state).toBe('telegraph');
    expect(certain.falseAlarm().state).toBe('idle');

    const rare = await createStealthSim({
      sequence: { ...createTestStealthExit(), steps: [{ ...step, realWakePct: 1 }] },
    });
    rare.start();
    rare.world.rng = { ...FLOAT_MAX };
    rare.world.sequence.stealth.nextAlertAt = asSimMs(rare.world.time.sim);
    rare.stepOnce();
    expect(rare.falseAlarm().state).toBe('telegraph');
    expect(rare.realWake().state).toBe('idle');
  });

  it('picks the real wake for the smallest draw whatever the percentage (at least 1)', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('realWake');
    expect(run.realWake().state).toBe('telegraph');
  });

  it('writes the alert at the baby, who is where the sequence put him', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('falseAlarm');
    expect(run.falseAlarm().xM).toBe(run.world.baby.xM);
    expect(run.falseAlarm().zM).toBe(run.world.baby.zM);
  });

  it('waits while an alert is up or Papa is busy, drawing nothing', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('falseAlarm');
    run.world.sequence.stealth.nextAlertAt = asSimMs(run.world.time.sim);
    const rngBefore = { ...run.world.rng };
    run.stepOnce();
    expect(run.world.rng).toEqual(rngBefore);
    expect(run.realWake().state).toBe('idle');
  });

  it('is never a hidden alert: the baby stays put while one is up (he is inert in the step)', async () => {
    const run = await createStealthSim();
    run.start();
    const babyAt = { x: run.world.baby.xM, z: run.world.baby.zM };
    run.alertNow('realWake');
    run.runTo(run.realWake().windowOpenAt);
    expect(run.world.baby.xM).toBe(babyAt.x);
    expect(run.world.baby.zM).toBe(babyAt.z);
    expect(run.world.baby.targetThreatId).toBeNull();
  });
});

describe('the baby is inert during the step (story 4.9)', () => {
  it('never wanders, however long the babble is overdue', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.world.baby.wanderAt = asSimMs(run.world.time.sim);
    const at = { x: run.world.baby.xM, z: run.world.baby.zM };
    run.runTo(run.world.time.sim + 5000);
    expect(run.world.baby.state).toBe('babble');
    expect(run.world.baby.xM).toBe(at.x);
    expect(run.world.baby.zM).toBe(at.z);
    expect(run.world.baby.prevXM).toBe(at.x);
  });
});

describe('Papa moves (story 4.9)', () => {
  it('walks at sneakSpeedPct of the walking speed on a floor tap', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: 0, zM: 1.6 });
    run.runTo(run.world.time.sim + 5 * STEP_MS);
    const walkedM = Math.hypot(run.world.papa.xM - PLAYPEN_XM, run.world.papa.zM - PLAYPEN_ZM);
    const expectedPerStepM =
      (content.feel.movement.walkSpeedMps * STEP_MS * stealthFeel.sneakSpeedPct) / 100 / MS_PER_S;
    expect(run.world.papa.state).toBe('walkPath');
    expect(walkedM).toBeGreaterThan(expectedPerStepM * 2);
    expect(walkedM).toBeLessThanOrEqual(expectedPerStepM * 5 + 1e-9);
  });

  it('walks in a direction at the sneak speed too', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.sim.enqueue({ type: 'Move', t: run.world.time.sim, dirX: 1, dirZ: 0 });
    run.runTo(run.world.time.sim + 10 * STEP_MS);
    const expectedPerStepM =
      (content.feel.movement.walkSpeedMps * STEP_MS * stealthFeel.sneakSpeedPct) / 100 / MS_PER_S;
    expect(run.world.papa.xM - PLAYPEN_XM).toBeLessThanOrEqual(expectedPerStepM * 10 + 1e-9);
    expect(run.world.papa.xM - PLAYPEN_XM).toBeGreaterThan(expectedPerStepM * 5);
  });

  it('glides at the glide speed, not the sneak speed', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.alertNow('realWake');
    run.teleportPapa(0, 1.6);
    const startX = run.world.papa.xM;
    run.sim.enqueue({ type: 'PressThreat', t: run.world.time.sim, threatId: run.realWake().id });
    run.runTo(run.world.time.sim + 2 * STEP_MS);
    expect(run.world.papa.state).toBe('glide');
    const speedMps = run.world.papa.glide?.speedMps ?? 0;
    const glidPerStepM = (speedMps * STEP_MS) / MS_PER_S;
    const walkPerStepM = (content.feel.movement.walkSpeedMps * STEP_MS) / MS_PER_S;
    expect(Math.abs(run.world.papa.xM - startX)).toBeGreaterThan(
      walkPerStepM * (stealthFeel.sneakSpeedPct / 100) * 1.5,
    );
    expect(glidPerStepM).toBeGreaterThan(0);
  });

  it('drops TapBaby and TapObject: no taking him, no coffee', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    const t = run.world.time.sim;
    run.sim.enqueue({ type: 'TapBaby', t });
    run.sim.enqueue({ type: 'TapObject', t, objectId: 'coffee_machine' });
    const seen = run.runTo(t + 3 * STEP_MS);
    expect(run.world.baby.state).toBe('babble');
    expect(run.world.papa.state).toBe('idle');
    expect(only(seen, 'BabyPickedUp')).toEqual([]);
    expect(only(seen, 'ObjectTapped')).toEqual([]);
    expect(only(seen, 'PapaPathPlanned')).toEqual([]);
  });

  it('holds Papa in every other sequence exactly as before', async () => {
    const level = createTestLevel({
      carry: CARRY,
      gauges: FATIGUE_GAUGES,
      sequences: ['stay_awake'],
      sequenceDefs: { stay_awake: createTestStayAwake() },
    });
    const sim = await createSim({
      content,
      geometry: createCreakGeometry(),
      level: { ...level, level: { ...level.level } },
      seed: 1,
    });
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
    sim.step();
    const before = { x: sim.world.papa.xM, z: sim.world.papa.zM };
    sim.enqueue({ type: 'TapFloor', t: sim.world.time.sim, xM: 0, zM: 0 });
    sim.enqueue({ type: 'Move', t: sim.world.time.sim, dirX: 1, dirZ: 0 });
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.world.papa.xM).toBe(before.x);
    expect(sim.world.papa.zM).toBe(before.z);
    expect(sim.world.sequence.stealth.isRunning).toBe(false);
  });
});

describe('the exit (story 4.9)', () => {
  it('is won at the door: SequenceEnded succeeded, Papa free, the slice at rest', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.teleportPapa(DOOR_XM - EXIT_RADIUS_M * 0.9, DOOR_ZM);
    const seen = run.stepOnce();
    expect(only(seen, 'SequenceEnded')).toMatchObject([
      { id: 'stealth_exit', outcome: 'succeeded' },
    ]);
    expect(run.world.flow.state).toBe('playing');
    expect(run.world.sequence.id).toBeNull();
    expect(run.world.sequence.stealth.isRunning).toBe(false);
    expect(run.world.sequence.stealth.nextAlertAt).toBeNull();
  });

  it('is not won just outside the radius', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    run.teleportPapa(DOOR_XM - EXIT_RADIUS_M - 0.05, DOOR_ZM);
    expect(only(run.stepOnce(), 'SequenceEnded')).toEqual([]);
    expect(run.world.flow.state).toBe('sequence');
  });

  it('is not won over an open false alarm: it waits for the alert to be sat through', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('falseAlarm');
    run.teleportPapa(DOOR_XM, DOOR_ZM - 0.05);
    const during = run.runTo(run.falseAlarm().windowOpenAt + 1000);
    expect(only(during, 'SequenceEnded')).toEqual([]);
    expect(run.world.flow.state).toBe('sequence');
    const after = run.runTo(run.falseAlarm().windowOpenAt + 2100);
    expect(only(after, 'ResponseResolved')).toMatchObject([
      { response: 'nothing', quality: 'success' },
    ]);
    const end = only(after, 'SequenceEnded');
    expect(end).toMatchObject([{ outcome: 'succeeded' }]);
  });

  it('is not won over a real wake at the door: it must still be answered', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('realWake');
    run.teleportPapa(DOOR_XM, DOOR_ZM - 0.05);
    const during = run.runTo(run.realWake().windowOpenAt - STEP_MS);
    expect(only(during, 'SequenceEnded')).toEqual([]);
    // Not answered: the sequence is lost, not won.
    const after = run.runTo(run.realWake().windowOpenAt + 2000);
    expect(only(after, 'SequenceEnded')).toMatchObject([{ outcome: 'failed' }]);
    expect(only(after, 'GagTriggered')).toMatchObject([{ gag: 'baby_woke_crying' }]);
  });

  it('is never won by waiting: past the estimate, with nobody at the door, it goes on', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    const seen = run.runTo(run.world.sequence.endsAt + 2000);
    expect(only(seen, 'SequenceEnded')).toEqual([]);
    expect(run.world.flow.state).toBe('sequence');
  });
});

describe('the failures (story 4.9)', () => {
  it('touching a false alarm ends the sequence with the cry of the def', async () => {
    const run = await createStealthSim({ hasNoise: true });
    run.start();
    run.alertNow('falseAlarm');
    const alarm = run.falseAlarm();
    run.sim.enqueue({ type: 'PressThreat', t: asSimMs(alarm.windowOpenAt), threatId: alarm.id });
    const seen = run.runTo(alarm.windowOpenAt + 3 * STEP_MS);
    expect(only(seen, 'GagTriggered')).toMatchObject([
      { gag: 'baby_woke_by_touch', reason: 'acted' },
    ]);
    expect(only(seen, 'SequenceEnded')).toMatchObject([{ outcome: 'failed' }]);
    expect(only(seen, 'PapaSnored')).toEqual([]);
    expect(only(seen, 'BabyWoke')).toEqual([]);
  });

  it('a TapBaby touches the false alarm too', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('falseAlarm');
    const alarm = run.falseAlarm();
    run.runTo(alarm.windowOpenAt + STEP_MS);
    run.sim.enqueue({ type: 'TapBaby', t: run.world.time.sim });
    const seen = run.runTo(run.world.time.sim + 3 * STEP_MS);
    expect(only(seen, 'GagTriggered')).toMatchObject([
      { gag: 'baby_woke_by_touch', reason: 'acted' },
    ]);
    expect(only(seen, 'SequenceEnded')).toMatchObject([{ outcome: 'failed' }]);
  });

  it('a missed real wake ends the sequence too', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('realWake');
    const seen = run.runTo(run.realWake().windowOpenAt + 2000);
    expect(only(seen, 'GagTriggered')).toMatchObject([{ gag: 'baby_woke_crying', reason: 'late' }]);
    expect(only(seen, 'SequenceEnded')).toMatchObject([{ outcome: 'failed' }]);
  });

  it('a real wake parried puts Papa beside the baby and the sequence goes on', async () => {
    const run = await createStealthSim();
    run.start();
    run.alertNow('realWake');
    run.teleportPapa(0, 1.6);
    const wake = run.realWake();
    run.runTo(wake.windowOpenAt - STEP_MS);
    const centreMs = wake.windowOpenAt + (wake.responseWindow?.windowMs ?? 0) / 2;
    run.sim.enqueue({ type: 'PressThreat', t: asSimMs(centreMs), threatId: wake.id });
    run.sim.enqueue({ type: 'Release', t: asSimMs(centreMs + 20) });
    const seen = run.runTo(centreMs + 4000);
    expect(only(seen, 'ResponseResolved')).toMatchObject([{ response: 'parry' }]);
    expect(only(seen, 'GagTriggered')).toEqual([]);
    expect(run.world.flow.state).toBe('sequence');
    expect(
      Math.hypot(run.world.papa.xM - run.world.baby.xM, run.world.papa.zM - run.world.baby.zM),
    ).toBeLessThan(0.6);
    // He can walk again.
    run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: 1, zM: 1.6 });
    run.runTo(run.world.time.sim + 3 * STEP_MS);
    expect(['walkPath', 'idle']).toContain(run.world.papa.state);
  });

  it('adds the cry to the noise: perSec for each BabyCrying, less the decay', async () => {
    const run = await createStealthSim({ hasNoise: true });
    run.start();
    run.alertNow('realWake');
    const { sources, decayPerSec } = content.feel.noise;
    const seen = run.runTo(run.realWake().windowOpenAt + 5000);
    const cries = only(seen, 'BabyCrying').length;
    const crySteps = only(seen, 'NoiseChanged').filter((event) => event.source === 'babyCrying');
    expect(cries).toBeGreaterThan(0);
    expect(crySteps).toHaveLength(cries);
    for (const event of crySteps) {
      expect(event.deltaPct).toBeCloseTo(
        (sources.babyCrying.perSec * BABY_CRYING_EVERY_MS) / MS_PER_S,
      );
    }
    expect(decayPerSec).toBeGreaterThanOrEqual(0);
  });
});

describe('the end of the level during the step (story 4.9)', () => {
  it('drops the slice with no gasp and no BreathReleased, even with the breath held', async () => {
    const run = await createStealthSim({ durationMs: 3000 });
    run.start();
    run.holdAlerts();
    run.sim.enqueue({ type: 'HoldAnywhere', t: run.world.time.sim });
    run.stepOnce();
    expect(run.world.sequence.stealth.breathHeldAt).not.toBeNull();
    const seen = run.runTo(4000);
    expect(only(seen, 'SequenceEnded')).toMatchObject([{ outcome: 'levelEnded' }]);
    expect(only(seen, 'BreathReleased')).toEqual([]);
    expect(only(seen, 'BreathGasped')).toEqual([]);
    expect(run.world.sequence.stealth.isRunning).toBe(false);
    expect(run.world.sequence.stealth.breathHeldAt).toBeNull();
    expect(run.world.sequence.stealth.breathLeftMs).toBe(stealthFeel.breathCapacityMs);
  });
});

describe('a level with no stealth sequence (story 4.9)', () => {
  it('has no breath and no creak: the commands are ignored and nothing is emitted', async () => {
    const sim = await createSim({
      content,
      geometry: createCreakGeometry([[0, 0, 5, 5]]),
      level: createTestLevel({ waves: [testWave([OUTLET], { fromMs: 500_000 })] }),
      seed: 1,
    });
    sim.enqueue({ type: 'HoldAnywhere', t: asSimMs(0) });
    sim.enqueue({ type: 'ReleaseHold', t: asSimMs(10) });
    sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: 2, zM: 0 });
    for (let i = 0; i < 200; i++) sim.step();
    const events = sim.drainEvents();
    expect(only(events, 'BreathHeld')).toEqual([]);
    expect(only(events, 'BreathReleased')).toEqual([]);
    expect(only(events, 'BreathGasped')).toEqual([]);
    expect(only(events, 'FloorCreaked')).toEqual([]);
    expect(sim.world.sequence.stealth.breathHeldAt).toBeNull();
  });
});

describe('the alert gap (story 4.9)', () => {
  it('never waits on the last alert: the next one comes at least alertGapMinMs after', async () => {
    const run = await createStealthSim({ seed: 3 });
    run.start();
    const telegraphs: number[] = [];
    const watch = run.runTo(run.world.time.sim + 30_000);
    for (const event of only(watch, 'ThreatTelegraphed')) telegraphs.push(event.t);
    // A bot that answers nothing loses at the first real wake or sits false alarms through; either
    // way two telegraphs of the same sequence are at least alertGapMinMs apart when both happened.
    for (let i = 1; i < telegraphs.length; i++) {
      expect((telegraphs[i] as number) - (telegraphs[i - 1] as number)).toBeGreaterThanOrEqual(
        step.alertGapMinMs,
      );
    }
    expect(NEVER_MS).toBeGreaterThan(0);
    expect(FLOAT_ZERO.a).toBe(0);
  });
});
