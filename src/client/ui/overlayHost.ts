import { log } from '@shared/log';
import type { OverlayKind } from '../app/overlay.ts';
import type { OverlayScreen } from './overlayScreen.ts';
import type { PauseScreen } from './screens/pauseScreen.ts';

export interface OverlayBuilders {
  start(): OverlayScreen;
  pause(): PauseScreen;
  portrait(): OverlayScreen;
  /** Story 1.6 adds the « Oups » screen. */
  oops?(): OverlayScreen;
}

export interface OverlayHost {
  readonly kind: OverlayKind | null;
  /** The pause screen while it is the one shown. */
  readonly pauseScreen: PauseScreen | null;
  /** Shows `kind` (null: nothing). A screen replaces the previous one; there is never more than one. */
  sync(kind: OverlayKind | null): void;
}

/**
 * Owns the overlay layer (`#pp-ui`): at most one screen in it. Asking for the kind already shown
 * does nothing, so it keeps its state (and its focus).
 */
export function createOverlayHost(root: HTMLElement, builders: OverlayBuilders): OverlayHost {
  let kind: OverlayKind | null = null;
  let current: OverlayScreen | null = null;
  let pauseScreen: PauseScreen | null = null;

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
    get pauseScreen() {
      return pauseScreen;
    },
    sync(next) {
      if (next === kind) return;
      clear();
      kind = next;
      if (next === null) return;
      let screen: OverlayScreen | undefined;
      if (next === 'start') screen = builders.start();
      else if (next === 'portrait') screen = builders.portrait();
      else if (next === 'oops') screen = builders.oops?.();
      else {
        pauseScreen = builders.pause();
        screen = pauseScreen;
      }
      if (screen === undefined) {
        log.warn('boot', `no "${next}" screen to show yet`);
        return;
      }
      current = screen;
      root.append(screen.element);
      screen.initialFocus?.focus({ preventScroll: true });
    },
  };
}
