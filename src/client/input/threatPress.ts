/**
 * Which pointer pressed which threat, and when to tell the sim it let go. Pure state: the input
 * mapper sends the `Release` it asks for. `Release` names no threat and ends every pending press
 * (D6 of story 1.11), so one pointer is remembered at a time.
 */
export interface ThreatPressTracker {
  /** A pointer pressed a threat. It replaces any press remembered before. */
  pressed(pointerId: number, threatId: number): void;
  /** True when `pointerId` is the pointer that pressed: the caller sends `Release`, the tracker forgets it. */
  released(pointerId: number): boolean;
  /** True when a press is held: the caller sends `Release` (a pause). The tracker forgets it. */
  releaseAll(): boolean;
  /** A new level: drops the press without anything to send. */
  forget(): void;
  /** The threat of the held press, or null. */
  readonly heldThreatId: number | null;
}

export function createThreatPressTracker(): ThreatPressTracker {
  let pointerId: number | null = null;
  let threatId: number | null = null;
  const clear = (): void => {
    pointerId = null;
    threatId = null;
  };
  return {
    pressed(pointer, threat) {
      pointerId = pointer;
      threatId = threat;
    },
    released(pointer) {
      if (pointerId === null || pointer !== pointerId) return false;
      clear();
      return true;
    },
    releaseAll() {
      if (pointerId === null) return false;
      clear();
      return true;
    },
    forget: clear,
    get heldThreatId() {
      return threatId;
    },
  };
}
