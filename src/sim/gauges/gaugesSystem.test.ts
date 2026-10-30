import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  NOISE_GAUGES,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import { SYSTEMS } from '../step.ts';
import { runGauges } from './gaugesSystem.ts';

const content = createTestContent();
const geometry = createTestGeometry();

describe('runGauges', () => {
  it('sits between runPhysics and runInstinct (story 2.9), then runScoring (story 4.2), right before runFlow', () => {
    const names = SYSTEMS.map((system) => system.name);
    expect(names.indexOf('runGauges')).toBe(names.indexOf('runPhysics') + 1);
    expect(names.indexOf('runInstinct')).toBe(names.indexOf('runGauges') + 1);
    expect(names.indexOf('runScoring')).toBe(names.indexOf('runInstinct') + 1);
    expect(names.indexOf('runFlow')).toBe(names.indexOf('runScoring') + 1);
    expect(SYSTEMS).toContain(runGauges);
  });

  it('applies a SetFatigue through addFatigue: the value, the crossing and the pending micro-sleep', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ gauges: FATIGUE_GAUGES }),
      seed: 1,
    });
    sim.enqueue({ type: 'SetFatigue', t: asSimMs(0), points: 85 });
    stepN(sim, 1);
    expect(sim.world.gauges.fatigue).toBeCloseTo(
      85 + (content.feel.fatigue.perSec * STEP_MS) / MS_PER_S,
      9,
    );
    expect(sim.world.gauges.isFatigueAbove).toBe(true);
    expect(sim.world.gauges.microSleepAt).not.toBeNull();
    expect(sim.drainEvents()).toContainEqual({
      type: 'FatigueThresholdCrossed',
      t: STEP_MS,
      isAbove: true,
    });
  });

  it('is journaled and replays to the same state', async () => {
    const options = {
      content,
      geometry,
      level: createTestLevel({ gauges: FATIGUE_GAUGES }),
      seed: 3,
    };
    const live = await createSim(options);
    live.enqueue({ type: 'SetFatigue', t: asSimMs(200), points: 95 });
    stepN(live, 3000);
    const replay = await createSim({ ...options, journal: live.journal() });
    stepN(replay, 3000);
    expect(replay.world).toEqual(live.world);
    expect(live.journal().entries.map((entry) => entry.command.type)).toEqual(['SetFatigue']);
  });

  it('applies SetNoise and SetBladder last: each ends the step on the commanded value (story 4.3)', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ gauges: { ...NOISE_GAUGES, ...NEED_GAUGES } }),
      seed: 1,
    });
    sim.enqueue({ type: 'SetNoise', t: asSimMs(0), pct: 40 });
    sim.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 55 });
    stepN(sim, 1);
    expect(sim.world.gauges.noisePct).toBe(40);
    expect(sim.world.gauges.bladderPct).toBe(55);
  });

  it('replays a SetBladder from the journal to the same state (story 4.3)', async () => {
    const options = {
      content,
      geometry,
      level: createTestLevel({ gauges: NEED_GAUGES }),
      seed: 3,
    };
    const live = await createSim(options);
    live.enqueue({ type: 'SetBladder', t: asSimMs(200), pct: 95 });
    stepN(live, 2000);
    const replay = await createSim({ ...options, journal: live.journal() });
    stepN(replay, 2000);
    expect(replay.world).toEqual(live.world);
    expect(live.journal().entries.map((entry) => entry.command.type)).toEqual(['SetBladder']);
    expect(live.world.gauges.isBladderFull).toBe(true);
  });
});
