import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The only spawning test: the exit-code paths of the two real commands, which the unit tests of
// the pieces cannot see. It reads the live content, so it asserts no tuned value.

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TIMEOUT_MS = 60_000;

function run(script: 'runSim' | 'replaySim', args: string[]) {
  const done = spawnSync('npx', ['tsx', `tools/sim/${script}.ts`, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pp-sim-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('npm run sim', () => {
  it(
    'exits non-zero on an unknown bot, naming the choices, with no stack trace',
    () => {
      const done = run('runSim', ['--bot', 'genius']);
      expect(done.status).toBeGreaterThan(0);
      expect(done.stderr).toContain('unknown bot "genius"');
      expect(done.stderr).toContain('perfect, human, random, idle');
      expect(done.stderr).not.toMatch(/\n\s+at /);
    },
    TIMEOUT_MS,
  );

  it(
    'exits non-zero on an unknown level, naming the known ones',
    () => {
      const done = run('runSim', ['--bot', 'idle', '--level', 'nowhere']);
      expect(done.status).toBeGreaterThan(0);
      expect(done.stderr).toContain('unknown level "nowhere"');
      expect(done.stderr).toContain('salon_crawler');
    },
    TIMEOUT_MS,
  );

  it(
    'exits non-zero on --runs 0 and on a malformed seed',
    () => {
      const noRuns = run('runSim', ['--bot', 'idle', '--runs', '0']);
      expect(noRuns.status).toBeGreaterThan(0);
      expect(noRuns.stderr).toContain('--runs');
      const badSeed = run('runSim', ['--bot', 'idle', '--seed', 'abc']);
      expect(badSeed.status).toBeGreaterThan(0);
      expect(badSeed.stderr).toContain('--seed');
    },
    TIMEOUT_MS,
  );

  it(
    'writes the report to stdout when there is no --out, and only that',
    () => {
      const done = run('runSim', ['--bot', 'idle', '--until-ms', '10000']);
      expect(done.status).toBe(0);
      expect(JSON.parse(done.stdout)).toMatchObject({ bot: 'idle', runs: 1 });
    },
    TIMEOUT_MS,
  );

  it(
    'plays a game, records it, and the recorded game replays; an altered hash does not',
    () => {
      const report = join(dir, 'report.json');
      const games = join(dir, 'games');
      const played = run('runSim', [
        '--bot',
        'human',
        '--seed',
        '3',
        '--runs',
        '1',
        '--until-ms',
        '20000',
        '--out',
        report,
        '--journals',
        games,
      ]);
      expect(played.status).toBe(0);
      expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ bot: 'human', seed: 3 });
      const [name] = readdirSync(games);
      expect(name).toBe('salon_crawler_human_3.journal.json');
      const file = join(games, name as string);

      const replayed = run('replaySim', [file]);
      expect(replayed.status).toBe(0);
      expect(replayed.stdout).toContain('replay matches');

      const altered = JSON.parse(readFileSync(file, 'utf8'));
      altered.worldHash = '00000000000000';
      const alteredFile = join(games, 'altered.journal.json');
      writeFileSync(alteredFile, JSON.stringify(altered));
      const refused = run('replaySim', [alteredFile]);
      expect(refused.status).toBeGreaterThan(0);
      expect(refused.stderr).toContain('another state');
    },
    TIMEOUT_MS,
  );
});

describe('npm run sim:replay', () => {
  it(
    'exits non-zero without a file, on a missing file and on a file that is not a game',
    () => {
      const noFile = run('replaySim', []);
      expect(noFile.status).toBeGreaterThan(0);
      expect(noFile.stderr).toContain('usage');
      const missing = run('replaySim', [join(dir, 'missing.json')]);
      expect(missing.status).toBeGreaterThan(0);
      expect(missing.stderr).toContain('cannot read');
      const junk = join(dir, 'junk.json');
      writeFileSync(junk, '{"hello":1}');
      const done = run('replaySim', [junk]);
      expect(done.status).toBeGreaterThan(0);
      expect(done.stderr).toContain('not a recorded game');
    },
    TIMEOUT_MS,
  );
});
