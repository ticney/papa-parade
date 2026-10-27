import { describe, expect, it } from 'vitest';
import { bindPointer, type PointerSample, type PointerTarget } from './pointerInput.ts';

describe('bindPointer', () => {
  function fakeCanvas() {
    const listeners = new Set<(event: PointerEvent) => void>();
    const target: PointerTarget = {
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
    return { target, listeners };
  }

  it('hands each pointerdown to the callback, untouched', () => {
    const { target, listeners } = fakeCanvas();
    const seen: PointerSample[] = [];
    bindPointer(target, (sample) => seen.push(sample));
    const event = { clientX: 10, clientY: 20, timeStamp: 5, isPrimary: true, button: 0 };
    for (const listener of listeners) listener(event as PointerEvent);
    expect(seen).toEqual([event]);
  });

  it('unbinds', () => {
    const { target, listeners } = fakeCanvas();
    const unbind = bindPointer(target, () => {});
    expect(listeners.size).toBe(1);
    unbind();
    expect(listeners.size).toBe(0);
  });
});
