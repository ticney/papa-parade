import { BOT_IDS, type BotOptions } from '@bots/bot';
import { createBot } from '@bots/createBot';
import { describe, expect, it } from 'vitest';
import { botSetup } from '../support/botSupport.ts';
import { createTestBots } from '../support/testContent.ts';

describe('createBot', () => {
  it.each(BOT_IDS)('makes the %s bot', (id) => {
    const made = createBot(id, botSetup(1));
    expect(made.ok).toBe(true);
    if (made.ok) expect(made.value.id).toBe(id);
  });

  it('names the valid choices when the id is unknown', () => {
    const made = createBot('genius', botSetup(1));
    expect(made.ok).toBe(false);
    if (!made.ok) {
      expect(made.error.message).toContain('"genius"');
      for (const id of BOT_IDS) expect(made.error.message).toContain(id);
    }
  });

  it.each([
    ['a tap as long as the hold that makes a Firmness', { tapMs: 400 }],
    ['a tap that is zero', { tapMs: 0 }],
    ['a tap that is NaN', { tapMs: Number.NaN }],
    [
      'a random bot past 100 actions per second',
      { random: { actionsPerSec: 101, floorReachM: 3, maxHoldMs: 800 } },
    ],
    ['a random reach of zero', { random: { actionsPerSec: 2, floorReachM: 0, maxHoldMs: 800 } }],
    ['a random hold of zero', { random: { actionsPerSec: 2, floorReachM: 3, maxHoldMs: 0 } }],
  ])('refuses %s, with a message and no throw', (_label, settings) => {
    const made = createBot('perfect', botSetup(1, settings));
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toMatch(/invalid bot setup/);
  });

  // Story 3.14 AC 4: each key of `human` is refused when out of range, by a message that names it.
  const human = (patch: Partial<BotOptions['human']>): Partial<BotOptions> => ({
    human: { ...createTestBots().human, ...patch },
  });
  const readError = (mode: 'withChronoRing' | 'withoutChronoRing', patch: object) =>
    human({ readError: { ...createTestBots().human.readError, [mode]: patch } });
  it.each([
    ['human.reactionMeanMs', human({ reactionMeanMs: -1 })],
    ['human.reactionMeanMs', human({ reactionMeanMs: Number.NaN })],
    ['human.reactionMeanMs', human({ reactionMeanMs: 25_000 })],
    ['human.reactionSdMs', human({ reactionSdMs: -1 })],
    ['human.reactionSdMs', human({ reactionSdMs: 25_000 })],
    ['human.reactionMinMs', human({ reactionMinMs: -1 })],
    ['human.reactionMinMs', human({ reactionMinMs: 25_000 })],
    [
      'human.readError.withChronoRing.offsetMs',
      readError('withChronoRing', { offsetMs: -25_000, sdMs: 60 }),
    ],
    [
      'human.readError.withoutChronoRing.offsetMs',
      readError('withoutChronoRing', { offsetMs: 25_000, sdMs: 60 }),
    ],
    ['human.aimOffsetMs', human({ aimOffsetMs: -25_000 })],
    ['human.jitterSdMs', human({ jitterSdMs: 25_000 })],
    [
      'human.readError.withChronoRing.offsetMs',
      readError('withChronoRing', { offsetMs: Infinity, sdMs: 60 }),
    ],
    ['human.readError.withChronoRing.sdMs', readError('withChronoRing', { offsetMs: 0, sdMs: -1 })],
    [
      'human.readError.withChronoRing.sdMs',
      readError('withChronoRing', { offsetMs: 0, sdMs: 2001 }),
    ],
    [
      'human.readError.withoutChronoRing.offsetMs',
      readError('withoutChronoRing', { offsetMs: Number.NaN, sdMs: 60 }),
    ],
    [
      'human.readError.withoutChronoRing.sdMs',
      readError('withoutChronoRing', { offsetMs: 0, sdMs: -1 }),
    ],
    [
      'human.readError.withoutChronoRing.sdMs',
      readError('withoutChronoRing', { offsetMs: 0, sdMs: 2001 }),
    ],
    ['human.aimOffsetMs', human({ aimOffsetMs: Number.POSITIVE_INFINITY })],
    ['human.jitterSdMs', human({ jitterSdMs: -1 })],
    ['human.missWhileBusyPct', human({ missWhileBusyPct: -1 })],
    ['human.missWhileBusyPct', human({ missWhileBusyPct: 100.5 })],
    ['human.missWhileBusyPct', human({ missWhileBusyPct: Number.NaN })],
  ])('refuses %s out of range, naming the key', (key, settings) => {
    const made = createBot('human', botSetup(1, settings));
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toContain(key);
  });

  it('accepts the edges of the human settings: 0 %, 100 % and the widest read error', () => {
    for (const patch of [
      { missWhileBusyPct: 0 },
      { missWhileBusyPct: 100 },
      { reactionSdMs: 0, reactionMinMs: 0 },
    ]) {
      expect(createBot('human', botSetup(1, human(patch))).ok).toBe(true);
    }
    expect(
      createBot(
        'human',
        botSetup(1, readError('withoutChronoRing', { offsetMs: -300, sdMs: 2000 })),
      ).ok,
    ).toBe(true);
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('refuses the seed %s', (seed) => {
    expect(createBot('perfect', botSetup(seed)).ok).toBe(false);
  });

  it('refuses a feel whose holdMinMs is not positive', () => {
    expect(createBot('perfect', { ...botSetup(1), holdMinMs: 0 }).ok).toBe(false);
  });
});
