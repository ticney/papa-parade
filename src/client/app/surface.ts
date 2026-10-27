import { COMPACT_SURFACE_MAX_PX } from '@shared/constants';
import { type Logger, log } from '@shared/log';

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

/** The slice of `window` the binding needs (a structural type, so tests need no DOM). */
export interface SurfaceSource {
  readonly innerWidth: number;
  readonly innerHeight: number;
  addEventListener(type: 'resize', listener: () => void): void;
  removeEventListener(type: 'resize', listener: () => void): void;
}

/** The slice of `document.documentElement` that is written. */
export interface SurfaceRoot {
  dataset: Record<string, string | undefined>;
}

/**
 * Keeps `data-pp-surface` on the root element equal to the surface of the window. CSS reads it;
 * the HUD corners do not depend on it. Returns the function that unbinds.
 */
export function bindSurface(source: SurfaceSource, root: SurfaceRoot): () => void {
  const update = (): void => {
    root.dataset.ppSurface = surfaceFor(source.innerWidth, source.innerHeight);
  };
  source.addEventListener('resize', update);
  update();
  return () => source.removeEventListener('resize', update);
}
