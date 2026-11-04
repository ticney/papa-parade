import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { isCatastropheAlertCrossing } from './catastropheAlert.ts';

const ALERT = 70;
const changed = (catastrophePct: number, deltaPct: number, source = 'nearMiss'): SimEvent =>
  ({
    type: 'CatastropheChanged',
    t: asSimMs(100),
    source,
    catastrophePct,
    deltaPct,
  }) as SimEvent;

describe('isCatastropheAlertCrossing', () => {
  it('is true on an upward crossing: from below to above the threshold', () => {
    expect(isCatastropheAlertCrossing(changed(75, 35), ALERT)).toBe(true);
    expect(isCatastropheAlertCrossing(changed(100, 40), ALERT)).toBe(true);
  });

  it('is true from exactly the threshold to above it, and false when the value only reaches it', () => {
    expect(isCatastropheAlertCrossing(changed(71, 1), ALERT)).toBe(true);
    expect(isCatastropheAlertCrossing(changed(70, 20), ALERT)).toBe(false);
  });

  it('is false while already above, and while still below', () => {
    expect(isCatastropheAlertCrossing(changed(90, 5), ALERT)).toBe(false);
    expect(isCatastropheAlertCrossing(changed(55, 35), ALERT)).toBe(false);
  });

  it('is false on a fall: a perfect that takes it back under, or down from above', () => {
    expect(isCatastropheAlertCrossing(changed(65, -5, 'perfect'), ALERT)).toBe(false);
    expect(isCatastropheAlertCrossing(changed(80, -5, 'perfect'), ALERT)).toBe(false);
  });

  it('follows a gauge over a game: one alert per upward crossing, again after a fall below', () => {
    // The gauge's own moves, in order: 50 → 80 (up), → 90 (already above), → 60 (a perfect, down),
    // → 75 (up again), → 100 (already above).
    const moves: Array<[SimEvent, boolean]> = [
      [changed(80, 30), true],
      [changed(90, 10), false],
      [changed(60, -30, 'perfect'), false],
      [changed(75, 15), true],
      [changed(100, 25), false],
    ];
    expect(moves.map(([event]) => isCatastropheAlertCrossing(event, ALERT))).toEqual(
      moves.map(([, expected]) => expected),
    );
  });

  it('counts the debug source (SetCatastrophe to 75 from 0)', () => {
    expect(isCatastropheAlertCrossing(changed(75, 75, 'debug'), ALERT)).toBe(true);
  });

  it('reads the threshold it is given', () => {
    expect(isCatastropheAlertCrossing(changed(55, 10), 50)).toBe(true);
    expect(isCatastropheAlertCrossing(changed(55, 10), 60)).toBe(false);
  });

  it('ignores every other event, including the noise gauge’s', () => {
    const noise = {
      type: 'NoiseChanged',
      t: asSimMs(100),
      source: 'propImpact',
      noisePct: 90,
      deltaPct: 20,
    } as SimEvent;
    expect(isCatastropheAlertCrossing(noise, ALERT)).toBe(false);
    expect(isCatastropheAlertCrossing({ type: 'MamaWoke', t: asSimMs(100) }, ALERT)).toBe(false);
  });
});
