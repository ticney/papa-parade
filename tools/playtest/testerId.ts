/**
 * A tester is a pseudonym Geo chose (`T1`, `T2`…), never a name (NFR14). It is the name of the
 * tester's journal folder and the `testerId` column of the observations.
 */
export const TESTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** The `sessionId` of a journal: 8 lowercase hex chars (`summary.sessionId`). */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Orders ids by name whatever the locale of the machine, so that a report never depends on it. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}
