import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf, releaseDefIdsOf, safeSpotOf } from '@bots/botResponses';
import { botViewOf } from '@bots/botView';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { createSim, type SimEvent } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 7.4 AC 2: the finale is named at most once per level, and never after the level ended. Every
// bot on every live level, 5 games from seed 1, on the real content: a `FinaleReached` count of 0 or 1,
// and none in the steps after `LevelEnded` (the sim keeps its clock there).

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const TIMEOUT_MS = 300_000;
const LEVELS = ['salon_kitchen', 'salon_crawler', 'chambre_night'] as const;
const BOTS: readonly BotId[] = ['perfect', 'human', 'random', 'idle'];
const RUNS = 5;
/** The steps played past the end, to prove nothing more comes. */
const STEPS_AFTER_END = 200;

const levels = new Map<string, SimLevel>();

beforeAll(async () => {
  for (const id of LEVELS) {
    const loaded = await loadSimLevel(CONTENT_DIR, id);
    if (!loaded.ok) throw new Error(loaded.error);
    levels.set(id, loaded.value);
  }
}, TIMEOUT_MS);

/** One strict game: its event types in order, the ones after the end included. */
async function play(levelId: string, botId: BotId, seed: number): Promise<SimEvent['type'][]> {
  const { content, geometry, level } = levels.get(levelId) as SimLevel;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  const bot = createBot(botId, {
    seed,
    holdMinMs: content.feel.input.holdMinMs,
    responses: botResponsesOf(level.threats),
    releaseDefIds: releaseDefIdsOf(level.threats),
    choreObjectIds: (level.level.chores ?? []).map((chore) => chore.object),
    safeSpot: safeSpotOf(geometry),
    isChronoRingShown: true,
    view: botViewOf({
      camera: level.level.camera,
      geometry,
      threats: level.threats,
      babyBodyRadiusM: content.feel.baby.bodyRadiusM,
      screen: content.bots.human.view,
    }),
    settings: content.bots,
  });
  if (!bot.ok) throw new Error(bot.error.message);
  const types: SimEvent['type'][] = [];
  playGame(sim, bot.value, level.level.durationMs, (event) => types.push(event.type));
  for (let i = 0; i < STEPS_AFTER_END; i++) {
    sim.step();
    for (const event of sim.drainEvents()) types.push(event.type);
  }
  sim.dispose();
  return types;
}

describe('FinaleReached on the live levels (story 7.4)', () => {
  for (const levelId of LEVELS) {
    for (const botId of BOTS) {
      it(
        `${levelId}, ${botId}: 0 or 1 a game, never after LevelEnded`,
        async () => {
          let gamesWithFinale = 0;
          for (let seed = 1; seed <= RUNS; seed++) {
            const types = await play(levelId, botId, seed);
            const finales = types.filter((type) => type === 'FinaleReached').length;
            expect(finales, `seed ${seed}`).toBeLessThanOrEqual(1);
            const endedAt = types.indexOf('LevelEnded');
            expect(endedAt, `seed ${seed}`).toBeGreaterThanOrEqual(0);
            expect(types.indexOf('FinaleReached', endedAt), `seed ${seed}`).toBe(-1);
            gamesWithFinale += finales;
          }
          // Not a vacuous pass: the perfect bot reaches the finale (a salon's wave can close with
          // nothing of it active, D7 of 1.18, so not every game), `idle` and `random` lose before it.
          if (botId === 'perfect') expect(gamesWithFinale).toBeGreaterThan(0);
          if (botId === 'idle') expect(gamesWithFinale).toBe(0);
        },
        TIMEOUT_MS,
      );
    }
  }
});
