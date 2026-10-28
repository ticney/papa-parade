import { describe, expect, it } from 'vitest';
import { botSetup, makeBot, playBotGame } from '../support/botSupport.ts';
import { createTestLevel, SILENCE, testWave } from '../support/testContent.ts';

// Story 1.21: the bots that look for the baby. The frozen level plans only the silence, from 0 ms;
// the frozen feel's `silenceAlertMs` and `findMaxMs` are read, never written as a literal.
const silenceLevel = () => createTestLevel({ waves: [testWave([SILENCE])] });
// Long enough for one silence found by a bot, short enough that it is the only one: the cooldown of
// the threat (6 s) keeps the second out. (A second one would be found at once by a Papa still
// standing in the zone after the parry, and need no tap.)
const UNTIL_MS = 12_000;

async function journalOf(bot: 'perfect' | 'human' | 'random' | 'idle', human = {}) {
  const { sim, events } = await playBotGame(bot, 1, {
    untilSimMs: UNTIL_MS,
    level: silenceLevel(),
    settings: { human: { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 0, ...human } },
  });
  const entries = sim.journal().entries.filter((entry) => entry.command.type === 'TapBaby');
  return { events, entries, sim };
}

describe('the bots and the suspicious silence', () => {
  it('perfect taps the baby once per silence, at the first step it sees one started', async () => {
    const { events, entries } = await journalOf('perfect');
    const started = events.filter((event) => event.type === 'SilenceStarted');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(entries).toHaveLength(started.length);
    entries.forEach((entry, index) => {
      expect(entry.command.t).toBe(started[index]?.t);
    });
    // And the baby is found one step after it started.
    const ended = events.filter((event) => event.type === 'SilenceEnded');
    expect(ended.every((event) => event.reason === 'found')).toBe(true);
  });

  it('human taps reactionMs after the silence started, once per silence', async () => {
    const { events, entries } = await journalOf('human', { reactionMs: 400 });
    const started = events.filter((event) => event.type === 'SilenceStarted');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(entries).toHaveLength(started.length);
    entries.forEach((entry, index) => {
      expect(entry.command.t).toBe((started[index]?.t ?? 0) + 400);
    });
  });

  it('human too slow to react lets the mischief come: the surprise gag, no find', async () => {
    // Longer than findMaxMs (frozen: 5000 ms).
    const { events } = await journalOf('human', { reactionMs: 8000 });
    // (The game runs 12 s: the silence started near 6 s and gives up 5 s later.)
    const ended = events.filter((event) => event.type === 'SilenceEnded');
    expect(ended.length).toBeGreaterThanOrEqual(1);
    expect(ended[0]).toMatchObject({ reason: 'timedOut' });
  });

  it.each(['idle', 'random'] as const)('%s never finds the baby', async (bot) => {
    const { events, entries } = await journalOf(bot);
    expect(entries).toEqual([]);
    expect(
      events.filter((event) => event.type === 'SilenceEnded' && event.reason === 'found'),
    ).toEqual([]);
  });

  it('reads the silence through the public world and never touches the rng (same game twice)', async () => {
    const first = await journalOf('perfect');
    const second = await journalOf('perfect');
    expect(second.events).toEqual(first.events);
    expect(second.sim.world.rng).toEqual(first.sim.world.rng);
  });

  it('human drops its planned tap when the silence ends before it is due (no stray TapBaby later)', () => {
    const bot = makeBot(
      'human',
      botSetup(1, { human: { reactionMs: 400, aimOffsetMs: 0, jitterSdMs: 0 } } as never),
    );
    const worldAt = (sim: number, startedAt: number | null) =>
      ({
        time: { sim },
        threats: [],
        silence: { threatId: startedAt === null ? null : 1, zoneEnteredAt: startedAt, startedAt },
      }) as never;
    const out: { type: string; t: number }[] = [];
    // The silence starts at 1000: the tap is planned for 1400.
    bot.act(worldAt(1000, 1000), out as never);
    expect(out).toEqual([]);
    // Papa walked in meanwhile: the silence is over before 1400.
    bot.act(worldAt(1200, null), out as never);
    bot.act(worldAt(1400, null), out as never);
    bot.act(worldAt(1600, null), out as never);
    expect(out).toEqual([]);
    // A new silence plans a new tap, which comes when due.
    bot.act(worldAt(3000, 3000), out as never);
    expect(out).toEqual([]);
    bot.act(worldAt(3400, 3000), out as never);
    expect(out).toEqual([expect.objectContaining({ type: 'TapBaby', t: 3400 })]);
  });

  it('does not tap for a world that has no started silence', () => {
    const bot = makeBot('perfect', botSetup(1));
    const out: never[] = [];
    bot.act(
      {
        time: { sim: 0 },
        threats: [],
        silence: { threatId: null, zoneEnteredAt: null, startedAt: null },
      } as never,
      out,
    );
    expect(out).toEqual([]);
  });
});
