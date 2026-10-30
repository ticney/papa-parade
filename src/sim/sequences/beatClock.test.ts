import { describe, expect, it } from 'vitest';
import type { EffectiveWindow } from '../timing/effectiveWindow.ts';
import {
  type BeatTimelineStep,
  beatTimelineOf,
  classifyTap,
  judgedBeatCountOf,
  nextJudgedEntryIndex,
} from './beatClock.ts';

// A frozen step, in the shape of `content/sequences/lullaby_walk.json` (the live values may move).
const STEP: BeatTimelineStep = {
  durationMs: 40_000,
  bpmStart: 90,
  bpmEnd: 60,
  leadInMs: 1200,
  countInBeats: 4,
  windowMs: 180,
  decoyBeats: [7, 15, 23, 31, 38],
};

/** A window with no buffer, as the sim keeps it: ±90 ms around the beat, ±30 ms perfect, 20 ms tolerance. */
const WINDOW: EffectiveWindow = { windowMs: 180, perfectMs: 60, toleranceMs: 20, bufferMs: 0 };
const BEAT_AT = 10_000;

describe('beatTimelineOf', () => {
  const timeline = beatTimelineOf(STEP);

  it('starts at the lead-in, with the count-in first', () => {
    expect(timeline[0]).toEqual({ offsetMs: 1200, kind: 'countIn', judgedIndex: -1 });
    expect(timeline.slice(0, 4).map((entry) => entry.kind)).toEqual([
      'countIn',
      'countIn',
      'countIn',
      'countIn',
    ]);
    expect(timeline[4]).toMatchObject({ kind: 'beat', judgedIndex: 0 });
  });

  it('opens at 90 BPM: the first gap is 667 ms', () => {
    expect((timeline[1]?.offsetMs ?? 0) - (timeline[0]?.offsetMs ?? 0)).toBe(667);
  });

  it('slows down: the gaps never shrink and grow towards 1000 ms', () => {
    const beats = timeline.filter((entry) => entry.kind !== 'decoy');
    const gaps = beats.slice(1).map((entry, i) => entry.offsetMs - (beats[i]?.offsetMs ?? 0));
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i], `gap ${i}`).toBeGreaterThanOrEqual(gaps[i - 1] ?? 0);
    }
    expect(gaps[gaps.length - 1]).toBeGreaterThan(900);
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(1000);
  });

  it('has whole offsets, sorted', () => {
    for (const [i, entry] of timeline.entries()) {
      expect(Number.isInteger(entry.offsetMs), `entry ${i}`).toBe(true);
      if (i > 0) expect(entry.offsetMs).toBeGreaterThan(timeline[i - 1]?.offsetMs ?? 0);
    }
  });

  it('keeps every window inside the step: offsetMs + windowMs <= durationMs', () => {
    for (const entry of timeline) {
      expect(entry.offsetMs + STEP.windowMs).toBeLessThanOrEqual(STEP.durationMs);
    }
    const last = timeline[timeline.length - 1];
    // The next beat would not fit (otherwise the timeline stopped early).
    expect((last?.offsetMs ?? 0) + 1000 + STEP.windowMs).toBeGreaterThan(STEP.durationMs);
  });

  it('numbers the judged beats from 0, the count-in excluded', () => {
    const beats = timeline.filter((entry) => entry.kind === 'beat');
    expect(beats.map((entry) => entry.judgedIndex)).toEqual(beats.map((_, i) => i));
    expect(judgedBeatCountOf(timeline)).toBe(beats.length);
    expect(beats.length).toBeGreaterThan(40);
  });

  it('puts a decoy halfway between its beat and the next, named by the beat it follows', () => {
    const decoys = timeline.filter((entry) => entry.kind === 'decoy');
    expect(decoys.map((entry) => entry.judgedIndex)).toEqual([7, 15, 23, 31, 38]);
    for (const decoy of decoys) {
      const before = timeline.find(
        (entry) => entry.kind === 'beat' && entry.judgedIndex === decoy.judgedIndex,
      );
      const after = timeline.find(
        (entry) => entry.kind === 'beat' && entry.judgedIndex === decoy.judgedIndex + 1,
      );
      expect(decoy.offsetMs).toBe(
        Math.round(((before?.offsetMs ?? 0) + (after?.offsetMs ?? 0)) / 2),
      );
    }
  });

  it('leaves out a decoy that has no next judged beat', () => {
    const count = judgedBeatCountOf(timeline);
    const outside = beatTimelineOf({ ...STEP, decoyBeats: [count - 1, count + 5] });
    expect(outside.some((entry) => entry.kind === 'decoy')).toBe(false);
  });

  it('has no judged beat when the count-in swallows them all, or when nothing fits', () => {
    expect(judgedBeatCountOf(beatTimelineOf({ ...STEP, countInBeats: 500 }))).toBe(0);
    expect(beatTimelineOf({ ...STEP, durationMs: 1000 })).toEqual([]);
  });

  it('holds a steady tempo when both are equal', () => {
    const steady = beatTimelineOf({ ...STEP, bpmStart: 60, bpmEnd: 60, decoyBeats: [] });
    for (let i = 1; i < steady.length; i++) {
      expect((steady[i]?.offsetMs ?? 0) - (steady[i - 1]?.offsetMs ?? 0)).toBe(1000);
    }
  });

  it('does not divide by a step that ends before its lead-in', () => {
    expect(beatTimelineOf({ ...STEP, durationMs: 1200, leadInMs: 1500 })).toEqual([]);
  });
});

