/** The few fields of a `PointerEvent` the input mapper reads. */
export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
  /** Same timebase as `performance.now()`, in real ms. */
  readonly timeStamp: number;
  readonly isPrimary: boolean;
  readonly button: number;
}

/** The slice of the canvas the pointer binding listens on. */
export interface PointerTarget {
  addEventListener(type: 'pointerdown', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointerdown', listener: (event: PointerEvent) => void): void;
}

/**
 * Binds `pointerdown` on the canvas only (the HUD and the overlays let through what they do not
 * cover) and hands the event to `onDown`. Nothing else happens in the handler: the mapper stamps,
 * picks and enqueues. Returns the function that unbinds.
 */
export function bindPointer(
  target: PointerTarget,
  onDown: (sample: PointerSample) => void,
): () => void {
  const listener = (event: PointerEvent): void => onDown(event);
  target.addEventListener('pointerdown', listener);
  return () => target.removeEventListener('pointerdown', listener);
}
