import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { asSimMs } from '@shared/time';
import { createSim, type SimCommand, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  botSetup,
  botTestLevel,
  botTrioLevel,
  makeBot,
  playBotGame,
  responses,
} from '../support/botSupport.ts';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// AC 6: 100 games, seeds 0 to 99. 40 s of sim time holds several outlet cycles (the outlet
// is planned from 4 s, a cycle is about 8 s; the story's Debug Log has the count). The headless sim runs millions of steps per second,
// so this stays well under the 10 s budget; the measured duration is in the story's Debug Log.
const GAMES = 100;
const UNTIL_MS = 40_000;

describe('perfect bot', () => {
  it('parries the outlet perfectly in 100 games, at least once per game, with no gag', async () => {
    for (let seed = 0; seed < GAMES; seed++) {
      const { events } = await playBotGame('perfect', seed, { untilSimMs: UNTIL_MS });
      const outlet = responses(events);
      expect(outlet.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (const response of outlet) {
        expect(response.quality, `seed ${seed}`).toBe('perfect');
        expect(response.offsetMs, `seed ${seed}`).toBe(0);
      }
      expect(
        events.filter((event) => event.type === 'GagTriggered'),
        `seed ${seed}`,
      ).toEqual([]);
    }
  }, 30_000);

  it('parries all three threats of the prototype perfectly over 60 s, each def at least once', async () => {
    for (const seed of [0, 1, 2, 3, 4]) {
      const { events } = await playBotGame('perfect', seed, { level: botTrioLevel() });
      const kindOf = new Map<number, string>();
      for (const event of events) {
        if (event.type === 'ThreatTelegraphed') kindOf.set(event.threatId, event.kind);
      }
      const resolved = responses(events);
      for (const response of resolved) {
        expect(response.quality, `seed ${seed}`).toBe('perfect');
        expect(response.offsetMs, `seed ${seed}`).toBe(0);
      }
      const answered = new Set(resolved.map((response) => kindOf.get(response.threatId)));
      expect([...answered].sort(), `seed ${seed}`).toEqual([
        'coffee_table_object',
        'outlet',
        'stairs',
      ]);
      expect(
        events.filter((event) => event.type === 'GagTriggered' || event.type === 'NearMiss'),
        `seed ${seed}`,
      ).toEqual([]);
    }
  });

  it('presses once per cycle, each followed by one release', async () => {
    const { sim, events } = await playBotGame('perfect', 5, { untilSimMs: UNTIL_MS });
    const commands = sim.journal().entries.map((entry) => entry.command);
    const presses = commands.filter((command) => command.type === 'PressThreat');
    const releases = commands.filter((command) => command.type === 'Release');
    expect(presses.length).toBe(responses(events).length);
    expect(releases.length).toBe(presses.length);
    expect(commands.length).toBe(presses.length + releases.length);
  });

  it('created mid-window, presses at once and is judged on that instant', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
      strictInvariants: true,
    });
    // Past the window's centre (telegraph 1200 ms + half a window), still inside it plus tolerance.
    while (sim.world.threats[0]?.state !== 'windowOpen') sim.step();
    const threat = sim.world.threats[0];
    if (threat === undefined || threat.responseWindow === null) throw new Error('no window');
    const centre = threat.windowOpenAt + threat.responseWindow.windowMs / 2;
    while (sim.world.time.sim <= centre) sim.step();
    sim.drainEvents();
    const now = sim.world.time.sim;
    const out: SimCommand[] = [];
    makeBot('perfect', botSetup(1)).act(sim.world, out);
    expect(out[0]).toEqual({ type: 'PressThreat', t: asSimMs(now), threatId: threat.id });
    const events: SimEvent[] = [];
    playGame(sim, makeBot('perfect', botSetup(1)), now + 1000, (event) => events.push(event));
    const resolved = responses(events);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.offsetMs).toBe(now - centre);
  });

  it('leaves alone a threat whose def it has no response for', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 2,
      strictInvariants: true,
    });
    const created = createBot('perfect', { ...botSetup(2), responses: {} });
    if (!created.ok) throw new Error(created.error.message);
    playGame(sim, created.value, 30_000);
    expect(sim.journal().entries).toEqual([]);
  });
});
