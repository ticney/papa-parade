import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { createRng, nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { createSim, type SimCommand, type SimEvent } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestCycleGeometry, createTestCycleLevel } from '../support/cycleSupport.ts';
import { createTestBots, createTestContent } from '../support/testContent.ts';

// The bedtime cycle under 30 seeds (story 4.10). The sim runs with its invariants on, and each seed is
// played once and cached: seeds 1, 4, 7… by the perfect bot; 2, 5, 8… by the human bot with junk mixed
// in; 3, 6, 9… by junk alone (`seed % 3`). What is required across the seeds: a completed cycle, a retry, a level
// ended by Mama, and a level ended by the timer (a quiet level, with no noise to wake her).
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

interface Outcome {
  readonly seed: number;
  readonly events: readonly SimEvent[];
  readonly reason: string | null;
  readonly index: number;
}

/** A junk command for now, or null: what a player with no idea might do. */
function junk(rng: ReturnType<typeof createRng>, now: number): SimCommand | null {
  if (nextFloat(rng) > 0.02) return null;
  const t = asSimMs(now);
  const pick = Math.floor(nextFloat(rng) * 5);
  if (pick === 0) {
    return { type: 'TapFloor', t, xM: -3 + nextFloat(rng) * 6, zM: -2.5 + nextFloat(rng) * 5 };
  }
  if (pick === 1) return { type: 'TapBaby', t };
  if (pick === 2) return { type: 'TapObject', t, objectId: 'toilet' };
  if (pick === 3) return { type: 'Move', t, dirX: nextFloat(rng) - 0.5, dirZ: 0.5 };
  return { type: 'MoveStop', t };
}

async function play(seed: number, isQuiet: boolean): Promise<Outcome> {
  const content = createTestContent();
  const geometry = createTestCycleGeometry();
  const level = createTestCycleLevel(
    isQuiet ? { gauges: { fatigue: { microSleepDef: 'papa_microsleep' }, need: {} } } : {},
  );
  const style = seed % 3;
  const bot = createBot(style === 1 ? 'perfect' : 'human', {
    seed,
    holdMinMs: content.feel.input.holdMinMs,
    responses: botResponsesOf(level.threats),
    releaseDefIds: releaseDefIdsOf(level.threats),
    isChronoRingShown: true,
    safeSpot: safeSpotOf(geometry),
    settings: createTestBots(),
  });
  if (!bot.ok) throw new Error(bot.error.message);
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  const rng = createRng(seed * 7919);
  const events: SimEvent[] = [];
  const out: SimCommand[] = [];
  while (sim.world.flow.state !== 'ended') {
    out.length = 0;
    if (style !== 1) {
      const command = junk(rng, sim.world.time.sim);
      if (command !== null) out.push(command);
    }
    if (style !== 0) bot.value.act(sim.world, out);
    for (const command of out) sim.enqueue(command);
    sim.step();
    events.push(...sim.drainEvents());
  }
  const ended = events.find((event) => event.type === 'LevelEnded');
  const outcome: Outcome = {
    seed,
    events,
    reason: ended?.type === 'LevelEnded' ? ended.reason : null,
    index: sim.world.cycle.index,
  };
  sim.dispose();
  return outcome;
}

describe('the bedtime cycle under 30 seeds, and 3 more with no noise gauge', () => {
  const outcomes: Outcome[] = [];

  beforeAll(async () => {
    for (const seed of SEEDS) outcomes.push(await play(seed, false));
    // No noise gauge: nothing ends these but the cycle or the timer.
    for (const seed of [3, 6, 9]) outcomes.push(await play(seed, true));
  }, 120_000);

  it('completes the cycle on some seed', () => {
    expect(outcomes.filter((outcome) => outcome.reason === 'cycleDone').length).toBeGreaterThan(0);
  });

  it('retries an entry on some seed: a sequence started twice', () => {
    const retried = outcomes.filter((outcome) => {
      const ids = outcome.events.flatMap((event) =>
        event.type === 'SequenceStarted' ? [event.id] : [],
      );
      return new Set(ids).size < ids.length;
    });
    expect(retried.length).toBeGreaterThan(0);
  });

  it('ends on a woken Mama on some seed', () => {
    expect(outcomes.filter((outcome) => outcome.reason === 'mamaWoke').length).toBeGreaterThan(0);
  });

  it('ends on the timer on some seed', () => {
    expect(outcomes.filter((outcome) => outcome.reason === 'timer').length).toBeGreaterThan(0);
  });

  it('holds a completed cycle to exactly one CycleCompleted and five wins, in order', () => {
    for (const outcome of outcomes) {
      const completed = outcome.events.filter((event) => event.type === 'CycleCompleted');
      // A tie with the noise goes to Mama: the cycle was completed, and the level ends on `mamaWoke`.
      if (outcome.reason === 'mamaWoke') expect(completed.length).toBeLessThanOrEqual(1);
      else expect(completed).toHaveLength(outcome.reason === 'cycleDone' ? 1 : 0);
      if (outcome.reason !== 'cycleDone') continue;
      expect(outcome.index).toBe(5);
      const won = outcome.events.flatMap((event) =>
        event.type === 'SequenceEnded' && event.outcome === 'succeeded' ? [event.id] : [],
      );
      expect(won).toEqual([
        'stay_awake',
        'lullaby_walk',
        'bedtime_duel',
        'bomb_drop',
        'stealth_exit',
      ]);
    }
  });
});
