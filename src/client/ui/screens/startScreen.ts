import { isStartKey } from '../keys.ts';
import type { OverlayScreen } from '../overlayScreen.ts';
import type { Translator } from '../strings.ts';

/** The slice of `window` the start screen listens on. */
export interface StartTarget {
  addEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
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
 * starts the game. The screen is one real `<button>` so a keyboard or a screen reader can use it
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
  const onPointerUp = (event: PointerEvent): void => {
    if (event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0)) start();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isStartKey(event)) start();
  };
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('keydown', onKeyDown);

  return {
    element,
    initialFocus: element,
    dispose() {
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
