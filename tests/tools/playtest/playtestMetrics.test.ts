import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { buildJournalFile } from '@client/telemetry/buildJournalFile';
import { createGameSummary } from '@client/telemetry/gameSummary';
import type { ContentBundle } from '@content/contentBundle';
import { loadContent } from '@content/loadContent';
import type { JournalFile } from '@content/schemas/journal';
import type { PlaytestThresholds } from '@content/schemas/playtest';
import { createSim } from '@sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeContentSource } from '../../../tools/content/nodeContentSource.ts';
import { computeMetrics, type PlaytestReport } from '../../../tools/playtest/computeMetrics.ts';
import { loadJournals } from '../../../tools/playtest/loadJournals.ts';
import { parseObservations } from '../../../tools/playtest/observations.ts';
import { loadObservations } from '../../../tools/playtest/playtestMetrics.ts';
import { loadSimLevel, type SimLevel } from '../../../tools/sim/loadSimLevel.ts';

// Two real headless games on `salon_crawler`, exported through the builders the Result screen uses
// (story 3.3), read by the real command with the committed example notes. It reads the live
// content, so it asserts structure and agreement with `computeMetrics`, not tuned values.

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CONTENT_DIR = join(REPO, 'content');
const EXAMPLE_CSV = join(REPO, 'docs', 'playtest', 'observations.example.csv');
const TIMEOUT_MS = 120_000;

let loaded: SimLevel;
let baseContent: ContentBundle;
let root: string;
let journals: string;

async function playHumanGame(
  seed: number,
  sessionId: string,
  device: 'touch' | 'keyboard',
): Promise<JournalFile> {
  const { content, geometry, level } = loaded;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
  try {
    const bot = createBot('human', {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      settings: content.bots,
    });
    if (!bot.ok) throw new Error(bot.error.message);
    // A tester's game: `autoplay` is null, and the device each response is credited to is the test's.
    const recorder = createGameSummary({ sessionId, gameIndexInSession: 1, autoplay: null });
    playGame(sim, bot.value, level.level.durationMs, (event) => recorder.onEvent(event, device));
    const summary = recorder.summary();
    if (summary === null) throw new Error('the game did not end');
    return buildJournalFile({
      sim,
      levelId: loaded.levelId,
      baseContent,
      strictInvariants: false,
      summary,
      device: { type: device === 'touch' ? 'phone' : 'desktop', platform: 'ios' },
      target: 'web',
      logs: [],
    });
  } finally {
    sim.dispose();
  }
}

