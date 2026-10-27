import type { Bot, BotId, BotOptions, BotSetup } from '@bots/bot';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { createSim, type Sim, type SimEvent } from '@sim';
import {
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from './testContent.ts';

/** Sim ms the bot tests play unless they say otherwise. */
export const BOT_TEST_UNTIL_MS = 60_000;

/** The frozen level with the outlet planned from 4 s, as the live one does. */
export const botTestLevel = () => createTestLevel([outletEntry(4000)]);

export function botSetup(seed: number, settings: Partial<BotOptions> = {}): BotSetup {
  const content = createTestContent();
  return {
    seed,
    holdMinMs: content.feel.input.holdMinMs,
    responses: { outlet: 'parry' },
    settings: { ...createTestBots(), ...settings },
  };
}

export function makeBot(id: BotId, setup: BotSetup): Bot {
  const made = createBot(id, setup);
  if (!made.ok) throw new Error(made.error.message);
  return made.value;
}

export interface BotGame {
  sim: Sim;
  events: SimEvent[];
}

/** One strict headless game of `id` on the frozen level. */
export async function playBotGame(
  id: BotId,
  seed: number,
  options: { untilSimMs?: number; settings?: Partial<BotOptions> } = {},
): Promise<BotGame> {
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: botTestLevel(),
    seed,
    strictInvariants: true,
  });
  const events: SimEvent[] = [];
  playGame(
    sim,
    makeBot(id, botSetup(seed, options.settings)),
    options.untilSimMs ?? BOT_TEST_UNTIL_MS,
    (event) => events.push(event),
  );
  return { sim, events };
}

export function responses(events: readonly SimEvent[]) {
  return events.flatMap((event) => (event.type === 'ResponseResolved' ? [event] : []));
}
