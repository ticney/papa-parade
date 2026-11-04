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
// Story 9.2: the hash is the game's (the journal without `feelHash` and `levelHash`), since a feel key
// or a level field the sim never reads moves those two and nothing the bot does. Taken from the 3.14
// pins, not regenerated: with the pre-9.2 content hashes put back, each journal hashed to its 3.14 pin
// (`test` 012275ee303326, 031f2271eea72b, 171950cfe8d377; `trio` 19146b77db2723, 1c1e1a63ccfac4,
// 0da6a71b615e45), and these are the same journals with the two content hashes left out.
const PINNED: Readonly<Record<'test' | 'trio', Readonly<Record<number, string>>>> = {
  test: { 1: '18a907af7cd6a0', 2: '1130997142ba01', 3: '18ff6a084aa87a' },
  trio: { 1: '0a016e25c7fe89', 2: '11b47d4e76dcd0', 3: '0f2b759509bf38' },
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
        const { feelHash: _feelHash, levelHash: _levelHash, ...game } = sim.journal();
        expect(hashJson(game)).toBe(PINNED[name][seed]);
      });
    }
  }
});
