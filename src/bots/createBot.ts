import { UINT32_RANGE } from '@shared/constants';
import { type AppError, err, ok, type Result } from '@shared/result';
import { BOT_IDS, type Bot, type BotSetup } from './bot.ts';
import { createHumanBot } from './humanBot.ts';
import { createIdleBot } from './idleBot.ts';
import { createPerfectBot } from './perfectBot.ts';
import { createRandomBot } from './randomBot.ts';

/** A press must stay in its cycle: a wider read-error spread than this is a typo (deferred-work 1.12). Mirrors the schema. */
const READ_ERROR_SD_MAX_MS = 2000;
/** Longer than any telegraph, silence or window: a longer delay, offset or jitter than this is a typo. Mirrors the schema. */
const HUMAN_TIMING_MAX_MS = 10_000;
/** The largest screen a bot plays on, in CSS px: a typo guard. Mirrors the schema. */
const SCREEN_MAX_PX = 8192;
const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const isFiniteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const isDurationInRange = (value: number, minMs: number): boolean =>
  Number.isFinite(value) && value >= minMs && value <= HUMAN_TIMING_MAX_MS;

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
  if (!isDurationInRange(human.reactionMeanMs, 0)) {
    return `human.reactionMeanMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  if (!isDurationInRange(human.reactionSdMs, 0)) {
    return `human.reactionSdMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  if (!isDurationInRange(human.reactionMinMs, 0)) {
    return `human.reactionMinMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  for (const mode of ['withChronoRing', 'withoutChronoRing'] as const) {
    const { offsetMs, sdMs } = human.readError[mode];
    if (!isDurationInRange(offsetMs, -HUMAN_TIMING_MAX_MS)) {
      return `human.readError.${mode}.offsetMs must be a number in [-${HUMAN_TIMING_MAX_MS}, ${HUMAN_TIMING_MAX_MS}]`;
    }
    if (!isFiniteNonNegative(sdMs) || sdMs > READ_ERROR_SD_MAX_MS) {
      return `human.readError.${mode}.sdMs must be a number in [0, ${READ_ERROR_SD_MAX_MS}]`;
    }
  }
  if (!isDurationInRange(human.aimOffsetMs, -HUMAN_TIMING_MAX_MS)) {
    return `human.aimOffsetMs must be a number in [-${HUMAN_TIMING_MAX_MS}, ${HUMAN_TIMING_MAX_MS}]`;
  }
  if (!isDurationInRange(human.jitterSdMs, 0)) {
    return `human.jitterSdMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  if (
    !Number.isFinite(human.missWhileBusyPct) ||
    human.missWhileBusyPct < 0 ||
    human.missWhileBusyPct > 100
  ) {
    return 'human.missWhileBusyPct must be a number in [0, 100]';
  }
  if (!isDurationInRange(human.backTurnedSdMs, 0)) {
    return `human.backTurnedSdMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  const { view } = human;
  if (!Number.isInteger(view.widthPx) || view.widthPx <= 0 || view.widthPx > SCREEN_MAX_PX) {
    return `human.view.widthPx must be a whole number in (0, ${SCREEN_MAX_PX}]`;
  }
  if (!Number.isInteger(view.heightPx) || view.heightPx <= 0 || view.heightPx > SCREEN_MAX_PX) {
    return `human.view.heightPx must be a whole number in (0, ${SCREEN_MAX_PX}]`;
  }
  if (view.widthPx <= view.heightPx) {
    return `human.view must be a landscape screen: widthPx (${view.widthPx}) above heightPx (${view.heightPx})`;
  }
  if (
    !Number.isInteger(view.hudBottomPx) ||
    view.hudBottomPx < 0 ||
    view.hudBottomPx > SCREEN_MAX_PX
  ) {
    return `human.view.hudBottomPx must be a whole number in [0, ${SCREEN_MAX_PX}]`;
  }
  if (!isDurationInRange(view.bubbleReadMs, 0)) {
    return `human.view.bubbleReadMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
  if (typeof settings.chores.isEnabled !== 'boolean') {
    return 'chores.isEnabled must be a boolean';
  }
  if (!isDurationInRange(settings.chores.quietMinMs, 0)) {
    return `chores.quietMinMs must be a number in [0, ${HUMAN_TIMING_MAX_MS}]`;
  }
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
