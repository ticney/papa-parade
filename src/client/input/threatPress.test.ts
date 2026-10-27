import { describe, expect, it } from 'vitest';
import { createThreatPressTracker } from './threatPress.ts';

describe('createThreatPressTracker', () => {
  it('holds nothing at first', () => {
    const tracker = createThreatPressTracker();
    expect(tracker.heldThreatId).toBeNull();
    expect(tracker.released(1)).toBe(false);
    expect(tracker.releaseAll()).toBe(false);
  });

  it('is released by the pointer that pressed, once', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(7, 3);
    expect(tracker.heldThreatId).toBe(3);
    expect(tracker.released(7)).toBe(true);
    expect(tracker.heldThreatId).toBeNull();
    expect(tracker.released(7)).toBe(false);
  });

  it('ignores the release of another pointer and keeps the press', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(7, 3);
    expect(tracker.released(8)).toBe(false);
    expect(tracker.heldThreatId).toBe(3);
    expect(tracker.released(7)).toBe(true);
  });

  it('a new press replaces the old one: the first pointer no longer releases', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(7, 3);
    tracker.pressed(9, 4);
    expect(tracker.heldThreatId).toBe(4);
    expect(tracker.released(7)).toBe(false);
    expect(tracker.released(9)).toBe(true);
  });

  it('releaseAll releases a held press once (a pause), and nothing when none is held', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(7, 3);
    expect(tracker.releaseAll()).toBe(true);
    expect(tracker.releaseAll()).toBe(false);
    expect(tracker.released(7)).toBe(false);
  });

  it('forget drops the press without asking for a release', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(7, 3);
    tracker.forget();
    expect(tracker.heldThreatId).toBeNull();
    expect(tracker.released(7)).toBe(false);
    expect(tracker.releaseAll()).toBe(false);
  });

  it('accepts pointer id 0 (a mouse)', () => {
    const tracker = createThreatPressTracker();
    tracker.pressed(0, 1);
    expect(tracker.released(0)).toBe(true);
  });
});
