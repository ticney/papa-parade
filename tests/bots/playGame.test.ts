import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot } from '../support/botSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../support/testContent.ts';

const DURATION_MS = 4000;

async function newSim() {
  return createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({ durationMs: DURATION_MS, waves: [testWave([OUTLET])] }),
    seed: 2,
    strictInvariants: true,
  });
}

describe('playGame', () => {
  it('stops when the level ends, before the time it was asked to play to', async () => {
    const sim = await newSim();
    const events: SimEvent[] = [];
    playGame(sim, makeBot('idle', botSetup(2)), DURATION_MS * 10, (event) => events.push(event));
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.time.sim).toBe(DURATION_MS);
    expect(events.filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: DURATION_MS, reason: 'timer' },
    ]);
  });

  it('stops at untilSimMs when that comes first', async () => {
    const sim = await newSim();
    playGame(sim, makeBot('idle', botSetup(2)), 1000);
    expect(sim.world.time.sim).toBe(1000);
    expect(sim.world.flow.state).toBe('playing');
  });

  it('plays nothing at all in a level that has already ended', async () => {
    const sim = await newSim();
    playGame(sim, makeBot('idle', botSetup(2)), DURATION_MS);
    const at = sim.world.time.sim;
    playGame(sim, makeBot('idle', botSetup(2)), at + 100 * STEP_MS);
    expect(sim.world.time.sim).toBe(at);
  });
});
