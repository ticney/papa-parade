import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestCycleGeometry, createTestCycleLevel } from '../../support/cycleSupport.ts';
import { createTestBots, createTestContent } from '../../support/testContent.ts';

// AC 17's pin on the frozen bedroom, seeds 1 to 5: the perfect bot completes the bedtime cycle and the
// idle bot never does. The live table goes in the story's Completion Notes.
const SEEDS = [1, 2, 3, 4, 5];
const ALL = ['stay_awake', 'lullaby_walk', 'bedtime_duel', 'bomb_drop', 'stealth_exit'];

async function play(botId: BotId, seed: number) {
  const content = createTestContent();
  const geometry = createTestCycleGeometry();
  const level = createTestCycleLevel();
  const bot = createBot(botId, {
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
  const events: SimEvent[] = [];
  playGame(sim, bot.value, level.level.durationMs, (event) => events.push(event));
  sim.dispose();
  return events;
}

describe('the bedtime cycle, played by the bots (story 4.10)', () => {
  it.each(SEEDS)(
    'perfect completes it on seed %i, every sequence won',
    async (seed) => {
      const events = await play('perfect', seed);
      const ends = events.filter((event) => event.type === 'SequenceEnded');
      expect(ends.map((event) => event.id)).toEqual(ALL);
      expect(ends.every((event) => event.outcome === 'succeeded')).toBe(true);
      expect(events.filter((event) => event.type === 'LevelEnded')).toMatchObject([
        { reason: 'cycleDone' },
      ]);
      // The cycle bot's trade: it cashes in at the crib, the drop's cash-in on top.
      expect(events.filter((event) => event.type === 'ComboCashedIn').length).toBeGreaterThan(1);
      expect(events.filter((event) => event.type === 'GagTriggered')).toEqual([]);
    },
    20_000,
  );

  it.each(SEEDS)(
    'idle never does on seed %i: it never passes stay_awake',
    async (seed) => {
      const events = await play('idle', seed);
      const ends = events.filter((event) => event.type === 'SequenceEnded');
      expect(ends.length).toBeGreaterThan(0);
      expect(
        ends.every((event) => event.id === 'stay_awake' && event.outcome !== 'succeeded'),
      ).toBe(true);
      const [ended] = events.filter((event) => event.type === 'LevelEnded');
      // Idle's gags now bring Mama home early (story 3.16); the cycle is still never completed.
      expect(['mamaWoke', 'mamaHome', 'timer']).toContain(ended?.reason);
      expect(events.filter((event) => event.type === 'CycleCompleted')).toEqual([]);
    },
    20_000,
  );

  it('sends one tap at the crib per interlude, not one per idle step', async () => {
    const content = createTestContent();
    const geometry = createTestCycleGeometry();
    const level = createTestCycleLevel();
    const spot = safeSpotOf(geometry);
    const bot = createBot('perfect', {
      seed: 1,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      releaseDefIds: releaseDefIdsOf(level.threats),
      isChronoRingShown: true,
      safeSpot: spot,
      settings: createTestBots(),
    });
    if (!bot.ok) throw new Error(bot.error.message);
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    playGame(sim, bot.value, level.level.durationMs, () => {});
    const taps = sim
      .journal()
      .entries.filter(
        ({ command }) =>
          command.type === 'TapFloor' && command.xM === spot?.xM && command.zM === spot?.zM,
      );
    sim.dispose();
    // After the first three sequences: the first interlude has the baby free, and the drop's is 0.
    expect(taps).toHaveLength(3);
  }, 20_000);
});
