import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from '@shared/log';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJournals } from '../../../tools/playtest/loadJournals.ts';
import { type JournalSpec, makeJournal } from './support.ts';

let root: string;
const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pp-load-'));
  roots.push(root);
  // `loadJournals` warns about every skip; the tests read the warnings from the result.
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function put(path: string, content: unknown): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
}

function journal(path: string, spec: JournalSpec = {}): void {
  put(path, makeJournal(spec));
}

async function load() {
  return loadJournals(root);
}

async function loadedOk() {
  const result = await load();
  if (!result.ok) throw new Error(result.error.join('\n'));
  return result.value;
}

async function errorsOf(): Promise<string[]> {
  const result = await load();
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

describe('loadJournals', () => {
  it('reads one folder per tester, in sorted order, files in name order', async () => {
    journal('T2/b.json', { sessionId: '00000002', gameIndex: 1 });
    journal('T10/a.json', { sessionId: '00000003', gameIndex: 1 });
    journal('T1/b.json', { sessionId: '00000001', gameIndex: 2 });
    journal('T1/a.json', { sessionId: '00000001', gameIndex: 1 });
    const loaded = await loadedOk();
    expect(loaded.testers.map((tester) => tester.testerId)).toEqual(['T1', 'T10', 'T2']);
    expect(loaded.testers[0]?.games.map((game) => game.file)).toEqual(['T1/a.json', 'T1/b.json']);
    expect(loaded.filesRead).toBe(4);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.warnings).toEqual([]);
  });

  it('lists the distinct levels and content hashes, sorted', async () => {
    journal('T1/a.json', { sessionId: '00000001', levelId: 'salon_crawler', contentHash: 'bbbb' });
    journal('T2/a.json', { sessionId: '00000002', levelId: 'chambre', contentHash: 'aaaa' });
    journal('T2/b.json', {
      sessionId: '00000002',
      gameIndex: 2,
      levelId: 'chambre',
      contentHash: 'aaaa',
    });
    const loaded = await loadedOk();
    expect(loaded.levels).toEqual(['chambre', 'salon_crawler']);
    expect(loaded.contentHashes).toEqual(['aaaa', 'bbbb']);
  });

  it('ignores dot-files and files that are not .json, silently', async () => {
    journal('T1/a.json');
    put('T1/.DS_Store', 'x');
    put('T1/notes.txt', 'x');
    put('.DS_Store', 'x');
    put('README.md', 'x');
    put('.hidden/a.json', '{}');
    const loaded = await loadedOk();
    expect(loaded.filesRead).toBe(1);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it('warns about a folder deeper than one level and ignores it', async () => {
    journal('T1/a.json');
    journal('T1/old/b.json', { sessionId: '00000009' });
    const loaded = await loadedOk();
    expect(loaded.testers[0]?.games).toHaveLength(1);
    expect(loaded.warnings).toEqual(['T1/old/: a folder inside a tester folder is ignored']);
  });

  it('refuses a .json file directly in the folder', async () => {
    journal('T1/a.json');
    journal('stray.json');
    expect(await errorsOf()).toEqual([
      `stray.json: a journal directly in ${root}: put each tester's journals in a folder named after their testerId`,
    ]);
  });

  it('refuses a folder whose name is not a tester id', async () => {
    journal('T1/a.json');
    journal('Jean Dupont/a.json', { sessionId: '00000002' });
    expect(await errorsOf()).toEqual([
      'Jean Dupont/: not a tester id (1-32 of A-Z a-z 0-9 _ -): rename the folder after the pseudonym of the tester',
    ]);
  });

  it('refuses an empty folder and a folder where nobody has a usable game', async () => {
    expect(await errorsOf()).toEqual([
      `${root}: no tester has a usable game (expected ${root}/<testerId>/*.json, journals exported from the Result screen of a playtest build)`,
    ]);
    put('T1/bad.json', '{ nope');
    expect(await errorsOf()).toHaveLength(1);
  });

  it('refuses a folder that does not exist', async () => {
    const result = await loadJournals(join(root, 'missing'));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error[0]).toContain(`cannot read the folder ${join(root, 'missing')}`);
  });

  it('skips a file that is not JSON, with its reason, and keeps the tester', async () => {
    journal('T1/a.json');
    put('T1/b.json', '{ nope');
    const loaded = await loadedOk();
    expect(loaded.testers[0]?.games).toHaveLength(1);
    expect(loaded.skipped).toHaveLength(1);
    expect(loaded.skipped[0]?.file).toBe('T1/b.json');
    expect(loaded.skipped[0]?.reason).toMatch(/^not valid JSON: /);
    expect(loaded.warnings).toEqual([`T1/b.json skipped: ${loaded.skipped[0]?.reason}`]);
  });

  it('skips a file that fails JournalSchema, naming the path', async () => {
    journal('T1/a.json');
    const bad = JSON.parse(JSON.stringify(makeJournal({ sessionId: '00000002' })));
    bad.summary.gameIndexInSession = 0;
    put('T1/b.json', bad);
    const loaded = await loadedOk();
    expect(loaded.skipped).toEqual([
      {
        file: 'T1/b.json',
        reason: expect.stringMatching(
          /^not a valid exported journal:\n {2}summary\.gameIndexInSession: /,
        ),
      },
    ]);
  });

  it('skips a bot run file with its reason', async () => {
    journal('T1/a.json');
    put('T1/run.json', { kind: 'papa-parade.run', version: 1 });
    const loaded = await loadedOk();
    expect(loaded.skipped).toEqual([
      { file: 'T1/run.json', reason: 'a bot run file, not a playtest journal' },
    ]);
  });

  it('skips a game played by a bot', async () => {
    journal('T1/a.json');
    journal('T1/auto.json', { sessionId: '00000002', autoplay: 'perfect' });
    const loaded = await loadedOk();
    expect(loaded.skipped).toEqual([{ file: 'T1/auto.json', reason: 'played by the perfect bot' }]);
    expect(loaded.testers[0]?.games).toHaveLength(1);
  });

  it('drops a tester with no usable game and says so', async () => {
    journal('T1/a.json');
    journal('T2/auto.json', { sessionId: '00000002', autoplay: 'human' });
    const loaded = await loadedOk();
    expect(loaded.testers.map((tester) => tester.testerId)).toEqual(['T1']);
    expect(loaded.warnings).toContain('T2/: no usable game');
  });

  it('keeps the first of two files that are the same game, and skips the second', async () => {
    journal('T1/a.json', { sessionId: '00000001', gameIndex: 1, worldHash: 'same' });
    journal('T1/b.json', { sessionId: '00000001', gameIndex: 1, worldHash: 'same' });
    const loaded = await loadedOk();
    expect(loaded.testers[0]?.games.map((game) => game.file)).toEqual(['T1/a.json']);
    expect(loaded.skipped).toEqual([
      { file: 'T1/b.json', reason: 'the same game as T1/a.json (sent twice)' },
    ]);
  });

  it('refuses one game index twice in a session with different outcomes', async () => {
    journal('T1/a.json', { sessionId: '00000001', gameIndex: 1, worldHash: 'one' });
    journal('T1/b.json', { sessionId: '00000001', gameIndex: 1, worldHash: 'two' });
    expect(await errorsOf()).toEqual([
      'T1/a.json and T1/b.json are both game 1 of session 00000001 with different outcomes: two games cannot have one index in one session',
    ]);
  });

  it('accepts the same game index in two sessions of one tester', async () => {
    journal('T1/a.json', { sessionId: '00000001', gameIndex: 1, worldHash: 'one' });
    journal('T1/b.json', { sessionId: '00000002', gameIndex: 1, worldHash: 'two' });
    const loaded = await loadedOk();
    expect(loaded.testers[0]?.games).toHaveLength(2);
  });

  it('refuses one session under two testers', async () => {
    journal('T1/a.json', { sessionId: '00000001' });
    journal('T2/a.json', { sessionId: '00000001', worldHash: 'other' });
    expect(await errorsOf()).toEqual([
      'session 00000001 is in T1/a.json and in T2/a.json: a page visit belongs to one tester',
    ]);
  });

  it('reports every layout error together', async () => {
    journal('stray.json');
    journal('Not Ok/a.json');
    expect(await errorsOf()).toHaveLength(2);
  });
});
