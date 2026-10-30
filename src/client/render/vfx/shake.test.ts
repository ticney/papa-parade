import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createShake } from './shake.ts';

const FREQUENCY_HZ = 14;

describe('createShake (real time)', () => {
  it('leaves the target at zero before it starts and before its time', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.update(100);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
    shake.start(0.1, 200, FREQUENCY_HZ, 1000);
    shake.update(900);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
  });

  it('offsets the target during the shake, never past the amplitude, and decaying', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 400, FREQUENCY_HZ, 0);
    let peakEarly = 0;
    let peakLate = 0;
    for (let nowReal = 5; nowReal < 400; nowReal += 5) {
      shake.update(nowReal);
      const offset = Math.max(Math.abs(target.position.x), Math.abs(target.position.z));
      expect(offset).toBeLessThanOrEqual(0.1);
      if (nowReal < 200) peakEarly = Math.max(peakEarly, offset);
      else peakLate = Math.max(peakLate, offset);
    }
    expect(peakEarly).toBeGreaterThan(0);
    expect(peakLate).toBeLessThan(peakEarly);
  });

  it('wobbles at the asked frequency, whatever the duration', () => {
    const crossings = (durationMs: number) => {
      const target = new Object3D();
      const shake = createShake(target);
      shake.start(0.1, durationMs, FREQUENCY_HZ, 0);
      let count = 0;
      let last = 0;
      for (let nowReal = 1; nowReal < 250; nowReal += 1) {
        shake.update(nowReal);
        const sign = Math.sign(target.position.x);
        if (sign !== 0 && last !== 0 && sign !== last) count++;
        if (sign !== 0) last = sign;
      }
      return count;
    };
    // 250 ms at 14 Hz: a zero every 35.7 ms, the 7th would fall at 250 ms: 6 crossings, short or long.
    expect(crossings(400)).toBe(6);
    expect(crossings(1000)).toBe(6);
  });

  it('moves while the sim clock stands still: it is driven by the real clock alone', () => {
    const target = new Object3D();
    const shake = createShake(target);
    // The hitstop: 80 real ms during which the sim clock does not advance. The shake still moves.
    shake.start(0.05, 200, FREQUENCY_HZ, 1000);
    shake.update(1020);
    const first = target.position.x;
    shake.update(1060);
    expect(first).not.toBe(0);
    expect(target.position.x).not.toBe(first);
    expect(shake.offsetM.x).toBe(target.position.x);
  });

  it('is back to exactly zero at the end, and stays there', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 200, FREQUENCY_HZ, 0);
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
      shake.start(0.2, 300, FREQUENCY_HZ, 50);
      shake.update(173);
      return [target.position.x, target.position.z];
    };
    expect(run()).toEqual(run());
  });

  it('replaces the shake under way when a new one starts', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.5, 1000, FREQUENCY_HZ, 0);
    shake.update(100);
    shake.start(0.01, 1000, FREQUENCY_HZ, 100);
    shake.update(350);
    expect(Math.max(Math.abs(target.position.x), Math.abs(target.position.z))).toBeLessThanOrEqual(
      0.01,
    );
  });

  it('takes its offset off when the clock is before its start (a clock that went back)', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 400, FREQUENCY_HZ, 0);
    shake.update(100);
    expect(target.position.x).not.toBe(0);
    shake.update(-50);
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
  });

  it('reset ends the shake under way and puts the target back at once', () => {
    const target = new Object3D();
    const shake = createShake(target);
    shake.start(0.1, 400, FREQUENCY_HZ, 0);
    shake.update(100);
    shake.reset();
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
    shake.update(150); // it is over: nothing moves again
    expect([target.position.x, target.position.z]).toEqual([0, 0]);
  });
});
