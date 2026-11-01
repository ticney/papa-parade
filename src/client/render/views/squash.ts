/** The peak of `sin(2πu) × (1 − u)` on 0..1: dividing by it makes `amountPct` the real extreme of the curve. */
const SQUASH_CURVE_PEAK = 0.7638;

/** The scale of a character's group: `y` is its height, `xz` its width. */
export interface SquashScale {
  xz: number;
  y: number;
}

/**
 * The scale of a squash and stretch `elapsedMs` into its `durationMs`: the height goes to
 * `1 + amountPct / 100`, overshoots the other way, smaller, and settles; the width follows so that
 * the volume holds (`y = s`, `x = z = 1 / √s`). Exactly 1 before it starts and once it is over. Pure
 * and allocation-free: it writes `out`.
 */
export function squashScaleAt(
  amountPct: number,
  elapsedMs: number,
  durationMs: number,
  out: SquashScale,
): void {
  if (!(elapsedMs > 0 && elapsedMs < durationMs)) {
    out.xz = 1;
    out.y = 1;
    return;
  }
  const u = elapsedMs / durationMs;
  const s = 1 + ((amountPct / 100) * (Math.sin(2 * Math.PI * u) * (1 - u))) / SQUASH_CURVE_PEAK;
  out.y = s;
  out.xz = 1 / Math.sqrt(s);
}
