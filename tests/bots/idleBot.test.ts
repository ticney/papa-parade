import { describe, expect, it } from 'vitest';
import { playBotGame, responses } from '../support/botSupport.ts';

describe('idle bot', () => {
  it('sends nothing: the journal has no entry, and every outlet ends late', async () => {
    const { sim, events } = await playBotGame('idle', 3);
    expect(sim.journal().entries).toEqual([]);
    const outlet = responses(events);
    expect(outlet.length).toBeGreaterThanOrEqual(1);
    for (const response of outlet) {
      expect(response.quality).toBe('fail');
      expect(response.reason).toBe('late');
    }
  });
});
