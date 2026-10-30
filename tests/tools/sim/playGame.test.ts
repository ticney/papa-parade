import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
} from '../../support/testContent.ts';

// `playGame` stops at the level's end, not at a special sequence's: `isFlowLive` is true in the
// `sequence` flow state (story 4.4), so a headless game plays on through it.
const content = createTestContent();
const DURATION_MS = 30_000;

async function newSim() {
  const level = createTestLevel({
    gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
    carry: CARRY,
    sequences: ['stay_awake'],
    durationMs: DURATION_MS,
  });
  return createSim({ content, geometry: createTestGeometry(), level, seed: 3 });
}

function idleBot() {
  const bot = createBot('idle', {
    seed: 3,
    holdMinMs: content.feel.input.holdMinMs,
    responses: {},
    settings: content.bots,
  });
  if (!bot.ok) throw new Error(bot.error.message);
  return bot.value;
}

describe('playGame and the special sequence (story 4.4)', () => {
  it('plays on through a sequence and stops at the level end', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
    const types: string[] = [];
    const flows = new Set<string>();
    playGame(sim, idleBot(), 120_000, (event: SimEvent) => {
      types.push(event.type);
      flows.add(sim.world.flow.state);
    });
    expect(types).toContain('SequenceStarted');
    expect(types).toContain('SequenceEnded');
    expect(flows.has('sequence')).toBe(true);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.time.sim).toBeGreaterThanOrEqual(DURATION_MS);
    expect(sim.world.time.sim).toBeLessThan(DURATION_MS + 1000);
  });

  it('is capped by untilSimMs inside a sequence too', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
    playGame(sim, idleBot(), 4000);
    expect(sim.world.flow.state).toBe('sequence');
    expect(sim.world.time.sim).toBeGreaterThanOrEqual(4000);
    expect(sim.world.time.sim).toBeLessThan(4100);
  });
});
