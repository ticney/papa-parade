import { ISO_YAW_DEG } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  busyCycleAt,
  clipTimeScaleOf,
  papaFacingYawRad,
  stepSpeedMpsOf,
  turnToward,
  wrapAngleRad,
} from './characterMotion.ts';

const CLIPS = [{ clip: 'walk', speedMps: 3 }];

describe('stepSpeedMpsOf', () => {
  it('reads the last 10 ms step', () => {
    expect(stepSpeedMpsOf({ prevXM: 0, prevZM: 0, xM: 0.03, zM: 0.04 })).toBeCloseTo(5, 10);
    expect(stepSpeedMpsOf({ prevXM: 1, prevZM: 1, xM: 1, zM: 1 })).toBe(0);
  });
});

describe('clipTimeScaleOf', () => {
  it('is 1 for a clip that does not travel, and for one that stands still', () => {
    expect(clipTimeScaleOf('idle', 3, CLIPS)).toBe(1);
    expect(clipTimeScaleOf('walk', 0, CLIPS)).toBe(1);
  });

  it('goes in proportion to the floor speed, within its bounds', () => {
    expect(clipTimeScaleOf('walk', 3, CLIPS)).toBe(1);
    expect(clipTimeScaleOf('walk', 1.5, CLIPS)).toBe(0.5);
    expect(clipTimeScaleOf('walk', 0.01, CLIPS)).toBe(0.3);
    expect(clipTimeScaleOf('walk', 90, CLIPS)).toBe(2.5);
  });
});

describe('wrapAngleRad', () => {
  it('wraps to the half turn around 0', () => {
    expect(wrapAngleRad(0)).toBeCloseTo(0, 12);
    expect(wrapAngleRad(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(wrapAngleRad(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
  });
});

describe('turnToward', () => {
  it('goes by at most the rate, and lands exactly', () => {
    expect(turnToward(0, 1, 180, 100)).toBeCloseTo(Math.PI / 10, 12);
    expect(turnToward(0, 0.1, 180, 1000)).toBe(0.1);
  });

  it('holds on a dt of 0', () => {
    expect(turnToward(0.3, 2, 180, 0)).toBe(0.3);
  });

  it('takes the shortest arc across the half turn', () => {
    const from = 3;
    const to = -3;
    expect(turnToward(from, to, 180, 10)).toBeGreaterThan(from);
  });
});

describe('papaFacingYawRad (story 2.13, D5)', () => {
  const FACINGS = [
    { clip: 'drink', facing: 'camera' },
    { clip: 'on_phone', facing: 'awayFromBaby' },
  ] as const;
  const papa = { xM: 2, zM: 1 };
  const wandering = { xM: 0, zM: 1, state: 'wander' };

  it('faces the camera for a clip that says so, whatever the baby does', () => {
    const camera = (ISO_YAW_DEG * Math.PI) / 180;
    expect(papaFacingYawRad(papa, wandering, 'drink', FACINGS)).toBeCloseTo(camera, 12);
    const hiding = { ...wandering, state: 'mischiefSilent' };
    expect(papaFacingYawRad(papa, hiding, 'drink', FACINGS)).toBeCloseTo(camera, 12);
  });

  it('turns his back to the baby: the angle from the baby to Papa, 0 being +z and positive toward +x', () => {
    // Papa stands 2 m to the +x side of the baby, so away is +x.
    expect(papaFacingYawRad(papa, wandering, 'on_phone', FACINGS)).toBeCloseTo(Math.PI / 2, 12);
    expect(papaFacingYawRad({ xM: 0, zM: 3 }, wandering, 'on_phone', FACINGS)).toBeCloseTo(0, 12);
    expect(papaFacingYawRad({ xM: 0, zM: -3 }, wandering, 'on_phone', FACINGS)).toBeCloseTo(
      Math.PI,
      12,
    );
  });

  it('keeps his heading for a clip with no row, and with no clip', () => {
    expect(papaFacingYawRad(papa, wandering, 'idle', FACINGS)).toBeNull();
    expect(papaFacingYawRad(papa, wandering, null, FACINGS)).toBeNull();
    expect(papaFacingYawRad(papa, wandering, 'on_phone', [])).toBeNull();
  });

  it('keeps his heading when the baby is in his arms: there is nothing to turn from', () => {
    const carried = { ...wandering, state: 'carried' };
    expect(papaFacingYawRad(papa, carried, 'on_phone', FACINGS)).toBeNull();
  });

  it('keeps his heading when the baby is hiding: turning away from him would point at him', () => {
    const hiding = { ...wandering, state: 'mischiefSilent' };
    expect(papaFacingYawRad(papa, hiding, 'on_phone', FACINGS)).toBeNull();
  });

  it('keeps his heading when the baby is on top of him', () => {
    const onTop = { xM: 2.01, zM: 1.01, state: 'wander' };
    const near = { xM: 2.1, zM: 1, state: 'wander' };
    expect(papaFacingYawRad(papa, onTop, 'on_phone', FACINGS)).toBeNull();
    expect(papaFacingYawRad(papa, near, 'on_phone', FACINGS)).not.toBeNull();
  });
});

describe('busyCycleAt', () => {
  it('is one sine per period of the sim clock, and the same clock gives the same value', () => {
    expect(busyCycleAt(0, 800)).toBeCloseTo(0, 12);
    expect(busyCycleAt(200, 800)).toBeCloseTo(1, 12);
    expect(busyCycleAt(600, 800)).toBeCloseTo(-1, 12);
    expect(busyCycleAt(800, 800)).toBeCloseTo(0, 12);
    expect(busyCycleAt(123, 800)).toBe(busyCycleAt(123, 800));
  });
});
