import { UINT32_RANGE } from '@shared/constants';
import { type AppError, err, ok, type Result } from '@shared/result';
import { BOT_IDS, type Bot, type BotSetup } from './bot.ts';
import { createHumanBot } from './humanBot.ts';
import { createIdleBot } from './idleBot.ts';
import { createPerfectBot } from './perfectBot.ts';
import { createRandomBot } from './randomBot.ts';

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const isFiniteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** Why a setup cannot make a bot, or `null`. Checks what the bots would otherwise only fail on mid-game. */
function setupProblem(setup: BotSetup): string | null {
  const { seed, holdMinMs, settings } = setup;
  const { human, random } = settings;
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    return `the seed must be an integer in [0, 2**32), got ${seed}`;
  }
  if (!isFinitePositive(holdMinMs)) return `holdMinMs must be a positive number, got ${holdMinMs}`;
  if (!isFinitePositive(settings.tapMs)) {
    return `tapMs must be a positive number, got ${settings.tapMs}`;
  }
  if (settings.tapMs >= holdMinMs) {
    return `tapMs (${settings.tapMs}) must be under holdMinMs (${holdMinMs}), or the bot's tap would be a Firmness`;
  }
  if (!isFiniteNonNegative(human.reactionMs)) return 'human.reactionMs must be a number >= 0';
  if (!Number.isFinite(human.aimOffsetMs)) return 'human.aimOffsetMs must be a finite number';
  if (!isFiniteNonNegative(human.jitterSdMs)) return 'human.jitterSdMs must be a number >= 0';
  if (!isFiniteNonNegative(random.actionsPerSec) || random.actionsPerSec > 100) {
    return 'random.actionsPerSec must be a number in [0, 100]';
  }
  if (!isFinitePositive(random.floorReachM)) return 'random.floorReachM must be a positive number';
  if (!isFinitePositive(random.maxHoldMs)) return 'random.maxHoldMs must be a positive number';
  return null;
}

/**
 * The bot called `id`. An unknown id or a setup no bot can run with is an `err` that says what to
 * choose or fix, never a throw: both come from the command line.
 */
export function createBot(id: string, setup: BotSetup): Result<Bot, AppError> {
  if (!(BOT_IDS as readonly string[]).includes(id)) {
    return err({
      kind: 'bot',
      message: `unknown bot "${id}": choose ${BOT_IDS.join(', ')}`,
    });
  }
  const problem = setupProblem(setup);
  if (problem !== null) return err({ kind: 'bot', message: `invalid bot setup: ${problem}` });
  switch (id as (typeof BOT_IDS)[number]) {
    case 'perfect':
      return ok(createPerfectBot(setup));
    case 'human':
      return ok(createHumanBot(setup));
    case 'random':
      return ok(createRandomBot(setup));
    case 'idle':
      return ok(createIdleBot());
  }
}
