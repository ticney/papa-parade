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
//
// Story 3.15 re-pinned the whole-journal hashes: the journal's header carries the hashes of the feel and
// of the level, and the feel lost `fatigue.asleepMs` while every threat gained its `afterEffect`. The
// commands themselves did not move: `PINNED_COMMANDS` are the hashes of `journal.entries` taken on the code
// BEFORE the story (`main` at 5572c36), and still hold. The frozen levels meet no downstairs baby, so the
// new fetch draw never runs.
// Story 3.16 re-pinned them again, for the same reason: the feel gained `catastrophe` and the tiers'
// `catastropheMultiplier`, every threat gained its `catastrophe`. `PINNED_COMMANDS` still hold.
//
// Story 9.2 re-pinned them again, for the same reason: the feel gained `camera` and the level its
// `camera` field, which the sim never reads. `PINNED_COMMANDS` were not touched and still hold.
//
// Story 3.7 re-pinned them once more, for the same reason: the feel gained `mama.laughPerLookPartPoints`,
// which moves the feel hash in the journal's header. `PINNED_COMMANDS` still hold.
//
// Story 7.8 re-pinned them once more, for the same reason: the feel gained `characters` (the client's
// life layer and look), which the sim never reads. `PINNED_COMMANDS` were not touched and still hold.
const PINNED: Readonly<Record<'test' | 'trio', Readonly<Record<number, string>>>> = {
  test: { 1: '07303bf89ec0b1', 2: '14148e8e97f2e1', 3: '17b154e6f39563' },
  trio: { 1: '14db7edb4cfeed', 2: '1c1e22ae34b04c', 3: '192c5e347e26ee' },
};
const PINNED_COMMANDS: Readonly<Record<'test' | 'trio', Readonly<Record<number, string>>>> = {
  test: { 1: '0632f181689687', 2: '158358e075a1a2', 3: '111636e2c690a2' },
  trio: { 1: '1f13d096e14190', 2: '0dcf36b7fba7c5', 3: '045e0bb9041d03' },
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
        const journal = sim.journal();
        expect(hashJson(journal.entries)).toBe(PINNED_COMMANDS[name][seed]);
        expect(hashJson(journal)).toBe(PINNED[name][seed]);
      });
    }
  }
});
