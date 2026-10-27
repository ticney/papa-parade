/** The few fields of a `PointerEvent` the input mapper reads. */
export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
  /** Same timebase as `performance.now()`, in real ms. */
  readonly timeStamp: number;
  readonly isPrimary: boolean;
  readonly button: number;
  /** Which finger (or the mouse): a threat press is released by the pointer that made it. */
  readonly pointerId: number;
}

type PointerEventName = 'pointerdown' | 'pointerup' | 'pointercancel';

/** The slice of an event target the pointer binding listens on (the canvas, `window`). */
export interface PointerTarget {
  addEventListener(type: PointerEventName, listener: (event: PointerEvent) => void): void;
  removeEventListener(type: PointerEventName, listener: (event: PointerEvent) => void): void;
}

/**
 * Binds `pointerdown` on the canvas only (the HUD and the overlays let through what they do not
 * cover) and hands the event to `onDown`; `pointerup` and `pointercancel` are bound on `releaseTarget`
 * (`window`) and go to `onUp`, so that a finger that slid off the canvas still releases what it
 * pressed. Nothing else happens in the handlers: the mapper stamps, picks and enqueues. Returns the
 * function that unbinds.
 */
export function bindPointer(
  target: PointerTarget,
  releaseTarget: PointerTarget,
  onDown: (sample: PointerSample) => void,
  onUp: (sample: PointerSample) => void,
): () => void {
  const down = (event: PointerEvent): void => onDown(event);
  const up = (event: PointerEvent): void => onUp(event);
  target.addEventListener('pointerdown', down);
  releaseTarget.addEventListener('pointerup', up);
  releaseTarget.addEventListener('pointercancel', up);
  return () => {
    target.removeEventListener('pointerdown', down);
    releaseTarget.removeEventListener('pointerup', up);
    releaseTarget.removeEventListener('pointercancel', up);
  };
}
