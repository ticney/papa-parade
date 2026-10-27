import { log } from '@shared/log';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Is the point inside the rectangle, edges included? Anything that is not a number is outside. */
export function isInsideRect(point: Point, rect: Rect): boolean {
  const values = [point.x, point.y, rect.left, rect.top, rect.right, rect.bottom];
  if (!values.every(Number.isFinite)) return false;
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

const PRESS_CLASS = 'pp-pressed';
const ACTIVATION_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

/**
 * UX-DR7 for one button. The press shows on `pointerdown` (a class, because `:active` is unreliable
 * on iOS) and the action runs on `pointerup` **inside** the button; sliding out cancels, and the
 * button looks released while the pointer is outside. The keyboard and assistive technology
 * activate through `click` with `detail === 0`; a `click` that follows a pointer (detail ≥ 1) is
 * ignored, so a tap never fires twice. Returns the function that unbinds.
 */
export function bindPressButton(button: HTMLButtonElement, onActivate: () => void): () => void {
  let activePointer: number | null = null;

  const release = (): void => {
    button.classList.remove(PRESS_CLASS);
    activePointer = null;
  };
  const isInside = (event: PointerEvent): boolean =>
    isInsideRect({ x: event.clientX, y: event.clientY }, button.getBoundingClientRect());

  const onPointerDown = (event: PointerEvent): void => {
    if (activePointer !== null || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Cancelling pointerdown drops the compatibility mouse events that would follow a touch. They
    // would land on whatever the press has just put under the finger (the pause veil) and take
    // focus away from the button the screen focused.
    event.preventDefault();
    activePointer = event.pointerId;
    button.classList.add(PRESS_CLASS);
    try {
      button.setPointerCapture(event.pointerId);
    } catch (cause) {
      // Without capture, a release outside the button is simply not delivered to it: the press is
      // then cancelled by `pointercancel` or the next `pointerdown`.
      log.warn('input', 'setPointerCapture failed on a UI button', cause);
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    button.classList.toggle(PRESS_CLASS, isInside(event));
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    const isActivated = isInside(event);
    release();
    if (isActivated) onActivate();
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === activePointer) release();
  };
  const onClick = (event: MouseEvent): void => {
    if (event.detail === 0) onActivate();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat && ACTIVATION_KEYS.has(event.code)) button.classList.add(PRESS_CLASS);
  };
  const onKeyUp = (): void => {
    if (activePointer === null) button.classList.remove(PRESS_CLASS);
  };

  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerCancel);
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', onKeyDown);
  button.addEventListener('keyup', onKeyUp);
  button.addEventListener('blur', onKeyUp);
  return () => {
    button.removeEventListener('pointerdown', onPointerDown);
    button.removeEventListener('pointermove', onPointerMove);
    button.removeEventListener('pointerup', onPointerUp);
    button.removeEventListener('pointercancel', onPointerCancel);
    button.removeEventListener('click', onClick);
    button.removeEventListener('keydown', onKeyDown);
    button.removeEventListener('keyup', onKeyUp);
    button.removeEventListener('blur', onKeyUp);
  };
}
