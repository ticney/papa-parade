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
  // The rectangle at pointerdown: the pressed look moves the button 4px down, so measuring it at
  // pointerup would judge a press that began in its top 4px as outside.
  let pressRect: Rect | null = null;
  let isKeyRepeating = false;

  const release = (): void => {
    button.classList.remove(PRESS_CLASS);
    activePointer = null;
    pressRect = null;
  };
  const isInside = (event: PointerEvent): boolean =>
    pressRect !== null && isInsideRect({ x: event.clientX, y: event.clientY }, pressRect);

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A press still open here lost its pointerup (capture failed, a system gesture, the button was
    // hidden under the finger): it is over, and this pointerdown starts a new one.
    if (activePointer !== null) release();
    // Cancelling pointerdown drops the compatibility mouse events that would follow a touch. They
    // would land on whatever the press has just put under the finger (the pause veil) and take
    // focus away from the button the screen focused.
    event.preventDefault();
    const { left, top, right, bottom } = button.getBoundingClientRect();
    pressRect = { left, top, right, bottom };
    activePointer = event.pointerId;
    button.classList.add(PRESS_CLASS);
    try {
      button.setPointerCapture(event.pointerId);
    } catch (cause) {
      // Without capture, a release outside the button is not delivered to it: the press stays open
      // until the next pointerdown (above) or a `pointercancel`.
      log.warn('input', 'setPointerCapture failed on a UI button', cause);
    }
  };
  const onLostPointerCapture = (event: PointerEvent): void => {
    // After a normal pointerup the press is already released. Here the capture went away mid-press.
    if (event.pointerId === activePointer) release();
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
    // A held Enter repeats `click`: holding it on the HUD button must not also press the button
    // that the first activation just focused.
    if (event.detail !== 0 || isKeyRepeating) return;
    if (activePointer === null) button.classList.remove(PRESS_CLASS);
    onActivate();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    isKeyRepeating = event.repeat;
    if (!event.repeat && ACTIVATION_KEYS.has(event.code)) button.classList.add(PRESS_CLASS);
  };
  const onKeyUp = (): void => {
    isKeyRepeating = false;
    if (activePointer === null) button.classList.remove(PRESS_CLASS);
  };

  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerCancel);
  button.addEventListener('lostpointercapture', onLostPointerCapture);
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', onKeyDown);
  button.addEventListener('keyup', onKeyUp);
  button.addEventListener('blur', onKeyUp);
  return () => {
    button.removeEventListener('pointerdown', onPointerDown);
    button.removeEventListener('pointermove', onPointerMove);
    button.removeEventListener('pointerup', onPointerUp);
    button.removeEventListener('pointercancel', onPointerCancel);
    button.removeEventListener('lostpointercapture', onLostPointerCapture);
    button.removeEventListener('click', onClick);
    button.removeEventListener('keydown', onKeyDown);
    button.removeEventListener('keyup', onKeyUp);
    button.removeEventListener('blur', onKeyUp);
  };
}