function runCli(args: string[]) {
  const done = spawnSync('npx', ['tsx', 'tools/playtest/playtestMetrics.ts', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pp-metrics-'));
  journals = join(root, 'journals');
  const level = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
  if (!level.ok) throw new Error(level.error);
  loaded = level.value;
  const content = await loadContent(createNodeContentSource(CONTENT_DIR));
  if (!content.ok) throw new Error('cannot load the content');
  baseContent = content.value;

  // The session ids are the ones the example notes use.
  mkdirSync(join(journals, 'T1'), { recursive: true });
  mkdirSync(join(journals, 'T2'), { recursive: true });
  const first = await playHumanGame(3, '0a1b2c3d', 'touch');
  const second = await playHumanGame(4, '1a2b3c4d', 'keyboard');
  writeFileSync(join(journals, 'T1', 'game.json'), JSON.stringify(first, null, 2));
  writeFileSync(join(journals, 'T2', 'game.json'), JSON.stringify(second, null, 2));
}, TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('npm run playtest:metrics', () => {
  it(
    'reads two exported games and the example notes, and writes the Markdown and the JSON',
    async () => {
      const out = join(root, 'report.md');
      const json = join(root, 'report.json');
      const done = runCli([journals, '--observations', EXAMPLE_CSV, '--out', out, '--json', json]);
      expect(done.stderr).not.toMatch(/\[error\]/i);
      expect(done.status).toBe(0);
      // With --out the report is in the file; stdout only has the one `done` log line.
      expect(done.stdout).toContain('[playtest] done');
      expect(done.stdout).not.toContain('# Playtest indicators');

      const markdown = readFileSync(out, 'utf8');
      expect(markdown).toContain('| Indicator | Value | Threshold | Counted on | Status |');
      expect(markdown).toContain('| Panel (FR68) | 2 testers | ≥ 5 | 2 |');
      for (const heading of ['## Summary', '## Testers', '### T1', '### T2', '## Inputs']) {
        expect(markdown).toContain(heading);
      }

      const report = JSON.parse(readFileSync(json, 'utf8')) as PlaytestReport;
      expect(report.kind).toBe('papa-parade.playtest-metrics');
      expect(report.version).toBe(1);
      expect(report.testers.map((t) => t.testerId)).toEqual(['T1', 'T2']);

      // The CLI and the pure function agree on the same files.
      const thresholds = JSON.parse(
        readFileSync(join(CONTENT_DIR, 'playtest.json'), 'utf8'),
      ) as PlaytestThresholds & { $schema?: string };
      const { $schema: _schema, ...values } = thresholds;
      const read = await loadJournals(journals);
      if (!read.ok) throw new Error(read.error.join('\n'));
      const notes = parseObservations(
        readFileSync(EXAMPLE_CSV, 'utf8'),
        EXAMPLE_CSV,
        new Set(['outlet', 'stairs', 'coffee_table_object', 'silence_mischief', 'papa_microsleep']),
      );
      if (!notes.ok) throw new Error(notes.error.join('\n'));
      const expected = computeMetrics({
        testers: read.value.testers,
        observations: notes.value.rows,
        thresholds: values,
        inputs: report.inputs,
        warnings: [...read.value.warnings, ...notes.value.warnings],
      });
      expect(report).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(report.panel).toEqual({ testers: 2, minTesters: 5, status: 'KO' });
      // T1 played on touch, T2 on the keyboard: the pooled ratio sees both devices.
      expect(report.touchVsKeyboard.rates.touch.total).toBeGreaterThan(0);
      expect(report.touchVsKeyboard.rates.keyboard.total).toBeGreaterThan(0);
      expect(report.touchVsKeyboard.rates.mouse.total).toBe(0);
      // Both examples' sessions are the games' own: nothing in the notes points at a stranger.
      expect(report.warnings.filter((w) => w.includes('is not one of'))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'prints the report on stdout when there is no --out, even with KO indicators',
    () => {
      const done = runCli([journals, '--observations', EXAMPLE_CSV]);
      expect(done.status).toBe(0);
      expect(done.stdout).toContain('# Playtest indicators');
      expect(done.stdout).toContain('| Status |');
    },
    TIMEOUT_MS,
  );

  it('warns and returns no rows when the default notes file is missing', async () => {
    // The default path is injected: the real one is Geo's own file, which may exist on his machine.
    const loadedNotes = await loadObservations(null, join(root, 'no-such-notes.csv'));
    expect(loadedNotes).toEqual({
      ok: true,
      value: {
        rows: [],
        path: null,
        warnings: [
          'no observations file at docs/playtest/observations.csv: the observed indicators (2, 3, 5) are n/a',
        ],
      },
    });
  });

  it('refuses a missing notes file when its path is given', async () => {
    const loadedNotes = await loadObservations(join(root, 'no-such-notes.csv'));
    expect(!loadedNotes.ok && loadedNotes.error[0]).toContain('cannot read the observations');
  });

  it('warns about notes that are not UTF-8, and names the file, not its folder', async () => {
    const ansi = join(root, 'ansi.csv');
    writeFileSync(
      ansi,
      Buffer.from(
        'testerId,sessionId,threatId,identifiedWithoutHelp,perfectCitedSpontaneously,laughs,comment\nT1,,,,,1,h\xe9siter\n',
        'latin1',
      ),
    );
    const loadedNotes = await loadObservations(ansi);
    if (!loadedNotes.ok) throw new Error(loadedNotes.error.join('\n'));
    expect(loadedNotes.value.path).toBe('ansi.csv');
    expect(loadedNotes.value.warnings).toEqual([
      expect.stringContaining('ansi.csv is not valid UTF-8'),
    ]);
  });

  it(
    'refuses --out and --json on one file, and an output inside the journals folder',
    () => {
      const same = join(root, 'same.md');
      const twice = runCli([
        journals,
        '--observations',
        EXAMPLE_CSV,
        '--out',
        same,
        '--json',
        same,
      ]);
      expect(twice.status).toBe(1);
      expect(twice.stderr).toContain('--out and --json are the same file');
      const inside = runCli([
        journals,
        '--observations',
        EXAMPLE_CSV,
        '--json',
        join(journals, 'r.json'),
      ]);
      expect(inside.status).toBe(1);
      expect(inside.stderr).toContain('is inside the journals folder');
      const overNotes = runCli([journals, '--observations', EXAMPLE_CSV, '--out', EXAMPLE_CSV]);
      expect(overNotes.status).toBe(1);
      expect(overNotes.stderr).toContain('would be overwritten');
    },
    TIMEOUT_MS,
  );

  it(
    'logs the warnings of the computation on stderr, and keeps the machine’s folders out of the report',
    () => {
      const done = runCli([journals, '--observations', EXAMPLE_CSV]);
      expect(done.status).toBe(0);
      expect(done.stderr).toContain('the panel is too small');
      expect(done.stdout).toContain('- Folder: journals');
      expect(done.stdout).toContain('- Observations: observations.example.csv');
      expect(done.stdout).not.toContain(root);
    },
    TIMEOUT_MS,
  );

  it(
    'exits 1 with the missing column on stderr when the notes lack a column',
    () => {
      const bad = join(root, 'bad.csv');
      writeFileSync(
        bad,
        'testerId,sessionId,threatId,identifiedWithoutHelp,laughs,comment\nT1,,,,1,x\n',
      );
      const done = runCli([journals, '--observations', bad]);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain('perfectCitedSpontaneously');
      expect(done.stderr).not.toMatch(/\n\s+at /);
    },
    TIMEOUT_MS,
  );

  it(
    'exits 1 on an explicit notes path that does not exist, on a usage error and on a bad --out',
    () => {
      const noNotes = runCli([journals, '--observations', join(root, 'nope.csv')]);
      expect(noNotes.status).toBe(1);
      expect(noNotes.stderr).toContain('cannot read the observations');
      const usage = runCli([]);
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain('the folder of tester journals is required');
      const badOut = runCli([journals, '--out', join(root, 'missing-folder', 'r.md')]);
      expect(badOut.status).toBe(1);
      expect(badOut.stderr).toContain('--out: the folder');
    },
    TIMEOUT_MS,
  );

  it(
    'exits 1 for a folder with a journal outside a tester folder, naming what to do',
    () => {
      const messy = join(root, 'messy');
      mkdirSync(messy);
      writeFileSync(join(messy, 'stray.json'), '{}');
      const done = runCli([messy]);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain('put each tester');
    },
    TIMEOUT_MS,
  );

  it('prints the help and exits 0', () => {
    const done = runCli(['--help']);
    expect(done.status).toBe(0);
    expect(done.stdout).toContain('Usage: npm run playtest:metrics');
  });
});
