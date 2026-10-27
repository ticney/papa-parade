import type { SimLevel } from '../../tools/sim/loadSimLevel.ts';
import type { SimArgs } from '../../tools/sim/simArgs.ts';
import { botTestLevel } from './botSupport.ts';
import { createTestContent, createTestGeometry } from './testContent.ts';

/** The frozen living room with the outlet, loaded as the CLI would. */
export function createTestSimLevel(): SimLevel {
  return {
    levelId: 'salon_crawler',
    content: createTestContent(),
    level: botTestLevel(),
    geometry: createTestGeometry(),
  };
}

export function simArgs(overrides: Partial<SimArgs> = {}): SimArgs {
  return {
    levelId: 'salon_crawler',
    botId: 'perfect',
    seed: 1,
    runs: 1,
    untilSimMs: 20_000,
    outPath: null,
    journalsDir: null,
    help: false,
    ...overrides,
  };
}
