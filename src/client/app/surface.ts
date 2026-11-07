import { surfaceFor } from '@shared/surface';

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
