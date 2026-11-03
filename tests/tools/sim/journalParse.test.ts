import { describe, expect, it } from 'vitest';
import { parseJournalFile } from '../../../tools/sim/replaySim.ts';
import { makeJournal } from '../playtest/support.ts';

// A journal file as `sim:replay` reads it (story 3.12, AC 14): the five-row score of v2.3 and the
// four-row one of the journals exported before it are both valid files.

type Score = Record<string, number>;

function withScore(change: (score: Score) => Score): unknown {
  const file = JSON.parse(JSON.stringify(makeJournal()));
  file.summary.score = change(file.summary.score as Score);
  return file;
}

describe('parseJournalFile: the score of an exported journal (story 3.12)', () => {
  it('accepts the five-row score the game writes now', () => {
    expect(parseJournalFile(withScore((score) => score)).ok).toBe(true);
  });

  it('still accepts the four-row score of a journal exported before v2.3', () => {
    const legacy = withScore(({ calmPoints: _calm, homePoints: _home, ...rows }) => ({
      ...rows,
      babyStatePoints: 20,
    }));
    expect(parseJournalFile(legacy).ok).toBe(true);
  });

  it('refuses a score that is neither, naming the path of the score', () => {
    const half = parseJournalFile(withScore(({ calmPoints: _calm, ...rows }) => rows));
    expect(half).toEqual({
      ok: false,
      error: 'not a valid exported journal:\n  summary.score: Invalid input',
    });
    const mixed = parseJournalFile(withScore((score) => ({ ...score, babyStatePoints: 20 })));
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error).toContain('summary.score');
  });
});
