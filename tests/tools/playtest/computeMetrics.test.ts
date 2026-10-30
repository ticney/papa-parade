import type { PlaytestThresholds } from '@content/schemas/playtest';
import { describe, expect, it } from 'vitest';
import {
  type ComputeMetricsInput,
  computeMetrics,
  PLAYTEST_REPORT_KIND,
  type PlaytestReport,
} from '../../../tools/playtest/computeMetrics.ts';
import type { TesterGames } from '../../../tools/playtest/loadJournals.ts';
import type { ObservationRow } from '../../../tools/playtest/observations.ts';
import { type JournalSpec, makeJournal, type ResponseSpec } from './support.ts';

const THRESHOLDS: PlaytestThresholds = {
  panelMinTesters: 5,
  relaunchMinPct: 70,
  perfectCitedMinPct: 80,
  identifiedMinPct: 80,
  firstEncounterSuccessMinPct: 80,
  touchVsKeyboardMinPct: 80,
  laughedMinPct: 80,
};

const INPUTS = {
  folder: 'journals',
  observationsPath: null,
  levels: ['salon_crawler'],
  contentHashes: ['c0c0c0c0c0c0c0'],
  filesRead: 0,
  skipped: [],
};

let fileCount = 0;

/** A tester with one journal per spec. */
function tester(testerId: string, ...specs: JournalSpec[]): TesterGames {
  return {
    testerId,
    games: specs.map((spec) => ({
      file: `${testerId}/${++fileCount}.json`,
      journal: makeJournal(spec),
    })),
  };
}

function note(row: Partial<ObservationRow> & { testerId: string }): ObservationRow {
  return {
    line: 2,
    sessionId: null,
    threatId: null,
    identifiedWithoutHelp: null,
    perfectCitedSpontaneously: null,
    laughs: null,
    comment: '',
    ...row,
  };
}

function run(
  testers: TesterGames[],
  observations: ObservationRow[] = [],
  overrides: Partial<ComputeMetricsInput> = {},
): PlaytestReport {
  return computeMetrics({
    testers,
    observations,
    thresholds: THRESHOLDS,
    inputs: INPUTS,
    ...overrides,
  });
}

function responses(
  threat: string,
  quality: ResponseSpec['quality'],
  count: number,
  device: ResponseSpec['device'] = 'touch',
): ResponseSpec[] {
  return Array.from({ length: count }, () => ({ threat, quality, device }));
}

describe('computeMetrics: relaunch', () => {
  it('counts a lone game 2 as a relaunch, and a lone game 1 as none', () => {
    const report = run([
      tester('T1', { sessionId: '00000001', gameIndex: 2 }),
      tester('T2', { sessionId: '00000002', gameIndex: 1 }),
    ]);
    expect(report.testers[0]?.relaunch).toEqual({
      games: 1,
      highestGameIndex: 2,
      relaunched: true,
    });
    expect(report.testers[1]?.relaunch).toEqual({
      games: 1,
      highestGameIndex: 1,
      relaunched: false,
    });
    expect(report.relaunch).toEqual({
      hits: 1,
      count: 2,
      valuePct: 50,
      thresholdPct: 70,
      status: 'KO',
    });
  });

  it('is OK at exactly the threshold, with integers (7 of 10 at 70)', () => {
    const testers = Array.from({ length: 10 }, (_, i) =>
      tester(`T${i + 1}`, { sessionId: `0000000${i}`.slice(-8), gameIndex: i < 7 ? 2 : 1 }),
    );
    const report = run(testers);
    expect(report.relaunch).toEqual({
      hits: 7,
      count: 10,
      valuePct: 70,
      thresholdPct: 70,
      status: 'OK',
    });
  });

  it('leaves out a tester who has notes and no usable journal (a typo in the id), and says so', () => {
    const report = run(
      [tester('T1', { sessionId: '00000001', gameIndex: 2 })],
      [note({ testerId: 't1', line: 4, laughs: 1 }), note({ testerId: 't1', line: 6 })],
    );
    expect(report.relaunch).toMatchObject({ hits: 1, count: 1, status: 'OK' });
    expect(report.testers.map((t) => t.testerId)).toEqual(['T1']);
    expect(report.laughed.count).toBe(0);
    expect(report.panel).toEqual({ testers: 1, minTesters: 5, status: 'KO' });
    expect(report.warnings).toContain(
      'tester t1 has notes (lines 4, 6) and no usable journal: the notes are ignored; check the id against the journal folders',
    );
  });
});

