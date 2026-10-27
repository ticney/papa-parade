import { describe, expect, it } from 'vitest';
import { type MenuStickMemory, stickToMenuStep } from './menuStep.ts';

const DEADZONE_PCT = 20;
const fresh = (): MenuStickMemory => ({ isActive: false });

describe('stickToMenuStep', () => {
  it.each([
    [{ x: 0.9, y: 0 }, 'right'],
    [{ x: -0.9, y: 0 }, 'left'],
    [{ x: 0, y: 0.9 }, 'down'],
    [{ x: 0, y: -0.9 }, 'up'],
    [{ x: 0.8, y: 0.5 }, 'right'],
    [{ x: 0.3, y: -0.7 }, 'up'],
  ] as const)('steps %j to %s on the edge of leaving the deadzone', (axes, expected) => {
    expect(stickToMenuStep(axes, fresh(), DEADZONE_PCT)).toBe(expected);
  });

  it('gives a tie between the axes to the horizontal one', () => {
    expect(stickToMenuStep({ x: 0.5, y: 0.5 }, fresh(), DEADZONE_PCT)).toBe('right');
    expect(stickToMenuStep({ x: -0.5, y: -0.5 }, fresh(), DEADZONE_PCT)).toBe('left');
  });

  it('steps once per push: a held stick repeats nothing, and a change of direction nothing either', () => {
    const memory = fresh();
    expect(stickToMenuStep({ x: 0, y: 0.9 }, memory, DEADZONE_PCT)).toBe('down');
    expect(stickToMenuStep({ x: 0, y: 0.9 }, memory, DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: 0, y: 1 }, memory, DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: 0.9, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
  });

  it('steps again after the stick returned to rest', () => {
    const memory = fresh();
    expect(stickToMenuStep({ x: 0.9, y: 0 }, memory, DEADZONE_PCT)).toBe('right');
    expect(stickToMenuStep({ x: 0, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: -0.9, y: 0 }, memory, DEADZONE_PCT)).toBe('left');
  });

  it('is inside the deadzone below its edge, and the edge itself is outside', () => {
    expect(stickToMenuStep({ x: 0.19, y: 0 }, fresh(), DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: 0.2, y: 0 }, fresh(), DEADZONE_PCT)).toBe('right');
  });

  it('keeps a stick that drifts just inside the deadzone pushed (hysteresis), and releases it lower', () => {
    const memory = fresh();
    expect(stickToMenuStep({ x: 0.25, y: 0 }, memory, DEADZONE_PCT)).toBe('right');
    // 0.18 is under the 20 % deadzone but over 80 % of it (0.16): still pushed, no new step.
    expect(stickToMenuStep({ x: 0.18, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: 0.25, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
    // Under 80 % of the deadzone: released; the next push steps.
    expect(stickToMenuStep({ x: 0.1, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
    expect(stickToMenuStep({ x: 0.25, y: 0 }, memory, DEADZONE_PCT)).toBe('right');
  });

  it('treats a stick that is not a number as at rest', () => {
    const memory = fresh();
    expect(stickToMenuStep({ x: Number.NaN, y: 0 }, memory, DEADZONE_PCT)).toBeNull();
    expect(memory.isActive).toBe(false);
  });
});
