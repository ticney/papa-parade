import { hashJson } from '@shared/hash';
import type { SimLevel } from '../../tools/sim/loadSimLevel.ts';
import type { SimArgs } from '../../tools/sim/simArgs.ts';
import { botTestLevel } from './botSupport.ts';
import { createTestContent, createTestGeometry } from './testContent.ts';

/** The frozen living room with the outlet, loaded as the CLI would. */
export function createTestSimLevel(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: botTestLevel(),
    geometry: createTestGeometry(),
  };
}

export function simArgs(overrides: Partial<SimArgs> = {}): SimArgs {
  return {
    levelId: 'salon_crawler',
    botId: 'perfect',
    tier: 'normal',
    seed: 1,
    runs: 1,
    untilSimMs: 20_000,
    outPath: null,
    journalsDir: null,
    sequenceId: null,
    sequenceAtMs: 1000,
    help: false,
    ...overrides,
  };
}
