import { createSim, type World } from '@sim';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../../tests/support/testContent.ts';
import { babyFocusOf, isPapaTired, isSignalOnly } from './faceInputs.ts';

// Hand-made worlds (story 7.10): a real world from the test level, its baby and a threat set by hand.
const world = (
  await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 1,
  })
).world;
// A threat of our own (the world has none before its first wave): only its id and state are read.
const threat = { id: 7, state: 'idle' } as unknown as World['threats'][number];
world.threats.push(threat);
const saved = {
  babyState: world.baby.state,
  target: world.baby.targetThreatId,
  threatState: threat.state,
  fatigue: world.gauges.fatigue,
};
afterEach(() => {
  world.baby.state = saved.babyState;
  world.baby.targetThreatId = saved.target;
  threat.state = saved.threatState;
  world.gauges.fatigue = saved.fatigue;
  world.sequence.duel.isRunning = false;
  world.sequence.stealth.isRunning = false;
});

/** The baby in `babyState`, aimed at the first threat, which is in `threatState`. */
function aim(babyState: World['baby']['state'], threatState: typeof threat.state): void {
  world.baby.state = babyState;
  world.baby.targetThreatId = threat.id;
  threat.state = threatState;
}

describe('babyFocusOf (D6)', () => {
  it.each([
    ['targetLocked', 'telegraph'],
    ['targetLocked', 'windowOpen'],
    ['approach', 'telegraph'],
    ['approach', 'windowOpen'],
  ] as const)('is true for a baby %s on a threat in %s (its marker is shown)', (baby, state) => {
    aim(baby, state);
    expect(babyFocusOf(world)).toBe(true);
  });

  it('is false for a hidden threat: the silence is not telegraphed', () => {
    aim('targetLocked', 'hidden');
    expect(babyFocusOf(world)).toBe(false);
  });

  it('is false in mischiefSilent, whatever his target', () => {
    aim('mischiefSilent', 'telegraph');
    expect(babyFocusOf(world)).toBe(false);
  });

  it.each(['idle', 'resolved', 'gag'] as const)('is false for a threat in %s', (state) => {
    aim('approach', state);
    expect(babyFocusOf(world)).toBe(false);
  });

  it('is false in act (the gag that starts it delights him), and with no target', () => {
    aim('act', 'telegraph');
    expect(babyFocusOf(world)).toBe(false);
    aim('targetLocked', 'telegraph');
    world.baby.targetThreatId = null;
    expect(babyFocusOf(world)).toBe(false);
  });
});

describe('isSignalOnly (D5)', () => {
  it('holds while a duel step or a stealth step runs, and only then', () => {
    expect(isSignalOnly(world)).toBe(false);
    world.sequence.duel.isRunning = true;
    expect(isSignalOnly(world)).toBe(true);
    world.sequence.duel.isRunning = false;
    world.sequence.stealth.isRunning = true;
    expect(isSignalOnly(world)).toBe(true);
  });
});

describe('isPapaTired (D7)', () => {
  it('is the sim strict >: not at the threshold, just above it', () => {
    const threshold = world.feel.fatigue.thresholdPoints;
    world.gauges.fatigue = threshold;
    expect(isPapaTired(world)).toBe(false);
    world.gauges.fatigue = threshold + 0.001;
    expect(isPapaTired(world)).toBe(true);
  });
});
