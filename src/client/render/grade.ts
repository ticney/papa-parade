import type { FramingGrade } from '@content/schemas/feedback';
import { Color } from 'three';

// The film grammar's grade through the room's own lights (story 7.4, D8): no post-processing. The level's
// colours are lerped toward the grade's, and its intensities multiplied by the grade's factor, by the
// grade's weight. At a seam (story 4.10) two grades are weighed, the one going out and the one coming in;
// their weights are scaled down to add up to 1 at most, so the mix never overshoots either.

/** The lights a grade mix gives: a factor on the level's intensities and the two colours. */
export interface GradedLights {
  factor: number;
  readonly ambient: Color;
  readonly sun: Color;
}

/** The parsed colours of each grade object: parsed once, then read with no allocation. */
const parsed = new WeakMap<FramingGrade, { ambient: Color; sun: Color }>();

function coloursOf(grade: FramingGrade): { ambient: Color; sun: Color } {
  let colours = parsed.get(grade);
  if (colours === undefined) {
    colours = { ambient: new Color(grade.ambientColor), sun: new Color(grade.sunColor) };
    parsed.set(grade, colours);
  }
  return colours;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Writes into `out` the lights of the level (`levelAmbient`, `levelSun`) graded by `grade` at `weight`
 * and `carried` at `carriedWeight` (0 to 1 each; null grades weigh nothing). With no weight, `out` is
 * the level's lights and a factor of 1, exactly. Allocates nothing once each grade has been seen.
 */
export function gradeLightsInto(
  out: GradedLights,
  levelAmbient: Readonly<Color>,
  levelSun: Readonly<Color>,
  grade: FramingGrade | null,
  weight: number,
  carried: FramingGrade | null,
  carriedWeight: number,
): void {
  let a = grade === null ? 0 : clamp01(weight);
  let b = carried === null ? 0 : clamp01(carriedWeight);
  const sum = a + b;
  if (sum > 1) {
    a /= sum;
    b /= sum;
  }
  const rest = 1 - a - b;
  out.factor =
    rest +
    (grade === null ? 0 : a * grade.lightsFactor) +
    (carried === null ? 0 : b * carried.lightsFactor);
  out.ambient.copy(levelAmbient).multiplyScalar(rest);
  out.sun.copy(levelSun).multiplyScalar(rest);
  if (grade !== null && a > 0) {
    const colours = coloursOf(grade);
    out.ambient.r += colours.ambient.r * a;
    out.ambient.g += colours.ambient.g * a;
    out.ambient.b += colours.ambient.b * a;
    out.sun.r += colours.sun.r * a;
    out.sun.g += colours.sun.g * a;
    out.sun.b += colours.sun.b * a;
  }
  if (carried !== null && b > 0) {
    const colours = coloursOf(carried);
    out.ambient.r += colours.ambient.r * b;
    out.ambient.g += colours.ambient.g * b;
    out.ambient.b += colours.ambient.b * b;
    out.sun.r += colours.sun.r * b;
    out.sun.g += colours.sun.g * b;
    out.sun.b += colours.sun.b * b;
  }
  if (sum === 0) {
    // Exactly the level's lights, not a product that rounds.
    out.factor = 1;
    out.ambient.copy(levelAmbient);
    out.sun.copy(levelSun);
  }
}
