import { fileURLToPath } from 'node:url';
import { botResponsesOf } from '@bots/botResponses';
import { playGame } from '@bots/playGame';
import { createSim, type MamaScore, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { computeMamaScore } from '../../../src/sim/scoring/mamaScore.ts';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { makeBot } from '../../support/botSupport.ts';

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const SEEDS = [1, 2, 3];
/** The live games last the level's whole duration: give them room (as in 1.18-1.21). */
const LIVE_TIMEOUT_MS = 120_000;

type Scored = Extract<SimEvent, { type: 'LevelScored' }>;

// Story 1.22, AC 7: the live level, to `LevelEnded`, three seeds, a perfect player and an idle one.
// Every bound is read from the live feel: Geo retunes the weights, the maxima and the thresholds.
describe('Mama’s note of the live salon_crawler', () => {
  async function play(bot: 'idle' | 'perfect', seed: number) {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level } = loaded.value;
    const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
    const made = makeBot(bot, {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      settings: content.bots,
    });
    const events: SimEvent[] = [];
    try {
      playGame(sim, made, level.level.durationMs, (event) => events.push({ ...event }));
      const { world } = sim;
      return {
        events,
        mama: content.feel.mama,
        final: world.score.final,
        perfects: world.score.perfects,
        expected: computeMamaScore(
          {
            perfects: world.score.perfects,
            nearMisses: world.score.nearMisses,
            comboPoints: world.score.comboPoints,
            propsOnFloor: world.mess.propsOnFloor,
            propsBroken: world.mess.propsBroken,
            mischiefs: world.mess.mischiefs,
          },
          content.feel.mama,
          false,
        ),
      };
    } finally {
      sim.dispose();
    }
  }

  const noteOf = ({ type: _type, t: _t, ...note }: Scored): MamaScore => note;

  const runs = new Map<string, Awaited<ReturnType<typeof play>>>();
  const runOf = async (bot: 'idle' | 'perfect', seed: number) => {
    const key = `${bot}:${seed}`;
    const cached = runs.get(key);
    if (cached !== undefined) return cached;
    const result = await play(bot, seed);
    runs.set(key, result);
    return result;
  };

  describe.each(['perfect', 'idle'] as const)('with the %s bot', (bot) => {
    it(
      'gives exactly one LevelScored, right after LevelEnded and at its t, equal to the note of the final world, whose rows add up',
      async () => {
        for (const seed of SEEDS) {
          const { events, mama, final, expected } = await runOf(bot, seed);
          const scored = events.filter((event): event is Scored => event.type === 'LevelScored');
          expect(scored, `seed ${seed}`).toHaveLength(1);
          const index = events.findIndex((event) => event.type === 'LevelScored');
          const ended = events[index - 1];
          expect(ended?.type, `seed ${seed}`).toBe('LevelEnded');
          expect(scored[0]?.t, `seed ${seed}`).toBe(ended?.t);
          const note = noteOf(scored[0] as Scored);
          expect(note, `seed ${seed}`).toEqual(expected);
          expect(final, `seed ${seed}`).toEqual(note);
          expect(note.scorePoints, `seed ${seed}`).toBe(
            note.laughPoints +
              note.babyStatePoints +
              (mama.sighMaxPoints - note.sighPoints) +
              (mama.screamMaxPoints - note.screamPoints),
          );
        }
      },
      LIVE_TIMEOUT_MS,
    );
  });

  it(
    'perfect: no sigh, no scream, and the laughs of its perfects',
    async () => {
      for (const seed of SEEDS) {
        const { mama, final, perfects } = await runOf('perfect', seed);
        expect(final?.sighPoints, `seed ${seed}`).toBe(0);
        expect(final?.screamPoints, `seed ${seed}`).toBe(0);
        expect(final?.laughPoints, `seed ${seed}`).toBe(
          Math.min(mama.laughMaxPoints, perfects * mama.laughPerPerfectPoints),
        );
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'idle: no laugh, and a lower mean score than perfect',
    async () => {
      let idleSum = 0;
      let perfectSum = 0;
      for (const seed of SEEDS) {
        const idle = await runOf('idle', seed);
        expect(idle.final?.laughPoints, `seed ${seed}`).toBe(0);
        idleSum += idle.final?.scorePoints ?? Number.NaN;
        perfectSum += (await runOf('perfect', seed)).final?.scorePoints ?? Number.NaN;
      }
      expect(idleSum / SEEDS.length).toBeLessThan(perfectSum / SEEDS.length);
    },
    LIVE_TIMEOUT_MS,
  );
});
