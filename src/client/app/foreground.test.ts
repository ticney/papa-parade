import { describe, expect, it } from 'vitest';
import { type ForegroundSource, waitForForeground } from './foreground.ts';

function fakeDocument(initial: string) {
  const listeners = new Set<() => void>();
  const source: ForegroundSource & { visibilityState: string } = {
    visibilityState: initial,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const set = (next: string): void => {
    source.visibilityState = next;
    for (const listener of [...listeners]) listener();
  };
  return { source, set, listeners };
}

describe('waitForForeground', () => {
  it('resolves at once when the page is visible', async () => {
    const { source, listeners } = fakeDocument('visible');
    await waitForForeground(source);
    expect(listeners.size).toBe(0);
  });

  it('waits for the page to become visible, then lets go of its listener', async () => {
    const { source, set, listeners } = fakeDocument('hidden');
    let done = false;
    const waiting = waitForForeground(source).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    set('hidden'); // a change event that leaves it hidden is not enough
    await Promise.resolve();
    expect(done).toBe(false);
    set('visible');
    await waiting;
    expect(done).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
