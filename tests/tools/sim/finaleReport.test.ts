import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../../support/testContent.ts';

// `npm run sim` and the finale (story 7.4): the report counts `FinaleReached` by cause, per game and
// over the runs, both keys always present.
const DURATION_MS = 6000;

/** One wave closed to new telegraphs at 1 s: the perfect bot's second success is the last. */
function level(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({
      durationMs: DURATION_MS,
      waves: [testWave([OUTLET, STAIRS], { lullMs: 5000, maxSimultaneous: 2 })],
    }),
    geometry: createTestGeometry(),
  };
}

async function report(botId: 'perfect' | 'idle', runs: number) {
  const result = await runSim(simArgs({ botId, runs, untilSimMs: DURATION_MS }), level());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim and the finale (story 7.4)', () => {
  it('counts one lastWave finale per game the perfect bot plays', async () => {
    const value = await report('perfect', 3);
    expect(value.finales).toEqual({ lastWave: 3, cycleDone: 0 });
  });

  it('counts none when nothing is answered, both keys present', async () => {
    const value = await report('idle', 2);
    expect(value.finales).toEqual({ lastWave: 0, cycleDone: 0 });
  });
});
