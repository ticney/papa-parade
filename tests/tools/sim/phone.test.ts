import { fileURLToPath } from 'node:url';
import { playGame } from '@bots/playGame';
import { PHONE_RINGING_EVERY_MS, STEP_MS } from '@shared/constants';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { makeBot } from '../../support/botSupport.ts';

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const SEEDS = [1, 2, 3];

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

// Story 1.20, AC 11: the live level, an idle player, the whole duration. The idle bot never sends
// `TapObject`, so the phone of wave 3 always rings out. Every bound is read from the live content
// and `STEP_MS`, never written as a literal.
describe('the phone of the live salon_crawler, with the idle bot', () => {
  async function play(seed: number) {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level } = loaded.value;
    const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
    const bot = makeBot('idle', {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: {},
      settings: content.bots,
    });
    const events: SimEvent[] = [];
    try {
      playGame(sim, bot, level.level.durationMs, (event) => events.push({ ...event }));
    } finally {
      sim.dispose();
    }
    return { events, level };
  }

  it.each(SEEDS)(
    'seed %i: rings once at the planned time inside wave 3, once a second, and gives up',
    async (seed) => {
      const { events, level } = await play(seed);
      const waveIndex = level.level.waves.findIndex((wave) => wave.disruptions.length > 0);
      expect(waveIndex, 'a wave plans the phone').toBeGreaterThanOrEqual(0);
      const wave = level.level.waves[waveIndex];
      const entry = wave?.disruptions[0] as { def: string; object: string; atMs: number };
      const def = level.disruptions[entry.def];
      if (def === undefined || wave === undefined) throw new Error('the phone def is not loaded');
      const waveEndMs = level.level.waves[waveIndex + 1]?.fromMs ?? level.level.durationMs;

      // Exactly one ring starts, at the first step at or after the planned time, inside the wave.
      const started = events.filter(
        (event): event is Of<'PhoneRingStarted'> => event.type === 'PhoneRingStarted',
      );
      expect(started).toHaveLength(1);
      const start = started[0] as Of<'PhoneRingStarted'>;
      expect(start.objectId).toBe(entry.object);
      expect(start.t).toBeGreaterThanOrEqual(entry.atMs);
      expect(start.t).toBeLessThan(entry.atMs + STEP_MS);
      expect(start.t).toBeGreaterThanOrEqual(wave.fromMs);
      expect(start.t).toBeLessThan(waveEndMs);
      expect(start.untilAt).toBe(start.t + def.ringMaxMs);

      // One PhoneRinging per period, the first one period after the start.
      const ticks = events.filter(
        (event): event is Of<'PhoneRinging'> => event.type === 'PhoneRinging',
      );
      expect(ticks).toHaveLength(Math.floor(def.ringMaxMs / PHONE_RINGING_EVERY_MS));
      ticks.forEach((tick, index) => {
        const previous = index === 0 ? start.t : (ticks[index - 1] as Of<'PhoneRinging'>).t;
        expect(tick.t - previous, `tick ${index + 1}`).toBe(PHONE_RINGING_EVERY_MS);
        expect(tick.objectId).toBe(entry.object);
      });

      // Nobody answers: it gives up at the start plus ringMaxMs, to the step.
      const ended = events.filter(
        (event): event is Of<'PhoneRingEnded'> => event.type === 'PhoneRingEnded',
      );
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({ reason: 'timedOut', objectId: entry.object });
      expect((ended[0] as Of<'PhoneRingEnded'>).t - (start.t + def.ringMaxMs)).toBeLessThan(
        STEP_MS,
      );
      expect((ended[0] as Of<'PhoneRingEnded'>).t).toBeGreaterThanOrEqual(start.untilAt);
      expect(events.some((event) => event.type === 'PhoneAnswered')).toBe(false);
      // The whole ring fits in the level: the last tick is before the end of the game.
      expect(start.untilAt).toBeLessThanOrEqual(level.level.durationMs);
    },
    60_000,
  );
});
