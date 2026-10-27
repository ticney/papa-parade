import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createShake } from './shake.ts';

describe('createShake', () => {
  it('leaves the target at zero before it starts and before its time', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.update(100);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
    shake.start(0.1, 200, 1000);
    shake.update(900);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
  });

  it('offsets the target during the shake, never past the amplitude, and decaying', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 400, 0);
    let peakEarly = 0;
    let peakLate = 0;
    for (let clock = 10; clock < 400; clock += 10) {
      shake.update(clock);
      const offset = Math.max(Math.abs(target.position.x), Math.abs(target.position.z));
      expect(offset).toBeLessThanOrEqual(0.1);
      if (clock < 200) peakEarly = Math.max(peakEarly, offset);
      else peakLate = Math.max(peakLate, offset);
    }
    expect(peakEarly).toBeGreaterThan(0);
    expect(peakLate).toBeLessThan(peakEarly);
  });

  it('is back to exactly zero at the end, and stays there', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 200, 0);
    shake.update(100);
    expect(target.position.x).not.toBe(0);
    shake.update(200);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
    shake.update(250);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
  });

  it('is deterministic: the same clock gives the same offset', () => {
    const run = () => {
      const target = new Object3D();
      const shake = createShake(target);
      shake.start(0.2, 300, 50);
      shake.update(173);
      return [target.position.x, target.position.z];
    };
    expect(run()).toEqual(run());
  });

  it('replaces the shake under way when a new one starts', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.5, 1000, 0);
    shake.update(100);
    shake.start(0.01, 1000, 100);
    shake.update(350);
    expect(Math.max(Math.abs(target.position.x), Math.abs(target.position.z))).toBeLessThanOrEqual(
      0.01,
    );
  });
});
