import { BOT_IDS } from '@bots/bot';
import { createBot } from '@bots/createBot';
import { describe, expect, it } from 'vitest';
import { botSetup } from '../support/botSupport.ts';

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
    ['a negative reaction time', { human: { reactionMs: -1, aimOffsetMs: 0, jitterSdMs: 0 } }],
    [
      'an infinite aim offset',
      { human: { reactionMs: 0, aimOffsetMs: Number.POSITIVE_INFINITY, jitterSdMs: 0 } },
    ],
    ['a negative jitter', { human: { reactionMs: 0, aimOffsetMs: 0, jitterSdMs: -1 } }],
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

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('refuses the seed %s', (seed) => {
    expect(createBot('perfect', botSetup(seed)).ok).toBe(false);
  });

  it('refuses a feel whose holdMinMs is not positive', () => {
    expect(createBot('perfect', { ...botSetup(1), holdMinMs: 0 }).ok).toBe(false);
  });
});
