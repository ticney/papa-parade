import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { isNoiseAlertCrossing } from './noiseAlert.ts';

const ALERT = 80;
const changed = (noisePct: number, deltaPct: number): SimEvent => ({
  type: 'NoiseChanged',
  t: asSimMs(100),
  source: 'propImpact',
  noisePct,
  deltaPct,
});

describe('isNoiseAlertCrossing', () => {
  it('is true on an upward crossing: from below to above the threshold', () => {
    expect(isNoiseAlertCrossing(changed(85, 10), ALERT)).toBe(true);
  });

  it('is true from exactly the threshold to above it, and false when the value only reaches it', () => {
    expect(isNoiseAlertCrossing(changed(81, 1), ALERT)).toBe(true);
    expect(isNoiseAlertCrossing(changed(80, 5), ALERT)).toBe(false);
  });

  it('is false while already above, and while still below', () => {
    expect(isNoiseAlertCrossing(changed(90, 5), ALERT)).toBe(false);
    expect(isNoiseAlertCrossing(changed(70, 5), ALERT)).toBe(false);
  });

  it('is false on a fall, even one that ends below after starting above', () => {
    expect(isNoiseAlertCrossing(changed(75, -10), ALERT)).toBe(false);
    expect(isNoiseAlertCrossing(changed(85, -2), ALERT)).toBe(false);
  });

  it('fires again on the next upward crossing, after a fall below', () => {
    const rise = changed(90, 15);
    expect(isNoiseAlertCrossing(rise, ALERT)).toBe(true);
    expect(isNoiseAlertCrossing(changed(60, -30), ALERT)).toBe(false);
    expect(isNoiseAlertCrossing(rise, ALERT)).toBe(true);
  });

  it('counts the debug source (SetNoise to 90 from 0)', () => {
    const debug: SimEvent = { ...(changed(90, 90) as object), source: 'debug' } as SimEvent;
    expect(isNoiseAlertCrossing(debug, ALERT)).toBe(true);
  });

  it('reads the threshold it is given', () => {
    expect(isNoiseAlertCrossing(changed(55, 10), 50)).toBe(true);
    expect(isNoiseAlertCrossing(changed(55, 10), 60)).toBe(false);
  });

  it('is false for any other event', () => {
    expect(isNoiseAlertCrossing({ type: 'BabyCrying', t: asSimMs(0) }, ALERT)).toBe(false);
  });
});
