import type { ChoreInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import { createChoreMirror } from './choreMirror.ts';

const chore = (changes: Partial<ChoreInstance> = {}): ChoreInstance =>
  ({
    state: 'untouched',
    enteredAt: 0,
    beatsDone: 0,
    beatState: 'none',
    beatTelegraphAt: 0,
    beatWindowOpenAt: 0,
    responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
    ...changes,
  }) as ChoreInstance;

describe('the chore mirror (data-pp-chore)', () => {
  it('writes the chores by index: <index>:<state>:<beatsDone>/<beatCount>:<beatState>', () => {
    const mirror = createChoreMirror();
    expect(mirror.update([chore()], [4])).toBe('0:untouched:0/4:none');
    expect(
      mirror.update([chore({ state: 'working', beatsDone: 1, beatState: 'telegraph' })], [4]),
    ).toBe('0:working:1/4:telegraph');
  });

  it('joins several chores with a semicolon', () => {
    const mirror = createChoreMirror();
    expect(mirror.update([chore({ state: 'done', beatsDone: 4 }), chore()], [4, 3])).toBe(
      '0:done:4/4:none;1:untouched:0/3:none',
    );
  });

  it('is empty for a level that has none', () => {
    const mirror = createChoreMirror();
    expect(mirror.update([], [])).toBe('');
  });

  it('returns the text only when something changed: a quiet frame writes nothing', () => {
    const mirror = createChoreMirror();
    expect(mirror.update([chore()], [4])).toBe('0:untouched:0/4:none');
    expect(mirror.update([chore()], [4])).toBeNull();
    expect(mirror.update([chore()], [4])).toBeNull();
    // A new beat state, a new beat done and a new state each count.
    expect(mirror.update([chore({ state: 'working', beatState: 'held' })], [4])).toBe(
      '0:working:0/4:held',
    );
    expect(mirror.update([chore({ state: 'working', beatState: 'telegraph' })], [4])).toBe(
      '0:working:0/4:telegraph',
    );
    expect(
      mirror.update([chore({ state: 'working', beatsDone: 1, beatState: 'telegraph' })], [4]),
    ).toBe('0:working:1/4:telegraph');
  });

  it('writes again after a reset (a new level), even for the same text', () => {
    const mirror = createChoreMirror();
    mirror.update([chore()], [4]);
    mirror.reset();
    expect(mirror.update([chore()], [4])).toBe('0:untouched:0/4:none');
  });

  it('writes the empty text once for a level with no chore, and then stays quiet', () => {
    const mirror = createChoreMirror();
    expect(mirror.update([], [])).toBe('');
    expect(mirror.update([], [])).toBeNull();
  });
});
