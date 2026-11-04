import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import {
  BOT_TEST_UNTIL_MS,
  botTestLevel,
  botTrioLevel,
  playBotGame,
} from '../support/botSupport.ts';

// Story 3.14 AC 6: the frozen settings of `createTestBots()` (no reaction spread, the ring shown,
// `withChronoRing` at the old jitter, nobody inattentive) reduce the new human model to the one of
// before the story. These hashes were taken on the code BEFORE the change; they must never be
// regenerated to make a change pass, only if a later story changes the human bot on purpose.
const PINNED: Readonly<Record<'test' | 'trio', Readonly<Record<number, string>>>> = {
  test: { 1: '012275ee303326', 2: '031f2271eea72b', 3: '171950cfe8d377' },
  trio: { 1: '19146b77db2723', 2: '1c1e1a63ccfac4', 3: '0da6a71b615e45' },
};

describe('human bot, frozen settings (story 3.14 AC 6)', () => {
  for (const [name, level] of [
    ['test', botTestLevel],
    ['trio', botTrioLevel],
  ] as const) {
    for (const seed of [1, 2, 3]) {
      it(`plays the same game as before the story on the ${name} level, seed ${seed}`, async () => {
        const { sim } = await playBotGame('human', seed, {
          untilSimMs: BOT_TEST_UNTIL_MS,
          level: level(),
        });
        expect(hashJson(sim.journal())).toBe(PINNED[name][seed]);
      });
    }
  }
});
