import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_READ_COLUMNS,
  OBSERVATION_COLUMNS,
  parseObservations,
} from '../../../tools/playtest/observations.ts';

/** The notes before story 7.12: no column of indicator 6 (they still load, the indicator n/a). */
const HEADER = OBSERVATION_COLUMNS.join(',');
/** Every column, the three of indicator 6 last (story 7.12, D14). */
const FULL_HEADER = [...OBSERVATION_COLUMNS, ...BODY_READ_COLUMNS].join(',');
const KNOWN = new Set(['outlet', 'stairs']);
const ACTIVITIES = new Set(['chore', 'coffee', 'phone']);
const NO_BODY_READ =
  'obs.csv: no activityId, activityNamed, repetitivePoseCited column: indicator 6 (Papa without his bubble) is n/a';

function parse(...lines: string[]) {
  return parseObservations([HEADER, ...lines].join('\n'), 'obs.csv', KNOWN, ACTIVITIES);
}

/** The same notes with the columns of indicator 6. */
function parseFull(...lines: string[]) {
  return parseObservations([FULL_HEADER, ...lines].join('\n'), 'obs.csv', KNOWN, ACTIVITIES);
}

function fullErrorsOf(...lines: string[]): string[] {
  const parsed = parseFull(...lines);
  if (parsed.ok) throw new Error('expected an error');
  return parsed.error;
}

function errorsOf(...lines: string[]): string[] {
  const parsed = parse(...lines);
  if (parsed.ok) throw new Error('expected an error');
  return parsed.error;
}

