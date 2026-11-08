import { COMPACT_SURFACE_MAX_PX } from './constants.ts';
import { type Logger, log } from './log.ts';

// Shared since story 9.8: the `human` bot derives `isCompact` for its screen with the client's own rule.

export type Surface = 'compact' | 'regular';

/**
 * Compact (phones) when the short side of the screen is under `COMPACT_SURFACE_MAX_PX`, regular
 * (tablets, desktop) otherwise. The short side, so the answer does not depend on the orientation.
 * A size that is not a positive number is regular, with a `warn`.
 */
export function surfaceFor(
  widthPx: number,
  heightPx: number,
  logger: Pick<Logger, 'warn'> = log,
): Surface {
  if (!(Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0)) {
    logger.warn('boot', 'cannot tell the surface from the window size, using "regular"', {
      widthPx,
      heightPx,
    });
    return 'regular';
  }
  return Math.min(widthPx, heightPx) < COMPACT_SURFACE_MAX_PX ? 'compact' : 'regular';
}
