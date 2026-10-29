import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { SIM_CLI_MAX_UNTIL_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim } from '@sim';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNodeContentSource } from '../../../tools/content/nodeContentSource.ts';
import { loadSimLevel, type SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import {
  journalFileToRunFile,
  parseJournalFile,
  replayJournalFile,
} from '../../../tools/sim/replaySim.ts';

// A headless game on the real `salon_crawler` becomes the file the Result screen exports, through
// the very builder the browser uses, and `sim:replay` must end in the same state (story 3.3, AC 11).
// It reads the live content, so it asserts no tuned value.

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CONTENT_DIR = join(REPO, 'content');
const TIMEOUT_MS = 120_000;

let loaded: SimLevel;
let baseContent: ContentBundle;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pp-journal-'));
  const level = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
  if (!level.ok) throw new Error(level.error);
  loaded = level.value;
  const content = await loadContent(createNodeContentSource(CONTENT_DIR));
  if (!content.ok) throw new Error('cannot load the content');
  baseContent = content.value;
}, TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface PlayOptions {
  botId?: 'perfect' | 'human';
  seed?: number;
  strictInvariants?: boolean;
  /** Commands enqueued before the first step, as a live tuning would. */
  commands?: Parameters<Awaited<ReturnType<typeof createSim>>['enqueue']>[0][];
}

/** A whole game on `salon_crawler`, exported the way the Result screen exports it. */
async function playExportedGame(options: PlayOptions = {}): Promise<JournalFile> {
  const { botId = 'perfect', seed = 3, strictInvariants = true, commands = [] } = options;
  const { content, geometry, level } = loaded;
  const sim = await createSim({ content, geometry, level, seed, strictInvariants });
  try {
    const bot = createBot(botId, {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses: botResponsesOf(level.threats),
      settings: content.bots,
    });
    if (!bot.ok) throw new Error(bot.error.message);
    for (const command of commands) sim.enqueue(command);
    const recorder = createGameSummary({
      sessionId: '0a1b2c3d',
      gameIndexInSession: 1,
      autoplay: botId,
    });
    playGame(sim, bot.value, level.level.durationMs, (event) => recorder.onEvent(event, 'none'));
    const summary = recorder.summary();
    if (summary === null) throw new Error('the game did not end');
    return buildJournalFile({
      sim,
      levelId: loaded.levelId,
      baseContent,
      strictInvariants,
      summary,
      device: { type: 'desktop', platform: 'macos' },
      target: 'web',
      logs: [],
    });
  } finally {
    sim.dispose();
  }
}

/** What `sim:replay` does with the text of a file: one trip through the disk and JSON. */
function throughDisk(file: JournalFile, name: string): { path: string; json: unknown } {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(file, null, 2));
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) as unknown };
}

