import type { Bot, BotSetup } from '@bots/bot';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import type { TestHost } from '@client/app/testHost';
import { log } from '@shared/log';
import { type AppError, ok, type Result } from '@shared/result';
import { isFlowLive, type Sim, type SimCommand } from '@sim';

/**
 * Makes the bot `botId` play every level of the page instead of the player (`?autoplay=<bot>`).
 * Debug builds only: loaded by a dynamic `import()` in `boot.ts`, so a store build has no bot.
 *
 * On each started level it builds a fresh bot (the level's seed, feel and threat defs, the live
 * `content/bots.json`) and installs it as the step hook, which asks it for its commands before
 * every step exactly as `playGame` does headless: the browser plays the game the CLI plays. The
 * bot only sees `sim.world`, never real time, so `?speed=` and freezing cannot change what it does.
 * The player's own input is blocked while it plays.
 *
 * An unknown bot is an `err` that names the choices (the `createBot` message) and installs nothing.
 */
export function installAutoplay(host: TestHost, botId: string): Result<void, AppError> {
  // Asked once with a throwaway setup, so that a bad id is refused before the level starts.
  const probe = createBot(botId, setupFor(host, 0, host.content.feel.input.holdMinMs, {}));
  if (!probe.ok) return probe;

  const out: SimCommand[] = [];
  host.setGameInputBlocked(true);
  host.onLevelStarted(({ seed, level, feel }) => {
    const made = createBot(
      botId,
      setupFor(host, seed, feel.input.holdMinMs, botResponsesOf(level.threats)),
    );
    if (!made.ok) {
      // No bot plays this level: give the game back to whoever is holding the device.
      host.setStepHook(null);
      host.setGameInputBlocked(false);
      log.warn('debug', `autoplay: no bot for this level: ${made.error.message}`);
      return;
    }
    host.setStepHook(stepHookOf(made.value, out));
    host.setGameInputBlocked(true);
    log.info('debug', `autoplay: ${botId} plays seed ${seed}`);
  });
  return ok(undefined);
}

function setupFor(
  host: TestHost,
  seed: number,
  holdMinMs: number,
  responses: BotSetup['responses'],
): BotSetup {
  return { seed, holdMinMs, responses, settings: host.content.bots };
}

/** Before a step: asks the bot, enqueues what it says. One reused array, no allocation per step. */
function stepHookOf(bot: Bot, out: SimCommand[]): (sim: Sim) => void {
  return (sim) => {
    // The level is over: the sim ignores commands, so do not journal any (headless `playGame` stops here too). A special sequence is no end: the bot keeps answering (story 4.4).
    if (!isFlowLive(sim.world)) return;
    out.length = 0;
    bot.act(sim.world, out);
    for (let i = 0; i < out.length; i++) sim.enqueue(out[i] as SimCommand);
  };
}
