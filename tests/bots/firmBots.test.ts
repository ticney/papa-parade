import { createBot } from '@bots/createBot';
import { createSim, type SimCommand } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  BOT_TEST_UNTIL_MS,
  botSetup,
  FIRM_HOLD_UNTIL_MS,
  firmBotLevel,
  playBotGame,
  responses,
} from '../support/botSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../support/testContent.ts';

// Story 1.23 AC 10: the perfect and human bots hold a Firmness down until the threat is answered,
// then let go; random is unchanged. Bounds come from the frozen feel and `firmBotLevel`.

const content = createTestContent();
const { holdMinMs } = content.feel.input;

describe('perfect bot on a Firmness', () => {
  it.each([1, 2, 3])('resolves the firm threat perfectly on seed %i', async (seed) => {
    const { events } = await playBotGame('perfect', seed, { level: firmBotLevel() });
    const answered = responses(events);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    for (const response of answered) {
      expect(response).toMatchObject({ response: 'firm', quality: 'perfect', offsetMs: 0 });
    }
    expect(events.filter((event) => event.type === 'GagTriggered')).toEqual([]);
  });

  it('keeps the finger down past holdMinMs, to the end of the attack, then sends one Release', async () => {
    const { sim, events } = await playBotGame('perfect', 1, { level: firmBotLevel() });
    const entries = sim.journal().entries;
    const presses = entries.filter((entry) => entry.command.type === 'PressThreat');
    const releases = entries.filter((entry) => entry.command.type === 'Release');
    expect(releases.length).toBe(presses.length);
    const resolved = responses(events);
    expect(resolved.length).toBe(presses.length);
    for (let i = 0; i < presses.length; i++) {
      const pressedAt = (presses[i] as (typeof presses)[number]).command.t;
      const releasedAt = (releases[i] as (typeof releases)[number]).command.t;
      const resolvedAt = (resolved[i] as (typeof resolved)[number]).t;
      expect(releasedAt - pressedAt).toBeGreaterThan(holdMinMs);
      expect(releasedAt).toBeGreaterThanOrEqual(resolvedAt);
      expect(resolvedAt - pressedAt).toBeGreaterThanOrEqual(FIRM_HOLD_UNTIL_MS - 300);
    }
  });

  it('is told what the level asks for, so a Parry level is still a tap', async () => {
    const { sim } = await playBotGame('perfect', 1);
    const commands: SimCommand[] = sim.journal().entries.map((entry) => entry.command);
    const press = commands.find((command) => command.type === 'PressThreat');
    const release = commands.find((command) => command.type === 'Release');
    expect(release && press ? release.t - press.t : Number.NaN).toBeLessThan(holdMinMs);
  });
});

describe('human bot on a Firmness', () => {
  it('with no jitter it is the perfect bot', async () => {
    const settings = { human: { reactionMs: 0, aimOffsetMs: 0, jitterSdMs: 0 } };
    const { events } = await playBotGame('human', 1, { level: firmBotLevel(), settings });
    const answered = responses(events);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    for (const response of answered) {
      expect(response).toMatchObject({ response: 'firm', quality: 'perfect' });
    }
  });

  it('mostly succeeds with its default settings, and never lets go early', async () => {
    const all = [];
    for (let seed = 0; seed < 20; seed++) {
      const { events } = await playBotGame('human', seed, { level: firmBotLevel() });
      all.push(...responses(events));
    }
    expect(all.filter((response) => response.reason === 'released')).toEqual([]);
    expect(all.filter((response) => response.reason === 'wrongResponse')).toEqual([]);
    expect(all.some((response) => response.quality !== 'fail')).toBe(true);
  }, 30_000);
});

describe('random bot on a Firmness', () => {
  it('still produces releases and wrong responses, as it holds longer than holdMinMs sometimes', async () => {
    const reasons = new Set<string | undefined>();
    for (let seed = 0; seed < 20; seed++) {
      const { events } = await playBotGame('random', seed, { level: firmBotLevel() });
      for (const response of responses(events)) reasons.add(response.reason);
    }
    // Its holds are not timed to the end of the attack: a Firmness never survives on luck alone here.
    expect(reasons.has('released') || reasons.has('wrongResponse')).toBe(true);
  }, 30_000);
});

describe('the one finger of a bot holding a Firmness', () => {
  it('presses no other threat while it holds', async () => {
    // Two threats at once: the outlet (a Firmness) and the stairs (a Parry), both planned from 0 ms.
    const base = createTestLevel({
      waves: [testWave([OUTLET, STAIRS], { maxSimultaneous: 2 })],
    });
    const outlet = base.threats.outlet;
    if (outlet === undefined) throw new Error('no outlet in the test level');
    const level = {
      ...base,
      threats: {
        ...base.threats,
        outlet: { ...outlet, response: 'firm' as const, holdUntilMs: 2500 },
      },
    };
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level,
      seed: 1,
      strictInvariants: true,
    });
    const bot = createBot('perfect', botSetup(1, {}, level));
    if (!bot.ok) throw new Error(bot.error.message);
    const out: SimCommand[] = [];
    let holding = false;
    const pressedDefs = new Set<string>();
    for (let i = 0; i < BOT_TEST_UNTIL_MS / 10; i++) {
      out.length = 0;
      bot.value.act(sim.world, out);
      for (const command of out) {
        if (command.type === 'PressThreat') {
          // A new press while a Firmness is down would let go of it (one finger).
          expect(holding, `press at ${command.t}`).toBe(false);
          const firm = sim.world.threats.find((threat) => threat.id === command.threatId);
          holding = firm?.defId === 'outlet';
          pressedDefs.add(firm?.defId ?? '?');
        } else if (command.type === 'Release') {
          holding = false;
        }
        sim.enqueue(command);
      }
      sim.step();
    }
    // The test is only worth something if both kinds of threat were answered in the game.
    expect([...pressedDefs].sort()).toEqual(['outlet', 'stairs']);
  });
});
