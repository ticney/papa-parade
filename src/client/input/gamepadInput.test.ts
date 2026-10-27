import { describe, expect, it } from 'vitest';
import { createGamepadInput, type GamepadLike, type StickAxes } from './gamepadInput.ts';

const pad = (x: number, y: number, connected = true): GamepadLike => ({
  connected,
  axes: [x, y, 0, 0],
});

function poll(pads: (GamepadLike | null | undefined)[]): StickAxes {
  const out: StickAxes = { x: 9, y: 9 };
  createGamepadInput(() => pads).poll(out);
  return out;
}

describe('createGamepadInput', () => {
  it('reads the left stick of the first connected pad', () => {
    expect(poll([pad(0.5, -0.25)])).toEqual({ x: 0.5, y: -0.25 });
  });

  it('skips empty slots and disconnected pads', () => {
    expect(poll([null, undefined, pad(1, 1, false), pad(-0.3, 0.8)])).toEqual({ x: -0.3, y: 0.8 });
  });

  it('is (0, 0) with no pad at all, and when the pad disappears', () => {
    expect(poll([])).toEqual({ x: 0, y: 0 });
    expect(poll([null, null])).toEqual({ x: 0, y: 0 });
    let pads: (GamepadLike | null)[] = [pad(0.9, 0)];
    const input = createGamepadInput(() => pads);
    const out: StickAxes = { x: 0, y: 0 };
    input.poll(out);
    expect(out.x).toBe(0.9);
    pads = [null];
    input.poll(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('ignores a pad that reports no stick, and a value that is not a number', () => {
    expect(poll([{ connected: true, axes: [] }, pad(0.4, 0.4)])).toEqual({ x: 0.4, y: 0.4 });
    expect(poll([pad(Number.NaN, Number.POSITIVE_INFINITY)])).toEqual({ x: 0, y: 0 });
  });

  it('asks for the pads at each poll and keeps none between two', () => {
    let calls = 0;
    const input = createGamepadInput(() => {
      calls++;
      return [pad(calls, 0)];
    });
    const out: StickAxes = { x: 0, y: 0 };
    input.poll(out);
    input.poll(out);
    expect(calls).toBe(2);
    expect(out.x).toBe(2);
  });
});
