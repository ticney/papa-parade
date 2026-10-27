/** The part of a pointer event the start gesture reads. */
export interface StartPointerEvent {
  readonly isPrimary: boolean;
  readonly pointerType: string;
  readonly button: number;
  readonly pointerId: number;
}

export interface StartGesture {
  onPointerDown(event: StartPointerEvent): void;
  onPointerUp(event: StartPointerEvent): void;
  /** The browser took the gesture over (a scroll, a system gesture): its `pointerup` will not come, or does not count. */
  onPointerCancel(event: StartPointerEvent): void;
}

const isStartPointer = (event: StartPointerEvent): boolean =>
  event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0);

/**
 * A tap, a click or a touch starts the game only when its `pointerdown` was seen by the start
 * screen and its `pointerup` is the same pointer's: the tail of a gesture that began before the
 * screen existed (a tap on « Recommencer », a click that outlived the loading screen) is not the
 * gesture that unlocks audio, and the player did not mean it. `onStart` is called from inside the
 * `pointerup` handler, synchronously: iOS only unlocks audio there.
 */
export function createStartGesture(onStart: () => void): StartGesture {
  let downPointerId: number | null = null;
  return {
    onPointerDown(event) {
      if (isStartPointer(event)) downPointerId = event.pointerId;
    },
    onPointerUp(event) {
      if (!isStartPointer(event) || downPointerId !== event.pointerId) return;
      downPointerId = null;
      onStart();
    },
    onPointerCancel(event) {
      if (downPointerId === event.pointerId) downPointerId = null;
    },
  };
}
