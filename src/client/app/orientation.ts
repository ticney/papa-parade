/** The slice of a `MediaQueryList` the binding needs (a structural type, so tests need no DOM). */
export interface OrientationQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

/**
 * Reports whether the device is held in portrait: once now, then on every change. `boot` passes
 * `matchMedia('(orientation: portrait)')`. Returns the function that unbinds.
 */
export function bindOrientation(
  query: OrientationQuery,
  onChange: (isPortrait: boolean) => void,
): () => void {
  const listener = (event: { matches: boolean }): void => onChange(event.matches);
  query.addEventListener('change', listener);
  onChange(query.matches);
  return () => query.removeEventListener('change', listener);
}
