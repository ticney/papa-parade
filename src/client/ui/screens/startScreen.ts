import { isStartKey } from '../keys.ts';
import type { OverlayScreen } from '../overlayScreen.ts';
import { createStartGesture } from '../startGesture.ts';
import type { Translator } from '../strings.ts';

/** The slice of `window` the start screen listens on. */
export interface StartTarget {
  addEventListener(
    type: 'pointerdown' | 'pointerup',
    listener: (event: PointerEvent) => void,
  ): void;
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(
    type: 'pointerdown' | 'pointerup',
    listener: (event: PointerEvent) => void,
  ): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

export interface StartScreenOptions {
  t: Translator;
  /** Called once, synchronously inside the first gesture (iOS only unlocks audio there). */
  onStart(): void;
  target: StartTarget;
}

/**
 * The title and « Touche pour commencer » over the dimmed scene. A tap, a click or a key anywhere
 * starts the game; a tap or a click counts only if its `pointerdown` came while this screen was
 * mounted (see `createStartGesture`). The screen is one real `<button>` so a keyboard or a screen reader can use it
 * too. It listens on the window, not on itself, so that the very first gesture counts wherever it
 * lands, and it fires once.
 */
export function createStartScreen(options: StartScreenOptions): OverlayScreen {
  const { t, onStart, target } = options;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'pp-overlay pp-start-screen';
  element.setAttribute('aria-label', t('start.tap_to_start'));

  const title = document.createElement('span');
  title.className = 'pp-start-title pp-type-display pp-stroked';
  title.textContent = t('start.title');
  const prompt = document.createElement('span');
  prompt.className = 'pp-start-prompt pp-type-heading pp-stroked';
  prompt.textContent = t('start.tap_to_start');
  element.append(title, prompt);

  let isDone = false;
  const start = (): void => {
    if (isDone) return;
    isDone = true;
    onStart();
  };
  const gesture = createStartGesture(start);
  const onPointerDown = (event: PointerEvent): void => gesture.onPointerDown(event);
  const onPointerUp = (event: PointerEvent): void => gesture.onPointerUp(event);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isStartKey(event)) start();
  };
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('keydown', onKeyDown);

  return {
    element,
    initialFocus: element,
    dispose() {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
