/** The slice of `document` the wait needs (a structural type, so tests need no DOM). */
export interface ForegroundSource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Resolves when the page is in the foreground: at once if it already is, else at the first
 * `visibilitychange` that makes it visible. A level that finished loading in the background waits
 * here, so the 3 s countdown starts when the player is looking (D8).
 */
export function waitForForeground(source: ForegroundSource): Promise<void> {
  if (source.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = (): void => {
      if (source.visibilityState === 'hidden') return;
      source.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    source.addEventListener('visibilitychange', onChange);
  });
}
