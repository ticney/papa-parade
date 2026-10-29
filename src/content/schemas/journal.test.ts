import { describe, expect, it } from 'vitest';
import {
  JOURNAL_FILE_KIND,
  JOURNAL_FILE_VERSION,
  type JournalFile,
  JournalSchema,
} from './journal.ts';

function validFile(): JournalFile {
  const counts = { perfect: 1, success: 0, fail: 1 };
  return {
    kind: JOURNAL_FILE_KIND,
    version: JOURNAL_FILE_VERSION,
    replay: {
      levelId: 'salon_crawler',
      contentHash: '0123456789abcd',
      strictInvariants: false,
      endSimMs: 180_000,
      worldHash: 'fedcba98765432',
      journal: {
        version: 3,
        seed: 42,
        feelHash: 'aaaaaaaaaaaaaa',
        geometryHash: 'bbbbbbbbbbbbbb',
        levelHash: 'cccccccccccccc',
        startSimMs: 0,
        entries: [{ applyAt: 120, command: { type: 'TapFloor', t: 110, xM: 1, zM: 2 } }],
      },
    },
    summary: {
      sessionId: '0a1b2c3d',
      gameIndexInSession: 1,
      autoplay: null,
      endReason: 'timer',
      score: {
        laughPoints: 10,
        babyStatePoints: 20,
        sighPoints: 3,
        screamPoints: 0,
        scorePoints: 80,
        stars: 3,
        lostStars: 0,
      },
      responses: {
        byQuality: counts,
        byThreat: { outlet: counts },
        timeline: [
          {
            t: 5000,
            threatDefId: 'outlet',
            quality: 'perfect',
            reason: null,
            offsetMs: -4,
            device: 'touch',
          },
          {
            t: 9000,
            threatDefId: 'outlet',
            quality: 'fail',
            reason: 'late',
            offsetMs: null,
            device: 'touch',
          },
        ],
        byDevice: {
          touch: counts,
          mouse: { perfect: 0, success: 0, fail: 0 },
          keyboard: { perfect: 0, success: 0, fail: 0 },
          gamepad: { perfect: 0, success: 0, fail: 0 },
          none: { perfect: 0, success: 0, fail: 0 },
        },
      },
      dominantDevice: 'touch',
    },
    device: { type: 'phone', platform: 'ios', target: 'web' },
    diagnostics: {
      logs: [
        { atReal: 12.5, level: 'info', channel: 'boot', message: 'started' },
        { atReal: 20, level: 'warn', channel: 'debug', message: 'x', data: { name: 'Error' } },
      ],
    },
  };
}

