import { describe, expect, it } from 'vitest';
import { playBotGame, responses } from '../support/botSupport.ts';

const NO_JITTER = { reactionMs: 0, aimOffsetMs: 0, jitterSdMs: 0 };

async function outletOf(seed: number, human: Partial<typeof NO_JITTER>) {
  const { events } = await playBotGame('human', seed, {
    untilSimMs: 40_000,
    settings: { human: { ...NO_JITTER, ...human } as typeof NO_JITTER & { aimOffsetMs: number } },
  });
  return responses(events);
}

describe('human bot', () => {
  it('with no reaction time, no offset and no jitter, it is the perfect bot', async () => {
    for (let seed = 0; seed < 10; seed++) {
      const outlet = await outletOf(seed, {});
      expect(outlet.length).toBeGreaterThanOrEqual(1);
      for (const response of outlet) expect(response.quality).toBe('perfect');
    }
  });

  it('too slow to react, every response is late', async () => {
    // Longer than the telegraph, the half window and the tolerance of the frozen feel.
    const outlet = await outletOf(1, { reactionMs: 5000 });
    expect(outlet.length).toBeGreaterThanOrEqual(1);
    for (const response of outlet) {
      expect(response.quality).toBe('fail');
      expect(response.reason).toBe('late');
    }
  });

  it('aiming far too early, every response is early', async () => {
    const outlet = await outletOf(1, { aimOffsetMs: -1000 });
    expect(outlet.length).toBeGreaterThanOrEqual(1);
    for (const response of outlet) {
      expect(response.quality).toBe('fail');
      expect(response.reason).toBe('early');
    }
  });

  it('with the default settings it mixes perfect and success, and never holds a wrong press', async () => {
    const all = [];
    for (let seed = 0; seed < 50; seed++) {
      const { events } = await playBotGame('human', seed, { untilSimMs: 40_000 });
      all.push(...responses(events));
    }
    expect(all.some((response) => response.quality === 'perfect')).toBe(true);
    expect(all.some((response) => response.quality === 'success')).toBe(true);
    expect(all.some((response) => response.reason === 'wrongResponse')).toBe(false);
  }, 30_000);

  it('does not play the same game for two seeds', async () => {
    const a = (await playBotGame('human', 1, { untilSimMs: 40_000 })).sim.journal();
    const b = (await playBotGame('human', 2, { untilSimMs: 40_000 })).sim.journal();
    expect(a.entries).not.toEqual(b.entries);
  });
});
