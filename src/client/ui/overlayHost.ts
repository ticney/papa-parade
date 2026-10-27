import type { OverlayKind } from '../app/overlay.ts';
import type { OverlayScreen } from './overlayScreen.ts';
import type { PauseMode, PauseScreen } from './screens/pauseScreen.ts';

export interface OverlayBuilders {
  start(): OverlayScreen;
  /** Built in the mode it opens in, so a level start never builds a panel just to hide it. */
  pause(mode: PauseMode): PauseScreen;
  portrait(): OverlayScreen;
  loading(): OverlayScreen;
  oops(): OverlayScreen;
}

export interface OverlayHost {
  readonly kind: OverlayKind | null;
  /** The screen shown, whatever it is, or null. */
  readonly screen: OverlayScreen | null;
  /** The pause screen while it is the one shown. */
  readonly pauseScreen: PauseScreen | null;
  /**
   * Shows `kind` (null: nothing). A screen replaces the previous one; there is never more than one.
   * `pauseMode` is the face a new pause screen opens in. The new screen is built before the old one
   * is removed: if a builder throws, nothing changes and the next `sync` tries again.
   */
  sync(kind: OverlayKind | null, pauseMode?: PauseMode): void;
}

/**
 * Owns the overlay layer (`#pp-ui`): at most one screen in it. Asking for the kind already shown
 * does nothing, so it keeps its state (and its focus).
 */
export function createOverlayHost(root: HTMLElement, builders: OverlayBuilders): OverlayHost {
  let kind: OverlayKind | null = null;
  let current: OverlayScreen | null = null;
  let pauseScreen: PauseScreen | null = null;

  const build = (
    next: OverlayKind,
    pauseMode: PauseMode,
  ): { screen: OverlayScreen; pause: PauseScreen | null } => {
    switch (next) {
      case 'start':
        return { screen: builders.start(), pause: null };
      case 'portrait':
        return { screen: builders.portrait(), pause: null };
      case 'oops':
        return { screen: builders.oops(), pause: null };
      case 'loading':
        return { screen: builders.loading(), pause: null };
      case 'pause': {
        const pause = builders.pause(pauseMode);
        return { screen: pause, pause };
      }
      default: {
        const unknown: never = next;
        throw new Error(`overlay host: unknown overlay kind "${unknown}"`);
      }
    }
  };

  const clear = (): void => {
    current?.dispose();
    current = null;
    pauseScreen = null;
    root.replaceChildren();
  };

  return {
    get kind() {
      return kind;
    },
    get screen() {
      return current;
    },
    get pauseScreen() {
      return pauseScreen;
    },
    sync(next, pauseMode = 'panel') {
      if (next === kind) return;
      const built = next === null ? null : build(next, pauseMode);
      clear();
      kind = next;
      if (built === null) return;
      current = built.screen;
      pauseScreen = built.pause;
      root.append(built.screen.element);
      built.screen.initialFocus?.focus({ preventScroll: true });
    },
  };
}
