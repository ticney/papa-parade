import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { applyFeelPatch } from './applyFeelPatch.ts';

const feel = createTestContent().feel;
const firstKind = Object.keys(feel.physics.kinds)[0] as string;

describe('applyFeelPatch (the sim’s own merge)', () => {
  it('lays a leaf over the feel and leaves the other leaves alone', () => {
    const next = applyFeelPatch(feel, { timing: { windowMs: feel.timing.windowMs + 50 } });
    expect(next).not.toBeNull();
    expect(next?.timing.windowMs).toBe(feel.timing.windowMs + 50);
    expect(next?.timing.perfectMs).toBe(feel.timing.perfectMs);
    expect(next?.input).toEqual(feel.input);
  });

  it('never changes the feel it was given, and shares no object with it', () => {
    const before = structuredClone(feel);
    const next = applyFeelPatch(feel, { timing: { windowMs: feel.timing.windowMs + 1 } });
    expect(feel).toEqual(before);
    expect(next?.movement).not.toBe(feel.movement);
    expect(next?.mama.starThresholdPoints).not.toBe(feel.mama.starThresholdPoints);
  });

  it('merges nested objects key by key, down to a physics kind', () => {
    const kind = feel.physics.kinds[firstKind] as { massKg: number };
    const next = applyFeelPatch(feel, {
      physics: { kinds: { [firstKind]: { massKg: kind.massKg + 1 } } },
    });
    const merged = next?.physics.kinds[firstKind] as { massKg: number };
    expect(merged.massKg).toBe(kind.massKg + 1);
    expect(next?.physics.kinds[firstKind]).toEqual({ ...kind, massKg: kind.massKg + 1 });
  });

  it('gives an array whole, of the same length and item types', () => {
    const thresholds = feel.mama.starThresholdPoints.map((points) => points + 1);
    const next = applyFeelPatch(feel, { mama: { starThresholdPoints: thresholds } });
    expect(next?.mama.starThresholdPoints).toEqual(thresholds);
    expect(applyFeelPatch(feel, { mama: { starThresholdPoints: thresholds.slice(1) } })).toBeNull();
    expect(
      applyFeelPatch(feel, { mama: { starThresholdPoints: thresholds.map(String) } }),
    ).toBeNull();
  });

  it('accepts an empty patch as the same feel, copied', () => {
    const next = applyFeelPatch(feel, {});
    expect(next).toEqual(feel);
    expect(next).not.toBe(feel);
  });

  it('refuses an unknown key at any depth', () => {
    expect(applyFeelPatch(feel, { nothing: 1 })).toBeNull();
    expect(applyFeelPatch(feel, { timing: { nothingMs: 1 } })).toBeNull();
    expect(applyFeelPatch(feel, { physics: { kinds: { nothing: { massKg: 1 } } } })).toBeNull();
  });

  it('refuses a leaf of another type, a scalar for an object and an object for a scalar', () => {
    expect(applyFeelPatch(feel, { timing: { windowMs: '300' } })).toBeNull();
    expect(applyFeelPatch(feel, { timing: 5 })).toBeNull();
    expect(applyFeelPatch(feel, { timing: { windowMs: { a: 1 } } })).toBeNull();
    expect(applyFeelPatch(feel, { timing: { windowMs: null } })).toBeNull();
    expect(applyFeelPatch(feel, { timing: null })).toBeNull();
    expect(applyFeelPatch(feel, 'timing')).toBeNull();
    expect(applyFeelPatch(feel, [])).toBeNull();
  });

  it('refuses the keys that reach the prototype, and the patch changes nothing then', () => {
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}');
    expect(applyFeelPatch(feel, polluted)).toBeNull();
    expect(applyFeelPatch(feel, { timing: { constructor: 1 } })).toBeNull();
    expect(applyFeelPatch(feel, { timing: { prototype: 1 } })).toBeNull();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});
