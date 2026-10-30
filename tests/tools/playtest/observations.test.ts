import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OBSERVATION_COLUMNS, parseObservations } from '../../../tools/playtest/observations.ts';

const HEADER = OBSERVATION_COLUMNS.join(',');
const KNOWN = new Set(['outlet', 'stairs']);

function parse(...lines: string[]) {
  return parseObservations([HEADER, ...lines].join('\n'), 'obs.csv', KNOWN);
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
        warnings: [],
        rows: [
          {
            line: 2,
            testerId: 'T1',
            sessionId: null,
            threatId: 'outlet',
            identifiedWithoutHelp: true,
            perfectCitedSpontaneously: null,
            laughs: null,
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
    const parsed = parseObservations(`${HEADER},mood\nT1,,,,,,hi,great`, 'obs.csv', KNOWN);
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
    const parsed = parseObservations(text, 'observations.example.csv', threats);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warnings).toEqual([]);
    expect(parsed.value.rows).toHaveLength(8);
    expect(new Set(parsed.value.rows.map((row) => row.testerId))).toEqual(new Set(['T1', 'T2']));
    expect(parsed.value.rows.some((row) => row.identifiedWithoutHelp === false)).toBe(true);
    expect(parsed.value.rows.some((row) => row.sessionId === null)).toBe(true);
    expect(parsed.value.rows.some((row) => row.comment.includes(','))).toBe(true);
  });
});