function runCli(args: string[]) {
  const done = spawnSync('npx', ['tsx', 'tools/sim/replaySim.ts', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

describe('sim:replay on an exported journal (story 3.3)', () => {
  it(
    'replays a game the Result screen would export to the world it recorded',
    async () => {
      const file = await playExportedGame();
      expect(file.summary.endReason).toBe('timer');
      const { json } = throughDisk(file, 'strict.json');
      const parsed = parseJournalFile(json);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const replay = await replayJournalFile(parsed.value, loaded);
      expect(replay).toEqual({
        ok: true,
        value: { worldHash: file.replay.worldHash, hasSameContent: true },
      });
    },
    TIMEOUT_MS,
  );

  it(
    'the CLI replays it too, in one run, with no content warning',
    async () => {
      const file = await playExportedGame({ botId: 'human', seed: 5 });
      const { path } = throughDisk(file, 'cli.json');
      const done = runCli([path]);
      expect(done.status).toBe(0);
      expect(done.stdout).toContain('replay matches');
      expect(done.stdout).toContain(file.replay.worldHash);
      expect(done.stderr).not.toContain('content');
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a journal in which one entry was changed',
    async () => {
      const file = await playExportedGame();
      const entries = file.replay.journal.entries.slice(1);
      expect(file.replay.journal.entries.length).toBeGreaterThan(entries.length);
      const altered: JournalFile = {
        ...file,
        replay: { ...file.replay, journal: { ...file.replay.journal, entries } },
      };
      const parsed = parseJournalFile(throughDisk(altered, 'altered.json').json);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const replay = await replayJournalFile(parsed.value, loaded);
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.error).toContain('another state');
      const done = runCli([join(dir, 'altered.json')]);
      expect(done.status).toBeGreaterThan(0);
      expect(done.stderr).toContain('another state');
    },
    TIMEOUT_MS,
  );

  it(
    'replays with the strictness it was recorded with: a clamped game replays non-strict, and not strict',
    async () => {
      // A `SetTimeScale` above 1 is clamped (and reported) in a playtest build, and throws in dev.
      const file = await playExportedGame({
        strictInvariants: false,
        commands: [{ type: 'SetTimeScale', t: asSimMs(0), scale: 5 }],
      });
      expect(file.replay.strictInvariants).toBe(false);
      const parsed = parseJournalFile(throughDisk(file, 'lenient.json').json);
      if (!parsed.ok) throw new Error(parsed.error);
      const lenient = await replayJournalFile(parsed.value, loaded);
      expect(lenient.ok).toBe(true);
      if (lenient.ok) expect(lenient.value.worldHash).toBe(file.replay.worldHash);

      const asStrict: JournalFile = { ...file, replay: { ...file.replay, strictInvariants: true } };
      const strict = await replayJournalFile(asStrict, loaded);
      expect(strict.ok).toBe(false);
      if (!strict.ok) {
        expect(strict.error).toContain('crashed');
        expect(strict.error).toContain('time.scale');
      }
    },
    TIMEOUT_MS,
  );

  it(
    'warns, and still replays, when the content hash is not the one of this checkout',
    async () => {
      const file = await playExportedGame();
      const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
      const same = await replayJournalFile(file, loaded);
      expect(same.ok).toBe(true);
      expect(warn).not.toHaveBeenCalled();

      const other: JournalFile = {
        ...file,
        replay: { ...file.replay, contentHash: 'ffffffffffffff' },
      };
      const replay = await replayJournalFile(other, loaded);
      expect(replay).toEqual({
        ok: true,
        value: { worldHash: file.replay.worldHash, hasSameContent: false },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[1]);
      expect(message).toContain('ffffffffffffff');
      expect(message).toContain(loaded.contentHash);
      expect(loaded.contentHash).toBe(file.replay.contentHash);
      expect(loaded.contentHash).toBe(hashJson(baseContent));
    },
    TIMEOUT_MS,
  );

  it(
    'names the bot of an autoplay game, and "player" for a human one',
    async () => {
      const file = await playExportedGame();
      expect(journalFileToRunFile(file)).toMatchObject({
        kind: 'papa-parade.run',
        levelId: 'salon_crawler',
        bot: 'perfect',
        untilSimMs: file.replay.endSimMs,
        worldHash: file.replay.worldHash,
        journal: file.replay.journal,
      });
      const human: JournalFile = { ...file, summary: { ...file.summary, autoplay: null } };
      expect(journalFileToRunFile(human).bot).toBe('player');
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a file that fails JournalSchema, naming the paths',
    async () => {
      const file = await playExportedGame();
      const parsed = parseJournalFile({
        ...file,
        device: { ...file.device, userAgent: 'x' },
        summary: { ...file.summary, sessionId: 'nope' },
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toContain('device');
        expect(parsed.error).toContain('summary.sessionId');
      }
      expect(parseJournalFile('text').ok).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a journal that claims to run longer than the CLI allows',
    async () => {
      const file = await playExportedGame();
      const long: JournalFile = {
        ...file,
        replay: { ...file.replay, endSimMs: SIM_CLI_MAX_UNTIL_MS + 10 },
      };
      const replay = await replayJournalFile(long, loaded);
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.error).toContain('endSimMs');
    },
    TIMEOUT_MS,
  );

  it(
    'the CLI exits non-zero on a journal that fails the schema, naming the path, with no stack trace',
    async () => {
      const file = await playExportedGame();
      const bad = { ...file, kind: 'papa-parade.journal', device: { ...file.device, extra: 1 } };
      const path = join(dir, 'bad.json');
      writeFileSync(path, JSON.stringify(bad));
      const done = runCli([path]);
      expect(done.status).toBeGreaterThan(0);
      expect(done.stderr).toContain('device');
      expect(done.stderr).not.toMatch(/\n\s+at /);
    },
    TIMEOUT_MS,
  );

  it(
    '--help names both kinds of file',
    () => {
      const done = runCli(['--help']);
      expect(done.status).toBe(0);
      expect(done.stdout).toContain('papa-parade.run');
      expect(done.stdout).toContain('papa-parade.journal');
    },
    TIMEOUT_MS,
  );
});