describe('parseObservations', () => {
  it('reads a threat row, a general row and an empty session as null', () => {
    const parsed = parse('T1,,outlet,o,,,trouvé seul', 'T1,1a2b3c4d,,,N,2,"rit, fort"');
    expect(parsed).toEqual({
      ok: true,
      value: {
        warnings: [NO_BODY_READ],
        rows: [
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
            comment: 'trouvé seul',
          },
          {
            line: 3,
            testerId: 'T1',
            sessionId: '1a2b3c4d',
            threatId: null,
            identifiedWithoutHelp: null,
            perfectCitedSpontaneously: false,
            laughs: 2,
            activityId: null,
            activityNamed: null,
            repetitivePoseCited: null,
            comment: 'rit, fort',
          },
        ],
      },
    });
  });

  it('accepts the columns in any order and a ";" file', () => {
    const text =
      'comment;laughs;testerId;sessionId;threatId;identifiedWithoutHelp;perfectCitedSpontaneously\nok;0;T9;;stairs;N;';
    const parsed = parseObservations(text, 'obs.csv', KNOWN);
    expect(parsed.ok && parsed.value.rows[0]).toMatchObject({
      testerId: 'T9',
      threatId: 'stairs',
      identifiedWithoutHelp: false,
      laughs: 0,
      comment: 'ok',
    });
  });

  it('names every missing column', () => {
    const parsed = parseObservations('testerId,comment\nT1,x', 'obs.csv', KNOWN);
    expect(parsed).toEqual({
      ok: false,
      error: [
        `obs.csv: missing columns sessionId, threatId, identifiedWithoutHelp, perfectCitedSpontaneously, laughs (expected: ${OBSERVATION_COLUMNS.join(', ')})`,
      ],
    });
  });

  it('warns about an extra column and ignores its values', () => {
    const parsed = parseObservations(`${FULL_HEADER},mood\nT1,,,,,,hi,,,,great`, 'obs.csv', KNOWN);
    expect(parsed.ok && parsed.value.warnings).toEqual(['obs.csv: extra column "mood" is ignored']);
    expect(parsed.ok && parsed.value.rows[0]?.comment).toBe('hi');
  });

  it('refuses a threat id that is not a known def, naming the known ones', () => {
    expect(errorsOf('T1,,bathtub,O,,,')).toEqual([
      expect.stringMatching(
        /^obs\.csv:2 column threatId: "bathtub" is not a threat def in content\/threats\/ \(known: .*outlet/,
      ),
    ]);
  });

  it('skips the threat check when the list of known threats is empty (it could not be read)', () => {
    const parsed = parseObservations(`${HEADER}\nT1,,bathtub,O,,,`, 'obs.csv', new Set());
    expect(parsed.ok && parsed.value.rows[0]?.threatId).toBe('bathtub');
  });

  it('refuses a column that appears twice in the header', () => {
    const parsed = parseObservations(`${HEADER},laughs\nT1,,,,,,,`, 'obs.csv', KNOWN);
    expect(parsed).toEqual({
      ok: false,
      error: ['obs.csv: column laughs appears twice in the header'],
    });
  });

  it('says that column names are case-sensitive when only the case differs', () => {
    const parsed = parseObservations(HEADER.replace('testerId', 'TesterId'), 'obs.csv', KNOWN);
    expect(!parsed.ok && parsed.error[0]).toContain('"TesterId" is not "testerId"');
  });

  it('refuses a bad tester id, naming the file, line and column', () => {
    expect(errorsOf('Tester 1,,,,,,')).toEqual([
      'obs.csv:2 column testerId: "Tester 1" is not a tester id (1-32 of A-Z a-z 0-9 _ -)',
    ]);
    expect(errorsOf(',,,,,,a note')).toEqual([
      'obs.csv:2 column testerId: "" is not a tester id (1-32 of A-Z a-z 0-9 _ -)',
    ]);
  });

  it('refuses a session id that is not 8 lowercase hex characters', () => {
    expect(errorsOf('T1,1A2B3C4D,,,,,')).toEqual([
      'obs.csv:2 column sessionId: "1A2B3C4D" must be empty or 8 lowercase hex characters',
    ]);
  });

  it('refuses a threat id that is not lower_snake_case', () => {
    expect(errorsOf('T1,,Outlet,O,,,')).toEqual([
      'obs.csv:2 column threatId: "Outlet" must be empty or a lower_snake_case id',
    ]);
  });

  it('requires O or N when a threat is set, and forbids a value when it is not', () => {
    expect(errorsOf('T1,,outlet,,,,')).toEqual([
      'obs.csv:2 column identifiedWithoutHelp: is required on a row about "outlet" (O or N)',
    ]);
    expect(errorsOf('T1,,outlet,maybe,,,')).toEqual([
      'obs.csv:2 column identifiedWithoutHelp: "maybe" must be O or N',
    ]);
    expect(errorsOf('T1,,,O,,,')).toEqual([
      'obs.csv:2 column identifiedWithoutHelp: must be empty on a row with no threatId',
    ]);
  });

  it('accepts O, N or empty for the perfect parry, nothing else', () => {
    expect(errorsOf('T1,,,,yes,,')).toEqual([
      'obs.csv:2 column perfectCitedSpontaneously: "yes" must be O, N or empty',
    ]);
  });

  it('accepts empty or a whole number of at least 0 for the laughs', () => {
    for (const bad of ['-1', '1.5', 'two', '1e3']) {
      expect(errorsOf(`T1,,,,,${bad},`)).toEqual([
        `obs.csv:2 column laughs: "${bad}" must be empty or a whole number of at least 0`,
      ]);
    }
    const parsed = parse('T1,,,,,0,', 'T1,,,,,7,');
    expect(parsed.ok && parsed.value.rows.map((row) => row.laughs)).toEqual([0, 7]);
  });

  it('refuses two judgments of one threat for a tester and session', () => {
    expect(errorsOf('T1,,outlet,O,,,', 'T1,,outlet,N,,,')).toEqual([
      'obs.csv:3: a second judgment of "outlet" for tester T1 (first on line 2): one row per threat and session',
    ]);
  });

  it('allows one threat for two sessions, two testers, and several general rows', () => {
    const parsed = parse(
      'T1,1a2b3c4d,outlet,O,,,',
      'T1,5e6f7a8b,outlet,N,,,',
      'T2,,outlet,O,,,',
      'T1,,,,O,1,',
      'T1,,,,,2,',
    );
    expect(parsed.ok).toBe(true);
  });

  it('collects every error of the file, each with its line', () => {
    expect(errorsOf('Bad id,,,,,,', 'T1,,outlet,x,,,', 'T1,,,,,-3,')).toEqual([
      'obs.csv:2 column testerId: "Bad id" is not a tester id (1-32 of A-Z a-z 0-9 _ -)',
      'obs.csv:3 column identifiedWithoutHelp: "x" must be O or N',
      'obs.csv:4 column laughs: "-3" must be empty or a whole number of at least 0',
    ]);
  });

  it('loads notes with none of the three columns of indicator 6, with one warning (story 7.12)', () => {
    const parsed = parse('T1,,outlet,O,,,');
    expect(parsed.ok && parsed.value.warnings).toEqual([NO_BODY_READ]);
    expect(parsed.ok && parsed.value.rows[0]).toMatchObject({
      activityId: null,
      activityNamed: null,
      repetitivePoseCited: null,
    });
  });

  it('refuses only some of the columns of indicator 6: they go together', () => {
    const parsed = parseObservations(`${HEADER},activityId\nT1,,,,,,,coffee`, 'obs.csv', KNOWN);
    expect(!parsed.ok && parsed.error).toEqual([
      'obs.csv: the columns of indicator 6 go together: missing activityNamed, repetitivePoseCited (expected: activityId, activityNamed, repetitivePoseCited)',
    ]);
  });

  it('reads an activity row and a repetitive pose on any row', () => {
    const parsed = parseFull('T1,,,,,,,coffee,O,', 'T1,,,,,,,phone,n,O', 'T2,,,,O,1,,,,N');
    expect(
      parsed.ok &&
        parsed.value.rows.map((row) => [
          row.activityId,
          row.activityNamed,
          row.repetitivePoseCited,
        ]),
    ).toEqual([
      ['coffee', true, null],
      ['phone', false, true],
      [null, null, false],
    ]);
  });

  it('requires O or N with an activity, and forbids a value without one', () => {
    expect(fullErrorsOf('T1,,,,,,,coffee,,')).toEqual([
      'obs.csv:2 column activityNamed: is required on a row about "coffee" (O or N)',
    ]);
    expect(fullErrorsOf('T1,,,,,,,coffee,maybe,')).toEqual([
      'obs.csv:2 column activityNamed: "maybe" must be O or N',
    ]);
    expect(fullErrorsOf('T1,,,,,,,,O,')).toEqual([
      'obs.csv:2 column activityNamed: must be empty on a row with no activityId',
    ]);
    expect(fullErrorsOf('T1,,,,,,,,,yes')).toEqual([
      'obs.csv:2 column repetitivePoseCited: "yes" must be O, N or empty',
    ]);
  });

  it('refuses an activity that is not in the list, one on a threat row, and a second note of one', () => {
    expect(fullErrorsOf('T1,,,,,,,bath,O,')).toEqual([
      expect.stringMatching(
        /^obs\.csv:2 column activityId: "bath" is not an activity of content\/playtest\.json › bodyRead\.activities \(known: chore, coffee, phone\)$/,
      ),
    ]);
    expect(fullErrorsOf('T1,,,,,,,Coffee,O,')).toEqual([
      'obs.csv:2 column activityId: "Coffee" must be empty or a lower_snake_case id',
    ]);
    expect(fullErrorsOf('T1,,outlet,O,,,,coffee,O,')).toEqual([
      'obs.csv:2 column activityId: must be empty on a row about a threat: one row per threat, one per activity',
    ]);
    expect(fullErrorsOf('T1,,,,,,,coffee,O,', 'T1,,,,,,,coffee,N,')).toEqual([
      'obs.csv:3: a second note of "coffee" for tester T1 (first on line 2): one row per activity and session',
    ]);
    // One activity for two sessions, or two testers, is fine.
    expect(
      parseFull('T1,1a2b3c4d,,,,,,coffee,O,', 'T1,5e6f7a8b,,,,,,coffee,N,', 'T2,,,,,,,coffee,O,')
        .ok,
    ).toBe(true);
  });

  it('reports a CSV syntax error with the file name', () => {
    expect(parseObservations(`${HEADER}\nT1,,,,,"x`, 'obs.csv', KNOWN)).toEqual({
      ok: false,
      error: ['obs.csv: line 2: a quoted field is never closed'],
    });
  });

  it('accepts the committed example with no error and no warning', () => {
    const threats = new Set(
      readdirSync(new URL('../../../content/threats', import.meta.url))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, '')),
    );
    const text = readFileSync(
      new URL('../../../docs/playtest/observations.example.csv', import.meta.url),
      'utf8',
    );
    const playtest = JSON.parse(
      readFileSync(new URL('../../../content/playtest.json', import.meta.url), 'utf8'),
    ) as { bodyRead: { activities: string[] } };
    const parsed = parseObservations(
      text,
      'observations.example.csv',
      threats,
      new Set(playtest.bodyRead.activities),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warnings).toEqual([]);
    expect(parsed.value.rows).toHaveLength(11);
    // Story 7.12: activity rows, named and not, and a repetitive pose cited on a game row.
    expect(parsed.value.rows.filter((row) => row.activityId !== null)).toHaveLength(3);
    expect(parsed.value.rows.some((row) => row.activityNamed === false)).toBe(true);
    expect(
      parsed.value.rows.some((row) => row.repetitivePoseCited === true && row.activityId === null),
    ).toBe(true);
    expect(new Set(parsed.value.rows.map((row) => row.testerId))).toEqual(new Set(['T1', 'T2']));
    expect(parsed.value.rows.some((row) => row.identifiedWithoutHelp === false)).toBe(true);
    expect(parsed.value.rows.some((row) => row.sessionId === null)).toBe(true);
    expect(parsed.value.rows.some((row) => row.comment.includes(','))).toBe(true);
  });
});
