import type { Bot } from './bot.ts';

/** Never does anything: every threat ends late, and in a lullaby walk (story 4.5) the misses wake the baby. The reference for « the bot `idle` fails ». */
export function createIdleBot(): Bot {
  return {
    id: 'idle',
    act() {},
  };
}
