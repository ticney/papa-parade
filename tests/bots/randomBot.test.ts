import { describe, expect, it } from 'vitest';
import { playBotGame, responses } from '../support/botSupport.ts';

describe('random bot', () => {
  it('over 20 games of 60 s with strict invariants: every command type, and a held press that is a gag', async () => {
    const types = new Set<string>();
    let wrongResponse = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { sim, events } = await playBotGame('random', seed);
      for (const entry of sim.journal().entries) types.add(entry.command.type);
      wrongResponse += responses(events).filter((r) => r.reason === 'wrongResponse').length;
    }
    for (const type of ['TapFloor', 'Move', 'MoveStop', 'PressThreat', 'Release']) {
      expect(types.has(type), type).toBe(true);
    }
    expect(wrongResponse).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('is deterministic per seed and varies with it', async () => {
    const a = (await playBotGame('random', 4)).sim.journal();
    const b = (await playBotGame('random', 4)).sim.journal();
    const c = (await playBotGame('random', 5)).sim.journal();
    expect(a).toEqual(b);
    expect(a.entries).not.toEqual(c.entries);
  });

  it('does nothing at 0 actions per second', async () => {
    const { sim } = await playBotGame('random', 1, {
      settings: { random: { actionsPerSec: 0, floorReachM: 3, maxHoldMs: 800 } },
    });
    expect(sim.journal().entries).toEqual([]);
  });
});
