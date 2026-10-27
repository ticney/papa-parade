import { describe, expect, it } from 'vitest';
import { bindPointer, type PointerSample, type PointerTarget } from './pointerInput.ts';

describe('bindPointer', () => {
  function fakeTarget() {
    const listeners = new Map<string, Set<(event: PointerEvent) => void>>();
    const target: PointerTarget = {
      addEventListener: (type, listener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
    };
    const fire = (type: string, event: unknown): void => {
      for (const listener of listeners.get(type) ?? []) listener(event as PointerEvent);
    };
    const count = (): number => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    return { target, fire, count };
  }
  const event: PointerSample = {
    clientX: 10,
    clientY: 20,
    timeStamp: 5,
    isPrimary: true,
    button: 0,
    pointerId: 3,
  };

  it('hands each pointerdown of the canvas to onDown, untouched', () => {
    const canvas = fakeTarget();
    const win = fakeTarget();
    const downs: PointerSample[] = [];
    bindPointer(
      canvas.target,
      win.target,
      (sample) => downs.push(sample),
      () => {},
    );
    canvas.fire('pointerdown', event);
    expect(downs).toEqual([event]);
  });

  it('hands pointerup and pointercancel of the window to onUp, but not those of the canvas', () => {
    const canvas = fakeTarget();
    const win = fakeTarget();
    const ups: PointerSample[] = [];
    bindPointer(
      canvas.target,
      win.target,
      () => {},
      (sample) => ups.push(sample),
    );
    win.fire('pointerup', event);
    win.fire('pointercancel', { ...event, pointerId: 4 });
    canvas.fire('pointerup', event);
    expect(ups).toEqual([event, { ...event, pointerId: 4 }]);
  });

  it('does not call onDown for a pointerdown on the window, nor onUp for one on the canvas', () => {
    const canvas = fakeTarget();
    const win = fakeTarget();
    const seen: string[] = [];
    bindPointer(
      canvas.target,
      win.target,
      () => seen.push('down'),
      () => seen.push('up'),
    );
    win.fire('pointerdown', event);
    canvas.fire('pointercancel', event);
    expect(seen).toEqual([]);
  });

  it('unbinds all three', () => {
    const canvas = fakeTarget();
    const win = fakeTarget();
    const unbind = bindPointer(
      canvas.target,
      win.target,
      () => {},
      () => {},
    );
    expect(canvas.count() + win.count()).toBe(3);
    unbind();
    expect(canvas.count() + win.count()).toBe(0);
  });
});
