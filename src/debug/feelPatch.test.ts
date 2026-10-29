import { type Feel, FeelSchema } from '@content/schemas/feel';
import { cloneJson } from '@shared/hash';
import type { Sim } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../tests/support/testContent.ts';
import { applyFeelPatch, effectiveFeel, layFeelPatch } from './feelPatch.ts';

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

  it('refuses a new key of a record, which the schema accepts and the sim drops', () => {
    const base = feel();
    const [kind] = Object.values(base.physics.kinds);
    // The schema alone accepts it...
    expect(
      FeelSchema.safeParse({
        ...base,
        physics: { ...base.physics, kinds: { ...base.physics.kinds, new_kind: kind } },
      }).success,
    ).toBe(true);
    // ...this check does not, and names the path.
    const result = applyFeelPatch(base, { physics: { kinds: { new_kind: kind } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('physics.kinds.new_kind');
  });

  it('still accepts a change inside an existing record entry', () => {
    const base = feel();
    const name = Object.keys(base.physics.kinds)[0] as string;
    const result = applyFeelPatch(base, { physics: { kinds: { [name]: { massKg: 3 } } } });
    expect(result.ok && result.value.physics.kinds[name]?.massKg).toBe(3);
  });

  it('refuses a key that reaches the prototype, and a leaf of another type or an array of another length', () => {
    const base = feel();
    expect(applyFeelPatch(base, JSON.parse('{"timing":{"__proto__":{"x":1}}}')).ok).toBe(false);
    expect(applyFeelPatch(base, { timing: { windowMs: '300' } }).ok).toBe(false);
    expect(applyFeelPatch(base, { mama: { starThresholdPoints: [1, 2, 3] } }).ok).toBe(false);
  });
});

describe('layFeelPatch', () => {
  it('lays a patch that fits, whatever its values, and leaves the feel alone', () => {
    const base = feel();
    const before = cloneJson(base);
    // Out of range: the sim would still apply it, so what is queued is folded as it is.
    const laid = layFeelPatch(base, { timing: { windowMs: -5 } });
    expect(laid.timing.windowMs).toBe(-5);
    expect(laid.timing.perfectMs).toBe(base.timing.perfectMs);
    expect(base).toEqual(before);
  });

  it('returns the feel itself for a patch the sim would drop', () => {
    const base = feel();
    expect(layFeelPatch(base, { timing: { nope: 1 } })).toBe(base);
    expect(layFeelPatch(base, null)).toBe(base);
  });
});

describe('effectiveFeel', () => {
  /** A sim reduced to what `effectiveFeel` reads: the world and the journal. */
  const fakeSim = (
    world: { feel: Feel; simMs: number; flow?: 'playing' | 'ended' },
    entries: { applyAt: number; command: object }[],
  ): Sim =>
    ({
      world: {
        feel: world.feel,
        time: { sim: world.simMs },
        flow: { state: world.flow ?? 'playing' },
      },
      journal: () => ({ entries }),
    }) as unknown as Sim;

  it('is the world feel when nothing is queued', () => {
    const base = feel();
    expect(effectiveFeel(fakeSim({ feel: base, simMs: 100 }, []))).toBe(base);
  });

  it('lays the SetFeels due after the sim time, in applyAt then enqueue order, and skips the applied ones', () => {
    const base = feel();
    const sim = fakeSim({ feel: base, simMs: 100 }, [
      // Already applied (at or before the sim time): world.feel has it.
      { applyAt: 100, command: { type: 'SetFeel', t: 90, patch: { timing: { windowMs: 1 } } } },
      // Queued, enqueued first but due later: applied last.
      { applyAt: 120, command: { type: 'SetFeel', t: 110, patch: { timing: { windowMs: 222 } } } },
      { applyAt: 110, command: { type: 'SetFeel', t: 105, patch: { timing: { windowMs: 111 } } } },
      { applyAt: 110, command: { type: 'SetFeel', t: 105, patch: { timing: { perfectMs: 55 } } } },
      // Not a SetFeel.
      { applyAt: 110, command: { type: 'PressThreat', t: 105 } },
    ]);
    const effective = effectiveFeel(sim);
    expect(effective.timing.windowMs).toBe(222);
    expect(effective.timing.perfectMs).toBe(55);
    expect(effective.movement).toEqual(base.movement);
    expect(base.timing.windowMs).not.toBe(222);
  });

  it('skips a queued patch the sim would drop (its shape is wrong)', () => {
    const base = feel();
    const sim = fakeSim({ feel: base, simMs: 0 }, [
      { applyAt: 10, command: { type: 'SetFeel', t: 0, patch: { timing: { nope: 1 } } } },
      { applyAt: 10, command: { type: 'SetFeel', t: 0, patch: { timing: { windowMs: 250 } } } },
    ]);
    expect(effectiveFeel(sim).timing.windowMs).toBe(250);
  });

  it('ignores the queue once the level has ended: the sim applies nothing then', () => {
    const base = feel();
    const sim = fakeSim({ feel: base, simMs: 100, flow: 'ended' }, [
      { applyAt: 110, command: { type: 'SetFeel', t: 100, patch: { timing: { windowMs: 250 } } } },
    ]);
    expect(effectiveFeel(sim)).toBe(base);
  });
});
