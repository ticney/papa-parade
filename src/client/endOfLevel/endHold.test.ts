import { describe, expect, it } from 'vitest';
import { createEndHold, END_HOLD_FRAME_CAP_MS } from './endHold.ts';

const FRAME_MS = 16;

/** Runs frames from `fromReal` every 16 ms while `isHolding(now)`; the frame the end runs on, or null. */
function runFrames(
  hold: ReturnType<typeof createEndHold>,
  fromReal: number,
  frames: number,
  isHolding: (nowReal: number) => boolean,
): number | null {
  for (let i = 0; i < frames; i++) {
    const now = fromReal + i * FRAME_MS;
    if (hold.frame(now, isHolding(now))) return now;
  }
  return null;
}

describe('createEndHold (story 7.4, D3)', () => {
  it('ends at once with nothing to wait for: the end of the level as before', () => {
    const hold = createEndHold();
    expect(hold.request(false, 4000)).toBe('now');
    expect(hold.isPending).toBe(false);
    expect(hold.request(true, 0)).toBe('now');
    expect(hold.frame(0, true)).toBe(false);
  });

  it('waits while the celebration runs, and ends on the first frame it does not', () => {
    const hold = createEndHold();
    expect(hold.request(true, 4000)).toBe('held');
    expect(hold.isPending).toBe(true);
    const endedAt = runFrames(hold, 0, 400, (now) => now < 1000);
    expect(endedAt).toBe(1008);
    expect(hold.isPending).toBe(false);
    // Once only.
    expect(hold.frame(2000, false)).toBe(false);
  });

  it('never waits past its cap, even if the celebration claims to run on', () => {
    const hold = createEndHold();
    hold.request(true, 1000);
    const endedAt = runFrames(hold, 0, 400, () => true);
    expect(endedAt).not.toBeNull();
    expect(hold.heldMs).toBeGreaterThanOrEqual(1000);
    expect(endedAt as number).toBeLessThanOrEqual(1000 + FRAME_MS);
  });

  it('a hidden tab holds the wait: a long gap between two frames counts for one capped frame', () => {
    const hold = createEndHold();
    hold.request(true, 1000);
    expect(hold.frame(0, true)).toBe(false);
    // Thirty seconds in the background, then the page is back.
    expect(hold.frame(30_000, true)).toBe(false);
    expect(hold.heldMs).toBe(END_HOLD_FRAME_CAP_MS);
  });

  it('clear drops the wait: the end it held never runs', () => {
    const hold = createEndHold();
    hold.request(true, 1000);
    hold.clear();
    expect(hold.isPending).toBe(false);
    expect(runFrames(hold, 0, 200, () => false)).toBeNull();
  });
});
