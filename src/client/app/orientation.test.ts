import { describe, expect, it } from 'vitest';
import { bindOrientation, type OrientationQuery } from './orientation.ts';

function createQuery(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query: OrientationQuery & { matches: boolean } = {
    matches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const change = (next: boolean): void => {
    query.matches = next;
    for (const listener of [...listeners]) listener({ matches: next });
  };
  return { query, listeners, change };
}

describe('bindOrientation', () => {
  it('reports the current orientation at bind time', () => {
    const portrait = createQuery(true);
    const seen: boolean[] = [];
    bindOrientation(portrait.query, (isPortrait) => seen.push(isPortrait));
    expect(seen).toEqual([true]);
    const landscape = createQuery(false);
    const seenLandscape: boolean[] = [];
    bindOrientation(landscape.query, (isPortrait) => seenLandscape.push(isPortrait));
    expect(seenLandscape).toEqual([false]);
  });

  it('reports every change', () => {
    const { query, change } = createQuery(false);
    const seen: boolean[] = [];
    bindOrientation(query, (isPortrait) => seen.push(isPortrait));
    change(true);
    change(false);
    expect(seen).toEqual([false, true, false]);
  });

  it('stops reporting once unbound', () => {
    const { query, listeners, change } = createQuery(false);
    const seen: boolean[] = [];
    const unbind = bindOrientation(query, (isPortrait) => seen.push(isPortrait));
    unbind();
    change(true);
    expect(listeners.size).toBe(0);
    expect(seen).toEqual([false]);
  });
});
