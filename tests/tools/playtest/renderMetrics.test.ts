import type { PlaytestThresholds } from '@content/schemas/playtest';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../../tools/playtest/computeMetrics.ts';
import { renderJson, renderMetrics } from '../../../tools/playtest/renderMetrics.ts';
import { makeJournal } from './support.ts';

const THRESHOLDS: PlaytestThresholds = {
  panelMinTesters: 2,
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

function report() {
  return computeMetrics({
    thresholds: THRESHOLDS,
    testers: [
      {
        testerId: 'T1',
        games: [
          {
            file: 'T1/a.json',
            journal: makeJournal({
              sessionId: '00000001',
              gameIndex: 1,
              responses: [
                { threat: 'outlet', quality: 'perfect' },
                { threat: 'stairs', quality: 'fail' },
              ],
            }),
          },
          {
            file: 'T1/b.json',
            journal: makeJournal({ sessionId: '00000001', gameIndex: 2, endReason: 'mamaWoke' }),
          },
        ],
      },
      {
        testerId: 'T2',
        games: [
          {
            file: 'T2/a.json',
            journal: makeJournal({
              sessionId: '00000002',
              responses: [{ threat: 'outlet', quality: 'success', device: 'keyboard' }],
            }),
          },
        ],
      },
    ],
    observations: [
      {
        line: 2,
        testerId: 'T1',
        sessionId: null,
        threatId: 'outlet',
        identifiedWithoutHelp: true,
        perfectCitedSpontaneously: null,
        laughs: null,
        activityId: null,
        activityNamed: null,
        repetitivePoseCited: null,
        comment: '',
      },
      {
        line: 3,
        testerId: 'T1',
        sessionId: null,
        threatId: null,
        identifiedWithoutHelp: null,
        perfectCitedSpontaneously: true,
        laughs: 2,
        activityId: null,
        activityNamed: null,
        repetitivePoseCited: false,
        comment: 'A ri | fort',
      },
      // Indicator 6 (story 7.12): T1 names the coffee and not the phone; T2 the coffee and finds a pose repetitive.
      {
        line: 4,
        testerId: 'T1',
        sessionId: null,
        threatId: null,
        identifiedWithoutHelp: null,
        perfectCitedSpontaneously: null,
        laughs: null,
        activityId: 'coffee',
        activityNamed: true,
        repetitivePoseCited: null,
        comment: '',
      },
      {
        line: 5,
        testerId: 'T1',
        sessionId: null,
        threatId: null,
        identifiedWithoutHelp: null,
        perfectCitedSpontaneously: null,
        laughs: null,
        activityId: 'phone',
        activityNamed: false,
        repetitivePoseCited: null,
        comment: 'sans bulle',
      },
      {
        line: 6,
        testerId: 'T2',
        sessionId: null,
        threatId: null,
        identifiedWithoutHelp: null,
        perfectCitedSpontaneously: null,
        laughs: null,
        activityId: 'coffee',
        activityNamed: true,
        repetitivePoseCited: true,
        comment: '',
      },
    ],
    inputs: {
      folder: 'journals',
      observationsPath: 'notes.csv',
      levels: ['salon_crawler'],
      contentHashes: ['c0c0c0c0c0c0c0'],
      filesRead: 3,
      skipped: [{ file: 'T1/c.json', reason: 'played by the perfect bot' }],
    },
  });
}

describe('renderMetrics', () => {
  it('renders the summary table, in the order of NFR11 with the panel first', () => {
    const markdown = renderMetrics(report());
    const rows = markdown
      .split('\n')
      .filter((line) => line.startsWith('| ') && /\| (OK|KO|n\/a) \|$/.test(line))
      .map((line) => line.split(' | ').slice(0, 1)[0]?.replace('| ', ''));
    expect(rows).toEqual([
      'Panel (FR68)',
      '1. Relaunch, without being asked (computed)',
      '2. Perfect parry cited as a high point (observed)',
      '3. Readability: identified without help, each threat (observed)',
      '3 (proxy). First-encounter success, each threat (computed)',
      '4. Touch success rate vs keyboard (computed)',
      '5. Laughed at least once (observed)',
      '6. Papa reads without his bubble, each activity (observed)',
      '6. No repetitive pose cited (observed)',
    ]);
    expect(markdown).toContain(
      '| 6. Papa reads without his bubble, each activity (observed) | lowest: phone 0 % (0/1) | ≥ 80 % | 1–2 | KO |',
    );
    expect(markdown).toContain(
      '| 6. No repetitive pose cited (observed) | 1 tester cited one | ≤ 0 testers | 2 | KO |',
    );
    expect(markdown).toContain(
      '| 1. Relaunch, without being asked (computed) | 50 % (1/2) | ≥ 70 % | 2 | KO |',
    );
    expect(markdown).toContain(
      '| 5. Laughed at least once (observed) | 100 % (1/1) | ≥ 80 % | 1 | OK |',
    );
  });

  it("renders indicator 6 per activity, and each tester's activities and repetitive pose (story 7.12)", () => {
    const markdown = renderMetrics(report());
    expect(markdown).toContain('## Indicator 6 per activity');
    expect(markdown).toContain('| Activity | T1 | T2 | Share |');
    expect(markdown).toContain('| coffee | ✓ | ✓ | 100 % (2/2) |');
    expect(markdown).toContain('| phone | ✗ | — | 0 % (0/1) |');
    expect(markdown).toContain('- Activities named: coffee O, phone N');
    expect(markdown).toContain('- Repetitive pose cited: N');
    expect(markdown).toContain('- Repetitive pose cited: O');
    expect(markdown).toContain('- (line 5, phone) sans bulle');
  });

  it('renders the per-threat tables with ✓ ✗ and — per tester', () => {
    const markdown = renderMetrics(report());
    expect(markdown).toContain('| Threat | T1 | T2 | Share |');
    expect(markdown).toContain('| outlet | ✓ | — | 100 % (1/1) |');
    expect(markdown).toContain('| outlet | ✓ | ✓ | 100 % (2/2) |');
    expect(markdown).toContain('| stairs | ✗ | — | 0 % (0/1) |');
  });

  it('renders each tester with their games, comments and the inputs', () => {
    const markdown = renderMetrics(report());
    expect(markdown).toContain('| T1/b.json | 00000001 | 2 | salon_crawler | mamaWoke | 2 |');
    expect(markdown).toContain('- Relaunch: yes (2 games, highest game index 2)');
    expect(markdown).toContain('- (line 3) A ri | fort');
    expect(markdown).toContain('- Observations: notes.csv');
    expect(markdown).toContain('- Levels: salon_crawler');
    expect(markdown).toContain('- T1/c.json: played by the perfect bot');
  });

  it('renders the same bytes twice and holds no date', () => {
    expect(renderMetrics(report())).toBe(renderMetrics(report()));
    expect(renderJson(report())).toBe(renderJson(report()));
    expect(renderMetrics(report())).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('renderMetrics: text from files', () => {
  it('keeps a comment, a warning and a skip reason with line breaks on one line', () => {
    const value = report();
    const tester = value.testers[0];
    if (tester === undefined) throw new Error('no tester');
    tester.comments = [
      {
        line: 9,
        sessionId: null,
        threatId: null,
        activityId: null,
        text: 'a ri\r\n# fort\rpuis | non',
      },
    ];
    value.warnings = ['first line\nsecond line\r\nthird'];
    value.inputs.skipped = [{ file: 'T1/c.json', reason: 'one\r\ntwo' }];
    const markdown = renderMetrics(value);
    expect(markdown).toContain('- (line 9) a ri # fort puis | non');
    expect(markdown).toContain('- first line second line third');
    expect(markdown).toContain('- T1/c.json: one two');
    expect(markdown).not.toContain('\r');
  });
});

describe('renderJson', () => {
  it('is the report, indented by two spaces, with a final newline', () => {
    const value = report();
    const text = renderJson(value);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "kind": "papa-parade.playtest-metrics",\n  "version": 3,')).toBe(
      true,
    );
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
  });
});
