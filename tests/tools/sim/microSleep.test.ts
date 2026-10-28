import { fileURLToPath } from 'node:url';
import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { botSetup, makeBot, responses } from '../../support/botSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
} from '../../support/testContent.ts';

type Telegraphed = Extract<SimEvent, { type: 'ThreatTelegraphed' }>;

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const SEEDS = [1, 2, 3, 4, 5];

// Story 1.19, epic AC 5: the live level, an idle player, the whole duration. Every bound is read
// from the live `feel.json` and the level, never written as a literal.
describe('the micro-sleeps of the live salon_crawler, with the idle bot', () => {
  async function play(seed: number) {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level, levelId } = loaded.value;
    const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
    const bot = makeBot('idle', {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: {},
      settings: content.bots,
    });
    const events: SimEvent[] = [];
    playGame(sim, bot, level.level.durationMs, (event) => events.push({ ...event }));
    sim.dispose();
    return { events, feel: content.feel.fatigue, levelId };
  }

  it.each(SEEDS)(
    'seed %i: none before the threshold, then one every 8 to 12 s',
    async (seed) => {
      const { events, feel } = await play(seed);
      const crossing = events.find(
        (event) => event.type === 'FatigueThresholdCrossed' && event.isAbove,
      );
      expect(crossing, 'fatigue crossed the threshold during the level').toBeDefined();
      const crossedAt = (crossing as { t: number }).t;
      const microSleeps = events.filter(
        (event): event is Telegraphed =>
          event.type === 'ThreatTelegraphed' && event.kind === 'papa_microsleep',
      );

      // None before the crossing, at least one overall, and each one is a threat no wave planned.
      expect(microSleeps.length).toBeGreaterThanOrEqual(1);
      for (const microSleep of microSleeps) {
        expect(microSleep.t).toBeGreaterThan(crossedAt);
        expect(microSleep.waveIndex).toBe(-1);
      }
      // The first, counted from the crossing; each next, from the previous telegraph.
      const first = (microSleeps[0] as Telegraphed).t;
      expect(first).toBeGreaterThanOrEqual(crossedAt + feel.microSleepMinMs);
      expect(first).toBeLessThanOrEqual(crossedAt + feel.microSleepMaxMs + STEP_MS);
      for (let i = 1; i < microSleeps.length; i++) {
        const gap = (microSleeps[i] as Telegraphed).t - (microSleeps[i - 1] as Telegraphed).t;
        expect(gap).toBeGreaterThanOrEqual(feel.microSleepMinMs);
        expect(gap).toBeLessThanOrEqual(feel.microSleepMaxMs + STEP_MS);
      }
    },
    60_000,
  );
});

describe('the perfect bot and the micro-sleeps', () => {
  it('resolves every micro-sleep of an exhausted Papa: no papa_asleep gag, no failure', async () => {
    const base = createTestContent();
    const content = {
      ...base,
      feel: { ...base.feel, fatigue: { ...base.feel.fatigue, startPoints: 90 } },
    };
    const seed = 11;
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({ gauges: FATIGUE_GAUGES }),
      seed,
      strictInvariants: true,
    });
    const bot = makeBot('perfect', botSetup(seed));
    const events: SimEvent[] = [];
    playGame(sim, bot, 70_000, (event) => events.push({ ...event }));
    const telegraphs = events.filter(
      (event) => event.type === 'ThreatTelegraphed' && event.kind === 'papa_microsleep',
    );
    expect(telegraphs.length).toBeGreaterThanOrEqual(5);
    const resolved = responses(events);
    expect(resolved).toHaveLength(telegraphs.length);
    expect(resolved.every((event) => event.quality === 'perfect')).toBe(true);
    expect(events.some((event) => event.type === 'GagTriggered')).toBe(false);
    expect(sim.world.papa.state).not.toBe('asleep');
    sim.dispose();
  }, 60_000);
});
