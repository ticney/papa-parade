import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import { SYSTEMS } from '../step.ts';
import { runGauges } from './gaugesSystem.ts';

const content = createTestContent();
const geometry = createTestGeometry();

describe('runGauges', () => {
  it('sits between runPhysics and runFlow', () => {
    const names = SYSTEMS.map((system) => system.name);
    expect(names.indexOf('runGauges')).toBe(names.indexOf('runPhysics') + 1);
    expect(names.indexOf('runFlow')).toBe(names.indexOf('runGauges') + 1);
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
});
