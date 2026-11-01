/** What `finalRushProblems` reads of a level's `finalRush` (the schema's shape, without zod). */
export interface FinalRushShape {
  readonly spillAnchor: string;
}

/** What `finalRushProblems` reads of `feel.endOfLevel`. */
export interface EndOfLevelShape {
  readonly finalRushMs: number;
  readonly doorSpillCount: number;
}

/**
 * What is wrong with a level's `finalRush`, each as a sentence that follows « finalRush: »: `simLevelOf`
 * and `content:check` both call it, so they refuse the same things with the same words (story 3.5).
 * The level must outlast the rush, and the spill anchor must be an anchor of the level's geometry.
 * Pure: no zod and no `@content` runtime import.
 */
export function finalRushProblems(
  finalRush: FinalRushShape,
  durationMs: number,
  endOfLevel: EndOfLevelShape,
  anchorIds: readonly string[],
): string[] {
  const problems: string[] = [];
  if (durationMs <= endOfLevel.finalRushMs) {
    problems.push(
      `the level lasts ${durationMs} ms, which is not above the ${endOfLevel.finalRushMs} ms of the rush (feel.endOfLevel.finalRushMs)`,
    );
  }
  if (!anchorIds.includes(finalRush.spillAnchor)) {
    problems.push(`the spill anchor "${finalRush.spillAnchor}" is not an anchor of the level`);
  }
  return problems;
}

/**
 * How long the level can be played with sequences: its `durationMs`, less the final rush when it has
 * one (no sequence can start in the rush, story 3.5). What `cycleProblems` is given, so a bedtime cycle
 * that would only fit by running into the rush is refused.
 */
export function playableMsOf(
  durationMs: number,
  finalRush: FinalRushShape | undefined,
  endOfLevel: EndOfLevelShape,
): number {
  return finalRush === undefined ? durationMs : durationMs - endOfLevel.finalRushMs;
}