describe('computeMetrics: first encounter', () => {
  it('takes the threat from game 2 when game 1 lacks it', () => {
    const report = run([
      tester(
        'T1',
        {
          sessionId: '00000001',
          gameIndex: 2,
          responses: [
            { threat: 'stairs', quality: 'fail' },
            { threat: 'outlet', quality: 'perfect' },
          ],
        },
        { sessionId: '00000001', gameIndex: 1, responses: [{ threat: 'outlet', quality: 'fail' }] },
      ),
    ]);
    // Game 1 first (outlet fails), then game 2 (stairs fails): the outlet's first encounter is the failed one.
    expect(report.testers[0]?.firstEncounter).toEqual({ outlet: 'fail', stairs: 'fail' });
    const lacking = run([
      tester(
        'T1',
        {
          sessionId: '00000001',
          gameIndex: 1,
          responses: [{ threat: 'outlet', quality: 'success' }],
        },
        {
          sessionId: '00000001',
          gameIndex: 2,
          responses: [
            { threat: 'stairs', quality: 'fail' },
            { threat: 'outlet', quality: 'fail' },
          ],
        },
      ),
    ]);
    expect(lacking.testers[0]?.firstEncounter).toEqual({ outlet: 'success', stairs: 'fail' });
  });

  it('counts a perfect and a success as success, and ignores later entries', () => {
    const report = run([
      tester('T1', {
        responses: [
          { threat: 'outlet', quality: 'perfect' },
          { threat: 'outlet', quality: 'fail' },
        ],
      }),
      tester('T2', {
        sessionId: '00000002',
        responses: [{ threat: 'outlet', quality: 'success' }],
      }),
      tester('T3', {
        sessionId: '00000003',
        responses: [
          { threat: 'outlet', quality: 'fail' },
          { threat: 'outlet', quality: 'perfect' },
        ],
      }),
    ]);
    expect(report.firstEncounter.byThreat.outlet).toEqual({
      hits: 2,
      count: 3,
      valuePct: 66.6,
      thresholdPct: 80,
      status: 'KO',
    });
    expect(report.firstEncounter.status).toBe('KO');
  });

  it('does not count a threat a tester never resolved as a fail', () => {
    const report = run([
      tester('T1', { responses: [{ threat: 'outlet', quality: 'success' }] }),
      tester('T2', {
        sessionId: '00000002',
        responses: [
          { threat: 'outlet', quality: 'success' },
          { threat: 'stairs', quality: 'fail' },
        ],
      }),
    ]);
    expect(report.firstEncounter.byThreat.outlet).toMatchObject({
      hits: 2,
      count: 2,
      status: 'OK',
    });
    expect(report.firstEncounter.byThreat.stairs).toMatchObject({
      hits: 0,
      count: 1,
      status: 'KO',
    });
    expect(Object.keys(report.firstEncounter.byThreat)).toEqual(['outlet', 'stairs']);
    // One threat is KO, so the indicator is KO.
    expect(report.firstEncounter.status).toBe('KO');
  });

  it('is OK only when every threat is OK', () => {
    const report = run([
      tester('T1', {
        responses: [
          { threat: 'outlet', quality: 'success' },
          { threat: 'stairs', quality: 'perfect' },
        ],
      }),
    ]);
    expect(report.firstEncounter.status).toBe('OK');
  });
});

