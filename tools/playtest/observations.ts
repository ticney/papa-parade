import { SNAKE_ID_PATTERN } from '@content/levelNodeNames';
import { err, ok, type Result } from '@shared/result';
import { parseCsv } from './csv.ts';
import { SESSION_ID_PATTERN, TESTER_ID_PATTERN } from './testerId.ts';

/** The columns of `docs/playtest/observations.csv`, in the order of the example (the order is free in a file). */
export const OBSERVATION_COLUMNS = [
  'testerId',
  'sessionId',
  'threatId',
  'identifiedWithoutHelp',
  'perfectCitedSpontaneously',
  'laughs',
  'comment',
] as const;

/**
 * The optional columns of indicator 6, « Papa se lit sans sa bulle » (story 7.12, D14): together or not at all.
 * A file without them (Geo's notes of an earlier playtest) still loads: the indicator is then `n/a`.
 */
export const BODY_READ_COLUMNS = ['activityId', 'activityNamed', 'repetitivePoseCited'] as const;

type ObservationColumn = (typeof OBSERVATION_COLUMNS)[number] | (typeof BODY_READ_COLUMNS)[number];

/** One line of Geo's notes. `null` means the cell was left empty. */
export interface ObservationRow {
  /** 1-based line in the file, for the messages that mention the row. */
  line: number;
  testerId: string;
  /** `null` = « this tester, whichever session ». */
  sessionId: string | null;
  /** `null` = a row about the whole game. */
  threatId: string | null;
  identifiedWithoutHelp: boolean | null;
  perfectCitedSpontaneously: boolean | null;
  laughs: number | null;
  /** `null` = a row about no activity of Papa's (story 7.12). Never with a `threatId`. */
  activityId: string | null;
  /** Whether the tester named what Papa does, without his bubble; set exactly when `activityId` is. */
  activityNamed: boolean | null;
  /** Whether the tester spontaneously found one of his poses repetitive; `null` = not noted. */
  repetitivePoseCited: boolean | null;
  comment: string;
}

export interface ParsedObservations {
  rows: ObservationRow[];
  warnings: string[];
}

const WHOLE_NUMBER = /^\d+$/;

function yesNo(value: string): boolean | undefined {
  const upper = value.toUpperCase();
  if (upper === 'O') return true;
  if (upper === 'N') return false;
  return undefined;
}

/**
 * Parses the notes Geo takes during a playtest. Pure: the threat ids that exist and the activities of
 * indicator 6 are passed in (an empty set means the list could not be read, and the check is skipped).
 * Every error names the file, the line and the column; all the errors of the file are returned
 * together, among them a threat id that is not a known def (a typo would count as a threat of its
 * own). An extra column is a warning for the caller (`warnings`), not an error.
 */
