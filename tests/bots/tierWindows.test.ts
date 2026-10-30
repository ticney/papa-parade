import { DIFFICULTY_TIER_IDS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { playBotGame, responses } from '../support/botSupport.ts';

// Story 2.8, AC 6: what reads a threat's window needs no change for a tier. The bots aim at the
// middle of `responseWindow` (`bots/threatTiming.ts`), so a perfect bot stays perfect whatever the
// window the tier gave. Literals on purpose (base 300 of the frozen feel): 450 / 300 / 225.
const WINDOW_MS = { assistance: 450, normal: 300, experienced: 225 } as const;
const GAMES = 20;
const UNTIL_MS = 40_000;

describe.each(DIFFICULTY_TIER_IDS)('the perfect bot at the %s tier', (tier) => {
  it('parries the outlet perfectly, with no gag, in a window of the tier’s length', async () => {
    for (let seed = 0; seed < GAMES; seed++) {
      const { events } = await playBotGame('perfect', seed, { untilSimMs: UNTIL_MS, tier });
      const resolved = responses(events);
      expect(resolved.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (const response of resolved) {
        expect(response.quality, `seed ${seed}`).toBe('perfect');
        // The middle of a 225 ms window is on a half ms: the bot presses on the whole one next to it.
        expect(Math.abs(response.offsetMs ?? 99), `seed ${seed}`).toBeLessThanOrEqual(0.5);
        expect(response.responseWindow.windowMs, `seed ${seed}`).toBeCloseTo(WINDOW_MS[tier], 9);
      }
      expect(
        events.filter((event) => event.type === 'GagTriggered'),
        `seed ${seed}`,
      ).toEqual([]);
    }
  }, 30_000);
});
