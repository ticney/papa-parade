import type { Bot } from './bot.ts';

/** Never does anything: every threat ends late. The reference for « the bot `idle` fails ». */
export function createIdleBot(): Bot {
  return {
    id: 'idle',
    act() {},
  };
}