describe('nextJudgedEntryIndex', () => {
  const timeline = beatTimelineOf(STEP);

  it('skips the count-in and the decoys', () => {
    expect(nextJudgedEntryIndex(timeline, 0)).toBe(4);
    const decoyIndex = timeline.findIndex((entry) => entry.kind === 'decoy');
    expect(timeline[nextJudgedEntryIndex(timeline, decoyIndex)]?.kind).toBe('beat');
  });

  it('returns the length when no beat is left', () => {
    expect(nextJudgedEntryIndex(timeline, timeline.length)).toBe(timeline.length);
  });
});

describe('classifyTap', () => {
  it('hits on the beat, and anywhere in the window and its tolerance', () => {
    expect(classifyTap(BEAT_AT, BEAT_AT, null, WINDOW, false)).toBe('hit');
    expect(classifyTap(BEAT_AT - 110, BEAT_AT, null, WINDOW, false)).toBe('hit');
    expect(classifyTap(BEAT_AT + 110, BEAT_AT, null, WINDOW, false)).toBe('hit');
  });

  it('calls a tap late for the beat a miss: it settles the beat', () => {
    expect(classifyTap(BEAT_AT + 111, BEAT_AT, null, WINDOW, false)).toBe('miss');
  });

  it('calls a tap between two windows a stray', () => {
    expect(classifyTap(BEAT_AT - 111, BEAT_AT, null, WINDOW, false)).toBe('stray');
    expect(classifyTap(BEAT_AT - 400, BEAT_AT, null, WINDOW, false)).toBe('stray');
  });

  it('lets a tap before the first judged beat go free: the lead-in and the count-in', () => {
    expect(classifyTap(BEAT_AT - 400, BEAT_AT, null, WINDOW, true)).toBe('free');
    expect(classifyTap(BEAT_AT - 111, BEAT_AT, null, WINDOW, true)).toBe('free');
    // The free ride ends where the window starts, and it is no excuse for a late tap.
    expect(classifyTap(BEAT_AT - 110, BEAT_AT, null, WINDOW, true)).toBe('hit');
    expect(classifyTap(BEAT_AT + 111, BEAT_AT, null, WINDOW, true)).toBe('miss');
  });

  it('taps a decoy when the tap is on it and the decoy is still there', () => {
    const decoyAt = BEAT_AT - 340;
    expect(classifyTap(decoyAt, BEAT_AT, decoyAt, WINDOW, false)).toBe('decoy');
    expect(classifyTap(decoyAt + 50, BEAT_AT, decoyAt, WINDOW, false)).toBe('decoy');
  });

  it('calls a tap on a spent decoy (decoyAt null) a stray', () => {
    expect(classifyTap(BEAT_AT - 340, BEAT_AT, null, WINDOW, false)).toBe('stray');
  });

  it('gives an overlap to the nearer centre, and a tie to the beat (a wide tier)', () => {
    const wide: EffectiveWindow = { windowMs: 480, perfectMs: 60, toleranceMs: 20, bufferMs: 0 };
    const decoyAt = BEAT_AT - 340;
    // Both windows hold the instant halfway: a tie, so the beat.
    expect(classifyTap(BEAT_AT - 170, BEAT_AT, decoyAt, wide, false)).toBe('hit');
    expect(classifyTap(BEAT_AT - 171, BEAT_AT, decoyAt, wide, false)).toBe('decoy');
    expect(classifyTap(BEAT_AT - 169, BEAT_AT, decoyAt, wide, false)).toBe('hit');
  });

  it('judges with the window it is given, no buffer of its own', () => {
    const buffered: EffectiveWindow = { ...WINDOW, bufferMs: 100 };
    // The same press is early without a buffer, and kept with one: the sim passes bufferMs 0.
    expect(classifyTap(BEAT_AT - 150, BEAT_AT, null, WINDOW, false)).toBe('stray');
    expect(classifyTap(BEAT_AT - 150, BEAT_AT, null, buffered, false)).toBe('hit');
  });
});