function issuePaths(value: unknown): string[] {
  const result = JournalSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('JournalSchema (story 3.3)', () => {
  it('names the kind and the version of the file', () => {
    expect(JOURNAL_FILE_KIND).toBe('papa-parade.journal');
    expect(JOURNAL_FILE_VERSION).toBe(1);
  });

  it('accepts a well-formed file, and one that went through JSON', () => {
    expect(JournalSchema.safeParse(validFile()).success).toBe(true);
    const roundTrip: unknown = JSON.parse(JSON.stringify(validFile()));
    expect(JournalSchema.safeParse(roundTrip).success).toBe(true);
  });

  it('refuses an unknown key at the top level, in the summary, the device and the replay', () => {
    const file = validFile();
    expect(issuePaths({ ...file, extra: 1 })).toEqual(['']);
    expect(issuePaths({ ...file, summary: { ...file.summary, extra: 1 } })).toEqual(['summary']);
    expect(issuePaths({ ...file, device: { ...file.device, userAgent: 'x' } })).toEqual(['device']);
    expect(issuePaths({ ...file, replay: { ...file.replay, extra: 1 } })).toEqual(['replay']);
  });

  it('refuses a wrong kind and a wrong version', () => {
    expect(issuePaths({ ...validFile(), kind: 'papa-parade.run' })).toEqual(['kind']);
    expect(issuePaths({ ...validFile(), version: 2 })).toEqual(['version']);
  });

  it('refuses an off-grid applyAt, a seed outside [0, 2**32) and a wrong journal version', () => {
    const file = validFile();
    const withJournal = (journal: unknown) => ({ ...file, replay: { ...file.replay, journal } });
    const entry = { command: { type: 'TapFloor', t: 1 } };
    expect(
      issuePaths(withJournal({ ...file.replay.journal, entries: [{ applyAt: 125, ...entry }] })),
    ).toEqual(['replay.journal.entries.0.applyAt']);
    expect(
      issuePaths(withJournal({ ...file.replay.journal, entries: [{ applyAt: 12.5, ...entry }] })),
    ).toEqual(['replay.journal.entries.0.applyAt']);
    expect(issuePaths(withJournal({ ...file.replay.journal, seed: 2 ** 32 }))).toEqual([
      'replay.journal.seed',
    ]);
    expect(issuePaths(withJournal({ ...file.replay.journal, seed: -1 }))).toEqual([
      'replay.journal.seed',
    ]);
    expect(issuePaths(withJournal({ ...file.replay.journal, seed: 1.5 }))).toEqual([
      'replay.journal.seed',
    ]);
    expect(issuePaths(withJournal({ ...file.replay.journal, version: 2 }))).toEqual([
      'replay.journal.version',
    ]);
    expect(issuePaths(withJournal({ ...file.replay.journal, startSimMs: Number.NaN }))).toEqual([
      'replay.journal.startSimMs',
    ]);
  });

  it('keeps a command opaque beyond its type, and refuses one with no type', () => {
    const file = validFile();
    const withCommand = (command: unknown) => ({
      ...file,
      replay: {
        ...file.replay,
        journal: { ...file.replay.journal, entries: [{ applyAt: 10, command }] },
      },
    });
    expect(
      JournalSchema.safeParse(withCommand({ type: 'SetFeel', t: 1, patch: { a: { b: 2 } } }))
        .success,
    ).toBe(true);
    expect(issuePaths(withCommand({ t: 1 }))).toEqual(['replay.journal.entries.0.command.type']);
  });

  it('refuses a malformed session id, game index, device and response quality', () => {
    const file = validFile();
    expect(issuePaths({ ...file, summary: { ...file.summary, sessionId: 'ABCDEF01' } })).toEqual([
      'summary.sessionId',
    ]);
    expect(issuePaths({ ...file, summary: { ...file.summary, sessionId: '0a1b2c' } })).toEqual([
      'summary.sessionId',
    ]);
    expect(issuePaths({ ...file, summary: { ...file.summary, gameIndexInSession: 0 } })).toEqual([
      'summary.gameIndexInSession',
    ]);
    expect(
      issuePaths({ ...file, summary: { ...file.summary, dominantDevice: 'trackpad' } }),
    ).toEqual(['summary.dominantDevice']);
    expect(issuePaths({ ...file, device: { ...file.device, type: 'watch' } })).toEqual([
      'device.type',
    ]);
    expect(issuePaths({ ...file, device: { ...file.device, platform: 'beos' } })).toEqual([
      'device.platform',
    ]);
    const timeline = [{ ...file.summary.responses.timeline[0], quality: 'great' }];
    expect(
      issuePaths({
        ...file,
        summary: { ...file.summary, responses: { ...file.summary.responses, timeline } },
      }),
    ).toEqual(['summary.responses.timeline.0.quality']);
  });

  it('keeps a log entry data opaque, and refuses a log entry with an unknown key', () => {
    const file = validFile();
    const logs = [
      { atReal: 1, level: 'info', channel: 'boot', message: 'm', data: [1, 'a', null] },
    ];
    expect(JournalSchema.safeParse({ ...file, diagnostics: { logs } }).success).toBe(true);
    const odd = [{ atReal: 1, level: 'info', channel: 'boot', message: 'm', extra: 1 }];
    expect(issuePaths({ ...file, diagnostics: { logs: odd } })).toEqual(['diagnostics.logs.0']);
  });
});
