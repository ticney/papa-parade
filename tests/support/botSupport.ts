import type { Bot, BotId, BotOptions, BotSetup } from '@bots/bot';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import type { LevelContent } from '@content/contentBundle';
import type { DifficultyTierId } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { createSim, type Sim, type SimEvent } from '@sim';
import {
  COFFEE_TABLE,
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestThreats,
  OUTLET,
  STAIRS,
  testWave,
} from './testContent.ts';

/** Sim ms the bot tests play unless they say otherwise. */
export const BOT_TEST_UNTIL_MS = 60_000;

/** The frozen level with the outlet planned from 4 s, as the live one does. */
export const botTestLevel = () =>
  createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })] });

/** The frozen level with the three threats of the prototype, all planned from 0 ms in the live order. */
export const botTrioLevel = () =>
  createTestLevel({ waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE])] });

/** The firm hold of `firmBotLevel`, in sim ms from the opening of the window (above the window). */
export const FIRM_HOLD_UNTIL_MS = 1500;

/** The outlet asking for a Firmness, planned from 4 s like `botTestLevel`. */
export function firmBotLevel(holdUntilMs = FIRM_HOLD_UNTIL_MS): LevelContent {
  const base = botTestLevel();
  const outlet = base.threats.outlet;
  if (outlet === undefined) throw new Error('no outlet in the bot test level');
  return {
    ...base,
    threats: { ...base.threats, outlet: { ...outlet, response: 'firm', holdUntilMs } },
  };
}

export function botSetup(
  seed: number,
  settings: Partial<BotOptions> = {},
  level?: LevelContent,
): BotSetup {
  const content = createTestContent();
  return {
    seed,
    holdMinMs: content.feel.input.holdMinMs,
    // What every frozen def asks for (a bot is only told about the defs it can answer).
    responses: botResponsesOf(level?.threats ?? createTestThreats()),
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
  options: {
    untilSimMs?: number;
    settings?: Partial<BotOptions>;
    level?: LevelContent;
    /** The difficulty tier, sent as the client does: a `SetDifficultyTier` at t = 0, none at `normal` (story 2.8). */
    tier?: DifficultyTierId;
  } = {},
): Promise<BotGame> {
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: options.level ?? botTestLevel(),
    seed,
    strictInvariants: true,
  });
  if (options.tier !== undefined && options.tier !== 'normal') {
    sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier: options.tier });
  }
  const events: SimEvent[] = [];
  playGame(
    sim,
    makeBot(id, botSetup(seed, options.settings, options.level)),
    options.untilSimMs ?? BOT_TEST_UNTIL_MS,
    (event) => events.push(event),
  );
  return { sim, events };
}

export function responses(events: readonly SimEvent[]) {
  return events.flatMap((event) => (event.type === 'ResponseResolved' ? [event] : []));
}
