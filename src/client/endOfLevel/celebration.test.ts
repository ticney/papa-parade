import { EPIC_STAMP_MAX_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import { createCelebration } from './celebration.ts';

const SETTINGS = createTestFeedback().celebration;

function setup(fireworksEndAfterMs: number | null = 1400) {
  const calls: string[] = [];
  let fireworksEnd: number | null = null;
  const celebration = createCelebration({
    startFireworks: (settings, at, isReduced) => {
      calls.push(`fireworks ${settings.bursts.length} at ${at}${isReduced ? ' reduced' : ''}`);
      fireworksEnd = fireworksEndAfterMs === null ? null : at + fireworksEndAfterMs;
    },
    fireworksEndAtReal: () => fireworksEnd,
    stopFireworks: () => {
      calls.push('fireworks stopped');
      fireworksEnd = null;
    },
    stamp: {
      show: (durationMs, isReduced) => {
        calls.push(`stamp ${durationMs}${isReduced ? ' reduced' : ''}`);
        return true;
      },
      cancel: () => {
        calls.push('stamp cancelled');
      },
    },
  });
  return { celebration, calls };
}

describe('createCelebration (story 7.4)', () => {
  it('sets off the fireworks and the stamp at its start', () => {
    const { celebration, calls } = setup();
    celebration.start(SETTINGS, 1000, false);
    expect(calls).toEqual([`fireworks 2 at 1000`, `stamp ${SETTINGS.stampMs}`]);
  });

  it('passes reduced motion on to both', () => {
    const { celebration, calls } = setup();
    celebration.start(SETTINGS, 0, true);
    expect(calls).toEqual(['fireworks 2 at 0 reduced', `stamp ${SETTINGS.stampMs} reduced`]);
  });

  it('runs until its last spark dies, or its stamp ends, whichever is later', () => {
    const { celebration } = setup(1400);
    expect(celebration.isRunning(0)).toBe(false);
    celebration.start(SETTINGS, 1000, false);
    expect(celebration.endsAtReal).toBe(2400);
    expect(celebration.isRunning(2399)).toBe(true);
    expect(celebration.isRunning(2400)).toBe(false);
    const short = setup(100);
    short.celebration.start(SETTINGS, 1000, false);
    expect(short.celebration.endsAtReal).toBe(1000 + SETTINGS.stampMs);
  });

  it('keeps its stamp at or under EPIC_STAMP_MAX_MS', () => {
    const { celebration, calls } = setup(null);
    celebration.start({ ...SETTINGS, stampMs: 5000 }, 0, false);
    expect(calls[1]).toBe(`stamp ${EPIC_STAMP_MAX_MS}`);
    expect(celebration.endsAtReal).toBe(EPIC_STAMP_MAX_MS);
  });

  it('mutes the music for musicMuteMs from its start, then gives it back', () => {
    const { celebration } = setup();
    expect(celebration.isMusicMuted(500)).toBe(false);
    celebration.start(SETTINGS, 1000, false);
    expect(celebration.isMusicMuted(999)).toBe(false);
    expect(celebration.isMusicMuted(1000)).toBe(true);
    expect(celebration.isMusicMuted(1000 + SETTINGS.musicMuteMs - 1)).toBe(true);
    expect(celebration.isMusicMuted(1000 + SETTINGS.musicMuteMs)).toBe(false);
  });

  it('reset forgets it and cancels the stamp', () => {
    const { celebration, calls } = setup();
    celebration.start(SETTINGS, 1000, false);
    celebration.reset();
    expect(calls.slice(-2)).toEqual(['stamp cancelled', 'fireworks stopped']);
    expect(celebration.isRunning(1100)).toBe(false);
    expect(celebration.isMusicMuted(1100)).toBe(false);
    expect(celebration.endsAtReal).toBeNull();
  });
});