export function parseObservations(
  text: string,
  file: string,
  knownThreatIds: ReadonlySet<string>,
  knownActivityIds: ReadonlySet<string> = new Set(),
): Result<ParsedObservations, string[]> {
  const csv = parseCsv(text);
  if (!csv.ok) return err([`${file}: ${csv.error}`]);
  const { header, rows } = csv.value;

  const duplicated = [...new Set(header.filter((name, i) => header.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    return err([
      `${file}: column${duplicated.length > 1 ? 's' : ''} ${duplicated.join(', ')} appear${duplicated.length > 1 ? '' : 's'} twice in the header`,
    ]);
  }
  const missing = OBSERVATION_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    // Column names are case-sensitive: say so when only the case differs.
    const nearMisses = missing.flatMap((column) => {
      const found = header.find((name) => name.toLowerCase() === column.toLowerCase());
      return found === undefined ? [] : [`"${found}" is not "${column}"`];
    });
    const hint =
      nearMisses.length === 0 ? '' : `; column names are case-sensitive (${nearMisses.join(', ')})`;
    return err([
      `${file}: missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (expected: ${OBSERVATION_COLUMNS.join(', ')})${hint}`,
    ]);
  }
  const warnings: string[] = [];
  const bodyReadPresent = BODY_READ_COLUMNS.filter((column) => header.includes(column));
  const hasBodyRead = bodyReadPresent.length === BODY_READ_COLUMNS.length;
  if (bodyReadPresent.length === 0) {
    warnings.push(
      `${file}: no ${BODY_READ_COLUMNS.join(', ')} column: indicator 6 (Papa without his bubble) is n/a`,
    );
  } else if (!hasBodyRead) {
    const absent = BODY_READ_COLUMNS.filter((column) => !header.includes(column));
    return err([
      `${file}: the columns of indicator 6 go together: missing ${absent.join(', ')} (expected: ${BODY_READ_COLUMNS.join(', ')})`,
    ]);
  }
  const known = new Set<string>([...OBSERVATION_COLUMNS, ...BODY_READ_COLUMNS]);
  for (const column of header) {
    if (!known.has(column)) {
      warnings.push(`${file}: extra column "${column}" is ignored`);
    }
  }

  const errors: string[] = [];
  const parsed: ObservationRow[] = [];
  const seen = new Map<string, number>();
  const seenActivities = new Map<string, number>();

  for (const row of rows) {
    const cell = (column: ObservationColumn): string => {
      const index = header.indexOf(column);
      return index < 0 ? '' : (row.fields[index] ?? '').trim();
    };
    const fail = (column: ObservationColumn, message: string): void => {
      errors.push(`${file}:${row.line} column ${column}: ${message}`);
    };

    const testerId = cell('testerId');
    if (!TESTER_ID_PATTERN.test(testerId)) {
      fail('testerId', `"${testerId}" is not a tester id (1-32 of A-Z a-z 0-9 _ -)`);
    }

    const sessionText = cell('sessionId');
    if (sessionText !== '' && !SESSION_ID_PATTERN.test(sessionText)) {
      fail('sessionId', `"${sessionText}" must be empty or 8 lowercase hex characters`);
    }

    const threatText = cell('threatId');
    if (threatText !== '' && !SNAKE_ID_PATTERN.test(threatText)) {
      fail('threatId', `"${threatText}" must be empty or a lower_snake_case id`);
    } else if (threatText !== '' && knownThreatIds.size > 0 && !knownThreatIds.has(threatText)) {
      // A typo would become a threat of its own and decide the « each threat » indicator.
      fail(
        'threatId',
        `"${threatText}" is not a threat def in content/threats/ (known: ${[...knownThreatIds].sort().join(', ')})`,
      );
    }

    const identifiedText = cell('identifiedWithoutHelp');
    let identified: boolean | null = null;
    if (threatText === '') {
      if (identifiedText !== '') {
        fail('identifiedWithoutHelp', 'must be empty on a row with no threatId');
      }
    } else if (identifiedText === '') {
      fail('identifiedWithoutHelp', `is required on a row about "${threatText}" (O or N)`);
    } else {
      const value = yesNo(identifiedText);
      if (value === undefined) fail('identifiedWithoutHelp', `"${identifiedText}" must be O or N`);
      else identified = value;
    }

    const perfectText = cell('perfectCitedSpontaneously');
    let perfect: boolean | null = null;
    if (perfectText !== '') {
      const value = yesNo(perfectText);
      if (value === undefined) {
        fail('perfectCitedSpontaneously', `"${perfectText}" must be O, N or empty`);
      } else {
        perfect = value;
      }
    }

    const laughsText = cell('laughs');
    let laughs: number | null = null;
    if (laughsText !== '') {
      if (WHOLE_NUMBER.test(laughsText) && Number.isSafeInteger(Number(laughsText))) {
        laughs = Number(laughsText);
      } else {
        fail('laughs', `"${laughsText}" must be empty or a whole number of at least 0`);
      }
    }

    if (threatText !== '') {
      const key = `${testerId}\u0000${sessionText}\u0000${threatText}`;
      const first = seen.get(key);
      if (first !== undefined) {
        errors.push(
          `${file}:${row.line}: a second judgment of "${threatText}" for tester ${testerId}${sessionText === '' ? '' : ` session ${sessionText}`} (first on line ${first}): one row per threat and session`,
        );
      } else {
        seen.set(key, row.line);
      }
    }

    // Indicator 6 (story 7.12, D14): a row about one of Papa's activities, and the repetitive pose on any row.
    const activityText = cell('activityId');
    if (activityText !== '' && !SNAKE_ID_PATTERN.test(activityText)) {
      fail('activityId', `"${activityText}" must be empty or a lower_snake_case id`);
    } else if (
      activityText !== '' &&
      knownActivityIds.size > 0 &&
      !knownActivityIds.has(activityText)
    ) {
      fail(
        'activityId',
        `"${activityText}" is not an activity of content/playtest.json › bodyRead.activities (known: ${[...knownActivityIds].join(', ')})`,
      );
    } else if (activityText !== '' && threatText !== '') {
      fail(
        'activityId',
        'must be empty on a row about a threat: one row per threat, one per activity',
      );
    }
    const namedText = cell('activityNamed');
    let named: boolean | null = null;
    if (activityText === '') {
      if (namedText !== '') fail('activityNamed', 'must be empty on a row with no activityId');
    } else if (namedText === '') {
      fail('activityNamed', `is required on a row about "${activityText}" (O or N)`);
    } else {
      const value = yesNo(namedText);
      if (value === undefined) fail('activityNamed', `"${namedText}" must be O or N`);
      else named = value;
    }
    const repetitiveText = cell('repetitivePoseCited');
    let repetitive: boolean | null = null;
    if (repetitiveText !== '') {
      const value = yesNo(repetitiveText);
      if (value === undefined) {
        fail('repetitivePoseCited', `"${repetitiveText}" must be O, N or empty`);
      } else {
        repetitive = value;
      }
    }
    if (activityText !== '') {
      const key = `${testerId}\u0000${sessionText}\u0000${activityText}`;
      const first = seenActivities.get(key);
      if (first !== undefined) {
        errors.push(
          `${file}:${row.line}: a second note of "${activityText}" for tester ${testerId}${sessionText === '' ? '' : ` session ${sessionText}`} (first on line ${first}): one row per activity and session`,
        );
      } else {
        seenActivities.set(key, row.line);
      }
    }

    const comment = row.fields[header.indexOf('comment')] ?? '';
    parsed.push({
      line: row.line,
      testerId,
      sessionId: sessionText === '' ? null : sessionText,
      threatId: threatText === '' ? null : threatText,
      identifiedWithoutHelp: identified,
      perfectCitedSpontaneously: perfect,
      laughs,
      activityId: activityText === '' ? null : activityText,
      activityNamed: named,
      repetitivePoseCited: repetitive,
      comment,
    });
  }

  if (errors.length > 0) return err(errors);
  return ok({ rows: parsed, warnings });
}
