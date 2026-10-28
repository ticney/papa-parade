/**
 * Mama's stars (story 1.22): the number of `thresholds` the score reaches, 0 to 5 with the five
 * `feel.mama.starThresholdPoints` (ascending, checked by the schema). Pure.
 */
export function starsForScore(scorePoints: number, thresholds: readonly number[]): number {
  let stars = 0;
  for (const threshold of thresholds) if (threshold <= scorePoints) stars++;
  return stars;
}