describe('computeMetrics: session order', () => {
  const sessionA = {
    sessionId: 'aaaaaaaa',
    gameIndex: 1,
    responses: [{ threat: 'outlet', quality: 'fail' as const }],
  };
  const sessionB = {
    sessionId: 'bbbbbbbb',
    gameIndex: 1,
    responses: [{ threat: 'outlet', quality: 'success' as const }],
  };

  it('takes the order of the notes, then the others by id', () => {
    const report = run(
      [tester('T1', sessionA, sessionB)],
      [
        note({ testerId: 'T1', sessionId: 'bbbbbbbb', laughs: 1 }),
        note({ testerId: 'T1', sessionId: 'aaaaaaaa', laughs: 0 }),
      ],
    );
    expect(report.testers[0]?.games.map((g) => g.sessionId)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
    expect(report.testers[0]?.firstEncounter).toEqual({ outlet: 'success' });
    expect(report.warnings.filter((w) => w.includes('session order unknown'))).toEqual([]);
  });

  it('sorts by session id and warns when the notes do not order the sessions', () => {
    const report = run([tester('T1', sessionB, sessionA)]);
    expect(report.testers[0]?.games.map((g) => g.sessionId)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    expect(report.testers[0]?.firstEncounter).toEqual({ outlet: 'fail' });
    expect(report.warnings).toContain(
      'tester T1 has 2 sessions and the notes do not order them all: session order unknown, first encounters may be wrong',
    );
  });

  it('warns when only some sessions are in the notes', () => {
    const report = run(
      [tester('T1', sessionA, sessionB)],
      [note({ testerId: 'T1', sessionId: 'bbbbbbbb', laughs: 1 })],
    );
    expect(report.testers[0]?.games.map((g) => g.sessionId)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
    expect(report.warnings.some((w) => w.includes('session order unknown'))).toBe(true);
  });

  it('does not warn about the order for a tester with one session', () => {
    const report = run([tester('T1', sessionA)]);
    expect(report.warnings.some((w) => w.includes('session order'))).toBe(false);
  });

  it('warns about a session whose game 1 is missing', () => {
    const report = run([tester('T1', { sessionId: 'aaaaaaaa', gameIndex: 2 })]);
    expect(report.warnings).toContain(
      'tester T1 session aaaaaaaa has no game 1: its first encounters may be those of a later game, and its device rates cover only the games sent',
    );
  });

  it('warns about a note for a session that is not one of the tester’s journals', () => {
    const report = run(
      [tester('T1', { sessionId: 'aaaaaaaa' })],
      [note({ testerId: 'T1', sessionId: 'cccccccc', line: 7, laughs: 1 })],
    );
    expect(report.warnings).toContain(
      "observations line 7: session cccccccc is not one of T1's journals",
    );
  });
});

describe('computeMetrics: touch vs keyboard', () => {
  it('has no ratio for a tester who used touch only, and n/a overall', () => {
    const report = run([tester('T1', { responses: responses('outlet', 'success', 4) })]);
    expect(report.testers[0]?.rates).toEqual({ touch: { hits: 4, total: 4, ratePct: 100 } });
    expect(report.testers[0]?.touchVsKeyboardPct).toBeNull();
    expect(report.touchVsKeyboard.ratioPct).toBeNull();
    expect(report.touchVsKeyboard.status).toBe('n/a');
  });

  it('pools every response of every tester: 4 of 5 on touch against 5 of 5 on keyboard is exactly 80 %', () => {
    const touch = [...responses('outlet', 'success', 4), ...responses('outlet', 'fail', 1)];
    const report = run([
      tester('T1', { sessionId: '00000001', responses: touch }),
      tester('T2', {
        sessionId: '00000002',
        responses: responses('outlet', 'perfect', 5, 'keyboard'),
      }),
    ]);
    expect(report.touchVsKeyboard.rates.touch).toEqual({ hits: 4, total: 5, ratePct: 80 });
    expect(report.touchVsKeyboard.rates.keyboard).toEqual({ hits: 5, total: 5, ratePct: 100 });
    expect(report.touchVsKeyboard.ratioPct).toBe(80);
    expect(report.touchVsKeyboard.status).toBe('OK');
  });

  it('is KO just under the threshold: 3 of 5 on touch against 5 of 5 on keyboard is 60 %', () => {
    const touch = [...responses('outlet', 'success', 3), ...responses('outlet', 'fail', 2)];
    const report = run([
      tester('T1', { sessionId: '00000001', responses: touch }),
      tester('T2', {
        sessionId: '00000002',
        responses: responses('outlet', 'perfect', 5, 'keyboard'),
      }),
    ]);
    expect(report.touchVsKeyboard.ratioPct).toBe(60);
    expect(report.touchVsKeyboard.status).toBe('KO');
  });

  it('gives a per-tester ratio to a tester who used both', () => {
    const report = run([
      tester('T1', {
        responses: [
          ...responses('outlet', 'success', 1),
          ...responses('outlet', 'fail', 1),
          ...responses('outlet', 'success', 2, 'keyboard'),
        ],
      }),
    ]);
    expect(report.testers[0]?.rates).toEqual({
      touch: { hits: 1, total: 2, ratePct: 50 },
      keyboard: { hits: 2, total: 2, ratePct: 100 },
    });
    expect(report.testers[0]?.touchVsKeyboardPct).toBe(50);
  });

  it('keeps mouse, gamepad and none out of the ratio but shows their rates', () => {
    const report = run([
      tester('T1', {
        sessionId: '00000001',
        responses: [
          ...responses('outlet', 'success', 2),
          ...responses('outlet', 'fail', 6, 'mouse'),
          ...responses('outlet', 'fail', 3, 'none'),
          ...responses('outlet', 'success', 1, 'gamepad'),
        ],
      }),
      tester('T2', {
        sessionId: '00000002',
        responses: responses('outlet', 'success', 2, 'keyboard'),
      }),
    ]);
    expect(report.touchVsKeyboard.ratioPct).toBe(100);
    expect(report.touchVsKeyboard.status).toBe('OK');
    expect(report.touchVsKeyboard.rates.mouse).toEqual({ hits: 0, total: 6, ratePct: 0 });
    expect(report.touchVsKeyboard.rates.none).toEqual({ hits: 0, total: 3, ratePct: 0 });
    expect(report.touchVsKeyboard.rates.gamepad).toEqual({ hits: 1, total: 1, ratePct: 100 });
  });

  it('is n/a when the keyboard rate is 0 (the ratio is undefined)', () => {
    const report = run([
      tester('T1', { sessionId: '00000001', responses: responses('outlet', 'success', 2) }),
      tester('T2', {
        sessionId: '00000002',
        responses: responses('outlet', 'fail', 2, 'keyboard'),
      }),
    ]);
    expect(report.touchVsKeyboard.ratioPct).toBeNull();
    expect(report.touchVsKeyboard.status).toBe('n/a');
  });
});

describe('computeMetrics: observed indicators', () => {
  /** One game per tester id, each in its own session. */
  function journalsOf(...ids: string[]): TesterGames[] {
    return ids.map((id, i) => tester(id, { sessionId: `0000000${i}` }));
  }

  function panel(laughsByTester: (number | null)[]): PlaytestReport {
    const notes = laughsByTester.map((laughs, i) => note({ testerId: `T${i + 1}`, laughs }));
    return run(journalsOf(...laughsByTester.map((_, i) => `T${i + 1}`)), notes);
  }

  it('laughed: 4 of 5 at 80 is OK, exactly', () => {
    const report = panel([1, 3, 2, 1, 0]);
    expect(report.laughed).toEqual({
      hits: 4,
      count: 5,
      valuePct: 80,
      thresholdPct: 80,
      status: 'OK',
    });
    expect(report.panel).toEqual({ testers: 5, minTesters: 5, status: 'OK' });
  });

  it('laughed: 3 of 5 at 80 is KO', () => {
    const report = panel([1, 3, 2, 0, 0]);
    expect(report.laughed).toEqual({
      hits: 3,
      count: 5,
      valuePct: 60,
      thresholdPct: 80,
      status: 'KO',
    });
  });

  it('sums the laughs of a tester over rows and ignores a tester with every cell empty', () => {
    const report = run(journalsOf('T1', 'T2'), [
      note({ testerId: 'T1', laughs: 0 }),
      note({ testerId: 'T1', laughs: 2, threatId: 'outlet', identifiedWithoutHelp: true }),
      note({ testerId: 'T2' }),
    ]);
    expect(report.testers[0]).toMatchObject({ laughs: 2, laughed: true });
    expect(report.testers[1]).toMatchObject({ laughs: null, laughed: null });
    expect(report.laughed).toMatchObject({ hits: 1, count: 1, status: 'OK' });
  });

  it('perfect parry: O if any row says O, N if rows say only N, n/a if all empty', () => {
    const report = run(journalsOf('T1', 'T2', 'T3'), [
      note({ testerId: 'T1', perfectCitedSpontaneously: false }),
      note({ testerId: 'T1', perfectCitedSpontaneously: true }),
      note({ testerId: 'T2', perfectCitedSpontaneously: false }),
      note({ testerId: 'T3', laughs: 1 }),
    ]);
    expect(report.testers.map((t) => t.perfectCited)).toEqual([true, false, null]);
    expect(report.perfectCited).toEqual({
      hits: 1,
      count: 2,
      valuePct: 50,
      thresholdPct: 80,
      status: 'KO',
    });
  });

  it('identification: a share per threat, OK only if every threat is OK', () => {
    const rows = [
      ...['T1', 'T2', 'T3', 'T4', 'T5'].map((id) =>
        note({ testerId: id, threatId: 'outlet', identifiedWithoutHelp: true }),
      ),
      ...['T1', 'T2', 'T3', 'T4'].map((id) =>
        note({ testerId: id, threatId: 'stairs', identifiedWithoutHelp: id !== 'T4' }),
      ),
    ];
    const report = run(journalsOf('T1', 'T2', 'T3', 'T4', 'T5'), rows);
    expect(report.identification.byThreat.outlet).toEqual({
      hits: 5,
      count: 5,
      valuePct: 100,
      thresholdPct: 80,
      status: 'OK',
    });
    expect(report.identification.byThreat.stairs).toEqual({
      hits: 3,
      count: 4,
      valuePct: 75,
      thresholdPct: 80,
      status: 'KO',
    });
    expect(report.identification.status).toBe('KO');
  });

  it('identification with several sessions: the row with no session, else the first session in order', () => {
    const journals = tester('T1', { sessionId: 'aaaaaaaa' }, { sessionId: 'bbbbbbbb' });
    const bySession = run(
      [journals],
      [
        note({
          testerId: 'T1',
          sessionId: 'bbbbbbbb',
          threatId: 'outlet',
          identifiedWithoutHelp: false,
        }),
        note({
          testerId: 'T1',
          sessionId: 'aaaaaaaa',
          threatId: 'outlet',
          identifiedWithoutHelp: true,
        }),
      ],
    );
    // The notes name bbbbbbbb first, so that session's judgment is the first encounter's.
    expect(bySession.testers[0]?.identifiedWithoutHelp).toEqual({ outlet: false });
    const withEmpty = run(
      [journals],
      [
        note({
          testerId: 'T1',
          sessionId: 'bbbbbbbb',
          threatId: 'outlet',
          identifiedWithoutHelp: false,
        }),
        note({ testerId: 'T1', threatId: 'outlet', identifiedWithoutHelp: true, line: 3 }),
      ],
    );
    expect(withEmpty.testers[0]?.identifiedWithoutHelp).toEqual({ outlet: true });
  });

  it('keeps the comments of a tester, trimmed, with their line and context', () => {
    const report = run(journalsOf('T1'), [
      note({
        testerId: 'T1',
        line: 4,
        threatId: 'stairs',
        identifiedWithoutHelp: false,
        comment: ' tapé trop tôt ',
      }),
      note({ testerId: 'T1', line: 5, laughs: 1, comment: '   ' }),
    ]);
    expect(report.testers[0]?.comments).toEqual([
      { line: 4, sessionId: null, threatId: 'stairs', text: 'tapé trop tôt' },
    ]);
  });
});

describe('computeMetrics: panel and empty data', () => {
  it('everything is n/a with no tester, and the panel is KO', () => {
    const report = run([]);
    expect(report.panel).toEqual({ testers: 0, minTesters: 5, status: 'KO' });
    expect(report.relaunch).toMatchObject({ hits: 0, count: 0, valuePct: null, status: 'n/a' });
    expect(report.perfectCited.status).toBe('n/a');
    expect(report.laughed.status).toBe('n/a');
    expect(report.identification).toEqual({ byThreat: {}, status: 'n/a' });
    expect(report.firstEncounter).toEqual({ byThreat: {}, status: 'n/a' });
    expect(report.touchVsKeyboard.status).toBe('n/a');
    expect(report.warnings).toEqual([
      'the panel is too small: 0 testers, FR68 asks for at least 5',
    ]);
  });

  it('a panel below the minimum is KO and says so, and the other indicators are still computed', () => {
    const report = run([
      tester('T1', { sessionId: '00000001', gameIndex: 2 }),
      tester('T2', { sessionId: '00000002', gameIndex: 2 }),
      tester('T3', { sessionId: '00000003', gameIndex: 1 }),
    ]);
    expect(report.panel).toEqual({ testers: 3, minTesters: 5, status: 'KO' });
    expect(report.relaunch).toMatchObject({ hits: 2, count: 3, valuePct: 66.6, status: 'KO' });
    expect(report.warnings).toEqual([
      'tester T1 session 00000001 has no game 1: its first encounters may be those of a later game, and its device rates cover only the games sent',
      'tester T2 session 00000002 has no game 1: its first encounters may be those of a later game, and its device rates cover only the games sent',
      'the panel is too small: 3 testers, FR68 asks for at least 5',
    ]);
  });

  it('uses the thresholds it is given', () => {
    const report = run(
      [tester('T1', { gameIndex: 2 }), tester('T2', { sessionId: '00000002', gameIndex: 1 })],
      [],
      {
        thresholds: { ...THRESHOLDS, relaunchMinPct: 50, panelMinTesters: 2 },
      },
    );
    expect(report.relaunch.status).toBe('OK');
    expect(report.panel.status).toBe('OK');
  });

  it('puts the readers’ warnings first, and is deterministic', () => {
    const input = {
      testers: [tester('T1', { gameIndex: 2 })],
      observations: [],
      warnings: ['from the reader'],
    };
    const first = run(input.testers, input.observations, { warnings: input.warnings });
    const second = run(input.testers, input.observations, { warnings: input.warnings });
    expect(first.warnings[0]).toBe('from the reader');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.kind).toBe(PLAYTEST_REPORT_KIND);
    expect(first.version).toBe(1);
  });

  it('lists the games of a tester in play order, with level, end reason and stars', () => {
    const report = run([
      tester(
        'T1',
        {
          sessionId: '00000001',
          gameIndex: 2,
          endReason: 'mamaWoke',
          stars: 1,
          levelId: 'salon_crawler',
        },
        { sessionId: '00000001', gameIndex: 1, stars: 3 },
      ),
    ]);
    expect(
      report.testers[0]?.games.map((g) => [g.gameIndex, g.endReason, g.stars, g.levelId]),
    ).toEqual([
      [1, 'timer', 3, 'salon_crawler'],
      [2, 'mamaWoke', 1, 'salon_crawler'],
    ]);
    expect(report.testers[0]).toMatchObject({ deviceTypes: ['phone'], platforms: ['ios'] });
  });
});

describe('computeMetrics: review fixes', () => {
  it('truncates a share instead of rounding it: 79.96 % is not shown as the 80 it misses', () => {
    const report = run([
      tester('T1', {
        sessionId: '00000001',
        responses: [...responses('outlet', 'success', 15), ...responses('outlet', 'fail', 5)],
      }),
      tester('T2', {
        sessionId: '00000002',
        responses: [
          ...responses('outlet', 'success', 106, 'keyboard'),
          ...responses('outlet', 'fail', 7, 'keyboard'),
        ],
      }),
    ]);
    expect(report.touchVsKeyboard.ratioPct).toBe(79.9);
    expect(report.touchVsKeyboard.status).toBe('KO');
    expect(report.touchVsKeyboard.rates.keyboard.ratePct).toBe(93.8);
  });

  it('warns when the keyboard rate is 0 and the ratio is therefore undefined', () => {
    const report = run([
      tester('T1', { sessionId: '00000001', responses: responses('outlet', 'success', 2) }),
      tester('T2', {
        sessionId: '00000002',
        responses: responses('outlet', 'fail', 2, 'keyboard'),
      }),
    ]);
    expect(report.touchVsKeyboard.status).toBe('n/a');
    expect(report.warnings).toContain(
      'indicator 4: the keyboard success rate is 0, so the touch vs keyboard ratio is undefined (n/a): look at the keyboard games',
    );
  });

  it('warns when an observed indicator is judged on fewer testers than the panel', () => {
    const report = run(
      [
        tester('T1', { sessionId: '00000001' }),
        tester('T2', { sessionId: '00000002' }),
        tester('T3', { sessionId: '00000003' }),
      ],
      [
        note({ testerId: 'T1', perfectCitedSpontaneously: true, laughs: 1 }),
        note({ testerId: 'T2', threatId: 'outlet', identifiedWithoutHelp: true }),
      ],
    );
    expect(report.warnings).toContain(
      'observed indicators judged on fewer testers than the panel (a blank cell is not counted): 2 (perfect parry): 1/3 testers; 3 (identification): outlet 1/3; 5 (laughs): 1/3 testers',
    );
  });

  it('does not repeat that warning when there are no notes at all', () => {
    const report = run([tester('T1')]);
    expect(report.warnings.some((w) => w.includes('fewer testers'))).toBe(false);
  });

  it('warns when a tester’s notes judge a threat differently on several rows, and keeps the earliest', () => {
    const report = run(
      [tester('T1', { sessionId: 'aaaaaaaa' }, { sessionId: 'bbbbbbbb' })],
      [
        note({
          testerId: 'T1',
          line: 2,
          sessionId: 'aaaaaaaa',
          threatId: 'outlet',
          identifiedWithoutHelp: true,
        }),
        note({
          testerId: 'T1',
          line: 3,
          sessionId: 'bbbbbbbb',
          threatId: 'outlet',
          identifiedWithoutHelp: false,
        }),
      ],
    );
    expect(report.testers[0]?.identifiedWithoutHelp).toEqual({ outlet: true });
    expect(report.warnings).toContain(
      "tester T1: the notes judge outlet differently on several rows: the earliest session's judgment (line 2) counts",
    );
  });

  it('does not warn when the rows agree', () => {
    const agree = (sessionId: string) =>
      note({ testerId: 'T1', sessionId, threatId: 'outlet', identifiedWithoutHelp: true });
    const report = run(
      [tester('T1', { sessionId: 'aaaaaaaa' }, { sessionId: 'bbbbbbbb' })],
      [agree('aaaaaaaa'), agree('bbbbbbbb')],
    );
    expect(report.warnings.some((w) => w.includes('differently'))).toBe(false);
  });

  it('warns when the journals mix levels or content versions', () => {
    const report = run([tester('T1')], [], {
      inputs: { ...INPUTS, levels: ['a_level', 'b_level'], contentHashes: ['aaaa', 'bbbb'] },
    });
    expect(report.warnings).toContain(
      'the journals mix 2 levels (a_level, b_level): relaunches and first encounters span all of them',
    );
    expect(report.warnings).toContain(
      'the journals come from 2 content versions (aaaa, bbbb): the games were not all played on the same build',
    );
  });

  it('handles a threat id that is a property of Object.prototype', () => {
    const report = run(
      [tester('T1', { responses: [{ threat: 'constructor', quality: 'success' }] })],
      [note({ testerId: 'T1', threatId: 'constructor', identifiedWithoutHelp: true })],
    );
    expect(report.testers[0]?.firstEncounter).toEqual({ constructor: 'success' });
    expect(Object.hasOwn(report.firstEncounter.byThreat, 'constructor')).toBe(true);
    expect(report.firstEncounter.byThreat.constructor).toMatchObject({ hits: 1, count: 1 });
    expect(report.identification.byThreat.constructor).toMatchObject({ hits: 1, count: 1 });
  });
});
