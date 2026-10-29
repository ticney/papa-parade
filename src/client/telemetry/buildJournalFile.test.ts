import { type JournalFile, JournalSchema } from '@content/schemas/journal';
import { JOURNAL_LOG_STRING_MAX_CHARS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import type { LogEntry } from '@shared/log';
import type { Journal, JournalEntry } from '@sim';
import { afterEach, describe, expect, it } from 'vitest';
import { playBotGame } from '../../../tests/support/botSupport.ts';
import {
  createTestContent,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { buildJournalFile } from './buildJournalFile.ts';
import { describeDevice } from './describeDevice.ts';
import { createGameSummary } from './gameSummary.ts';

// The two-way proof of AC 2: the envelope of the schema's journal is `Journal` from `@sim`, key for
// key and type for type. A change to `Journal` fails to typecheck here until the schema follows.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type SchemaJournal = JournalFile['replay']['journal'];
// The command stays opaque in Zod (the content layer cannot import `@sim`), so the entries are
// proved in the direction that matters: every entry of a `Journal` fits the schema's.
const envelopeMatches: Mutual<Omit<SchemaJournal, 'entries'>, Omit<Journal, 'entries'>> = true;
const entryKeysMatch: Mutual<keyof SchemaJournal['entries'][number], keyof JournalEntry> = true;
const entriesFit: [Journal['entries']] extends [SchemaJournal['entries']] ? true : false = true;

const LEVEL_MS = 20_000;
const level = createTestLevel({
  waves: [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })],
  durationMs: LEVEL_MS,
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

async function playFinishedGame() {
  const game = await playBotGame('perfect', 7, { untilSimMs: LEVEL_MS + 1000, level });
  const recorder = createGameSummary({
    sessionId: '0a1b2c3d',
    gameIndexInSession: 2,
    autoplay: 'perfect',
  });
  for (const event of game.events) recorder.onEvent(event, 'none');
  return { sim: game.sim, summary: recorder.summary() };
}

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const sim of disposables.splice(0)) sim.dispose();
});

