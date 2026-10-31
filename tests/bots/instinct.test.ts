import { fileURLToPath } from 'node:url';
import type { BotId } from '@bots/bot';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { loadContent } from '@content/loadContent';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNodeContentSource } from '../../tools/content/nodeContentSource.ts';
import { loadSimLevel, type SimLevel } from '../../tools/sim/loadSimLevel.ts';

// Story 2.9, AC 25: Fatherly Instinct on the real `salon_crawler`, played by the bots. It reads the
// live content and asserts no tuned value: only that the rule can happen at all for a player who
// misses everything, that it never helps one who misses nothing, that the tier without an instinct
// gets none, and that every instinct that starts also ends.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIR = `${REPO}content`;
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);
const TIMEOUT_MS = 300_000;

let loaded: SimLevel;
let bots: Parameters<typeof createBot>[1]['settings'];

beforeAll(async () => {
  const level = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
  if (!level.ok) throw new Error(level.error);
  loaded = level.value;
  const content = await loadContent(createNodeContentSource(CONTENT_DIR));
  if (!content.ok) throw new Error('cannot load the content');
  bots = content.value.bots;
}, TIMEOUT_MS);

async function play(
  botId: BotId,
  seed: number,
  tier: 'normal' | 'experienced' = 'normal',
): Promise<SimEvent[]> {
  const { content, geometry, level } = loaded;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  try {
    const bot = createBot(botId, {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      settings: bots,
    });
    if (!bot.ok) throw new Error(bot.error.message);
    if (tier !== 'normal') sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier });
    const events: SimEvent[] = [];
    playGame(sim, bot.value, level.level.durationMs, (event) => events.push(event));
    return events;
  } finally {
    sim.dispose();
  }
}

const count = (events: readonly SimEvent[], type: SimEvent['type']) =>
  events.filter((event) => event.type === type).length;

describe('Fatherly Instinct on salon_crawler (seeds 1 to 20)', () => {
  it(
    'helps the idle bot at least once, and every start has exactly one end',
    async () => {
      let triggers = 0;
      for (const seed of SEEDS) {
        const events = await play('idle', seed);
        const started = count(events, 'InstinctTriggered');
        triggers += started;
        expect(count(events, 'InstinctEnded'), `seed ${seed}`).toBe(started);
        // Never two at once: starts and ends alternate.
        const order = events
          .filter((event) => event.type === 'InstinctTriggered' || event.type === 'InstinctEnded')
          .map((event) => event.type);
        order.forEach((type, index) => {
          expect(type, `seed ${seed}`).toBe(
            index % 2 === 0 ? 'InstinctTriggered' : 'InstinctEnded',
          );
        });
      }
      expect(triggers).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT_MS,
  );

  it(
    'never helps the perfect bot, which never misses',
    async () => {
      for (const seed of SEEDS) {
        const events = await play('perfect', seed);
        expect(count(events, 'InstinctTriggered'), `seed ${seed}`).toBe(0);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'never helps at the experienced tier, even for the idle bot',
    async () => {
      for (const seed of SEEDS) {
        const events = await play('idle', seed, 'experienced');
        expect(count(events, 'InstinctTriggered'), `seed ${seed}`).toBe(0);
      }
    },
    TIMEOUT_MS,
  );
});
