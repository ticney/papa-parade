import { invariant } from '@shared/invariant';

export interface HudBatch {
  /** Records the value a slot should show; nothing is written to the DOM yet. */
  set(slot: number, value: number): void;
  /** Writes every slot whose value changed since the last flush, once. Call once per frame. */
  flush(): void;
}

/**
 * HUD updates, batched once per frame (UX-DR26). Each slot has a writer that touches the DOM; `set`
 * only records, `flush` calls the writer of each slot whose value really changed. After creation it
 * allocates nothing, so it can run in the frame callback.
 */
export function createHudBatch(writers: ReadonlyArray<(value: number) => void>): HudBatch {
  const count = writers.length;
  const wanted = new Float64Array(count);
  const applied = new Float64Array(count).fill(Number.NaN);
  const isDirty = new Uint8Array(count);
  let hasDirty = false;

  return {
    set(slot, value) {
      // Tested first so that the message is only built on failure (this runs every frame).
      if (!(Number.isInteger(slot) && slot >= 0 && slot < count)) {
        invariant(false, `hudBatch: slot ${slot} is out of range (0..${count - 1})`);
      }
      if (!Number.isFinite(value)) invariant(false, `hudBatch: slot ${slot} got ${value}`);
      wanted[slot] = value;
      isDirty[slot] = 1;
      hasDirty = true;
    },
    flush() {
      if (!hasDirty) return;
      hasDirty = false;
      for (let slot = 0; slot < count; slot++) {
        if (isDirty[slot] === 0) continue;
        isDirty[slot] = 0;
        const value = wanted[slot] as number;
        if (value === applied[slot]) continue;
        applied[slot] = value;
        (writers[slot] as (value: number) => void)(value);
      }
    },
  };
}
