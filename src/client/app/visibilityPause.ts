import type { PauseController } from './pauseController.ts';

/** The slice of `document` the binding needs (a structural type, so tests need no DOM). */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Pauses the game whenever the page goes to the background (tab switch, minimised window, iOS app
 * backgrounded; `requestAnimationFrame` stops there, which is why the pause comes from the event).
 * Coming back does nothing: resuming is the player's call, and always goes through the countdown.
 * A page that is already hidden when bound (a tab opened in the background) starts paused.
 * Returns the function that unbinds.
 */
export function bindVisibilityPause(source: VisibilitySource, pause: PauseController): () => void {
  const onChange = (): void => {
    if (source.visibilityState === 'hidden') pause.requestPause('visibilityHidden');
  };
  source.addEventListener('visibilitychange', onChange);
  onChange();
  return () => source.removeEventListener('visibilitychange', onChange);
}
