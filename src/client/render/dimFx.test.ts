import { describe, expect, it } from 'vitest';
import { createDimFx } from './dimFx.ts';

const LIGHTS_PCT = 40;
const FADE_MS = 400;

describe('createDimFx', () => {
  it('is at full light until the sim says the room is dim', () => {
    const dim = createDimFx();
    expect(dim.update(false, 0, LIGHTS_PCT, FADE_MS)).toBe(1);
    expect(dim.update(false, 5000, LIGHTS_PCT, FADE_MS)).toBe(1);
  });

  it('fades to lightsPct in fadeMs on the sim clock, and stays', () => {
    const dim = createDimFx();
    dim.update(true, 1000, LIGHTS_PCT, FADE_MS);
    // Half the fade: half the way down.
    expect(dim.update(true, 1000 + FADE_MS / 2, LIGHTS_PCT, FADE_MS)).toBeCloseTo(
      1 - ((1 - LIGHTS_PCT / 100) * 1) / 2,
      9,
    );
    expect(dim.update(true, 1000 + FADE_MS, LIGHTS_PCT, FADE_MS)).toBeCloseTo(LIGHTS_PCT / 100, 9);
    // Never below it, however long.
    expect(dim.update(true, 60_000, LIGHTS_PCT, FADE_MS)).toBe(LIGHTS_PCT / 100);
  });

  it('comes back to full light in fadeMs once the room is not dim', () => {
    const dim = createDimFx();
    dim.update(true, 0, LIGHTS_PCT, FADE_MS);
    dim.update(true, 10_000, LIGHTS_PCT, FADE_MS);
    const half = dim.update(false, 10_000 + FADE_MS / 2, LIGHTS_PCT, FADE_MS);
    expect(half).toBeGreaterThan(LIGHTS_PCT / 100);
    expect(half).toBeLessThan(1);
    expect(dim.update(false, 10_000 + FADE_MS * 2, LIGHTS_PCT, FADE_MS)).toBe(1);
  });

  it('is held by a clock that does not move (a pause or a hitstop) and ignores one that steps back', () => {
    const dim = createDimFx();
    dim.update(true, 1000, LIGHTS_PCT, FADE_MS);
    const mid = dim.update(true, 1100, LIGHTS_PCT, FADE_MS);
    expect(dim.update(true, 1100, LIGHTS_PCT, FADE_MS)).toBe(mid);
    expect(dim.update(true, 1050, LIGHTS_PCT, FADE_MS)).toBe(mid);
  });

  it('jumps at once with a fadeMs of 0, and reads the feel every call', () => {
    const dim = createDimFx();
    expect(dim.update(true, 0, 25, 0)).toBe(0.25);
    expect(dim.update(true, 10, 60, 0)).toBe(0.6);
    expect(dim.update(false, 20, 60, 0)).toBe(1);
  });

  it('is back at full light and forgets its clock on reset', () => {
    const dim = createDimFx();
    dim.update(true, 0, LIGHTS_PCT, FADE_MS);
    dim.update(true, 5000, LIGHTS_PCT, FADE_MS);
    dim.reset();
    // A first call after the reset has no elapsed time: it does not jump.
    expect(dim.update(true, 90_000, LIGHTS_PCT, FADE_MS)).toBe(1);
  });
});