describe('buildJournalFile (story 3.3)', () => {
  it('proves at compile time that the schema follows the sim journal', () => {
    expect([envelopeMatches, entryKeysMatch, entriesFit]).toEqual([true, true, true]);
  });

  it('builds a file that passes JournalSchema, from a real finished game', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    expect(summary).not.toBeNull();
    if (summary === null) return;
    const logs: LogEntry[] = [
      { atReal: 12.5, level: 'info', channel: 'boot', message: 'started' },
      {
        atReal: 30,
        level: 'warn',
        channel: 'debug',
        message: 'clipboard refused',
        data: { error: new TypeError('nope'), map: new Map() },
      },
    ];
    const baseContent = createTestContent();
    const file = buildJournalFile({
      sim,
      levelId: 'salon_crawler',
      baseContent,
      strictInvariants: false,
      summary,
      device: describeDevice({
        userAgent: IPHONE_UA,
        uaDataPlatform: null,
        maxTouchPoints: 5,
        isCoarsePointer: true,
        shortSidePx: 390,
      }),
      target: 'web',
      logs,
    });

    const parsed = JournalSchema.safeParse(JSON.parse(JSON.stringify(file)));
    expect(parsed.success).toBe(true);
    expect(file.kind).toBe('papa-parade.journal');
    expect(file.version).toBe(1);
    expect(file.replay.levelId).toBe('salon_crawler');
    expect(file.replay.contentHash).toBe(hashJson(baseContent));
    expect(file.replay.strictInvariants).toBe(false);
    expect(file.replay.endSimMs).toBe(sim.world.time.sim);
    expect(file.replay.worldHash).toBe(hashJson(sim.world));
    expect(file.replay.journal).toEqual(sim.journal());
    expect(file.summary).toEqual(summary);
    expect(file.device).toEqual({ type: 'phone', platform: 'ios', target: 'web' });
    expect(file.diagnostics.logs).toEqual([
      { atReal: 12.5, level: 'info', channel: 'boot', message: 'started' },
      {
        atReal: 30,
        level: 'warn',
        channel: 'debug',
        message: 'clipboard refused',
        data: { error: { name: 'TypeError', message: 'nope' }, map: '[Map]' },
      },
    ]);
  });

  it('records the mode it was given, not the build default', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    if (summary === null) throw new Error('the game did not end');
    const input = {
      sim,
      levelId: 'salon_crawler',
      baseContent: createTestContent(),
      summary,
      device: { type: 'desktop', platform: 'macos' } as const,
      target: 'web' as const,
      logs: [],
    };
    expect(buildJournalFile({ ...input, strictInvariants: true }).replay.strictInvariants).toBe(
      true,
    );
    expect(buildJournalFile({ ...input, strictInvariants: false }).replay.strictInvariants).toBe(
      false,
    );
  });

  it('puts nothing of the user-agent (or any probe field) in the serialized file', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    if (summary === null) throw new Error('the game did not end');
    const probe = {
      userAgent: IPHONE_UA,
      uaDataPlatform: 'iOS',
      maxTouchPoints: 5,
      isCoarsePointer: true,
      shortSidePx: 391,
    };
    const file = buildJournalFile({
      sim,
      levelId: 'salon_crawler',
      baseContent: createTestContent(),
      strictInvariants: true,
      summary,
      device: describeDevice(probe),
      target: 'web',
      logs: [],
    });
    const text = JSON.stringify(file);
    for (const part of ['Mozilla', 'iPhone', 'AppleWebKit', '18_5', '15E148', 'Safari', '391']) {
      expect(text).not.toContain(part);
    }
    expect(Object.keys(file.device).sort()).toEqual(['platform', 'target', 'type']);
    expect(Object.keys(file).sort()).toEqual([
      'device',
      'diagnostics',
      'kind',
      'replay',
      'summary',
      'version',
    ]);
  });

  it('omits the data of a log entry that has none, or whose data is not JSON at all', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    if (summary === null) throw new Error('the game did not end');
    const file = buildJournalFile({
      sim,
      levelId: 'salon_crawler',
      baseContent: createTestContent(),
      strictInvariants: true,
      summary,
      device: { type: 'desktop', platform: 'linux' },
      target: 'web',
      logs: [
        { atReal: 1, level: 'info', channel: 'boot', message: 'a' },
        { atReal: 2, level: 'info', channel: 'boot', message: 'b', data: () => 1 },
      ],
    });
    const [first, second] = file.diagnostics.logs;
    expect(first).toEqual({ atReal: 1, level: 'info', channel: 'boot', message: 'a' });
    expect(second).toEqual({ atReal: 2, level: 'info', channel: 'boot', message: 'b' });
    expect('data' in (second ?? {})).toBe(false);
    expect(JournalSchema.safeParse(JSON.parse(JSON.stringify(file))).success).toBe(true);
  });

  it('does not change the sim: building twice gives the same file', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    if (summary === null) throw new Error('the game did not end');
    const input = {
      sim,
      levelId: 'salon_crawler',
      baseContent: createTestContent(),
      strictInvariants: true,
      summary,
      device: { type: 'desktop', platform: 'windows' } as const,
      target: 'web' as const,
      logs: [],
    };
    const worldBefore = hashJson(sim.world);
    expect(buildJournalFile(input)).toEqual(buildJournalFile(input));
    expect(hashJson(sim.world)).toBe(worldBefore);
  });

  it('cuts a log message and channel longer than the string cap', async () => {
    const { sim, summary } = await playFinishedGame();
    disposables.push(sim);
    if (summary === null) throw new Error('the game did not finish');
    const long = 'x'.repeat(JOURNAL_LOG_STRING_MAX_CHARS + 50);
    const file = buildJournalFile({
      sim,
      levelId: 'salon_crawler',
      baseContent: createTestContent(),
      strictInvariants: true,
      summary,
      device: describeDevice({
        userAgent: IPHONE_UA,
        uaDataPlatform: null,
        maxTouchPoints: 5,
        isCoarsePointer: true,
        shortSidePx: 390,
      }),
      target: 'web',
      logs: [{ atReal: 1, level: 'info', channel: long as LogEntry['channel'], message: long }],
    });
    const [entry] = file.diagnostics.logs;
    expect(entry?.message).toBe(`${'x'.repeat(JOURNAL_LOG_STRING_MAX_CHARS)}…`);
    expect(entry?.channel).toBe(`${'x'.repeat(JOURNAL_LOG_STRING_MAX_CHARS)}…`);
  });
});
