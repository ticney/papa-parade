import { fileURLToPath } from 'node:url';
import { botResponsesOf } from '@bots/botResponses';
import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { makeBot } from '../../support/botSupport.ts';

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const SEEDS = [1, 2, 3];

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

// Story 1.21, AC 12: the live level, the whole duration, three seeds, an idle player and a perfect
// one. Every bound is read from the live content, the live feel and `STEP_MS`, never written as a
// literal: Geo retunes all of them.
describe('the suspicious silence of the live salon_crawler', () => {
  async function play(bot: 'idle' | 'perfect', seed: number) {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level } = loaded.value;
    const def = level.threats.silence_mischief;
    if (def?.target !== 'hiddenZone') throw new Error('the level does not plan the silence');
    const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
    const made = makeBot(bot, {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      settings: content.bots,
    });
    const events: SimEvent[] = [];
    // The instant each silence's babble stopped, read from the world at the step that announced it.
    const zoneEnteredAt = new Map<number, number>();
    try {
      playGame(sim, made, level.level.durationMs, (event) => {
        events.push({ ...event });
        if (event.type === 'SilenceStarted') {
          zoneEnteredAt.set(event.t, sim.world.silence.zoneEnteredAt ?? Number.NaN);
        }
      });
    } finally {
      sim.dispose();
    }
    return {
      events,
      def,
      feel: content.feel,
      zoneEnteredAt,
      durationMs: level.level.durationMs,
      tapMs: content.bots.tapMs,
    };
  }

  /**
   * The silences of a run, each with the events of its cycle: from its `ThreatHidden` to the next
   * one (the silence threat is one instance, re-armed after each cycle).
   */
  const cyclesOf = (events: readonly SimEvent[]) => {
    const picks = events.flatMap((event, index) =>
      event.type === 'ThreatHidden' && event.kind === 'silence_mischief' ? [index] : [],
    );
    return picks.map((from, i) => ({
      hidden: events[from] as Of<'ThreatHidden'>,
      cycle: events.slice(from, picks[i + 1] ?? events.length),
    }));
  };

  describe.each(['idle', 'perfect'] as const)('with the %s bot', (bot) => {
    it('hides at least one silence over the three seeds, and each goes: mischiefSilent, then SilenceStarted silenceAlertMs after the zone entry', async () => {
      let total = 0;
      for (const seed of SEEDS) {
        const { events, feel, zoneEnteredAt } = await play(bot, seed);
        const cycles = cyclesOf(events);
        total += cycles.length;
        for (const { hidden, cycle } of cycles) {
          const started = ofType(cycle, 'SilenceStarted');
          // A silence hidden in the last seconds of the level may never start; the others do.
          if (started.length === 0) continue;
          expect(started, `seed ${seed}`).toHaveLength(1);
          const startedAt = (started[0] as Of<'SilenceStarted'>).t;
          const silent = ofType(cycle, 'BabyStateChanged').find(
            (event) => event.to === 'mischiefSilent',
          );
          expect(silent, `seed ${seed}: the baby hides`).toBeDefined();
          expect((silent as Of<'BabyStateChanged'>).t).toBeGreaterThanOrEqual(hidden.t);
          expect((silent as Of<'BabyStateChanged'>).t).toBeLessThanOrEqual(startedAt);
          expect(startedAt - (zoneEnteredAt.get(startedAt) as number), `seed ${seed}`).toBe(
            feel.baby.silenceAlertMs,
          );
        }
      }
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  it('with the idle bot, nobody finds the baby: SilenceEnded{timedOut} at startedAt + findMaxMs, then a surprise gag', async () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { events, def } = await play('idle', seed);
      for (const { hidden, cycle } of cyclesOf(events)) {
        const [start] = ofType(cycle, 'SilenceStarted');
        const ended = ofType(cycle, 'SilenceEnded');
        // One that started in the last seconds of the level has no end in the run.
        if (start === undefined || ended.length === 0) continue;
        expect(ended).toHaveLength(1);
        expect(ended[0]).toMatchObject({ reason: 'timedOut', t: start.t + def.findMaxMs });
        const gag = ofType(cycle, 'GagTriggered').filter((e) => e.threatId === hidden.threatId);
        expect(gag).toHaveLength(1);
        expect(def.surpriseGags).toContain((gag[0] as Of<'GagTriggered'>).gag);
        expect(gag[0]?.t).toBe(start.t + def.findMaxMs);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it('with the perfect bot, the baby is found within one step of SilenceStarted and the threat is parried perfectly', async () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { events, def, feel, durationMs, tapMs } = await play('perfect', seed);
      for (const { hidden, cycle } of cyclesOf(events)) {
        const [start] = ofType(cycle, 'SilenceStarted');
        const ended = ofType(cycle, 'SilenceEnded');
        if (start === undefined || ended.length === 0) continue;
        expect(ended[0]?.reason, `seed ${seed}`).toBe('found');
        expect((ended[0]?.t ?? 0) - start.t).toBeLessThanOrEqual(STEP_MS);
        const resolved = ofType(cycle, 'ResponseResolved').filter(
          (e) => e.threatId === hidden.threatId,
        );
        // A silence found so late that the level ends before the parry resolves has no result: the
        // perfect press (the window's centre, then `tapMs`) would have come after the end.
        const foundAt = ended[0]?.t ?? 0;
        const resolvesAt =
          foundAt +
          (def.telegraphDelayMs ?? feel.timing.telegraphDelayDefaultMs) +
          (def.windowMs ?? feel.timing.windowMs) / 2 +
          tapMs;
        if (resolved.length === 0) {
          expect(
            resolvesAt,
            `seed ${seed}: cut short by the end of the level`,
          ).toBeGreaterThanOrEqual(durationMs);
          continue;
        }
        expect(resolved, `seed ${seed}`).toEqual([
          expect.objectContaining({ quality: 'perfect', threatId: hidden.threatId }),
        ]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
  });
});
