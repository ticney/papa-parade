import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { effectiveWindow, type WindowModifiers } from './effectiveWindow.ts';

const { timing } = createTestContent().feel;
const NEUTRAL: WindowModifiers = { tier: 1, fatigue: 1, instinct: 1 };

describe('effectiveWindow', () => {
  it('keeps the base window and passes the tolerance and the buffer through', () => {
    expect(effectiveWindow(timing, 300, NEUTRAL)).toEqual({
      windowMs: 300,
      perfectMs: timing.perfectMs,
      toleranceMs: timing.toleranceMs,
      bufferMs: timing.bufferMs,
    });
  });

  it('takes the base it is given (a threat can declare its own window)', () => {
    expect(effectiveWindow(timing, 500, NEUTRAL).windowMs).toBe(500);
  });

  it.each([
    ['the tier', { tier: 1.5, fatigue: 1, instinct: 1 }, 450],
    ['the fatigue', { tier: 1, fatigue: 0.8, instinct: 1 }, 240],
    ['the instinct', { tier: 1, fatigue: 1, instinct: 1.3 }, 390],
  ])('scales the window by %s alone', (_name, modifiers, windowMs) => {
    expect(effectiveWindow(timing, 300, modifiers).windowMs).toBeCloseTo(windowMs, 9);
  });

  it('multiplies the three together, tier then fatigue then instinct', () => {
    const modifiers: WindowModifiers = { tier: 1.5, fatigue: 0.8, instinct: 1.3 };
    expect(effectiveWindow(timing, 300, modifiers).windowMs).toBe(300 * 1.5 * 0.8 * 1.3);
  });

  it('never leaves the tolerance and the buffer to the modifiers', () => {
    const shrunk = effectiveWindow(timing, 300, { tier: 0.5, fatigue: 0.5, instinct: 0.5 });
    expect(shrunk.toleranceMs).toBe(timing.toleranceMs);
    expect(shrunk.bufferMs).toBe(timing.bufferMs);
  });

  it('caps the perfect zone at the shrunk window', () => {
    const tiny = effectiveWindow(timing, 300, { tier: 0.1, fatigue: 1, instinct: 1 });
    expect(tiny.windowMs).toBeCloseTo(30, 9);
    expect(tiny.perfectMs).toBe(tiny.windowMs);
    expect(effectiveWindow(timing, 300, NEUTRAL).perfectMs).toBe(timing.perfectMs);
  });
});
