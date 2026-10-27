import { type Feel, FeelSchema } from '@content/schemas/feel';
import { cloneJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../tests/support/testContent.ts';
import { applyFeelPatch } from './feelPatch.ts';

const feel = (): Feel => createTestContent().feel;

describe('applyFeelPatch', () => {
  it('merges a nested patch onto the feel and keeps every other value', () => {
    const base = feel();
    const result = applyFeelPatch(base, {
      movement: { walkSpeedMps: 2 * base.movement.walkSpeedMps },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.movement.walkSpeedMps).toBe(2 * base.movement.walkSpeedMps);
    expect(result.value.movement.papaRadiusM).toBe(base.movement.papaRadiusM);
    expect(result.value.timing).toEqual(base.timing);
    expect(FeelSchema.safeParse(result.value).success).toBe(true);
  });

  it('does not mutate the feel it was given, nor share the patch objects', () => {
    const base = feel();
    const before = cloneJson(base);
    const patch = { timing: { windowMs: 500 } };
    const result = applyFeelPatch(base, patch);
    expect(base).toEqual(before);
    expect(result.ok && result.value.timing).not.toBe(base.timing);
    if (result.ok) expect(result.value.timing.windowMs).toBe(500);
  });

  it('replaces an array whole instead of merging it', () => {
    const result = applyFeelPatch(feel(), { mama: { starThresholdPoints: [5, 15, 25, 35, 45] } });
    expect(result.ok && result.value.mama.starThresholdPoints).toEqual([5, 15, 25, 35, 45]);
    // A merge by index would keep five values; a whole replacement is refused for its length.
    const short = applyFeelPatch(feel(), { mama: { starThresholdPoints: [5, 15] } });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.message).toContain('mama.starThresholdPoints');
  });

  it('refuses a key the schema does not know, naming its path', () => {
    const result = applyFeelPatch(feel(), { movement: { teleportMps: 3 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('movement');
      expect(result.error.message).toContain('teleportMps');
    }
  });

  it('refuses a value out of range, naming its path', () => {
    const result = applyFeelPatch(feel(), { timing: { windowMs: -1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('timing.windowMs');
  });

  it('refuses a patch that is not a plain object', () => {
    for (const patch of [null, 3, 'x', [1], undefined]) {
      expect(applyFeelPatch(feel(), patch).ok).toBe(false);
    }
  });

  it('refuses a scalar where the feel has an object', () => {
    const result = applyFeelPatch(feel(), { timing: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('timing');
  });

  it('accepts an empty patch: the same values', () => {
    const base = feel();
    const result = applyFeelPatch(base, {});
    expect(result.ok && result.value).toEqual(base);
  });
});
