import type { JournalFile } from '@content/schemas/journal';
import type { PlaytestThresholds } from '@content/schemas/playtest';
import { describe, expect, it } from 'vitest';
import { computeMetrics, ownValue } from '../../../tools/playtest/computeMetrics.ts';
import { renderMetrics } from '../../../tools/playtest/renderMetrics.ts';
import { makeJournal } from './support.ts';

// The success rate per sequence and per step (story 4.10, AC 15): rates, no threshold, no status.
const THRESHOLDS: PlaytestThresholds = {
  panelMinTesters: 1,
  relaunchMinPct: 70,
  perfectCitedMinPct: 80,
  identifiedMinPct: 80,
  firstEncounterSuccessMinPct: 80,
  touchVsKeyboardMinPct: 80,
  laughedMinPct: 80,
  bodyRead: {
    activities: ['chore', 'coffee', 'phone', 'stealth', 'fatigue', 'carrying'],
    namedMinPct: 80,
    repetitivePoseMaxTesters: 0,
  },
};

type Attempts = NonNullable<JournalFile['summary']['sequences']>;

function journalWith(sequences: Attempts | undefined, endReason = 'timer'): JournalFile {
  const journal = makeJournal({ endReason });
  if (sequences !== undefined) journal.summary.sequences = sequences;
  return journal;
}

function reportOf(...journals: JournalFile[]) {
  return computeMetrics({
    thresholds: THRESHOLDS,
    testers: [
      {
        testerId: 'T1',
        games: journals.map((journal, index) => ({ file: `T1/${index}.json`, journal })),
      },
    ],
    observations: [],
    inputs: {
      folder: 'x',
      observationsPath: null,
      levels: [],
      contentHashes: [],
      filesRead: journals.length,
      skipped: [],
    },
  });
}

const attempt = (
  id: string,
  outcome: Attempts[number]['outcome'],
  steps: Attempts[number]['steps'] = [],
): Attempts[number] => ({ id, t: 1000, outcome, steps });

describe('the sequences of the playtest report', () => {
  it('rates each sequence and step on what was decided: a game cut by the level end does not count', () => {
    const report = reportOf(
      journalWith([
        attempt('bedtime_duel', 'failed', [
          { stepIndex: 0, outcome: 'passed' },
          { stepIndex: 1, outcome: 'failed' },
        ]),
        attempt('bedtime_duel', 'succeeded', [
          { stepIndex: 0, outcome: 'passed' },
          { stepIndex: 1, outcome: 'passed' },
        ]),
        attempt('bedtime_duel', 'levelEnded', [{ stepIndex: 0, outcome: 'cut' }]),
      ]),
    );
    expect(report.sequences.bySequence.bedtime_duel).toEqual({
      attempts: 3,
      succeeded: 1,
      failed: 1,
      cut: 1,
      ratePct: 50,
      steps: [
        { stepIndex: 0, attempts: 3, passed: 2, failed: 0, cut: 1, ratePct: 100 },
        { stepIndex: 1, attempts: 2, passed: 1, failed: 1, cut: 0, ratePct: 50 },
      ],
    });
  });

  it('gives no rate for a sequence only ever cut', () => {
    const report = reportOf(journalWith([attempt('stay_awake', 'levelEnded')]));
    expect(report.sequences.bySequence.stay_awake?.ratePct).toBeNull();
  });

  it('truncates a share, as every other share of the report', () => {
    const report = reportOf(
      journalWith([
        attempt('stay_awake', 'succeeded'),
        attempt('stay_awake', 'succeeded'),
        attempt('stay_awake', 'failed'),
      ]),
    );
    expect(report.sequences.bySequence.stay_awake?.ratePct).toBe(66.6);
  });

  it('counts the games with a sequence, and those that completed the cycle', () => {
    const report = reportOf(
      journalWith([attempt('stay_awake', 'succeeded')], 'cycleDone'),
      journalWith([attempt('stay_awake', 'failed')], 'mamaWoke'),
      journalWith([], 'timer'),
    );
    expect(report.sequences.games).toBe(2);
    expect(report.sequences.cycleCompletedGames).toBe(1);
    expect(report.testers[0]?.sequences.games).toBe(2);
  });

  it('takes an old journal with no key, adding nothing and warning of nothing', () => {
    const old = reportOf(journalWith(undefined));
    const none = reportOf(journalWith([]));
    expect(old.sequences).toEqual({ games: 0, cycleCompletedGames: 0, bySequence: {} });
    expect(old.warnings).toEqual(none.warnings);
  });

  it('keeps a sequence id such as constructor apart from Object.prototype, and sorts by id', () => {
    const report = reportOf(
      journalWith([attempt('zebra', 'succeeded'), attempt('constructor', 'failed')]),
    );
    expect(Object.keys(report.sequences.bySequence)).toEqual(['constructor', 'zebra']);
    expect(ownValue(report.sequences.bySequence, 'constructor')?.failed).toBe(1);
  });

  it('adds no threshold and no status', () => {
    const report = reportOf(journalWith([attempt('stay_awake', 'failed')]));
    expect(JSON.stringify(report.sequences)).not.toMatch(/status|threshold/i);
  });
});

describe('the Séquences section of the Markdown', () => {
  it('comes after the indicators, with a line per sequence and per step', () => {
    const text = renderMetrics(
      reportOf(
        journalWith(
          [attempt('bomb_drop', 'succeeded', [{ stepIndex: 0, outcome: 'passed' }])],
          'cycleDone',
        ),
      ),
    );
    expect(text.indexOf('## Séquences')).toBeGreaterThan(text.indexOf('## Indicator 3 per threat'));
    expect(text.indexOf('## Séquences')).toBeLessThan(text.indexOf('## Testers'));
    expect(text).toContain('1 game with a sequence, 1 ended with the cycle complete.');
    expect(text).toContain('bomb_drop');
  });

  it('is nothing at all when no journal has a sequence', () => {
    expect(renderMetrics(reportOf(journalWith(undefined)))).not.toContain('Séquences');
  });
});

describe('a sequence stays out of the five indicators (story 4.10, D9)', () => {
  const entry = (threatDefId: string, quality: 'success' | 'fail', inSequence: boolean) => ({
    t: 1000,
    threatDefId,
    quality,
    reason: null,
    offsetMs: 0,
    device: 'touch' as const,
    ...(inSequence ? { inSequence: true as const } : {}),
  });

  it('leaves its responses out of the first encounters and the device rates', () => {
    const journal = journalWith(undefined);
    journal.summary.responses.timeline = [
      entry('fake_sleep', 'fail', true),
      entry('outlet', 'success', false),
      entry('real_wake', 'success', true),
    ];
    journal.summary.responses.byDevice.touch = { perfect: 0, success: 2, fail: 1 };
    const report = reportOf(journal);
    expect(report.testers[0]?.firstEncounter).toEqual({ outlet: 'success' });
    expect(Object.keys(report.firstEncounter.byThreat)).toEqual(['outlet']);
    expect(report.firstEncounter.status).toBe('OK');
    expect(report.testers[0]?.rates.touch).toMatchObject({ hits: 1, total: 1 });
  });

  it('gives indicator 3 nothing to judge in a game of sequence responses only', () => {
    const journal = journalWith(undefined);
    journal.summary.responses.timeline = [entry('fake_sleep', 'fail', true)];
    journal.summary.responses.byDevice.touch = { perfect: 0, success: 0, fail: 1 };
    const report = reportOf(journal);
    expect(report.firstEncounter.status).toBe('n/a');
    expect(report.testers[0]?.rates.touch).toBeUndefined();
  });
});
