import { DIFFICULTY_TIER_IDS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { activeDifficulty } from './difficulty.ts';

const { feel } = createTestContent();
const asCtx = (value: typeof feel) => ({ feel: value }) as unknown as StepContext;
const worldAt = (tier: World['difficultyTier']) => ({ difficultyTier: tier }) as World;

describe('activeDifficulty (story 2.8)', () => {
  it.each(DIFFICULTY_TIER_IDS)('reads the %s entry of the feel', (tier) => {
    expect(activeDifficulty(worldAt(tier), asCtx(feel))).toBe(feel.difficulty[tier]);
  });

  it('follows a change of the feel (a level override, a live SetFeel on the active tier)', () => {
    const live = structuredClone(feel);
    live.difficulty.assistance.windowMultiplier = 2;
    expect(activeDifficulty(worldAt('assistance'), asCtx(live)).windowMultiplier).toBe(2);
    expect(activeDifficulty(worldAt('normal'), asCtx(live)).windowMultiplier).toBe(1);
  });

  it('gates the instinct: off at experienced, on otherwise (story 2.9 reads it here)', () => {
    for (const tier of DIFFICULTY_TIER_IDS) {
      expect(activeDifficulty(worldAt(tier), asCtx(feel)).hasInstinct).toBe(tier !== 'experienced');
    }
  });
});
