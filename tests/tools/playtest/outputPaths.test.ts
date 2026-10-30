import { describe, expect, it } from 'vitest';
import { outputConflict } from '../../../tools/playtest/outputPaths.ts';

const NOTES = { label: 'observations file', path: '/repo/docs/playtest/observations.csv' };

describe('outputConflict', () => {
  it('accepts outputs beside the journals folder', () => {
    expect(
      outputConflict(
        [
          { flag: '--out', path: '/work/report.md' },
          { flag: '--json', path: '/work/report.json' },
        ],
        '/work/journals',
        [NOTES],
      ),
    ).toBeNull();
  });

  it('refuses --out and --json on the same file, however it is spelled', () => {
    expect(
      outputConflict(
        [
          { flag: '--out', path: '/work/report.md' },
          { flag: '--json', path: '/work/sub/../report.md' },
        ],
        '/work/journals',
        [],
      ),
    ).toBe('--out and --json are the same file /work/report.md');
  });

  it('refuses an output that is the observations file', () => {
    expect(outputConflict([{ flag: '--out', path: NOTES.path }], '/work/journals', [NOTES])).toBe(
      `--out ${NOTES.path} is the observations file: it would be overwritten`,
    );
  });

  it('refuses an output inside the journals folder, at any depth', () => {
    const conflict = (path: string) =>
      outputConflict([{ flag: '--json', path }], '/work/journals', []);
    expect(conflict('/work/journals/report.json')).toContain('is inside the journals folder');
    expect(conflict('/work/journals/T1/report.json')).toContain('is inside the journals folder');
  });

  it('does not take a sibling whose name starts like the folder for a child', () => {
    expect(
      outputConflict([{ flag: '--out', path: '/work/journals-report.md' }], '/work/journals', []),
    ).toBeNull();
    expect(
      outputConflict([{ flag: '--out', path: '/work/..report.md' }], '/work/journals', []),
    ).toBeNull();
  });
});
