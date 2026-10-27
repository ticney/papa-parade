import { describe, expect, it } from 'vitest';
import { botTrioLevel, playBotGame, responses } from '../support/botSupport.ts';

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

  it('lets all three threats gag over 60 s: one GagTriggered of each gag, and a NearMiss', async () => {
    const { sim, events } = await playBotGame('idle', 3, { level: botTrioLevel() });
    expect(sim.journal().entries).toEqual([]);
    const gags = new Set(
      events.flatMap((event) => (event.type === 'GagTriggered' ? [event.gag] : [])),
    );
    expect([...gags].sort()).toEqual(['outlet_hair', 'stairs_slide', 'table_object_fall']);
    const nearMisses = events.filter((event) => event.type === 'NearMiss');
    expect(nearMisses.length).toBeGreaterThanOrEqual(1);
    for (const nearMiss of nearMisses) expect(nearMiss.gag).toBe('stairs_slide');
  });
});
