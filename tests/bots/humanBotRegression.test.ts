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
const PINNED: Readonly<Record<'test' | 'trio', Readonly<Record<number, string>>>> = {
  test: { 1: '0eef6a84dbdeef', 2: '116eeb5926c8bc', 3: '0efdd049575cfe' },
  trio: { 1: '1dd455ba059672', 2: '1269d0a3d4b0e3', 3: '106b107f02d736' },
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
