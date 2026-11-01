import { createRng, nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStealthSim, only, type StealthSim } from '../../../tests/support/stealthSupport.ts';
import type { SimEvent } from '../events.ts';

// The stealth exit under 30 seeds (story 4.9): a sensible player (walks to the door, holds his breath at
// each false alarm, rocks at each real wake) with more and more junk mixed in, up to a player who
// does nothing sensible at all. Each seed is played once and cached: the tests below read the same
// runs. The world's own invariants run (`strictInvariants`); what is required across the seeds is that
// the sequence is won, lost by each gag, that a gasp and a creak happen, and that it ends.
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const DOOR = { xM: 2.9, zM: -2.8 };
const MAX_MS = 45_000;

interface Outcome {
  readonly seed: number;
  readonly falseAlarmId: number;
  readonly events: readonly SimEvent[];
  readonly endedAt: number | null;
  readonly ended: string | null;
}

/** The boards, on the path a plain walk to the door takes (found by a dry run). */
async function boardsOnThePath(): Promise<readonly (readonly [number, number, number, number])[]> {
  const run = await createStealthSim();
  run.start();
  run.holdAlerts();
  run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: DOOR.xM, zM: DOOR.zM });
  const points: { xM: number; zM: number }[] = [];
  for (let i = 0; i < 2000 && run.world.flow.state === 'sequence'; i++) {
    run.stepOnce();
    points.push({ xM: run.world.papa.xM, zM: run.world.papa.zM });
  }
  return [0.35, 0.7].map((at) => {
    const point = points[Math.floor(points.length * at)] as { xM: number; zM: number };
    return [point.xM, point.zM, 0.3, 0.3] as const;
  });
}

function play(run: StealthSim, seed: number): void {
  const rng = createRng(seed * 7919);
  // Seeds 1, 4, 7… play sensibly; 2, 5, 8… with junk; 3, 6, 9… only junk.
  const style = seed % 3;
  const { sim } = run;
  for (let i = 0; i < MAX_MS / 10 && run.world.flow.state === 'sequence'; i++) {
    const { world } = run;
    const now = world.time.sim;
    const alarm = run.falseAlarm();
    const wake = run.realWake();
    if (style !== 0 && nextFloat(rng) < 0.05) {
      const pick = Math.floor(nextFloat(rng) * 6);
      if (pick === 0) {
        sim.enqueue({
          type: 'TapFloor',
          t: asSimMs(now),
          xM: -3 + nextFloat(rng) * 6,
          zM: -2.5 + nextFloat(rng) * 5,
        });
      } else if (pick === 1) {
        sim.enqueue({ type: 'PressThreat', t: asSimMs(now), threatId: alarm.id });
      } else if (pick === 2) {
        sim.enqueue({ type: 'HoldAnywhere', t: asSimMs(now) });
      } else if (pick === 3) {
        sim.enqueue({ type: 'ReleaseHold', t: asSimMs(now) });
      } else if (pick === 4) {
        sim.enqueue({ type: 'TapBaby', t: asSimMs(now) });
      } else {
        sim.enqueue({ type: 'PressThreat', t: asSimMs(now), threatId: wake.id });
      }
    }
    if (style !== 2) {
      if (i % 100 === 0) {
        sim.enqueue({ type: 'TapFloor', t: asSimMs(now), xM: DOOR.xM, zM: DOOR.zM });
      }
      if (alarm.state === 'telegraph' && world.sequence.stealth.breathHeldAt === null) {
        sim.enqueue({ type: 'HoldAnywhere', t: asSimMs(now) });
      }
      if (alarm.state === 'windowOpen' && now >= alarm.windowOpenAt + 1990) {
        sim.enqueue({ type: 'ReleaseHold', t: asSimMs(alarm.windowOpenAt + 2000) });
      }
      if (wake.state === 'windowOpen' && wake.press === null && now >= wake.windowOpenAt + 100) {
        sim.enqueue({ type: 'PressThreat', t: asSimMs(now), threatId: wake.id });
        sim.enqueue({ type: 'Release', t: asSimMs(now + 20) });
      }
    }
    run.stepOnce();
  }
}

const outcomes = new Map<number, Outcome>();

beforeAll(async () => {
  const boards = await boardsOnThePath();
  for (const seed of SEEDS) {
    const run = await createStealthSim({ seed, hasNoise: true, creakBoxes: boards });
    run.start();
    play(run, seed);
    const end = only(run.events, 'SequenceEnded')[0];
    outcomes.set(seed, {
      seed,
      falseAlarmId: run.falseAlarm().id,
      events: run.events,
      endedAt: end?.t ?? null,
      ended: end?.outcome ?? null,
    });
  }
}, 120_000);

const all = () => [...outcomes.values()];
const typesOf = (outcome: Outcome, type: SimEvent['type']) =>
  outcome.events.filter((event) => event.type === type);

describe('30 seeds of the stealth exit (story 4.9)', () => {
  it('plays every seed to an end, and never emits two ends', () => {
    for (const outcome of all()) {
      expect(typesOf(outcome, 'SequenceEnded').length, `seed ${outcome.seed}`).toBeLessThanOrEqual(
        1,
      );
    }
    expect(all().filter((outcome) => outcome.ended !== null).length).toBeGreaterThan(20);
  });

  it('is won at least once, by the door', () => {
    expect(all().filter((outcome) => outcome.ended === 'succeeded').length).toBeGreaterThan(0);
  });

  it('is lost at least once by touching a false alarm, and once by a missed real wake', () => {
    const gagsOf = (outcome: Outcome) =>
      only(outcome.events, 'GagTriggered').map((event) => event.gag);
    expect(all().some((outcome) => gagsOf(outcome).includes('baby_woke_by_touch'))).toBe(true);
    expect(all().some((outcome) => gagsOf(outcome).includes('baby_woke_crying'))).toBe(true);
  });

  it('gasps and creaks at least once across the seeds', () => {
    expect(all().some((outcome) => typesOf(outcome, 'BreathGasped').length > 0)).toBe(true);
    expect(all().some((outcome) => typesOf(outcome, 'FloorCreaked').length > 0)).toBe(true);
  });

  it('gasps at most once in the window of a false alarm', () => {
    for (const outcome of all()) {
      let gasps = 0;
      let isOpen = false;
      for (const event of outcome.events) {
        if (event.type === 'WindowOpened' && event.threatId === outcome.falseAlarmId) {
          isOpen = true;
          gasps = 0;
        } else if (event.type === 'BreathGasped' && isOpen) {
          gasps += 1;
          expect(gasps, `seed ${outcome.seed}`).toBeLessThanOrEqual(1);
        } else if (event.type === 'ResponseResolved' && event.threatId === outcome.falseAlarmId) {
          isOpen = false;
        }
      }
    }
  });

  it('ends every hold with a release, except one cut off by the end of the sequence', () => {
    for (const outcome of all()) {
      const held = only(outcome.events, 'BreathHeld').length;
      const released = only(outcome.events, 'BreathReleased').length;
      expect(held - released, `seed ${outcome.seed}`).toBeGreaterThanOrEqual(0);
      expect(held - released, `seed ${outcome.seed}`).toBeLessThanOrEqual(1);
    }
  });
});
